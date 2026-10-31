//! Effect-pack control stays behind the fixed privileged-helper allowlist.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_device::{
    Command,
    packs::{PackAction, PackState},
};
use std::sync::Arc;

fn audio_running(shared: &Shared) -> bool {
    shared.playback.snapshot().device_owned
        || shared.graph_playback.snapshot().device_owned
        || shared.rig_playback.snapshot().device_owned
}

async fn dispatch(shared: Arc<Shared>, command: Command) -> Response {
    let running = audio_running(&shared);
    let Some(path) = &shared.config.device_socket else {
        return if matches!(command, Command::Packs {}) {
            (
                [(header::CACHE_CONTROL, "no-store")],
                Json(PackState {
                    available: false,
                    audio_running: running,
                    packs: oxidal_device::packs::catalog(),
                    job: None,
                    message: "Effect-pack administration is unavailable on this host".into(),
                }),
            )
                .into_response()
        } else {
            failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Effect-pack administration is unavailable on this host",
            )
        };
    };
    #[cfg(unix)]
    let result = oxidal_device::ipc::request(path, &command).await;
    #[cfg(not(unix))]
    let result: Result<oxidal_device::Reply, &str> = Err("Device service requires Linux");
    match result {
        Ok(reply) => match (reply.packs, reply.error) {
            (Some(mut packs), None) => {
                packs.audio_running = running;
                ([(header::CACHE_CONTROL, "no-store")], Json(packs)).into_response()
            }
            (_, Some(error)) => failure(StatusCode::CONFLICT, &error),
            _ => failure(StatusCode::BAD_GATEWAY, "Invalid device response"),
        },
        Err(error) => failure(StatusCode::SERVICE_UNAVAILABLE, error),
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    dispatch(shared, Command::Packs {}).await
}

pub(super) async fn change(
    State(shared): State<Arc<Shared>>,
    Path((id, action)): Path<(String, String)>,
) -> Response {
    let action = match action.as_str() {
        "install" => PackAction::Install,
        "remove" => PackAction::Remove,
        _ => return failure(StatusCode::NOT_FOUND, "Unknown effect-pack action"),
    };
    if audio_running(&shared) {
        return failure(
            StatusCode::CONFLICT,
            "Stop audio before changing installed effect packs",
        );
    }
    dispatch(shared, Command::Pack { id, action }).await
}
