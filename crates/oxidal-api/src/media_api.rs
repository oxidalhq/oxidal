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
    /// Keep the upload staged for a song import instead of making a Library track.
    #[serde(default)]
    pub stem: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UploadFormat {
    Wav,
    Mp3,
}

/// Where a received file is in the import pipeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ImportPhase {
    /// Chunks are still arriving.
    Receiving,
    Queued,
    /// Decoding and preparing the play-ready render; `progress` is 0–1.
    Preparing {
        progress: f64,
    },
    Ready {
        asset: String,
    },
    /// The same file is already in Library. Import a copy or cancel.
    Duplicate {
        existing: String,
        title: String,
    },
    Failed {
        reason: String,
    },
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
    pub import: ImportPhase,
}

/// Rename or re-trim an asset; files never change.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetUpdate {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub trim_db: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ImportChoice {
    /// Import a second copy of a file that is already in Library.
    copy: bool,
}

#[derive(Debug)]
struct Upload {
    state: UploadState,
    stem: bool,
    touched: Instant,
    writing: bool,
}

type Open = Arc<Mutex<HashMap<String, Upload>>>;

struct Job {
    id: String,
    request: crate::media_import::ImportRequest,
    copy: bool,
}

#[derive(Debug, Default)]
pub(crate) struct Uploads {
    open: Open,
    queue: std::sync::OnceLock<std::sync::mpsc::Sender<Job>>,
}

fn set_phase(open: &Open, id: &str, phase: ImportPhase) {
    if let Some(upload) = open.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
        upload.state.import = phase;
        upload.touched = Instant::now();
    }
}

/// One import at a time, in arrival order, on its own thread.
fn importer(store: Arc<crate::media::Store>, open: Open, jobs: std::sync::mpsc::Receiver<Job>) {
    for job in jobs {
        let Ok(part) = store.upload_part(&job.id) else {
            continue;
        };
        set_phase(&open, &job.id, ImportPhase::Preparing { progress: 0.0 });
        if !job.copy {
            let existing = crate::media_import::hash_file(&part).ok().and_then(|hash| {
                store.list().ok()?.into_iter().find(|asset| {
                    asset
                        .source
                        .as_ref()
                        .is_some_and(|source| source.sha256 == hash)
                })
            });
            if let Some(asset) = existing {
                set_phase(
                    &open,
                    &job.id,
                    ImportPhase::Duplicate {
                        existing: asset.id,
                        title: asset.title,
                    },
                );
                continue;
            }
        }
        let mut reported = 0.0;
        let result = crate::media_import::import(&store, &part, &job.request, &mut |progress| {
            if progress - reported >= 0.02 {
                reported = progress;
                set_phase(&open, &job.id, ImportPhase::Preparing { progress });
            }
        });
        set_phase(
            &open,
            &job.id,
            match result {
                Ok(manifest) => ImportPhase::Ready { asset: manifest.id },
                Err(MediaError::Invalid(reason)) => ImportPhase::Failed { reason },
                Err(MediaError::NoSpace(space)) => ImportPhase::Failed {
                    reason: format!(
                        "No space: {} MB free, {} MB kept in reserve",
                        space.available_bytes / 1_000_000,
                        space.reserve_bytes / 1_000_000
                    ),
                },
                Err(_) => ImportPhase::Failed {
                    reason: "Media storage failed during import".into(),
                },
            },
        );
    }
}

impl std::fmt::Debug for Job {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Job").field("id", &self.id).finish()
    }
}

impl Uploads {
    fn enqueue(&self, store: &Arc<crate::media::Store>, job: Job) {
        let sender = self.queue.get_or_init(|| {
            let (send, receive) = std::sync::mpsc::channel();
            let store = Arc::clone(store);
            let open = Arc::clone(&self.open);
            std::thread::Builder::new()
                .name("media-import".into())
                .spawn(move || importer(store, open, receive))
                .expect("start the media import thread");
            send
        });
        let id = job.id.clone();
        if sender.send(job).is_ok() {
            set_phase(&self.open, &id, ImportPhase::Queued);
        } else {
            set_phase(
                &self.open,
                &id,
                ImportPhase::Failed {
                    reason: "The import service stopped".into(),
                },
            );
        }
    }
}

/// The stream rate renders are made for: the saved startup sound's, else 48 kHz.
pub(crate) fn stream_rate(shared: &Shared) -> u32 {
    use crate::audio_boot::Choice;
    match shared.boot.snapshot() {
        Ok(Some(Choice::Native { settings, .. })) => settings.stream.input.sample_rate,
        Ok(Some(Choice::Mixed { settings })) => settings.stream.input.sample_rate,
        Ok(Some(Choice::Effects { settings })) => settings.stream.input.sample_rate,
        _ => 48_000,
    }
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

pub(crate) fn media_error(error: MediaError) -> Response {
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

pub(crate) fn store(shared: &Shared) -> Result<Arc<crate::media::Store>, Box<Response>> {
    shared.media.as_ref().map(Arc::clone).map_err(|reason| {
        Box::new(failure(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("Media storage is unavailable: {reason}"),
        ))
    })
}

pub(crate) async fn blocking<T: Send + 'static>(
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

pub(crate) fn no_store(status: StatusCode, body: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

pub(crate) async fn library(State(shared): State<Arc<Shared>>) -> Response {
    // Imports finish in the background; keep the Backing list in step.
    crate::player::library_changed(&shared).await;
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
    let worker = shared.clone();
    match blocking(move || {
        if let Ok(manifest) = store.manifest(&id) {
            if crate::songs::imported_stems(&manifest) {
                let _permit = worker
                    .song_write
                    .try_acquire()
                    .map_err(|_| MediaError::Leased)?;
                if !crate::songs::view(&store, &id)?.mixes.is_empty() {
                    return Err(MediaError::Invalid(
                        "Delete the saved mixes for this stem song first".into(),
                    ));
                }
                return store.delete(&id);
            }
            if crate::songs::owns_asset(&store, &manifest) {
                return Err(MediaError::Invalid(
                    "Manage this track and its mixes from the song editor".into(),
                ));
            }
        }
        store.delete(&id)
    })
    .await
    {
        Ok(()) => {
            crate::player::library_changed(&shared).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(response) => *response,
    }
}

impl Uploads {
    fn sweep(&self, store: &crate::media::Store) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        open.retain(|id, upload| {
            let busy = matches!(
                upload.state.import,
                ImportPhase::Queued | ImportPhase::Preparing { .. }
            );
            let keep = upload.writing || busy || upload.touched.elapsed() < STALE;
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

    pub(crate) fn claim_stems(&self, ids: &[String]) -> Result<StemUploads, MediaError> {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        let states = ids
            .iter()
            .map(|id| {
                let upload = open.get(id).ok_or(MediaError::NotFound)?;
                if !upload.stem || !upload.state.complete {
                    return Err(MediaError::Invalid(
                        "Finish uploading each stem first".into(),
                    ));
                }
                if upload.writing {
                    return Err(MediaError::Leased);
                }
                Ok(upload.state.clone())
            })
            .collect::<Result<Vec<_>, _>>()?;
        for id in ids {
            open.get_mut(id).expect("validated upload").writing = true;
        }
        Ok(StemUploads {
            open: Arc::clone(&self.open),
            states,
        })
    }
}

pub(crate) struct StemUploads {
    open: Open,
    pub states: Vec<UploadState>,
}

impl StemUploads {
    pub(crate) fn consume(self, store: &crate::media::Store) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        for state in &self.states {
            if let Ok(path) = store.upload_part(&state.id) {
                let _ = std::fs::remove_file(path);
            }
            open.remove(&state.id);
        }
    }
}

impl Drop for StemUploads {
    fn drop(&mut self) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        for state in &self.states {
            if let Some(upload) = open.get_mut(&state.id) {
                upload.writing = false;
                upload.touched = Instant::now();
            }
        }
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
        let active = open
            .values()
            .filter(|u| {
                !matches!(
                    u.state.import,
                    ImportPhase::Ready { .. } | ImportPhase::Failed { .. }
                )
            })
            .count();
        if active >= MAX_OPEN_UPLOADS {
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
        import: ImportPhase::Receiving,
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
                stem: request.stem,
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
        Some(state) => {
            if matches!(state.import, ImportPhase::Ready { .. }) {
                crate::player::library_changed(&shared).await;
            }
            no_store(StatusCode::OK, state)
        }
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
    let job = (upload.state.complete && !upload.stem).then(|| Job {
        id: id.clone(),
        request: crate::media_import::ImportRequest {
            title: upload.state.title.clone(),
            wav: upload.state.format == UploadFormat::Wav,
            kind: crate::media::MediaKind::Backing,
            rate: stream_rate(&shared),
        },
        copy: false,
    });
    drop(open);
    if let (Some(job), Ok(store)) = (job, store_of(&shared)) {
        shared.uploads.enqueue(&store, job);
    }
    match shared.uploads.get(&id) {
        Some(state) => no_store(StatusCode::OK, state),
        None => failure(StatusCode::NOT_FOUND, "That upload was cancelled"),
    }
}

fn store_of(shared: &Shared) -> Result<Arc<crate::media::Store>, ()> {
    shared.media.as_ref().map(Arc::clone).map_err(|_| ())
}

/// Continues a duplicate as a second copy.
pub(crate) async fn import_copy(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    body: Result<Json<ImportChoice>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(ImportChoice { copy: true })) = body else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Choose to import a copy, or cancel",
        );
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let job = {
        let open = shared
            .uploads
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(upload) = open.get(&id) else {
            return failure(
                StatusCode::NOT_FOUND,
                "That upload has expired; start again",
            );
        };
        if !matches!(upload.state.import, ImportPhase::Duplicate { .. }) {
            return failure(
                StatusCode::CONFLICT,
                "Only a duplicate waits for this choice",
            );
        }
        Job {
            id: id.clone(),
            request: crate::media_import::ImportRequest {
                title: upload.state.title.clone(),
                wav: upload.state.format == UploadFormat::Wav,
                kind: crate::media::MediaKind::Backing,
                rate: stream_rate(&shared),
            },
            copy: true,
        }
    };
    shared.uploads.enqueue(&store, job);
    match shared.uploads.get(&id) {
        Some(state) => no_store(StatusCode::ACCEPTED, state),
        None => failure(StatusCode::NOT_FOUND, "That upload was cancelled"),
    }
}

pub(crate) async fn update_asset(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    body: Result<Json<AssetUpdate>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(update)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send a new title or track trim");
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || {
        if update.title.is_some() && crate::songs::generated_mix(&store.manifest(&id)?).is_some() {
            return Err(MediaError::Invalid(
                "Rename this mix from the song editor".into(),
            ));
        }
        store.update(&id, |manifest| {
            if let Some(title) = update.title {
                manifest.title = title.trim().to_owned();
            }
            if let Some(trim) = update.trim_db {
                manifest.playback.trim_db = (trim * 10.0).round() / 10.0;
            }
        })
    })
    .await
    {
        Ok(manifest) => {
            crate::player::library_changed(&shared).await;
            no_store(StatusCode::OK, manifest)
        }
        Err(response) => *response,
    }
}

/// The original file, byte for byte, named after the asset's title.
pub(crate) async fn download(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let lookup = blocking(move || {
        let manifest = store.manifest(&id)?;
        let source = manifest.source.clone().ok_or(MediaError::NotFound)?;
        let path = store.file(&id, &source.file)?;
        Ok((manifest, source, path))
    })
    .await;
    let (manifest, source, path) = match lookup {
        Ok(found) => found,
        Err(response) => return *response,
    };
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return failure(StatusCode::NOT_FOUND, "That file is no longer in Library");
    };
    let stream = async_stream::stream! {
        use tokio::io::AsyncReadExt;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            match file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(length) => yield Ok::<Bytes, std::io::Error>(Bytes::copy_from_slice(&buffer[..length])),
                Err(error) => {
                    yield Err(error);
                    return;
                }
            }
        }
    };
    let safe: String = manifest
        .title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || " -_().".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let (mime, ext) = if source.container == "mp3" {
        ("audio/mpeg", "mp3")
    } else {
        ("audio/wav", "wav")
    };
    (
        [
            (header::CONTENT_TYPE, mime.to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}.{ext}\"", safe.trim()),
            ),
            (header::CONTENT_LENGTH, source.bytes.to_string()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
        axum::body::Body::from_stream(stream),
    )
        .into_response()
}

pub(crate) async fn cancel_upload(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let removed = {
        let mut open = shared
            .uploads
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if open
            .get(&id)
            .is_some_and(|upload| upload.stem && upload.writing)
        {
            return failure(StatusCode::CONFLICT, "That stem upload is in use");
        }
        open.remove(&id)
    };
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

/// A 24-bit PCM WAV made from the play-ready render: how DI recordings and
/// reamp results leave the device. Files over 4 GiB are refused.
pub(crate) async fn download_wav(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let lookup = blocking(move || {
        let lease = store.lease(&id)?;
        let manifest = store.manifest(&id)?;
        let render = manifest
            .renders
            .first()
            .cloned()
            .ok_or(MediaError::NotFound)?;
        let path = store.file(&id, &render.file)?;
        Ok((manifest, render, path, lease))
    })
    .await;
    let (manifest, render, path, lease) = match lookup {
        Ok(found) => found,
        Err(response) => return *response,
    };
    let safe: String = manifest
        .title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || " -_().".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    wav_download(
        path,
        render.frames,
        render.channels,
        render.rate,
        safe.trim(),
        lease,
    )
    .await
}

pub(crate) async fn wav_download(
    path: std::path::PathBuf,
    frames: u64,
    channels: u16,
    rate: u32,
    name: &str,
    lease: crate::media::Lease,
) -> Response {
    let Some(wav_header) = crate::media_wav::header(frames, channels, rate) else {
        return failure(
            StatusCode::PAYLOAD_TOO_LARGE,
            "WAV export is limited to 4 GiB",
        );
    };
    let data = frames * u64::from(channels) * 3;
    let pad = data % 2;
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return failure(StatusCode::NOT_FOUND, "That file is no longer in Library");
    };
    let stream = async_stream::stream! {
        use tokio::io::AsyncReadExt;
        let _lease = lease;
        yield Ok::<Bytes, std::io::Error>(Bytes::copy_from_slice(&wav_header));
        let mut buffer = vec![0_u8; 64 * 1024];
        let mut carry = Vec::new();
        loop {
            match file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buffer[..n]);
                    let whole = carry.len() / 4 * 4;
                    let mut out = Vec::with_capacity(whole / 4 * 3);
                    crate::media_wav::encode(&carry[..whole], &mut out);
                    carry.drain(..whole);
                    yield Ok(Bytes::from(out));
                }
                Err(error) => {
                    yield Err(error);
                    return;
                }
            }
        }
        if pad != 0 {
            yield Ok(Bytes::from_static(&[0]));
        }
    };
    (
        [
            (header::CONTENT_TYPE, "audio/wav".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}.wav\""),
            ),
            (header::CONTENT_LENGTH, (44 + data + pad).to_string()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
        axum::body::Body::from_stream(stream),
    )
        .into_response()
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
