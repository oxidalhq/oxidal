//! Playback control contract. Authoring has a separate lifetime and process.
use crate::{
    StreamConfig,
    eq::{BlockEqState, EqEdit},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Shared startup/readback/export/recovery frame budget, including its newline.
/// This bounds serialized control state, not DSP memory or model count.
pub const PLAYBACK_FRAME_BYTES: usize = 4 * 1024 * 1024;
/// Each catalog reserves a bounded share of the common transport/recovery budget.
pub const CATALOG_BYTES: usize = PLAYBACK_FRAME_BYTES / 8;
pub fn catalog_fits<T: Serialize + ?Sized>(value: &T) -> bool {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .filter(|n| *n <= CATALOG_BYTES)
                .ok_or_else(|| std::io::Error::other("Catalog byte budget exceeded"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(0), value).is_ok()
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartAudio {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub midi: Option<crate::midi::Settings>,
    pub stream: StreamConfig,
    /// Immutable imported/owned preset identity, never a browser-supplied file path.
    pub preset_id: String,
    pub owned: bool,
    /// An immutable working base created locally, separate from imported/saved libraries.
    #[serde(default)]
    pub draft: bool,
    /// Verified local authoring checkpoint tied to this immutable preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working: Option<String>,
}
impl StartAudio {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        if let Some(midi) = &self.midi {
            midi.validate()?;
            if !midi.bindings.is_empty() || !midi.branch_bindings.is_empty() {
                return Err("Standalone native MIDI supports parameter mappings".into());
            }
        }
        if self
            .working
            .as_deref()
            .is_some_and(|id| !crate::structure::valid_receipt(id))
        {
            return Err("Invalid native working receipt".into());
        }
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
    #[serde(default)]
    pub midi: crate::midi::Status,
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
    #[serde(default)]
    pub eq: Vec<BlockEqState>,
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
    pub authoring: Option<crate::structure::AuthoringStatus>,
    #[serde(default)]
    pub slots: Vec<NativeSlot>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AudioAction {
    HostUtility {
        command: crate::tools::HostUtility,
    },
    Midi {
        settings: Option<crate::midi::Settings>,
    },
    Create {
        stream: StreamConfig,
        name: String,
    },
    Start {
        settings: StartAudio,
    },
    /// Load a saved native rig using the current device setup, retaining per-rig edits.
    LoadPreset {
        preset_id: String,
        owned: bool,
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
    SetEq {
        block_id: String,
        edit: EqEdit,
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
    Authoring {
        action: crate::structure::AuthoringAction,
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
    HostUtility {
        serial: u64,
        telemetry: crate::meter::Snapshot,
    },
    Midi {
        serial: u64,
        status: crate::midi::Status,
        controls: Option<Vec<LiveControl>>,
        error: Option<String>,
    },
    Ready {
        preset_name: String,
        #[serde(default)]
        authoring: Option<crate::structure::AuthoringStatus>,
        controls: Vec<LiveControl>,
        slots: Vec<NativeSlot>,
        eq: Vec<BlockEqState>,
    },
    Eq {
        serial: u64,
        eq: Vec<BlockEqState>,
        error: Option<String>,
    },
    Control {
        serial: u64,
        controls: Vec<LiveControl>,
        error: Option<String>,
    },
    Model {
        serial: u64,
        #[serde(default)]
        authoring: Option<crate::structure::AuthoringStatus>,
        progress: Option<ModelProgress>,
        controls: Vec<LiveControl>,
        slots: Vec<NativeSlot>,
        eq: Vec<BlockEqState>,
        error: Option<String>,
    },
    Authored {
        serial: u64,
        authoring: crate::structure::AuthoringStatus,
        controls: Vec<LiveControl>,
        slots: Vec<NativeSlot>,
        eq: Vec<BlockEqState>,
        error: Option<String>,
    },
    Meter {
        snapshot: crate::meter::Snapshot,
    },
}
pub fn valid_controls(controls: &[LiveControl]) -> bool {
    !controls.is_empty()
        && catalog_fits(controls)
        && controls.iter().all(LiveControl::valid)
        && controls
            .iter()
            .map(|c| &c.target)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            == controls.len()
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
    #[serde(default)]
    pub eq: Option<Vec<BlockEqState>>,
}

/// Immutable reconstruction request for a separate, non-PCM export worker.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePlayback {
    pub settings: StartAudio,
    #[serde(default)]
    pub models: Vec<ModelAssignment>,
    pub controls: Vec<LiveControl>,
    #[serde(default)]
    pub eq: Option<Vec<BlockEqState>>,
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
        self.lane < 2 && self.index <= i32::MAX as u32
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NativeSlot {
    pub target: String,
    pub position: SlotPosition,
}
pub fn valid_slots(slots: &[NativeSlot]) -> bool {
    catalog_fits(slots)
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
    catalog_fits(models)
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
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
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
    HostUtility(HostUtilityRequest),
    Midi(MidiRequest),
    Authoring(crate::structure::AuthoringRequest),
    Eq(EqRequest),
    Control(LiveRequest),
    Model(ModelRequest),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EqRequest {
    pub serial: u64,
    pub block_id: String,
    pub eq: EqEdit,
}

#[cfg(test)]
mod budget_tests {
    use super::*;
    #[test]
    fn catalogs_use_bytes_instead_of_fixed_instance_counts() {
        let mut models: Vec<_> = (0..100)
            .map(|i| ModelAssignment {
                target: format!("model-{i}"),
                asset: "a".repeat(64),
                insertion: None,
            })
            .collect();
        assert!(valid_models(&models));
        models.push(models[0].clone());
        assert!(!valid_models(&models));
        let controls: Vec<_> = (0..300)
            .map(|i| LiveControl {
                target: format!("control-{i}"),
                label: "Gain".into(),
                display: "0 dB".into(),
                value: 0.5,
                toggle: false,
            })
            .collect();
        assert!(valid_controls(&controls));
        let slots: Vec<_> = (0..300)
            .map(|i| NativeSlot {
                target: format!("slot-{i}"),
                position: SlotPosition { lane: 0, index: i },
            })
            .collect();
        assert!(valid_slots(&slots));
        assert!(!catalog_fits(&"x".repeat(CATALOG_BYTES)));
        assert!(!catalog_fits(&"\n".repeat(CATALOG_BYTES / 2)));
        let oversized: Vec<_> = (0..5000)
            .map(|i| ModelAssignment {
                target: format!("model-{i}"),
                asset: "a".repeat(64),
                insertion: None,
            })
            .collect();
        assert!(!valid_models(&oversized));
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MidiOperation {
    Configure {
        settings: Option<crate::midi::Settings>,
    },
    Poll,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiRequest {
    pub serial: u64,
    pub midi: MidiOperation,
}
impl LiveControl {
    pub fn midi_descriptor(&self) -> crate::midi::MappedControl {
        crate::midi::MappedControl {
            value: f64::from(self.value),
            minimum: 0.0,
            maximum: 1.0,
            integer: self.toggle,
            toggle: self.toggle,
            logarithmic: false,
        }
    }
}
impl crate::midi::Settings {
    pub fn validate_native(&self, controls: &[LiveControl]) -> Result<(), String> {
        self.validate_native_inner(controls, false)
    }
    /// Preserve a saved unavailable target as inert configuration after deletion.
    pub fn validate_native_restore(&self, controls: &[LiveControl]) -> Result<(), String> {
        self.validate_native_inner(controls, true)
    }
    fn validate_native_inner(
        &self,
        controls: &[LiveControl],
        allow_unavailable: bool,
    ) -> Result<(), String> {
        self.validate()?;
        if !self.bindings.is_empty() || !self.branch_bindings.is_empty() {
            return Err("Standalone native MIDI supports parameter mappings".into());
        }
        for binding in &self.parameter_bindings {
            let crate::midi::ControlTarget::Native { node, parameter } = &binding.target else {
                return Err("Standalone native MIDI needs a native parameter".into());
            };
            if node != "native" {
                return Err("Unknown standalone native MIDI node".into());
            }
            let Some(control) = controls.iter().find(|c| c.target == *parameter) else {
                if allow_unavailable {
                    continue;
                }
                return Err("MIDI parameter is unavailable".into());
            };
            control.midi_descriptor().midi_value(binding.mode, 127)?;
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostUtilityRequest {
    pub serial: u64,
    pub host_utility: crate::tools::HostUtility,
}
