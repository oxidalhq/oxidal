//! Portable IPC types. Native libraries remain in the child process.
use oxidal_audio::StreamConfig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const REQUEST_LIMIT: usize = 4 * 1024 * 1024;
pub const REPLY_LIMIT: usize = 4 * 1024 * 1024;
/// Host routing buffers only, separate from native/plugin memory.
pub const BUFFER_BUDGET: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Native { node: String, parameter: String },
    Lv2 { node: String, symbol: String },
    Bypass { node: String },
    Merge { node: String, port: usize },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Value {
    pub target: Target,
    pub value: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Control {
    pub target: Target,
    pub label: String,
    pub value: f64,
    pub minimum: f64,
    pub maximum: f64,
    pub integer: bool,
    pub toggle: bool,
    pub logarithmic: bool,
    pub display: String,
}
impl Control {
    pub fn accepts(&self, v: f64) -> bool {
        v.is_finite()
            && (self.minimum..=self.maximum).contains(&v)
            && (!self.integer || v.fract() == 0.0)
            && (!self.toggle || v == self.minimum || v == self.maximum)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    /// Actual scalar values differ from the immutable source bundle.
    pub modified: bool,
    pub session: String,
    pub revision: u64,
    pub source_revision: String,
    pub controls: Vec<Control>,
    pub buffer_bytes: usize,
    /// Reported algorithmic and alignment delay; excludes audio devices/transport.
    pub latency_frames: u32,
}
impl Snapshot {
    pub fn recall(&self) -> Recall {
        Recall {
            source_revision: self.source_revision.clone(),
            values: self
                .controls
                .iter()
                .map(|c| Value {
                    target: c.target.clone(),
                    value: c.value,
                })
                .collect(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Recall {
    pub source_revision: String,
    pub values: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ControlCommand {
    pub session: String,
    pub expected_revision: u64,
    pub target: Target,
    pub value: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartRig {
    pub revision: String,
    pub stream: StreamConfig,
    pub recall: Option<Recall>,
}
impl StartRig {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        let frames = self.stream.input.period_frames;
        if !valid_revision(&self.revision)
            || frames > 2048
            || !frames.is_power_of_two()
            || self
                .recall
                .as_ref()
                .is_some_and(|r| r.source_revision != self.revision)
        {
            return Err("Invalid rig startup".into());
        }
        Ok(())
    }
}
pub fn valid_revision(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkerRequest {
    Status,
    Control { command: ControlCommand },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerReply {
    pub control: Snapshot,
    pub telemetry: oxidal_audio::meter::Snapshot,
    pub processed_frames: u64,
    pub error: Option<String>,
}
/// Terminal worker failure, including preparation before a valid snapshot exists.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerFailure {
    pub failure: String,
}
/// Failure is never promoted to a synthetic control/telemetry snapshot.
pub fn decode_worker_reply(bytes: &[u8]) -> Result<WorkerReply, String> {
    if let Ok(reply) = serde_json::from_slice::<WorkerReply>(bytes) {
        return Ok(reply);
    }
    if let Ok(failure) = serde_json::from_slice::<WorkerFailure>(bytes)
        && !failure.failure.trim().is_empty()
        && failure.failure.len() <= 4096
        && !failure.failure.chars().any(char::is_control)
    {
        return Err(failure.failure);
    }
    Err("Invalid mixed worker protocol".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    pub settings: StartRig,
    pub recall: Recall,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveState {
    pub source_session: String,
    pub source_control_revision: u64,
    pub running: bool,
    pub saved_revision: Option<String>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigAudioState {
    pub start_on_boot: bool,
    /// Checkpoint failure is separate from playback state and command authority.
    pub recovery_error: Option<String>,
    pub session: String,
    pub revision: u64,
    pub phase: oxidal_audio::lifecycle::AudioPhase,
    pub configured: Option<StartRig>,
    pub control: Option<Snapshot>,
    pub telemetry: Option<oxidal_audio::meter::Snapshot>,
    pub processed_frames: u64,
    pub device_owned: bool,
    pub error: Option<String>,
    pub save: Option<SaveState>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RigAudioAction {
    SetBoot { enabled: bool },
    Start { settings: Box<StartRig> },
    Stop,
    Restart,
    Reconfigure { stream: oxidal_audio::StreamConfig },
    Control { command: ControlCommand },
    Save { name: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigAudioCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: RigAudioAction,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_failures_preserve_reason_without_fake_readback() {
        assert_eq!(
            decode_worker_reply(br#"{"failure":"Unsupported cab encoding"}"#).unwrap_err(),
            "Unsupported cab encoding"
        );
        for value in [
            serde_json::json!({"failure":""}),
            serde_json::json!({"failure":"bad\nmessage"}),
            serde_json::json!({"failure":"x".repeat(4097)}),
            serde_json::json!({"failure":"ignored", "control":{}}),
        ] {
            assert_eq!(
                decode_worker_reply(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
                "Invalid mixed worker protocol"
            );
        }
    }
}
