//! One actor owns playback and the ALSA permit, independently of HTTP request lifetimes.
use crate::playback_recovery::Recovery;
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::{
    AudioAction, AudioCommand, AudioPhase, AudioState, LiveControl, LiveRequest, ModelAssignment,
    ModelOperation, ModelPhase, ModelRequest, PlaybackEvent, PlaybackStart, SavePlayback,
    StartAudio, valid_controls, valid_models, valid_preset_name,
};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::{mpsc, oneshot, watch},
};

type Reply = Result<AudioState, String>;
#[derive(Debug)]
pub(super) struct Playback {
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
    worker: Option<Worker>,
    executable: Option<PathBuf>,
    preset_dir: PathBuf,
    state: AudioState,
    resume_controls: Option<Vec<LiveControl>>,
    recovery_due: Option<std::time::Instant>,
    recovery_error: Option<String>,
    updates: watch::Sender<AudioState>,
    meters: watch::Sender<Option<(oxidal_audio::meter::Snapshot, std::time::Instant)>>,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BootConfig {
    schema: u32,
    settings: StartAudio,
}
fn read_boot(path: &std::path::Path) -> Result<Option<StartAudio>, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 65536 {
                return Err("Boot audio configuration exceeds 64 KiB".into());
            }
            let config: BootConfig = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid boot audio configuration: {e}"))?;
            if config.schema != 1 {
                return Err("Unsupported boot audio configuration".into());
            }
            config.settings.validate()?;
            Ok(Some(config.settings))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read boot audio configuration: {e}")),
    }
}
fn write_boot(path: &std::path::Path, settings: Option<StartAudio>) -> Result<(), String> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or("Boot audio configuration has no directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if let Some(settings) = settings {
        let temporary = path.with_extension("tmp");
        let bytes = serde_json::to_vec(&BootConfig {
            schema: 1,
            settings,
        })
        .map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    std::fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}
impl Owner {
    fn publish(&mut self, phase: AudioPhase, error: Option<String>) {
        self.state.revision += 1;
        self.state.phase = phase;
        if phase != AudioPhase::Running {
            self.state.controls.clear();
            self.state.modified = false;
            self.state.saved_copy = None;
            self.state.model_change = None;
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
    ) -> Result<(), String> {
        if !valid_models(&models) {
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
        let previous_models = std::mem::replace(&mut self.state.models, models.clone());
        self.publish(AudioPhase::Starting, None);
        let startup = tokio::time::timeout(Duration::from_secs(25), async {
            let mut bytes = serde_json::to_vec(&PlaybackStart {
                settings,
                controls,
                models,
            })
            .map_err(|e| e.to_string())?;
            if bytes.len() > 65535 {
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
                .take(65537)
                .read_until(b'\n', &mut response)
                .await
                .map_err(|e| e.to_string())?;
            if response.len() > 65536 || response.last() != Some(&b'\n') {
                return Err(
                    "Audio worker could not start; check device/settings/preset and service log"
                        .into(),
                );
            }
            let event: PlaybackEvent =
                serde_json::from_slice(&response).map_err(|_| "Invalid native startup reply")?;
            let PlaybackEvent::Ready {
                preset_name,
                controls,
            } = event
            else {
                return Err("Expected native readiness".into());
            };
            if preset_name.is_empty() || preset_name.len() > 1024 || !valid_controls(&controls) {
                return Err("Invalid native controls".into());
            }
            self.state.preset_name = Some(preset_name);
            self.state.controls = controls;
            self.state.modified = self.state.configured.as_ref().is_some_and(|s| s.draft)
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
                    .take(65537)
                    .read_until(b'\n', &mut bytes)
                    .await;
                if read.is_err() || bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
                    break;
                }
                let Ok(event) = serde_json::from_slice::<PlaybackEvent>(&bytes) else {
                    break;
                };
                match event {
                    PlaybackEvent::Meter { snapshot } if snapshot.valid() => {
                        meters.send_replace(Some((snapshot, std::time::Instant::now())));
                    }
                    reply @ (PlaybackEvent::Control { .. } | PlaybackEvent::Model { .. }) => {
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
                    ..
                } if *actual == serial
                    && valid_controls(controls)
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
            if let Some(p) = &progress
                && p.phase == ModelPhase::Applied
            {
                self.state
                    .models
                    .retain(|m| m.target != p.assignment.target);
                self.state.models.push(p.assignment.clone());
                self.state.controls = controls.clone();
                self.resume_controls = Some(controls);
                self.state.modified = true;
                self.state.saved_copy = None;
                self.schedule_recovery();
            }
            let error = progress.as_ref().and_then(|p| p.error.clone());
            self.state.model_change = progress;
            self.publish(AudioPhase::Running, error);
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
                },
                None,
                vec![],
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
            name,
        };
        let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if bytes.len() >= 65536 {
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
            .start(proposed, controls.clone(), self.state.models.clone())
            .await
        {
            Ok(()) => Ok(self.state.clone()),
            Err(error) => {
                // start restores the last confirmed configuration on failure. Roll back
                // only a previously running stream; a stopped session stays stopped.
                let message = if was_running {
                    match self
                        .start(previous, controls, self.state.models.clone())
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
        if self.executable.is_none() {
            return Err("Experimental audio worker unavailable".into());
        }
        let result = match command.action {
            AudioAction::Create { stream, name } => return self.create(stream, name).await,
            // A failed export must not mark the independently running audio failed.
            AudioAction::ReplaceModel { assignment } => {
                if self.state.phase != AudioPhase::Running
                    || !assignment.valid()
                    || self.model_pending()
                {
                    return Err("Start audio and finish or cancel the pending model first".into());
                }
                let target = format!("block:{}:enabled", assignment.target);
                if !self.state.controls.iter().any(|c| c.target == target) {
                    return Err("Select an existing sounding tone block".into());
                }
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
                self.start(settings, None, vec![]).await
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
                let settings = if enabled {
                    if self.state.phase != AudioPhase::Running {
                        return Err("Start and verify audio before enabling boot playback".into());
                    }
                    if self.state.configured.as_ref().is_some_and(|s| s.draft) {
                        return Err(
                            "Save and recall the new rig before enabling boot playback".into()
                        );
                    }
                    self.state.configured.clone()
                } else {
                    None
                };
                write_boot(&self.preset_dir.join("boot-audio.json"), settings)?;
                self.state.start_on_boot = enabled;
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
    pub fn new(config: &Config) -> Result<Self, String> {
        if let Some(path) = &config.audio_worker
            && (!path.is_absolute() || !path.is_file())
        {
            return Err("Audio worker must be a configured absolute executable".into());
        }
        let boot = read_boot(&config.preset_dir.join("boot-audio.json"));
        let recovery = Recovery::read(&config.preset_dir.join("last-audio-session.json"));
        let recovery_error = recovery.as_ref().err().cloned();
        let recovery = recovery.ok().flatten();
        let initial = AudioState {
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
            modified: false,
            preset_name: None,
            saved_copy: None,
            models: recovery
                .as_ref()
                .map(|r| r.models.clone())
                .unwrap_or_default(),
            model_change: None,
            phase: if config.audio_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: recovery.as_ref().map(|r| r.settings.clone()),
            error: recovery_error.clone(),
            device_owned: false,
            experimental: true,
            start_on_boot: matches!(boot, Ok(Some(_))),
        };
        let (updates, state) = watch::channel(initial.clone());
        let (meters, meter_state) = watch::channel(None);
        let (commands, mut receiver) = mpsc::channel::<(AudioCommand, oneshot::Sender<Reply>)>(1);
        let mut owner = Owner {
            worker: None,
            executable: config.audio_worker.clone(),
            preset_dir: config.preset_dir.clone(),
            state: initial,
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
                Ok(Some(settings)) if owner.executable.is_some() => {
                    if let Err(error) = owner.start(settings, None, vec![]).await {
                        owner.publish(AudioPhase::Failed, Some(error));
                    }
                }
                Err(error) => owner.publish(AudioPhase::Failed, Some(error)),
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
            commands,
            state,
            finished,
            meters: meter_state,
        })
    }
    pub fn telemetry(&self) -> Option<(oxidal_audio::meter::Snapshot, std::time::Instant)> {
        *self.meters.borrow()
    }
    pub fn snapshot(&self) -> AudioState {
        self.state.borrow().clone()
    }
    async fn dispatch(&self, command: AudioCommand) -> Reply {
        let (response, received) = oneshot::channel();
        self.commands
            .try_send((command, response))
            .map_err(|_| "audio_busy")?;
        // The owner retains its command even when this client disconnects.
        received
            .await
            .map_err(|_| "Audio owner stopped".to_owned())?
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
