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
    pub can_undo: bool,
    pub can_redo: bool,
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
    RemoveBlock {
        block_id: String,
    },
    Undo,
    Redo,
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

/// Typed operations from the preserved PiPedal/TONE3000 stage bridge. Tokens
/// belong to the caller's confirmed gesture, never arbitrary native method names.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StageAction {
    Runtime,
    AutoBalance,
    AutoAlign,
    Cancel,
    MeasureOutput { seconds: f64 },
    LinkedPan { side: PanSide, value: f64 },
    ExclusiveSolo { side: SoloSide },
    BlockEdit { edit: BlockEdit },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PanSide {
    Left,
    Right,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SoloSide {
    Left,
    Right,
    None,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EditPhase {
    Preview,
    Commit,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BlockEdit {
    Param {
        phase: EditPhase,
        #[serde(rename = "blockId")]
        block_id: String,
        param: String,
        value: f64,
    },
    EqEnabled {
        phase: EditPhase,
        #[serde(rename = "blockId")]
        block_id: String,
        value: bool,
    },
    EqPre {
        phase: EditPhase,
        #[serde(rename = "blockId")]
        block_id: String,
        value: bool,
    },
    EqBand {
        phase: EditPhase,
        #[serde(rename = "blockId")]
        block_id: String,
        index: u8,
        band: EqBand,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub kind: EqType,
    pub freq_hz: f64,
    pub gain_db: f64,
    pub q: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EqType {
    Lowcut,
    Lowshelf,
    Bell,
    Highshelf,
    Highcut,
}
#[cfg(any(feature = "native", test))]
impl StageAction {
    pub(crate) fn encode(&self) -> Result<(u32, Vec<u8>), String> {
        use serde_json::json;
        let (command, payload) = match self {
            Self::Runtime => (1, None),
            Self::AutoBalance => (2, None),
            Self::AutoAlign => (3, None),
            Self::Cancel => (4, None),
            Self::MeasureOutput { seconds }
                if seconds.is_finite() && (1.0..=10.0).contains(seconds) =>
            {
                (5, Some(json!({"seconds": seconds})))
            }
            Self::LinkedPan { side, value } if value.is_finite() && (0.0..=1.0).contains(value) => {
                (6, Some(json!({"side":side,"value":value})))
            }
            Self::ExclusiveSolo { side } => (7, Some(json!({"side":side}))),
            Self::BlockEdit { edit } => {
                let valid = match edit {
                    BlockEdit::Param { param, value, .. } => {
                        value.is_finite()
                            && (0.0..=1.0).contains(value)
                            && match param.as_str() {
                                "enabled" | "normalize" => *value == 0.0 || *value == 1.0,
                                "inputGain" | "outputGain" | "mix" => true,
                                _ => false,
                            }
                    }
                    BlockEdit::EqBand { index, band, .. } => {
                        let role = match index {
                            0 => matches!(band.kind, EqType::Lowcut | EqType::Lowshelf),
                            1..=4 => matches!(band.kind, EqType::Bell),
                            5 => matches!(band.kind, EqType::Highshelf | EqType::Highcut),
                            _ => false,
                        };
                        role && band.freq_hz.is_finite()
                            && (20.0..=20000.0).contains(&band.freq_hz)
                            && band.gain_db.is_finite()
                            && (-15.0..=15.0).contains(&band.gain_db)
                            && band.q.is_finite()
                            && (0.1..=10.0).contains(&band.q)
                    }
                    _ => true,
                };
                let id = match edit {
                    BlockEdit::Param { block_id, .. }
                    | BlockEdit::EqEnabled { block_id, .. }
                    | BlockEdit::EqPre { block_id, .. }
                    | BlockEdit::EqBand { block_id, .. } => block_id,
                };
                if !valid || id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
                    return Err("Invalid stage block edit".into());
                }
                (
                    8,
                    Some(serde_json::to_value(edit).map_err(|e| e.to_string())?),
                )
            }
            _ => return Err("Invalid stage operation value".into()),
        };
        Ok((
            command,
            match payload {
                Some(value) => serde_json::to_vec(&value).map_err(|e| e.to_string())?,
                None => vec![],
            },
        ))
    }
}

#[cfg(test)]
mod stage_tests {
    use super::*;
    #[test]
    fn stage_payloads_match_reference_and_reject_invalid_values() {
        let action = StageAction::BlockEdit {
            edit: BlockEdit::EqBand {
                phase: EditPhase::Preview,
                block_id: "block".into(),
                index: 1,
                band: EqBand {
                    kind: EqType::Bell,
                    freq_hz: 1000.0,
                    gain_db: 3.0,
                    q: 0.7,
                },
            },
        };
        let (command, bytes) = action.encode().unwrap();
        assert_eq!(command, 8);
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["kind"], "eqBand");
        assert_eq!(value["blockId"], "block");
        assert_eq!(value["band"]["freqHz"], 1000.0);
        assert!(
            StageAction::MeasureOutput { seconds: f64::NAN }
                .encode()
                .is_err()
        );
        assert!(
            StageAction::LinkedPan {
                side: PanSide::Left,
                value: 1.1
            }
            .encode()
            .is_err()
        );
        let mut invalid = value;
        invalid["index"] = serde_json::json!(0);
        let edit: BlockEdit = serde_json::from_value(invalid).unwrap();
        assert!(StageAction::BlockEdit { edit }.encode().is_err());
        assert_eq!(StageAction::Cancel.encode().unwrap(), (4, vec![]));
    }
}
