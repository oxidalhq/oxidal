//! One actor owns playback and the ALSA permit, independently of HTTP request lifetimes.
use crate::audio_boot::{Choice, Policy, Role};
use crate::playback_recovery::Recovery;
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::eq::{BlockEqState, EqEdit, valid_snapshot};
use oxidal_audio::lifecycle::{
    AudioAction, AudioCommand, AudioPhase, AudioState, LiveControl, LiveRequest, ModelAssignment,
    ModelOperation, ModelPhase, ModelRequest, PlaybackEvent, PlaybackStart, SavePlayback,
    StartAudio, valid_controls, valid_models, valid_preset_name, valid_slots,
};
use oxidal_audio::lifecycle::{EqRequest, PLAYBACK_FRAME_BYTES};
use oxidal_audio::structure::{AuthoringAction, AuthoringRequest};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::{mpsc, oneshot, watch},
};

type Reply = Result<AudioState, String>;
#[derive(Debug)]
pub(super) struct Playback {
    boot: Arc<Policy>,
    pub(super) finished: watch::Receiver<bool>,
    commands: mpsc::Sender<(AudioCommand, oneshot::Sender<Reply>)>,
    state: watch::Receiver<AudioState>,
    meters: watch::Receiver<Option<(oxidal_audio::meter::Snapshot, std::time::Instant)>>,
}
#[derive(Debug)]
struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: Option<BufReader<tokio::process::ChildStdout>>,
    meter_reader: Option<tokio::task::JoinHandle<()>>,
    control_replies: Option<mpsc::Receiver<PlaybackEvent>>,
    _permit: tokio::sync::SemaphorePermit<'static>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        if let Some(reader) = self.meter_reader.take() {
            reader.abort();
        }
    }
}
struct Owner {
    boot: Arc<Policy>,
    worker: Option<Worker>,
    executable: Option<PathBuf>,
    preset_dir: PathBuf,
    state: AudioState,
    resume_controls: Option<Vec<LiveControl>>,
    resume_eq: Option<Vec<BlockEqState>>,
    recovery_due: Option<std::time::Instant>,
    recovery_error: Option<String>,
    updates: watch::Sender<AudioState>,
    meters: watch::Sender<Option<(oxidal_audio::meter::Snapshot, std::time::Instant)>>,
}
impl Owner {
    fn publish(&mut self, phase: AudioPhase, error: Option<String>) {
        self.state.revision += 1;
        self.state.phase = phase;
        if phase != AudioPhase::Running {
            self.state.controls.clear();
            self.state.eq.clear();
            self.state.slots.clear();
            self.state.modified = false;
            self.state.saved_copy = None;
            self.state.model_change = None;
            self.state.authoring = None;
            self.meters.send_replace(None);
        }
        self.state.error = error.or_else(|| self.recovery_error.clone());
        self.state.device_owned = self.worker.is_some();
        self.updates.send_replace(self.state.clone());
    }
    fn schedule_recovery(&mut self) {
        // Coalesce touch updates; continuous adjustment still checkpoints every two seconds.
        self.recovery_due
            .get_or_insert_with(|| std::time::Instant::now() + Duration::from_secs(2));
    }
    fn checkpoint(&mut self) {
        if self.recovery_due.is_none() {
            return;
        }
        let Some(settings) = self.state.configured.clone() else {
            return;
        };
        let result = Recovery::new(
            settings,
            self.resume_controls.clone(),
            self.state.models.clone(),
            self.resume_eq.clone(),
        )
        .write(&self.preset_dir.join("last-audio-session.json"));
        match result {
            Ok(()) => {
                self.recovery_due = None;
                if let Some(previous) = self.recovery_error.take()
                    && self.state.error.as_ref() == Some(&previous)
                {
                    self.publish(self.state.phase, None);
                }
            }
            Err(error) => {
                self.recovery_due = Some(std::time::Instant::now() + Duration::from_secs(5));
                let message = format!(
                    "Session recovery could not be saved: {error}. Current session remains in memory."
                );
                if self.recovery_error.as_ref() != Some(&message) {
                    self.recovery_error = Some(message.clone());
                    self.publish(self.state.phase, Some(message));
                }
            }
        }
    }
    async fn release(&mut self) -> Result<(), String> {
        let Some(worker) = self.worker.as_mut() else {
            return Ok(());
        };
        worker.input.take(); // EOF asks the owner thread to stop and release both PCM handles.
        match tokio::time::timeout(Duration::from_secs(2), worker.child.wait()).await {
            Ok(Ok(_)) => (),
            _ => {
                worker
                    .child
                    .start_kill()
                    .map_err(|e| format!("Cannot stop audio worker: {e}"))?;
                tokio::time::timeout(Duration::from_secs(2), worker.child.wait())
                    .await
                    .map_err(|_| "Audio stop timed out; ownership not released")?
                    .map_err(|e| e.to_string())?;
            }
        }
        self.worker = None; // Only reaping releases the shared device permit.
        Ok(())
    }
    async fn start(
        &mut self,
        settings: StartAudio,
        controls: Option<Vec<LiveControl>>,
        models: Vec<ModelAssignment>,
        eq: Option<Vec<BlockEqState>>,
    ) -> Result<(), String> {
        if !valid_models(&models) || eq.as_ref().is_some_and(|e| !valid_snapshot(e)) {
            return Err("Invalid model assignments".into());
        }
        settings.validate()?;
        let executable = self
            .executable
            .as_ref()
            .ok_or("Experimental audio worker unavailable")?;
        if self.worker.is_some() {
            return Err("Stop audio before changing playback settings".into());
        }
        let permit = crate::audio::PROBE
            .try_acquire()
            .map_err(|_| "Audio device operation already in progress")?;
        std::fs::create_dir_all(&self.preset_dir).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(&self.preset_dir).map_err(|e| e.to_string())?;
        let data = root.join("audio-runtime");
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(executable)
            .env("OXIDAL_PRESET_DIR", &root)
            .env("OXIDAL_QUALIFICATION_DATA", &data)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let output = child.stdout.take().ok_or("audio worker stdout")?;
        let input = child.stdin.take().ok_or("audio worker stdin")?;
        self.worker = Some(Worker {
            child,
            input: Some(input),
            output: Some(BufReader::new(output)),
            meter_reader: None,
            control_replies: None,
            _permit: permit,
        });
        let previous_settings = self.state.configured.replace(settings.clone());
        let previous_controls = std::mem::replace(&mut self.resume_controls, controls.clone());
        let previous_eq = std::mem::replace(&mut self.resume_eq, eq.clone());
        let previous_models = std::mem::replace(&mut self.state.models, models.clone());
        self.publish(AudioPhase::Starting, None);
        let startup = tokio::time::timeout(Duration::from_secs(25), async {
            let mut bytes = serde_json::to_vec(&PlaybackStart {
                settings,
                controls,
                models,
                eq,
            })
            .map_err(|e| e.to_string())?;
            if bytes.len() >= PLAYBACK_FRAME_BYTES {
                return Err("Audio settings too large".into());
            }
            bytes.push(b'\n');
            self.worker
                .as_mut()
                .unwrap()
                .input
                .as_mut()
                .unwrap()
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            let mut response = vec![];
            self.worker
                .as_mut()
                .unwrap()
                .output
                .as_mut()
                .unwrap()
                .take((PLAYBACK_FRAME_BYTES + 1) as u64)
                .read_until(b'\n', &mut response)
                .await
                .map_err(|e| e.to_string())?;
            if response.len() > PLAYBACK_FRAME_BYTES || response.last() != Some(&b'\n') {
                return Err(
                    "Audio worker could not start; check device/settings/preset and service log"
                        .into(),
                );
            }
            let event: PlaybackEvent =
                serde_json::from_slice(&response).map_err(|_| "Invalid native startup reply")?;
            let PlaybackEvent::Ready {
                preset_name,
                authoring,
                controls,
                slots,
                eq,
            } = event
            else {
                return Err("Expected native readiness".into());
            };
            if preset_name.is_empty()
                || preset_name.len() > 1024
                || !valid_controls(&controls)
                || !valid_slots(&slots)
                || !valid_snapshot(&eq)
            {
                return Err("Invalid native controls".into());
            }
            if authoring.as_ref().is_some_and(|s| !s.valid()) {
                return Err("Invalid authoring readback".into());
            }
            self.state.authoring = authoring;
            self.state.preset_name = Some(preset_name);
            self.state.controls = controls;
            self.state.slots = slots;
            self.state.eq = eq;
            self.resume_eq = Some(self.state.eq.clone());
            self.state.modified = self
                .state
                .configured
                .as_ref()
                .is_some_and(|s| s.draft || s.working.is_some())
                || self.resume_controls.is_some()
                || !self.state.models.is_empty();
            Ok(())
        })
        .await
        .map_err(|_| "Audio startup timed out".to_owned())
        .and_then(|r| r);
        if let Err(error) = startup {
            self.state.configured = previous_settings;
            self.resume_controls = previous_controls;
            self.resume_eq = previous_eq;
            self.state.models = previous_models;
            self.release().await?;
            return Err(error);
        }
        self.schedule_recovery();
        self.publish(AudioPhase::Running, None);
        let mut output = self.worker.as_mut().unwrap().output.take().unwrap();
        let meters = self.meters.clone();
        let (replies, received) = mpsc::channel(1);
        self.worker.as_mut().unwrap().control_replies = Some(received);
        self.worker.as_mut().unwrap().meter_reader = Some(tokio::spawn(async move {
            loop {
                let mut bytes = Vec::new();
                let read = (&mut output)
                    .take((PLAYBACK_FRAME_BYTES + 1) as u64)
                    .read_until(b'\n', &mut bytes)
                    .await;
                if read.is_err()
                    || bytes.len() > PLAYBACK_FRAME_BYTES
                    || bytes.last() != Some(&b'\n')
                {
                    break;
                }
                let Ok(event) = serde_json::from_slice::<PlaybackEvent>(&bytes) else {
                    break;
                };
                match event {
                    PlaybackEvent::Meter { snapshot } if snapshot.valid() => {
                        meters.send_replace(Some((snapshot, std::time::Instant::now())));
                    }
                    reply @ (PlaybackEvent::Control { .. }
                    | PlaybackEvent::Model { .. }
                    | PlaybackEvent::Eq { .. }
                    | PlaybackEvent::Authored { .. }) => {
                        if replies.try_send(reply).is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        }));
        Ok(())
    }
    async fn prepare_parameter(&mut self, parameter: String, value: f32) -> Reply {
        if self.state.phase != AudioPhase::Running
            || self.model_pending()
            || self
                .state
                .authoring
                .as_ref()
                .is_some_and(|s| s.tools.measuring())
            || !self.state.authoring.as_ref().is_some_and(|s| {
                s.settings
                    .iter()
                    .any(|p| p.target == parameter && p.accepts(value))
            })
        {
            return Err("Start audio and select a valid prepared setting".into());
        }
        let previous = self
            .state
            .configured
            .clone()
            .ok_or("Missing native session")?;
        let controls = self.state.controls.clone();
        let eq = self.state.eq.clone();
        let models = self.state.models.clone();
        let request = oxidal_audio::structure::PrepareParameter {
            playback: SavePlayback {
                settings: previous.clone(),
                controls: controls.clone(),
                models: models.clone(),
                eq: Some(eq.clone()),
                name: "Working session".into(),
            },
            parameter: parameter.clone(),
            value,
        };
        let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if bytes.len() >= PLAYBACK_FRAME_BYTES {
            return Err("Native preparation exceeds byte budget".into());
        }
        let root = std::fs::canonicalize(&self.preset_dir).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(
            self.executable
                .as_ref()
                .ok_or("Native worker unavailable")?,
        )
        .arg("--prepare-parameter")
        .env("OXIDAL_PRESET_DIR", &root)
        .env("OXIDAL_QUALIFICATION_DATA", root.join("audio-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
        let prepared = tokio::time::timeout(Duration::from_secs(25), async {
            let mut input = child.stdin.take().ok_or("Preparation input unavailable")?;
            input.write_all(&bytes).await.map_err(|e| e.to_string())?;
            input.shutdown().await.map_err(|e| e.to_string())?;
            drop(input);
            let mut output = vec![];
            child
                .stdout
                .take()
                .ok_or("Preparation output unavailable")?
                .take(66)
                .read_to_end(&mut output)
                .await
                .map_err(|e| e.to_string())?;
            if !child.wait().await.map_err(|e| e.to_string())?.success() {
                return Err("Native setting preparation failed; playing sound unchanged".to_owned());
            }
            let id = std::str::from_utf8(&output)
                .map_err(|e| e.to_string())?
                .trim();
            if !oxidal_audio::structure::valid_receipt(id) {
                return Err("Invalid prepared setting receipt".into());
            }
            Ok(id.to_owned())
        })
        .await
        .map_err(|_| "Native setting preparation timed out; playing sound unchanged".to_owned())
        .and_then(|r| r);
        if prepared.is_err() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        let receipt = prepared?;
        self.checkpoint();
        self.publish(AudioPhase::Stopping, None);
        self.release().await?;
        let mut proposed = previous.clone();
        proposed.working = Some(receipt);
        match self.start(proposed, None, vec![], None).await {
            Ok(()) => Ok(self.state.clone()),
            Err(error) => {
                let message = match self.start(previous, Some(controls), models, Some(eq)).await {
                    Ok(()) => {
                        let message =
                            format!("Setting not applied: {error}. Previous session restored.");
                        self.publish(AudioPhase::Running, Some(message.clone()));
                        message
                    }
                    Err(rollback) => {
                        let message =
                            format!("Setting failed: {error}; rollback failed: {rollback}");
                        self.publish(AudioPhase::Failed, Some(message.clone()));
                        message
                    }
                };
                Err(message)
            }
        }
    }
    async fn authoring_command(&mut self, action: AuthoringAction) -> Reply {
        if self.state.phase != AudioPhase::Running || self.model_pending() {
            return Err(
                "Start audio and finish model preparation before authoring the chain".into(),
            );
        }
        let mutating = action.changes_tone();
        let utility_poll = matches!(
            action,
            AuthoringAction::Utility {
                command: oxidal_audio::tools::Command::Poll
            }
        );
        let serial = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Audio revision exhausted")?;
        let mut bytes = serde_json::to_vec(&AuthoringRequest {
            serial,
            authoring: action,
        })
        .map_err(|e| e.to_string())?;
        if bytes.len() >= 65536 {
            return Err("Native authoring request exceeds byte budget".into());
        }
        bytes.push(b'\n');
        let worker = self.worker.as_mut().ok_or("Audio is not running")?;
        let result = tokio::time::timeout(Duration::from_secs(25), async {
            worker
                .input
                .as_mut()
                .ok_or("Audio input closed")?
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            let reply = worker
                .control_replies
                .as_mut()
                .ok_or("Audio replies closed")?
                .recv()
                .await
                .ok_or("Authoring reply lost")?;
            let PlaybackEvent::Authored {
                serial: actual,
                authoring,
                controls,
                slots,
                eq,
                error,
            } = reply
            else {
                return Err("Unexpected authoring reply".to_owned());
            };
            if actual != serial
                || !authoring.valid()
                || !valid_controls(&controls)
                || !valid_slots(&slots)
                || !valid_snapshot(&eq)
                || mutating && error.is_none() && authoring.working.is_none()
            {
                return Err("Invalid native authoring readback".into());
            }
            Ok((authoring, controls, slots, eq, error))
        })
        .await
        .map_err(|_| "Native authoring timed out; outcome unknown".to_owned())
        .and_then(|r| r);
        let (authoring, controls, slots, eq, error) = match result {
            Ok(value) => value,
            Err(error) => {
                self.release().await?;
                self.publish(AudioPhase::Failed, Some(error.clone()));
                return Err(error);
            }
        };
        if let Some(error) = error {
            self.state.authoring = Some(authoring);
            self.state.controls = controls.clone();
            self.state.eq = eq.clone();
            self.state.slots = slots;
            self.resume_controls = Some(controls);
            self.resume_eq = Some(eq);
            self.updates.send_replace(self.state.clone());
            return Err(error);
        }
        let mutating = mutating
            || authoring.working
                != self
                    .state
                    .configured
                    .as_ref()
                    .and_then(|s| s.working.clone());
        if mutating {
            self.state
                .configured
                .as_mut()
                .ok_or("Missing configured native session")?
                .working = authoring.working.clone();
            self.state.models.clear();
            self.state.model_change = None;
            self.state.modified = true;
            self.state.saved_copy = None;
            self.schedule_recovery();
        }
        let scalar_changed =
            serde_json::to_vec(&self.state.controls).ok() != serde_json::to_vec(&controls).ok();
        if scalar_changed {
            self.state.modified = true;
            self.state.saved_copy = None;
            self.schedule_recovery();
        }
        self.state.authoring = Some(authoring);
        self.state.slots = slots;
        self.state.controls = controls.clone();
        self.state.eq = eq.clone();
        self.resume_controls = Some(controls);
        self.resume_eq = Some(eq);
        if utility_poll && !mutating {
            self.updates.send_replace(self.state.clone());
        } else {
            self.publish(AudioPhase::Running, None);
        }
        Ok(self.state.clone())
    }
    async fn poll_tools(&mut self) {
        if self.state.phase != AudioPhase::Running
            || self.model_pending()
            || !self
                .state
                .authoring
                .as_ref()
                .is_some_and(|s| s.tools.active() || s.gesture.is_some())
        {
            return;
        }
        if let Err(error) = self
            .authoring_command(AuthoringAction::Utility {
                command: oxidal_audio::tools::Command::Poll,
            })
            .await
            && self.state.phase == AudioPhase::Running
        {
            let _ = self.authoring_command(AuthoringAction::Inspect).await;
            self.state.error = Some(error);
            self.updates.send_replace(self.state.clone());
        }
    }
    async fn set_control(&mut self, target: String, value: f32) -> Result<(), String> {
        let serial = self.state.revision + 1;
        let worker = self.worker.as_mut().ok_or("Audio is not running")?;
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let mut bytes = serde_json::to_vec(&LiveRequest {
                serial,
                target,
                value,
            })
            .map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            worker
                .input
                .as_mut()
                .ok_or("Audio input closed")?
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            let reply = worker
                .control_replies
                .as_mut()
                .ok_or("Audio replies closed")?
                .recv()
                .await
                .ok_or("Audio reply lost")?;
            let PlaybackEvent::Control {
                serial: actual,
                controls,
                error,
            } = reply
            else {
                return Err("Unexpected audio reply".to_string());
            };
            if actual != serial || !valid_controls(&controls) {
                return Err("Invalid audio control readback".into());
            }
            if let Some(error) = error {
                return Err(error);
            }
            Ok(controls)
        })
        .await
        .map_err(|_| "Audio control timed out".to_string())
        .and_then(|r| r);
        match result {
            Ok(controls) => {
                self.resume_controls = Some(controls.clone());
                self.schedule_recovery();
                self.state.controls = controls;
                self.state.modified = true;
                self.state.saved_copy = None;
                self.publish(AudioPhase::Running, None);
                Ok(())
            }
            Err(error) => {
                self.release().await?;
                Err(error)
            }
        }
    }
    async fn set_eq(&mut self, block_id: String, edit: EqEdit) -> Result<(), String> {
        let mut expected = self.state.eq.clone();
        let row = expected
            .iter_mut()
            .find(|s| s.block_id == block_id)
            .ok_or("Unknown EQ target")?;
        edit.apply(&mut row.eq)?;
        if expected == self.state.eq {
            return Ok(());
        }
        let serial = self.state.revision + 1;
        let worker = self.worker.as_mut().ok_or("Audio is not running")?;
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let mut bytes = serde_json::to_vec(&EqRequest {
                serial,
                block_id,
                eq: edit,
            })
            .map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            worker
                .input
                .as_mut()
                .ok_or("Audio input closed")?
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            let event = worker
                .control_replies
                .as_mut()
                .ok_or("Audio replies closed")?
                .recv()
                .await
                .ok_or("Audio reply lost")?;
            match event {
                PlaybackEvent::Eq {
                    serial: actual,
                    eq,
                    error: None,
                } if actual == serial && valid_snapshot(&eq) && eq == expected => Ok(eq),
                _ => Err("EQ edit could not be confirmed".to_owned()),
            }
        })
        .await
        .map_err(|_| "EQ edit timed out".to_owned())
        .and_then(|r| r);
        match result {
            Ok(eq) => {
                self.state.eq = eq.clone();
                self.resume_eq = Some(eq);
                self.resume_controls = Some(self.state.controls.clone());
                self.state.modified = true;
                self.state.saved_copy = None;
                self.schedule_recovery();
                self.publish(AudioPhase::Running, None);
                Ok(())
            }
            Err(error) => {
                self.release().await?;
                Err(error)
            }
        }
    }
    fn model_pending(&self) -> bool {
        self.state
            .model_change
            .as_ref()
            .is_some_and(|p| p.phase.pending())
    }
    async fn model_exchange(&mut self, operation: ModelOperation) -> Result<PlaybackEvent, String> {
        let serial = self.state.revision + 1;
        let worker = self.worker.as_mut().ok_or("Audio is not running")?;
        tokio::time::timeout(Duration::from_secs(2), async {
            let mut bytes = serde_json::to_vec(&ModelRequest {
                serial,
                model: operation,
            })
            .map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            worker
                .input
                .as_mut()
                .ok_or("Audio input closed")?
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            let event = worker
                .control_replies
                .as_mut()
                .ok_or("Audio replies closed")?
                .recv()
                .await
                .ok_or("Audio reply lost")?;
            match &event {
                PlaybackEvent::Model {
                    serial: actual,
                    controls,
                    progress,
                    slots,
                    eq,
                    ..
                } if *actual == serial
                    && valid_controls(controls)
                    && valid_slots(slots)
                    && valid_snapshot(eq)
                    && progress.as_ref().is_none_or(|p| {
                        p.assignment.valid() && p.error.as_ref().is_none_or(|s| s.len() <= 1024)
                    }) =>
                {
                    Ok(event)
                }
                _ => Err("Invalid model worker reply".into()),
            }
        })
        .await
        .map_err(|_| "Model worker reply timed out".to_owned())?
    }
    async fn model_command(&mut self, operation: ModelOperation) -> Reply {
        if let ModelOperation::Prepare { assignment } = &operation {
            let mut prospective = self.state.models.clone();
            if let Some(previous) = prospective
                .iter_mut()
                .find(|m| m.target == assignment.target)
            {
                *previous = assignment.clone();
            } else {
                prospective.push(assignment.clone());
            }
            if !valid_models(&prospective) {
                return Err("Model assignments exceed the control-state byte budget".into());
            }
        }
        let expected_request = match &operation {
            ModelOperation::Prepare { .. } => Some(self.state.revision + 1),
            _ => self.state.model_change.as_ref().map(|p| p.request),
        };
        let expected = match &operation {
            ModelOperation::Prepare { assignment } => Some(assignment.clone()),
            _ => self
                .state
                .model_change
                .as_ref()
                .map(|p| p.assignment.clone()),
        };
        let event = match self.model_exchange(operation).await {
            Ok(event) => event,
            Err(error) => {
                self.release().await?;
                self.publish(AudioPhase::Failed, Some(error.clone()));
                return Err(error);
            }
        };
        let PlaybackEvent::Model {
            progress,
            controls,
            slots,
            eq,
            error,
            ..
        } = event
        else {
            unreachable!()
        };
        // A rejected candidate is a model error, never a reason to stop healthy PCM.
        if let Some(error) = error {
            return Err(error);
        }
        if progress.as_ref().map(|p| &p.assignment) != expected.as_ref()
            || progress.as_ref().map(|p| p.request) != expected_request
        {
            self.release().await?;
            self.publish(
                AudioPhase::Failed,
                Some("Model assignment reply differs".into()),
            );
            return Err("Model assignment reply differs".into());
        }
        if self.state.model_change != progress {
            let refresh_authoring = self.state.authoring.is_some()
                && progress
                    .as_ref()
                    .is_some_and(|p| p.phase == ModelPhase::Applied);
            if let Some(p) = &progress
                && p.phase == ModelPhase::Applied
            {
                // Preserve insertion chronology: later slots depend on earlier fills.
                if let Some(previous) = self
                    .state
                    .models
                    .iter_mut()
                    .find(|m| m.target == p.assignment.target)
                {
                    *previous = p.assignment.clone();
                } else {
                    self.state.models.push(p.assignment.clone());
                }
                self.state.slots = slots;
                self.state.authoring = None;
                self.state.eq = eq.clone();
                self.resume_eq = Some(eq);
                self.state.controls = controls.clone();
                self.resume_controls = Some(controls);
                self.state.modified = true;
                self.state.saved_copy = None;
                self.schedule_recovery();
            }
            let error = progress.as_ref().and_then(|p| p.error.clone());
            self.state.model_change = progress;
            if refresh_authoring {
                // Publish model completion and its structural catalog together.
                // A client must never see Applied with a cursor about to advance
                // solely for the supervisor's internal metadata readback.
                self.authoring_command(AuthoringAction::Inspect).await?;
            } else {
                self.publish(AudioPhase::Running, error);
            }
        }
        Ok(self.state.clone())
    }
    async fn advance_model(&mut self) {
        if self.state.phase != AudioPhase::Running || !self.model_pending() {
            return;
        }
        let operation = if self
            .state
            .model_change
            .as_ref()
            .is_some_and(|p| p.phase == ModelPhase::Ready)
        {
            ModelOperation::Commit
        } else {
            ModelOperation::Poll
        };
        if let Err(error) = self.model_command(operation).await
            && self.state.phase == AudioPhase::Running
        {
            if let Some(p) = &mut self.state.model_change {
                p.phase = ModelPhase::Failed;
                p.error = Some(error.clone());
            }
            self.publish(AudioPhase::Running, Some(error));
        }
    }
    async fn create(&mut self, stream: oxidal_audio::StreamConfig, name: String) -> Reply {
        stream.validate()?;
        if !valid_preset_name(&name) || self.worker.is_some() {
            return Err("Stop audio and enter a valid name before creating a new rig".into());
        }
        let name = name.trim().to_owned();
        let mut bytes = serde_json::to_vec(&name).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        std::fs::create_dir_all(&self.preset_dir).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(&self.preset_dir).map_err(|e| e.to_string())?;
        let data = root.join("create-runtime");
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(
            self.executable
                .as_ref()
                .ok_or("Native worker unavailable")?,
        )
        .arg("--create-draft")
        .env("OXIDAL_PRESET_DIR", &root)
        .env("OXIDAL_QUALIFICATION_DATA", &data)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
        let result = tokio::time::timeout(Duration::from_secs(25), async {
            let mut input = child.stdin.take().ok_or("Creation input unavailable")?;
            input.write_all(&bytes).await.map_err(|e| e.to_string())?;
            drop(input);
            let mut output = vec![];
            child
                .stdout
                .take()
                .ok_or("Creation output unavailable")?
                .take(66)
                .read_to_end(&mut output)
                .await
                .map_err(|e| e.to_string())?;
            if output.len() != 65 || output.last() != Some(&b'\n') {
                return Err("Could not prepare an empty native rig".to_owned());
            }
            if !child.wait().await.map_err(|e| e.to_string())?.success() {
                return Err("Native creation worker failed".into());
            }
            let id =
                String::from_utf8(output[..64].to_vec()).map_err(|_| "Invalid draft identity")?;
            let info = oxidal_presets::OwnedStore::new(root.join("working-native"))
                .read(&id)
                .map_err(|e| e.to_string())?
                .0;
            if info.preset.name != name || info.source_sha256.is_some() {
                return Err("Created draft metadata differs".into());
            }
            Ok(id)
        })
        .await
        .map_err(|_| "New rig preparation timed out".to_owned())
        .and_then(|r| r);
        if result.is_err() {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        }
        let id = result?;
        let started = self
            .start(
                StartAudio {
                    stream,
                    preset_id: id,
                    owned: false,
                    draft: true,
                    working: None,
                },
                None,
                vec![],
                None,
            )
            .await;
        if let Err(error) = started {
            self.publish(AudioPhase::Failed, Some(error.clone()));
            return Err(error);
        }
        Ok(self.state.clone())
    }
    async fn save_copy(&mut self, name: String) -> Reply {
        if self.model_pending() {
            return Err("Wait for model audition or cancel before saving".into());
        }
        if self.state.phase != AudioPhase::Running || !valid_preset_name(&name) {
            return Err(
                "Start audio and enter a name of 1–100 bytes without control characters".into(),
            );
        }
        let request = SavePlayback {
            settings: self
                .state
                .configured
                .clone()
                .ok_or("No sounding configuration")?,
            controls: self.state.controls.clone(),
            models: self.state.models.clone(),
            eq: Some(self.state.eq.clone()),
            name,
        };
        let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if bytes.len() >= PLAYBACK_FRAME_BYTES {
            return Err("Save catalog too large".into());
        }
        bytes.push(b'\n');
        let root = std::fs::canonicalize(&self.preset_dir).map_err(|e| e.to_string())?;
        let data = root.join("save-runtime");
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(
            self.executable
                .as_ref()
                .ok_or("Native worker unavailable")?,
        )
        .arg("--save-copy")
        .env("OXIDAL_PRESET_DIR", &root)
        .env("OXIDAL_QUALIFICATION_DATA", &data)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
        let result = tokio::time::timeout(Duration::from_secs(25), async {
            let mut input = child.stdin.take().ok_or("Save input unavailable")?;
            input.write_all(&bytes).await.map_err(|e| e.to_string())?;
            drop(input);
            let mut output = vec![];
            child
                .stdout
                .take()
                .ok_or("Save output unavailable")?
                .take(66)
                .read_to_end(&mut output)
                .await
                .map_err(|e| e.to_string())?;
            if output.len() != 65 || output.last() != Some(&b'\n') {
                return Err(
                    "Could not save a verified native copy; sounding audio was not changed"
                        .to_owned(),
                );
            }
            if !child.wait().await.map_err(|e| e.to_string())?.success() {
                return Err("Native copy worker failed; sounding audio was not changed".into());
            }
            let id =
                String::from_utf8(output[..64].to_vec()).map_err(|_| "Invalid saved identity")?;
            let info = oxidal_presets::OwnedStore::new(root.join("owned"))
                .read(&id)
                .map_err(|e| e.to_string())?
                .0;
            if info.preset.name != request.name.trim() {
                return Err("Saved name differs".into());
            }
            Ok(id)
        })
        .await
        .map_err(|_| "Save timed out; check Library before retrying".to_owned())
        .and_then(|r| r);
        // Reap only this export process, never release the sounding worker/PCM permit.
        if result.is_err() {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        }
        let id = result?;
        self.check_exit();
        self.state.saved_copy = Some(id);
        self.publish(self.state.phase, self.state.error.clone());
        Ok(self.state.clone())
    }
    async fn reconfigure(&mut self, stream: oxidal_audio::StreamConfig) -> Reply {
        // Validate before releasing audio. Device support is established by worker readiness.
        stream.validate()?;
        let previous = self
            .state
            .configured
            .clone()
            .ok_or("No previous audio configuration")?;
        let mut proposed = previous.clone();
        proposed.stream = stream;
        let controls = self.resume_controls.clone();
        let was_running = self.state.phase == AudioPhase::Running;
        self.checkpoint();
        self.publish(AudioPhase::Stopping, None);
        if let Err(error) = self.release().await {
            self.publish(AudioPhase::Failed, Some(error.clone()));
            return Err(error);
        }
        match self
            .start(
                proposed,
                controls.clone(),
                self.state.models.clone(),
                self.resume_eq.clone(),
            )
            .await
        {
            Ok(()) => Ok(self.state.clone()),
            Err(error) => {
                // start restores the last confirmed configuration on failure. Roll back
                // only a previously running stream; a stopped session stays stopped.
                let message = if was_running {
                    match self
                        .start(
                            previous,
                            controls,
                            self.state.models.clone(),
                            self.resume_eq.clone(),
                        )
                        .await
                    {
                        Ok(()) => {
                            let message = format!(
                                "Audio settings were not applied: {error}. Previous session restored."
                            );
                            self.publish(AudioPhase::Running, Some(message.clone()));
                            return Err(message);
                        }
                        Err(restore) => format!(
                            "Audio settings were not applied: {error}. Previous session could not resume: {restore}"
                        ),
                    }
                } else {
                    format!(
                        "Audio settings were not applied: {error}. Previous configuration retained; retry Resume when the device is available."
                    )
                };
                self.publish(AudioPhase::Failed, Some(message.clone()));
                Err(message)
            }
        }
    }
    async fn command(&mut self, command: AudioCommand) -> Reply {
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("audio_state_conflict; refresh status before retrying".into());
        }
        if self.executable.is_none()
            && !matches!(command.action, AudioAction::SetBoot { enabled: false })
        {
            return Err("Experimental audio worker unavailable".into());
        }
        if self
            .state
            .authoring
            .as_ref()
            .is_some_and(|s| s.tools.measuring())
            && !matches!(
                &command.action,
                AudioAction::Stop
                    | AudioAction::Authoring {
                        action: AuthoringAction::Utility { .. }
                    }
            )
        {
            return Err("Wait for measurement or cancel it before changing sound".into());
        }
        if self
            .state
            .authoring
            .as_ref()
            .is_some_and(|s| s.gesture.is_some())
            && !matches!(
                &command.action,
                AudioAction::Stop | AudioAction::Authoring { .. }
            )
        {
            return Err("Finish the active adjustment before changing sound".into());
        }
        let result = match command.action {
            AudioAction::Create { stream, name } => return self.create(stream, name).await,
            AudioAction::Authoring {
                action: AuthoringAction::Parameter { parameter, value },
            } => return self.prepare_parameter(parameter, value).await,
            AudioAction::Authoring { action } => return self.authoring_command(action).await,
            // A failed export must not mark the independently running audio failed.
            AudioAction::ReplaceModel { mut assignment } => {
                if self.state.phase != AudioPhase::Running
                    || !assignment.valid()
                    || self.model_pending()
                {
                    return Err("Start audio and finish or cancel the pending model first".into());
                }
                let target = format!("block:{}:enabled", assignment.target);
                let insertion = if self.state.controls.iter().any(|c| c.target == target) {
                    self.state
                        .models
                        .iter()
                        .find(|m| m.target == assignment.target)
                        .and_then(|m| m.insertion.clone())
                } else {
                    Some(
                        self.state
                            .slots
                            .iter()
                            .find(|s| s.target == assignment.target)
                            .ok_or("Select an existing sounding block or current insertion slot")?
                            .position
                            .clone(),
                    )
                };
                if assignment.insertion.is_some() && assignment.insertion != insertion {
                    return Err("Insertion position changed; refresh the sounding chain".into());
                }
                assignment.insertion = insertion;
                return self
                    .model_command(ModelOperation::Prepare { assignment })
                    .await;
            }
            AudioAction::CancelModel { request } => {
                if self
                    .state
                    .model_change
                    .as_ref()
                    .is_none_or(|p| p.request != request)
                {
                    return Err("Model selection changed; refresh before cancelling".into());
                }
                return self.model_command(ModelOperation::Cancel).await;
            }
            AudioAction::SaveCopy { name } => return self.save_copy(name).await,
            AudioAction::Reconfigure { stream } => return self.reconfigure(stream).await,
            AudioAction::SetEq { block_id, edit } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Start audio before adjusting EQ".into());
                }
                let mut candidate = self
                    .state
                    .eq
                    .iter()
                    .find(|s| s.block_id == block_id)
                    .ok_or("Unknown EQ target")?
                    .eq
                    .clone();
                edit.apply(&mut candidate)?;
                if self.model_pending() {
                    return Err("Finish model audition before adjusting EQ".into());
                }
                self.set_eq(block_id, edit).await
            }
            AudioAction::SetControl { target, value } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Start audio before changing live controls".into());
                }
                if !self
                    .state
                    .controls
                    .iter()
                    .any(|p| p.target == target && p.accepts(value))
                {
                    return Err("Unknown, staged or invalid live control".into());
                }
                if self.model_pending() {
                    self.model_command(ModelOperation::Cancel).await?;
                }
                self.set_control(target, value).await
            }
            AudioAction::Start { settings } => {
                // Reject invalid requests without disturbing a stream already running.
                settings.validate()?;
                if self.worker.is_some() {
                    return Err(
                        "Audio already owns the device; stop before applying changes".into(),
                    );
                }
                self.start(settings, None, vec![], None).await
            }
            AudioAction::Resume => {
                let settings = self
                    .state
                    .configured
                    .clone()
                    .ok_or("No previous audio configuration")?;
                if self.worker.is_some() {
                    return Err("Audio is already running".into());
                }
                self.start(
                    settings,
                    self.resume_controls.clone(),
                    self.state.models.clone(),
                    self.resume_eq.clone(),
                )
                .await
            }
            AudioAction::Stop => {
                self.checkpoint();
                self.publish(AudioPhase::Stopping, None);
                match self.release().await {
                    Ok(()) => {
                        self.publish(AudioPhase::Stopped, None);
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            AudioAction::SetBoot { enabled } => {
                if enabled {
                    if self.state.phase != AudioPhase::Running || self.model_pending() {
                        return Err("Start audio and finish pending model changes before enabling boot playback".into());
                    }
                    self.boot.set(Choice::Native {
                        settings: self
                            .state
                            .configured
                            .clone()
                            .ok_or("No audio configuration")?,
                        controls: self.resume_controls.clone(),
                        models: self.state.models.clone(),
                        eq: self.resume_eq.clone(),
                    })?;
                } else {
                    self.boot.clear(Role::Native)?;
                }
                self.state.start_on_boot = self.boot.enabled(Role::Native);
                self.publish(self.state.phase, self.state.error.clone());
                Ok(())
            }
            AudioAction::Restart => {
                let settings = self
                    .state
                    .configured
                    .clone()
                    .ok_or("No previous audio configuration")?;
                self.publish(AudioPhase::Stopping, None);
                match self.release().await {
                    Ok(()) => {
                        self.start(
                            settings,
                            self.resume_controls.clone(),
                            self.state.models.clone(),
                            self.resume_eq.clone(),
                        )
                        .await
                    }
                    Err(e) => Err(e),
                }
            }
        };
        if let Err(error) = result {
            self.publish(AudioPhase::Failed, Some(error.clone()));
            return Err(error);
        }
        Ok(self.state.clone())
    }
    fn check_exit(&mut self) {
        if let Some(worker) = self.worker.as_mut() {
            match worker.child.try_wait() {
                Ok(Some(status)) => {
                    self.worker = None;
                    self.publish(
                        AudioPhase::Failed,
                        Some(format!(
                            "Audio worker exited ({status}); authoring is still available"
                        )),
                    );
                }
                Err(e) => self.publish(
                    AudioPhase::Failed,
                    Some(format!("Audio worker status unknown: {e}")),
                ),
                Ok(None) => (),
            }
        }
    }
}
impl Playback {
    pub fn new(config: &Config, policy: Arc<Policy>) -> Result<Self, String> {
        if let Some(path) = &config.audio_worker
            && (!path.is_absolute() || !path.is_file())
        {
            return Err("Audio worker must be a configured absolute executable".into());
        }
        let boot = policy.snapshot();
        let recovery = Recovery::read(&config.preset_dir.join("last-audio-session.json"));
        let recovery_error = recovery.as_ref().err().cloned();
        let recovery = recovery.ok().flatten();
        let initial = AudioState {
            boot_error: policy.error(),
            session: format!(
                "audio-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos()
            ),
            revision: 0,
            controls: vec![],
            eq: vec![],
            modified: false,
            preset_name: None,
            saved_copy: None,
            models: recovery
                .as_ref()
                .map(|r| r.models.clone())
                .unwrap_or_default(),
            model_change: None,
            authoring: None,
            slots: vec![],
            phase: if config.audio_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: recovery.as_ref().map(|r| r.settings.clone()),
            error: recovery_error.clone(),
            device_owned: false,
            experimental: true,
            start_on_boot: policy.enabled(Role::Native),
        };
        let (updates, state) = watch::channel(initial.clone());
        let (meters, meter_state) = watch::channel(None);
        let (commands, mut receiver) = mpsc::channel::<(AudioCommand, oneshot::Sender<Reply>)>(1);
        let mut owner = Owner {
            boot: policy.clone(),
            worker: None,
            executable: config.audio_worker.clone(),
            preset_dir: config.preset_dir.clone(),
            state: initial,
            resume_eq: recovery.as_ref().and_then(|r| r.eq.clone()),
            resume_controls: recovery.and_then(|r| r.controls),
            recovery_due: None,
            recovery_error,
            updates,
            meters,
        };
        let mut shutdown = config.shutdown.clone();
        let (done, finished) = watch::channel(false);
        tokio::spawn(async move {
            match boot {
                Ok(Some(Choice::Native {
                    settings,
                    controls,
                    models,
                    eq,
                })) if owner.executable.is_some() => {
                    if let Err(error) = owner.start(settings, controls, models, eq).await {
                        owner.publish(AudioPhase::Failed, Some(error));
                    }
                }
                // A corrupt preference is reported separately; audio was never started.
                _ => (),
            }
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                tokio::select! {
                    biased;
                    _ = async { match shutdown.as_mut() { Some(s) => { if !*s.borrow() { let _ = s.changed().await; } }, None => std::future::pending::<()>().await } } => break,
                    item = receiver.recv() => match item {
                        Some((command, response)) => { let _ = response.send(owner.command(command).await); },
                        None => break,
                    },
                    _ = interval.tick() => {
                        owner.check_exit();
                        owner.advance_model().await;
                        owner.poll_tools().await;
                        if owner.recovery_due.is_some_and(|due| due <= std::time::Instant::now()) {
                            owner.checkpoint();
                        }
                    },
                }
            }
            owner.checkpoint();
            // Retain the permit if the OS has not reaped a failed/stuck worker yet.
            while owner.worker.is_some() {
                if owner.release().await.is_err() {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
            done.send_replace(true);
        });
        Ok(Self {
            boot: policy,
            commands,
            state,
            finished,
            meters: meter_state,
        })
    }
    pub fn telemetry(&self) -> Option<(oxidal_audio::meter::Snapshot, std::time::Instant)> {
        *self.meters.borrow()
    }
    pub(super) fn subscribe(&self) -> watch::Receiver<AudioState> {
        self.state.clone()
    }
    pub fn snapshot(&self) -> AudioState {
        let mut state = self.state.borrow().clone();
        state.boot_error = self.boot.error();
        state.start_on_boot = self.boot.enabled(Role::Native);
        state
    }
    async fn dispatch(&self, command: AudioCommand) -> Reply {
        let (response, received) = oneshot::channel();
        self.commands
            .try_send((command, response))
            .map_err(|_| "audio_busy")?;
        // The owner retains its command even when this client disconnects.
        let mut state = received
            .await
            .map_err(|_| "Audio owner stopped".to_owned())??;
        state.boot_error = self.boot.error();
        state.start_on_boot = self.boot.enabled(Role::Native);
        Ok(state)
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Json<AudioState> {
    Json(shared.playback.snapshot())
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<AudioCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "invalid_audio_command");
    };
    match shared.playback.dispatch(command).await {
        Ok(state) => Json(state).into_response(),
        Err(error) => failure(StatusCode::CONFLICT, &error),
    }
}
