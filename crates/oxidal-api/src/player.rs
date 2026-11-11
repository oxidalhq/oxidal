//! Backing player service: the one authoritative transport for the backing
//! track. Every entry point (UI, MIDI, API) sends the same `PlayerCommand`
//! here. The daemon owns the state; the audio worker plays what it is told and
//! reports its position, which this service follows through monitoring.
//! Nothing here depends on a connected browser, so a track keeps playing with
//! every client closed.
//! @see docs/media.md
use crate::media::{Lease, MediaKind, MediaManifest};
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use oxidal_audio::backing::{BackingCommand, BackingStatus, MediaId};
use oxidal_audio::tools::HostUtility;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, watch};

pub(crate) const LEVEL_RANGE: (f32, f32) = (-60.0, 6.0);
const DEFAULT_LEVEL_DB: f32 = -6.0;
/// How long a worker may be away during a deliberate restart before the
/// track counts as interrupted.
const CONTINUE_WINDOW: Duration = Duration::from_secs(15);
const REMEMBERED_REQUESTS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PlayerState {
    Empty,
    Ready,
    Playing,
    Paused,
    Ended,
    /// The audio worker stopped unexpectedly; the position is kept.
    Interrupted,
    /// The cued file cannot play now; `reason` says why.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CuedTrack {
    pub id: String,
    pub title: String,
    pub frames: u64,
    pub rate: u32,
    pub channels: u16,
    pub trim_db: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub revision: u64,
    pub state: PlayerState,
    pub track: Option<CuedTrack>,
    /// Frame at the moment this snapshot was taken. While `Playing`, clients
    /// advance it locally until the next snapshot.
    pub frame: u64,
    pub repeat: bool,
    pub level_db: f32,
    /// The Backing list, in Library order (asset IDs).
    pub order: Vec<String>,
    pub reason: Option<String>,
    /// Shown once after a preset change made the track pause briefly.
    pub notice: Option<String>,
    pub underruns: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlayerCommand {
    TogglePlay,
    Play,
    Pause,
    Stop,
    SkipBy { seconds: i32 },
    SeekTo { frame: u64 },
    Previous,
    Next,
    Cue { asset: MediaId },
    SetRepeat { repeat: bool },
    SetLevel { db: f32 },
    AdjustLevel { delta_db: f32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Ui,
    Midi,
    Api,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerRequest {
    /// Retries with the same ID return the first result instead of acting twice.
    pub request_id: String,
    pub origin: Origin,
    /// The track the sender believes is cued; a mismatch is refused.
    #[serde(default)]
    pub expected_cue: Option<String>,
    pub command: PlayerCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerOrder {
    pub order: Vec<String>,
}

/// `player.json`: what survives a reboot. Positions are never restored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    schema: u32,
    cued: Option<String>,
    level_db: f32,
    repeat: bool,
    order: Vec<String>,
}

type Refusal = (StatusCode, String);

#[derive(Debug)]
struct Inner {
    state: PlayerState,
    track: Option<CuedTrack>,
    frame: u64,
    repeat: bool,
    level_db: f32,
    order: Vec<String>,
    reason: Option<String>,
    notice: Option<String>,
    underruns: u64,
    revision: u64,
    seq: u32,
    lease: Option<Lease>,
    recent: VecDeque<(String, Result<PlayerSnapshot, Refusal>)>,
    /// While Playing: the worker went away at this instant and frame.
    lost: Option<(Instant, u64)>,
    /// Waiting for the worker's exact stop frame after a Pause.
    paused_sync: bool,
    last_broadcast: Instant,
}

#[derive(Debug)]
pub struct Player {
    inner: Mutex<Inner>,
    events: watch::Sender<PlayerSnapshot>,
    path: PathBuf,
}

fn db_gain(level_db: f32, trim_db: f64) -> f32 {
    if level_db <= LEVEL_RANGE.0 {
        -90.0
    } else {
        (level_db + trim_db as f32).clamp(-90.0, 12.0)
    }
}

impl Inner {
    fn snapshot(&self) -> PlayerSnapshot {
        PlayerSnapshot {
            revision: self.revision,
            state: self.state,
            track: self.track.clone(),
            frame: self.frame,
            repeat: self.repeat,
            level_db: self.level_db,
            order: self.order.clone(),
            reason: self.reason.clone(),
            notice: self.notice.clone(),
            underruns: self.underruns,
        }
    }
    fn saved(&self) -> Saved {
        Saved {
            schema: 1,
            cued: self.track.as_ref().map(|t| t.id.clone()),
            level_db: self.level_db,
            repeat: self.repeat,
            order: self.order.clone(),
        }
    }
    fn gain_db(&self) -> f32 {
        db_gain(
            self.level_db,
            self.track.as_ref().map_or(0.0, |t| t.trim_db),
        )
    }
    fn play_command(&mut self, from: u64) -> Option<BackingCommand> {
        let track = self.track.as_ref()?;
        self.seq = self.seq.wrapping_add(1);
        Some(BackingCommand::Play {
            asset: MediaId::parse(&track.id)?,
            channels: track.channels,
            frames: track.frames,
            from: from.min(track.frames.saturating_sub(1)),
            seq: self.seq,
            repeat: self.repeat,
            gain_db: self.gain_db(),
        })
    }
    fn stop_command(&mut self) -> BackingCommand {
        self.seq = self.seq.wrapping_add(1);
        BackingCommand::Stop { seq: self.seq }
    }
}

impl Player {
    /// Restores the cued track (stopped at its start), level, repeat and order.
    pub fn load(path: PathBuf, store: Option<&crate::media::Store>) -> Self {
        let saved: Option<Saved> = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .filter(|s: &Saved| s.schema == 1);
        let mut inner = Inner {
            state: PlayerState::Empty,
            track: None,
            frame: 0,
            repeat: false,
            level_db: DEFAULT_LEVEL_DB,
            order: Vec::new(),
            reason: None,
            notice: None,
            underruns: 0,
            revision: 1,
            seq: 0,
            lease: None,
            recent: VecDeque::new(),
            lost: None,
            paused_sync: false,
            last_broadcast: Instant::now(),
        };
        if let Some(saved) = saved {
            inner.repeat = saved.repeat;
            if saved.level_db.is_finite() {
                inner.level_db = saved.level_db.clamp(LEVEL_RANGE.0, LEVEL_RANGE.1);
            }
            inner.order = saved.order;
            if let (Some(id), Some(store)) = (saved.cued, store)
                && let Ok(manifest) = store.manifest(&id)
            {
                cue(&mut inner, &manifest, 48_000);
            }
        }
        if let Some(store) = store {
            refresh_order(&mut inner, store);
        }
        let (events, _) = watch::channel(inner.snapshot());
        Self {
            inner: Mutex::new(inner),
            events,
            path,
        }
    }

    pub async fn playing(&self) -> bool {
        self.inner.lock().await.state == PlayerState::Playing
    }

    pub fn subscribe(&self) -> watch::Receiver<PlayerSnapshot> {
        self.events.subscribe()
    }

    async fn publish(&self, inner: &mut Inner, persist: bool) {
        inner.revision += 1;
        inner.last_broadcast = Instant::now();
        if persist {
            let path = self.path.clone();
            let bytes = serde_json::to_vec_pretty(&inner.saved()).expect("player state serializes");
            let saved = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let tmp = path.with_extension("json.tmp");
                std::fs::write(&tmp, bytes)?;
                std::fs::File::open(&tmp)?.sync_all()?;
                std::fs::rename(&tmp, &path)
            })
            .await;
            if !matches!(saved, Ok(Ok(()))) {
                eprintln!(
                    "Cannot save the backing player state to {}",
                    self.path.display()
                );
            }
        }
        self.events.send_replace(inner.snapshot());
    }
}

/// Cues a manifest's render for `rate`, or explains why it cannot play.
fn cue(inner: &mut Inner, manifest: &MediaManifest, rate: u32) {
    inner.lease = None;
    inner.frame = 0;
    inner.notice = None;
    let render = manifest.render(rate).or_else(|| manifest.renders.first());
    let Some(render) = render else {
        inner.track = None;
        inner.state = PlayerState::Empty;
        return;
    };
    inner.track = Some(CuedTrack {
        id: manifest.id.clone(),
        title: manifest.title.clone(),
        frames: render.frames,
        rate: render.rate,
        channels: render.channels,
        trim_db: manifest.playback.trim_db,
    });
    if render.rate == rate {
        inner.state = PlayerState::Ready;
        inner.reason = None;
    } else {
        inner.state = PlayerState::Unavailable;
        inner.reason = Some(format!(
            "Prepared for {} kHz; the audio runs at {} kHz",
            f64::from(render.rate) / 1000.0,
            f64::from(rate) / 1000.0
        ));
    }
}

/// The Backing list: saved order first, then any newer tracks by import time.
fn refresh_order(inner: &mut Inner, store: &crate::media::Store) {
    let Ok(assets) = store.list() else {
        return;
    };
    let backing: Vec<String> = assets
        .into_iter()
        .filter(|a| a.kind == MediaKind::Backing)
        .map(|a| a.id)
        .collect();
    let mut order: Vec<String> = inner
        .order
        .iter()
        .filter(|id| backing.contains(id))
        .cloned()
        .collect();
    for id in backing {
        if !order.contains(&id) {
            order.push(id);
        }
    }
    inner.order = order;
}

fn store(shared: &Shared) -> Result<Arc<crate::media::Store>, Refusal> {
    shared.media.as_ref().map(Arc::clone).map_err(|reason| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Media storage is unavailable: {reason}"),
        )
    })
}

/// What the running audio owner reports, read from the owner itself (it polls
/// its worker every 200 ms), not from the 1 Hz monitoring snapshot.
#[derive(Debug, Clone, Copy, Default)]
struct WorkerView {
    running: bool,
    failed: bool,
    status: Option<BackingStatus>,
    rate: Option<u32>,
}

fn worker(shared: &Shared) -> WorkerView {
    use oxidal_audio::lifecycle::AudioPhase;
    let native = shared.playback.snapshot();
    let graph = shared.graph_playback.snapshot();
    let rig = shared.rig_playback.snapshot();
    let failed = [native.phase, graph.phase, rig.phase].contains(&AudioPhase::Failed);
    let backing = |t: Option<oxidal_audio::meter::Snapshot>| {
        t.and_then(|t| t.monitoring).and_then(|h| h.backing)
    };
    if native.phase == AudioPhase::Running {
        WorkerView {
            running: true,
            failed,
            status: backing(shared.playback.telemetry().map(|t| t.0)),
            rate: native
                .configured
                .as_ref()
                .map(|c| c.stream.input.sample_rate),
        }
    } else if graph.phase == AudioPhase::Running {
        WorkerView {
            running: true,
            failed,
            status: backing(graph.telemetry),
            rate: graph
                .configured
                .as_ref()
                .map(|c| c.stream.input.sample_rate),
        }
    } else if rig.phase == AudioPhase::Running {
        WorkerView {
            running: true,
            failed,
            status: backing(rig.telemetry),
            rate: rig.configured.as_ref().map(|c| c.stream.input.sample_rate),
        }
    } else {
        WorkerView {
            failed,
            ..WorkerView::default()
        }
    }
}

/// The stream rate of the running audio, if any.
fn running_rate(shared: &Shared) -> Option<u32> {
    worker(shared).rate
}

/// Sends a backing command to whichever audio owner is running.
async fn send(shared: &Shared, command: BackingCommand) -> Result<(), Refusal> {
    send_utility(shared, HostUtility::Backing { command }).await
}

/// Sends a host utility to whichever audio owner is running (native, graph
/// or mixed); refused when no audio runs.
pub(crate) async fn send_utility(shared: &Shared, utility: HostUtility) -> Result<(), Refusal> {
    use oxidal_audio::lifecycle::{AudioAction, AudioCommand, AudioPhase};
    use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand};
    use oxidal_lv2::protocol::{GraphAudioAction, GraphAudioCommand};
    let unavailable = || {
        (
            StatusCode::CONFLICT,
            "Start the audio to play the track".to_owned(),
        )
    };
    let native = shared.playback.snapshot();
    let result = if native.phase == AudioPhase::Running {
        shared
            .playback
            .dispatch(AudioCommand {
                session: native.session,
                expected_revision: native.revision,
                action: AudioAction::HostUtility { command: utility },
            })
            .await
            .map(|_| ())
    } else {
        let rig = shared.rig_playback.snapshot();
        if rig.phase == AudioPhase::Running {
            shared
                .rig_playback
                .dispatch(RigAudioCommand {
                    session: rig.session,
                    expected_revision: rig.revision,
                    action: RigAudioAction::HostUtility { command: utility },
                })
                .await
                .map(|_| ())
        } else {
            let graph = shared.graph_playback.snapshot();
            if graph.phase != AudioPhase::Running {
                return Err(unavailable());
            }
            shared
                .graph_playback
                .dispatch(GraphAudioCommand {
                    session: graph.session,
                    expected_revision: graph.revision,
                    action: GraphAudioAction::HostUtility { command: utility },
                })
                .await
                .map(|_| ())
        }
    };
    result.map_err(|e| (StatusCode::CONFLICT, e))
}

/// Applies one command. The single handler for every entry point.
pub(crate) async fn apply(
    shared: &Shared,
    request: PlayerRequest,
) -> Result<PlayerSnapshot, Refusal> {
    let player = &shared.player;
    let mut inner = player.inner.lock().await;
    if let Some((_, result)) = inner
        .recent
        .iter()
        .find(|(id, _)| *id == request.request_id)
    {
        return result.clone();
    }
    let result = run(shared, &mut inner, &request).await;
    if inner.recent.len() >= REMEMBERED_REQUESTS {
        inner.recent.pop_front();
    }
    inner
        .recent
        .push_back((request.request_id.clone(), result.clone().map(|(s, _)| s)));
    match result {
        Ok((_, persist)) => {
            player.publish(&mut inner, persist).await;
            Ok(inner.snapshot())
        }
        Err(refusal) => Err(refusal),
    }
}

async fn run(
    shared: &Shared,
    inner: &mut Inner,
    request: &PlayerRequest,
) -> Result<(PlayerSnapshot, bool), Refusal> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err((StatusCode::BAD_REQUEST, "Send a request ID".into()));
    }
    if let Some(expected) = &request.expected_cue
        && inner.track.as_ref().map(|t| &t.id) != Some(expected)
    {
        return Err((
            StatusCode::CONFLICT,
            "The cued track changed; check the player and try again".into(),
        ));
    }
    let rate = running_rate(shared);
    let mut persist = false;
    inner.notice = None;
    match request.command {
        PlayerCommand::TogglePlay => {
            let command = if inner.state == PlayerState::Playing {
                PlayerCommand::Pause
            } else {
                PlayerCommand::Play
            };
            return Box::pin(run(
                shared,
                inner,
                &PlayerRequest {
                    command,
                    ..request.clone()
                },
            ))
            .await;
        }
        PlayerCommand::Play => {
            let Some(track) = inner.track.clone() else {
                return Err((StatusCode::CONFLICT, "Choose a track first".into()));
            };
            if inner.state == PlayerState::Playing {
                return Ok((inner.snapshot(), false));
            }
            if rate.is_some_and(|r| r != track.rate) {
                return Err((
                    StatusCode::CONFLICT,
                    inner.reason.clone().unwrap_or_else(|| {
                        "This track is not prepared for the running audio".into()
                    }),
                ));
            }
            if inner.state == PlayerState::Ended {
                inner.frame = 0;
            }
            let store = store(shared)?;
            let lease = store.lease(&track.id).map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    "That track is no longer in Library".to_owned(),
                )
            })?;
            let from = inner.frame;
            let command = inner
                .play_command(from)
                .ok_or((StatusCode::CONFLICT, "Choose a track first".to_owned()))?;
            send(shared, command).await?;
            inner.lease = Some(lease);
            inner.paused_sync = false;
            inner.state = PlayerState::Playing;
            inner.reason = None;
            inner.lost = None;
        }
        PlayerCommand::Pause => {
            if inner.state == PlayerState::Playing {
                if let Some(status) = worker(shared).status
                    && status.seq == inner.seq
                {
                    inner.frame = status.frame;
                }
                let command = inner.stop_command();
                send(shared, command).await?;
                inner.state = PlayerState::Paused;
                inner.paused_sync = true;
            }
        }
        PlayerCommand::Stop => {
            if inner.state == PlayerState::Playing {
                let command = inner.stop_command();
                send(shared, command).await?;
            }
            if inner.track.is_some() && inner.state != PlayerState::Unavailable {
                inner.state = PlayerState::Ready;
            }
            inner.frame = 0;
            inner.lease = None;
            inner.lost = None;
        }
        PlayerCommand::SkipBy { seconds } => {
            let Some(track) = &inner.track else {
                return Err((StatusCode::CONFLICT, "Choose a track first".into()));
            };
            let delta = i64::from(seconds) * i64::from(track.rate);
            let target =
                (inner.frame as i64 + delta).clamp(0, track.frames.saturating_sub(1) as i64) as u64;
            seek(shared, inner, target).await?;
        }
        PlayerCommand::SeekTo { frame } => {
            if inner.track.is_none() {
                return Err((StatusCode::CONFLICT, "Choose a track first".into()));
            }
            seek(shared, inner, frame).await?;
        }
        PlayerCommand::Previous | PlayerCommand::Next => {
            let store = store(shared)?;
            refresh_order(inner, &store);
            let current = inner
                .track
                .as_ref()
                .and_then(|t| inner.order.iter().position(|id| *id == t.id));
            let target = match (request.command, current) {
                (PlayerCommand::Next, Some(i)) => inner.order.get(i + 1),
                (PlayerCommand::Previous, Some(i)) if i > 0 => inner.order.get(i - 1),
                (PlayerCommand::Next, None) => inner.order.first(),
                _ => None,
            }
            .cloned();
            let Some(target) = target else {
                return Err((
                    StatusCode::CONFLICT,
                    if request.command == PlayerCommand::Next {
                        "This is the last track"
                    } else {
                        "This is the first track"
                    }
                    .into(),
                ));
            };
            cue_by_id(shared, inner, &store, &target, rate).await?;
            persist = true;
        }
        PlayerCommand::Cue { asset } => {
            let store = store(shared)?;
            cue_by_id(shared, inner, &store, asset.as_str(), rate).await?;
            refresh_order(inner, &store);
            persist = true;
        }
        PlayerCommand::SetRepeat { repeat } => {
            if inner.state == PlayerState::Playing {
                send(shared, BackingCommand::Repeat { repeat }).await?;
            }
            inner.repeat = repeat;
            persist = true;
        }
        PlayerCommand::SetLevel { db } | PlayerCommand::AdjustLevel { delta_db: db }
            if !db.is_finite() =>
        {
            return Err((
                StatusCode::BAD_REQUEST,
                "Level must be a number of dB".into(),
            ));
        }
        PlayerCommand::SetLevel { db } => {
            set_level(shared, inner, db).await?;
            persist = true;
        }
        PlayerCommand::AdjustLevel { delta_db } => {
            let db = inner.level_db + delta_db;
            set_level(shared, inner, db).await?;
            persist = true;
        }
    }
    Ok((inner.snapshot(), persist))
}

async fn set_level(shared: &Shared, inner: &mut Inner, db: f32) -> Result<(), Refusal> {
    inner.level_db = ((db.clamp(LEVEL_RANGE.0, LEVEL_RANGE.1)) * 10.0).round() / 10.0;
    if inner.state == PlayerState::Playing {
        send(
            shared,
            BackingCommand::Gain {
                gain_db: inner.gain_db(),
            },
        )
        .await?;
    }
    Ok(())
}

async fn seek(shared: &Shared, inner: &mut Inner, frame: u64) -> Result<(), Refusal> {
    inner.paused_sync = false;
    let frames = inner.track.as_ref().map_or(0, |t| t.frames);
    let frame = frame.min(frames.saturating_sub(1));
    if inner.state == PlayerState::Playing {
        let command = inner
            .play_command(frame)
            .ok_or((StatusCode::CONFLICT, "Choose a track first".to_owned()))?;
        send(shared, command).await?;
    } else if inner.state == PlayerState::Ended || (inner.state == PlayerState::Ready && frame > 0)
    {
        // Moving away from the start holds the new position, paused.
        inner.state = PlayerState::Paused;
    }
    inner.frame = frame;
    Ok(())
}

/// Stops whatever plays and cues another track at its start, stopped (D-3).
async fn cue_by_id(
    shared: &Shared,
    inner: &mut Inner,
    store: &crate::media::Store,
    id: &str,
    rate: Option<u32>,
) -> Result<(), Refusal> {
    let manifest = store.manifest(id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            "That track is no longer in Library".to_owned(),
        )
    })?;
    // DI recordings and reamp results play here too (FR-18); Previous/Next
    // still move through the Backing list only.
    if inner.state == PlayerState::Playing {
        let command = inner.stop_command();
        send(shared, command).await?;
    }
    cue(inner, &manifest, rate.unwrap_or(manifest.renders[0].rate));
    inner.lost = None;
    Ok(())
}

/// Follows the worker's reported position and handles worker restarts:
/// a deliberate restart continues the track after the gap; a failure stops at
/// the last confirmed frame (`Interrupted`).
pub(crate) fn follow(shared: Weak<Shared>) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let view = worker(&shared);
            let player = &shared.player;
            let mut inner = player.inner.lock().await;
            let changed = observe(&shared, &mut inner, view).await;
            if changed
                || (inner.state == PlayerState::Playing
                    && inner.last_broadcast.elapsed() >= Duration::from_secs(1))
            {
                player.publish(&mut inner, false).await;
            }
        }
    });
}

async fn observe(shared: &Shared, inner: &mut Inner, view: WorkerView) -> bool {
    let WorkerView {
        running,
        failed,
        status,
        rate,
    } = view;
    // After Pause, take the exact frame the worker stopped on.
    if inner.state == PlayerState::Paused
        && let Some(status) = status
        && running
        && status.seq == inner.seq
        && !status.playing
        && status.frame != inner.frame
        && inner.paused_sync
    {
        inner.paused_sync = false;
        inner.frame = status.frame;
        return true;
    }
    if inner.state != PlayerState::Playing {
        return false;
    }
    let Some(track) = inner.track.clone() else {
        return false;
    };
    match status {
        Some(status) if running && status.seq == inner.seq => {
            inner.lost = None;
            inner.frame = status.frame;
            let changed = status.underruns != inner.underruns;
            inner.underruns = status.underruns;
            if status.missing {
                inner.state = PlayerState::Unavailable;
                inner.reason = Some("The track file is missing or damaged".into());
                inner.lease = None;
                return true;
            }
            if status.ended {
                inner.state = PlayerState::Ended;
                inner.frame = track.frames;
                inner.lease = None;
                return true;
            }
            changed
        }
        _ if !running => {
            if failed {
                inner.state = PlayerState::Interrupted;
                inner.reason = Some("The audio stopped. Press Play to resume.".into());
                inner.lost = None;
                return true;
            }
            if inner.lost.is_none() {
                inner.lost = Some((Instant::now(), inner.frame));
            }
            if inner
                .lost
                .is_some_and(|(at, _)| at.elapsed() > CONTINUE_WINDOW)
            {
                inner.state = PlayerState::Interrupted;
                inner.reason = Some("The audio did not come back. Press Play to resume.".into());
                inner.lost = None;
                return true;
            }
            false
        }
        _ => {
            // A new worker is running without our track: continue in time.
            let Some((at, frame)) = inner.lost.take() else {
                return false;
            };
            if rate.is_some_and(|r| r != track.rate) {
                inner.state = PlayerState::Unavailable;
                inner.reason =
                    Some("The audio rate changed; the track needs preparing again".into());
                inner.lease = None;
                return true;
            }
            let gap = at.elapsed();
            let advanced = frame + (gap.as_secs_f64() * f64::from(track.rate)) as u64;
            let from = if inner.repeat {
                advanced % track.frames.max(1)
            } else {
                advanced
            };
            if from >= track.frames {
                inner.state = PlayerState::Ended;
                inner.frame = track.frames;
                inner.lease = None;
                return true;
            }
            let Some(command) = inner.play_command(from) else {
                return false;
            };
            match send(shared, command).await {
                Ok(()) => {
                    inner.frame = from;
                    inner.notice = Some(format!(
                        "Track continued after a {:.1} s gap while the preset loaded",
                        gap.as_secs_f64()
                    ));
                }
                Err(_) => {
                    inner.state = PlayerState::Interrupted;
                    inner.reason = Some("The audio stopped. Press Play to resume.".into());
                }
            }
            true
        }
    }
}

pub(crate) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    let snapshot = shared.player.inner.lock().await.snapshot();
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(snapshot),
    )
        .into_response()
}

pub(crate) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<PlayerRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send a player command");
    };
    match apply(&shared, request).await {
        Ok(snapshot) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, "no-store")],
            Json(snapshot),
        )
            .into_response(),
        Err((status, reason)) => failure(status, &reason),
    }
}

pub(crate) async fn reorder(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<PlayerOrder>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(PlayerOrder { order })) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send the track order");
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err((status, reason)) => return failure(status, &reason),
    };
    let mut inner = shared.player.inner.lock().await;
    refresh_order(&mut inner, &store);
    let mut sorted = order.clone();
    sorted.sort();
    let mut current = inner.order.clone();
    current.sort();
    if sorted != current {
        return failure(
            StatusCode::CONFLICT,
            "The Backing list changed; reload it and try again",
        );
    }
    inner.order = order;
    shared.player.publish(&mut inner, true).await;
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(inner.snapshot()),
    )
        .into_response()
}

pub(crate) async fn events(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let mut receiver = shared.player.subscribe();
    let mut shutdown = shared.config.shutdown.clone();
    let stream = async_stream::stream! {
        loop {
            let snapshot = receiver.borrow_and_update().clone();
            let event = Event::default().event("player").id(snapshot.revision.to_string()).json_data(snapshot).expect("finite player snapshot");
            yield Ok::<Event, Infallible>(event);
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

/// Refreshes the Backing list after an import, rename or delete.
pub(crate) async fn library_changed(shared: &Shared) {
    let Ok(store) = store(shared) else {
        return;
    };
    let mut inner = shared.player.inner.lock().await;
    let before = inner.order.clone();
    refresh_order(&mut inner, &store);
    let cued_gone = inner
        .track
        .as_ref()
        .is_some_and(|t| store.manifest(&t.id).is_err());
    if cued_gone {
        inner.track = None;
        inner.state = PlayerState::Empty;
        inner.frame = 0;
        inner.lease = None;
    }
    if let Some(track) = &mut inner.track
        && let Ok(manifest) = store.manifest(&track.id)
    {
        track.title = manifest.title;
        track.trim_db = manifest.playback.trim_db;
    }
    if before != inner.order || cued_gone {
        shared.player.publish(&mut inner, true).await;
    } else {
        shared.player.publish(&mut inner, false).await;
    }
}
