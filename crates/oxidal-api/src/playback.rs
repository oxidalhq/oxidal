//! One actor owns playback and the ALSA permit, independently of HTTP request lifetimes.
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::{
    AudioAction, AudioCommand, AudioPhase, AudioState, LiveRequest, PlaybackEvent, StartAudio,
    valid_controls,
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
            self.meters.send_replace(None);
        }
        self.state.error = error;
        self.state.device_owned = self.worker.is_some();
        self.updates.send_replace(self.state.clone());
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
    async fn start(&mut self, settings: StartAudio) -> Result<(), String> {
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
        self.state.configured = Some(settings.clone());
        self.publish(AudioPhase::Starting, None);
        let startup = tokio::time::timeout(Duration::from_secs(25), async {
            let mut bytes = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
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
            Ok(())
        })
        .await
        .map_err(|_| "Audio startup timed out".to_owned())
        .and_then(|r| r);
        if let Err(error) = startup {
            self.release().await?;
            return Err(error);
        }
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
                    reply @ PlaybackEvent::Control { .. } => {
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
                self.state.controls = controls;
                self.state.modified = true;
                self.publish(AudioPhase::Running, None);
                Ok(())
            }
            Err(error) => {
                self.release().await?;
                Err(error)
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
                self.start(settings).await
            }
            AudioAction::Stop => {
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
                    Ok(()) => self.start(settings).await,
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
            phase: if config.audio_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: None,
            error: None,
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
            updates,
            meters,
        };
        let mut shutdown = config.shutdown.clone();
        let (done, finished) = watch::channel(false);
        tokio::spawn(async move {
            match boot {
                Ok(Some(settings)) if owner.executable.is_some() => {
                    if let Err(error) = owner.start(settings).await {
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
                    _ = interval.tick() => owner.check_exit(),
                }
            }
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
