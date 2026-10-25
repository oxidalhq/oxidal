//! Preset library HTTP boundary. Blocking parsing/storage never runs on async/audio threads.
//! @see docs/architecture.md
use crate::{Shared, failure};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, State, rejection::BytesRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_presets::{Error, Store};
use std::sync::Arc;

async fn job<F>(shared: Arc<Shared>, operation: F) -> Response
where
    F: FnOnce(&mut Store) -> Result<Response, Error> + Send + 'static,
{
    let store = shared.presets.clone();
    match tokio::task::spawn_blocking(move || {
        let mut store = store
            .lock()
            .map_err(|_| Error::Io(std::io::Error::other("store lock failed")))?;
        operation(&mut store)
    })
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let status = match &error {
                Error::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
                Error::Io(e) if e.kind() == std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                Error::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            failure(status, &error.to_string())
        }
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Preset operation failed"),
    }
}
pub(super) async fn list(State(shared): State<Arc<Shared>>) -> Response {
    job(shared, |store| Ok(Json(store.list()?).into_response())).await
}
pub(super) async fn import(
    State(shared): State<Arc<Shared>>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let bytes = match body {
        Ok(bytes) => bytes,
        Err(error) => return failure(error.status(), "Preset upload exceeds the 32 MiB limit"),
    };
    job(shared, move |store| {
        Ok((StatusCode::CREATED, Json(store.import(&bytes)?)).into_response())
    })
    .await
}
pub(super) async fn original(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    job(shared, move |store| {
        let bytes = store.original(&id)?;
        Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"original-{id}.t3kpreset\""),
                ),
                (header::CACHE_CONTROL, "no-store".to_owned()),
            ],
            bytes,
        )
            .into_response())
    })
    .await
}
