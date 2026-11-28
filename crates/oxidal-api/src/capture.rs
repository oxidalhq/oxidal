//! Record DI and reamp jobs. One job at a time, owned by the daemon so a
//! closed browser never stops or duplicates it; reconnecting shows the same
//! job. A reamp runs through the rig that is playing now and locks it: recall,
//! scene changes, edits and calibration are refused until the job ends. The
//! worker writes the audio; this service turns the finished file into a `di`
//! or `reamp` asset with source details, keeping a partial result if the disk
//! failed.
//! @see docs/media.md
use crate::media::{MediaError, MediaKind, MediaManifest, MediaPlayback, MediaRender, SCHEMA};
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::backing::MediaId;
use oxidal_audio::capture::{CaptureCommand, CaptureFault, CaptureKind, CaptureStatus};
use oxidal_audio::tools::HostUtility;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, watch};

pub(crate) const REAMP_LOCKED: &str = "Reamp in progress. Stop it to change the rig.";
const TAIL_RANGE: (f64, f64) = (0.0, 10.0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobPhase {
    /// Accepted; waiting for the worker to start writing.
    Starting,
    Running,
    /// Stopped; the file is being finished.
    Finishing,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureJob {
    /// Also the ID of the asset it produces.
    pub id: String,
    pub kind: CaptureKind,
    pub phase: JobPhase,
    pub title: String,
    pub rate: u32,
    pub frames: u64,
    /// Reamp only: frames the job will write in total.
    pub total_frames: Option<u64>,
    pub source: Option<String>,
    pub peak_dbfs: f32,
    pub monitoring: bool,
    /// The saved asset, once there is one.
    pub asset: Option<String>,
    /// The result is shorter than intended (stopped early or a fault).
    pub incomplete: bool,
    pub lost_samples: u64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureState {
    pub revision: u64,
    pub job: Option<CaptureJob>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InputProcessing {
    /// The unit's current input trim and gate (the guitar profile in use).
    Current,
    /// Neither: the DI is already level-matched.
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReampRequest {
    pub source: String,
    /// For a stereo DI: 0 left, 1 right.
    #[serde(default)]
    pub channel: u16,
    /// No default: the user must choose (calibration applied once).
    pub processing: InputProcessing,
    #[serde(default = "default_tail")]
    pub tail_seconds: f64,
    #[serde(default)]
    pub monitoring: bool,
}
fn default_tail() -> f64 {
    2.0
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopRequest {
    /// Keep what was written (Stop and keep) or discard it (Cancel).
    pub keep: bool,
}

#[derive(Debug)]
struct Running {
    job: CaptureJob,
    seq: u32,
    provenance: serde_json::Value,
    started: Instant,
    seen: bool,
    stop_requested: Option<bool>,
}

#[derive(Debug, Default)]
struct Inner {
    revision: u64,
    running: Option<Running>,
    last: Option<CaptureJob>,
    seq: u32,
}

#[derive(Debug)]
pub struct Captures {
    inner: Mutex<Inner>,
    events: watch::Sender<CaptureState>,
    /// A reamp holds the rig; read synchronously by Protect and MIDI.
    reamping: Arc<AtomicBool>,
}

impl Captures {
    /// `reamping` is Protect's job flag, so a running reamp locks the rig.
    pub fn new(reamping: Arc<AtomicBool>) -> Self {
        let (events, _) = watch::channel(CaptureState {
            revision: 0,
            job: None,
        });
        Self {
            inner: Mutex::new(Inner::default()),
            events,
            reamping,
        }
    }
}

type Refusal = (StatusCode, String);

impl Inner {
    fn state(&self) -> CaptureState {
        CaptureState {
            revision: self.revision,
            job: self
                .running
                .as_ref()
                .map(|r| r.job.clone())
                .or_else(|| self.last.clone()),
        }
    }
}

impl Captures {
    pub fn reamping(&self) -> bool {
        self.reamping.load(Ordering::SeqCst)
    }
    /// Any job (recording or reamp) is running.
    pub async fn busy(&self) -> bool {
        self.inner.lock().await.running.is_some()
    }
    pub fn subscribe(&self) -> watch::Receiver<CaptureState> {
        self.events.subscribe()
    }
    fn publish(&self, inner: &mut Inner) {
        inner.revision += 1;
        self.reamping.store(
            inner
                .running
                .as_ref()
                .is_some_and(|r| r.job.kind == CaptureKind::Reamp),
            Ordering::SeqCst,
        );
        self.events.send_replace(inner.state());
    }
}

fn store(shared: &Shared) -> Result<Arc<crate::media::Store>, Refusal> {
    shared.media.as_ref().map(Arc::clone).map_err(|reason| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Media storage is unavailable: {reason}"),
        )
    })
}

/// The capture status the running worker reports, and its stream.
fn worker_capture(shared: &Shared) -> (bool, Option<CaptureStatus>) {
    use oxidal_audio::lifecycle::AudioPhase;
    let native = shared.playback.snapshot();
    let graph = shared.graph_playback.snapshot();
    let rig = shared.rig_playback.snapshot();
    let capture = |t: Option<oxidal_audio::meter::Snapshot>| {
        t.and_then(|t| t.monitoring).and_then(|h| h.capture)
    };
    if native.phase == AudioPhase::Running {
        (true, capture(shared.playback.telemetry().map(|t| t.0)))
    } else if graph.phase == AudioPhase::Running {
        (true, capture(graph.telemetry))
    } else if rig.phase == AudioPhase::Running {
        (true, capture(rig.telemetry))
    } else {
        (false, None)
    }
}

/// What is playing now, recorded with the captured asset.
fn rig_identity(shared: &Shared) -> serde_json::Value {
    use oxidal_audio::lifecycle::AudioPhase;
    let native = shared.playback.snapshot();
    let graph = shared.graph_playback.snapshot();
    let rig = shared.rig_playback.snapshot();
    if native.phase == AudioPhase::Running {
        serde_json::json!({
            "owner": "native",
            "preset_id": native.configured.as_ref().map(|c| c.preset_id.clone()),
            "session_revision": native.revision,
        })
    } else if rig.phase == AudioPhase::Running {
        serde_json::json!({
            "owner": "mixed",
            "rig_revision": rig.configured.as_ref().map(|c| c.revision.clone()),
            "scene": rig.control.as_ref().and_then(|c| c.scene.clone()),
            "session_revision": rig.revision,
        })
    } else {
        serde_json::json!({
            "owner": "effects",
            "library_id": graph.configured.as_ref().and_then(|c| c.library_id.clone()),
            "name": graph.configured.as_ref().and_then(|c| c.name.clone()),
            "session_revision": graph.revision,
        })
    }
}

fn levels_json(shared: &Shared) -> serde_json::Value {
    let levels = shared.levels.current();
    let guitars = shared.guitars.current();
    let profile = guitars
        .active
        .as_ref()
        .and_then(|id| guitars.guitars.iter().find(|g| &g.id == id))
        .map(|g| g.name.clone());
    serde_json::json!({
        "guitar_profile": profile,
        "input_trim_db": levels.input_trim_db,
        "gate_db": levels.gate_db,
    })
}

fn stream_info(shared: &Shared) -> Option<(u32, u32)> {
    let monitoring = shared.monitor.borrow();
    monitoring
        .stream
        .as_ref()
        .map(|s| (s.input.sample_rate, s.input.period_frames))
}

async fn start(
    shared: &Shared,
    kind: CaptureKind,
    reamp: Option<ReampRequest>,
) -> Result<CaptureState, Refusal> {
    let _operation = shared
        .audio_change
        .operation()
        .map_err(|error| (StatusCode::CONFLICT, error.to_owned()))?;

    if let Some(reason) = shared.protect.refuse(false) {
        return Err((StatusCode::LOCKED, reason.into()));
    }
    let store = store(shared)?;
    let captures = &shared.captures;
    let mut inner = captures.inner.lock().await;
    if inner.running.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "A recording or reamp is already in progress".into(),
        ));
    }
    let (running, _) = worker_capture(shared);
    let Some((rate, period)) = stream_info(shared).filter(|_| running) else {
        return Err((StatusCode::CONFLICT, "Start the audio first".into()));
    };
    let id = crate::media::new_id();
    let output = MediaId::parse(&id).expect("generated IDs are valid");
    inner.seq = inner.seq.wrapping_add(1);
    let seq = inner.seq;
    let (command, job, provenance) = match (kind, reamp) {
        (CaptureKind::Di, _) => {
            // The raw input needs the audio thread's R0 tap: room for a while.
            store
                .admit(u64::from(rate) * 4 * 60)
                .map_err(media_refusal)?;
            let now = crate::media::now_iso();
            let title = format!("DI {}", &now[..16].replace('T', " "));
            (
                CaptureCommand::RecordDi { output, seq },
                CaptureJob {
                    id: id.clone(),
                    kind,
                    phase: JobPhase::Starting,
                    title,
                    rate,
                    frames: 0,
                    total_frames: None,
                    source: None,
                    peak_dbfs: -120.0,
                    monitoring: true,
                    asset: None,
                    incomplete: false,
                    lost_samples: 0,
                    reason: None,
                },
                serde_json::json!({
                    "kind": "record_di",
                    "input": levels_json(shared),
                    "stream": { "rate": rate, "period_frames": period },
                    "oxidal": env!("CARGO_PKG_VERSION"),
                }),
            )
        }
        (CaptureKind::Reamp, Some(request)) => {
            if shared.player.playing().await {
                return Err((StatusCode::CONFLICT, "Stop the backing track first".into()));
            }
            if !(TAIL_RANGE.0..=TAIL_RANGE.1).contains(&request.tail_seconds) {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Tail must be 0–10 s".into(),
                ));
            }
            let manifest = store.manifest(&request.source).map_err(media_refusal)?;
            if manifest.kind == MediaKind::Backing {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Choose a DI recording to reamp".into(),
                ));
            }
            let render = manifest.render(rate).ok_or((
                StatusCode::CONFLICT,
                "This DI is not prepared for the running audio rate".to_owned(),
            ))?;
            if request.channel >= render.channels {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Choose Left or Right".into(),
                ));
            }
            let tail = (request.tail_seconds * f64::from(rate)).round() as u64;
            let total = render.frames + tail;
            store.admit(total * 8).map_err(media_refusal)?;
            let rig = rig_identity(shared);
            let source = MediaId::parse(&manifest.id).expect("stored IDs are valid");
            (
                CaptureCommand::Reamp {
                    source,
                    channels: render.channels,
                    channel: request.channel,
                    frames: render.frames,
                    trim_and_gate: request.processing == InputProcessing::Current,
                    output,
                    tail_frames: tail,
                    latency_frames: 0,
                    monitoring: request.monitoring,
                    seq,
                },
                CaptureJob {
                    id: id.clone(),
                    kind,
                    phase: JobPhase::Starting,
                    title: format!("{} (reamp)", manifest.title)
                        .chars()
                        .take(120)
                        .collect(),
                    rate,
                    frames: 0,
                    total_frames: Some(total),
                    source: Some(manifest.id.clone()),
                    peak_dbfs: -120.0,
                    monitoring: request.monitoring,
                    asset: None,
                    incomplete: false,
                    lost_samples: 0,
                    reason: None,
                },
                serde_json::json!({
                    "kind": "reamp",
                    "source": { "id": manifest.id, "sha256": render.sha256, "channel": request.channel, "lossy": manifest.source.as_ref().is_some_and(|s| s.lossy) },
                    "processing": request.processing,
                    "input": if request.processing == InputProcessing::Current { levels_json(shared) } else { serde_json::Value::Null },
                    "rig": rig,
                    "tail_seconds": request.tail_seconds,
                    // The rig output is captured in the same block as its input.
                    "latency_frames": 0,
                    "stream": { "rate": rate, "period_frames": period },
                    "oxidal": env!("CARGO_PKG_VERSION"),
                }),
            )
        }
        (CaptureKind::Reamp, None) => unreachable!("reamp requests carry their settings"),
    };
    crate::player::send_utility(shared, HostUtility::Capture { command }).await?;
    inner.running = Some(Running {
        job,
        seq,
        provenance,
        started: Instant::now(),
        seen: false,
        stop_requested: None,
    });
    captures.publish(&mut inner);
    Ok(inner.state())
}

fn media_refusal(error: MediaError) -> Refusal {
    match error {
        MediaError::NotFound => (
            StatusCode::NOT_FOUND,
            "That file is no longer in Library".into(),
        ),
        MediaError::NoSpace(space) => (
            StatusCode::INSUFFICIENT_STORAGE,
            format!(
                "No space: {} MB free, {} MB kept in reserve",
                space.available_bytes / 1_000_000,
                space.reserve_bytes / 1_000_000
            ),
        ),
        MediaError::Invalid(reason) => (StatusCode::UNPROCESSABLE_ENTITY, reason),
        MediaError::Leased => (StatusCode::CONFLICT, "That file is in use".into()),
        MediaError::Io(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Media storage failed".into(),
        ),
    }
}

/// Moves the worker's finished capture file into a new asset.
fn finalize(
    store: &crate::media::Store,
    job: &CaptureJob,
    provenance: serde_json::Value,
) -> Result<MediaManifest, MediaError> {
    let output = MediaId::parse(&job.id).expect("job IDs are valid");
    let capture = oxidal_audio::capture::capture_path(store.root(), output);
    let channels: u16 = if job.kind == CaptureKind::Di { 1 } else { 2 };
    let bytes = std::fs::metadata(&capture)?.len();
    let frames = bytes / (u64::from(channels) * 4);
    if frames == 0 {
        let _ = std::fs::remove_file(&capture);
        return Err(MediaError::Invalid("Nothing was recorded".into()));
    }
    let staging = store.stage_as(&job.id)?;
    let name = format!("play-{}.f32", job.rate);
    let target = staging.file(&name)?;
    std::fs::rename(&capture, &target)?;
    // Drop a torn final sample, if any.
    std::fs::OpenOptions::new()
        .write(true)
        .open(&target)?
        .set_len(frames * u64::from(channels) * 4)?;
    let sha256 = crate::media_import::hash_file(&target)?;
    let manifest = MediaManifest {
        schema: SCHEMA,
        id: job.id.clone(),
        kind: if job.kind == CaptureKind::Di {
            MediaKind::Di
        } else {
            MediaKind::Reamp
        },
        title: job.title.clone(),
        created_at: crate::media::now_iso(),
        source: None,
        renders: vec![MediaRender {
            file: name,
            rate: job.rate,
            channels,
            frames,
            sha256,
            resampler: None,
            peak_dbfs: None,
            loudness_lufs: None,
        }],
        playback: MediaPlayback { trim_db: 0.0 },
        provenance: Some(provenance),
    };
    store.finalize(staging, &manifest)?;
    Ok(manifest)
}

/// Follows the running job in the worker and finishes it.
pub(crate) fn follow(shared: Weak<Shared>) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let captures = &shared.captures;
            let mut inner = captures.inner.lock().await;
            let Some(running) = &mut inner.running else {
                continue;
            };
            let (audio, status) = worker_capture(&shared);
            let status = status.filter(|s| s.seq == running.seq);
            let mut changed = false;
            let mut end: Option<(JobPhase, Option<String>)> = None;
            match status {
                Some(status) => {
                    running.seen = true;
                    if running.job.phase == JobPhase::Starting && status.running {
                        running.job.phase = JobPhase::Running;
                        changed = true;
                    }
                    if status.frames != running.job.frames
                        || (status.peak_dbfs - running.job.peak_dbfs).abs() > 0.5
                    {
                        running.job.frames = status.frames;
                        running.job.peak_dbfs = status.peak_dbfs;
                        changed = true;
                    }
                    running.job.lost_samples = status.lost;
                    if !status.running && running.job.phase == JobPhase::Running {
                        running.job.phase = JobPhase::Finishing;
                        changed = true;
                    }
                    if status.finished
                        || (!status.running && status.fault == Some(CaptureFault::Source))
                    {
                        end = Some(match (status.discarded, status.fault) {
                            (true, Some(CaptureFault::Source)) => (
                                JobPhase::Failed,
                                Some("The DI file could not be read".into()),
                            ),
                            (true, _) => (JobPhase::Cancelled, None),
                            (false, Some(CaptureFault::Disk)) => (
                                JobPhase::Failed,
                                Some(
                                    "The disk filled or failed; the part before it is kept".into(),
                                ),
                            ),
                            (false, Some(CaptureFault::Overflow)) => (
                                JobPhase::Done,
                                Some("Some audio was lost while writing".into()),
                            ),
                            _ => (JobPhase::Done, None),
                        });
                    }
                }
                None if !audio && running.seen => {
                    end = Some((
                        JobPhase::Failed,
                        Some("The audio stopped during the job; the part before it is kept".into()),
                    ));
                }
                None if running.started.elapsed() > Duration::from_secs(10) => {
                    end = Some((
                        JobPhase::Failed,
                        Some("The audio worker did not start the job".into()),
                    ));
                }
                None => {}
            }
            if let Some((phase, reason)) = end {
                let mut running = inner.running.take().expect("checked above");
                running.job.phase = phase;
                running.job.reason = reason;
                let keep = phase != JobPhase::Cancelled
                    && !(phase == JobPhase::Failed && running.job.frames == 0);
                if keep && let Ok(store) = shared.media.as_ref().map(Arc::clone) {
                    let short = running
                        .job
                        .total_frames
                        .is_some_and(|total| running.job.frames < total)
                        || running.stop_requested == Some(true)
                            && running.job.kind == CaptureKind::Reamp;
                    running.job.incomplete =
                        phase == JobPhase::Failed || short || running.job.lost_samples > 0;
                    let mut provenance = running.provenance.clone();
                    provenance["complete"] = serde_json::json!(!running.job.incomplete);
                    provenance["lost_samples"] = serde_json::json!(running.job.lost_samples);
                    let job = running.job.clone();
                    match tokio::task::spawn_blocking(move || finalize(&store, &job, provenance))
                        .await
                    {
                        Ok(Ok(manifest)) => running.job.asset = Some(manifest.id),
                        Ok(Err(MediaError::Invalid(reason))) => {
                            running.job.phase = JobPhase::Failed;
                            running.job.reason = Some(reason);
                        }
                        _ => {
                            running.job.phase = JobPhase::Failed;
                            running.job.reason = Some("The recording could not be saved".into());
                        }
                    }
                }
                inner.last = Some(running.job);
                captures.publish(&mut inner);
                drop(inner);
                crate::player::library_changed(&shared).await;
                continue;
            }
            if changed {
                captures.publish(&mut inner);
            }
        }
    });
}

fn reply(result: Result<CaptureState, Refusal>) -> Response {
    match result {
        Ok(state) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, "no-store")],
            Json(state),
        )
            .into_response(),
        Err((status, reason)) => failure(status, &reason),
    }
}

pub(crate) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    let state = shared.captures.inner.lock().await.state();
    reply(Ok(state))
}

pub(crate) async fn record_di(State(shared): State<Arc<Shared>>) -> Response {
    reply(start(&shared, CaptureKind::Di, None).await)
}

pub(crate) async fn reamp(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<ReampRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Choose the DI, input processing, tail and monitoring",
        );
    };
    reply(start(&shared, CaptureKind::Reamp, Some(request)).await)
}

pub(crate) async fn stop(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<StopRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(StopRequest { keep })) = body else {
        return failure(StatusCode::BAD_REQUEST, "Choose Stop and keep, or Cancel");
    };
    let captures = &shared.captures;
    let mut inner = captures.inner.lock().await;
    let Some(running) = &mut inner.running else {
        return failure(StatusCode::CONFLICT, "Nothing is recording");
    };
    let seq = running.seq;
    running.stop_requested = Some(keep);
    let result = crate::player::send_utility(
        &shared,
        HostUtility::Capture {
            command: CaptureCommand::Stop { seq, keep },
        },
    )
    .await;
    if let Err((status, reason)) = result {
        return failure(status, &reason);
    }
    if running.job.phase != JobPhase::Starting {
        running.job.phase = JobPhase::Finishing;
    }
    captures.publish(&mut inner);
    reply(Ok(inner.state()))
}
