use crate::{
    Shared, failure,
    media::{Lease, MediaError, Staging, Store},
    media_api::{blocking, media_error, no_store, store},
    songs::{self, MixRevision, SaveMix, SongError},
};
use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_splitter::StemRole;
use std::{fs::File, io, path::PathBuf, sync::Arc};

pub(crate) async fn list(State(shared): State<Arc<Shared>>) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || songs::list(&store)).await {
        Ok(list) => no_store(StatusCode::OK, list),
        Err(response) => *response,
    }
}

pub(crate) async fn view(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || songs::view(&store, &source)).await {
        Ok(song) => no_store(StatusCode::OK, song),
        Err(response) => *response,
    }
}

fn song_error(error: SongError) -> Response {
    match error {
        SongError::Media(error) => media_error(error),
        SongError::Stale => failure(StatusCode::CONFLICT, "This mix changed. Reopen it first"),
        SongError::Interrupted => failure(
            StatusCode::CONFLICT,
            "Turn Protect off before preparing the song",
        ),
    }
}

pub(crate) async fn change(
    shared: Arc<Shared>,
    action: impl FnOnce(&crate::media::Store, &Shared) -> Result<Response, SongError> + Send + 'static,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let Ok(permit) = shared.song_write.clone().try_acquire_owned() else {
        return failure(StatusCode::CONFLICT, "A song edit is already in progress");
    };
    let worker = shared.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        action(&store, &worker)
    })
    .await;
    match result {
        Ok(Ok(response)) => {
            crate::player::library_changed(&shared).await;
            response
        }
        Ok(Err(error)) => song_error(error),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Song preparation stopped",
        ),
    }
}

pub(crate) async fn save_mix(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
    body: Result<Json<SaveMix>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Send a title, split and stem controls",
        );
    };
    change(shared, move |store, shared| {
        let record = crate::background::run(|| {
            songs::save(store, &source, request, || {
                shared.protect.refuse(false).is_none()
            })
        })?;
        Ok(no_store(StatusCode::OK, record))
    })
    .await
}

pub(crate) async fn import_stems(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<crate::stem_import::ImportStems>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Send the song name and stem assignments",
        );
    };
    change(shared, move |store, shared| {
        let rate = crate::media_api::stream_rate(shared);
        let song = crate::background::run(|| {
            crate::stem_import::import(store, &shared.uploads, request, rate, || {
                shared.protect.refuse(false).is_none()
            })
        })?;
        Ok(no_store(StatusCode::CREATED, song))
    })
    .await
}

pub(crate) async fn remove_mix(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
    body: Result<Json<MixRevision>, JsonRejection>,
) -> Response {
    let Ok(Json(target)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send the mix and its revision");
    };
    change(shared, move |store, shared| {
        if shared.protect.refuse(false).is_some() {
            return Err(SongError::Interrupted);
        }
        songs::remove_mix(store, &source, &target)?;
        Ok(StatusCode::NO_CONTENT.into_response())
    })
    .await
}

pub(crate) async fn remove_split(
    State(shared): State<Arc<Shared>>,
    Path((source, split)): Path<(String, String)>,
) -> Response {
    change(shared, move |store, shared| {
        if shared.protect.refuse(false).is_some() {
            return Err(SongError::Interrupted);
        }
        songs::remove_split(store, &source, &split)?;
        Ok(StatusCode::NO_CONTENT.into_response())
    })
    .await
}

pub(crate) async fn download_stem(
    State(shared): State<Arc<Shared>>,
    Path((source, split, role)): Path<(String, String, StemRole)>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let found = blocking(move || {
        let lease = store.lease(&source)?;
        let (split, path) = songs::stem_file(&store, &source, &split, role)?;
        Ok((split, path, lease))
    })
    .await;
    match found {
        Ok((split, path, lease)) => {
            let Some(header) = crate::media_wav::stem_header(split.frames, split.rate) else {
                return failure(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "A stem is too large for WAV export",
                );
            };
            download_file(
                path,
                split.frames * 8,
                "audio/wav",
                &format!("{}.wav", role.name()),
                Bytes::copy_from_slice(&header),
                lease,
            )
            .await
        }
        Err(response) => *response,
    }
}

struct Archive {
    store: Arc<Store>,
    staging: Option<Staging>,
    _lease: Lease,
}

impl Drop for Archive {
    fn drop(&mut self) {
        if let Some(staging) = self.staging.take() {
            let _ = self.store.abandon(staging);
        }
    }
}

fn archive(
    store: Arc<Store>,
    source: &str,
    split_id: &str,
) -> Result<(Archive, PathBuf, u64), MediaError> {
    let lease = store.lease(source)?;
    let (split, dir) = songs::read_split(&store, source, split_id)?;
    let header = crate::media_wav::stem_header(split.frames, split.rate)
        .ok_or_else(|| MediaError::Invalid("A stem is too large for WAV export".into()))?;
    let per_stem = split.frames * 8 + header.len() as u64;
    // Stored entries retain their exact size. Reserve extra for headers and
    // the central directory and mark the archive as ZIP64 if needed.
    store.admit((per_stem + 1024) * split.present_roles().len() as u64)?;
    let staging = store.stage()?;
    let guard = Archive {
        store,
        staging: Some(staging),
        _lease: lease,
    };
    let path = guard.staging.as_ref().unwrap().file("stems.zip")?;
    let mut zip = crate::media_zip::Zip::new(File::create(&path)?);
    for &role in split.present_roles() {
        zip.add(format!("{}.wav", role.name()), per_stem, |output| {
            output.write_all(&header)?;
            let mut file = File::open(songs::mixing_file(&dir, role))?;
            io::copy(&mut file, output)?;
            Ok(())
        })?;
    }
    let size = zip.finish()?.metadata()?.len();
    Ok((guard, path, size))
}

pub(crate) async fn download_stems(
    State(shared): State<Arc<Shared>>,
    Path((source, split)): Path<(String, String)>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let Ok(permit) = shared.song_write.clone().try_acquire_owned() else {
        return failure(
            StatusCode::CONFLICT,
            "A song edit or export is already in progress",
        );
    };
    let (guard, path, size) = match blocking(move || {
        let _permit = permit;
        archive(store, &source, &split)
    })
    .await
    {
        Ok(archive) => archive,
        Err(response) => return *response,
    };
    download_file(
        path,
        size,
        "application/zip",
        "stems.zip",
        Bytes::new(),
        guard,
    )
    .await
}

async fn download_file(
    path: PathBuf,
    size: u64,
    content_type: &str,
    name: &str,
    prefix: Bytes,
    guard: impl Send + 'static,
) -> Response {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot open the stem download",
        );
    };
    let content_length = size + prefix.len() as u64;
    let stream = async_stream::stream! {
        use tokio::io::AsyncReadExt;
        let _guard = guard;
        if !prefix.is_empty() {
            yield Ok(prefix);
        }
        let mut buffer = vec![0; 64 * 1024];
        loop {
            match file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(count) => yield Ok(Bytes::copy_from_slice(&buffer[..count])),
                Err(error) => {
                    yield Err(error);
                    break;
                }
            }
        }
    };
    (
        [
            (header::CONTENT_TYPE, content_type.to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}\""),
            ),
            (header::CONTENT_LENGTH, content_length.to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}
