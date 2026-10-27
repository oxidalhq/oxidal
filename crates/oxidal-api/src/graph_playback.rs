//! Actor-owned graph worker. HTTP lifetimes never own PCM or in-flight commands.
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::AudioPhase;
use oxidal_lv2::protocol::*;
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
    sync::{mpsc, oneshot, watch},
};
type Reply = Result<GraphAudioState, String>;
#[derive(Debug)]
pub(super) struct GraphPlayback {
    pub(super) finished: watch::Receiver<bool>,
    commands: mpsc::Sender<(GraphAudioCommand, oneshot::Sender<Reply>)>,
    state: watch::Receiver<GraphAudioState>,
}
struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    _permit: tokio::sync::SemaphorePermit<'static>,
}
impl Worker {
    async fn read(&mut self) -> Result<WorkerReply, String> {
        let mut bytes = vec![];
        (&mut self.output)
            .take((REPLY_LIMIT + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|e| e.to_string())?;
        if bytes.len() > REPLY_LIMIT || bytes.last() != Some(&b'\n') {
            return Err("Invalid graph worker reply".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "Invalid graph worker protocol".into())
    }
    async fn write<T: serde::Serialize>(&mut self, value: &T) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        if bytes.len() >= REQUEST_LIMIT {
            return Err("Graph command exceeds IPC limit".into());
        }
        bytes.push(b'\n');
        self.input
            .as_mut()
            .ok_or("Graph worker stopped")?
            .write_all(&bytes)
            .await
            .map_err(|e| e.to_string())
    }
}
struct Owner {
    midi_enabled: bool,
    executable: Option<PathBuf>,
    preset_root: PathBuf,
    worker: Option<Worker>,
    state: GraphAudioState,
    updates: watch::Sender<GraphAudioState>,
}
impl Owner {
    fn publish(&mut self) {
        self.state.device_owned = self.worker.is_some();
        self.updates.send_replace(self.state.clone());
    }
    fn phase(&mut self, phase: AudioPhase, error: Option<String>) {
        self.state.revision += 1;
        self.state.phase = phase;
        self.state.error = error;
        self.publish();
    }
    fn readback(&mut self, reply: WorkerReply) {
        if self.state.control.as_ref().is_none_or(|old| {
            old.session != reply.control.session || old.revision != reply.control.revision
        }) {
            self.state.revision += 1;
            self.state.saved_copy = None;
        }
        // Retain only settled adjustments; an abandoned gesture must not become
        // the restart value. Running DSP owns the preview until commit/cancel.
        if let Ok(recall) = GraphRecall::from_snapshot(&reply.control)
            && let Some(settings) = &mut self.state.configured
        {
            settings.rig = reply.control.rig.clone();
            settings.recall = Some(recall);
        }
        self.state.telemetry = Some(reply.telemetry);
        self.state.control = Some(reply.control);
        self.state.native_values = reply.native_values;
        self.state.processed_frames = reply.processed_frames;
        self.publish();
    }
    async fn release(&mut self) -> Result<(), String> {
        let Some(worker) = self.worker.as_mut() else {
            return Ok(());
        };
        worker.input.take();
        match tokio::time::timeout(Duration::from_secs(2), worker.child.wait()).await {
            Ok(Ok(_)) => (),
            _ => {
                worker.child.start_kill().map_err(|e| e.to_string())?;
                tokio::time::timeout(Duration::from_secs(2), worker.child.wait())
                    .await
                    .map_err(|_| "Graph worker not reaped; device remains owned")?
                    .map_err(|e| e.to_string())?;
            }
        }
        self.worker = None;
        Ok(())
    }
    async fn fault(&mut self, error: String) -> String {
        let error = match self.release().await {
            Ok(()) => error,
            Err(e) => format!("{error}; {e}"),
        };
        self.phase(AudioPhase::Failed, Some(error.clone()));
        error
    }
    async fn exchange(&mut self, request: &WorkerRequest) -> Result<WorkerReply, String> {
        let worker = self.worker.as_mut().ok_or("Graph audio is not running")?;
        tokio::time::timeout(Duration::from_secs(3), async {
            worker.write(request).await?;
            worker.read().await
        })
        .await
        .map_err(|_| "Graph worker response timed out".to_owned())?
    }
    async fn start(&mut self, settings: StartGraph) -> Result<(), String> {
        settings.validate()?;
        if self.worker.is_some() {
            return Err("Stop graph audio before changing its configuration".into());
        }
        let executable = self.executable.as_ref().ok_or("Graph worker unavailable")?;
        let permit = crate::audio::PROBE
            .try_acquire()
            .map_err(|_| "Audio device operation already in progress")?;
        let mut child = tokio::process::Command::new(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = child.stdin.take().ok_or("Graph stdin unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("Graph stdout unavailable")?);
        self.worker = Some(Worker {
            child,
            input: Some(input),
            output,
            _permit: permit,
        });
        self.state.configured = Some(settings.clone());
        self.state.control = None;
        self.state.native_values.clear();
        self.state.processed_frames = 0;
        self.state.telemetry = None;
        self.phase(AudioPhase::Starting, None);
        let result = tokio::time::timeout(Duration::from_secs(15), async {
            let worker = self.worker.as_mut().unwrap();
            worker.write(&settings).await?;
            worker.read().await
        })
        .await
        .map_err(|_| "Graph startup timed out".to_owned())
        .and_then(|r| r);
        match result {
            Ok(reply) if reply.error.is_none() && reply.processed_frames > 0 => {
                self.readback(reply);
                self.phase(AudioPhase::Running, None);
                Ok(())
            }
            Ok(_) => Err(self.fault("Graph worker rejected startup".into()).await),
            Err(e) => Err(self.fault(e).await),
        }
    }
    async fn command(&mut self, command: GraphAudioCommand) -> Reply {
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("graph_audio_state_conflict; refresh status".into());
        }
        if self.executable.is_none() {
            return Err("Graph worker unavailable".into());
        }
        match command.action {
            GraphAudioAction::Configure { stream } => {
                if self.worker.is_some() {
                    return Err(
                        "Stop effects audio before changing its device configuration".into(),
                    );
                }
                let settings = if let Some(mut previous) = self.state.configured.clone() {
                    previous.stream = stream;
                    previous
                } else {
                    StartGraph {
                        stream,
                        recall: None,
                        bindings: vec![],
                        rig: oxidal_graph::Rig {
                            nodes: vec![
                                oxidal_graph::Node {
                                    id: "in".into(),
                                    kind: oxidal_graph::BlockKind::Input,
                                    level: 1.0,
                                },
                                oxidal_graph::Node {
                                    id: "out".into(),
                                    kind: oxidal_graph::BlockKind::Output,
                                    level: 1.0,
                                },
                            ],
                            edges: vec![oxidal_graph::Edge {
                                from: "in".into(),
                                to: "out".into(),
                            }],
                        },
                    }
                };
                settings.validate()?;
                self.state.configured = Some(settings);
                self.state.revision += 1;
                self.publish();
            }
            GraphAudioAction::Start { settings } => {
                self.start(*settings).await?;
            }
            GraphAudioAction::Stop => {
                self.phase(AudioPhase::Stopping, None);
                if let Err(e) = self.release().await {
                    self.phase(AudioPhase::Failed, Some(e.clone()));
                    return Err(e);
                }
                self.phase(AudioPhase::Stopped, None);
            }
            GraphAudioAction::Restart => {
                let settings = self
                    .state
                    .configured
                    .clone()
                    .ok_or("No previous graph configuration")?;
                self.phase(AudioPhase::Stopping, None);
                if let Err(e) = self.release().await {
                    self.phase(AudioPhase::Failed, Some(e.clone()));
                    return Err(e);
                }
                if let Err(e) = self.start(settings).await {
                    if self.state.phase != AudioPhase::Failed {
                        self.phase(AudioPhase::Failed, Some(e.clone()));
                    }
                    return Err(e);
                }
            }
            GraphAudioAction::SaveCopy { name } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Graph audio is not running".into());
                }
                let control = self
                    .state
                    .control
                    .as_ref()
                    .ok_or("No confirmed graph controls")?;
                let settings = self
                    .state
                    .configured
                    .as_ref()
                    .ok_or("No configured graph")?;
                let preset = oxidal_presets::GraphPreset {
                    version: 1,
                    name,
                    sample_rate: settings.stream.input.sample_rate,
                    rig: control.rig.clone(),
                    bindings: settings.bindings.clone(),
                    recall: GraphRecall::from_snapshot(control)?,
                };
                preset.validate().map_err(|e| e.to_string())?;
                let root = self.preset_root.clone();
                let saved = tokio::task::spawn_blocking(move || {
                    oxidal_presets::GraphStore::new(root).save(preset)
                })
                .await
                .map_err(|_| "Graph save task failed")?
                .map_err(|e| e.to_string())?;
                self.state.saved_copy = Some(saved.id);
                self.state.revision += 1;
                self.publish();
            }
            GraphAudioAction::Control { command } => {
                if !self.midi_enabled
                    && matches!(command.action, oxidal_control::Action::Midi { .. })
                {
                    return Err("simulator_disabled".into());
                }
                if self.state.phase != AudioPhase::Running {
                    return Err("Graph audio is not running".into());
                }
                let reply = match self.exchange(&WorkerRequest::Control { command }).await {
                    Ok(r) => r,
                    Err(e) => return Err(self.fault(e).await),
                };
                let error = reply.error.clone();
                self.readback(reply);
                if let Some(error) = error {
                    return Err(error);
                }
            }
        }
        Ok(self.state.clone())
    }
    async fn poll(&mut self) {
        if self.worker.is_none() {
            return;
        }
        if self.state.phase == AudioPhase::Failed {
            if self.release().await.is_ok() {
                self.publish();
            }
            return;
        }
        match self.exchange(&WorkerRequest::Status).await {
            Ok(reply) if reply.error.is_none() => self.readback(reply),
            Ok(_) => {
                self.fault("Invalid graph status reply".into()).await;
            }
            Err(e) => {
                self.fault(e).await;
            }
        }
    }
}
impl GraphPlayback {
    pub fn new(config: &Config) -> Result<Self, String> {
        if let Some(p) = &config.graph_worker
            && (!p.is_absolute() || !p.is_file())
        {
            return Err("Graph worker must be a configured absolute executable".into());
        }
        let initial = GraphAudioState {
            telemetry: None,
            session: format!(
                "graph-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos()
            ),
            revision: 0,
            phase: if config.graph_worker.is_some() {
                AudioPhase::Stopped
            } else {
                AudioPhase::Unavailable
            },
            configured: None,
            control: None,
            native_values: vec![],
            processed_frames: 0,
            device_owned: false,
            error: None,
            experimental: true,
            saved_copy: None,
        };
        let (updates, state) = watch::channel(initial.clone());
        let (commands, mut receiver) =
            mpsc::channel::<(GraphAudioCommand, oneshot::Sender<Reply>)>(1);
        let mut owner = Owner {
            midi_enabled: config.simulator,
            executable: config.graph_worker.clone(),
            preset_root: config.preset_dir.join("graphs"),
            worker: None,
            state: initial,
            updates,
        };
        let mut shutdown = config.shutdown.clone();
        let (done, finished) = watch::channel(false);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(200));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _=async {match shutdown.as_mut(){Some(s)=>{if !*s.borrow(){let _=s.changed().await;}},None=>std::future::pending::<()>().await}}=>break,
                    item=receiver.recv()=>match item {Some((command,response))=>{let _=response.send(owner.command(command).await);},None=>break},
                    _=interval.tick()=>owner.poll().await,
                }
            }
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
        })
    }
    pub fn snapshot(&self) -> GraphAudioState {
        self.state.borrow().clone()
    }
    async fn dispatch(&self, command: GraphAudioCommand) -> Reply {
        let (response, received) = oneshot::channel();
        self.commands
            .try_send((command, response))
            .map_err(|_| "graph_audio_busy")?;
        received
            .await
            .map_err(|_| "Graph owner stopped".to_owned())?
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Json<GraphAudioState> {
    Json(shared.graph_playback.snapshot())
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<GraphAudioCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "invalid_graph_audio_command");
    };
    match shared.graph_playback.dispatch(command).await {
        Ok(state) => Json(state).into_response(),
        Err(e) => failure(StatusCode::CONFLICT, &e),
    }
}
