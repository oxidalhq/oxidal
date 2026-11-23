//! Daemon-owned confirmation of a replacement audio stream.
//! @see docs/audio.md
mod finder;
pub(super) mod recovery;

use crate::{Shared, failure, media, media_api, protect};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::{
    AudioProbe, StreamConfig,
    lifecycle::{AudioAction, AudioCommand, AudioPhase},
    meter,
    tools::HostUtility,
};
use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand};
use oxidal_lv2::protocol::{GraphAudioAction, GraphAudioCommand};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Notify, oneshot},
    time::{Instant, sleep_until},
};

const PROVING: Duration = Duration::from_secs(15);
const OWNER_READY: Duration = Duration::from_secs(68);
pub(super) const REQUEST_BYTES: usize = 16 * 1024;
pub(super) const BUSY: &str = "An audio settings change is in progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AudioChangeOwner {
    Native,
    Mixed,
    Effects,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioChangeHardware {
    pub input: AudioProbe,
    pub output: AudioProbe,
    pub input_map: [u32; 2],
    pub output_map: [u32; 2],
}

impl AudioChangeHardware {
    pub(super) fn from_stream(stream: &StreamConfig) -> Self {
        Self {
            input: stream.input.clone(),
            output: stream.output.clone(),
            input_map: stream.input_map,
            output_map: stream.output_map,
        }
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        StreamConfig {
            input: self.input.clone(),
            output: self.output.clone(),
            input_map: self.input_map,
            output_map: self.output_map,
            hear_yourself: true,
            levels: Default::default(),
            venue: None,
        }
        .validate()
    }

    pub(super) fn set(&self, stream: &mut StreamConfig) {
        stream.input.clone_from(&self.input);
        stream.output.clone_from(&self.output);
        stream.input_map = self.input_map;
        stream.output_map = self.output_map;
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AudioChangePhase {
    #[default]
    Idle,
    Restarting,
    Proving,
    Reverting,
    Kept,
    Reverted,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct AudioChangeObservation {
    pub frames: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xruns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_misses: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_samples: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, JsonSchema)]
pub struct AudioChangeState {
    pub phase: AudioChangePhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finder: Option<finder::BufferFinderState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<AudioChangeOwner>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<AudioChangeHardware>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<AudioChangeHardware>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed: Option<AudioChangeObservation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AudioChangeRequest {
    FindBuffer {
        owner: AudioChangeOwner,
        session: String,
        expected_revision: u64,
    },
    Apply {
        owner: AudioChangeOwner,
        session: String,
        expected_revision: u64,
        input: AudioProbe,
        output: AudioProbe,
        input_map: [u32; 2],
        output_map: [u32; 2],
    },
    Keep {
        id: String,
    },
    Revert {
        id: String,
    },
    Stop {
        id: String,
    },
}

/// Private actor messages. Only the daemon transaction can mint these.
pub(super) enum OwnerRequest<C> {
    Tempo {
        worker_session: String,
        bpm: Option<f32>,
        tap_note: Option<oxidal_lv2::TapNote>,
    },
    Action(C),
    Occurrence {
        action: C,
        scene: String,
    },
    Apply {
        id: String,
        action: C,
    },
    Restore {
        id: String,
        action: C,
    },
    Commit {
        id: String,
    },
    SealRollback {
        id: String,
    },
    Stop {
        id: String,
    },
}

pub(super) type OwnerMessage<C, S> = (
    OwnerRequest<C>,
    oneshot::Sender<Result<S, String>>,
    Option<tokio::sync::OwnedRwLockReadGuard<()>>,
);

#[derive(Debug)]
pub(super) struct OwnerContext {
    pub library_access: Arc<tokio::sync::RwLock<()>>,
    pub change: Arc<Change>,
    pub protect: Arc<protect::Protect>,
}

#[derive(Debug)]
struct Decision {
    keep: bool,
    reply: oneshot::Sender<Result<AudioChangeState, String>>,
}

#[derive(Debug, Default)]
struct Inner {
    view: AudioChangeState,
    deadline: Option<Instant>,
    decision: Option<Decision>,
    deciding: bool,
    committed: bool,
    stopped: bool,
    stop_requested: bool,
    stop_finalized: bool,
    stop_result: Option<Result<(), String>>,
    operations: usize,
    power_queued: bool,
}

#[derive(Debug, Default)]
pub(super) struct Change {
    inner: Mutex<Inner>,
    notified: Notify,
    stop_notified: Notify,
    measurement_silent: std::sync::atomic::AtomicBool,
}

impl Inner {
    fn active(&self) -> bool {
        self.view
            .finder
            .as_ref()
            .is_some_and(finder::BufferFinderState::active)
            || matches!(
                self.view.phase,
                AudioChangePhase::Restarting
                    | AudioChangePhase::Proving
                    | AudioChangePhase::Reverting
            )
    }
}

pub(super) struct MeasurementSilence<'a>(&'a Change);
impl Drop for MeasurementSilence<'_> {
    fn drop(&mut self) {
        self.0
            .measurement_silent
            .store(false, std::sync::atomic::Ordering::Release);
    }
}
impl Change {
    pub(super) fn silence_measurement(&self) -> MeasurementSilence<'_> {
        self.measurement_silent
            .store(true, std::sync::atomic::Ordering::Release);
        MeasurementSilence(self)
    }
    pub(super) fn measurement_silent(&self) -> bool {
        self.measurement_silent
            .load(std::sync::atomic::Ordering::Acquire)
    }
    pub(super) fn allows_stop(&self, owner: AudioChangeOwner) -> bool {
        let inner = self.lock();
        inner.active() && inner.view.owner == Some(owner)
    }

    pub(super) fn check_stop(&self, owner: AudioChangeOwner, id: &str) -> Result<(), String> {
        let inner = self.lock();
        if inner.active()
            && inner.view.owner == Some(owner)
            && inner.view.id.as_deref() == Some(id)
            && inner.stop_requested
        {
            Ok(())
        } else {
            Err("Audio settings preview is no longer current".into())
        }
    }

    pub(super) fn spawn_worker<T>(
        &self,
        owner: AudioChangeOwner,
        spawn: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        // Serialize launch admission with Stop. The lock ends before the
        // child receives configuration or does asynchronous preparation.
        let inner = self.lock();
        if inner.active() && inner.view.owner == Some(owner) && inner.stopped {
            return Err("Audio settings preview was stopped".into());
        }
        spawn()
    }

    pub(super) async fn wait_stopping(&self, owner: AudioChangeOwner) -> String {
        loop {
            let notified = self.stop_notified.notified();
            {
                let inner = self.lock();
                if inner.active() && inner.view.owner == Some(owner) && inner.stop_requested {
                    return "Audio settings preview was stopped".into();
                }
            }
            notified.await;
        }
    }

    pub(super) fn new(root: &Path) -> Result<Self, String> {
        let view = recovery::reconcile(root)?
            .map(|marker| AudioChangeState {
                phase: AudioChangePhase::Reverted,
                id: Some(marker.id),
                owner: Some(marker.owner),
                previous: Some(marker.previous),
                candidate: Some(marker.candidate),
                message: Some("An unconfirmed audio setting was discarded after restart.".into()),
                ..Default::default()
            })
            .unwrap_or_default();
        Ok(Self {
            inner: Mutex::new(Inner {
                view,
                ..Default::default()
            }),
            notified: Notify::new(),
            stop_notified: Notify::new(),
            measurement_silent: std::sync::atomic::AtomicBool::new(false),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(super) fn active(&self) -> bool {
        self.lock().active()
    }

    pub(super) fn power_queued(&self) {
        self.lock().power_queued = true;
    }

    pub(super) fn operation(&self) -> Result<Operation<'_>, &'static str> {
        let mut inner = self.lock();
        if inner.active() {
            return Err(BUSY);
        }
        inner.operations += 1;
        Ok(Operation(self))
    }

    pub(super) fn previous(&self, owner: AudioChangeOwner, stream: &mut StreamConfig) {
        let inner = self.lock();
        if inner.active()
            && !inner.committed
            && inner.view.owner == Some(owner)
            && let Some(previous) = &inner.view.previous
        {
            previous.set(stream);
        }
    }

    pub(super) fn admits(
        &self,
        owner: AudioChangeOwner,
        stop: bool,
        utility: Option<&HostUtility>,
    ) -> Result<bool, String> {
        let mut inner = self.lock();
        if !inner.active() {
            return Ok(false);
        }
        if inner.view.owner != Some(owner) {
            return Err(BUSY.into());
        }
        if stop {
            inner.stopped = true;
            self.notified.notify_one();
            return Ok(true);
        }
        if matches!(
            utility,
            Some(HostUtility::OutputMute { .. } | HostUtility::Backing { .. })
        ) {
            return Ok(false);
        }
        Err(BUSY.into())
    }

    pub(super) fn marker(
        &self,
        root: &Path,
        owner: AudioChangeOwner,
        id: &str,
    ) -> Result<(), String> {
        let inner = self.lock();
        if inner.view.owner != Some(owner)
            || inner.view.id.as_deref() != Some(id)
            || inner.view.phase != AudioChangePhase::Restarting
            || inner.stopped
        {
            return Err("Audio settings preview is no longer current".into());
        }
        recovery::write_marker(
            root,
            id,
            owner,
            inner.view.previous.as_ref().unwrap(),
            inner.view.candidate.as_ref().unwrap(),
        )
    }

    pub(super) fn check(
        &self,
        owner: AudioChangeOwner,
        id: &str,
        phase: AudioChangePhase,
    ) -> Result<(), String> {
        let inner = self.lock();
        if inner.view.owner != Some(owner)
            || inner.view.id.as_deref() != Some(id)
            || inner.view.phase != phase
            || inner.stopped
        {
            return Err("Audio settings preview is no longer current".into());
        }
        Ok(())
    }

    pub(super) fn check_keep(
        &self,
        owner: AudioChangeOwner,
        id: &str,
        stream: &StreamConfig,
    ) -> Result<(), String> {
        self.check(owner, id, AudioChangePhase::Proving)?;
        let inner = self.lock();
        if inner
            .deadline
            .is_none_or(|deadline| deadline <= Instant::now())
            || inner.view.candidate.as_ref() != Some(&AudioChangeHardware::from_stream(stream))
        {
            return Err("Audio settings preview expired or no longer owns this stream".into());
        }
        Ok(())
    }

    pub(super) fn commit(&self, root: &Path, id: &str) -> Result<(), String> {
        let mut inner = self.lock();
        if inner.view.id.as_deref() != Some(id) || inner.stopped {
            return Err("Audio settings preview is no longer current".into());
        }
        recovery::clear_marker(root, id)?;
        // Checkpoint substitution ends before the owner resumes its event loop.
        inner.committed = true;
        Ok(())
    }

    pub(super) fn seal_rollback(
        &self,
        root: &Path,
        owner: AudioChangeOwner,
        id: &str,
    ) -> Result<(), String> {
        let inner = self.lock();
        if inner.view.id.as_deref() != Some(id)
            || inner.view.owner != Some(owner)
            || inner.view.phase != AudioChangePhase::Reverting
        {
            return Err("Audio settings recovery is no longer current".into());
        }
        recovery::clear_marker(root, id)
    }

    fn begin(
        &self,
        owner: AudioChangeOwner,
        previous: AudioChangeHardware,
        candidate: AudioChangeHardware,
    ) -> Result<String, &'static str> {
        let mut inner = self.lock();
        if inner.active() || inner.operations > 0 || inner.power_queued {
            return Err(BUSY);
        }
        let id = media::new_id();
        *inner = Inner {
            view: AudioChangeState {
                phase: AudioChangePhase::Restarting,
                id: Some(id.clone()),
                owner: Some(owner),
                previous: Some(previous),
                candidate: Some(candidate),
                ..Default::default()
            },
            ..Default::default()
        };
        Ok(id)
    }

    async fn finish(
        &self,
        phase: AudioChangePhase,
        message: Option<String>,
        recovery_error: Option<String>,
    ) -> AudioChangeState {
        loop {
            let notified = self.stop_notified.notified();
            {
                let mut inner = self.lock();
                if inner.stop_finalized {
                    return inner.view.clone();
                }
                match (inner.stop_requested, inner.stop_result.take()) {
                    (false, _) => return Self::finish_locked(&mut inner, phase, message),
                    (true, Some(Ok(()))) => {
                        inner.stop_finalized = true;
                        let (phase, message) = match recovery_error {
                            Some(error) => (AudioChangePhase::Failed, Some(error)),
                            None => (
                                AudioChangePhase::Reverted,
                                Some(
                                    "The audio settings change was cancelled and audio stopped."
                                        .into(),
                                ),
                            ),
                        };
                        return Self::finish_locked(&mut inner, phase, message);
                    }
                    (true, Some(Err(error))) => {
                        inner.stop_finalized = true;
                        return Self::finish_locked(
                            &mut inner,
                            AudioChangePhase::Failed,
                            Some(format!("Audio could not stop: {error}")),
                        );
                    }
                    (true, None) => (),
                }
            }
            notified.await;
        }
    }

    fn finish_locked(
        inner: &mut Inner,
        phase: AudioChangePhase,
        message: Option<String>,
    ) -> AudioChangeState {
        inner.view.phase = phase;
        inner.view.message = message;
        inner.deadline = None;
        let state = inner.view.clone();
        if let Some(decision) = inner.decision.take() {
            let result = if decision.keep {
                Err("Audio settings preview is no longer current".into())
            } else {
                Ok(state.clone())
            };
            let _ = decision.reply.send(result);
        }
        state
    }

    fn snapshot(&self, shared: &Shared) -> AudioChangeState {
        let inner = self.lock();
        let mut view = inner.view.clone();
        view.remaining_ms = inner
            .deadline
            .map(|time| time.saturating_duration_since(Instant::now()).as_millis() as u64);
        if view.phase == AudioChangePhase::Proving
            && let Some(owner) = view.owner
        {
            let current = owner.state(shared);
            if current.phase == AudioPhase::Running
                && current
                    .stream
                    .as_ref()
                    .map(AudioChangeHardware::from_stream)
                    == view.candidate
            {
                view.observed = current
                    .meter
                    .filter(|sample| sample.frames > 0)
                    .map(|sample| AudioChangeObservation {
                        frames: sample.frames,
                        xruns: sample.xruns,
                        deadline_misses: sample.deadline_misses,
                        invalid_samples: Some(sample.invalid_samples),
                    });
            }
        }
        view
    }
}

pub(super) struct Operation<'a>(&'a Change);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.lock().operations -= 1;
    }
}

struct Current {
    phase: AudioPhase,
    device_owned: bool,
    session: String,
    revision: u64,
    stream: Option<StreamConfig>,
    error: Option<String>,
    meter: Option<meter::Snapshot>,
}
impl AudioChangeOwner {
    fn state(self, shared: &Shared) -> Current {
        match self {
            Self::Native => {
                let s = shared.playback.snapshot();
                Current {
                    phase: s.phase,
                    device_owned: s.device_owned,
                    session: s.session,
                    revision: s.revision,
                    stream: s.configured.map(|settings| settings.stream),
                    error: s.error,
                    meter: shared
                        .playback
                        .telemetry()
                        .filter(|(_, time)| time.elapsed() < Duration::from_secs(2))
                        .map(|(meter, _)| meter),
                }
            }
            Self::Mixed => {
                let s = shared.rig_playback.snapshot();
                Current {
                    phase: s.phase,
                    device_owned: s.device_owned,
                    session: s.session,
                    revision: s.revision,
                    stream: s.configured.map(|settings| settings.stream),
                    error: s.error,
                    meter: s.telemetry,
                }
            }
            Self::Effects => {
                let s = shared.graph_playback.snapshot();
                Current {
                    phase: s.phase,
                    device_owned: s.device_owned,
                    session: s.session,
                    revision: s.revision,
                    stream: s.configured.map(|settings| settings.stream),
                    error: s.error,
                    meter: s.telemetry,
                }
            }
        }
    }

    async fn dispatch(self, shared: &Shared, id: &str, mode: Mode) -> Result<(), String> {
        if matches!(mode, Mode::Observe) {
            return Ok(());
        }
        let current = self.state(shared);
        let (session, expected_revision) = match &mode {
            Mode::Apply {
                session, revision, ..
            } => (session.clone(), *revision),
            _ => (current.session, current.revision),
        };
        let mut stream = current.stream.ok_or("No current audio stream")?;
        if let Mode::Apply { hardware, .. } | Mode::Restore(hardware) = &mode {
            hardware.set(&mut stream);
        }
        match self {
            Self::Native => shared
                .playback
                .dispatch_change(mode.message(
                    id,
                    AudioCommand {
                        session,
                        expected_revision,
                        action: AudioAction::Reconfigure { stream },
                    },
                ))
                .await
                .map(|_| ()),
            Self::Mixed => shared
                .rig_playback
                .dispatch_change(mode.message(
                    id,
                    RigAudioCommand {
                        session,
                        expected_revision,
                        action: RigAudioAction::Reconfigure { stream },
                    },
                ))
                .await
                .map(|_| ()),
            Self::Effects => shared
                .graph_playback
                .dispatch_change(mode.message(
                    id,
                    GraphAudioCommand {
                        session,
                        expected_revision,
                        action: GraphAudioAction::Reconfigure { stream },
                    },
                ))
                .await
                .map(|_| ()),
        }
    }

    async fn stop(self, shared: &Shared, id: String) -> Result<(), String> {
        match self {
            Self::Native => shared
                .playback
                .dispatch_change(OwnerRequest::Stop { id })
                .await
                .map(|_| ()),
            Self::Mixed => shared
                .rig_playback
                .dispatch_change(OwnerRequest::Stop { id })
                .await
                .map(|_| ()),
            Self::Effects => shared
                .graph_playback
                .dispatch_change(OwnerRequest::Stop { id })
                .await
                .map(|_| ()),
        }
    }

    async fn ready(self, shared: &Shared, hardware: &AudioChangeHardware) -> Result<(), String> {
        let start = Instant::now();
        loop {
            let current = self.state(shared);
            let matching = current.phase == AudioPhase::Running
                && current
                    .stream
                    .as_ref()
                    .is_some_and(|stream| AudioChangeHardware::from_stream(stream) == *hardware);
            if matching && current.meter.is_some_and(|sample| sample.frames > 0) {
                return Ok(());
            }
            if !matching && !matches!(current.phase, AudioPhase::Starting | AudioPhase::Stopping) {
                return Err(current.error.unwrap_or_else(|| {
                    "Audio worker did not confirm the requested settings".into()
                }));
            }
            if start.elapsed() >= OWNER_READY {
                return Err("Timed out waiting for audio readiness".into());
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }
}

enum Mode {
    Observe,
    Apply {
        session: String,
        revision: u64,
        hardware: AudioChangeHardware,
    },
    Restore(AudioChangeHardware),
    Commit,
    SealRollback,
}
impl Mode {
    fn message<C>(&self, id: &str, action: C) -> OwnerRequest<C> {
        match self {
            Self::Observe => unreachable!("Observation does not send an owner command"),
            Self::Apply { .. } => OwnerRequest::Apply {
                id: id.to_owned(),
                action,
            },
            Self::Restore(_) => OwnerRequest::Restore {
                id: id.to_owned(),
                action,
            },
            Self::Commit => OwnerRequest::Commit { id: id.to_owned() },
            Self::SealRollback => OwnerRequest::SealRollback { id: id.to_owned() },
        }
    }
}

async fn run(
    shared: Arc<Shared>,
    owner: AudioChangeOwner,
    id: String,
    previous: AudioChangeHardware,
    candidate: AudioChangeHardware,
    apply: Mode,
    find_buffer: bool,
) -> Option<finder::BufferTrial> {
    let change = &shared.audio_change;
    let startup_end = Instant::now() + finder::START;
    let applied = if find_buffer {
        tokio::time::timeout_at(startup_end, owner.dispatch(&shared, &id, apply)).await
            .unwrap_or_else(|_| Err("Buffer candidate did not start within 15 seconds; restoring the original stream".into()))
    } else {
        owner.dispatch(&shared, &id, apply).await
    };
    let mut trial = None;
    let mut proof = None;
    let mut decision = None;
    let mut ready = if let Err(error) = applied {
        Some(Err(error))
    } else {
        // Native and Effects finish priming inside their command. Mixed can
        // still be preparing here, so an explicit revert cancels that wait.
        let readiness = async {
            if find_buffer {
                tokio::time::timeout_at(startup_end, owner.ready(&shared, &candidate))
                    .await
                    .unwrap_or_else(|_| {
                        Err(
                            "Buffer candidate did not confirm processed audio within 15 seconds"
                                .into(),
                        )
                    })
            } else {
                owner.ready(&shared, &candidate).await
            }
        };
        tokio::pin!(readiness);
        loop {
            {
                let mut inner = change.lock();
                if find_buffer
                    && shared.protect.refuse(false).is_some()
                    && let Some(finder) = &mut inner.view.finder
                {
                    finder.state = finder::BufferFinderPhase::Cancelling;
                }
                if inner.stopped
                    || (find_buffer
                        && inner
                            .view
                            .finder
                            .as_ref()
                            .is_some_and(|f| f.state == finder::BufferFinderPhase::Cancelling))
                {
                    break None;
                }
                if inner.decision.as_ref().is_some_and(|request| !request.keep) {
                    decision = inner.decision.take();
                    inner.deciding = true;
                    break None;
                }
            }
            tokio::select! {
                biased;
                _ = change.notified.notified() => (),
                ready = &mut readiness => break Some(ready),
                _ = tokio::time::sleep(Duration::from_millis(100)) => (),
            }
        }
    };
    if find_buffer && matches!(ready, Some(Ok(()))) {
        match finder::Proof::new(Instant::now(), owner.state(&shared).meter) {
            Ok(prepared) => proof = Some(prepared),
            Err(error) => ready = Some(Err(error.into())),
        }
    }
    let candidate_session = owner.state(&shared).session;
    let applying_failed = matches!(ready, Some(Err(_)));
    let reason = if let Some(Err(error)) = ready {
        Some(error)
    } else if ready.is_none() {
        None
    } else {
        let until = proof
            .as_ref()
            .map_or_else(|| Instant::now() + PROVING, finder::Proof::deadline);
        {
            let mut inner = change.lock();
            if !inner.stopped {
                inner.view.phase = AudioChangePhase::Proving;
                inner.deadline = Some(until);
            }
        }
        loop {
            {
                let mut inner = change.lock();
                if find_buffer
                    && shared.protect.refuse(false).is_some()
                    && let Some(finder) = &mut inner.view.finder
                {
                    finder.state = finder::BufferFinderPhase::Cancelling;
                }
                if inner.stopped
                    || (find_buffer
                        && inner
                            .view
                            .finder
                            .as_ref()
                            .is_some_and(|f| f.state == finder::BufferFinderPhase::Cancelling))
                {
                    break None;
                }
                if Instant::now() < until {
                    decision = inner.decision.take();
                    if decision.is_some() {
                        inner.deciding = true;
                    }
                }
            }
            if let Some(request) = &decision {
                if request.keep {
                    match owner.dispatch(&shared, &id, Mode::Commit).await {
                        Ok(()) => {
                            let state = change.finish(AudioChangePhase::Kept, None, None).await;
                            let _ = decision.take().unwrap().reply.send(Ok(state));
                            return None;
                        }
                        Err(error) => {
                            let _ = decision.take().unwrap().reply.send(Err(error.clone()));
                            break Some(error);
                        }
                    }
                }
                break None;
            }
            let current = owner.state(&shared);
            if current.phase != AudioPhase::Running
                || (find_buffer && current.session != candidate_session)
            {
                break Some(
                    current
                        .error
                        .unwrap_or_else(|| "The candidate audio worker stopped".into()),
                );
            }
            if let Some(proof) = &mut proof
                && let Some(result) = proof.observe(Instant::now(), current.meter, &candidate)
            {
                let reason = result.reason.clone();
                trial = Some(result);
                break reason;
            }
            if Instant::now() >= until {
                break Some("Audio settings confirmation timed out".into());
            }
            tokio::select! {
                biased;
                _ = sleep_until(until) => (),
                _ = change.notified.notified() => (),
                _ = tokio::time::sleep(Duration::from_millis(100)) => (),
            }
        }
    };
    let report = find_buffer.then(|| {
        trial.unwrap_or_else(|| {
            finder::BufferTrial::refused(
                &candidate,
                reason
                    .as_deref()
                    .unwrap_or("Buffer screening was cancelled or stopped"),
            )
        })
    });
    {
        let mut inner = change.lock();
        inner.view.phase = AudioChangePhase::Reverting;
        inner.deadline = None;
    }
    let stopped = change.lock().stopped;
    let current = owner.state(&shared);
    let previous_selected = current
        .stream
        .as_ref()
        .is_some_and(|stream| AudioChangeHardware::from_stream(stream) == previous);
    let path = &shared.config.preset_dir;
    if applying_failed && !stopped && matches!(recovery::has_marker(path, &id), Ok(false)) {
        let reverting = decision.is_some()
            || change
                .lock()
                .decision
                .as_ref()
                .is_some_and(|request| !request.keep);
        let phase = if (reverting || find_buffer)
            && previous_selected
            && current.phase == AudioPhase::Running
        {
            AudioChangePhase::Reverted
        } else {
            AudioChangePhase::Failed
        };
        let state = change.finish(phase, reason, None).await;
        if let Some(decision) = decision {
            let _ = decision.reply.send(Ok(state));
        }
        return report;
    }
    let result = match recovery::has_marker(path, &id) {
        Err(error) => Err(error),
        Ok(_) if stopped => {
            let until = Instant::now() + OWNER_READY;
            loop {
                if let Some(result) = change.lock().stop_result.clone() {
                    break result;
                }
                let status = owner.state(&shared);
                if !status.device_owned
                    && matches!(status.phase, AudioPhase::Stopped | AudioPhase::Failed)
                {
                    break Ok(());
                }
                if Instant::now() >= until {
                    break Err("The worker has not released the audio device".into());
                }
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
        }
        Ok(_) if previous_selected && current.phase == AudioPhase::Running => Ok(()),
        Ok(_) if applying_failed && previous_selected && current.phase == AudioPhase::Failed => {
            Err(reason
                .clone()
                .unwrap_or_else(|| "The candidate and previous streams both failed".into()))
        }
        Ok(_) => match owner
            .dispatch(&shared, &id, Mode::Restore(previous.clone()))
            .await
        {
            Ok(()) => owner.ready(&shared, &previous).await,
            Err(error) => Err(error),
        },
    };
    // Reconcile the durable stream even when there was no worker to restore it.
    let recovered = match recovery::has_marker(path, &id) {
        Ok(true) => owner.dispatch(&shared, &id, Mode::SealRollback).await,
        Ok(false) => Ok(()),
        Err(error) => Err(error),
    };
    let recovery_error = recovered.as_ref().err().cloned();
    let terminal = match result.and(recovered) {
        Ok(()) => {
            change
                .finish(
                    AudioChangePhase::Reverted,
                    if stopped {
                        Some("The audio settings change was cancelled and audio stopped.".into())
                    } else {
                        reason
                    },
                    recovery_error,
                )
                .await
        }
        Err(error) => {
            change
                .finish(
                    AudioChangePhase::Failed,
                    Some(format!(
                        "Previous audio settings could not be restored: {error}"
                    )),
                    recovery_error,
                )
                .await
        }
    };
    if let Some(decision) = decision {
        let _ = decision.reply.send(Ok(terminal));
    }
    report
}

async fn external_admission(shared: &Shared) -> Result<(), (StatusCode, &'static str)> {
    if shared.captures.busy().await {
        return Err((
            StatusCode::CONFLICT,
            "Finish recording or reamping before trying audio settings",
        ));
    }
    if shared.venues.preview_pending().await {
        return Err((
            StatusCode::CONFLICT,
            "Keep or discard the Venue EQ preview first",
        ));
    }
    #[cfg(unix)]
    if let Some(socket) = &shared.config.device_socket {
        let check = async {
            let network =
                oxidal_device::ipc::request(socket, &oxidal_device::Command::Status {}).await?;
            let packs =
                oxidal_device::ipc::request(socket, &oxidal_device::Command::Packs {}).await?;
            Ok::<_, &'static str>((
                network.state.ok_or("Device status unavailable")?,
                packs.packs.ok_or("Pack status unavailable")?,
            ))
        };
        let Ok(Ok((network, packs))) = tokio::time::timeout(Duration::from_secs(5), check).await
        else {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Device work could not be checked before changing audio settings",
            ));
        };
        if network.pending.is_some() || packs.job.is_some_and(|job| job.phase == "running") {
            return Err((
                StatusCode::CONFLICT,
                "Finish the network or effect-pack operation before trying audio settings",
            ));
        }
    }
    Ok(())
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    media_api::no_store(StatusCode::OK, shared.audio_change.snapshot(&shared))
}

pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<AudioChangeRequest>, JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(value) => value,
        Err(error) => {
            return failure(
                error.status(),
                "Invalid audio settings confirmation request",
            );
        }
    };
    match body {
        AudioChangeRequest::FindBuffer {
            owner,
            session,
            expected_revision,
        } => finder::start(shared, owner, session, expected_revision).await,
        AudioChangeRequest::Apply {
            owner,
            session,
            expected_revision,
            input,
            output,
            input_map,
            output_map,
        } => {
            if let Some(reason) = shared.protect.refuse(false) {
                return protect::locked(reason);
            }
            if shared.captures.busy().await {
                return failure(
                    StatusCode::CONFLICT,
                    "Finish recording or reamping before trying audio settings",
                );
            }
            let current = owner.state(&shared);
            if current.phase != AudioPhase::Running
                || current.session != session
                || current.revision != expected_revision
            {
                return failure(
                    StatusCode::CONFLICT,
                    "The running audio session changed. Refresh and review the settings",
                );
            }
            let Some(mut stream) = current.stream else {
                return failure(StatusCode::SERVICE_UNAVAILABLE, "No confirmed stream");
            };
            let previous = AudioChangeHardware::from_stream(&stream);
            let candidate = AudioChangeHardware {
                input,
                output,
                input_map,
                output_map,
            };
            candidate.set(&mut stream);
            if let Err(error) = stream.validate() {
                return failure(StatusCode::BAD_REQUEST, &error);
            }
            if candidate == previous {
                return failure(StatusCode::BAD_REQUEST, "Choose a different audio setting");
            }
            let id = match shared
                .audio_change
                .begin(owner, previous.clone(), candidate.clone())
            {
                Ok(id) => id,
                Err(error) => return failure(StatusCode::CONFLICT, error),
            };
            let snapshot = shared.audio_change.snapshot(&shared);
            // Once reserved, the daemon owns admission as well as the countdown.
            // Losing HTTP while the helper is replying cannot strand the reservation.
            let (admitted, admission) = oneshot::channel();
            tokio::spawn(async move {
                if let Err((status, reason)) = external_admission(&shared).await {
                    shared
                        .audio_change
                        .finish(AudioChangePhase::Failed, Some(reason.into()), None)
                        .await;
                    let _ = admitted.send(Err((status, reason)));
                    return;
                }
                let _ = admitted.send(Ok(()));
                let mut shutdown = shared.config.shutdown.clone();
                tokio::select! {
                    biased;
                    _ = async {
                        match shutdown.as_mut() {
                            Some(signal) => {
                                if !*signal.borrow() { let _ = signal.changed().await; }
                            }
                            None => std::future::pending::<()>().await,
                        }
                    } => (),
                    _ = run(shared, owner, id, previous, candidate.clone(), Mode::Apply {
                        session, revision: expected_revision, hardware: candidate,
                    }, false) => (),
                }
            });
            match admission.await {
                Ok(Ok(())) => {}
                Ok(Err((status, reason))) => return failure(status, reason),
                Err(_) => {
                    return failure(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Audio settings controller stopped",
                    );
                }
            }
            media_api::no_store(StatusCode::ACCEPTED, snapshot)
        }
        AudioChangeRequest::Keep { id } => settle(shared, &id, true).await,
        AudioChangeRequest::Revert { id } => settle(shared, &id, false).await,
        AudioChangeRequest::Stop { id } => stop(shared, id),
    }
}

fn stop(shared: Arc<Shared>, id: String) -> Response {
    let change = &shared.audio_change;
    let (owner, view) = {
        let mut inner = change.lock();
        if !inner.active() || inner.committed || inner.view.id.as_deref() != Some(&id) {
            return failure(
                StatusCode::CONFLICT,
                "Audio settings preview is no longer current",
            );
        }
        if inner.stop_requested {
            return media_api::no_store(StatusCode::ACCEPTED, inner.view.clone());
        }
        let owner = inner
            .view
            .owner
            .expect("active audio change must have an owner");
        inner.stopped = true;
        inner.stop_requested = true;
        inner.view.phase = AudioChangePhase::Reverting;
        inner.deadline = None;
        (owner, inner.view.clone())
    };
    change.notified.notify_one();
    change.stop_notified.notify_waiters();
    tokio::spawn(async move {
        let result = owner.stop(&shared, id).await;
        let change = &shared.audio_change;
        change.lock().stop_result = Some(result);
        change.stop_notified.notify_waiters();
    });
    media_api::no_store(StatusCode::ACCEPTED, view)
}

async fn settle(shared: Arc<Shared>, id: &str, keep: bool) -> Response {
    {
        let mut inner = shared.audio_change.lock();
        if inner.view.id.as_deref() == Some(id)
            && inner
                .view
                .finder
                .as_ref()
                .is_some_and(finder::BufferFinderState::active)
        {
            if keep {
                return failure(
                    StatusCode::CONFLICT,
                    "Finish buffer screening and use normal Apply before keeping hardware",
                );
            }
            if let Some(finder) = &mut inner.view.finder {
                finder.state = finder::BufferFinderPhase::Cancelling;
            }
            inner.view.message =
                Some("Cancelling buffer screening; restoring the original settings".into());
            let view = inner.view.clone();
            drop(inner);
            shared.audio_change.notified.notify_one();
            return media_api::no_store(StatusCode::ACCEPTED, view);
        }
    }
    if keep && let Some(reason) = shared.protect.refuse(false) {
        return protect::locked(reason);
    }
    let (reply, result) = oneshot::channel();
    {
        let change = &shared.audio_change;
        let mut inner = change.lock();
        let proving = inner.view.phase == AudioChangePhase::Proving
            && inner
                .deadline
                .is_some_and(|deadline| deadline > Instant::now());
        let restarting = !keep && inner.view.phase == AudioChangePhase::Restarting;
        if inner.view.id.as_deref() != Some(id)
            || (!proving && !restarting)
            || inner.stopped
            || inner.deciding
            || inner.decision.is_some()
        {
            return failure(
                StatusCode::CONFLICT,
                "Audio settings preview expired or is no longer current",
            );
        }
        inner.decision = Some(Decision { keep, reply });
        change.notified.notify_one();
    }
    match result.await {
        Ok(Ok(state)) => media_api::no_store(StatusCode::OK, state),
        Ok(Err(error)) => failure(StatusCode::CONFLICT, &error),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
#[test]
fn measurement_silence_is_released_on_error() {
    let change = Change::default();
    let run = || -> Result<(), ()> {
        let _silence = change.silence_measurement();
        assert!(change.measurement_silent());
        Err(())
    };
    assert!(run().is_err());
    assert!(!change.measurement_silent());
}
