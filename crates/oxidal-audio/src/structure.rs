//! Shared native authoring contract; no native library dependency.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[repr(i32)]
pub enum InputMode {
    #[default]
    Stereo = 0,
    Left = 1,
    Right = 2,
    #[serde(rename = "dual")]
    DualMono = 3,
}
/// Exact native lane order, including insertion tiles. No provider credentials or model paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChainBlock {
    pub id: String,
    pub insert: bool,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChainLayout {
    pub stereo: bool,
    #[serde(default)]
    pub input_mode: InputMode,
    pub left: Vec<ChainBlock>,
    pub right: Vec<ChainBlock>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChainLane {
    Left,
    Right,
}
impl ChainLane {
    pub fn name(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StructureEdit {
    Reset,
    Swap,
    Paste {
        lane: ChainLane,
        index: usize,
    },
    Input {
        mode: InputMode,
    },
    Reorder {
        lane: ChainLane,
        block_ids: Vec<String>,
    },
    Move {
        block_id: String,
        lane: ChainLane,
        index: usize,
    },
    Duplicate {
        block_id: String,
        lane: ChainLane,
        index: usize,
    },
    Stereo {
        enabled: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AuthoringAction {
    Utility { command: crate::tools::Command },
    Copy { block_id: String },
    Inspect,
    Parameter { parameter: String, value: f32 },
    Edit { edit: StructureEdit },
    Remove { block_id: String },
    Undo,
    Redo,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthoringStatus {
    pub layout: ChainLayout,
    #[serde(default)]
    pub tools: crate::tools::State,
    #[serde(default)]
    pub settings: Vec<crate::lifecycle::LiveControl>,
    #[serde(default)]
    pub setting_steps: std::collections::BTreeMap<String, f32>,
    #[serde(default)]
    pub can_paste: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    /// Immutable local working-state receipt; never a file path or portable preset.
    pub working: Option<String>,
}
impl AuthoringStatus {
    pub fn valid(&self) -> bool {
        let blocks: Vec<_> = self.layout.left.iter().chain(&self.layout.right).collect();
        self.tools.valid()
            && crate::lifecycle::catalog_fits(self)
            && (self.settings.is_empty() || crate::lifecycle::valid_controls(&self.settings))
            && self.setting_steps.len() == self.settings.len()
            && self.settings.iter().all(|p| {
                self.setting_steps
                    .get(&p.target)
                    .is_some_and(|step| step.is_finite() && *step > 0.0 && *step <= 1.0)
            })
            && self.working.as_deref().is_none_or(valid_receipt)
            && blocks.iter().enumerate().all(|(i, b)| {
                !b.id.is_empty()
                    && b.id.len() <= 128
                    && !b.id.chars().any(char::is_control)
                    && blocks[..i].iter().all(|a| a.id != b.id)
            })
    }
}
pub fn valid_receipt(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoringRequest {
    pub serial: u64,
    pub authoring: AuthoringAction,
}

/// A separate preparation child reconstructs the confirmed playing session before
/// changing a setting which may alter latency or allocate DSP resources.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrepareParameter {
    pub playback: crate::lifecycle::SavePlayback,
    pub parameter: String,
    pub value: f32,
}

impl AuthoringAction {
    pub fn changes_tone(&self) -> bool {
        !matches!(
            self,
            Self::Inspect | Self::Copy { .. } | Self::Utility { .. }
        )
    }
}
