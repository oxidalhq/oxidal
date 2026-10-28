//! Shared confirmed native EQ state for playback, recovery and export.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub kind: EqType,
    pub freq_hz: f64,
    pub gain_db: f64,
    pub q: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EqType {
    Lowcut,
    Lowshelf,
    Bell,
    Highshelf,
    Highcut,
}
/// Exact per-block EQ readback, retained independently of scalar controls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BlockEqState {
    pub block_id: String,
    pub eq: EqState,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EqState {
    pub enabled: bool,
    pub pre: bool,
    pub bands: [EqBand; 6],
}
impl EqBand {
    pub fn valid(&self, index: usize) -> bool {
        let role = match index {
            0 => matches!(self.kind, EqType::Lowcut | EqType::Lowshelf),
            1..=4 => matches!(self.kind, EqType::Bell),
            5 => matches!(self.kind, EqType::Highshelf | EqType::Highcut),
            _ => false,
        };
        role && self.freq_hz.is_finite()
            && (20.0..=20000.0).contains(&self.freq_hz)
            && self.gain_db.is_finite()
            && (-15.0..=15.0).contains(&self.gain_db)
            && self.q.is_finite()
            && (0.1..=10.0).contains(&self.q)
    }
}
impl BlockEqState {
    pub fn valid(&self) -> bool {
        !self.block_id.is_empty()
            && self.block_id.len() <= 128
            && !self.block_id.chars().any(char::is_control)
            && self.eq.bands.iter().enumerate().all(|(i, b)| b.valid(i))
    }
}
pub fn valid_snapshot(states: &[BlockEqState]) -> bool {
    states
        .iter()
        .enumerate()
        .all(|(i, s)| s.valid() && states[..i].iter().all(|p| p.block_id != s.block_id))
}
