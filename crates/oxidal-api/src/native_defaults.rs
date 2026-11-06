//! Persist defaults separately from portable presets and sounding owner state.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_tone3000::preferences::{self, Update};
use std::sync::Arc;
async fn dispatch(shared: Arc<Shared>, update: Option<Update>) -> Response {
    if let Some(u) = &update
        && let Err(e) = u.settings.validate()
    {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    let root = shared.config.preset_dir.clone();
    let lock = shared.presets.clone();
    match tokio::task::spawn_blocking(move || {
        let _owner = lock
            .lock()
            .map_err(|_| "Defaults store unavailable".to_owned())?;
        match update {
            Some(update) => preferences::save(&root, update),
            None => preferences::read(&root),
        }
    })
    .await
    {
        Ok(Ok(state)) => ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response(),
        Ok(Err(error)) => failure(StatusCode::CONFLICT, &error),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Native defaults task failed",
        ),
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    dispatch(shared, None).await
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Update>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    match body {
        Ok(Json(update)) => dispatch(shared, Some(update)).await,
        Err(_) => failure(StatusCode::BAD_REQUEST, "Invalid native defaults"),
    }
}
