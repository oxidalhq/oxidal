//! One DSP owner with confirmed scalar controls. No structural live replacement.
use crate::{PreparedPorts, Processor, protocol::*};
use oxidal_lv2::{ControlError, World};
use oxidal_presets::{Bundle, manifest::NodeKind};
use std::collections::BTreeSet;
mod models;

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
}
impl Session {
    pub fn new(
        bundle: Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: usize,
    ) -> Result<Self, String> {
        let mut graph = PreparedPorts::from_bundle(&bundle, world, rate, frames, budget)?;
        let host = bundle
            .manifest()
            .oxidal
            .as_ref()
            .ok_or("Missing host graph")?;
        let mut controls = Vec::new();
        let mut eq = Vec::new();
        let mut slots = Vec::new();
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
                            display: format!("{value:.3}"),
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
                    minimum: 0.0,
                    maximum: 4.0,
                    integer: false,
                    toggle: false,
                    logarithmic: false,
                    display: format!("{g:.3}"),
                }));
            }
        }
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
            models: Vec::new(),
            slots,
            model_change: None,
            scenes: bundle.manifest().scenes().map_err(|e| e.to_string())?,
            scene: None,
            scene_transitioning: false,
            branches: Vec::new(),
            midi: Default::default(),
        };
        let result = Self {
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
            rate,
        };
        if serde_json::to_vec(&result.snapshot())
            .map_err(|e| e.to_string())?
            .len()
            + 65536
            > REPLY_LIMIT
        {
            return Err("Rig controls exceed IPC byte budget".into());
        }
        Ok(result)
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut state = self.state.clone();
        state.modified = self.is_modified();
        state.scene_transitioning = self.graph.scene_transitioning();
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
        }
        result
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
        self.advance_model()
    }
    pub fn apply(&mut self, command: ControlCommand) -> Result<(), String> {
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
        let result = self.set(index, command.value);
        // Native errors after admission may have changed DSP; never retain a
        // supposedly confirmed state or continue playback after an ambiguous result.
        if let Err(reason) = result {
            if !matches!(reason, ControlError::LatencyRestored) {
                self.failed = true;
            }
            return Err(reason.to_string());
        }
        self.state.revision = revision;
        Ok(())
    }
    /// Select only a validated mix of already running branches. All merge
    /// targets are admitted before the first gain changes; shared FX keep state.
    pub fn select_scene(&mut self, command: SceneCommand) -> Result<(), String> {
        if self.failed || self.model_pending() {
            return Err("Rig is not ready for scene selection".into());
        }
        if !self.matches_cursor(&command.session, command.expected_revision) {
            return Err("rig_control_conflict; refresh status".into());
        }
        let scenes = self.state.scenes.as_ref().ok_or("Rig has no scenes")?;
        let scene = scenes
            .scenes
            .iter()
            .find(|s| s.id == command.scene)
            .ok_or("Unknown rig scene")?;
        let gains = scene.gains.clone();
        let fade_ms = scenes.fade_ms;
        self.apply_mix(&gains, fade_ms)?;
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
        self.apply_mix(&gains, fade_ms)?;
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
        Ok(false)
    }
    fn apply_mix(
        &mut self,
        gains: &[oxidal_presets::manifest::SceneGain],
        fade_ms: u32,
    ) -> Result<(), String> {
        let revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        let frames = (self.rate * f64::from(fade_ms) / 1000.0).round().max(1.0) as u32;
        self.graph.scene_gains(gains, frames)?;
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
    pub fn apply_eq(&mut self, command: EqCommand) -> Result<(), String> {
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
        let c = &mut self.state.controls[index];
        match &c.target {
            Target::Native { .. } => unreachable!("handled above"),
            Target::Lv2 { node, symbol } => {
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
                c.value = f64::from(p.set_control(port, value as f32)?);
                c.display = format!("{:.3}", c.value);
            }
            Target::Bypass { .. } | Target::Merge { .. } => {
                self.graph.host_value(&c.target, value)?;
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
        })
        .collect())
}
