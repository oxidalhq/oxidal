//! Bounded process protocol and daemon lifecycle contract; native libraries stay out of the daemon.
use oxidal_audio::{StreamConfig, lifecycle::AudioPhase};
use oxidal_control::{Command, MappingFile, Snapshot};
use oxidal_graph::{BlockKind, Rig};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const REQUEST_LIMIT: usize = 65536;
pub const REPLY_LIMIT: usize = 262144;
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub node: String,
    pub uri: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartGraph {
    #[serde(default)]
    pub recall: Option<GraphRecall>,
    pub stream: StreamConfig,
    pub rig: Rig,
    pub bindings: Vec<Binding>,
}
impl StartGraph {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        if let Some(recall) = &self.recall {
            recall.validate()?;
        }
        let frames = self.stream.input.period_frames;
        if frames > 2048 || !frames.is_power_of_two() {
            return Err("LV2 requires power-of-two periods up to 2048 frames".into());
        }
        validate_graph(&self.rig, &self.bindings)?;
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() >= REQUEST_LIMIT {
            return Err("Graph settings exceed IPC limit".into());
        }
        Ok(())
    }
}
/// Structural admission shared by playable requests and durable graph documents.
pub fn validate_graph(rig: &Rig, bindings: &[Binding]) -> Result<(), String> {
    if !rig.validate().valid || bindings.len() + 2 != rig.nodes.len() {
        return Err("Invalid graph or bindings".into());
    }
    let mut ids = BTreeSet::new();
    for b in bindings {
        if b.uri.is_empty()
            || b.uri.len() > 1024
            || b.uri.contains('\0')
            || !ids.insert(&b.node)
            || !rig
                .nodes
                .iter()
                .any(|n| n.id == b.node && n.kind == BlockKind::Lv2)
        {
            return Err("Invalid LV2 binding".into());
        }
    }
    if rig.nodes.iter().any(|n| {
        n.level != 1.0
            || !matches!(
                n.kind,
                BlockKind::Input | BlockKind::Output | BlockKind::Lv2
            )
    }) {
        return Err("Use unity-level input/output and explicit LV2 nodes".into());
    }
    Ok(())
}
/// Durable scalar/MIDI values, independent of transient command sessions and edit leases.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphRecall {
    pub bypassed: bool,
    pub values: Vec<GraphValue>,
    pub mappings: MappingFile,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphValue {
    pub target: String,
    pub normalized: f64,
}
impl GraphRecall {
    pub fn from_snapshot(snapshot: &Snapshot) -> Result<Self, String> {
        if snapshot.edit.is_some() {
            return Err("Finish the current adjustment first".into());
        }
        let recall = Self {
            bypassed: snapshot.bypassed,
            values: snapshot
                .parameters
                .iter()
                .map(|p| GraphValue {
                    target: p.id.clone(),
                    normalized: p.value,
                })
                .collect(),
            mappings: snapshot.mappings.clone(),
        };
        recall.validate()?;
        Ok(recall)
    }
    pub fn validate(&self) -> Result<(), String> {
        let mut targets = BTreeSet::new();
        if self.values.len() > 257
            || self.mappings.version != 1
            || self.mappings.mappings.len() > 128
        {
            return Err("Invalid graph recall bounds".into());
        }
        for value in &self.values {
            if value.target.is_empty()
                || value.target.len() > 256
                || value.target.contains(char::is_control)
                || !targets.insert(&value.target)
                || !value.normalized.is_finite()
                || !(0.0..=1.0).contains(&value.normalized)
            {
                return Err("Invalid graph recall value".into());
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkerRequest {
    Status,
    Control { command: Box<Command> },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NativeValue {
    pub target: String,
    pub value: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerReply {
    pub telemetry: oxidal_audio::meter::Snapshot,
    pub control: Snapshot,
    pub native_values: Vec<NativeValue>,
    pub processed_frames: u64,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphAudioState {
    pub telemetry: Option<oxidal_audio::meter::Snapshot>,
    pub session: String,
    pub revision: u64,
    pub phase: AudioPhase,
    pub configured: Option<StartGraph>,
    pub control: Option<Snapshot>,
    pub native_values: Vec<NativeValue>,
    pub processed_frames: u64,
    pub device_owned: bool,
    pub error: Option<String>,
    pub experimental: bool,
    pub saved_copy: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum GraphAudioAction {
    Configure { stream: StreamConfig },
    Start { settings: Box<StartGraph> },
    Stop,
    Restart,
    SaveCopy { name: String },
    Control { command: Box<Command> },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphAudioCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: GraphAudioAction,
}
