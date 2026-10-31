//! Actor-owned graph worker. HTTP lifetimes never own PCM or in-flight commands.
use crate::audio_boot::{Choice, Policy, Role};
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
    boot: Arc<Policy>,
    library_access: Arc<tokio::sync::RwLock<()>>,
    forget: mpsc::Sender<crate::library_removal::Forget>,
    pub(super) finished: watch::Receiver<bool>,
    commands: mpsc::Sender<(
        GraphAudioCommand,
        oneshot::Sender<Reply>,
        tokio::sync::OwnedRwLockReadGuard<()>,
    )>,
    state: watch::Receiver<GraphAudioState>,
}
struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    _permit: Option<tokio::sync::SemaphorePermit<'static>>,
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
    levels: Arc<crate::levels::Levels>,
    boot: Arc<Policy>,
    midi_enabled: bool,
    executable: Option<PathBuf>,
    preset_root: PathBuf,
    worker: Option<Worker>,
    state: GraphAudioState,
    updates: watch::Sender<GraphAudioState>,
}
impl Owner {
    fn forget(&mut self, entry: &oxidal_presets::LibraryReference) -> Result<(), String> {
        if entry.kind != oxidal_presets::LibraryKind::Graph {
            return Ok(());
        }
        if self
            .state
            .configured
            .as_ref()
            .is_some_and(|s| s.library_id.as_deref() == Some(&entry.id))
        {
            if self.worker.is_some() {
                return Err("Preset is still in use".into());
            }
            self.state.configured = None;
            self.state.control = None;
            self.state.telemetry = None;
            self.state.native_values.clear();
            self.state.saved_copy = None;
            self.phase(AudioPhase::Stopped, None);
        } else if self.state.saved_copy.as_deref() == Some(&entry.id) {
            self.state.saved_copy = None;
            self.phase(self.state.phase, self.state.error.clone());
        }
        Ok(())
    }
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
        self.release_reserved().await.map(|_| ())
    }
    async fn release_reserved(
        &mut self,
    ) -> Result<Option<tokio::sync::SemaphorePermit<'static>>, String> {
        let Some(worker) = self.worker.as_mut() else {
            return Ok(None);
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
        let reserved = worker._permit.take();
        self.worker = None;
        Ok(reserved)
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
        self.start_reserved(settings, &mut None).await
    }
    async fn start_reserved(
        &mut self,
        mut settings: StartGraph,
        reserved: &mut Option<tokio::sync::SemaphorePermit<'static>>,
    ) -> Result<(), String> {
        // Unit levels follow the player, not the preset or the recovered session.
        settings.stream.levels = self.levels.current();
        settings.validate()?;
        if let Some(id) = &settings.library_id {
            oxidal_presets::GraphStore::new(self.preset_root.clone())
                .read(id)
                .map_err(|e| e.to_string())?;
        }
        if self.worker.is_some() {
            return Err("Stop graph audio before changing its configuration".into());
        }
        let executable = self.executable.as_ref().ok_or("Graph worker unavailable")?;
        if reserved.is_none() {
            *reserved = Some(
                crate::audio::PROBE
                    .try_acquire()
                    .map_err(|_| "Audio device operation already in progress")?,
            );
        }
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
            _permit: None,
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
        let result = match result {
            Ok(reply) if reply.error.is_none() && reply.processed_frames > 0 => {
                self.worker.as_mut().unwrap()._permit = reserved.take();
                self.readback(reply);
                self.phase(AudioPhase::Running, None);
                Ok(())
            }
            Ok(_) => Err(self.fault("Graph worker rejected startup".into()).await),
            Err(e) => Err(self.fault(e).await),
        };
        // A child that could not be reaped still owns the interface. Never let
        // the caller drop its reservation while that child may be alive.
        if result.is_err()
            && let Some(worker) = &mut self.worker
        {
            worker._permit = reserved.take();
        }
        result
    }
    async fn command(&mut self, command: GraphAudioCommand) -> Reply {
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("graph_audio_state_conflict; refresh status".into());
        }
        if self.executable.is_none()
            && !matches!(command.action, GraphAudioAction::SetBoot { enabled: false })
        {
            return Err("Graph worker unavailable".into());
        }
        match command.action {
            GraphAudioAction::HostUtility { command } => {
                if self.state.phase != AudioPhase::Running {
                    return Err("Effects audio is not running".into());
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
                self.readback(reply);
                if let Some(error) = error {
                    return Err(error);
                }
                self.state
                    .configured
                    .as_mut()
                    .ok_or("Missing effects configuration")?
                    .stream
                    .hear_yourself = hear;
                if let oxidal_audio::tools::HostUtility::Levels { levels } = command {
                    self.levels.save(levels)?;
                    if let Some(configured) = self.state.configured.as_mut() {
                        configured.stream.levels = levels;
                    }
                }
                self.state.revision += 1;
                self.publish();
            }

            GraphAudioAction::SetBoot { enabled } => {
                if enabled {
                    if self.state.phase != AudioPhase::Running {
                        return Err(
                            "Start and verify effects audio before enabling boot playback".into(),
                        );
                    }
                    let control = self
                        .state
                        .control
                        .as_ref()
                        .ok_or("No confirmed effects controls")?;
                    let mut settings = self
                        .state
                        .configured
                        .clone()
                        .ok_or("No effects configuration")?;
                    settings.rig = control.rig.clone();
                    settings.recall = Some(GraphRecall::from_snapshot(control)?);
                    self.boot.set(Choice::Effects { settings })?;
                } else {
                    self.boot.clear(Role::Effects)?;
                }
                self.state.start_on_boot = self.boot.enabled(Role::Effects);
                self.state.revision += 1;
                self.publish();
            }
            GraphAudioAction::Reconfigure { stream } => {
                let previous = self
                    .state
                    .configured
                    .clone()
                    .ok_or("No effects configuration")?;
                let mut candidate = previous.clone();
                candidate.stream = stream;
                candidate.validate()?;
                if self.worker.is_some() {
                    if self.state.phase != AudioPhase::Running {
                        return Err(
                            "Wait for effects audio to settle before applying settings".into()
                        );
                    }
                    if self
                        .state
                        .control
                        .as_ref()
                        .is_some_and(|s| s.edit.is_some())
                    {
                        return Err("Finish the current adjustment first".into());
                    }
                    self.phase(AudioPhase::Stopping, None);
                    let mut reserved = match self.release_reserved().await {
                        Ok(permit) => permit,
                        Err(error) => return Err(self.fault(error).await),
                    };
                    if let Err(error) = self.start_reserved(candidate, &mut reserved).await {
                        let restored = self.start_reserved(previous.clone(), &mut reserved).await;
                        if restored.is_err() {
                            self.state.configured = Some(previous);
                            self.state.phase = AudioPhase::Failed;
                        }
                        let message = match restored {
                            Ok(()) => format!(
                                "Audio settings rejected; previous session restored: {error}"
                            ),
                            Err(recovery) => format!(
                                "Audio settings rejected: {error}; previous session could not restart: {recovery}"
                            ),
                        };
                        self.state.error = Some(message.clone());
                        self.state.revision += 1;
                        self.publish();
                        return Err(message);
                    }
                } else if let Err(error) = self.start(candidate).await {
                    self.state.configured = Some(previous);
                    self.phase(AudioPhase::Failed, Some(error.clone()));
                    return Err(error);
                }
            }
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
                        library_id: None,
                        name: None,
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
                let mut reserved = match self.release_reserved().await {
                    Ok(permit) => permit,
                    Err(e) => {
                        self.phase(AudioPhase::Failed, Some(e.clone()));
                        return Err(e);
                    }
                };
                if let Err(e) = self.start_reserved(settings, &mut reserved).await {
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
                if let Some(settings) = &mut self.state.configured {
                    settings.name = Some(saved.preset.name);
                }
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
    pub fn new(
        config: &Config,
        policy: Arc<Policy>,
        levels: Arc<crate::levels::Levels>,
        library_access: Arc<tokio::sync::RwLock<()>>,
    ) -> Result<Self, String> {
        if let Some(p) = &config.graph_worker
            && (!p.is_absolute() || !p.is_file())
        {
            return Err("Graph worker must be a configured absolute executable".into());
        }
        let boot = policy.snapshot();
        let initial = GraphAudioState {
            start_on_boot: policy.enabled(Role::Effects),
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
        let (commands, mut receiver) = mpsc::channel::<(
            GraphAudioCommand,
            oneshot::Sender<Reply>,
            tokio::sync::OwnedRwLockReadGuard<()>,
        )>(1);
        let (forget, mut forgotten) = mpsc::channel::<crate::library_removal::Forget>(1);
        let mut owner = Owner {
            levels,
            boot: policy.clone(),
            midi_enabled: config.simulator,
            executable: config.graph_worker.clone(),
            preset_root: config.preset_dir.join("graphs"),
            worker: None,
            state: initial,
            updates,
        };
        let mut shutdown = config.shutdown.clone();
        let (done, finished) = watch::channel(false);
        let owner_access = library_access.clone();
        let boot_access = owner_access
            .clone()
            .try_read_owned()
            .map_err(|_| "Library operation in progress during startup")?;
        tokio::spawn(async move {
            if let Ok(Some(Choice::Effects { settings })) = boot
                && owner.executable.is_some()
                && let Err(error) = owner.start(settings).await
            {
                owner.phase(AudioPhase::Failed, Some(error));
            }
            drop(boot_access);
            let mut interval = tokio::time::interval(Duration::from_millis(200));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _=async {match shutdown.as_mut(){Some(s)=>{if !*s.borrow(){let _=s.changed().await;}},None=>std::future::pending::<()>().await}}=>break,
                    request = forgotten.recv() => match request { Some((entry, reply)) => { let _ = reply.send(owner.forget(&entry)); }, None => break },
                    item=receiver.recv()=>match item {Some((command,response,_access))=>{let _=response.send(owner.command(command).await);},None=>break},
                    _=interval.tick()=>{if let Ok(_access) = owner_access.clone().try_read_owned() { owner.poll().await; }},
                }
            }
            drop(receiver);
            drop(forgotten);
            let _shutdown_access = owner_access.clone().read_owned().await;
            while owner.worker.is_some() {
                if owner.release().await.is_err() {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
            done.send_replace(true);
        });
        Ok(Self {
            boot: policy,
            library_access,
            forget,
            commands,
            state,
            finished,
        })
    }
    pub async fn forget(&self, entry: oxidal_presets::LibraryReference) -> Result<(), String> {
        let (reply, receipt) = oneshot::channel();
        self.forget
            .send((entry, reply))
            .await
            .map_err(|_| "Playback owner stopped".to_owned())?;
        receipt
            .await
            .map_err(|_| "Playback owner stopped".to_owned())?
    }
    pub(super) fn subscribe(&self) -> watch::Receiver<GraphAudioState> {
        self.state.clone()
    }
    pub fn snapshot(&self) -> GraphAudioState {
        let mut state = self.state.borrow().clone();
        state.start_on_boot = self.boot.enabled(Role::Effects);
        state
    }
    pub(crate) async fn dispatch(&self, command: GraphAudioCommand) -> Reply {
        let access = self.library_access.clone().read_owned().await;
        let (response, received) = oneshot::channel();
        self.commands
            .try_send((command, response, access))
            .map_err(|_| "graph_audio_busy")?;
        let mut state = received
            .await
            .map_err(|_| "Graph owner stopped".to_owned())??;
        state.start_on_boot = self.boot.enabled(Role::Effects);
        Ok(state)
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
