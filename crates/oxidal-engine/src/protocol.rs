//! Portable IPC types. Native libraries remain in the child process.
use oxidal_audio::StreamConfig;
use oxidal_lv2::protocol::PluginDefaultsCommand;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BranchState {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub partial: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BranchSleepPhase {
    Playing,
    Priming,
    Draining,
    Asleep,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SleepingBranchState {
    pub branch: String,
    pub phase: BranchSleepPhase,
    pub processors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BranchSleepState {
    pub enabled: bool,
    pub requested_scene: Option<String>,
    pub active_scene: Option<String>,
    pub branches: Vec<SleepingBranchState>,
    pub running_processors: usize,
    pub admitted_processors: usize,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BranchSleepCommand {
    pub session: String,
    pub expected_revision: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BranchCommand {
    pub session: String,
    pub expected_revision: u64,
    pub branch: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StompGroupCommand {
    pub session: String,
    pub expected_revision: u64,
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StompGroupState {
    pub id: String,
    pub name: String,
    pub nodes: Vec<String>,
    /// All targets are on.
    pub enabled: bool,
    /// Some targets are on and others are off.
    pub partial: bool,
}
impl StompGroupState {
    pub(crate) fn read_enabled(&self, controls: &[Control]) -> (bool, bool) {
        let count = self
            .nodes
            .iter()
            .filter(|node| {
                controls.iter().any(|control| {
                    matches!(&control.target, Target::Bypass { node: target } if target == *node)
                        && control.value == 0.0
                })
            })
            .count();
        let enabled = count == self.nodes.len();
        (enabled, count > 0 && !enabled)
    }
}
pub const REQUEST_LIMIT: usize = 4 * 1024 * 1024;
pub const REPLY_LIMIT: usize = 4 * 1024 * 1024;
/// Host routing buffers only, separate from native/plugin memory.
pub const BUFFER_BUDGET: usize = 64 * 1024 * 1024;
#[cfg(feature = "native")]
pub(crate) const WARM_SCENE_BUDGET: usize = 32 * 1024 * 1024;

pub use oxidal_audio::midi::ControlTarget as Target;
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
    /// Named values of an LV2 port (`lv2:scalePoint`), sorted by value, so an
    /// edit dialog can offer "Ping-pong" rather than "2"; empty when none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scale_points: Vec<oxidal_lv2::ScalePoint>,
}
impl Control {
    pub fn midi_value(
        &self,
        mode: oxidal_audio::midi::ControlMode,
        raw: u8,
    ) -> Result<Option<f64>, String> {
        oxidal_audio::midi::MappedControl {
            value: self.value,
            minimum: self.minimum,
            maximum: self.maximum,
            integer: self.integer,
            toggle: self.toggle,
            logarithmic: self.logarithmic,
        }
        .midi_value(mode, raw)
    }
    pub fn accepts(&self, v: f64) -> bool {
        v.is_finite()
            && (self.minimum..=self.maximum).contains(&v)
            && (!self.integer || v.fract() == 0.0)
            && (!self.toggle || v == self.minimum || v == self.maximum)
    }
}
/// EQ belongs to a native graph node and its stable inner block identities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeEq {
    pub node: String,
    pub blocks: Vec<oxidal_audio::eq::BlockEqState>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EqCommand {
    pub session: String,
    pub expected_revision: u64,
    pub node: String,
    pub block_id: String,
    pub edit: oxidal_audio::eq::EqEdit,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeModels {
    pub node: String,
    pub assignments: Vec<oxidal_audio::lifecycle::ModelAssignment>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeSlots {
    pub node: String,
    pub slots: Vec<oxidal_audio::lifecycle::NativeSlot>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeModelChange {
    pub node: String,
    pub progress: oxidal_audio::lifecycle::ModelProgress,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelCommand {
    pub session: String,
    pub expected_revision: u64,
    pub node: String,
    pub operation: oxidal_audio::lifecycle::ModelOperation,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeWorking {
    pub node: String,
    pub receipt: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NodeAuthoring {
    pub node: String,
    pub status: oxidal_audio::structure::AuthoringStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthoringCommand {
    pub session: String,
    pub expected_revision: u64,
    pub node: String,
    pub action: oxidal_audio::structure::AuthoringAction,
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
    #[serde(default)]
    pub eq: Vec<NodeEq>,
    pub buffer_bytes: usize,
    /// Reported algorithmic and alignment delay; excludes audio devices/transport.
    pub latency_frames: u32,
    #[serde(default)]
    pub prepared: Vec<PreparedStatus>,
    #[serde(default)]
    pub models: Vec<NodeModels>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub working: Vec<NodeWorking>,
    #[serde(default)]
    pub authoring: Vec<NodeAuthoring>,
    #[serde(default)]
    pub slots: Vec<NodeSlots>,
    #[serde(default)]
    pub model_change: Option<NodeModelChange>,
    #[serde(default)]
    pub scenes: Option<oxidal_presets::manifest::Scenes>,
    /// Capture control defaults from the immutable saved bundle.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capture_defaults: Vec<oxidal_presets::manifest::SceneNativeControl>,
    /// Confirmed saved-source booleans, present only as a complete catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_bypass_defaults: Option<Vec<oxidal_presets::manifest::SceneNativeBypass>>,
    /// The complete set of warm-prepared scene5 blocks, absent on older scenes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_bypass_armed: Option<Vec<oxidal_presets::manifest::SceneNativeBypassKey>>,
    #[serde(default)]
    pub scene: Option<String>,
    #[serde(default)]
    pub scene_transitioning: bool,
    #[serde(default)]
    pub branches: Vec<BranchState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stomp_groups: Vec<StompGroupState>,
    /// Last named scene selected, even when its saved bypass differs from the live group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stomp_scene: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_sleep: Option<BranchSleepState>,
    #[serde(default)]
    pub midi: oxidal_audio::midi::Status,
}
impl Snapshot {
    pub fn valid_stomp_state(&self) -> bool {
        if self.stomp_groups.is_empty() {
            return self.stomp_scene.is_none();
        }
        let Some(scenes) = &self.scenes else {
            return false;
        };
        let Some(first) = scenes.scenes.first() else {
            return false;
        };
        self.stomp_groups.len() <= oxidal_presets::manifest::MAX_STOMP_GROUPS
            && self.stomp_scene.as_ref().is_none_or(|id| scenes.scenes.iter().any(|s| &s.id == id))
            && self.stomp_groups.iter().enumerate().all(|(i, group)| {
                oxidal_presets::manifest::StompGroup {
                    id: group.id.clone(),
                    name: group.name.clone(),
                    nodes: group.nodes.clone(),
                }.valid()
                    && self.stomp_groups[..i].iter().all(|old| old.id != group.id)
                    && group.nodes.iter().all(|node| {
                        first.bypass.iter().any(|target| &target.node == node)
                            && self.controls.iter().any(|c| {
                                matches!(&c.target, Target::Bypass { node: target } if target == node)
                            })
                    })
                    && group.read_enabled(&self.controls) == (group.enabled, group.partial)
            })
    }
    pub fn valid_branch_sleep_state(&self) -> bool {
        let Some(state) = &self.branch_sleep else {
            return true;
        };
        !state.branches.is_empty()
            && state.branches.len() <= oxidal_presets::manifest::MAX_SLEEP_BRANCHES
            && state.running_processors <= state.admitted_processors
            && state.active_scene == self.scene
            && state.requested_scene.as_ref().is_none_or(|wanted| {
                self.scenes
                    .as_ref()
                    .is_some_and(|scenes| scenes.scenes.iter().any(|s| &s.id == wanted))
            })
            && state.message.as_ref().is_none_or(|message| {
                message.len() <= 1024 && !message.chars().any(char::is_control)
            })
            && state.branches.iter().enumerate().all(|(i, branch)| {
                branch.processors > 0
                    && branch.processors <= state.admitted_processors
                    && self
                        .branches
                        .iter()
                        .any(|declared| declared.id == branch.branch)
                    && state.branches[..i]
                        .iter()
                        .all(|old| old.branch != branch.branch)
            })
    }
    pub fn valid_model_state(&self) -> bool {
        use oxidal_presets::manifest::{MAX_SCENE_BYPASS, SceneNativeBypass};
        if let Some(armed) = &self.native_bypass_armed {
            let Some(scene) = self
                .scenes
                .as_ref()
                .and_then(|scenes| scenes.scenes.first())
            else {
                return false;
            };
            if armed.len() != scene.native_bypass.len()
                || armed.len() + scene.bypass.len() > MAX_SCENE_BYPASS
                || armed.iter().enumerate().any(|(index, key)| {
                    !SceneNativeBypass::valid_block(&key.block)
                        || armed[..index].contains(key)
                        || !scene
                            .native_bypass
                            .iter()
                            .any(|row| row.node == key.node && row.block == key.block)
                })
            {
                return false;
            }
        } else if self.scenes.as_ref().is_some_and(|scenes| {
            scenes
                .scenes
                .iter()
                .any(|scene| !scene.native_bypass.is_empty())
        }) {
            return false;
        }
        let native = |node: &str| {
            self.controls
                .iter()
                .any(|c| matches!(&c.target,Target::Native {node:n,..} if n==node))
        };
        self.working.iter().enumerate().all(|(i, row)| {
            native(&row.node)
                && valid_revision(&row.receipt)
                && self.working[..i].iter().all(|p| p.node != row.node)
        }) && self.authoring.iter().enumerate().all(|(i, row)| {
            native(&row.node)
                && row.status.valid()
                && self.authoring[..i].iter().all(|p| p.node != row.node)
        }) && self.slots.iter().enumerate().all(|(i, s)| {
            native(&s.node)
                && self.slots[..i].iter().all(|p| p.node != s.node)
                && oxidal_audio::lifecycle::valid_slots(&s.slots)
        }) && self.models.iter().enumerate().all(|(i, m)| {
            self.slots.iter().any(|s| s.node == m.node)
                && self.models[..i].iter().all(|p| p.node != m.node)
                && !m.assignments.is_empty()
                && oxidal_audio::lifecycle::valid_models(&m.assignments)
        }) && self.model_change.as_ref().is_none_or(|m| {
            self.slots.iter().any(|s| s.node == m.node)
                && m.progress.assignment.valid()
                && m.progress.request > 0
                && m.progress.request <= self.revision
                && m.progress
                    .error
                    .as_ref()
                    .is_none_or(|e| e.len() <= 1024 && !e.chars().any(char::is_control))
        })
    }
    pub fn recall(&self) -> Recall {
        Recall {
            source_revision: self.source_revision.clone(),
            eq: Some(self.eq.clone()),
            models: self.models.clone(),
            working: self.working.clone(),
            sleep_enabled: self.branch_sleep.as_ref().map(|state| state.enabled),
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
    #[serde(default)]
    pub eq: Option<Vec<NodeEq>>,
    #[serde(default)]
    pub models: Vec<NodeModels>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub working: Vec<NodeWorking>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sleep_enabled: Option<bool>,
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
pub struct SceneCommand {
    pub session: String,
    pub expected_revision: u64,
    pub scene: String,
    /// How long the outgoing scene takes to fade out, in ms (up to 10 s); none
    /// uses the preset's own fade, so delay and reverb tails ring out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_ms: Option<u32>,
    /// Draft values for already armed capture blocks. A regular performance recall uses the saved values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_bypass_preview: Option<Vec<oxidal_presets::manifest::SceneNativeBypass>>,
}
/// Longest blend between scenes.
pub const MAX_RELEASE_MS: u32 = 10_000;
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreparedRecall {
    pub revision: String,
    pub recall: Option<Recall>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreparedStatus {
    pub revision: String,
    pub name: String,
    pub modified: bool,
    pub error: Option<String>,
    /// This alternative is currently transitioning or rendering a tail.
    #[serde(default)]
    pub rendering: bool,
    /// The alternative is rendering only its outgoing return.
    #[serde(default)]
    pub tail: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchCommand {
    pub session: String,
    pub expected_revision: u64,
    pub revision: String,
    pub fade_frames: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartRig {
    pub revision: String,
    pub stream: StreamConfig,
    pub recall: Option<Recall>,
    /// Resident alternatives are prepared before this transport opens PCM.
    #[serde(default)]
    pub prepared: Vec<PreparedRecall>,
    #[serde(default)]
    pub midi: Option<oxidal_audio::midi::Settings>,
}
impl StartRig {
    pub fn validate(&self) -> Result<(), String> {
        self.stream.validate()?;
        if let Some(midi) = &self.midi {
            midi.validate()?;
        }
        let frames = self.stream.input.period_frames;
        if !valid_revision(&self.revision)
            || !oxidal_audio::lifecycle::catalog_fits(&self.prepared)
            || self.prepared.iter().enumerate().any(|(i, p)| {
                !valid_revision(&p.revision)
                    || p.revision == self.revision
                    || self.prepared[..i]
                        .iter()
                        .any(|old| old.revision == p.revision)
                    || p.recall
                        .as_ref()
                        .is_some_and(|r| r.source_revision != p.revision)
            })
            || frames > 2048
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
pub fn valid_copy_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn valid_revision(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
/// One-time startup override for a set-list entry. Ordinary worker input
/// retains the StartRig wire format and the override never changes the bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceStart {
    pub settings: StartRig,
    pub scene: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkerRequest {
    Tempo {
        bpm: Option<f32>,
    },
    RestorePluginDefaults {
        command: PluginDefaultsCommand,
    },
    Protect {
        on: bool,
    },
    HostUtility {
        command: oxidal_audio::tools::HostUtility,
    },
    Authoring {
        command: AuthoringCommand,
    },
    Status,
    SettleAuthoring,
    Control {
        command: ControlCommand,
    },
    Eq {
        command: EqCommand,
    },
    Switch {
        command: SwitchCommand,
    },
    RecallSwitch {
        command: SwitchCommand,
        scene: String,
        midi: Option<oxidal_audio::midi::Settings>,
    },
    Scene {
        command: SceneCommand,
    },
    Branch {
        command: BranchCommand,
    },
    StompGroup {
        command: StompGroupCommand,
    },
    BranchSleep {
        command: BranchSleepCommand,
    },
    Midi {
        settings: Option<oxidal_audio::midi::Settings>,
    },
    MidiTest {
        message: oxidal_audio::midi::Message,
    },
    MidiLearn {
        on: bool,
    },
    Model {
        command: ModelCommand,
    },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_id: Option<String>,
    pub source_session: String,
    pub source_control_revision: u64,
    pub running: bool,
    pub saved_revision: Option<String>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigAudioState {
    /// Startup or a lost session is waiting for its audio interface to be
    /// connected; audio starts by itself when it appears (Sprint 07).
    #[serde(default)]
    pub waiting_for_device: bool,
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
    RestorePluginDefaults {
        command: PluginDefaultsCommand,
    },
    HostUtility {
        command: oxidal_audio::tools::HostUtility,
    },
    Authoring {
        command: AuthoringCommand,
    },
    SetBoot {
        enabled: bool,
    },
    Start {
        settings: Box<StartRig>,
    },
    Stop,
    Restart,
    Reconfigure {
        stream: oxidal_audio::StreamConfig,
    },
    Control {
        command: ControlCommand,
    },
    Eq {
        command: EqCommand,
    },
    Switch {
        command: SwitchCommand,
    },
    Scene {
        command: SceneCommand,
    },
    Branch {
        command: BranchCommand,
    },
    StompGroup {
        command: StompGroupCommand,
    },
    BranchSleep {
        command: BranchSleepCommand,
    },
    Midi {
        settings: Option<oxidal_audio::midi::Settings>,
    },
    MidiTest {
        message: oxidal_audio::midi::Message,
    },
    MidiLearn {
        on: bool,
    },
    Model {
        command: ModelCommand,
    },
    CopyPlaying {
        name: String,
        copy_id: String,
    },
    Save {
        name: String,
    },
    SaveVersion {
        name: String,
        target: oxidal_audio::lifecycle::VersionTarget,
    },
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
    fn midi_scaling_uses_real_ranges_and_encoder_conventions() {
        use oxidal_audio::midi::ControlMode as M;
        let mut c = Control {
            target: Target::Lv2 {
                node: "fx".into(),
                symbol: "gain".into(),
            },
            label: "Gain".into(),
            value: 0.5,
            minimum: 0.0,
            maximum: 1.0,
            integer: false,
            toggle: false,
            logarithmic: false,
            display: String::new(),
            scale_points: Vec::new(),
        };
        assert_eq!(c.midi_value(M::Absolute, 0).unwrap(), Some(0.0));
        assert_eq!(c.midi_value(M::Absolute, 127).unwrap(), Some(1.0));
        assert_eq!(c.midi_value(M::RelativeTwosComplement, 0).unwrap(), None);
        assert_eq!(c.midi_value(M::RelativeOffset64, 64).unwrap(), None);
        assert_eq!(
            c.midi_value(M::RelativeTwosComplement, 1).unwrap(),
            c.midi_value(M::RelativeOffset64, 65).unwrap()
        );
        assert_eq!(
            c.midi_value(M::RelativeTwosComplement, 127).unwrap(),
            c.midi_value(M::RelativeOffset64, 63).unwrap()
        );
        assert!(c.midi_value(M::Toggle, 127).is_err());
        c.minimum = 20.0;
        c.maximum = 20000.0;
        c.value = 200.0;
        c.logarithmic = true;
        let value = c.midi_value(M::Absolute, 64).unwrap().unwrap();
        assert!((value - 20.0_f64 * 1000.0_f64.powf(64.0 / 127.0)).abs() < 1e-9);
        c.minimum = 0.0;
        c.maximum = 3.0;
        c.value = 1.0;
        c.integer = true;
        c.logarithmic = false;
        assert_eq!(c.midi_value(M::Absolute, 64).unwrap(), Some(2.0));
        c.maximum = 1.0;
        c.value = 0.0;
        c.toggle = true;
        assert_eq!(c.midi_value(M::Toggle, 0).unwrap(), None);
        assert_eq!(c.midi_value(M::Toggle, 127).unwrap(), Some(1.0));
        assert_eq!(c.midi_value(M::Absolute, 63).unwrap(), Some(0.0));
        assert!(c.midi_value(M::RelativeOffset64, 65).is_err());
        c.value = f64::NAN;
        assert!(c.midi_value(M::Absolute, 127).is_err());
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrepareNativeEdit {
    pub settings: StartRig,
    pub node: String,
    pub operation: PreparedNativeEdit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreparedNativeEdit {
    Authoring {
        action: oxidal_audio::structure::AuthoringAction,
    },
    Model {
        assignment: oxidal_audio::lifecycle::ModelAssignment,
    },
}

impl Snapshot {
    pub fn validate_midi(&self, settings: &oxidal_audio::midi::Settings) -> Result<(), String> {
        self.validate_midi_inner(settings, false)
    }
    pub fn validate_restored_midi(
        &self,
        settings: &oxidal_audio::midi::Settings,
    ) -> Result<(), String> {
        self.validate_midi_inner(settings, true)
    }
    fn validate_midi_inner(
        &self,
        settings: &oxidal_audio::midi::Settings,
        allow_unavailable: bool,
    ) -> Result<(), String> {
        settings.validate()?;
        if settings.bindings.iter().any(|b| {
            !self
                .scenes
                .as_ref()
                .is_some_and(|s| s.scenes.iter().any(|scene| scene.id == b.scene))
        }) {
            return Err("MIDI binding refers to an unavailable scene".into());
        }
        if settings
            .branch_bindings
            .iter()
            .any(|b| !self.branches.iter().any(|branch| branch.id == b.branch))
        {
            return Err("MIDI binding refers to an unavailable branch".into());
        }
        for binding in &settings.parameter_bindings {
            if let Target::StompGroup { group } = &binding.target {
                if !allow_unavailable && !self.stomp_groups.iter().any(|item| &item.id == group) {
                    return Err("MIDI binding refers to an unavailable stomp group".into());
                }
                continue;
            }
            let Some(control) = self.controls.iter().find(|c| c.target == binding.target) else {
                if allow_unavailable {
                    continue;
                }
                return Err("MIDI binding refers to an unavailable control".into());
            };
            control.midi_value(binding.mode, 127)?;
        }
        Ok(())
    }
}
