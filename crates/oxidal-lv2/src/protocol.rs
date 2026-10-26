//! Bounded process protocol and daemon lifecycle contract; native libraries stay out of the daemon.
use oxidal_audio::{StreamConfig, lifecycle::AudioPhase};
use oxidal_control::{Command, Snapshot};
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
    pub stream: StreamConfig,
    pub rig: Rig,
    pub bindings: Vec<Binding>,
}
impl StartGraph {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        let frames = self.stream.input.period_frames;
        if frames > 2048 || !frames.is_power_of_two() {
            return Err("LV2 requires power-of-two periods up to 2048 frames".into());
        }
        if !self.rig.validate().valid || self.bindings.len() + 2 != self.rig.nodes.len() {
            return Err("Invalid graph or bindings".into());
        }
        let mut ids = BTreeSet::new();
        for b in &self.bindings {
            if b.uri.is_empty()
                || b.uri.len() > 1024
                || b.uri.contains('\0')
                || !ids.insert(&b.node)
                || !self
                    .rig
                    .nodes
                    .iter()
                    .any(|n| n.id == b.node && n.kind == BlockKind::Lv2)
            {
                return Err("Invalid LV2 binding".into());
            }
        }
        if self.rig.nodes.iter().any(|n| {
            n.level != 1.0
                || !matches!(
                    n.kind,
                    BlockKind::Input | BlockKind::Output | BlockKind::Lv2
                )
        }) {
            return Err("Use unity-level input/output and explicit LV2 nodes".into());
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() >= REQUEST_LIMIT {
            return Err("Graph settings exceed IPC limit".into());
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
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum GraphAudioAction {
    Start { settings: Box<StartGraph> },
    Stop,
    Restart,
    Control { command: Box<Command> },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphAudioCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: GraphAudioAction,
}
