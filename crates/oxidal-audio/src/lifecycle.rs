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
    /// Confirmed controls of the sounding worker; cleared whenever it stops.
    pub controls: Vec<LiveControl>,
    /// Session edits are not written back to the immutable starting preset.
    pub modified: bool,
    pub preset_name: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AudioAction {
    Start { settings: StartAudio },
    Stop,
    Restart,
    SetBoot { enabled: bool },
    SetControl { target: String, value: f32 },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: AudioAction,
}

/// Native playback controls use normalized values; display text comes from the DSP.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LiveControl {
    pub target: String,
    pub label: String,
    pub value: f32,
    pub display: String,
    pub toggle: bool,
}
impl LiveControl {
    pub fn accepts(&self, value: f32) -> bool {
        value.is_finite()
            && (0.0..=1.0).contains(&value)
            && (!self.toggle || value == 0.0 || value == 1.0)
    }
    pub fn valid(&self) -> bool {
        !self.target.is_empty()
            && self.target.len() <= 200
            && self.label.len() <= 256
            && self.display.len() <= 128
            && self.accepts(self.value)
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveRequest {
    pub serial: u64,
    pub target: String,
    pub value: f32,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlaybackEvent {
    Ready {
        preset_name: String,
        controls: Vec<LiveControl>,
    },
    Control {
        serial: u64,
        controls: Vec<LiveControl>,
        error: Option<String>,
    },
    Meter {
        snapshot: crate::meter::Snapshot,
    },
}
pub fn valid_controls(controls: &[LiveControl]) -> bool {
    !controls.is_empty()
        && controls.len() <= 256
        && controls.iter().all(LiveControl::valid)
        && controls
            .iter()
            .enumerate()
            .all(|(i, c)| controls[..i].iter().all(|p| p.target != c.target))
}
