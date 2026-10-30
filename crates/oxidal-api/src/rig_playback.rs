//! Actor-owned mixed worker. Accepted operations outlive the requesting HTTP connection.
use crate::audio_boot::{Choice, Policy, Role};
use crate::{Config, Shared, failure, rig_recovery::Recovery};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::AudioPhase;
use oxidal_engine::protocol::*;
use std::{
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
    sync::{mpsc, oneshot, watch},
};
type Reply = Result<RigAudioState, String>;
#[derive(Debug)]
pub(super) struct RigPlayback {
    boot: Arc<Policy>,
    pub(super) finished: watch::Receiver<bool>,
    commands: mpsc::Sender<(RigAudioCommand, oneshot::Sender<Reply>)>,
    state: watch::Receiver<RigAudioState>,
}
struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: Option<BufReader<ChildStdout>>,
    preparing: Option<Preparing>,
    _permit: tokio::sync::SemaphorePermit<'static>,
}
type ReadyPipes = (ChildStdin, BufReader<ChildStdout>, WorkerReply);
struct Preparing {
    task: tokio::task::JoinHandle<Result<ReadyPipes, String>>,
    started: Instant,
}
impl Worker {
    async fn read(&mut self) -> Result<WorkerReply, String> {
        read_reply(self.output.as_mut().ok_or("Mixed worker is preparing")?).await
    }
    async fn write<T: serde::Serialize>(&mut self, value: &T) -> Result<(), String> {
        self.input
            .as_mut()
            .ok_or("Mixed worker stopped")?
            .write_all(&encode(value)?)
            .await
            .map_err(|e| e.to_string())
    }
}
async fn read_reply(output: &mut BufReader<ChildStdout>) -> Result<WorkerReply, String> {
    let mut bytes = Vec::new();
    output
        .take((REPLY_LIMIT + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > REPLY_LIMIT || bytes.last() != Some(&b'\n') {
        return Err("Invalid mixed worker reply".into());
    }
    decode_worker_reply(&bytes)
}
fn encode<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() >= REQUEST_LIMIT {
        return Err("Mixed command exceeds byte limit".into());
    }
    bytes.push(b'\n');
    Ok(bytes)
}
struct Export {
    child: Child,
    started: Instant,
    name: String,
}
struct Owner {
    levels: Arc<crate::levels::Levels>,
    boot: Arc<Policy>,
    executable: Option<PathBuf>,
    root: PathBuf,
    runtime: PathBuf,
    worker: Option<Worker>,
    export: Option<Export>,
    rollback: Option<StartRig>,
    restored_error: Option<String>,
    recovery_path: PathBuf,
    confirmed: Option<StartRig>,
    recovery_due: Option<Instant>,
    state: RigAudioState,
    updates: watch::Sender<RigAudioState>,
}
impl Owner {
    fn model_pending(&self) -> bool {
        self.state
            .control
            .as_ref()
            .and_then(|c| c.model_change.as_ref())
            .is_some_and(|m| m.progress.phase.pending())
    }
    fn schedule_recovery(&mut self) {
        // Continuous touch gestures still checkpoint every two seconds.
        self.recovery_due
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(2));
    }
    fn checkpoint(&mut self) {
        if self.recovery_due.is_none() {
            return;
        }
        let Some(settings) = self.confirmed.clone() else {
            return;
        };
        match Recovery::new(settings).write(&self.recovery_path) {
            Ok(()) => {
                self.recovery_due = None;
                if self.state.recovery_error.take().is_some() {
                    self.publish();
                }
            }
            Err(error) => {
                self.recovery_due = Some(Instant::now() + Duration::from_secs(5));
                self.state.recovery_error = Some(format!(
                    "Mixed session recovery could not be saved: {error}. Current session remains in memory."
                ));
                // Persistence does not change command authority or stop PCM.
                self.publish();
            }
        }
    }
    fn publish(&mut self) {
        self.state.device_owned = self.worker.is_some();
        self.updates.send_replace(self.state.clone());
    }
    fn changed(&mut self) {
        self.state.revision += 1;
        self.publish();
    }
    fn phase(&mut self, phase: AudioPhase, error: Option<String>) {
        self.state.phase = phase;
        self.state.error = error;
        self.changed();
    }
    fn readback(&mut self, reply: WorkerReply) -> Result<(), String> {
        let settings = self
            .state
            .configured
            .as_mut()
            .ok_or("Missing mixed configuration")?;
        if !reply.control.valid_model_state()
            || reply.control.source_revision != settings.revision
            || reply.processed_frames < self.state.processed_frames
            || self.state.control.as_ref().is_some_and(|old| {
                old.session != reply.control.session || old.revision > reply.control.revision
            })
            || reply.control.controls.iter().any(|c| !c.accepts(c.value))
            || reply
                .control
                .eq
                .iter()
                .any(|e| !oxidal_audio::eq::valid_snapshot(&e.blocks))
        {
            return Err("Mixed worker returned inconsistent readback".into());
        }
        let changed = self
            .state
            .control
            .as_ref()
            .is_none_or(|old| old.revision != reply.control.revision);
        settings.recall = Some(reply.control.recall());
        if changed {
            self.state.revision += 1;
            // Only a successful worker readback may replace durable recovery.
            // A starting/cancelled/failed candidate is never checkpointed.
            self.confirmed = Some(settings.clone());
            self.schedule_recovery();
        }
        self.state.control = Some(reply.control);
        self.state.telemetry = Some(reply.telemetry);
        self.state.processed_frames = reply.processed_frames;
        self.publish();
        Ok(())
    }
    async fn release(&mut self) -> Result<(), String> {
        drop(self.release_reserved().await?);
        Ok(())
    }
    async fn release_reserved(
        &mut self,
    ) -> Result<Option<tokio::sync::SemaphorePermit<'static>>, String> {
        let Some(worker) = self.worker.as_mut() else {
            return Ok(None);
        };
        if let Some(preparing) = worker.preparing.take() {
            // Drop startup pipes and prevent a late reply from reviving a stopped
            // session. The device permit stays with the child until it is reaped.
            preparing.task.abort();
            let _ = preparing.task.await;
        }
        worker.input.take();
        if !matches!(
            tokio::time::timeout(Duration::from_secs(2), worker.child.wait()).await,
            Ok(Ok(_))
        ) {
            worker.child.start_kill().map_err(|e| e.to_string())?;
            tokio::time::timeout(Duration::from_secs(2), worker.child.wait())
                .await
                .map_err(|_| "Mixed worker not reaped; device remains owned")?
                .map_err(|e| e.to_string())?;
        }
        Ok(self.worker.take().map(|worker| worker._permit))
    }
    async fn fault(&mut self, error: String) -> String {
        let error = match self.release().await {
            Ok(()) => error,
            Err(e) => format!("{error}; {e}"),
        };
        if let Some(confirmed) = &self.confirmed {
            self.state.configured = Some(confirmed.clone());
        }
        self.phase(AudioPhase::Failed, Some(error.clone()));
        error
    }
    async fn exchange(&mut self, request: &WorkerRequest) -> Result<WorkerReply, String> {
        let worker = self.worker.as_mut().ok_or("Mixed audio is not running")?;
        tokio::time::timeout(
            Duration::from_secs(if matches!(request, WorkerRequest::Authoring { .. }) {
                25
            } else {
                3
            }),
            async {
                worker.write(request).await?;
                worker.read().await
            },
        )
        .await
        .map_err(|_| "Mixed worker response timed out".to_owned())?
    }
    async fn start(&mut self, settings: StartRig) -> Result<(), String> {
        self.start_reserved(settings, None).await
    }
    async fn start_reserved(
        &mut self,
        mut settings: StartRig,
        reserved: Option<tokio::sync::SemaphorePermit<'static>>,
    ) -> Result<(), String> {
        // Unit levels follow the player, not the preset or the recovered session.
        settings.stream.levels = self.levels.current();
        settings.validate()?;
        let bytes = encode(&settings)?;
        if self.worker.is_some() {
            return Err("Stop mixed audio before changing its configuration".into());
        }
        let executable = self.executable.as_ref().ok_or("Mixed worker unavailable")?;
        let permit = match reserved {
            Some(permit) => permit,
            None => crate::audio::PROBE
                .try_acquire()
                .map_err(|_| "Audio device operation already in progress")?,
        };
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
        let runtime = self.runtime.join("playback");
        std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(executable)
            .env("OXIDAL_BUNDLE_STORE", &root)
            .env(
                "OXIDAL_PRESET_DIR",
                root.parent().ok_or("Missing model store parent")?,
            )
            .env("OXIDAL_QUALIFICATION_DATA", runtime)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut input = child.stdin.take().ok_or("Mixed stdin unavailable")?;
        let mut output = BufReader::new(child.stdout.take().ok_or("Mixed stdout unavailable")?);
        let task = tokio::spawn(async move {
            input.write_all(&bytes).await.map_err(|e| e.to_string())?;
            let reply = read_reply(&mut output).await?;
            Ok((input, output, reply))
        });
        self.worker = Some(Worker {
            child,
            input: None,
            output: None,
            preparing: Some(Preparing {
                task,
                started: Instant::now(),
            }),
            _permit: permit,
        });
        self.state.configured = Some(settings);
        self.state.control = None;
        self.state.telemetry = None;
        self.state.processed_frames = 0;
        self.phase(AudioPhase::Starting, None);
        Ok(())
    }
    async fn prepare_native_setting(&mut self, command: AuthoringCommand) -> Result<(), String> {
        let control = self
            .state
            .control
            .as_ref()
            .ok_or("Mixed audio is not running")?;
        let oxidal_audio::structure::AuthoringAction::Parameter { parameter, value } =
            command.action
        else {
            return Err("Prepared setting required".into());
        };
        if self.state.phase != AudioPhase::Running
            || self.model_pending()
            || command.session != control.session
            || command.expected_revision != control.revision
            || !control
                .authoring
                .iter()
                .find(|r| r.node == command.node)
                .is_some_and(|r| {
                    r.status
                        .settings
                        .iter()
                        .any(|p| p.target == parameter && p.accepts(value))
                })
        {
            return Err("Prepared native setting state conflict".into());
        }
        let previous = self
            .state
            .configured
            .clone()
            .ok_or("Missing mixed configuration")?;
        let request = PrepareNativeSetting {
            settings: previous.clone(),
            node: command.node,
            parameter,
            value,
        };
        let bytes = encode(&request)?;
        let root = std::fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.runtime.join("prepare-native")).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(
            self.executable.as_ref().ok_or("Mixed worker unavailable")?,
        )
        .arg("--prepare-native-setting")
        .env("OXIDAL_BUNDLE_STORE", &root)
        .env(
            "OXIDAL_PRESET_DIR",
            root.parent().ok_or("Missing model store")?,
        )
        .env(
            "OXIDAL_QUALIFICATION_DATA",
            self.runtime.join("prepare-native"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
        let result = tokio::time::timeout(Duration::from_secs(25), async {
            let mut input = child.stdin.take().ok_or("Missing preparation input")?;
            input.write_all(&bytes).await.map_err(|e| e.to_string())?;
            input.shutdown().await.map_err(|e| e.to_string())?;
            drop(input);
            let mut output = vec![];
            child
                .stdout
                .take()
                .ok_or("Missing preparation output")?
                .take((REPLY_LIMIT + 1) as u64)
                .read_to_end(&mut output)
                .await
                .map_err(|e| e.to_string())?;
            if output.len() > REPLY_LIMIT
                || !child.wait().await.map_err(|e| e.to_string())?.success()
            {
                return Err("Native preparation failed; playing rig unchanged".to_owned());
            }
            serde_json::from_slice::<Recall>(&output)
                .map_err(|_| "Invalid prepared rig recall".to_owned())
        })
        .await
        .map_err(|_| "Native preparation timed out; playing rig unchanged".to_owned())
        .and_then(|r| r);
        if result.is_err() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        let recall = result?;
        let mut next = previous.clone();
        next.recall = Some(recall);
        next.validate()?;
        self.phase(AudioPhase::Stopping, None);
        let reserved = self.release_reserved().await?;
        self.rollback = Some(previous);
        self.restored_error = None;
        if let Err(error) = self.start_reserved(next, reserved).await {
            self.preparation_failed(error).await;
        }
        Ok(())
    }
    async fn reconfigure(&mut self, stream: oxidal_audio::StreamConfig) -> Result<(), String> {
        if self.model_pending() {
            return Err("Finish model preparation before applying Audio settings".into());
        }
        if !matches!(self.state.phase, AudioPhase::Running | AudioPhase::Stopped) {
            return Err("Wait for mixed audio to finish preparing before changing settings".into());
        }
        let previous = self
            .state
            .configured
            .clone()
            .ok_or("No mixed configuration")?;
        let mut next = previous.clone();
        next.stream = stream;
        // Invalid declarations cannot interrupt the current stream.
        next.validate()?;
        self.phase(AudioPhase::Stopping, None);
        let reserved = match self.release_reserved().await {
            Ok(permit) => permit,
            Err(error) => {
                self.phase(AudioPhase::Failed, Some(error.clone()));
                return Err(error);
            }
        };
        self.rollback = Some(previous);
        self.restored_error = None;
        if let Err(error) = self.start_reserved(next, reserved).await {
            self.preparation_failed(error).await;
        }
        Ok(())
    }
    async fn preparation_failed(&mut self, error: String) {
        let Some(previous) = self.rollback.take() else {
            let reason = match self.restored_error.take() {
                Some(original) => format!("{original}; previous settings also failed: {error}"),
                None => error,
            };
            self.fault(reason).await;
            return;
        };
        let reserved = match self.release_reserved().await {
            Ok(permit) => permit,
            Err(reap) => {
                self.state.configured = Some(previous);
                self.phase(AudioPhase::Failed, Some(format!("{error}; {reap}")));
                return;
            }
        };
        // Recreate the last confirmed scalar state; do not retry the rejected settings.
        self.state.configured = Some(previous.clone());
        match self.start_reserved(previous, reserved).await {
            Ok(()) => {
                self.restored_error = Some(format!(
                    "Audio settings rejected ({error}); previous settings restored"
                ));
                self.state.error = Some(format!(
                    "Audio settings rejected ({error}); restoring previous settings"
                ));
                self.publish();
            }
            Err(restore) => {
                self.fault(format!("{error}; previous settings also failed: {restore}"))
                    .await;
            }
        }
    }
    async fn poll_preparing(&mut self) {
        let Some(worker) = self.worker.as_mut() else {
            return;
        };
        let Some(preparing) = worker.preparing.as_ref() else {
            return;
        };
        if preparing.started.elapsed() > Duration::from_secs(60) {
            self.preparation_failed("Mixed startup timed out".into())
                .await;
            return;
        }
        if !preparing.task.is_finished() {
            return;
        }
        let result = worker
            .preparing
            .take()
            .unwrap()
            .task
            .await
            .map_err(|_| "Mixed preparation task failed".to_owned())
            .and_then(|r| r);
        match result {
            Ok((input, output, reply)) => {
                worker.input = Some(input);
                worker.output = Some(output);
                if reply.error.is_some() || reply.processed_frames == 0 {
                    self.preparation_failed(
                        reply
                            .error
                            .unwrap_or_else(|| "Mixed worker rejected startup".into()),
                    )
                    .await;
                } else if let Err(e) = self.readback(reply) {
                    self.preparation_failed(e).await;
                } else {
                    self.rollback = None;
                    let error = self.restored_error.take();
                    self.phase(AudioPhase::Running, error);
                }
            }
            Err(e) => {
                self.preparation_failed(e).await;
            }
        }
    }
    async fn save(&mut self, name: String) -> Result<(), String> {
        if self.model_pending() {
            return Err("Finish model preparation before saving".into());
        }
        if self.export.is_some() {
            return Err("A mixed revision is already saving".into());
        }
        if self.state.phase != AudioPhase::Running
            || !oxidal_audio::lifecycle::valid_preset_name(&name)
        {
            return Err("Start mixed audio and enter a valid preset name".into());
        }
        let control = self.state.control.as_ref().ok_or("No confirmed controls")?;
        let request = SaveRequest {
            settings: self
                .state
                .configured
                .clone()
                .ok_or("Missing mixed configuration")?,
            recall: control.recall(),
            name: name.clone(),
        };
        let bytes = encode(&request)?;
        let runtime = self.runtime.join("export");
        std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(
            self.executable.as_ref().ok_or("Mixed worker unavailable")?,
        )
        .arg("--save-revision")
        .env("OXIDAL_BUNDLE_STORE", &self.root)
        .env(
            "OXIDAL_PRESET_DIR",
            std::fs::canonicalize(&self.root)
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("Missing model store parent")?,
        )
        .env("OXIDAL_QUALIFICATION_DATA", runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
        let mut input = child.stdin.take().ok_or("Export stdin unavailable")?;
        self.export = Some(Export {
            child,
            started: Instant::now(),
            name,
        });
        self.state.save = Some(SaveState {
            source_session: control.session.clone(),
            source_control_revision: control.revision,
            running: true,
            saved_revision: None,
            error: None,
        });
        self.changed();
        let result = tokio::time::timeout(Duration::from_secs(3), input.write_all(&bytes))
            .await
            .map_err(|_| "Export input timed out".to_owned())
            .and_then(|r| r.map_err(|e| e.to_string()));
        drop(input);
        if let Err(e) = result {
            self.export_error(e.clone()).await;
            return Err(e);
        }
        Ok(())
    }
    async fn cancel_export(&mut self) -> Result<(), String> {
        if let Some(export) = self.export.as_mut() {
            export.child.start_kill().map_err(|e| e.to_string())?;
            tokio::time::timeout(Duration::from_secs(2), export.child.wait())
                .await
                .map_err(|_| "Export child not reaped")?
                .map_err(|e| e.to_string())?;
            self.export = None;
        }
        Ok(())
    }
    async fn export_error(&mut self, error: String) {
        let error = match self.cancel_export().await {
            Ok(()) => error,
            Err(e) => format!("{error}; {e}"),
        };
        if let Some(save) = &mut self.state.save {
            save.running = self.export.is_some();
            save.error = Some(error);
        }
        // Export progress does not change audio command authority.
        self.publish();
    }
    async fn poll_export(&mut self) {
        let Some(export) = self.export.as_mut() else {
            return;
        };
        if export.started.elapsed() > Duration::from_secs(60) {
            self.export_error("Save timed out; check stored revisions before retrying".into())
                .await;
            return;
        }
        let status = match export.child.try_wait() {
            Ok(Some(status)) => status,
            Ok(None) => return,
            Err(e) => {
                self.export_error(e.to_string()).await;
                return;
            }
        };
        if !status.success() {
            self.export_error("Mixed export failed; playback was not changed".into())
                .await;
            return;
        }
        // Child is already reaped; bound protocol read separately from PCM ownership.
        let result = async {
            let mut output = Vec::new();
            let mut stdout = export.child.stdout.take().ok_or("Missing export output")?;
            tokio::time::timeout(
                Duration::from_secs(2),
                (&mut stdout).take(1024).read_to_end(&mut output),
            )
            .await
            .map_err(|_| "Export output timed out")?
            .map_err(|e| e.to_string())?;
            let id: String =
                serde_json::from_slice(&output).map_err(|_| "Invalid saved revision")?;
            if !valid_revision(&id) {
                return Err("Invalid saved revision".into());
            }
            let root = self.root.clone();
            let expected = export.name.clone();
            let revision = id.clone();
            tokio::task::spawn_blocking(move || {
                let bundle = oxidal_presets::BundleStore::new(root)
                    .read(&revision)
                    .map_err(|e| e.to_string())?;
                if bundle.manifest().name != expected {
                    return Err("Saved name differs".to_owned());
                }
                Ok(())
            })
            .await
            .map_err(|_| "Saved revision check failed")??;
            Ok::<_, String>(id)
        }
        .await;
        self.export = None;
        if let Some(save) = &mut self.state.save {
            save.running = false;
            match result {
                Ok(id) => save.saved_revision = Some(id),
                Err(e) => save.error = Some(e),
            }
        }
        // Export progress does not change audio command authority.
        self.publish();
    }
    async fn command(&mut self, command: RigAudioCommand) -> Reply {
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("rig_audio_state_conflict; refresh status".into());
        }
        if self.executable.is_none()
            && !matches!(command.action, RigAudioAction::SetBoot { enabled: false })
        {
            return Err("Mixed worker unavailable".into());
        }
        if self
            .state
            .control
            .as_ref()
            .is_some_and(|s| s.authoring.iter().any(|r| r.status.tools.measuring()))
            && !matches!(
                &command.action,
                RigAudioAction::Stop
                    | RigAudioAction::Authoring {
                        command: AuthoringCommand {
                            action: oxidal_audio::structure::AuthoringAction::Utility { .. },
                            ..
                        }
                    }
            )
        {
            return Err("Wait for measurement or cancel it before changing sound".into());
        }
        if self
            .state
            .control
            .as_ref()
            .is_some_and(|s| s.authoring.iter().any(|r| r.status.gesture.is_some()))
            && !matches!(
                &command.action,
                RigAudioAction::Stop | RigAudioAction::Authoring { .. }
            )
        {
            return Err("Finish the active adjustment before changing sound".into());
        }
        match command.action {
            RigAudioAction::Start { settings } => {
                self.start(*settings).await?;
                self.rollback = None;
                self.restored_error = None;
            }
            RigAudioAction::Reconfigure { stream } => self.reconfigure(stream).await?,
            RigAudioAction::Stop => {
                self.checkpoint();
                if let Some(previous) = self.rollback.take() {
                    self.state.configured = Some(previous);
                } else if self.state.phase == AudioPhase::Starting
                    && let Some(confirmed) = &self.confirmed
                {
                    self.state.configured = Some(confirmed.clone());
                }
                self.rollback = None;
                self.restored_error = None;
                self.phase(AudioPhase::Stopping, None);
                if let Err(e) = self.release().await {
                    self.phase(AudioPhase::Failed, Some(e.clone()));
                    return Err(e);
                }
                self.phase(AudioPhase::Stopped, None);
            }
            RigAudioAction::Restart => {
                if self.state.phase == AudioPhase::Starting {
                    return Err("Cancel preparation before restarting".into());
                }
                self.rollback = None;
                self.restored_error = None;
                let settings = self
                    .state
                    .configured
                    .clone()
                    .ok_or("No mixed configuration")?;
                self.phase(AudioPhase::Stopping, None);
                let reserved = match self.release_reserved().await {
                    Ok(permit) => permit,
                    Err(e) => {
                        self.phase(AudioPhase::Failed, Some(e.clone()));
                        return Err(e);
                    }
                };
                if let Err(error) = self.start_reserved(settings, reserved).await {
                    return Err(self.fault(error).await);
                }
            }
            RigAudioAction::Authoring { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                if matches!(
                    command.action,
                    oxidal_audio::structure::AuthoringAction::Parameter { .. }
                ) {
                    self.prepare_native_setting(command).await?;
                    return Ok(self.state.clone());
                }
                let reply = match self.exchange(&WorkerRequest::Authoring { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::Control { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Control { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::HostUtility { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::HostUtility { command }).await {
                    Ok(reply) => reply,
                    Err(error) => return Err(self.fault(error).await),
                };
                let hear = reply
                    .telemetry
                    .monitoring
                    .ok_or("Missing input monitoring readback")?
                    .hear_yourself;
                let error = reply.error.clone();
                if let Err(error) = self.readback(reply) {
                    return Err(self.fault(error).await);
                }
                if let Some(error) = error {
                    return Err(error);
                }
                self.state
                    .configured
                    .as_mut()
                    .ok_or("Missing mixed configuration")?
                    .stream
                    .hear_yourself = hear;
                if let oxidal_audio::tools::HostUtility::Levels { levels } = command {
                    self.levels.save(levels)?;
                    if let Some(configured) = self.state.configured.as_mut() {
                        configured.stream.levels = levels;
                    }
                }
                self.confirmed = self.state.configured.clone();
                if matches!(
                    command,
                    oxidal_audio::tools::HostUtility::HearYourself { .. }
                ) {
                    self.schedule_recovery();
                }
                self.changed();
            }
            RigAudioAction::Midi { settings } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                if let Some(settings) = &settings {
                    settings.validate()?;
                }
                let reply = match self
                    .exchange(&WorkerRequest::Midi {
                        settings: settings.clone(),
                    })
                    .await
                {
                    Ok(reply) => reply,
                    Err(error) => return Err(self.fault(error).await),
                };
                let error = reply.error.clone();
                if let Err(error) = self.readback(reply) {
                    return Err(self.fault(error).await);
                }
                if let Some(error) = error {
                    return Err(error);
                }
                self.state.configured.as_mut().unwrap().midi = settings;
                self.confirmed = self.state.configured.clone();
                self.schedule_recovery();
                self.changed();
            }
            RigAudioAction::Scene { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Scene { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::Branch { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Branch { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::Eq { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Eq { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::Model { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Model { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
                if let Some(e) = error {
                    return Err(e);
                }
            }
            RigAudioAction::Switch { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Mixed audio is not running".into());
                }
                let target = command.revision.clone();
                let old = self
                    .state
                    .configured
                    .as_ref()
                    .ok_or("No mixed configuration")?
                    .clone();
                let index = old
                    .prepared
                    .iter()
                    .position(|p| p.revision == target)
                    .ok_or("Select a prepared alternative")?;
                let reply = match self.exchange(&WorkerRequest::Switch { command }).await {
                    Ok(reply) => reply,
                    Err(e) => return Err(self.fault(e).await),
                };
                if let Some(error) = reply.error.clone() {
                    if let Err(e) = self.readback(reply) {
                        return Err(self.fault(e).await);
                    }
                    return Err(error);
                }
                if reply.control.source_revision != target
                    || self
                        .state
                        .control
                        .as_ref()
                        .is_none_or(|c| c.session == reply.control.session)
                    || reply.processed_frames <= self.state.processed_frames
                {
                    return Err(self.fault("Unconfirmed resident switch".into()).await);
                }
                let mut settings = old.clone();
                settings.revision = target;
                settings.prepared[index] = oxidal_engine::protocol::PreparedRecall {
                    revision: old.revision,
                    recall: self.state.control.as_ref().map(|c| c.recall()),
                };
                settings.recall = None;
                settings.midi = None;
                self.state.configured = Some(settings);
                self.state.control = None;
                // An isolated export retains its source-session receipt even
                // while another resident is sounding.
                if let Err(e) = self.readback(reply) {
                    return Err(self.fault(e).await);
                }
            }
            RigAudioAction::Save { name } => self.save(name).await?,
            RigAudioAction::SetBoot { enabled } => {
                if enabled {
                    if self.model_pending() {
                        return Err("Finish model preparation before boot capture".into());
                    }
                    if self.state.phase != AudioPhase::Running {
                        return Err(
                            "Start and verify mixed audio before enabling boot playback".into()
                        );
                    }
                    self.boot.set(Choice::Mixed {
                        settings: self.confirmed.clone().ok_or("No confirmed mixed session")?,
                    })?;
                } else {
                    self.boot.clear(Role::Mixed)?;
                }
                self.state.start_on_boot = self.boot.enabled(Role::Mixed);
                self.changed();
            }
        }
        Ok(self.state.clone())
    }
    async fn poll(&mut self) {
        if self.worker.is_some() {
            if self.state.phase == AudioPhase::Failed {
                if self.release().await.is_ok() {
                    self.publish();
                }
            } else if self.state.phase == AudioPhase::Starting {
                self.poll_preparing().await;
            } else {
                let result = match self.exchange(&WorkerRequest::Status).await {
                    Ok(r) if r.error.is_none() => self.readback(r),
                    Ok(_) => Err("Invalid mixed status reply".into()),
                    Err(e) => Err(e),
                };
                if let Err(e) = result {
                    self.fault(e).await;
                }
            }
        }
        if self.state.phase == AudioPhase::Running {
            let nodes: Vec<_> = self
                .state
                .control
                .as_ref()
                .map(|s| {
                    s.authoring
                        .iter()
                        .filter(|r| r.status.tools.active() || r.status.gesture.is_some())
                        .map(|r| r.node.clone())
                        .collect()
                })
                .unwrap_or_default();
            for node in nodes {
                let cursor = self.state.control.as_ref().unwrap();
                let command = AuthoringCommand {
                    session: cursor.session.clone(),
                    expected_revision: cursor.revision,
                    node,
                    action: oxidal_audio::structure::AuthoringAction::Utility {
                        command: oxidal_audio::tools::Command::Poll,
                    },
                };
                match self.exchange(&WorkerRequest::Authoring { command }).await {
                    Ok(reply) => {
                        let error = reply.error.clone();
                        if let Err(error) = self.readback(reply) {
                            self.fault(error).await;
                            break;
                        }
                        if let Some(error) = error {
                            self.state.error = Some(error);
                            self.publish();
                        }
                    }
                    Err(error) => {
                        self.fault(error).await;
                        break;
                    }
                }
            }
        }
        self.poll_export().await;
        if self.recovery_due.is_some_and(|due| due <= Instant::now()) {
            self.checkpoint();
        }
    }
}
impl RigPlayback {
    pub fn new(
        config: &Config,
        policy: Arc<Policy>,
        levels: Arc<crate::levels::Levels>,
    ) -> Result<Self, String> {
        if config
            .rig_worker
            .as_ref()
            .is_some_and(|p| !p.is_absolute() || !p.is_file())
        {
            return Err("Mixed worker must be a configured absolute executable".into());
        }
        let boot = policy.snapshot();
        let recovery_path = config.preset_dir.join("last-rig-session.json");
        let recovery = Recovery::read(&recovery_path);
        let recovery_error = recovery.as_ref().err().cloned();
        let recovered = recovery.ok().flatten().map(|r| r.settings);
        let initial = RigAudioState {
            start_on_boot: policy.enabled(Role::Mixed),
            session: format!(
                "rig-owner-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos()
            ),
            revision: 0,
            phase: if config.rig_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: recovered.clone(),
            recovery_error,
            control: None,
            telemetry: None,
            processed_frames: 0,
            device_owned: false,
            error: None,
            save: None,
        };
        let (updates, state) = watch::channel(initial.clone());
        let (commands, mut receiver) =
            mpsc::channel::<(RigAudioCommand, oneshot::Sender<Reply>)>(1);
        let mut owner = Owner {
            levels,
            boot: policy.clone(),
            executable: config.rig_worker.clone(),
            root: config.preset_dir.join("bundles"),
            runtime: config.preset_dir.join("rig-runtime"),
            worker: None,
            export: None,
            rollback: None,
            restored_error: None,
            recovery_path,
            confirmed: recovered,
            recovery_due: None,
            state: initial,
            updates,
        };
        let mut shutdown = config.shutdown.clone();
        let (done, finished) = watch::channel(false);
        tokio::spawn(async move {
            match boot {
                Ok(Some(Choice::Mixed { settings })) if owner.executable.is_some() => {
                    if let Err(error) = owner.start(settings).await {
                        owner.fault(error).await;
                    }
                }
                // The shared boot error remains recoverable without changing PCM state.
                _ => (),
            }
            let mut interval = tokio::time::interval(Duration::from_millis(200));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {biased;
                    _=async{match shutdown.as_mut(){Some(s)=>{if !*s.borrow(){let _=s.changed().await;}},None=>std::future::pending::<()>().await}}=>break,
                    item=receiver.recv()=>match item{Some((command,response))=>{let _=response.send(owner.command(command).await);},None=>break},
                    _=interval.tick()=>owner.poll().await,
                }
            }
            owner.checkpoint();
            while owner.worker.is_some() || owner.export.is_some() {
                let _ = owner.release().await;
                let _ = owner.cancel_export().await;
                if owner.worker.is_some() || owner.export.is_some() {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
            done.send_replace(true);
        });
        Ok(Self {
            boot: policy,
            finished,
            commands,
            state,
        })
    }
    pub(super) fn subscribe(&self) -> watch::Receiver<RigAudioState> {
        self.state.clone()
    }
    pub fn snapshot(&self) -> RigAudioState {
        let mut state = self.state.borrow().clone();
        state.start_on_boot = self.boot.enabled(Role::Mixed);
        state
    }
    pub(crate) async fn dispatch(&self, command: RigAudioCommand) -> Reply {
        let (response, received) = oneshot::channel();
        self.commands
            .try_send((command, response))
            .map_err(|_| "rig_audio_busy")?;
        let mut state = received
            .await
            .map_err(|_| "Mixed owner stopped".to_owned())??;
        state.start_on_boot = self.boot.enabled(Role::Mixed);
        Ok(state)
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Json<RigAudioState> {
    Json(shared.rig_playback.snapshot())
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<RigAudioCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(mut command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "invalid_rig_audio_command");
    };
    crate::blends::apply(&shared, &mut command).await;
    let result = shared.rig_playback.dispatch(command).await;
    if result.is_ok() {
        // A preset or scene change brings its own boost.
        crate::boosts::follow(&shared).await;
    }
    match result {
        // Applying a boost advances the revision: answer with the state after it.
        Ok(_) => Json(shared.rig_playback.snapshot()).into_response(),
        Err(e) => failure(StatusCode::CONFLICT, &e),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[tokio::test]
    async fn preparation_is_cancellable_and_shutdown_reaps_before_releasing_device() {
        let root =
            std::env::temp_dir().join(format!("oxidal-prepare-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("slow-worker");
        // An exec replaces the shell: no grandchildren survive forced teardown.
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let (shutdown, signal) = watch::channel(false);
        let rig = RigPlayback::new(
            &Config {
                debug_socket: None,
                device_socket: None,
                simulator: false,
                native_worker: None,
                audio_worker: None,
                graph_worker: None,
                rig_worker: Some(executable),
                mapping_path: root.join("mapping"),
                preset_dir: root.join("presets"),
                ui_dir: root.join("ui"),
                shutdown: Some(signal),
            },
            Arc::new(Policy::new(root.join("presets/boot-audio.json"))),
            Arc::new(crate::levels::Levels::load(
                root.join("presets/unit-levels.json"),
            )),
        )
        .unwrap();
        let probe = oxidal_audio::AudioProbe {
            endpoint: "hw:CARD=Test,DEV=0".into(),
            direction: oxidal_audio::Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::S16,
            period_frames: 128,
            periods: 3,
        };
        let mut output = probe.clone();
        output.direction = oxidal_audio::Direction::Playback;
        let settings = StartRig {
            midi: None,
            prepared: Vec::new(),
            revision: "a".repeat(64),
            stream: oxidal_audio::StreamConfig {
                levels: Default::default(),
                hear_yourself: true,
                input: probe,
                output,
                input_map: [0, 1],
                output_map: [0, 1],
            },
            recall: None,
        };
        for iteration in 0..2 {
            let s = rig.snapshot();
            let starting = tokio::time::timeout(
                Duration::from_secs(1),
                rig.dispatch(RigAudioCommand {
                    session: s.session,
                    expected_revision: s.revision,
                    action: RigAudioAction::Start {
                        settings: Box::new(settings.clone()),
                    },
                }),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(starting.phase, AudioPhase::Starting);
            assert!(starting.device_owned);
            assert!(crate::audio::PROBE.try_acquire().is_err());
            if iteration == 0 {
                let stopped = tokio::time::timeout(
                    Duration::from_secs(4),
                    rig.dispatch(RigAudioCommand {
                        session: starting.session,
                        expected_revision: starting.revision,
                        action: RigAudioAction::Stop,
                    }),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(stopped.phase, AudioPhase::Stopped);
                assert!(!stopped.device_owned);
                assert!(crate::audio::PROBE.try_acquire().is_ok());
                tokio::time::sleep(Duration::from_millis(250)).await;
                assert_eq!(rig.snapshot().phase, AudioPhase::Stopped);
                let mut candidate = settings.stream.clone();
                candidate.input.period_frames = 256;
                candidate.output.period_frames = 256;
                let preparing = rig
                    .dispatch(RigAudioCommand {
                        session: stopped.session,
                        expected_revision: stopped.revision,
                        action: RigAudioAction::Reconfigure { stream: candidate },
                    })
                    .await
                    .unwrap();
                assert_eq!(preparing.phase, AudioPhase::Starting);
                assert!(crate::audio::PROBE.try_acquire().is_err());
                let cancelled = rig
                    .dispatch(RigAudioCommand {
                        session: preparing.session,
                        expected_revision: preparing.revision,
                        action: RigAudioAction::Stop,
                    })
                    .await
                    .unwrap();
                assert_eq!(cancelled.phase, AudioPhase::Stopped);
                assert_eq!(
                    cancelled.configured.unwrap().stream.input.period_frames,
                    128
                );
                assert!(crate::audio::PROBE.try_acquire().is_ok());
            } else {
                shutdown.send_replace(true);
                let mut done = rig.finished.clone();
                tokio::time::timeout(Duration::from_secs(4), done.wait_for(|v| *v))
                    .await
                    .unwrap()
                    .unwrap();
                assert!(crate::audio::PROBE.try_acquire().is_ok());
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
