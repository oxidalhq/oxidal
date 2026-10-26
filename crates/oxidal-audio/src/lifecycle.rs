//! Playback control contract. Authoring has a separate lifetime and process.
use crate::StreamConfig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartAudio {
    pub stream: StreamConfig,
    /// Immutable imported/owned preset identity, never a browser-supplied file path.
    pub preset_id: String,
    pub owned: bool,
}
impl StartAudio {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        if self.preset_id.len() != 64 || !self.preset_id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Select a saved preset before starting audio".into());
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AudioPhase {
    Unavailable,
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioState {
    pub session: String,
    pub revision: u64,
    pub phase: AudioPhase,
    pub configured: Option<StartAudio>,
    pub error: Option<String>,
    /// Remains true until the worker is reaped, including failed shutdowns.
    pub device_owned: bool,
    pub experimental: bool,
    /// Explicitly opt in to restoring this saved preset/device configuration after daemon startup.
    pub start_on_boot: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AudioAction {
    Start { settings: StartAudio },
    Stop,
    Restart,
    SetBoot { enabled: bool },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: AudioAction,
}
