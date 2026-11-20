//! One DSP owner with confirmed controls and guarded whole-native authoring.
use crate::loading::NativeRecovery;
use crate::{PreparedPorts, Processor, ports::PreparationBudget, protocol::*};
use oxidal_lv2::{ControlError, World};
use oxidal_presets::{Bundle, manifest::NodeKind};
use std::collections::BTreeSet;
pub(crate) mod authoring;
mod capture_scenes;
pub(crate) mod models;
mod native_scenes;

pub(crate) const MAX_CAPTURE_DEFAULTS: usize = 512;
const MAX_CAPTURE_DEFAULT_BYTES: usize = 128 * 1024;

#[derive(Debug)]
pub struct Session {
    pub(crate) graph: PreparedPorts,
    pub(crate) bundle: Bundle,
    pub(crate) initial: Vec<Control>,
    pub(crate) initial_eq: Vec<NodeEq>,
    state: Snapshot,
    failed: bool,
    replay_token: u64,
    model_task: oxidal_tone3000::model_preparation::Models,
    model_root: Option<std::path::PathBuf>,
    model_node: Option<String>,
    rate: f64,
    /// Scene control ramps started; read the plugins back once they end.
    scene_readback: bool,
    capture_fade_remaining: usize,
    authoring_histories: std::collections::BTreeMap<String, oxidal_tone3000::working::Authoring>,
}
impl Session {
    pub fn new(
        bundle: Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: usize,
    ) -> Result<Self, String> {
        Self::new_with_working(bundle, world, rate, frames, budget, None)
    }
    pub fn new_with_working(
        bundle: Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: usize,
        working: Option<(&std::path::Path, &[NodeWorking])>,
    ) -> Result<Self, String> {
        let budget = PreparationBudget::standalone(&bundle, budget);
        Self::new_with_budget(
            bundle,
            world,
            rate,
            frames,
            budget,
            NativeRecovery {
                working,
                models: &[],
            },
        )
    }

    pub(crate) fn new_with_budget(
        bundle: Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: PreparationBudget,
        recovery: NativeRecovery<'_>,
    ) -> Result<Self, String> {
        let working = recovery.working;
        let (mut graph, saved_before_working, native_bypass_defaults) =
            PreparedPorts::load_for_session(&bundle, world, rate, frames, budget, recovery)?;
        let host = bundle
            .manifest()
            .oxidal
            .as_ref()
            .ok_or("Missing host graph")?;
        let mut controls = Vec::new();
        let mut eq = Vec::new();
        let mut slots = Vec::new();
        let mut authoring = Vec::new();
        let mut authoring_histories = std::collections::BTreeMap::new();
        for node in &host.graph.nodes {
            match graph.processor_mut(&node.id) {
                Some(Processor::Native(p)) => {
                    eq.push(NodeEq {
                        node: node.id.clone(),
                        blocks: p.eq_snapshot().map_err(|e| e.to_string())?,
                    });
                    slots.push(NodeSlots {
                        node: node.id.clone(),
                        // Extracted roles expose replacement, never insertion.
                        slots: if p.processing_role()
                            == oxidal_tone3000::ProcessingRole::WholePreset
                        {
                            p.slots().map_err(|e| e.to_string())?
                        } else {
                            vec![]
                        },
                    });
                    controls.extend(native_controls(&node.id, p)?);
                    if p.processing_role() == oxidal_tone3000::ProcessingRole::WholePreset {
                        p.set_solo(oxidal_audio::tools::Solo::None)
                            .map_err(|e| e.to_string())?;
                        let receipt = working
                            .and_then(|(_, rows)| rows.iter().find(|r| r.node == node.id))
                            .map(|r| r.receipt.clone());
                        let owner = oxidal_tone3000::working::Authoring::for_source(
                            working
                                .map(|(root, _)| root)
                                .unwrap_or(std::path::Path::new(".")),
                            authoring::origin(bundle.revision(), &node.id),
                            receipt,
                        );
                        authoring.push(NodeAuthoring {
                            node: node.id.clone(),
                            status: owner.snapshot(p)?,
                        });
                        if working.is_some() {
                            authoring_histories.insert(node.id.clone(), owner);
                        }
                    }
                }
                Some(Processor::Lv2(p)) => {
                    for port in p.info().ports.iter().filter(|p| p.input && p.control) {
                        let value = p.value(port.index)?;
                        port.normalize(value)?;
                        controls.push(Control {
                            target: Target::Lv2 {
                                node: node.id.clone(),
                                symbol: port.symbol.clone(),
                            },
                            label: port.symbol.clone(),
                            value: f64::from(value),
                            minimum: f64::from(port.minimum.ok_or("Missing range")?),
                            maximum: f64::from(port.maximum.ok_or("Missing range")?),
                            integer: port.integer,
                            toggle: port.toggled,
                            logarithmic: port.logarithmic,
                            display: port.display(value),
                            scale_points: port.scale_points.clone(),
                        });
                    }
                }
                None => {}
            }
            if matches!(node.kind, NodeKind::Tone3000 | NodeKind::Lv2) {
                controls.push(Control {
                    target: Target::Bypass {
                        node: node.id.clone(),
                    },
                    label: "Bypass".into(),
                    value: if node.bypassed.unwrap_or(false) {
                        1.0
                    } else {
                        0.0
                    },
                    minimum: 0.0,
                    maximum: 1.0,
                    integer: true,
                    toggle: true,
                    logarithmic: false,
                    display: if node.bypassed.unwrap_or(false) {
                        "On"
                    } else {
                        "Off"
                    }
                    .into(),
                    scale_points: Vec::new(),
                });
            }
            if let Some(gains) = &node.input_gains {
                controls.extend(gains.iter().enumerate().map(|(port, g)| Control {
                    target: Target::Merge {
                        node: node.id.clone(),
                        port,
                    },
                    label: format!("Input {}", port + 1),
                    value: f64::from(*g as f32),
                    minimum: -4.0,
                    maximum: 4.0,
                    integer: false,
                    toggle: false,
                    logarithmic: false,
                    display: format!("{g:.3}"),
                    scale_points: Vec::new(),
                }));
            }
        }
        let scenes = bundle.manifest().scenes().map_err(|e| e.to_string())?;
        if let Some(scenes) = &scenes {
            capture_scenes::check_targets(&controls, &scenes.scenes[0].native_controls)?;
        }
        let capture_defaults = capture_scenes::saved_defaults(
            &controls,
            working.map_or(&[], |(_, rows)| rows),
            recovery.models,
            saved_before_working,
        );
        let state = Snapshot {
            modified: false,
            session: format!(
                "rig-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos()
            ),
            revision: 0,
            source_revision: bundle.revision().into(),
            controls: controls.clone(),
            eq: eq.clone(),
            buffer_bytes: graph.buffer_bytes(),
            latency_frames: graph.latency_frames(),
            prepared: Vec::new(),
            models: recovery.models.to_vec(),
            working: working.map(|(_, rows)| rows.to_vec()).unwrap_or_default(),
            authoring,
            slots,
            model_change: None,
            capture_defaults,
            native_bypass_defaults: native_bypass_defaults.filter(|defaults| {
                !defaults.is_empty()
                    && serde_json::to_vec(defaults)
                        .is_ok_and(|bytes| bytes.len() <= MAX_CAPTURE_DEFAULT_BYTES)
            }),
            native_bypass_armed: graph.native_scene5().then(|| {
                scenes.as_ref().expect("prepared native scenes").scenes[0]
                    .native_bypass
                    .iter()
                    .map(|row| row.key())
                    .collect()
            }),
            scenes,
            scene: None,
            scene_transitioning: false,
            branches: Vec::new(),
            midi: Default::default(),
        };
        let mut result = Self {
            graph,
            bundle,
            initial: controls,
            initial_eq: eq,
            state,
            failed: false,
            replay_token: 0,
            model_task: Default::default(),
            model_root: None,
            model_node: None,
            authoring_histories,
            rate,
            scene_readback: false,
            capture_fade_remaining: 0,
        };
        result.apply_initial_scene()?;
        if !result.reply_fits()? {
            return Err("Rig controls exceed IPC byte budget".into());
        }
        Ok(result)
    }
    pub(crate) fn new_from_recall(
        bundle: Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: PreparationBudget,
        model_root: Option<&std::path::Path>,
        recall: Option<&Recall>,
    ) -> Result<Self, String> {
        let rows = recall.map_or(&[][..], |r| r.working.as_slice());
        let working = match model_root {
            Some(root) => Some((root, rows)),
            None if rows.is_empty() => None,
            None => return Err("Native working store unavailable".into()),
        };
        let scene5 = bundle
            .manifest()
            .extensions
            .contains_key(oxidal_presets::manifest::SCENES_INNER_BYPASS_EXTENSION);
        let models = if scene5 {
            recall.map_or(&[][..], |r| r.models.as_slice())
        } else {
            &[]
        };
        if let Some(recall) = recall
            && recall.source_revision != bundle.revision()
        {
            return Err("Recall revision differs".into());
        }
        let mut session = Self::new_with_budget(
            bundle,
            world,
            rate,
            frames,
            budget,
            NativeRecovery { working, models },
        )?;
        if let Some(recall) = recall {
            if recall.models.is_empty() {
                session.restore(recall)?;
            } else if scene5 {
                let mut controls = recall.clone();
                controls.models.clear();
                session.restore(&controls)?;
            } else {
                session.restore_with_models(
                    recall,
                    model_root.ok_or("Model asset store unavailable")?,
                )?;
            }
        }
        Ok(session)
    }

    fn apply_initial_scene(&mut self) -> Result<(), String> {
        let Some(scene) = self
            .state
            .scenes
            .as_ref()
            .and_then(|s| s.initial_scene.clone())
        else {
            return Ok(());
        };
        self.select_scene(SceneCommand {
            session: self.state.session.clone(),
            expected_revision: self.state.revision,
            scene,
            release_ms: None,
        })?;
        for index in 0..self.state.controls.len() {
            let control = &self.state.controls[index];
            if matches!(control.target, Target::Lv2 { .. })
                && self.initial[index].value != control.value
            {
                self.set(index, control.value).map_err(|e| e.to_string())?;
            }
        }
        self.graph.finish_preparation()?;
        self.capture_fade_remaining = 0;
        self.scene_readback = false;
        self.state.revision = 0;
        self.initial.clone_from(&self.state.controls);
        Ok(())
    }
    fn reply_fits(&mut self) -> Result<bool, String> {
        let fits = |session: &Session| {
            serde_json::to_vec(&session.snapshot())
                .map(|bytes| bytes.len() + 65536 <= REPLY_LIMIT)
                .map_err(|e| e.to_string())
        };
        if fits(self)? {
            return Ok(true);
        }
        self.state.native_bypass_defaults = None;
        if fits(self)? {
            return Ok(true);
        }
        self.state.capture_defaults.clear();
        fits(self)
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut state = self.state.clone();
        state.modified = self.is_modified();
        state.scene_transitioning =
            self.graph.scene_transitioning() || self.capture_fade_remaining > 0;
        if let Some(scenes) = &state.scenes {
            let matches = |scene: &&oxidal_presets::manifest::Scene| {
                scene.gains.iter().all(|gain| {
                    state.controls.iter().any(|c| {
                        c.target
                            == (Target::Merge {
                                node: gain.node.clone(),
                                port: usize::from(gain.port),
                            })
                            && c.value == f64::from(gain.value as f32)
                    })
                }) && scene.controls.iter().all(|control| {
                    state.controls.iter().any(|c| {
                        matches!(&c.target, Target::Lv2 { node, symbol }
                            if *node == control.node && *symbol == control.symbol)
                            && c.value == f64::from(control.value as f32)
                    })
                }) && scene.bypass.iter().all(|bypass| {
                    state.controls.iter().any(|c| {
                        matches!(&c.target, Target::Bypass { node } if *node == bypass.node)
                            && c.value == f64::from(u8::from(bypass.value))
                    })
                }) && scene.native_controls.iter().all(|value| {
                    state.controls.iter().any(|c| {
                        capture_scenes::matches_control(c, value)
                            && c.value == f64::from(value.value as f32)
                    })
                }) && scene.native_bypass.iter().all(|target| {
                    let key = native_scenes::enabled_target(&target.node, &target.block);
                    state
                        .controls
                        .iter()
                        .any(|row| row.target == key && (row.value == 0.0) == target.value)
                })
            };
            let selected = scenes
                .scenes
                .iter()
                .find(|s| Some(&s.id) == state.scene.as_ref())
                .filter(matches)
                .or_else(|| scenes.scenes.iter().find(matches));
            state.scene = selected.map(|s| s.id.clone());
            state.branches = scenes
                .branches
                .iter()
                .map(|branch| {
                    let values: Vec<_> = branch
                        .gains
                        .iter()
                        .map(|gain| {
                            state
                                .controls
                                .iter()
                                .find(|c| {
                                    c.target
                                        == (Target::Merge {
                                            node: gain.node.clone(),
                                            port: usize::from(gain.port),
                                        })
                                })
                                .unwrap()
                                .value
                        })
                        .collect();
                    let enabled = values.iter().any(|v| *v != 0.0);
                    let full = values
                        .iter()
                        .zip(&branch.gains)
                        .all(|(value, gain)| *value == f64::from(gain.value as f32));
                    BranchState {
                        id: branch.id.clone(),
                        name: branch.name.clone(),
                        enabled,
                        partial: enabled && !full,
                    }
                })
                .collect();
        }
        state
    }
    pub(crate) fn is_modified(&self) -> bool {
        self.state
            .controls
            .iter()
            .zip(&self.initial)
            .any(|(current, initial)| current.value != initial.value)
            || self.state.eq != self.initial_eq
            || !self.state.models.is_empty()
            || !self.state.working.is_empty()
    }
    pub(crate) fn source_revision(&self) -> &str {
        &self.state.source_revision
    }
    pub(crate) fn matches_cursor(&self, session: &str, revision: u64) -> bool {
        self.state.session == session && self.state.revision == revision
    }
    pub(crate) fn buffer_bytes(&self) -> usize {
        self.state.buffer_bytes
    }
    pub(crate) fn latency_frames(&self) -> u32 {
        self.state.latency_frames
    }
    pub fn healthy(&self) -> bool {
        !self.failed
    }
    pub fn channels(&self) -> (usize, usize) {
        self.graph.channels()
    }
    pub fn process(&mut self, input: &[&[f32]], output: &mut [&mut [f32]]) -> Result<(), String> {
        if self.failed {
            for port in output {
                port.fill(0.0);
            }
            return Err("Failed rig session".into());
        }
        let result = self.graph.process(input, output);
        if result.is_err() {
            self.failed = true;
        } else {
            self.capture_fade_remaining = self
                .capture_fade_remaining
                .saturating_sub(self.graph.frames());
        }
        result
    }
    /// JUCE dispatch handle for the owner to pump outside the rig lock.
    pub(crate) fn dispatcher(&mut self) -> Option<oxidal_tone3000::PumpPort> {
        if self.failed {
            return None;
        }
        for node in &self.bundle.manifest().oxidal.as_ref()?.graph.nodes {
            if let Some(Processor::Native(p)) = self.graph.processor_mut(&node.id) {
                return Some(crate::render::pump_port(p));
            }
        }
        None
    }
    /// Owner upkeep without JUCE dispatch: latency verification and model steps.
    pub(crate) fn tick(&mut self) -> Result<(), String> {
        if self.failed {
            return Err("Failed rig session".into());
        }
        if let Err(error) = self
            .graph
            .verify_latency()
            .and_then(|()| self.graph.verify_warm_scene_health())
        {
            self.failed = true;
            return Err(error);
        }
        self.settle_scene_controls()?;
        self.advance_model()
    }
    pub fn pump(&mut self) -> Result<(), String> {
        if self.failed {
            return Err("Failed rig session".into());
        }
        for node in &self.bundle.manifest().oxidal.as_ref().unwrap().graph.nodes {
            if let Some(Processor::Native(p)) = self.graph.processor_mut(&node.id) {
                if let Err(e) = p.pump() {
                    self.failed = true;
                    return Err(e.to_string());
                }
                // JUCE's message loop is process-wide; one dispatch per owner tick.
                break;
            }
        }
        if crate::render::render_thread_enabled()
            && let Err(error) = self.graph.verify_latency()
        {
            self.failed = true;
            return Err(error);
        }
        if let Err(error) = self.graph.verify_warm_scene_health() {
            self.failed = true;
            return Err(error);
        }
        self.settle_scene_controls()?;
        self.advance_model()
    }
    pub fn apply(&mut self, command: ControlCommand) -> Result<(), String> {
        if self.measurement_pending() || self.gesture_pending() {
            return Err("Cancel measurement before editing".into());
        }
        if self.model_pending() {
            return Err("Finish model preparation before adjusting controls".into());
        }
        if self.failed {
            return Err("Failed rig session".into());
        }
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("rig_control_conflict; refresh status".into());
        }
        let index = self
            .state
            .controls
            .iter()
            .position(|c| c.target == command.target)
            .ok_or("Unknown rig control")?;
        if !self.state.controls[index].accepts(command.value) {
            return Err("Invalid rig control value".into());
        }
        let revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        if let Some((node, block)) = self.armed_edit(&command.target) {
            let (node, block) = (node.to_owned(), block.to_owned());
            self.set_native_bypass(index, &node, &block, command.value as f32)?;
            self.state.revision = revision;
            return Ok(());
        }
        let result = self.set(index, command.value);
        // Native errors after admission may have changed DSP; never retain a
        // supposedly confirmed state or continue playback after an ambiguous result.
        if let Err(reason) = result {
            if !matches!(
                reason,
                ControlError::LatencyRestored | ControlError::ReadbackRestored
            ) {
                self.failed = true;
            }
            return Err(reason.to_string());
        }
        self.state.revision = revision;
        Ok(())
    }
    pub fn restore_plugin_defaults(
        &mut self,
        command: oxidal_lv2::protocol::PluginDefaultsCommand,
    ) -> Result<(), String> {
        if !self.matches_cursor(&command.session, command.expected_revision) {
            return Err("rig_control_conflict; refresh status".into());
        }
        if self.failed
            || self.model_pending()
            || self.gesture_pending()
            || self.measurement_pending()
            || self.graph.scene_transitioning()
            || self.capture_fade_remaining > 0
        {
            return Err("Finish the current rig transition or edit first".into());
        }
        let revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        let Some(Processor::Lv2(plugin)) = self.graph.processor_mut(&command.node) else {
            return Err("Defaults require a running LV2 node".into());
        };
        let defaults = plugin.factory_defaults()?;
        let confirmed = defaults
            .values()
            .iter()
            .map(|&(index, value)| {
                let port = &plugin.info().ports[index as usize];
                let target = Target::Lv2 {
                    node: command.node.clone(),
                    symbol: port.symbol.clone(),
                };
                let control = self
                    .state
                    .controls
                    .iter()
                    .position(|c| c.target == target && c.accepts(f64::from(value)))
                    .ok_or("Missing or invalid rig control binding")?;
                Ok((control, f64::from(value), port.display(value)))
            })
            .collect::<Result<Vec<_>, String>>()?;
        if let Err(error) = plugin.write_defaults(&defaults) {
            self.failed = !plugin.healthy();
            return Err(error.to_string());
        }
        for (index, value, display) in confirmed {
            self.state.controls[index].value = value;
            self.state.controls[index].display = display;
        }
        self.state.revision = revision;
        Ok(())
    }
    /// Select a validated scene on the already running graph. All targets are
    /// admitted before the first gain, control or bypass ramp starts.
    pub fn select_scene(&mut self, command: SceneCommand) -> Result<(), String> {
        if self.failed || self.model_pending() {
            return Err("Rig is not ready for scene selection".into());
        }
        if !self.matches_cursor(&command.session, command.expected_revision) {
            return Err("rig_control_conflict; refresh status".into());
        }
        if command
            .release_ms
            .is_some_and(|ms| ms > crate::protocol::MAX_RELEASE_MS)
        {
            return Err("Scene blend must be at most 10 seconds".into());
        }
        let scenes = self.state.scenes.as_ref().ok_or("Rig has no scenes")?;
        let scene = scenes
            .scenes
            .iter()
            .find(|s| s.id == command.scene)
            .ok_or("Unknown rig scene")?;
        let gains = scene.gains.clone();
        let controls = scene.controls.clone();
        let capture_controls = scene.native_controls.clone();
        let native_bypass = scene.native_bypass.clone();
        if (!capture_controls.is_empty() || !native_bypass.is_empty())
            && (self.gesture_pending() || self.measurement_pending())
        {
            return Err(
                "Finish the active native adjustment before selecting a capture scene".into(),
            );
        }
        let bypass = scene.bypass.clone();
        let fade_ms = scenes.fade_ms;
        // A blend keeps the outgoing scene sounding while it fades out.
        let release_ms = command.release_ms.unwrap_or(fade_ms).max(fade_ms);
        // Every control target is checked before the first gain moves, so a
        // refused scene leaves the mix and every plugin as they were.
        self.graph.check_scene_controls(&controls)?;
        self.graph.check_scene_bypass(&bypass)?;
        self.check_capture_scene(&capture_controls)?;
        let scene5 = self.graph.native_scene5();
        if scene5 {
            self.state
                .revision
                .checked_add(1)
                .ok_or("Rig revision exhausted")?;
            self.graph.check_scene_gains(
                &gains,
                self.fade_frames(fade_ms),
                self.fade_frames(release_ms),
            )?;
            self.apply_native_scene(&native_bypass, &capture_controls)?;
        }
        let applied = self
            .apply_mix(&gains, fade_ms, release_ms)
            .and_then(|()| self.apply_scene_controls(&controls, fade_ms));
        if let Err(error) = applied {
            self.failed |= scene5;
            return Err(error);
        }
        if !scene5 && let Err(error) = self.apply_capture_scene(&capture_controls) {
            self.failed = true;
            return Err(error);
        }
        self.graph.scene_bypass(&bypass, self.fade_frames(fade_ms));
        for bypass in bypass {
            let control = self
                .state
                .controls
                .iter_mut()
                .find(|c| matches!(&c.target, Target::Bypass { node } if *node == bypass.node))
                .unwrap();
            control.value = f64::from(u8::from(bypass.value));
            control.display = if bypass.value { "On" } else { "Off" }.into();
        }
        self.state.scene = Some(command.scene);
        Ok(())
    }
    /// Branch controls change only their declared selector inputs. Other ready
    /// branches and shared downstream processors retain their current state.
    pub fn set_branch(&mut self, command: BranchCommand) -> Result<(), String> {
        if self.failed || self.model_pending() {
            return Err("Rig is not ready for branch control".into());
        }
        if !self.matches_cursor(&command.session, command.expected_revision) {
            return Err("rig_control_conflict; refresh status".into());
        }
        let scenes = self.state.scenes.as_ref().ok_or("Rig has no branches")?;
        let branch = scenes
            .branches
            .iter()
            .find(|b| b.id == command.branch)
            .ok_or("Unknown rig branch")?;
        let gains: Vec<_> = branch
            .gains
            .iter()
            .cloned()
            .map(|mut gain| {
                if !command.enabled {
                    gain.value = 0.0;
                }
                gain
            })
            .collect();
        let fade_ms = scenes.fade_ms;
        self.apply_mix(&gains, fade_ms, fade_ms)?;
        self.state.scene = None;
        Ok(())
    }
    /// Shared hardware/test dispatch: MIDI never owns a second copy of mix state.
    /// True means a mapped trigger was accepted, including an unchanged target.
    pub fn midi_message(
        &mut self,
        settings: &oxidal_audio::midi::Settings,
        message: oxidal_audio::midi::Message,
    ) -> Result<bool, String> {
        if let Some(scene) = settings.scene(message) {
            let cursor = self.snapshot();
            if cursor.scene.as_deref() != Some(scene) {
                self.select_scene(SceneCommand {
                    session: cursor.session,
                    expected_revision: cursor.revision,
                    scene: scene.into(),
                    release_ms: None,
                })?;
            }
            return Ok(true);
        }
        if let Some((binding, target)) = settings.branch(message) {
            let cursor = self.snapshot();
            let branch = cursor
                .branches
                .iter()
                .find(|b| b.id == binding.branch)
                .ok_or("MIDI branch is unavailable")?;
            let enabled = target.unwrap_or(!branch.enabled);
            if enabled != branch.enabled || branch.partial {
                self.set_branch(BranchCommand {
                    session: cursor.session,
                    expected_revision: cursor.revision,
                    branch: binding.branch.clone(),
                    enabled,
                })?;
            }
            return Ok(true);
        }
        if let Some((binding, raw)) = settings.parameter(message) {
            let control = self
                .state
                .controls
                .iter()
                .find(|c| c.target == binding.target)
                .ok_or("MIDI parameter is unavailable")?;
            let Some(value) = control.midi_value(binding.mode, raw)? else {
                return Ok(true);
            };
            if (value as f32) != (control.value as f32) {
                let command = ControlCommand {
                    session: self.state.session.clone(),
                    expected_revision: self.state.revision,
                    target: binding.target.clone(),
                    value,
                };
                self.apply(command)?;
            }
            return Ok(true);
        }
        Ok(false)
    }
    fn fade_frames(&self, ms: u32) -> u32 {
        (self.rate * f64::from(ms) / 1000.0).round().max(1.0) as u32
    }
    fn apply_mix(
        &mut self,
        gains: &[oxidal_presets::manifest::SceneGain],
        fade_ms: u32,
        release_ms: u32,
    ) -> Result<(), String> {
        let revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        self.graph.scene_gains(
            gains,
            self.fade_frames(fade_ms),
            self.fade_frames(release_ms),
        )?;
        for gain in gains {
            let target = Target::Merge {
                node: gain.node.clone(),
                port: usize::from(gain.port),
            };
            let control = self
                .state
                .controls
                .iter_mut()
                .find(|c| c.target == target)
                .unwrap();
            control.value = f64::from(gain.value as f32);
            control.display = format!("{:.3}", control.value);
        }
        self.state.revision = revision;
        Ok(())
    }
    /// Starts the host ramps of a scene's plugin controls (over the preset's
    /// fade) and publishes each target at once, as the scene's gains are.
    fn apply_scene_controls(
        &mut self,
        controls: &[oxidal_presets::manifest::SceneControl],
        fade_ms: u32,
    ) -> Result<(), String> {
        if controls.is_empty() {
            return Ok(());
        }
        let frames = self.fade_frames(fade_ms);
        if let Err(error) = self.graph.scene_controls(controls, frames) {
            // Targets were admitted; a refusal now means the DSP state is unknown.
            self.failed = true;
            return Err(error);
        }
        for control in controls {
            let value = control.value as f32;
            let display = match self.graph.processor_mut(&control.node) {
                Some(Processor::Lv2(p)) => p
                    .info()
                    .ports
                    .iter()
                    .find(|p| p.symbol == control.symbol)
                    .map(|p| p.display(value)),
                _ => None,
            }
            .ok_or("Missing LV2 port")?;
            let c = self
                .state
                .controls
                .iter_mut()
                .find(|c| {
                    matches!(&c.target, Target::Lv2 { node, symbol }
                        if *node == control.node && *symbol == control.symbol)
                })
                .ok_or("Missing scene control")?;
            c.value = f64::from(value);
            c.display = display;
        }
        self.scene_readback = true;
        Ok(())
    }
    /// After the ramps end, publish what the plugins actually hold.
    fn settle_scene_controls(&mut self) -> Result<(), String> {
        if !self.scene_readback || self.graph.scene_transitioning() {
            return Ok(());
        }
        self.scene_readback = false;
        let Some(scenes) = self.state.scenes.as_ref() else {
            return Ok(());
        };
        let targets: Vec<_> = scenes.scenes[0]
            .controls
            .iter()
            .map(|c| (c.node.clone(), c.symbol.clone()))
            .collect();
        for (node, symbol) in targets {
            let Some(Processor::Lv2(p)) = self.graph.processor_mut(&node) else {
                return Err("Missing LV2 processor".into());
            };
            let port = p
                .info()
                .ports
                .iter()
                .find(|p| p.symbol == symbol)
                .ok_or("Missing LV2 port")?;
            let actual = p.value(port.index)?;
            let display = port.display(actual);
            if let Some(c) = self.state.controls.iter_mut().find(|c| {
                matches!(&c.target, Target::Lv2 { node: n, symbol: s } if *n == node && *s == symbol)
            }) {
                c.value = f64::from(actual);
                c.display = display;
            }
        }
        Ok(())
    }
    pub fn apply_eq(&mut self, command: EqCommand) -> Result<(), String> {
        if self.measurement_pending() || self.gesture_pending() {
            return Err("Cancel measurement before editing EQ".into());
        }
        if self.model_pending() {
            return Err("Finish model preparation before adjusting EQ".into());
        }
        if self.failed
            || command.session != self.state.session
            || command.expected_revision != self.state.revision
        {
            return Err("Stale or failed rig session".into());
        }
        let index = self
            .state
            .eq
            .iter()
            .position(|e| e.node == command.node)
            .ok_or("EQ requires a whole-native node")?;
        let mut expected = self.state.eq[index].blocks.clone();
        let block = expected
            .iter_mut()
            .find(|b| b.block_id == command.block_id)
            .ok_or("Unknown EQ block")?;
        command.edit.apply(&mut block.eq)?;
        if expected == self.state.eq[index].blocks {
            return Ok(());
        }
        let revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        let result = (|| {
            let Some(Processor::Native(p)) = self.graph.processor_mut(&command.node) else {
                return Err("Missing EQ processor".to_owned());
            };
            p.set_eq(&command.block_id, &command.edit)
                .map_err(|e| e.to_string())?;
            let actual = p.eq_snapshot().map_err(|e| e.to_string())?;
            if actual != expected {
                return Err("EQ readback differs".into());
            }
            Ok(actual)
        })();
        match result {
            Ok(blocks) => {
                self.state.eq[index].blocks = blocks;
                self.state.revision = revision;
                Ok(())
            }
            Err(error) => {
                self.failed = true;
                Err(error)
            }
        }
    }
    fn set(&mut self, index: usize, value: f64) -> Result<(), ControlError> {
        let target = self.state.controls[index].target.clone();
        if let Target::Native { node, parameter } = &target {
            let Some(Processor::Native(p)) = self.graph.processor_mut(node) else {
                return Err("Missing native processor".into());
            };
            p.set_live_control(parameter, value as f32)
                .map_err(|e| e.to_string())?;
            let read = p.live_controls().map_err(|e| e.to_string())?;
            let mut count = 0;
            for c in &mut self.state.controls {
                if let Target::Native {
                    node: n,
                    parameter: par,
                } = &c.target
                    && n == node
                {
                    let actual = read
                        .iter()
                        .find(|r| &r.target == par)
                        .ok_or("Native control disappeared")?;
                    c.value = f64::from(actual.value);
                    c.display = actual.display.clone();
                    if !c.accepts(c.value) {
                        return Err("Invalid backend readback".into());
                    }
                    count += 1;
                }
            }
            if count != read.len() {
                return Err("Native catalog changed during scalar edit".into());
            }
            return Ok(());
        }
        let bypass_frames = self
            .state
            .scenes
            .as_ref()
            .map_or(0, |s| self.fade_frames(s.fade_ms));
        let c = &mut self.state.controls[index];
        match &c.target {
            Target::Native { .. } => unreachable!("handled above"),
            Target::Lv2 { node, symbol } => {
                // The edit wins over a scene ramp still running on this control.
                self.graph.cancel_control_ramp(node, symbol);
                let Some(Processor::Lv2(p)) = self.graph.processor_mut(node) else {
                    return Err("Missing LV2 processor".into());
                };
                let port = p
                    .info()
                    .ports
                    .iter()
                    .find(|p| &p.symbol == symbol)
                    .ok_or("Missing LV2 port")?
                    .index;
                let actual = p.set_control(port, value as f32)?;
                c.value = f64::from(actual);
                c.display = p.info().ports[port as usize].display(actual);
            }
            Target::Bypass { .. } | Target::Merge { .. } => {
                self.graph.host_value(&c.target, value, bypass_frames)?;
                c.value = f64::from(value as f32);
                c.display = if c.toggle {
                    if c.value == 1.0 {
                        "On".into()
                    } else {
                        "Off".into()
                    }
                } else {
                    format!("{:.3}", c.value)
                };
            }
        }
        if !c.accepts(c.value) {
            return Err("Invalid backend readback".into());
        }
        Ok(())
    }
    /// Startup/export only. Prevalidate the entire catalog before mutation.
    pub fn restore(&mut self, recall: &Recall) -> Result<(), String> {
        if recall.working.len() != self.state.working.len()
            || recall
                .working
                .iter()
                .any(|r| !self.state.working.contains(r))
        {
            return Err("Working state requires fresh verified graph preparation".into());
        }
        if !recall.models.is_empty() {
            return Err("Model recall requires the verified asset store".into());
        }

        if self.failed || recall.source_revision != self.state.source_revision {
            return Err("Recall revision or catalog differs".into());
        }
        let mut seen = BTreeSet::new();
        for value in &recall.values {
            if !seen.insert(&value.target)
                || !self
                    .state
                    .controls
                    .iter()
                    .any(|c| c.target == value.target && c.accepts(value.value))
            {
                return Err("Invalid recall control".into());
            }
        }
        // Additive deck migration: each native node must have either the full
        // current catalog or exactly the eight newly exposed image controls absent.
        let mut missing = std::collections::BTreeMap::<&str, Vec<&str>>::new();
        for control in &self.state.controls {
            if !seen.contains(&control.target) {
                let Target::Native { node, parameter } = &control.target else {
                    return Err("Recall catalog differs".into());
                };
                missing.entry(node).or_default().push(parameter);
            }
        }
        if missing
            .values()
            .any(|ids| !oxidal_tone3000::protocol::legacy_image_gap(ids))
        {
            return Err("Recall catalog differs".into());
        }
        let mut eq = recall.eq.clone();
        if let Some(rows) = &mut eq {
            let whole: Vec<_> = self
                .state
                .eq
                .iter()
                .filter(|row| {
                    self.bundle
                        .manifest()
                        .oxidal
                        .as_ref()
                        .unwrap()
                        .graph
                        .nodes
                        .iter()
                        .find(|node| node.id == row.node)
                        .and_then(|node| node.instance.as_ref())
                        .and_then(|id| {
                            self.bundle
                                .manifest()
                                .tone3000
                                .instances
                                .iter()
                                .find(|i| &i.id == id)
                        })
                        .is_some_and(|i| i.partition.is_none())
                })
                .collect();
            // Only the exact previous whole-node catalog may omit all stage EQ.
            if rows.len() != self.state.eq.len()
                && rows.len() == whole.len()
                && rows.iter().zip(&whole).all(|(a, b)| a.node == b.node)
            {
                *rows = self
                    .state
                    .eq
                    .iter()
                    .map(|current| {
                        rows.iter()
                            .find(|r| r.node == current.node)
                            .unwrap_or(current)
                            .clone()
                    })
                    .collect();
            }
            if rows.len() != self.state.eq.len()
                || rows.iter().zip(&self.state.eq).any(|(a, b)| {
                    a.node != b.node
                        || !oxidal_audio::eq::valid_snapshot(&a.blocks)
                        || a.blocks.len() != b.blocks.len()
                        || a.blocks
                            .iter()
                            .zip(&b.blocks)
                            .any(|(a, b)| a.block_id != b.block_id)
                })
            {
                return Err("Recall EQ catalog differs".into());
            }
        }
        for value in &recall.values {
            let command = ControlCommand {
                session: self.state.session.clone(),
                expected_revision: self.state.revision,
                target: value.target.clone(),
                value: value.value,
            };
            self.apply(command)?;
        }
        if let Some(eq) = &eq {
            for row in eq {
                let Some(Processor::Native(p)) = self.graph.processor_mut(&row.node) else {
                    return Err("Missing EQ processor".into());
                };
                if p.eq_snapshot().map_err(|e| e.to_string())? == row.blocks {
                    continue;
                }
                if let Err(error) = p.restore_eq(&row.blocks, &mut self.replay_token) {
                    self.failed = true;
                    return Err(error.to_string());
                }
            }
            self.state.eq = eq.clone();
        }
        self.graph.finish_preparation()
    }
}

fn native_controls(
    node: &str,
    engine: &mut oxidal_tone3000::Engine,
) -> Result<Vec<Control>, String> {
    Ok(engine
        .live_controls()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| Control {
            target: Target::Native {
                node: node.into(),
                parameter: c.target,
            },
            label: c.label,
            value: f64::from(c.value),
            minimum: 0.0,
            maximum: 1.0,
            integer: c.toggle,
            toggle: c.toggle,
            logarithmic: false,
            display: c.display,
            scale_points: Vec::new(),
        })
        .collect())
}
#[cfg(all(test, feature = "qualification"))]
mod scene_control_tests {
    use super::*;
    use oxidal_presets::manifest::SCENES_BYPASS_EXTENSION;
    use serde_json::json;

    /// Two paths into a merge, then an effect whose gain both scenes set,
    /// with the scenes stored under `key`.
    fn scene_rig(key: &str) -> serde_json::Value {
        let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
        let scene = |id: &str, a: f64, b: f64, gain: f64| {
            json!({"id":id,"name":id,
                "gains":[{"node":"merge","port":0,"value":a},{"node":"merge","port":1,"value":b}],
                "controls":[{"node":"fx","symbol":"gain","value":gain}]})
        };
        json!({"format":"oxidal.preset","formatVersion":1,
            "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a12","name":"Refused scene",
            "tone3000":{"instances":[]},"resources":[],
            "requiredExtensions":[key],
            "extensions":{key:{"fade_ms":10,
                "scenes":[scene("a",1.0,0.0,0.5),scene("b",0.0,1.0,1.5)]}},
            "oxidal":{"graph":{"nodes":[
                {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
                {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
                {"id":"merge","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1.0,0.0]},
                {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":false},
                {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
                "edges":[edge("in",0,"split",0),edge("split",0,"merge",0),edge("split",1,"merge",1),
                    edge("merge",0,"fx",0),edge("in",1,"fx",1),edge("fx",0,"out",0),edge("fx",1,"out",1)]},
            "lv2":[{"id":"fx","pluginUri":"urn:oxidal:test:contract","controls":{"gain":0.5,"feedback":0},
                "assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}})
    }
    fn prepare(key: &str) -> Result<Session, String> {
        let mut value = scene_rig(key);
        if key == SCENES_BYPASS_EXTENSION {
            for (i, bypassed) in [false, true].into_iter().enumerate() {
                value["extensions"][key]["scenes"][i]["bypass"] =
                    json!([{"node":"fx","value":bypassed}]);
            }
        }
        let bundle = Bundle::from_parts(serde_json::to_vec(&value).unwrap(), Default::default())
            .map_err(|e| e.to_string())?;
        let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
        Session::new(bundle, &world, 48000.0, 64, 1 << 20)
    }
    #[test]
    fn scenes_with_controls_prepare_from_known_versions_and_refuse_an_unknown_one() {
        use oxidal_presets::manifest::{
            SCENES_CONTROLS_EXTENSION, SCENES_EXTENSION, UNSUPPORTED_SCENES,
        };
        // Version 1 with controls: presets saved before version 2 still play.
        for key in [
            SCENES_EXTENSION,
            SCENES_CONTROLS_EXTENSION,
            SCENES_BYPASS_EXTENSION,
        ] {
            let mut session = prepare(key).unwrap();
            let before = session.snapshot();
            session
                .select_scene(SceneCommand {
                    session: before.session.clone(),
                    expected_revision: before.revision,
                    scene: "b".into(),
                    release_ms: None,
                })
                .unwrap();
            assert_eq!(session.snapshot().scene.as_deref(), Some("b"), "{key}");
        }
        match prepare("urn:oxidal:scenes:5") {
            Err(error) => assert_eq!(error, UNSUPPORTED_SCENES),
            Ok(_) => panic!("an unknown scenes version prepared"),
        }
    }
    #[test]
    fn a_refused_scene_bypass_leaves_mix_controls_and_revision_unchanged() {
        let mut session = prepare(SCENES_BYPASS_EXTENSION).unwrap();
        let before = session.snapshot();
        session.state.scenes.as_mut().unwrap().scenes[1].bypass[0].node = "gone".into();
        let error = session
            .select_scene(SceneCommand {
                session: before.session.clone(),
                expected_revision: before.revision,
                scene: "b".into(),
                release_ms: None,
            })
            .unwrap_err();
        assert_eq!(error, "Invalid scene bypass target");
        let after = session.snapshot();
        assert_eq!(after.scene.as_deref(), Some("a"));
        assert_eq!(after.revision, before.revision);
        assert!(!after.scene_transitioning);
        assert_eq!(
            serde_json::to_value(after.controls).unwrap(),
            serde_json::to_value(before.controls).unwrap()
        );
    }
    #[test]
    fn a_refused_scene_control_leaves_the_mix_plugins_and_scene_unchanged() {
        let mut session = prepare("urn:oxidal:scenes:1").unwrap();
        let before = session.snapshot();
        assert_eq!(before.scene.as_deref(), Some("a"));
        // A target the prepared rig never admitted (out of range, unknown
        // port, or a second copy) is refused before the first gain moves.
        for change in [
            json!([{"node":"fx","symbol":"gain","value":9.0}]),
            json!([{"node":"fx","symbol":"feedback","value":0.1}]),
            json!([{"node":"fx","symbol":"gain","value":1.0},{"node":"fx","symbol":"gain","value":1.0}]),
        ] {
            session.state.scenes.as_mut().unwrap().scenes[1].controls =
                serde_json::from_value(change).unwrap();
            assert!(
                session
                    .select_scene(SceneCommand {
                        session: before.session.clone(),
                        expected_revision: before.revision,
                        scene: "b".into(),
                        release_ms: None,
                    })
                    .is_err()
            );
            let after = session.snapshot();
            assert!(session.healthy());
            assert_eq!(after.revision, before.revision);
            assert_eq!(after.scene.as_deref(), Some("a"));
            assert!(!after.scene_transitioning);
            assert_eq!(
                serde_json::to_value(&after.controls).unwrap(),
                serde_json::to_value(&before.controls).unwrap()
            );
            let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
            session
                .process(&[&[1.0; 64], &[0.0; 64]], &mut [&mut l, &mut r])
                .unwrap();
            assert!(l.iter().all(|v| *v == 0.5), "plugin and mix untouched");
        }
    }
}
