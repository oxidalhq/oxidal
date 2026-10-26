mod native_editor;
mod presets;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State, rejection::JsonRejection},
    http::StatusCode,
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use oxidal_control::{Action, Command, Control, MappingFile, Snapshot};
use oxidal_graph::{Rig, Validation};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::{Mutex, watch};
use tower_http::services::{ServeDir, ServeFile};

/// Development appliance capabilities; audio is deliberately unavailable.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Capabilities {
    pub protocol: u8,
    pub version: String,
    pub audio_available: bool,
    pub midi_transport: String,
    pub native_editor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiError {
    pub error: String,
}

/// Schema generation root. Rust wire types are the contract source of truth.
/// @see docs/architecture.md
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct Contract {
    pub snapshot: Snapshot,
    pub command: Command,
    pub rig: Rig,
    pub validation: Validation,
    pub capabilities: Capabilities,
    pub error: ApiError,
    pub library: oxidal_presets::Library,
    pub preset: oxidal_presets::Inspection,
    pub native_editor: oxidal_tone3000::protocol::EditorSnapshot,
    pub native_command: oxidal_tone3000::protocol::EditorCommand,
}

/// Local-only service settings. LAN access requires separate pairing/security design.
/// @see docs/architecture.md
#[derive(Debug, Clone)]
pub struct Config {
    pub simulator: bool,
    pub native_worker: Option<PathBuf>,
    pub mapping_path: PathBuf,
    pub preset_dir: PathBuf,
    pub ui_dir: PathBuf,
    pub shutdown: Option<watch::Receiver<bool>>,
}

#[derive(Debug)]
struct Shared {
    control: Mutex<Control>,
    native: Mutex<Option<native_editor::Worker>>,
    presets: Arc<std::sync::Mutex<oxidal_presets::Store>>,
    events: watch::Sender<Snapshot>,
    config: Config,
}

/// Builds the same router used by the native binary and network integration tests.
/// @see docs/architecture.md
pub fn router(config: Config) -> Result<Router, String> {
    let mut control = Control::default();
    match std::fs::read(&config.mapping_path) {
        Ok(bytes) => {
            if bytes.len() > 65536 {
                return Err("Mapping file exceeds 64 KiB".into());
            }
            let file: MappingFile =
                serde_json::from_slice(&bytes).map_err(|e| format!("Invalid mapping file: {e}"))?;
            control.apply(
                Command {
                    session: control.snapshot().session,
                    protocol: 1,
                    request_id: "restore-mappings".into(),
                    expected_revision: Some(0),
                    action: Action::Mappings { file },
                },
                true,
            )?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(format!("Cannot read mapping file: {e}")),
    }
    let (events, _) = watch::channel(control.snapshot());
    let ui = ServeDir::new(&config.ui_dir)
        .not_found_service(ServeFile::new(config.ui_dir.join("index.html")));
    let shared = Arc::new(Shared {
        control: Mutex::new(control),
        native: Mutex::new(native_editor::Worker::start(&config)?),
        presets: Arc::new(std::sync::Mutex::new(oxidal_presets::Store::new(
            config.preset_dir.clone(),
        ))),
        events,
        config,
    });
    let weak = Arc::downgrade(&shared);
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            timer.tick().await;
            let Some(shared) = weak.upgrade() else {
                break;
            };
            let mut control = shared.control.lock().await;
            if let Some(state) = control.expire_edit(std::time::Instant::now()) {
                shared.events.send_replace(state);
            }
        }
    });
    let api = Router::new()
        .route("/health", get(health))
        .route(
            "/native",
            get(native_editor::state).post(native_editor::command),
        )
        .route(
            "/presets",
            get(presets::list)
                .post(presets::import)
                .layer(DefaultBodyLimit::max(oxidal_presets::MAX_FILE_BYTES)),
        )
        .route("/presets/{id}/original", get(presets::original))
        .route("/state", get(snapshot))
        .route("/commands", post(command))
        .route("/rig/validate", post(validate))
        .route("/events", get(state_events))
        .fallback(|| async { failure(StatusCode::NOT_FOUND, "not_found") });
    Ok(Router::new()
        .nest("/api/v1", api)
        .fallback_service(ui)
        .layer(DefaultBodyLimit::max(65536))
        .layer(middleware::from_fn(local_origin))
        .with_state(shared))
}

async fn local_origin(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let local = |host: &str| {
        host == "localhost"
            || host == "127.0.0.1"
            || host == "[::1]"
            || host.starts_with("localhost:")
            || host.starts_with("127.0.0.1:")
            || host.starts_with("[::1]:")
    };
    if !local(host) {
        return failure(StatusCode::FORBIDDEN, "local_host_required");
    }
    if let Some(origin) = request.headers().get("origin") {
        let allowed = origin
            .to_str()
            .ok()
            .and_then(|o| o.strip_prefix("http://"))
            .is_some_and(|o| !o.contains('/') && local(o));
        if !allowed {
            return failure(StatusCode::FORBIDDEN, "origin_rejected");
        }
    }
    next.run(request).await
}
fn failure(status: StatusCode, error: &str) -> Response {
    (
        status,
        Json(ApiError {
            error: error.into(),
        }),
    )
        .into_response()
}
async fn health(State(shared): State<Arc<Shared>>) -> Json<Capabilities> {
    Json(Capabilities {
        protocol: 1,
        version: env!("CARGO_PKG_VERSION").into(),
        audio_available: false,
        native_editor: shared.native.lock().await.is_some(),
        midi_transport: if shared.config.simulator {
            "simulator"
        } else {
            "disabled"
        }
        .into(),
    })
}
async fn snapshot(State(shared): State<Arc<Shared>>) -> Json<Snapshot> {
    Json(shared.control.lock().await.snapshot())
}
async fn validate(body: Result<Json<Rig>, JsonRejection>) -> Response {
    match body {
        Ok(Json(rig)) => Json(rig.validate()).into_response(),
        Err(e) => failure(e.status(), "invalid_json"),
    }
}
async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Command>, JsonRejection>,
) -> Response {
    let command = match body {
        Ok(Json(c)) => c,
        Err(e) => return failure(e.status(), "invalid_json"),
    };
    let persist = matches!(command.action, Action::Mappings { .. });
    let mut control = shared.control.lock().await;
    if let Some(state) = control.expire_edit(std::time::Instant::now()) {
        shared.events.send_replace(state);
    }
    let mut candidate = control.clone();
    match candidate.apply(command, shared.config.simulator) {
        Ok(state) => {
            if persist {
                // Atomic visibility; full power-loss durability remains appliance qualification work.
                let path = &shared.config.mapping_path;
                let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let temporary = path.with_extension("json.tmp");
                    let bytes = serde_json::to_vec_pretty(&state.mappings)?;
                    std::fs::write(&temporary, bytes)?;
                    std::fs::rename(temporary, path)?;
                    Ok(())
                })();
                if result.is_err() {
                    return failure(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "mapping_persistence_failed",
                    );
                }
            }
            let changed = control.snapshot().revision != state.revision;
            *control = candidate;
            if changed {
                shared.events.send_replace(state.clone());
            }
            Json(state).into_response()
        }
        Err(e) => failure(
            if e == "revision_conflict" || e == "session_conflict" || e.starts_with("edit_") {
                StatusCode::CONFLICT
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            &e,
        ),
    }
}
async fn state_events(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let mut receiver = shared.events.subscribe();
    let mut shutdown = shared.config.shutdown.clone();
    let stream = async_stream::stream! {
        loop {
            let snapshot=receiver.borrow_and_update().clone();
            let event=Event::default().event("state").id(snapshot.revision.to_string()).json_data(snapshot).expect("finite validated snapshot");
            yield Ok::<Event,Infallible>(event);
            tokio::select! {
                changed = receiver.changed() => { if changed.is_err() { break; } },
                _ = async {
                    match shutdown.as_mut() {
                        Some(signal) => { let _ = signal.changed().await; },
                        None => std::future::pending::<()>().await,
                    }
                } => break,
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
}

/// Enforces the PoC's loopback boundary before starting a listener.
/// @see docs/architecture.md
pub fn validate_address(address: SocketAddr) -> Result<SocketAddr, String> {
    if !address.ip().is_loopback() {
        return Err("PoC listens on loopback only; LAN authorization is not implemented".into());
    }
    Ok(address)
}
