//! Prepared, single-owner DSP graph. Preparation and commands are non-real-time operations.
use crate::{Binding, Plugin, Port, World};
use oxidal_control::{Command, Control, Parameter, Snapshot};
use oxidal_graph::{BlockKind, PreparedRouting, Rig};
use std::collections::BTreeMap;
use std::time::Instant;

#[derive(Debug)]
struct Processor {
    plugin: Option<Plugin>,
    left: Vec<f32>,
    right: Vec<f32>,
}
#[derive(Debug)]
struct ControlPort {
    target: String,
    node: usize,
    port: Port,
}
/// A fixed-size stereo DAG with normalized controls and native port readback.
/// Call commands/expiry between blocks on the same owner. They allocate; process does not
/// allocate on the successful host path. This is not yet the daemon's playback worker.
#[derive(Debug)]
pub struct PreparedGraph {
    control: Control,
    nodes: Vec<Processor>,
    ports: Vec<ControlPort>,
    schedule: PreparedRouting,
    input: usize,
    output: usize,
    frames: usize,
    bypassed: bool,
    failed: bool,
}
impl PreparedGraph {
    pub fn new(
        world: &World,
        rig: Rig,
        bindings: &[Binding],
        rate: f64,
        frames: usize,
    ) -> Result<Self, String> {
        if frames == 0 || frames > 2048 || !rate.is_finite() || !(8000.0..=192000.0).contains(&rate)
        {
            return Err("Invalid processing configuration".into());
        }
        let schedule = PreparedRouting::new(&rig)?;
        if bindings.len() != rig.nodes.len() - 2 {
            return Err("Every LV2 node requires exactly one binding".into());
        }
        let mut by_node = BTreeMap::new();
        for b in bindings {
            if b.uri.is_empty()
                || b.uri.len() > 4096
                || by_node.insert(b.node.as_str(), b.uri.as_str()).is_some()
            {
                return Err("Invalid or duplicate plugin binding".into());
            }
        }
        let mut nodes = Vec::new();
        let mut ports = Vec::new();
        let mut parameters = Vec::new();
        for (index, node) in rig.nodes.iter().enumerate() {
            // Node level is legacy UI data, never an implicit second gain stage.
            if node.level != 1.0 {
                return Err(
                    "Prepared node level must be unity; use explicit plugin controls".into(),
                );
            }
            let plugin = match node.kind {
                BlockKind::Input | BlockKind::Output => None,
                BlockKind::Lv2 => {
                    let uri = by_node
                        .remove(node.id.as_str())
                        .ok_or("Missing plugin binding")?;
                    let p = Plugin::new(world, uri, rate, frames)?;
                    for port in p.info().ports.iter().filter(|p| p.control && p.input) {
                        let target = format!("{}.{}", node.id, port.symbol);
                        let value = f64::from(port.normalize(p.value(port.index)?)?);
                        parameters.push(Parameter {
                            id: target.clone(),
                            label: port.symbol.clone(),
                            unit: "normalized".into(),
                            min: 0.0,
                            max: 1.0,
                            default: value,
                            step: 0.01,
                            value,
                            writable: true,
                        });
                        ports.push(ControlPort {
                            target,
                            node: index,
                            port: port.clone(),
                        });
                    }
                    Some(p)
                }
                _ => return Err("Prepared graphs require explicit LV2 nodes".into()),
            };
            if parameters.len() > 256 {
                return Err("Prepared graph control limit exceeded".into());
            }
            nodes.push(Processor {
                plugin,
                left: vec![0.0; frames],
                right: vec![0.0; frames],
            });
        }
        if !by_node.is_empty() {
            return Err("Unknown plugin binding".into());
        }
        let input = schedule.input();
        let output = schedule.output();
        let control = Control::prepared(rig, parameters)?;
        Ok(Self {
            control,
            nodes,
            ports,
            schedule,
            input,
            output,
            frames,
            bypassed: false,
            failed: false,
        })
    }
    /// Restore only before opening PCM. Unknown/missing ports fail instead of
    /// silently dropping a control after a plugin upgrade.
    pub fn restore(&mut self, recall: &crate::protocol::GraphRecall) -> Result<(), String> {
        recall.validate()?;
        let initial = self.snapshot();
        if recall.values.len() != initial.parameters.len()
            || recall
                .values
                .iter()
                .any(|v| !initial.parameters.iter().any(|p| p.id == v.target))
        {
            return Err("Plugin controls changed; graph recall is incompatible".into());
        }
        for value in &recall.values {
            let current = self.snapshot();
            self.apply(
                Command {
                    session: current.session,
                    protocol: 1,
                    request_id: format!("restore-{}", current.revision),
                    expected_revision: Some(current.revision),
                    action: oxidal_control::Action::Set {
                        target: value.target.clone(),
                        value: value.normalized,
                    },
                },
                false,
            )?;
        }
        let current = self.snapshot();
        self.apply(
            Command {
                session: current.session,
                protocol: 1,
                request_id: "restore-bypass".into(),
                expected_revision: Some(current.revision),
                action: oxidal_control::Action::Set {
                    target: "rig.bypass".into(),
                    value: if recall.bypassed { 1.0 } else { 0.0 },
                },
            },
            false,
        )?;
        let current = self.snapshot();
        self.apply(
            Command {
                session: current.session,
                protocol: 1,
                request_id: "restore-mappings".into(),
                expected_revision: Some(current.revision),
                action: oxidal_control::Action::Mappings {
                    file: recall.mappings.clone(),
                },
            },
            false,
        )?;
        let actual = self.snapshot();
        if recall.values.iter().any(|v| {
            !actual
                .parameters
                .iter()
                .any(|p| p.id == v.target && (p.value - v.normalized).abs() < 1e-5)
        }) {
            return Err("Restored graph control differs".into());
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        self.control.snapshot()
    }
    /// Native input readback for inspectors; normalized state is quantized to these values.
    pub fn native_value(&self, target: &str) -> Result<f32, String> {
        if self.failed {
            return Err("Failed graph must be recreated".into());
        }
        let binding = self
            .ports
            .iter()
            .find(|p| p.target == target)
            .ok_or("Unknown native target")?;
        self.nodes[binding.node]
            .plugin
            .as_ref()
            .expect("bound plugin")
            .value(binding.port.index)
    }
    pub fn apply(&mut self, command: Command, midi_enabled: bool) -> Result<Snapshot, String> {
        if self.failed {
            return Err("Failed graph must be recreated".into());
        }
        let mut candidate = self.control.clone();
        let state = candidate.apply(command, midi_enabled)?;
        // The control core allows edge changes only; retain node indexes and plugin histories.
        let current = self.control.snapshot();
        if state.rig.nodes != current.rig.nodes {
            return Err("Node replacement requires graph preparation".into());
        }
        let schedule = PreparedRouting::new(&state.rig)?;
        let result = self.install_controls(&mut candidate, &state)?;
        self.schedule = schedule;
        self.control = candidate;
        Ok(result)
    }
    pub fn expire_edit(&mut self, now: Instant) -> Result<Option<Snapshot>, String> {
        if self.failed {
            return Err("Failed graph must be recreated".into());
        }
        let mut candidate = self.control.clone();
        let Some(state) = candidate.expire_edit(now) else {
            return Ok(None);
        };
        let result = self.install_controls(&mut candidate, &state)?;
        self.control = candidate;
        Ok(Some(result))
    }
    fn install_controls(
        &mut self,
        candidate: &mut Control,
        state: &Snapshot,
    ) -> Result<Snapshot, String> {
        // Validate the entire scalar update before touching native storage.
        let previous = self.control.snapshot();
        let values: Vec<f32> = self
            .ports
            .iter()
            .map(|b| {
                let value = state
                    .parameters
                    .iter()
                    .find(|p| p.id == b.target)
                    .ok_or("Missing graph control")?
                    .value;
                if previous
                    .parameters
                    .iter()
                    .any(|p| p.id == b.target && p.value == value)
                {
                    self.nodes[b.node]
                        .plugin
                        .as_ref()
                        .expect("bound plugin")
                        .value(b.port.index)
                } else {
                    b.port.denormalize(value as f32)
                }
            })
            .collect::<Result<_, _>>()?;
        let mut confirmed = Vec::with_capacity(values.len());
        for (b, value) in self.ports.iter().zip(values) {
            let plugin = self.nodes[b.node].plugin.as_mut().expect("bound plugin");
            let result = plugin
                .set(b.port.index, value)
                .and_then(|v| b.port.normalize(v));
            let normalized = match result {
                Ok(v) => v,
                Err(e) => {
                    self.failed = true;
                    return Err(e);
                }
            };
            confirmed.push((b.target.clone(), f64::from(normalized.clamp(0.0, 1.0))));
        }
        let result = candidate.confirm_parameters(&confirmed)?;
        self.bypassed = result.bypassed;
        Ok(result)
    }
    /// Sum fan-in at unity without normalization or clipping; preserve independent stereo.
    /// Global bypass returns dry input while running the graph with silence to drain histories.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<(), String> {
        if self.failed {
            left.fill(0.0);
            right.fill(0.0);
            return Err("Failed graph must be recreated".into());
        }
        if left.len() != self.frames
            || right.len() != self.frames
            || left.iter().chain(right.iter()).any(|v| !v.is_finite())
        {
            return Err("Invalid fixed stereo buffer".into());
        }
        self.nodes[self.input].left.copy_from_slice(left);
        self.nodes[self.input].right.copy_from_slice(right);
        if self.bypassed {
            self.nodes[self.input].left.fill(0.0);
            self.nodes[self.input].right.fill(0.0);
        }
        let result = self.run();
        if let Err(e) = result {
            self.failed = true;
            left.fill(0.0);
            right.fill(0.0);
            return Err(e);
        }
        if !self.bypassed {
            left.copy_from_slice(&self.nodes[self.output].left);
            right.copy_from_slice(&self.nodes[self.output].right);
        }
        Ok(())
    }
    fn run(&mut self) -> Result<(), String> {
        for &i in self.schedule.order() {
            if i == self.input {
                continue;
            }
            self.nodes[i].left.fill(0.0);
            self.nodes[i].right.fill(0.0);
            for &s in self.schedule.sources(i) {
                for k in 0..self.frames {
                    self.nodes[i].left[k] += self.nodes[s].left[k];
                    self.nodes[i].right[k] += self.nodes[s].right[k];
                }
            }
            let node = &mut self.nodes[i];
            if node
                .left
                .iter()
                .chain(node.right.iter())
                .any(|v| !v.is_finite())
            {
                return Err("Nonfinite graph sum".into());
            }
            if let Some(plugin) = &mut node.plugin {
                plugin.process(&mut node.left, &mut node.right)?;
            }
        }
        Ok(())
    }
}
