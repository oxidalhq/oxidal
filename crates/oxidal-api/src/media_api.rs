//! Media HTTP surface: list and delete assets, and chunked resumable uploads.
//! An upload is created with its name and size, then filled with `PUT`
//! chunks of at most 8 MiB at the confirmed offset, so it stays far below the
//! proxy's body limit and resumes after a phone sleeps or Wi-Fi drops. Space
//! is admitted when the upload starts and again for every chunk.
//! @see docs/media.md
use crate::media::{MediaError, MediaManifest, Quarantined, Space};
use crate::{Shared, failure};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State, rejection::BytesRejection, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Seek, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Largest accepted upload chunk.
pub(crate) const CHUNK_LIMIT: usize = 8 * 1024 * 1024;
/// Largest accepted file.
pub(crate) const FILE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
/// Uploads untouched this long are discarded.
const STALE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_OPEN_UPLOADS: usize = 8;

/// The Library view of the store.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MediaLibrary {
    pub assets: Vec<MediaManifest>,
    pub quarantined: Vec<Quarantined>,
    pub used_bytes: u64,
    /// Absent where free space cannot be measured.
    pub space: Option<Space>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadRequest {
    /// The file's name on the sending device; becomes the default title.
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UploadFormat {
    Wav,
    Mp3,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadState {
    pub id: String,
    pub title: String,
    pub format: UploadFormat,
    pub size: u64,
    /// Bytes received and confirmed; the next chunk must start here.
    pub offset: u64,
    pub complete: bool,
}

#[derive(Debug)]
struct Upload {
    state: UploadState,
    touched: Instant,
    writing: bool,
}

#[derive(Debug, Default)]
pub(crate) struct Uploads {
    open: Mutex<HashMap<String, Upload>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ChunkQuery {
    offset: u64,
}

/// Room for the original plus its play-ready float32 render. A render is at
/// most 2.5× a 16-bit WAV and about 25× a 128 kbit/s MP3; the exact size is
/// admitted again once the file is probed.
fn estimate(format: UploadFormat, size: u64) -> u64 {
    match format {
        UploadFormat::Wav => size.saturating_mul(7) / 2,
        UploadFormat::Mp3 => size.saturating_mul(26),
    }
}

fn split_name(name: &str) -> Result<(String, UploadFormat), &'static str> {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = file.rsplit_once('.').ok_or("Choose a WAV or MP3 file")?;
    let format = match ext.to_ascii_lowercase().as_str() {
        "wav" | "wave" => UploadFormat::Wav,
        "mp3" => UploadFormat::Mp3,
        _ => return Err("Choose a WAV or MP3 file"),
    };
    let title: String = stem.chars().filter(|c| !c.is_control()).take(120).collect();
    let title = title.trim();
    Ok((
        if title.is_empty() {
            "Untitled".into()
        } else {
            title.into()
        },
        format,
    ))
}

fn media_error(error: MediaError) -> Response {
    match error {
        MediaError::NotFound => failure(StatusCode::NOT_FOUND, "That file is no longer in Library"),
        MediaError::Leased => failure(
            StatusCode::CONFLICT,
            "This file is in use. Stop the track or job first",
        ),
        MediaError::NoSpace(space) => failure(
            StatusCode::INSUFFICIENT_STORAGE,
            &format!(
                "No space: {} MB free, {} MB kept in reserve",
                space.available_bytes / 1_000_000,
                space.reserve_bytes / 1_000_000
            ),
        ),
        MediaError::Invalid(reason) => failure(StatusCode::UNPROCESSABLE_ENTITY, &reason),
        MediaError::Io(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Media storage failed"),
    }
}

fn store(shared: &Shared) -> Result<Arc<crate::media::Store>, Box<Response>> {
    shared.media.as_ref().map(Arc::clone).map_err(|reason| {
        Box::new(failure(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("Media storage is unavailable: {reason}"),
        ))
    })
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, MediaError> + Send + 'static,
) -> Result<T, Box<Response>> {
    match tokio::task::spawn_blocking(work).await {
        Ok(result) => result.map_err(|e| Box::new(media_error(e))),
        Err(_) => Err(Box::new(failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Media storage stopped",
        ))),
    }
}

fn no_store(status: StatusCode, body: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

pub(crate) async fn library(State(shared): State<Arc<Shared>>) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || {
        let assets = store.list()?;
        Ok(MediaLibrary {
            used_bytes: assets.iter().map(MediaManifest::bytes).sum(),
            assets,
            quarantined: store.quarantined().to_vec(),
            space: store.space().ok(),
        })
    })
    .await
    {
        Ok(library) => no_store(StatusCode::OK, library),
        Err(response) => *response,
    }
}

pub(crate) async fn remove(State(shared): State<Arc<Shared>>, Path(id): Path<String>) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || store.delete(&id)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(response) => *response,
    }
}

impl Uploads {
    fn sweep(&self, store: &crate::media::Store) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        open.retain(|id, upload| {
            let keep = upload.writing || upload.touched.elapsed() < STALE;
            if !keep && let Ok(path) = store.upload_part(id) {
                let _ = std::fs::remove_file(path);
            }
            keep
        });
    }
    fn get(&self, id: &str) -> Option<UploadState> {
        self.open
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map(|u| u.state.clone())
    }
}

pub(crate) async fn create_upload(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<UploadRequest>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send the file name and size");
    };
    let (title, format) = match split_name(&request.name) {
        Ok(parts) => parts,
        Err(reason) => return failure(StatusCode::UNSUPPORTED_MEDIA_TYPE, reason),
    };
    if request.size == 0 || request.size > FILE_LIMIT {
        return failure(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Files must be 1 byte to 2 GiB",
        );
    }
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    shared.uploads.sweep(&store);
    {
        let open = shared
            .uploads
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if open.len() >= MAX_OPEN_UPLOADS {
            return failure(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many uploads in progress; finish or cancel one",
            );
        }
    }
    let needed = estimate(format, request.size);
    let created = blocking(move || {
        store.admit(needed)?;
        let id = crate::media::new_id();
        std::fs::File::create_new(store.upload_part(&id)?)?;
        Ok(id)
    })
    .await;
    let id = match created {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let state = UploadState {
        id: id.clone(),
        title,
        format,
        size: request.size,
        offset: 0,
        complete: false,
    };
    shared
        .uploads
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            id,
            Upload {
                state: state.clone(),
                touched: Instant::now(),
                writing: false,
            },
        );
    no_store(StatusCode::CREATED, state)
}

pub(crate) async fn upload_state(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    match shared.uploads.get(&id) {
        Some(state) => no_store(StatusCode::OK, state),
        None => failure(
            StatusCode::NOT_FOUND,
            "That upload has expired; start again",
        ),
    }
}

pub(crate) async fn append_chunk(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    query: Result<Query<ChunkQuery>, axum::extract::rejection::QueryRejection>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Send the chunk offset");
    };
    let bytes = match body {
        Ok(bytes) => bytes,
        Err(e) => return failure(e.status(), "Chunks must be at most 8 MiB"),
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    // Claim the upload so two requests cannot append at once.
    {
        let mut open = shared
            .uploads
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(upload) = open.get_mut(&id) else {
            return failure(
                StatusCode::NOT_FOUND,
                "That upload has expired; start again",
            );
        };
        if upload.writing {
            return failure(StatusCode::CONFLICT, "A chunk is already in progress");
        }
        if query.offset != upload.state.offset {
            // The client resumes from the confirmed offset in the response.
            return (
                StatusCode::CONFLICT,
                [(header::CACHE_CONTROL, "no-store")],
                Json(upload.state.clone()),
            )
                .into_response();
        }
        if bytes.is_empty() || upload.state.offset + bytes.len() as u64 > upload.state.size {
            return failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                "The chunk does not fit the declared file size",
            );
        }
        upload.writing = true;
        upload.touched = Instant::now();
    }
    let path_id = id.clone();
    let length = bytes.len() as u64;
    let offset = query.offset;
    let written = blocking(move || {
        store.admit(length)?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open(store.upload_part(&path_id)?)?;
        // Drop anything a failed earlier append left past the confirmed offset.
        file.set_len(offset)?;
        file.seek(std::io::SeekFrom::Start(offset))?;
        file.write_all(&bytes)?;
        Ok(())
    })
    .await;
    let mut open = shared
        .uploads
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(upload) = open.get_mut(&id) else {
        return failure(StatusCode::NOT_FOUND, "That upload was cancelled");
    };
    upload.writing = false;
    upload.touched = Instant::now();
    if let Err(response) = written {
        // The offset stays where it was confirmed; the client retries from it.
        return *response;
    }
    upload.state.offset += length;
    upload.state.complete = upload.state.offset == upload.state.size;
    no_store(StatusCode::OK, upload.state.clone())
}

pub(crate) async fn cancel_upload(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let removed = shared
        .uploads
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if removed.is_none() {
        return failure(StatusCode::NOT_FOUND, "That upload has expired");
    }
    match blocking(move || {
        let _ = std::fs::remove_file(store.upload_part(&id)?);
        Ok(())
    })
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(response) => *response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_become_titles_and_only_wav_or_mp3_are_accepted() {
        assert_eq!(
            split_name("Rehearsal 01.MP3").unwrap(),
            ("Rehearsal 01".into(), UploadFormat::Mp3)
        );
        assert_eq!(
            split_name("C:\\Music\\take.wav").unwrap(),
            ("take".into(), UploadFormat::Wav)
        );
        assert_eq!(split_name(".wav").unwrap().0, "Untitled");
        assert!(split_name("song.flac").is_err());
        assert!(split_name("song").is_err());
        assert!(estimate(UploadFormat::Mp3, 8_000_000) > 190_000_000);
        assert_eq!(estimate(UploadFormat::Wav, 1000), 3500);
    }
}
