mod artwork;
mod audio;
mod audio_boot;
mod audit;
mod backup;
mod blends;
mod boosts;
mod calibration;
mod debug;
mod device;
mod graph_playback;
mod guitars;
mod levels;
mod library_removal;
mod local_models;
mod midi_map;
mod midi_recall;
mod monitor;
mod monitor_history;
mod native_defaults;
mod native_editor;
mod packs;
mod playback;
mod playback_recovery;
mod plugins;
mod presets;
pub mod protect;
mod provider;
mod rig_library;
mod rig_playback;
mod rig_recovery;
mod storage_lock;
mod terminal;
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
    pub removal_preview: oxidal_presets::RemovalPreview,
    pub protect_state: protect::ProtectState,
    pub startup_state: audio_boot::StartupState,
    pub startup_update: audio_boot::StartupUpdate,
    pub model_removal_preview: oxidal_presets::ModelRemovalPreview,
    pub model_removal_request: oxidal_presets::ModelRemovalRequest,
    pub model_removal_result: oxidal_presets::ModelRemovalResult,
    pub removal_request: oxidal_presets::RemovalRequest,
    pub removal_result: oxidal_presets::RemovalResult,
    pub local_model: local_models::LocalModel,
    pub local_model_page: local_models::LocalModelPage,
    pub native_defaults: oxidal_tone3000::preferences::Snapshot,
    pub native_defaults_update: oxidal_tone3000::preferences::Update,
    pub rig_document: rig_library::RigDocument,
    pub rig_library: rig_library::RigPage,
    pub rig_publish: rig_library::RigPublish,
    pub rig_native_sources: Vec<rig_library::RigNativeSource>,
    pub lv2_catalog: oxidal_lv2::PluginCatalog,
    pub graph_presets: Vec<oxidal_presets::SavedGraph>,
    pub stage_model: provider::download::StageModel,
    pub staged_model: provider::download::StagedModel,
    pub tone_page: provider::catalog::Page<provider::catalog::Tone>,
    pub model_page: provider::catalog::Page<provider::catalog::Model>,
    pub tone_query: provider::catalog::ToneQuery,
    pub model_query: provider::catalog::ModelQuery,
    pub account_state: provider::AccountState,
    pub account_command: provider::AccountCommand,
    pub snapshot: Snapshot,
    pub command: Command,
    pub rig: Rig,
    pub validation: Validation,
    pub capabilities: Capabilities,
    pub terminal_state: oxidal_debug::terminal::State,
    pub terminal_command: oxidal_debug::terminal::Command,
    pub debug_state: oxidal_debug::State,
    pub debug_command: oxidal_debug::Command,
    pub monitoring: monitor::Monitoring,
    pub monitoring_history: monitor_history::History,
    pub control_audit: audit::AuditHistory,
    pub network_state: oxidal_device::NetworkState,
    pub network_command: oxidal_device::Command,
    pub effect_packs: oxidal_device::packs::PackState,
    pub storage_state: oxidal_device::storage::StorageState,
    pub storage_request: storage_lock::StorageRequest,
    pub audio_state: oxidal_audio::lifecycle::AudioState,
    pub rig_audio_state: oxidal_engine::protocol::RigAudioState,
    pub rig_audio_command: oxidal_engine::protocol::RigAudioCommand,
    pub graph_audio_state: oxidal_lv2::protocol::GraphAudioState,
    pub graph_audio_command: oxidal_lv2::protocol::GraphAudioCommand,
    pub audio_command: oxidal_audio::lifecycle::AudioCommand,
    pub audio_devices: oxidal_audio::AudioDevices,
    pub unit_levels: oxidal_audio::tools::HostLevels,
    pub guitars: guitars::Guitars,
    pub boosts: boosts::BoostState,
    pub boost_update: boosts::BoostUpdate,
    pub calibration: calibration::CalibrationState,
    pub calibration_coverage: calibration::CalibrationCoverage,
    pub scene_blends: blends::Blends,
    pub scene_blend_update: blends::BlendUpdate,
    pub voice_request: provider::voice::VoiceRequest,
    pub voice_ready: provider::voice::VoiceReady,
    pub voice_list: provider::voice::VoiceList,
    pub calibration_command: calibration::CalibrationCommand,
    pub midi_devices: oxidal_audio::midi::Devices,
    pub midi_map: oxidal_presets::MidiMap,
    pub midi_map_update: oxidal_presets::MidiMapUpdate,
    pub midi_template_apply: midi_map::MidiTemplateApply,
    pub midi_test: midi_map::MidiTest,
    pub audio_probe: oxidal_audio::AudioProbe,
    pub audio_probe_result: oxidal_audio::AudioProbeResult,
    pub error: ApiError,
    pub preset_details: oxidal_presets::DetailsCatalog,
    pub preset_details_update: oxidal_presets::DetailsUpdate,
    pub library_catalog: oxidal_presets::LibraryCatalog,
    pub library_update: oxidal_presets::LibraryUpdate,
    pub library: oxidal_presets::Library,
    pub preset: oxidal_presets::Inspection,
    pub artwork: Vec<artwork::AssetArtwork>,
    pub native_editor: oxidal_tone3000::protocol::EditorSnapshot,
    pub native_command: oxidal_tone3000::protocol::EditorCommand,
}

/// Local-only service settings. LAN access requires separate pairing/security design.
/// @see docs/architecture.md
#[derive(Debug, Clone)]
pub struct Config {
    pub debug_socket: Option<PathBuf>,
    pub device_socket: Option<PathBuf>,
    pub simulator: bool,
    pub native_worker: Option<PathBuf>,
    pub audio_worker: Option<PathBuf>,
    pub graph_worker: Option<PathBuf>,
    pub rig_worker: Option<PathBuf>,
    pub mapping_path: PathBuf,
    pub preset_dir: PathBuf,
    pub ui_dir: PathBuf,
    pub shutdown: Option<watch::Receiver<bool>>,
}

#[derive(Debug)]
struct Shared {
    boot: Arc<audio_boot::Policy>,
    account: provider::Account,
    artwork_work: Arc<tokio::sync::Semaphore>,
    bundle_work: Arc<tokio::sync::Semaphore>,
    catalog_work: Arc<tokio::sync::Semaphore>,
    library_access: Arc<tokio::sync::RwLock<()>>,
    debug: debug::DebugBridge,
    monitor: watch::Receiver<monitor::Monitoring>,
    history: Arc<monitor_history::Journal>,
    audit: audit::Audit,
    playback: playback::Playback,
    graph_playback: graph_playback::GraphPlayback,
    levels: Arc<levels::Levels>,
    midi_map: Arc<oxidal_presets::MidiMapStore>,
    guitars: Arc<guitars::Store>,
    boosts: Arc<boosts::Store>,
    blends: Arc<blends::Store>,
    calibration: Arc<calibration::Store>,
    rig_playback: rig_playback::RigPlayback,
    control: Mutex<Control>,
    native: Arc<Mutex<Option<native_editor::Worker>>>,
    presets: Arc<std::sync::Mutex<oxidal_presets::Store>>,
    events: watch::Sender<Snapshot>,
    protect: protect::Protect,
    config: Config,
}

/// Builds the same router used by the native binary and network integration tests.
/// @see docs/architecture.md
pub fn router(config: Config) -> Result<Router, String> {
    router_with_shutdown(config).map(|(router, _)| router)
}

/// Completion handles outlive HTTP serving so daemon shutdown reaps audio workers first.
#[derive(Debug)]
pub struct WorkersStopped {
    audio: watch::Receiver<bool>,
    graph: watch::Receiver<bool>,
    rig: watch::Receiver<bool>,
}
impl WorkersStopped {
    pub async fn wait(mut self) -> Result<(), String> {
        for done in [&mut self.audio, &mut self.graph, &mut self.rig] {
            done.wait_for(|v| *v)
                .await
                .map_err(|_| "Playback owner exited without cleanup acknowledgement")?;
        }
        Ok(())
    }
}
pub fn router_with_shutdown(config: Config) -> Result<(Router, WorkersStopped), String> {
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
    let ui = Router::new()
        .fallback_service(
            ServeDir::new(&config.ui_dir)
                .not_found_service(ServeFile::new(config.ui_dir.join("index.html"))),
        )
        .layer(middleware::from_fn(ui_cache));
    let (monitor_updates, monitor) = watch::channel(monitor::Monitoring::default());
    oxidal_presets::RemovalStore::new(config.preset_dir.clone())
        .recover()
        .map_err(|e| format!("Cannot recover interrupted preset removal: {e}"))?;
    let library_access = Arc::new(tokio::sync::RwLock::new(()));
    let boot = Arc::new(audio_boot::Policy::new(
        config.preset_dir.join("boot-audio.json"),
    ));
    let levels = Arc::new(levels::Levels::load(
        config.preset_dir.join("unit-levels.json"),
    ));
    let midi_map = Arc::new(oxidal_presets::MidiMapStore::new(config.preset_dir.clone()));
    let (midi_events, midi_event_rx) = tokio::sync::mpsc::channel(32);
    let shared = Arc::new(Shared {
        protect: protect::Protect::new(config.preset_dir.join("protect.json")),
        boot: boot.clone(),
        account: provider::Account::new(
            config.preset_dir.join("accounts"),
            config.shutdown.clone(),
        )?,
        artwork_work: Arc::new(tokio::sync::Semaphore::new(1)),
        bundle_work: Arc::new(tokio::sync::Semaphore::new(1)),
        catalog_work: Arc::new(tokio::sync::Semaphore::new(1)),
        debug: debug::DebugBridge::new(config.debug_socket.clone()),
        history: Arc::new(monitor_history::Journal::new(
            config.preset_dir.join("monitor-history"),
        )),
        audit: audit::Audit::new(config.preset_dir.join("control-audit")),
        monitor,
        playback: playback::Playback::new(
            &config,
            boot.clone(),
            levels.clone(),
            library_access.clone(),
            midi_map.clone(),
            midi_events.clone(),
        )?,
        graph_playback: graph_playback::GraphPlayback::new(
            &config,
            boot.clone(),
            levels.clone(),
            library_access.clone(),
        )?,
        rig_playback: rig_playback::RigPlayback::new(
            &config,
            boot,
            levels.clone(),
            library_access.clone(),
            midi_map.clone(),
            midi_events,
        )?,
        levels,
        midi_map,
        library_access,
        guitars: Arc::new(guitars::Store::load(config.preset_dir.join("guitars.json"))),
        boosts: Arc::new(boosts::Store::load(config.preset_dir.join("boosts.json"))),
        blends: Arc::new(blends::Store::load(config.preset_dir.join("blends.json"))),
        calibration: Arc::new(calibration::Store::load(
            config.preset_dir.join("calibration.json"),
        )),
        control: Mutex::new(control),
        native: Arc::new(Mutex::new(native_editor::Worker::start(&config)?)),
        presets: Arc::new(std::sync::Mutex::new(oxidal_presets::Store::new(
            config.preset_dir.clone(),
        ))),
        events,
        config,
    });
    monitor::start(Arc::downgrade(&shared), monitor_updates);
    monitor_history::start(Arc::downgrade(&shared));
    midi_recall::start(Arc::downgrade(&shared), midi_event_rx);
    let stopped = WorkersStopped {
        audio: shared.playback.finished.clone(),
        graph: shared.graph_playback.finished.clone(),
        rig: shared.rig_playback.finished.clone(),
    };
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
            "/account/tone3000",
            get(provider::state).post(provider::command),
        )
        .route(
            "/models/local",
            get(local_models::list)
                .post(local_models::upload)
                .layer(DefaultBodyLimit::max(oxidal_presets::MAX_FILE_BYTES)),
        )
        .route("/models/local/collection", post(local_models::collection))
        .route(
            "/models/local/removal",
            get(library_removal::preview_model).post(library_removal::remove_model),
        )
        .route("/tone3000/stage", post(provider::download::stage))
        .route(
            "/tone3000/voice",
            get(provider::voice::list).post(provider::voice::create),
        )
        .route("/tone3000/tones", get(provider::catalog::tones))
        .route("/tone3000/tones/{id}", get(provider::catalog::tone))
        .route(
            "/tone3000/tones/{id}/image",
            get(provider::images::tone_image),
        )
        .route("/tone3000/models", get(provider::catalog::models))
        .route("/monitor", get(monitor::state))
        .route("/audit", get(audit::history))
        .route("/audit/export", get(audit::export))
        .route("/backup/library", get(backup::library))
        .route("/monitor/history", get(monitor_history::state))
        .route("/monitor/history/export", get(monitor_history::export))
        .route("/monitor/events", get(monitor::events))
        .route("/debug", get(debug::state).post(debug::command))
        .route("/debug/logs", get(debug::logs))
        .route("/terminal/{mode}", post(terminal::command))
        .route("/device/network", get(device::state).post(device::command))
        .route(
            "/device/storage",
            get(storage_lock::state).post(storage_lock::change),
        )
        .route("/packs", get(packs::state))
        .route("/packs/{id}/{action}", post(packs::change))
        .route("/audio", get(playback::state).post(playback::command))
        .route("/levels", get(levels::state).post(levels::update))
        .route("/protect", get(protect::state).post(protect::update))
        .route(
            "/startup",
            get(audio_boot::startup).post(audio_boot::set_startup),
        )
        .route("/guitars", get(guitars::state).post(guitars::update))
        .route("/boosts", get(boosts::state).post(boosts::update))
        .route("/scene-blends", get(blends::state).post(blends::update))
        .route(
            "/calibration",
            get(calibration::state).post(calibration::command),
        )
        .route("/calibration/coverage", get(calibration::coverage))
        .route(
            "/native/defaults",
            get(native_defaults::state).post(native_defaults::update),
        )
        .route(
            "/graph-audio",
            get(graph_playback::state).post(graph_playback::command),
        )
        .route(
            "/rig-audio",
            get(rig_playback::state)
                .post(rig_playback::command)
                .layer(DefaultBodyLimit::max(
                    oxidal_engine::protocol::REQUEST_LIMIT,
                )),
        )
        .route("/plugins/lv2", get(plugins::catalog))
        .route("/presets/rig-sources", get(rig_library::native_sources))
        .route("/presets/graphs", get(presets::graphs))
        .route(
            "/presets/rigs",
            get(rig_library::list)
                .post(rig_library::publish)
                .layer(DefaultBodyLimit::max(rig_library::PUBLISH_LIMIT)),
        )
        .route("/presets/rigs/{revision}", get(rig_library::read))
        .route("/audio/devices", get(audio::devices))
        .route("/midi/devices", get(audio::midi_devices))
        .route("/midi/map", get(midi_map::state).post(midi_map::replace))
        .route("/midi/template", post(midi_map::apply_template))
        .route("/midi/test", post(midi_map::test))
        .route("/audio/probe", post(audio::probe))
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
        .route(
            "/presets/removal",
            get(library_removal::preview).post(library_removal::remove),
        )
        .route(
            "/presets/catalog",
            get(presets::catalog).post(presets::manage),
        )
        .route(
            "/presets/details",
            get(presets::details)
                .post(presets::edit_details)
                .layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .route("/presets/{id}/original", get(presets::original))
        .route("/presets/owned/{id}/download", get(presets::owned_download))
        .route("/models/{id}/artwork", get(artwork::model_list))
        .route(
            "/models/{id}/artwork/{key}",
            get(artwork::model_read).post(artwork::model_download),
        )
        .route("/presets/{id}/artwork", get(artwork::list))
        .route(
            "/presets/{id}/artwork/{key}",
            get(artwork::read).post(artwork::download),
        )
        .route("/state", get(snapshot))
        .route("/commands", post(command))
        .route("/rig/validate", post(validate))
        .route("/events", get(state_events))
        .fallback(|| async { failure(StatusCode::NOT_FOUND, "not_found") });
    Ok((
        Router::new()
            .nest("/api/v1", api)
            .fallback_service(ui)
            .layer(DefaultBodyLimit::max(65536))
            .layer(middleware::from_fn(local_origin))
            .layer(middleware::from_fn_with_state(
                shared.clone(),
                audit::capture,
            ))
            .with_state(shared),
        stopped,
    ))
}

/// Hashed bundles never change, so they may be cached forever; the page and
/// every app route must revalidate so a deployed UI replaces the old bundle.
async fn ui_cache(request: Request, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/assets/");
    let mut response = next.run(request).await;
    // Client routes are served the page through ServeDir's 404 fallback.
    if response.status().is_success() || (!immutable && response.status() == StatusCode::NOT_FOUND)
    {
        response.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static(if immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            }),
        );
    }
    response
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
        } else if cfg!(all(target_os = "linux", feature = "alsa"))
            && shared.config.rig_worker.is_some()
        {
            "alsa-raw-midi-scenes"
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
