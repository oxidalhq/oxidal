//! Shared confirmed native EQ state for playback, recovery and export.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub kind: EqType,
    pub freq_hz: f64,
    pub gain_db: f64,
    pub q: f64,
}
// Native storage is float; JUCE JSON text may round its double promotion.
// Compare exact native values, never a broad audio/parameter epsilon.
impl PartialEq for EqBand {
    fn eq(&self, other: &Self) -> bool {
        self.kind == other.kind
            && self.freq_hz as f32 == other.freq_hz as f32
            && self.gain_db as f32 == other.gain_db as f32
            && self.q as f32 == other.q as f32
    }
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
impl Default for EqState {
    fn default() -> Self {
        Self {
            enabled: true,
            pre: false,
            bands: [
                (EqType::Lowshelf, 100.0, 0.71),
                (EqType::Bell, 250.0, 1.0),
                (EqType::Bell, 650.0, 1.0),
                (EqType::Bell, 1600.0, 1.0),
                (EqType::Bell, 3500.0, 1.4),
                (EqType::Highshelf, 8000.0, 0.71),
            ]
            .map(|(kind, freq_hz, q)| EqBand {
                kind,
                freq_hz,
                gain_db: 0.0,
                q: f64::from(q as f32),
            }),
        }
    }
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
    crate::lifecycle::catalog_fits(states)
        && states
            .iter()
            .enumerate()
            .all(|(i, s)| s.valid() && states[..i].iter().all(|p| p.block_id != s.block_id))
}

/// One immediate, revision-owned edit; UI cancellation sends its original value.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EqEdit {
    Reset,
    Enabled { value: bool },
    Pre { value: bool },
    Band { index: u8, band: EqBand },
}
impl EqEdit {
    pub fn apply(&self, state: &mut EqState) -> Result<(), String> {
        match self {
            Self::Reset => *state = EqState::default(),
            Self::Enabled { value } => state.enabled = *value,
            Self::Pre { value } => state.pre = *value,
            Self::Band { index, band } if band.valid(usize::from(*index)) => {
                state.bands[usize::from(*index)] = EqBand {
                    kind: band.kind.clone(),
                    freq_hz: f64::from(band.freq_hz as f32),
                    gain_db: f64::from(band.gain_db as f32),
                    q: f64::from(band.q as f32),
                }
            }
            _ => return Err("Invalid EQ band".into()),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_validate_before_mutation_and_match_native_float_storage() {
        let mut state = EqState {
            enabled: false,
            pre: false,
            bands: std::array::from_fn(|i| EqBand {
                kind: match i {
                    0 => EqType::Lowcut,
                    5 => EqType::Highcut,
                    _ => EqType::Bell,
                },
                freq_hz: 1000.0,
                gain_db: 0.0,
                q: 0.7,
            }),
        };
        let mut band = state.bands[1].clone();
        band.gain_db = 0.1;
        EqEdit::Band {
            index: 1,
            band: band.clone(),
        }
        .apply(&mut state)
        .unwrap();
        assert_eq!(state.bands[1].gain_db, f64::from(0.1_f32));
        let mut encoded = state.bands[1].clone();
        encoded.gain_db = 0.100000001490116;
        assert_eq!(encoded, state.bands[1]);
        encoded.gain_db = f64::from(f32::from_bits(0.1_f32.to_bits() + 1));
        assert_ne!(encoded, state.bands[1]);
        let before = state.clone();
        band.freq_hz = f64::NAN;
        assert!(EqEdit::Band { index: 1, band }.apply(&mut state).is_err());
        assert_eq!(state, before);
    }
}
