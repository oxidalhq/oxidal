mod edit;
pub use edit::{EDIT_LEASE, Edit, EditStatus};
use oxidal_graph::Rig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Discoverable controls share stable IDs across MIDI and web adapters.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub step: f64,
    pub value: f64,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MidiMode {
    Absolute,
    RelativeTwosComplement,
}

/// Scaling policy for a mapped absolute knob.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MidiCurve {
    Linear,
    Logarithmic,
}

/// Enumerated commands are discoverable alongside numeric parameters.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ActionDescriptor {
    pub id: String,
    pub label: String,
    pub options: Vec<String>,
}

/// Versioned MIDI mapping. Feedback uses a separate output route, never an input route.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiMapping {
    pub id: String,
    pub device: String,
    pub channel: u8,
    pub cc: u8,
    pub target: String,
    pub mode: MidiMode,
    pub pickup: bool,
    pub feedback: bool,
    pub min: f64,
    pub max: f64,
    pub curve: MidiCurve,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MappingFile {
    pub version: u8,
    pub mappings: Vec<MidiMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiInput {
    pub device: String,
    pub channel: u8,
    pub cc: u8,
    pub value: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiFeedback {
    pub mapping: String,
    pub device: String,
    pub channel: u8,
    pub cc: u8,
    pub value: u8,
}

/// One command entry point; relative edits are applied to current authoritative state.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Set { target: String, value: f64 },
    Adjust { target: String, delta: f64 },
    Routing { rig: Rig },
    Mappings { file: MappingFile },
    Midi { input: MidiInput },
    Edit { edit: Edit },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub session: String,
    pub protocol: u8,
    pub request_id: String,
    pub expected_revision: Option<u32>,
    pub action: Action,
}

/// Every subscriber receives a complete, revisioned snapshot; dropped intermediates resync safely.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub session: String,
    pub protocol: u8,
    pub revision: u32,
    pub origin: String,
    pub request_id: String,
    pub audio_available: bool,
    pub bypassed: bool,
    pub preset: String,
    pub actions: Vec<ActionDescriptor>,
    pub last_midi: Option<MidiInput>,
    pub midi_mapped: bool,
    pub rig: Rig,
    pub parameters: Vec<Parameter>,
    pub mappings: MappingFile,
    pub feedback: Vec<MidiFeedback>,
    pub edit: Option<EditStatus>,
}

/// Serialized non-real-time control model. No networking or MIDI I/O runs in an audio callback.
/// @see docs/architecture.md
#[derive(Debug, Clone)]
pub struct Control {
    state: Snapshot,
    prepared: bool,
    pickup: BTreeMap<String, (bool, Option<f64>)>,
    active_edit: Option<edit::ActiveEdit>,
    edit_receipts: std::collections::VecDeque<edit::Receipt>,
}

impl Default for Control {
    fn default() -> Self {
        let definitions = [
            ("nam-a.level", "NAM A level", 0.5),
            ("delay.mix", "Delay mix", 0.25),
            ("reverb.mix", "Reverb mix", 0.2),
            ("output.level", "Output level", 0.7),
        ];
        Self {
            prepared: false,
            state: Snapshot {
                session: format!(
                    "{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .expect("clock after epoch")
                        .as_nanos()
                ),
                protocol: 1,
                revision: 0,
                origin: "startup".into(),
                request_id: "startup".into(),
                audio_available: false,
                bypassed: false,
                preset: "serial".into(),
                actions: vec![
                    ActionDescriptor {
                        id: "rig.bypass".into(),
                        label: "Rig bypass".into(),
                        options: vec!["Off".into(), "On".into()],
                    },
                    ActionDescriptor {
                        id: "rig.preset".into(),
                        label: "Preset".into(),
                        options: vec!["Serial".into(), "Parallel".into()],
                    },
                ],
                last_midi: None,
                midi_mapped: false,
                rig: Rig::example(false),
                parameters: definitions
                    .into_iter()
                    .map(|(id, label, value)| Parameter {
                        id: id.into(),
                        label: label.into(),
                        unit: "%".into(),
                        min: 0.0,
                        max: 1.0,
                        default: value,
                        step: 0.01,
                        value,
                        writable: true,
                    })
                    .collect(),
                mappings: MappingFile {
                    version: 1,
                    mappings: vec![MidiMapping {
                        id: "knob-1".into(),
                        device: "simulator".into(),
                        channel: 1,
                        cc: 21,
                        target: "nam-a.level".into(),
                        mode: MidiMode::Absolute,
                        pickup: false,
                        feedback: true,
                        min: 0.0,
                        max: 1.0,
                        curve: MidiCurve::Linear,
                    }],
                },
                feedback: vec![],
                edit: None,
            },
            pickup: BTreeMap::new(),
            active_edit: None,
            edit_receipts: std::collections::VecDeque::new(),
        }
    }
}
impl Control {
    /// Construct controls for a prepared processor. Topology may change between the same
    /// nodes, but simulator presets cannot replace native resources. Values are normalized.
    pub fn prepared(rig: Rig, parameters: Vec<Parameter>) -> Result<Self, String> {
        if !rig.validate().valid || parameters.len() > 256 {
            return Err("invalid_prepared_controls".into());
        }
        let mut ids = BTreeSet::new();
        for p in &parameters {
            let Some((node, symbol)) = p.id.split_once('.') else {
                return Err("invalid_parameter_id".into());
            };
            if p.id.starts_with("rig.")
                || !rig.nodes.iter().any(|n| n.id == node)
                || symbol.is_empty()
                || symbol.len() > 128
                || !symbol
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_')
                || !ids.insert(&p.id)
                || p.min != 0.0
                || p.max != 1.0
                || !p.value.is_finite()
                || !(0.0..=1.0).contains(&p.value)
                || !p.default.is_finite()
                || !(0.0..=1.0).contains(&p.default)
                || !p.step.is_finite()
                || p.step <= 0.0
                || p.step > 1.0
                || !p.writable
                || p.label.len() > 128
                || p.unit.len() > 32
            {
                return Err("invalid_prepared_parameter".into());
            }
        }
        let mut c = Self {
            prepared: true,
            ..Self::default()
        };
        c.state.rig = rig;
        c.state.parameters = parameters;
        c.state.preset = "prepared".into();
        c.state.actions.retain(|a| a.id == "rig.bypass");
        c.state.mappings.mappings.clear();
        Ok(c)
    }

    /// Processor adapter readback after quantization, before publishing a successful command.
    /// Does not advance the revision or release an owned edit. Call outside the audio callback.
    pub fn confirm_parameters(&mut self, values: &[(String, f64)]) -> Result<Snapshot, String> {
        if !self.prepared {
            return Err("not_prepared".into());
        }
        let mut candidate = self.clone();
        for (id, value) in values {
            candidate.parameter(id)?;
            candidate.set(id, *value)?;
        }
        candidate.feedback();
        let snapshot = candidate.snapshot();
        *self = candidate;
        Ok(snapshot)
    }
    /// Current confirmed state for HTTP/SSE clients and transport adapters.
    /// @see docs/architecture.md
    pub fn snapshot(&self) -> Snapshot {
        self.state.clone()
    }

    /// Applies to a candidate first: all rejected commands leave state and pickup untouched.
    /// @see docs/architecture.md
    pub fn apply(&mut self, command: Command, simulator: bool) -> Result<Snapshot, String> {
        if command.protocol != 1 {
            return Err("unsupported_protocol".into());
        }
        if command.session != self.state.session {
            return Err("session_conflict".into());
        }
        if command.request_id.is_empty() || command.request_id.len() > 80 {
            return Err("invalid_request_id".into());
        }
        if command
            .expected_revision
            .is_some_and(|r| r != self.state.revision)
        {
            return Err("revision_conflict".into());
        }
        if matches!(
            command.action,
            Action::Routing { .. }
                | Action::Mappings { .. }
                | Action::Edit {
                    edit: Edit::Begin { .. }
                }
        ) && command.expected_revision.is_none()
        {
            return Err("revision_required".into());
        }
        if matches!(&command.action, Action::Set { target, .. } if target=="rig.preset")
            && command.expected_revision.is_none()
        {
            return Err("revision_required".into());
        }
        let mut candidate = self.clone();
        let mut origin = "web";
        match &command.action {
            Action::Edit { edit } => {
                if !candidate.edit(edit, std::time::Instant::now())? {
                    return Ok(self.snapshot());
                }
            }
            Action::Set { target, value } => {
                if candidate.editing(target) {
                    return Err("edit_busy".into());
                }
                if target == "rig.preset" {
                    candidate.cancel_edit()?;
                }
                candidate.set(target, *value)?;
                candidate.reset_pickup(target);
            }
            Action::Adjust { target, delta } => {
                if candidate.editing(target) {
                    return Err("edit_busy".into());
                }
                if !delta.is_finite() {
                    return Err("invalid_value".into());
                }
                let value = candidate.parameter(target)?.value + delta;
                candidate.set(target, value.clamp(0.0, 1.0))?;
                candidate.reset_pickup(target);
            }
            Action::Routing { rig } => {
                let validation = rig.validate();
                if !validation.valid {
                    return Err(format!("invalid_rig: {}", validation.errors.join("; ")));
                }
                let template = if candidate.prepared {
                    candidate.state.rig.clone()
                } else {
                    Rig::example(rig.nodes.iter().any(|n| n.id == "nam-b"))
                };
                if rig.nodes.len() != template.nodes.len()
                    || template.nodes.iter().any(|required| {
                        !rig.nodes
                            .iter()
                            .any(|n| n.id == required.id && n.kind == required.kind)
                    })
                {
                    return Err("unsupported_poc_layout".into());
                }
                candidate.cancel_edit()?;
                candidate.state.rig = rig.clone();
                candidate.state.preset = "custom".into();
                // Controls remain authoritative when changing only topology.
                for parameter in candidate.state.parameters.clone() {
                    candidate.set(&parameter.id, parameter.value)?;
                }
                candidate.pickup.clear();
            }
            Action::Mappings { file } => {
                candidate.validate_mappings(file)?;
                candidate.state.mappings = file.clone();
                candidate.pickup.clear();
            }
            Action::Midi { input } => {
                if !simulator {
                    return Err("simulator_disabled".into());
                }
                origin = "midi";
                candidate.state.last_midi = Some(input.clone());
                candidate.state.midi_mapped = candidate.midi(input)?;
            }
        }
        candidate.state.revision = candidate
            .state
            .revision
            .checked_add(1)
            .ok_or("revision_exhausted")?;
        candidate.state.origin = origin.into();
        candidate.state.request_id = command.request_id;
        candidate.feedback();
        let result = candidate.snapshot();
        *self = candidate;
        Ok(result)
    }
    fn feedback(&mut self) {
        self.state.feedback = self
            .state
            .mappings
            .mappings
            .iter()
            .filter(|m| m.feedback && (m.target != "rig.preset" || self.state.preset != "custom"))
            .map(|m| {
                let value = self.value(&m.target).expect("validated mapping");
                let normalized = if m.curve == MidiCurve::Logarithmic {
                    (value.max(m.min) / m.min).ln() / (m.max / m.min).ln()
                } else {
                    (value - m.min) / (m.max - m.min)
                };
                MidiFeedback {
                    mapping: m.id.clone(),
                    device: format!("{}:feedback", m.device),
                    channel: m.channel,
                    cc: m.cc,
                    value: (normalized.clamp(0.0, 1.0) * 127.0).round() as u8,
                }
            })
            .collect();
    }
    fn parameter(&self, id: &str) -> Result<&Parameter, String> {
        self.state
            .parameters
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "unknown_target".into())
    }
    fn value(&self, id: &str) -> Result<f64, String> {
        if self.prepared && id == "rig.preset" {
            return Err("unsupported_prepared_action".into());
        }
        match id {
            "rig.bypass" => Ok(if self.state.bypassed { 1.0 } else { 0.0 }),
            "rig.preset" => Ok(if self.state.preset == "parallel" {
                1.0
            } else {
                0.0
            }),
            _ => Ok(self.parameter(id)?.value),
        }
    }
    fn set(&mut self, id: &str, value: f64) -> Result<(), String> {
        if self.prepared && id == "rig.preset" {
            return Err("unsupported_prepared_action".into());
        }
        if id == "rig.bypass" || id == "rig.preset" {
            if value != 0.0 && value != 1.0 {
                return Err("invalid_action_value".into());
            }
            if id == "rig.bypass" {
                self.state.bypassed = value == 1.0;
            } else {
                self.state.preset = if value == 1.0 { "parallel" } else { "serial" }.into();
                self.state.rig = Rig::example(value == 1.0);
                for parameter in &mut self.state.parameters {
                    parameter.value = parameter.default;
                }
                self.pickup.clear();
            }
            return Ok(());
        }
        let p = self
            .state
            .parameters
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or("unknown_target")?;
        if !value.is_finite() || !(p.min..=p.max).contains(&value) {
            return Err("invalid_value".into());
        }
        p.value = value;
        let (block, _) = id.split_once('.').ok_or("unknown_target")?;
        if !self.prepared
            && let Some(n) = self.state.rig.nodes.iter_mut().find(|n| n.id == block)
        {
            n.level = value;
        }
        Ok(())
    }
    fn reset_pickup(&mut self, target: &str) {
        for m in &self.state.mappings.mappings {
            if m.target == target {
                self.pickup.remove(&m.id);
            }
        }
    }
    fn validate_mappings(&self, file: &MappingFile) -> Result<(), String> {
        if file.version != 1 || file.mappings.len() > 32 {
            return Err("invalid_mapping_version_or_limit".into());
        }
        let mut ids = BTreeSet::new();
        let mut sources = BTreeSet::new();
        for m in &file.mappings {
            if m.id.is_empty()
                || m.id.len() > 64
                || m.device.is_empty()
                || m.device.len() > 64
                || m.device.ends_with(":feedback")
                || !(1..=16).contains(&m.channel)
                || m.cc > 127
                || !ids.insert(&m.id)
                || !sources.insert((&m.device, m.channel, m.cc))
            {
                return Err("invalid_mapping".into());
            }
            self.value(&m.target)?;
            if !m.min.is_finite()
                || !m.max.is_finite()
                || m.min < 0.0
                || m.max > 1.0
                || m.min >= m.max
                || (m.curve == MidiCurve::Logarithmic && m.min <= 0.0)
            {
                return Err("invalid_mapping_range_or_curve".into());
            }
            if m.target.starts_with("rig.")
                && (m.mode != MidiMode::Absolute
                    || m.pickup
                    || m.min != 0.0
                    || m.max != 1.0
                    || m.curve != MidiCurve::Linear)
            {
                return Err("invalid_action_mapping".into());
            }
        }
        Ok(())
    }
    fn midi(&mut self, input: &MidiInput) -> Result<bool, String> {
        if input.device.is_empty()
            || input.device.len() > 64
            || !(1..=16).contains(&input.channel)
            || input.cc > 127
            || input.value > 127
            || input.device.ends_with(":feedback")
        {
            return Err("invalid_midi_input_route_or_value".into());
        }
        let Some(mapping) = self
            .state
            .mappings
            .mappings
            .iter()
            .find(|m| m.device == input.device && m.channel == input.channel && m.cc == input.cc)
            .cloned()
        else {
            return Ok(false);
        };
        // Physical control takes priority over a browser preview, without stale rollback.
        if self.editing(&mapping.target) || mapping.target == "rig.preset" {
            self.cancel_edit()?;
        }
        let current = self.value(&mapping.target)?;
        match mapping.mode {
            MidiMode::Absolute => {
                let normalized = f64::from(input.value) / 127.0;
                let value = if mapping.target.starts_with("rig.") {
                    if input.value >= 64 { 1.0 } else { 0.0 }
                } else if mapping.curve == MidiCurve::Logarithmic {
                    mapping.min * (mapping.max / mapping.min).powf(normalized)
                } else {
                    mapping.min + normalized * (mapping.max - mapping.min)
                };
                if mapping.pickup {
                    let (latched, previous) = self
                        .pickup
                        .entry(mapping.id.clone())
                        .or_insert((false, None));
                    let current_normalized = if mapping.curve == MidiCurve::Logarithmic {
                        (current.max(mapping.min) / mapping.min).ln()
                            / (mapping.max / mapping.min).ln()
                    } else {
                        (current - mapping.min) / (mapping.max - mapping.min)
                    }
                    .clamp(0.0, 1.0);
                    if !*latched {
                        *latched = (normalized - current_normalized).abs() <= 1.0 / 127.0
                            || previous.is_some_and(|p| {
                                (p - current_normalized) * (normalized - current_normalized) <= 0.0
                            });
                    }
                    *previous = Some(normalized);
                    if !*latched {
                        return Ok(true);
                    }
                }
                self.set(&mapping.target, value)?;
            }
            MidiMode::RelativeTwosComplement => {
                let delta = if input.value < 64 {
                    i16::from(input.value)
                } else {
                    i16::from(input.value) - 128
                };
                self.set(
                    &mapping.target,
                    (current + f64::from(delta) * (mapping.max - mapping.min) * 0.01)
                        .clamp(mapping.min, mapping.max),
                )?;
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cmd(c: &Control, action: Action) -> Command {
        Command {
            session: c.state.session.clone(),
            protocol: 1,
            request_id: "test".into(),
            expected_revision: Some(c.state.revision),
            action,
        }
    }
    fn midi(value: u8) -> Action {
        Action::Midi {
            input: MidiInput {
                device: "simulator".into(),
                channel: 1,
                cc: 21,
                value,
            },
        }
    }
    #[test]
    fn prepared_controls_reject_invalid_banks_and_confirm_quantized_feedback() {
        let default = Control::default().snapshot();
        let mut invalid = default.parameters.clone();
        invalid[0].value = f64::NAN;
        assert!(Control::prepared(default.rig.clone(), invalid).is_err());
        let mut duplicate = default.parameters.clone();
        duplicate.push(duplicate[0].clone());
        assert!(Control::prepared(default.rig.clone(), duplicate).is_err());
        let mut c = Control::prepared(default.rig, default.parameters).unwrap();
        let mut file = default.mappings;
        file.mappings[0].target = "rig.preset".into();
        assert!(c.apply(cmd(&c, Action::Mappings { file }), true).is_err());
        assert!(c.confirm_parameters(&[("rig.bypass".into(), 1.0)]).is_err());
        assert!(
            c.confirm_parameters(&[("nam-a.level".into(), f64::INFINITY)])
                .is_err()
        );
        let file = Control::default().snapshot().mappings;
        c.apply(cmd(&c, Action::Mappings { file }), true).unwrap();
        let revision = c.snapshot().revision;
        let s = c
            .confirm_parameters(&[("nam-a.level".into(), 0.25)])
            .unwrap();
        assert_eq!(s.revision, revision);
        assert_eq!(s.feedback[0].value, 32);
        assert_eq!(s.parameters[0].value, 0.25);
    }
    #[test]
    fn edits_share_state_and_emit_feedback() {
        let mut c = Control::default();
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert_eq!(c.state.parameters[0].value, 1.0);
        c.apply(
            cmd(
                &c,
                Action::Set {
                    target: "nam-a.level".into(),
                    value: 0.0,
                },
            ),
            true,
        )
        .unwrap();
        assert_eq!(c.state.feedback[0].value, 0);
    }
    #[test]
    fn rejects_stale_invalid_and_loopback_without_mutation() {
        let mut c = Control::default();
        let old = cmd(&c, midi(10));
        c.apply(cmd(&c, midi(20)), true).unwrap();
        assert_eq!(c.apply(old, true).unwrap_err(), "revision_conflict");
        let rev = c.state.revision;
        assert!(
            c.apply(
                cmd(
                    &c,
                    Action::Set {
                        target: "nam-a.level".into(),
                        value: f64::NAN
                    }
                ),
                true
            )
            .is_err()
        );
        assert!(
            c.apply(
                cmd(
                    &c,
                    Action::Midi {
                        input: MidiInput {
                            device: "simulator:feedback".into(),
                            channel: 1,
                            cc: 21,
                            value: 20
                        }
                    }
                ),
                true
            )
            .is_err()
        );
        assert_eq!(c.state.revision, rev);
    }
    #[test]
    fn pickup_and_repeated_relative_events() {
        let mut c = Control::default();
        c.state.mappings.mappings[0].pickup = true;
        c.apply(cmd(&c, midi(0)), true).unwrap();
        assert_eq!(c.state.parameters[0].value, 0.5);
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert_eq!(c.state.parameters[0].value, 1.0);
        c.state.mappings.mappings[0].mode = MidiMode::RelativeTwosComplement;
        c.apply(cmd(&c, midi(127)), true).unwrap();
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert!((c.state.parameters[0].value - 0.98).abs() < 1e-9);
    }
    #[test]
    fn structural_commands_require_revision_and_duplicate_mappings_reject() {
        let mut c = Control::default();
        let mut command = cmd(
            &c,
            Action::Routing {
                rig: Rig::example(true),
            },
        );
        command.expected_revision = None;
        assert_eq!(c.apply(command, true).unwrap_err(), "revision_required");
        let mut file = c.state.mappings.clone();
        file.mappings.push(file.mappings[0].clone());
        assert!(c.apply(cmd(&c, Action::Mappings { file }), true).is_err());
    }
    #[test]
    fn learn_range_actions_and_preset_updates_share_the_same_state() {
        let mut c = Control::default();
        let unknown = Action::Midi {
            input: MidiInput {
                device: "simulator".into(),
                channel: 2,
                cc: 99,
                value: 127,
            },
        };
        c.apply(cmd(&c, unknown), true).unwrap();
        assert!(!c.state.midi_mapped);
        assert_eq!(c.state.last_midi.as_ref().unwrap().cc, 99);
        let mut file = c.state.mappings.clone();
        file.mappings[0].min = 0.1;
        file.mappings[0].max = 0.9;
        file.mappings[0].curve = MidiCurve::Logarithmic;
        c.apply(cmd(&c, Action::Mappings { file }), true).unwrap();
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert!((c.state.parameters[0].value - 0.9).abs() < 1e-9);
        assert_eq!(c.state.feedback[0].value, 127);
        let mut file = c.state.mappings.clone();
        file.mappings[0].target = "rig.bypass".into();
        file.mappings[0].min = 0.0;
        file.mappings[0].max = 1.0;
        file.mappings[0].curve = MidiCurve::Linear;
        c.apply(cmd(&c, Action::Mappings { file }), true).unwrap();
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert!(c.state.bypassed);
        c.apply(
            cmd(
                &c,
                Action::Set {
                    target: "rig.preset".into(),
                    value: 1.0,
                },
            ),
            true,
        )
        .unwrap();
        assert_eq!(c.state.preset, "parallel");
        assert_eq!(c.state.rig.nodes.len(), 6);
    }
    #[test]
    fn previous_daemon_session_cannot_write_after_restart() {
        let old = Control::default();
        let mut restarted = Control::default();
        assert_eq!(
            restarted.apply(cmd(&old, midi(127)), true).unwrap_err(),
            "session_conflict"
        );
        assert_eq!(restarted.state.revision, 0);
    }
    #[test]
    fn feedback_is_bounded_coalesced_and_mapping_changes_do_not_apply_old_controls() {
        let mut c = Control::default();
        let base = c.state.mappings.mappings[0].clone();
        let file = MappingFile {
            version: 1,
            mappings: (0..32)
                .map(|cc| {
                    let mut m = base.clone();
                    m.id = format!("knob-{cc}");
                    m.cc = cc;
                    m
                })
                .collect(),
        };
        c.apply(cmd(&c, Action::Mappings { file }), true).unwrap();
        for _ in 0..100 {
            c.apply(
                cmd(
                    &c,
                    Action::Adjust {
                        target: "nam-a.level".into(),
                        delta: 0.001,
                    },
                ),
                true,
            )
            .unwrap();
            assert_eq!(c.state.feedback.len(), 32);
        }
        assert!(c.state.feedback.iter().all(|f| f.value == 76));
        let mut file = c.state.mappings.clone();
        file.mappings.clear();
        c.apply(cmd(&c, Action::Mappings { file }), true).unwrap();
        let value = c.state.parameters[0].value;
        c.apply(cmd(&c, midi(127)), true).unwrap();
        assert_eq!(c.state.parameters[0].value, value);
        assert!(!c.state.midi_mapped);
        assert!(c.state.feedback.is_empty());
    }
}
