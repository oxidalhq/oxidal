//! One DSP owner with confirmed scalar controls. No structural live replacement.
use crate::{PreparedPorts, Processor, protocol::*};
use oxidal_lv2::{ControlError, World};
use oxidal_presets::{Bundle, manifest::NodeKind};
use std::collections::BTreeSet;

#[derive(Debug)]
pub struct Session {
    pub(crate) graph: PreparedPorts,
    pub(crate) bundle: Bundle,
    pub(crate) initial: Vec<Control>,
    state: Snapshot,
    failed: bool,
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
        for node in &host.graph.nodes {
            match graph.processor_mut(&node.id) {
                Some(Processor::Native(p)) => {
                    controls.extend(
                        p.live_controls()
                            .map_err(|e| e.to_string())?
                            .into_iter()
                            .map(|c| Control {
                                target: Target::Native {
                                    node: node.id.clone(),
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
                            }),
                    );
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
            buffer_bytes: graph.buffer_bytes(),
            latency_frames: graph.latency_frames(),
        };
        if serde_json::to_vec(&state).map_err(|e| e.to_string())?.len() + 65536 > REPLY_LIMIT {
            return Err("Rig controls exceed IPC byte budget".into());
        }
        Ok(Self {
            graph,
            bundle,
            initial: controls,
            state,
            failed: false,
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut state = self.state.clone();
        state.modified = state
            .controls
            .iter()
            .zip(&self.initial)
            .any(|(current, initial)| current.value != initial.value);
        state
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
        Ok(())
    }
    pub fn apply(&mut self, command: ControlCommand) -> Result<(), String> {
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
        if self.failed
            || recall.source_revision != self.state.source_revision
            || recall.values.len() != self.state.controls.len()
        {
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
        for value in &recall.values {
            let command = ControlCommand {
                session: self.state.session.clone(),
                expected_revision: self.state.revision,
                target: value.target.clone(),
                value: value.value,
            };
            self.apply(command)?;
        }
        Ok(())
    }
}
