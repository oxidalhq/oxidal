//! Immutable local native checkpoints and bounded structural authoring history.
//! No browser-provided path or opaque native payload crosses this boundary.
use crate::{Engine, State};
use oxidal_audio::{
    lifecycle::StartAudio,
    structure::{AuthoringAction, AuthoringStatus, valid_receipt},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    path::{Path, PathBuf},
};
mod clipboard;
mod gesture;
mod tools;

const MAX_STATE: usize = 32 * 1024 * 1024;
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
const HISTORY_ENTRIES: usize = 8;
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    history: Option<History>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    schema: u32,
    profile: String,
    origin: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    undo: Vec<String>,
    redo: Vec<String>,
}
impl History {
    fn valid(&self) -> bool {
        self.undo.len() + self.redo.len() <= HISTORY_ENTRIES
            && self
                .undo
                .iter()
                .chain(&self.redo)
                .all(|id| valid_receipt(id))
    }
}
fn profile() -> String {
    format!(
        "{:x}",
        Sha256::digest(include_bytes!("../../../native/tone3000/sources.json"))
    )
}
fn compatible_profile(candidate: &str) -> bool {
    // The distributed-convolution overlay changes scheduling/partition size,
    // never the captured state codec. Keep the exact preceding profile readable
    // across this upgrade; unknown profiles still fail closed.
    candidate == profile()
        || candidate == "3d1597be8cdb3d5e021d0534ee2766839e875029803d62b1d3835d8010555c82"
}
pub fn origin(settings: &StartAudio) -> String {
    format!(
        "{}:{}",
        if settings.draft {
            "draft"
        } else if settings.owned {
            "owned"
        } else {
            "original"
        },
        settings.preset_id
    )
}
fn prepared_setting(id: &str) -> bool {
    crate::protocol::writable(id) && !crate::protocol::live_writable(id)
        || matches!(id, "calibrateInput" | "targetLoudness")
}
fn directory(root: &Path) -> PathBuf {
    root.join("native-checkpoints")
}
/// A checkpoint is a full captured session; scalar/model edits after it replay normally.
pub fn read(root: &Path, id: &str, source: &str) -> Result<State, String> {
    read_parts(root, id, source).map(|(_, state)| state)
}
fn read_parts(root: &Path, id: &str, source: &str) -> Result<(Header, State), String> {
    read_envelope(root, id, source, true)
}
fn read_envelope(
    root: &Path,
    id: &str,
    source: &str,
    allow_history: bool,
) -> Result<(Header, State), String> {
    if !valid_receipt(id) {
        return Err("Invalid working receipt".into());
    }
    let mut bytes = vec![];
    std::fs::File::open(directory(root).join(id))
        .map_err(|e| format!("Cannot read native working state: {e}"))?
        .take((MAX_STATE + 4097) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_STATE + 4096 || format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Native working checkpoint checksum/size differs".into());
    }
    let split = bytes
        .iter()
        .position(|b| *b == b'\n')
        .filter(|n| *n <= 4096)
        .ok_or("Invalid checkpoint header")?;
    let header: Header = serde_json::from_slice(&bytes[..split]).map_err(|e| e.to_string())?;
    if !matches!(header.schema, 1 | 2)
        || (header.schema == 2) != header.history.is_some()
        || (header.schema == 2) != header.state.is_some()
        || header.state.as_deref().is_some_and(|id| !valid_receipt(id))
        || header.schema == 2 && !allow_history
        || header
            .history
            .as_ref()
            .is_some_and(|history| !history.valid())
        || !compatible_profile(&header.profile)
        || header.origin != source
        || if header.schema == 1 {
            bytes.len() <= split + 5
        } else {
            bytes.len() != split + 1
        }
    {
        return Err("Native working checkpoint profile/source differs".into());
    }
    let state = if let Some(id) = &header.state {
        read_envelope(root, id, source, false)?.1
    } else {
        State(bytes.split_off(split + 1))
    };
    Ok((header, state))
}
fn write(root: &Path, source: &str, state: &State) -> Result<String, String> {
    write_envelope(root, source, state, None)
}
fn write_envelope(
    root: &Path,
    source: &str,
    state: &State,
    history: Option<History>,
) -> Result<String, String> {
    if state.byte_len() < 5
        || state.byte_len() > MAX_STATE
        || history.as_ref().is_some_and(|h| !h.valid())
    {
        return Err("Invalid native checkpoint size".into());
    }
    // The current state and stack entries share immutable raw captures; a new
    // history cursor adds only metadata instead of duplicating large model bytes.
    let state_id = if history.is_some() {
        Some(write(root, source, state)?)
    } else {
        None
    };
    let indexed = state_id.is_some();
    let mut bytes = serde_json::to_vec(&Header {
        schema: if indexed { 2 } else { 1 },
        history,
        state: state_id,
        profile: profile(),
        origin: source.into(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    if !indexed {
        bytes.extend_from_slice(&state.0);
    }
    let id = format!("{:x}", Sha256::digest(&bytes));
    let parent = directory(root);
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let destination = parent.join(&id);
    if destination.exists() {
        read(root, &id, source)?;
        return Ok(id);
    }
    let temporary = parent.join(format!(
        ".pending-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        std::fs::File::open(&parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(id)
}
fn read_history(
    root: &Path,
    id: &str,
    source: &str,
) -> Result<(VecDeque<State>, VecDeque<State>), String> {
    let (header, _) = read_parts(root, id, source)?;
    let Some(history) = header.history else {
        return Ok((VecDeque::new(), VecDeque::new()));
    };
    let mut bytes = 0usize;
    let mut load = |ids: Vec<String>| -> Result<VecDeque<State>, String> {
        ids.into_iter()
            .map(|id| {
                let (header, state) = read_envelope(root, &id, source, false)?;
                if header.history.is_some() {
                    return Err("Nested native history is not supported".into());
                }
                bytes = bytes
                    .checked_add(state.byte_len())
                    .ok_or("History byte budget exceeded")?;
                if bytes > HISTORY_BYTES {
                    return Err("History byte budget exceeded".into());
                }
                Ok(state)
            })
            .collect()
    };
    Ok((load(history.undo)?, load(history.redo)?))
}
fn write_history(
    root: &Path,
    source: &str,
    current: &State,
    mut undo: Vec<&State>,
    mut redo: Vec<&State>,
) -> Result<String, String> {
    while undo.len() + redo.len() > HISTORY_ENTRIES
        || undo
            .iter()
            .chain(&redo)
            .map(|s| s.byte_len())
            .sum::<usize>()
            > HISTORY_BYTES
    {
        if undo.is_empty() {
            redo.remove(0);
        } else {
            undo.remove(0);
        }
    }
    let save = |states: Vec<&State>| -> Result<Vec<String>, String> {
        states
            .into_iter()
            .map(|state| write(root, source, state))
            .collect()
    };
    let history = History {
        undo: save(undo)?,
        redo: save(redo)?,
    };
    write_envelope(root, source, current, Some(history))
}
pub fn reconstruct(
    root: &Path,
    request: &oxidal_audio::lifecycle::SavePlayback,
) -> Result<Engine, Box<dyn std::error::Error>> {
    request.settings.validate()?;
    if !oxidal_audio::lifecycle::valid_controls(&request.controls)
        || !oxidal_audio::lifecycle::valid_models(&request.models)
        || request
            .eq
            .as_ref()
            .is_some_and(|eq| !oxidal_audio::eq::valid_snapshot(eq))
    {
        return Err("Invalid confirmed native reconstruction".into());
    }
    let settings = &request.settings;
    let preset = if settings.owned || settings.draft {
        oxidal_presets::OwnedStore::new(root.join(if settings.draft {
            "working-native"
        } else {
            "owned"
        }))
        .read(&settings.preset_id)?
        .1
    } else {
        oxidal_presets::Store::new(root.into()).original(&settings.preset_id)?
    };
    let frames = settings.stream.input.period_frames as usize;
    let mut engine = Engine::new(settings.stream.input.sample_rate.into(), frames)?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    if let Some(id) = &settings.working {
        engine.restore(&read(root, id, &origin(settings))?)?;
        engine.wait_ready()?;
    }
    crate::model_preparation::restore(&mut engine, root, &request.models, frames)?;
    engine.apply_live_snapshot(&request.controls)?;
    if let Some(eq) = &request.eq {
        engine.restore_eq(eq, &mut 0)?;
    }
    engine.wait_ready()?;
    Ok(engine)
}

#[derive(Debug)]
pub struct Authoring {
    root: PathBuf,
    source: String,
    working: Option<String>,
    undo: VecDeque<State>,
    redo: VecDeque<State>,
    failed: bool,
    history_error: Option<String>,
    gesture: Option<gesture::Pending>,
    finished_gestures: VecDeque<(String, String)>,
    tools: oxidal_audio::tools::State,
    measurement: Option<tools::Baseline>,
    /// Background persistence for knob adjustments, started on first use.
    writer: Option<HistoryWriter>,
}
/// Writes adjustment checkpoints off the realtime audio thread. Content-addressed
/// history writes hash, verify and fsync state files: about 100 ms on an SD card.
#[derive(Debug)]
struct HistoryWriter {
    jobs: std::sync::mpsc::Sender<HistoryJob>,
    receipts: std::sync::mpsc::Receiver<Result<String, String>>,
    in_flight: usize,
}
#[derive(Debug)]
struct HistoryJob {
    root: PathBuf,
    source: String,
    current: State,
    undo: Vec<State>,
    redo: Vec<State>,
}
impl HistoryWriter {
    fn start() -> Option<Self> {
        let (jobs, queue) = std::sync::mpsc::channel::<HistoryJob>();
        let (done, receipts) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("oxidal-history".into())
            .spawn(move || {
                // Started from the audio thread: never compete with it.
                oxidal_audio::realtime::leave();
                for job in queue {
                    let result = write_history(
                        &job.root,
                        &job.source,
                        &job.current,
                        job.undo.iter().collect(),
                        job.redo.iter().collect(),
                    );
                    if done.send(result).is_err() {
                        break;
                    }
                }
            })
            .ok()?;
        Some(Self {
            jobs,
            receipts,
            in_flight: 0,
        })
    }
}
impl Authoring {
    pub fn new(root: &Path, settings: &StartAudio) -> Self {
        Self::for_source(root, origin(settings), settings.working.clone())
    }
    pub fn for_source(root: &Path, source: String, working: Option<String>) -> Self {
        let (undo, redo, history_error) = match working
            .as_ref()
            .map(|id| read_history(root, id, &source))
            .transpose()
        {
            Ok(Some((undo, redo))) => (undo, redo, None),
            Ok(None) => (VecDeque::new(), VecDeque::new(), None),
            Err(error) => (
                VecDeque::new(),
                VecDeque::new(),
                Some(
                    format!("Undo history unavailable: {error}")
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(240)
                        .collect(),
                ),
            ),
        };
        Self {
            root: root.into(),
            source,
            working,
            undo,
            redo,
            history_error,
            failed: false,
            gesture: None,
            finished_gestures: VecDeque::new(),
            tools: Default::default(),
            measurement: None,
            writer: None,
        }
    }
    pub fn working_receipt(&self) -> Option<&str> {
        self.working.as_deref()
    }
    /// Adopt finished background checkpoints. Call before reading the receipt
    /// for a request, so a late receipt is not mistaken for that request's edit.
    pub fn collect_receipts(&mut self) {
        let Some(writer) = self.writer.as_mut() else {
            return;
        };
        while let Ok(result) = writer.receipts.try_recv() {
            writer.in_flight = writer.in_flight.saturating_sub(1);
            match result {
                Ok(receipt) => self.working = Some(receipt),
                Err(error) => {
                    self.history_error = Some(
                        format!("Adjustment history not saved: {error}")
                            .chars()
                            .filter(|c| !c.is_control())
                            .take(240)
                            .collect(),
                    )
                }
            }
        }
    }
    /// Wait for background checkpoints before a synchronous one, so an older
    /// receipt can never replace a newer one.
    fn settle_writes(&mut self) {
        while self.writer.as_ref().is_some_and(|w| w.in_flight > 0) {
            let writer = self.writer.as_mut().unwrap();
            match writer.receipts.recv() {
                Ok(result) => {
                    writer.in_flight -= 1;
                    match result {
                        Ok(receipt) => self.working = Some(receipt),
                        Err(error) => self.history_error = Some(error),
                    }
                }
                Err(_) => {
                    self.writer = None;
                }
            }
        }
    }
    /// Queue an adjustment checkpoint; falls back to writing now if the
    /// background writer cannot start.
    fn checkpoint_later(&mut self, after: State, before: &State) -> Result<(), String> {
        if self.writer.is_none() {
            self.writer = HistoryWriter::start();
        }
        let mut undo: Vec<State> = self.undo.iter().cloned().collect();
        if after != *before {
            undo.push(before.clone());
        }
        let job = HistoryJob {
            root: self.root.clone(),
            source: self.source.clone(),
            current: after,
            undo,
            redo: vec![],
        };
        match self.writer.as_mut() {
            Some(writer) => match writer.jobs.send(job) {
                Ok(()) => {
                    writer.in_flight += 1;
                    Ok(())
                }
                Err(std::sync::mpsc::SendError(job)) => {
                    self.writer = None;
                    self.working = Some(write_history(
                        &job.root,
                        &job.source,
                        &job.current,
                        job.undo.iter().collect(),
                        vec![],
                    )?);
                    Ok(())
                }
            },
            None => {
                self.working = Some(write_history(
                    &job.root,
                    &job.source,
                    &job.current,
                    job.undo.iter().collect(),
                    vec![],
                )?);
                Ok(())
            }
        }
    }
    pub fn failed(&self) -> bool {
        self.failed
    }
    pub fn snapshot(&self, engine: &mut Engine) -> Result<AuthoringStatus, String> {
        let parameters: Vec<crate::protocol::Parameter> =
            serde_json::from_value(engine.catalog().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let mut tools = self.tools.clone();
        let active = |id: &str| parameters.iter().any(|p| p.id == id && p.normalized > 0.5);
        tools.solo = match (active("chainSoloLeft"), active("chainSoloRight")) {
            (true, false) => oxidal_audio::tools::Solo::Left,
            (false, true) => oxidal_audio::tools::Solo::Right,
            _ => oxidal_audio::tools::Solo::None,
        };
        let mut setting_steps: std::collections::BTreeMap<String, f32> = parameters
            .iter()
            .filter(|p| prepared_setting(&p.id))
            .map(|p| {
                let step = if p.toggle {
                    1.0
                } else if p.interval > 0.0 && p.maximum > p.minimum {
                    (p.interval / (p.maximum - p.minimum)).min(1.0) as f32
                } else {
                    0.01
                };
                (p.id.clone(), step)
            })
            .collect();
        let mut settings: Vec<oxidal_audio::lifecycle::LiveControl> = parameters
            .into_iter()
            .filter(|p| prepared_setting(&p.id))
            .map(|p| oxidal_audio::lifecycle::LiveControl {
                target: p.id.clone(),
                label: crate::native::parameter_label(&p.id).into(),
                display: crate::native::parameter_display(&p),
                value: p.normalized as f32,
                toggle: p.toggle,
            })
            .collect();
        for control in engine
            .block_controls()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|p| p.staged && p.parameter == "slimSize")
        {
            setting_steps.insert(control.id.clone(), control.step as f32);
            settings.push(oxidal_audio::lifecycle::LiveControl {
                target: control.id,
                label: format!(
                    "NAM size · {} · {}",
                    control.lane,
                    control.name.chars().take(32).collect::<String>()
                ),
                display: if control.value == 0.0 {
                    "Lite".into()
                } else if control.value == 1.0 {
                    "Full".into()
                } else {
                    format!("{:.1}%", control.value * 100.0)
                },
                value: control.value as f32,
                toggle: false,
            });
        }
        let state = AuthoringStatus {
            history_error: self.history_error.clone(),
            gesture: self.gesture.as_ref().map(|g| g.owner.clone()),
            settings,
            setting_steps,
            tools,
            layout: engine.layout().map_err(|e| e.to_string())?,
            can_paste: clipboard::available(&self.root),
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
            working: self.working.clone(),
        };
        if !state.valid() {
            return Err("Invalid native authoring catalog".into());
        }
        Ok(state)
    }
    /// Control-owner transaction between PCM steps. Allocates and may rebuild native
    /// processors: functional authoring, never a gapless/real-time transition claim.
    pub fn command(
        &mut self,
        engine: &mut Engine,
        action: AuthoringAction,
    ) -> Result<AuthoringStatus, String> {
        self.execute(engine, action, false)
    }
    /// Isolated, non-PCM preparation only. The supervisor admits this receipt by
    /// rebuilding the stream and retains the old session if that admission fails.
    pub fn prepare_parameter(
        &mut self,
        engine: &mut Engine,
        parameter: String,
        value: f32,
    ) -> Result<AuthoringStatus, String> {
        self.execute(
            engine,
            AuthoringAction::Parameter { parameter, value },
            true,
        )
    }
    fn execute(
        &mut self,
        engine: &mut Engine,
        action: AuthoringAction,
        reprepare: bool,
    ) -> Result<AuthoringStatus, String> {
        if matches!(action, AuthoringAction::Parameter { .. }) && !reprepare {
            return Err("This setting requires isolated audio preparation".into());
        }
        if self.failed {
            return Err("Native authoring failed; restart required".into());
        }
        if self
            .gesture
            .as_ref()
            .is_some_and(|g| g.updated.elapsed() > std::time::Duration::from_secs(120))
        {
            self.finish_gesture(engine)?;
        }
        if let AuthoringAction::Spectrum { block_id, enabled } = &action {
            if *enabled {
                let bins = engine
                    .spectrum(block_id, Some(true))
                    .map_err(|e| e.to_string())?;
                self.tools.spectrum = Some(oxidal_audio::tools::Spectrum {
                    block_id: block_id.clone(),
                    bins,
                });
            } else if self
                .tools
                .spectrum
                .as_ref()
                .is_some_and(|s| s.block_id == *block_id)
            {
                let _ = engine.spectrum(block_id, Some(false));
                self.tools.spectrum = None;
            }
            return self.snapshot(engine);
        }
        if let AuthoringAction::Gesture { edit } = action {
            return self.gesture_command(engine, edit);
        }
        if self.gesture_pending()
            && !matches!(
                action,
                AuthoringAction::Inspect
                    | AuthoringAction::Copy { .. }
                    | AuthoringAction::Utility {
                        command: oxidal_audio::tools::Command::Poll
                            | oxidal_audio::tools::Command::Tuner { .. }
                            | oxidal_audio::tools::Command::Cancel
                    }
            )
        {
            return Err("Finish the active adjustment first".into());
        }
        if let AuthoringAction::Utility { command } = action {
            return self.utility_command(engine, command);
        }
        if self.measurement_pending() && !matches!(action, AuthoringAction::Inspect) {
            return Err("Cancel measurement before editing".into());
        }
        if let AuthoringAction::Copy { block_id } = &action {
            clipboard::copy(engine, &self.root, block_id)?;
            return self.snapshot(engine);
        }
        if matches!(action, AuthoringAction::Inspect) {
            return self.snapshot(engine);
        }
        if matches!(action, AuthoringAction::Undo) && self.undo.is_empty()
            || matches!(action, AuthoringAction::Redo) && self.redo.is_empty()
        {
            return Err("No authoring history available".into());
        }
        // Prepared processing/calibration settings are device/session configuration, outside
        // tone history. Keep their current values while restoring an older tone.
        let monitoring = self.snapshot(engine)?.tools.solo;
        let processing = if matches!(action, AuthoringAction::Undo | AuthoringAction::Redo) {
            self.snapshot(engine)?
                .settings
                .into_iter()
                .filter(|p| prepared_setting(&p.target))
                .collect::<Vec<_>>()
        } else {
            vec![]
        };
        let before = engine.capture().map_err(|e| e.to_string())?;
        let latency = engine.latency_samples().map_err(|e| e.to_string())?;
        self.settle_writes();
        let result = (|| -> Result<(State, String), String> {
            match &action {
                AuthoringAction::RefreshMetadata { block_id, tone } => {
                    engine
                        .refresh_metadata(block_id, tone)
                        .map_err(|e| e.to_string())?;
                }
                AuthoringAction::SelectModel { block_id, model_id } => {
                    engine
                        .select_local_model(block_id, *model_id)
                        .map_err(|e| e.to_string())?;
                }
                AuthoringAction::Eq { block_id, edit } => {
                    engine.set_eq(block_id, edit).map_err(|e| e.to_string())?
                }
                AuthoringAction::Edit { edit } => {
                    if matches!(edit, oxidal_audio::structure::StructureEdit::Paste { .. }) {
                        clipboard::load_into(engine, &self.root)?;
                    }
                    engine.edit_structure(edit).map_err(|e| e.to_string())?
                }
                AuthoringAction::Parameter { parameter, value } => {
                    let allowed = self
                        .snapshot(engine)?
                        .settings
                        .into_iter()
                        .find(|p| p.target == *parameter && p.accepts(*value))
                        .ok_or("Invalid or non-staged native setting")?;
                    if let Some(block) = engine
                        .block_controls()
                        .map_err(|e| e.to_string())?
                        .into_iter()
                        .find(|p| p.id == allowed.target && p.staged && p.parameter == "slimSize")
                    {
                        engine
                            .set_block(&block.block_id, &block.parameter, *value)
                            .map_err(|e| e.to_string())?;
                    } else {
                        engine
                            .set_normalized(&allowed.target, *value)
                            .map_err(|e| e.to_string())?;
                    }
                }
                AuthoringAction::Remove { block_id } => {
                    let layout = engine.layout().map_err(|e| e.to_string())?;
                    if !layout
                        .left
                        .iter()
                        .chain(&layout.right)
                        .any(|b| b.id == *block_id && !b.insert)
                    {
                        return Err("Missing or stale native block".into());
                    }
                    engine.remove_block(block_id).map_err(|e| e.to_string())?;
                }
                AuthoringAction::Undo => engine
                    .restore(self.undo.back().ok_or("No undo available")?)
                    .map_err(|e| e.to_string())?,
                AuthoringAction::Redo => engine
                    .restore(self.redo.back().ok_or("No redo available")?)
                    .map_err(|e| e.to_string())?,
                AuthoringAction::Inspect
                | AuthoringAction::Copy { .. }
                | AuthoringAction::Utility { .. }
                | AuthoringAction::Gesture { .. }
                | AuthoringAction::Spectrum { .. } => unreachable!(),
            }
            for setting in &processing {
                engine
                    .set_normalized(&setting.target, setting.value)
                    .map_err(|e| e.to_string())?;
            }
            if matches!(action, AuthoringAction::Undo | AuthoringAction::Redo) {
                let side = if engine.layout().map_err(|e| e.to_string())?.stereo {
                    monitoring
                } else {
                    oxidal_audio::tools::Solo::None
                };
                engine.set_solo(side).map_err(|e| e.to_string())?;
            } else if matches!(action, AuthoringAction::Edit { .. })
                && !engine.layout().map_err(|e| e.to_string())?.stereo
            {
                engine
                    .set_solo(oxidal_audio::tools::Solo::None)
                    .map_err(|e| e.to_string())?;
            }
            // Hot EQ edits do not load models; do not inject a silent PCM block
            // into the live processor merely to wait for an already-ready model.
            if !matches!(
                action,
                AuthoringAction::Eq { .. } | AuthoringAction::RefreshMetadata { .. }
            ) {
                engine.wait_ready().map_err(|e| e.to_string())?;
            }
            if !reprepare && engine.latency_samples().map_err(|e| e.to_string())? != latency {
                return Err("Edit changes audio latency; fresh audio preparation required".into());
            }
            engine.live_controls().map_err(|e| e.to_string())?;
            engine.eq_snapshot().map_err(|e| e.to_string())?;
            engine.slots().map_err(|e| e.to_string())?;
            self.snapshot(engine)?;
            let after = engine.capture().map_err(|e| e.to_string())?;
            let receipt = self.checkpoint(&after, &before, Some(&action))?;
            Ok((after, receipt))
        })();
        let (after, receipt) = match result {
            Ok(value) => value,
            Err(error) => {
                // Invalid/stale requests which never changed native state must not
                // reset the playing processor or its transient histories.
                if engine.capture().is_ok_and(|current| current == before) {
                    return Err(error);
                }
                if let Err(rollback) = engine.restore(&before).and_then(|_| engine.wait_ready()) {
                    self.failed = true;
                    return Err(format!(
                        "Native authoring rollback failed: {rollback}; initial error: {error}"
                    ));
                }
                return Err(error);
            }
        };
        match action {
            AuthoringAction::Undo => {
                self.undo.pop_back();
                self.redo.push_back(before);
            }
            AuthoringAction::Redo => {
                self.redo.pop_back();
                self.undo.push_back(before);
            }
            AuthoringAction::Parameter { parameter, .. } if prepared_setting(&parameter) => {}
            _ if before != after => {
                self.undo.push_back(before);
                self.redo.clear();
            }
            _ => (),
        }
        self.tools.balance = Default::default();
        self.tools.alignment = Default::default();
        self.history_error = None;
        self.working = Some(receipt);
        self.trim_history();
        self.snapshot(engine)
    }
    /// A prepared model splice is one logical edit, separate from older knob
    /// gestures. Publish its verified working state before exposing Undo/Redo.
    pub fn record_external(
        &mut self,
        engine: &mut Engine,
        before: State,
    ) -> Result<AuthoringStatus, String> {
        if self.failed || self.gesture_pending() || self.measurement_pending() {
            return Err("Finish the active native edit before checkpointing models".into());
        }
        self.settle_writes();
        let result = (|| -> Result<(State, String), String> {
            self.snapshot(engine)?;
            let after = engine.capture().map_err(|e| e.to_string())?;
            let receipt = self.checkpoint(&after, &before, None)?;
            Ok((after, receipt))
        })();
        let (after, receipt) = match result {
            Ok(value) => value,
            Err(error) => {
                if let Err(rollback) = engine.restore(&before).and_then(|_| engine.wait_ready()) {
                    self.failed = true;
                    return Err(format!(
                        "Model history rollback failed: {rollback}; initial error: {error}"
                    ));
                }
                return Err(error);
            }
        };
        if after != before {
            self.undo.push_back(before);
            self.redo.clear();
        }
        self.history_error = None;
        self.working = Some(receipt);
        self.tools.balance = Default::default();
        self.tools.alignment = Default::default();
        self.trim_history();
        self.snapshot(engine)
    }
    fn checkpoint(
        &self,
        after: &State,
        before: &State,
        action: Option<&AuthoringAction>,
    ) -> Result<String, String> {
        let mut undo: Vec<_> = self.undo.iter().collect();
        let mut redo: Vec<_> = self.redo.iter().collect();
        match action {
            Some(AuthoringAction::Parameter { parameter, .. }) if prepared_setting(parameter) => {}
            Some(AuthoringAction::Undo) => {
                undo.pop();
                redo.push(before);
            }
            Some(AuthoringAction::Redo) => {
                redo.pop();
                undo.push(before);
            }
            _ if after != before => {
                undo.push(before);
                redo.clear();
            }
            _ => {}
        }
        write_history(&self.root, &self.source, after, undo, redo)
    }
    fn trim_history(&mut self) {
        while self.undo.len() + self.redo.len() > HISTORY_ENTRIES
            || self
                .undo
                .iter()
                .chain(&self.redo)
                .map(State::byte_len)
                .sum::<usize>()
                + self.gesture.as_ref().map_or(0, gesture::Pending::byte_len)
                > HISTORY_BYTES
        {
            if self.undo.is_empty() {
                self.redo.pop_front();
            } else {
                self.undo.pop_front();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_history_survives_replacement_and_corruption_does_not_hide_current_state() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source = "original:history-fixture";
        let current = State(b"current private native capture".to_vec());
        let states: Vec<_> = (0..10)
            .map(|i| State(format!("prior private native capture {i}").into_bytes()))
            .collect();
        let receipt =
            write_history(&root, source, &current, states.iter().collect(), vec![]).unwrap();
        assert_eq!(read(&root, &receipt, source).unwrap(), current);
        let (undo, redo) = read_history(&root, &receipt, source).unwrap();
        assert_eq!(undo.len(), HISTORY_ENTRIES);
        assert!(redo.is_empty());
        assert_eq!(undo.front(), Some(&states[2]));
        let owner = Authoring::for_source(&root, source.into(), Some(receipt.clone()));
        assert_eq!(owner.undo, undo);
        assert!(owner.history_error.is_none());
        assert!(read_history(&root, &receipt, "owned:different-source").is_err());
        let (header, _) = read_parts(&root, &receipt, source).unwrap();
        let old = directory(&root).join(&header.history.unwrap().undo[0]);
        let bytes = std::fs::read(&old).unwrap();
        std::fs::write(&old, b"damaged historical capture").unwrap();
        assert!(read_history(&root, &receipt, source).is_err());
        assert_eq!(
            read(&root, &receipt, source).unwrap(),
            current,
            "The current working tone is independently verified"
        );
        let degraded = Authoring::for_source(&root, source.into(), Some(receipt));
        assert!(degraded.history_error.is_some() && degraded.undo.is_empty() && !degraded.failed());
        std::fs::write(&old, bytes).unwrap();
        let receipt =
            write_history(&root, source, &current, vec![&states[0]], vec![&states[1]]).unwrap();
        let (undo, redo) = read_history(&root, &receipt, source).unwrap();
        assert_eq!(undo, VecDeque::from([states[0].clone()]));
        assert_eq!(redo, VecDeque::from([states[1].clone()]));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn checkpoints_are_atomic_content_verified_and_bound_to_source_and_profile() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-checkpoint-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state = State(b"private native capture fixture".to_vec());
        let id = write(&root, "original:fixture", &state).unwrap();
        assert_eq!(read(&root, &id, "original:fixture").unwrap(), state);
        assert_eq!(write(&root, "original:fixture", &state).unwrap(), id);
        assert!(read(&root, &id, "owned:another-source").is_err());
        assert!(read(&root, "../outside", "original:fixture").is_err());
        let path = directory(&root).join(&id);
        let original = std::fs::read(&path).unwrap();
        let mut corrupted = original.clone();
        *corrupted.last_mut().unwrap() ^= 1;
        std::fs::write(&path, corrupted).unwrap();
        assert!(read(&root, &id, "original:fixture").is_err());
        assert!(
            write(&root, "original:fixture", &state).is_err(),
            "existing damaged receipt must not be silently repaired"
        );
        std::fs::write(&path, &original).unwrap();
        // Re-hash a legitimate previous-profile envelope, as an upgrade would
        // encounter it. Content verification remains independent of compatibility.
        let split = original.iter().position(|b| *b == b'\n').unwrap();
        let mut header: Header = serde_json::from_slice(&original[..split]).unwrap();
        for (old_profile, accepted) in [
            (
                "3d1597be8cdb3d5e021d0534ee2766839e875029803d62b1d3835d8010555c82",
                true,
            ),
            ("unreviewed-native-profile", false),
        ] {
            header.profile = old_profile.into();
            let mut migrated = serde_json::to_vec(&header).unwrap();
            migrated.extend_from_slice(&original[split..]);
            let receipt = format!("{:x}", Sha256::digest(&migrated));
            std::fs::write(directory(&root).join(&receipt), migrated).unwrap();
            let result = read(&root, &receipt, "original:fixture");
            assert_eq!(result.is_ok(), accepted);
            if accepted {
                assert_eq!(result.unwrap(), state);
                assert!(read(&root, &receipt, "owned:wrong-origin").is_err());
            }
        }
        std::fs::write(directory(&root).join(".pending-interrupted"), b"incomplete").unwrap();
        assert_eq!(read(&root, &id, "original:fixture").unwrap(), state);
        std::fs::remove_dir_all(root).unwrap();
    }
}
