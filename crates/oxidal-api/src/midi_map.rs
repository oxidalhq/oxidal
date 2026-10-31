//! Device-local controller map. Physical input is global; actions are keyed by preset identity.
use crate::Shared;
use axum::{Json, extract::State, http::header, response::IntoResponse};
use std::sync::Arc;

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    match shared.midi_map.snapshot() {
        Ok(map) => ([(header::CACHE_CONTROL, "no-store")], Json(map)).into_response(),
        Err(error) => crate::failure(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            &error.to_string(),
        ),
    }
}
