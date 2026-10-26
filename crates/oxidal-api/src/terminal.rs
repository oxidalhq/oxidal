//! Fixed-account PTY bridge. No terminal commands execute inside the daemon.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_debug::terminal::Command;
use std::sync::Arc;
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    Path(mode): Path<String>,
    body: Result<Json<Command>, JsonRejection>,
) -> Response {
    if shared.config.debug_socket.is_none() {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Terminal service unavailable on this host",
        );
    }
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid terminal request");
    };
    if command.validate().is_err() || oxidal_debug::terminal::endpoint(&mode).is_none() {
        return failure(StatusCode::BAD_REQUEST, "Invalid terminal request");
    }
    // An accepted input may outlive a disconnected HTTP caller. Never replay it.
    let result =
        tokio::spawn(async move { oxidal_debug::terminal::request(&mode, command).await }).await;
    match result {
        Ok(Ok(state)) => ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response(),
        Ok(Err(error)) => failure(StatusCode::CONFLICT, error),
        Err(_) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Terminal bridge unavailable",
        ),
    }
}
