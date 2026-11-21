//! Keep ready: the presets the player chose to keep loaded for gapless
//! switching, stored on the device so every browser sees the same choice
//! (Sprint 07 7.7). Ready itself is only ever reported by the audio worker.
//! @see docs/audio.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::{CatalogStore, KeepReady};
use std::sync::Arc;

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    crate::presets::job(shared, move |_| {
        Ok(Json(CatalogStore::open(root)?.keep_ready()?).into_response())
    })
    .await
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<KeepReady>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid Keep ready request");
    };
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason);
    }
    let root = shared.config.preset_dir.clone();
    crate::presets::job(shared, move |_| {
        Ok(Json(CatalogStore::open(root)?.set_keep_ready(request)?).into_response())
    })
    .await
}
