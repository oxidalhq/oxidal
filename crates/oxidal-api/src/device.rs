//! HTTP bridge remains unprivileged. Only the allowlisted Unix helper can change networking.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_device::{Command, NetworkState};
use std::sync::Arc;
async fn dispatch(shared: Arc<Shared>, command: Command) -> Response {
    if let Err(error) = command.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, error);
    }
    let Some(path) = &shared.config.device_socket else {
        return if matches!(command, Command::Status {}) {
            Json(NetworkState {
                message: "Network administration is unavailable on this host".into(),
                ..Default::default()
            })
            .into_response()
        } else {
            failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Network administration is unavailable on this host",
            )
        };
    };
    #[cfg(unix)]
    let result = oxidal_device::ipc::request(path, &command).await;
    #[cfg(not(unix))]
    let result: Result<oxidal_device::Reply, &str> = Err("Device service requires Linux");
    match result {
        Ok(reply) => match (reply.state, reply.error) {
            (Some(state), None) => {
                ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response()
            }
            (_, Some(error)) => failure(StatusCode::CONFLICT, &error),
            _ => failure(StatusCode::BAD_GATEWAY, "Invalid device response"),
        },
        Err(error) => failure(StatusCode::SERVICE_UNAVAILABLE, error),
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    dispatch(shared, Command::Status {}).await
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Command>, JsonRejection>,
) -> Response {
    match body {
        Ok(Json(command)) => dispatch(shared, command).await,
        Err(_) => failure(StatusCode::BAD_REQUEST, "Invalid network command"),
    }
}
