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
    let refresh_capabilities = matches!(&command, Command::Status {} | Command::Scan {});
    let saved_connect = matches!(&command, Command::Connect { .. });
    #[cfg(unix)]
    let result = oxidal_device::ipc::request(path, &command).await;
    #[cfg(not(unix))]
    let result: Result<oxidal_device::Reply, &str> = Err("Device service requires Linux");
    match result {
        Ok(reply) => match (reply.state, reply.error) {
            (Some(mut state), None) => {
                if state.available {
                    let identifiers = state
                        .saved
                        .iter()
                        .filter(|profile| profile.managed)
                        .map(|profile| profile.uuid.clone())
                        .collect::<Vec<_>>();
                    let capabilities = async {
                        if refresh_capabilities {
                            shared.device_capabilities.current(path).await
                        } else {
                            shared.device_capabilities.known()
                        }
                    };
                    let ((), hotspot, names, capabilities) = tokio::join!(
                        shared.network_addresses.enrich(&mut state),
                        shared.hotspot_readback.current(),
                        shared.saved_network_names.current(&identifiers),
                        capabilities,
                    );
                    match capabilities {
                        Ok(value) => {
                            state.capabilities = Some(value);
                            state.capabilities_message = None;
                        }
                        Err(error) => {
                            state.capabilities = None;
                            state.capabilities_message = Some(error.into());
                        }
                    }
                    for profile in &mut state.saved {
                        profile.ssid = if profile.managed {
                            names
                                .as_ref()
                                .ok()
                                .and_then(|values| values.get(&profile.uuid))
                                .cloned()
                        } else {
                            None
                        };
                    }
                    state.saved_message = names.err().map(str::to_owned);
                    match hotspot {
                        Ok(value) => {
                            state.hotspot = Some(value);
                            state.hotspot_message = None;
                        }
                        Err(error) => {
                            state.hotspot = None;
                            state.hotspot_message = Some(error.into());
                        }
                    }
                }
                ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response()
            }
            (_, Some(error)) if saved_connect && error == "Invalid device request" => failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Update the device service to join saved Wi-Fi networks",
            ),
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
