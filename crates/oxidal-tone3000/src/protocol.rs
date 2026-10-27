//! Native editor wire contract; only the optional worker executes native operations.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub id: String,
    pub label: String,
    pub display: String,
    pub toggle: bool,
    pub minimum: f64,
    pub maximum: f64,
    pub interval: f64,
    pub default: f64,
    pub value: f64,
    pub normalized: f64,
    pub automatable: bool,
    pub tone: bool,
    pub machine_default: bool,
    /// Adapter qualification, separate from the native automation flag.
    #[serde(default)]
    pub writable: bool,
    #[serde(default)]
    pub staged: bool,
}
/// Native block readback, with a server-issued edit target. Values are normalized 0–1.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BlockControl {
    pub id: String,
    pub block_id: String,
    pub lane: String,
    pub name: String,
    pub parameter: String,
    pub value: f64,
    pub step: f64,
    pub staged: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Editing {
    pub owner: String,
    pub target: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EditorSnapshot {
    pub session: String,
    pub revision: u32,
    pub loaded: Option<String>,
    pub source_sha256: Option<String>,
    pub dirty: bool,
    pub edit: Option<Editing>,
    pub parameters: Vec<Parameter>,
    pub block_controls: Vec<BlockControl>,
    pub owned: Vec<oxidal_presets::OwnedPreset>,
    pub state_captures: u32,
    pub live_audio: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EditorAction {
    Load {
        id: String,
        owned: bool,
    },
    Begin {
        owner: String,
        token: String,
        target: String,
    },
    Preview {
        owner: String,
        token: String,
        sequence: u32,
        value: f32,
    },
    Commit {
        owner: String,
        token: String,
        sequence: u32,
        value: f32,
    },
    Cancel {
        owner: String,
        token: String,
    },
    Save {
        name: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EditorCommand {
    pub session: String,
    pub expected_revision: u32,
    pub request_id: String,
    pub action: EditorAction,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkerRequest {
    State,
    Command { command: EditorCommand },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WorkerReply {
    State(EditorSnapshot),
    Error { error: String },
}
/// This initial slice exposes only controls whose behavior is exercised by native tests.
pub fn writable(id: &str) -> bool {
    live_writable(id) || matches!(id, "inputCalibrationLevel" | "osEnabled" | "osFactor")
}
pub fn staged(id: &str) -> bool {
    matches!(id, "osEnabled" | "osFactor")
}

/// Scalar controls without routing, model, calibration or latency changes.
/// Qualified separately from prepared structural transitions.
pub fn live_writable(id: &str) -> bool {
    matches!(
        id,
        "inputLevel"
            | "outputLevel"
            | "toneBass"
            | "toneMid"
            | "toneTreble"
            | "toneEqEnabled"
            | "gateEnabled"
            | "gateThreshold"
            | "gateRelease"
            | "gateHold"
            | "gateRange"
    )
}
