//! Storage mode changes are next-boot only and stay behind the fixed root helper.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_device::{
    Command,
    storage::{StorageMode, StorageState},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StorageRequest {
    pub mode: StorageMode,
}

fn unavailable() -> StorageState {
    StorageState {
        available: false,
        current: None,
        next_boot: None,
        reboot_required: false,
        message: "Storage lock is unavailable on this installation".into(),
    }
}

async fn dispatch(shared: Arc<Shared>, command: Command) -> Response {
    let Some(path) = &shared.config.device_socket else {
        return if matches!(command, Command::StorageStatus {}) {
            ([(header::CACHE_CONTROL, "no-store")], Json(unavailable())).into_response()
        } else {
            failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Storage lock is unavailable on this installation",
            )
        };
    };
    #[cfg(unix)]
    let result = oxidal_device::ipc::request(path, &command).await;
    #[cfg(not(unix))]
    let result: Result<oxidal_device::Reply, &str> = Err("Device service requires Linux");
    match result {
        Ok(reply) => match (reply.storage, reply.error) {
            (Some(storage), None) => {
                ([(header::CACHE_CONTROL, "no-store")], Json(storage)).into_response()
            }
            (_, Some(error)) => failure(StatusCode::CONFLICT, &error),
            _ => failure(StatusCode::BAD_GATEWAY, "Invalid device response"),
        },
        Err(error) => failure(StatusCode::SERVICE_UNAVAILABLE, error),
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    dispatch(shared, Command::StorageStatus {}).await
}

pub(super) async fn change(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<StorageRequest>, JsonRejection>,
) -> Response {
    match body {
        Ok(Json(request)) => dispatch(shared, Command::Storage { mode: request.mode }).await,
        Err(_) => failure(StatusCode::BAD_REQUEST, "Invalid storage mode"),
    }
}
