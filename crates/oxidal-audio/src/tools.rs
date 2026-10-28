//! Native utility state, separate from portable tone settings.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Solo {
    #[default]
    None,
    Left,
    Right,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Solo { side: Solo },
    Tuner { enabled: bool },
    Balance,
    Align,
    Cancel,
    Poll,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TunerReading {
    pub frequency: f64,
    pub confidence: f64,
    pub level: f64,
}
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Listening,
    Done,
    Timeout,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Measurement {
    pub state: Phase,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub matched_db: Option<f64>,
    #[serde(default)]
    pub matched_ms: Option<f64>,
    #[serde(default)]
    pub polarity_flipped: Option<bool>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub peak_sharpness: Option<f64>,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct State {
    #[serde(default)]
    pub solo: Solo,
    pub tuner_enabled: bool,
    pub tuner: Option<TunerReading>,
    pub balance: Measurement,
    pub alignment: Measurement,
    pub error: Option<String>,
}
impl State {
    pub fn measuring(&self) -> bool {
        self.balance.state == Phase::Listening || self.alignment.state == Phase::Listening
    }
    pub fn active(&self) -> bool {
        self.tuner_enabled || self.measuring()
    }
    pub fn valid(&self) -> bool {
        self.tuner.as_ref().is_none_or(|r| {
            r.frequency.is_finite()
                && (0.0..=24000.0).contains(&r.frequency)
                && r.confidence.is_finite()
                && (0.0..=1.0).contains(&r.confidence)
                && r.level.is_finite()
        }) && [&self.balance, &self.alignment].iter().all(|m| {
            m.progress.is_finite()
                && (0.0..=1.0).contains(&m.progress)
                && [m.matched_db, m.matched_ms, m.confidence, m.peak_sharpness]
                    .into_iter()
                    .flatten()
                    .all(f64::is_finite)
        }) && self
            .error
            .as_ref()
            .is_none_or(|e| e.len() <= 1024 && !e.chars().any(char::is_control))
    }
}
