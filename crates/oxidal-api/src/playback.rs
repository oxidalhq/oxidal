//! One actor owns playback and the ALSA permit, independently of HTTP request lifetimes.
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::{AudioAction, AudioCommand, AudioPhase, AudioState, StartAudio};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::{mpsc, oneshot, watch},
};

type Reply = Result<AudioState, String>;
#[derive(Debug)]
pub(super) struct Playback {
    commands: mpsc::Sender<(AudioCommand, oneshot::Sender<Reply>)>,
    state: watch::Receiver<AudioState>,
}
#[derive(Debug)]
struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    _permit: tokio::sync::SemaphorePermit<'static>,
}
struct Owner {
    worker: Option<Worker>,
    executable: Option<PathBuf>,
    preset_dir: PathBuf,
    state: AudioState,
    updates: watch::Sender<AudioState>,
}
impl Owner {
    fn publish(&mut self, phase: AudioPhase, error: Option<String>) {
        self.state.revision += 1;
        self.state.phase = phase;
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
            BufReader::new(output)
                .take(1025)
                .read_until(b'\n', &mut response)
                .await
                .map_err(|e| e.to_string())?;
            if response.len() > 1024
                || response.last() != Some(&b'\n')
                || serde_json::from_slice::<serde_json::Value>(&response).ok()
                    != Some(serde_json::json!({"running":true}))
            {
                return Err(
                    "Audio worker could not start; check device/settings/preset and service log"
                        .into(),
                );
            }
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
        Ok(())
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
            phase: if config.audio_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: None,
            error: None,
            device_owned: false,
            experimental: true,
        };
        let (updates, state) = watch::channel(initial.clone());
        let (commands, mut receiver) = mpsc::channel::<(AudioCommand, oneshot::Sender<Reply>)>(1);
        let mut owner = Owner {
            worker: None,
            executable: config.audio_worker.clone(),
            preset_dir: config.preset_dir.clone(),
            state: initial,
            updates,
        };
        let mut shutdown = config.shutdown.clone();
        tokio::spawn(async move {
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
        });
        Ok(Self { commands, state })
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
