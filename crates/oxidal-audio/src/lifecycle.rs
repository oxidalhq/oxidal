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
    /// An immutable working base created locally, separate from imported/saved libraries.
    #[serde(default)]
    pub draft: bool,
}
impl StartAudio {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        if self.draft && self.owned {
            return Err("Ambiguous preset source".into());
        }
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
    /// Shared boot policy failure; clearing it never requires a working audio device.
    pub boot_error: Option<String>,
    /// Explicitly opt in to restoring the captured confirmed session after daemon startup.
    pub start_on_boot: bool,
    /// Confirmed controls of the sounding worker; cleared whenever it stops.
    pub controls: Vec<LiveControl>,
    /// Session edits are not written back to the immutable starting preset.
    pub modified: bool,
    pub preset_name: Option<String>,
    /// Last copy saved from this exact control revision; restart still uses configured.
    pub saved_copy: Option<String>,
    #[serde(default)]
    pub models: Vec<ModelAssignment>,
    #[serde(default)]
    pub model_change: Option<ModelProgress>,
    #[serde(default)]
    pub slots: Vec<NativeSlot>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AudioAction {
    Create {
        stream: StreamConfig,
        name: String,
    },
    Start {
        settings: StartAudio,
    },
    Stop,
    Restart,
    Resume,
    /// Restart the same tone with new device settings, retaining confirmed scalar edits.
    Reconfigure {
        stream: StreamConfig,
    },
    SetBoot {
        enabled: bool,
    },
    SetControl {
        target: String,
        value: f32,
    },
    ReplaceModel {
        assignment: ModelAssignment,
    },
    CancelModel {
        request: u64,
    },
    SaveCopy {
        name: String,
    },
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
        slots: Vec<NativeSlot>,
    },
    Control {
        serial: u64,
        controls: Vec<LiveControl>,
        error: Option<String>,
    },
    Model {
        serial: u64,
        progress: Option<ModelProgress>,
        controls: Vec<LiveControl>,
        slots: Vec<NativeSlot>,
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

/// Supervisor-owned startup envelope. Restore confirmed scalar edits before PCM
/// opens; this is not an untrusted preset state or a prepared graph transition.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaybackStart {
    pub settings: StartAudio,
    #[serde(default)]
    pub models: Vec<ModelAssignment>,
    pub controls: Option<Vec<LiveControl>>,
}

/// Immutable reconstruction request for a separate, non-PCM export worker.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePlayback {
    pub settings: StartAudio,
    #[serde(default)]
    pub models: Vec<ModelAssignment>,
    pub controls: Vec<LiveControl>,
    pub name: String,
}
pub fn valid_preset_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 100 && !name.chars().any(char::is_control)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SlotPosition {
    pub lane: u8,
    pub index: u32,
}
impl SlotPosition {
    pub fn valid(&self) -> bool {
        self.lane < 2 && self.index < 128
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NativeSlot {
    pub target: String,
    pub position: SlotPosition,
}
pub fn valid_slots(slots: &[NativeSlot]) -> bool {
    slots.len() <= 256
        && slots.iter().enumerate().all(|(i, s)| {
            !s.target.is_empty()
                && s.target.len() <= 128
                && !s.target.chars().any(char::is_control)
                && s.position.valid()
                && slots[..i]
                    .iter()
                    .all(|p| p.target != s.target && p.position != s.position)
        })
}
/// Immutable verified asset assigned to a native block. Insert position is issued
/// by the playback owner, preserving replay order from the immutable working base.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelAssignment {
    pub target: String,
    pub asset: String,
    #[serde(default)]
    pub insertion: Option<SlotPosition>,
}
impl ModelAssignment {
    pub fn valid(&self) -> bool {
        self.insertion.as_ref().is_none_or(SlotPosition::valid)
            && !self.target.is_empty()
            && self.target.len() <= 128
            && !self.target.chars().any(char::is_control)
            && self.asset.len() == 64
            && self
                .asset
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }
}
pub fn valid_models(models: &[ModelAssignment]) -> bool {
    models.len() <= 32
        && models
            .iter()
            .enumerate()
            .all(|(i, m)| m.valid() && models[..i].iter().all(|p| p.target != m.target))
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelPhase {
    Verifying,
    Preparing,
    Ready,
    Applying,
    Applied,
    Failed,
    Cancelled,
}
impl ModelPhase {
    pub fn pending(self) -> bool {
        matches!(
            self,
            Self::Verifying | Self::Preparing | Self::Ready | Self::Applying
        )
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelProgress {
    /// Start-command serial within the audio session; rejects cancellation of a newer selection.
    pub request: u64,
    pub assignment: ModelAssignment,
    pub phase: ModelPhase,
    pub error: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModelOperation {
    Prepare { assignment: ModelAssignment },
    Poll,
    Commit,
    Cancel,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelRequest {
    pub serial: u64,
    pub model: ModelOperation,
}
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum WorkerRequest {
    Control(LiveRequest),
    Model(ModelRequest),
}
