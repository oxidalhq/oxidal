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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spectrum: Option<Spectrum>,
    #[serde(default)]
    pub solo: Solo,
    pub tuner_enabled: bool,
    pub tuner: Option<TunerReading>,
    pub balance: Measurement,
    pub alignment: Measurement,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Spectrum {
    pub block_id: String,
    pub bins: Vec<f64>,
}
impl Spectrum {
    pub fn valid(&self) -> bool {
        !self.block_id.is_empty()
            && self.block_id.len() <= 128
            && !self.block_id.chars().any(char::is_control)
            && self.bins.len() == 64
            && self
                .bins
                .iter()
                .all(|b| b.is_finite() && (-100.0..=0.0).contains(b))
    }
}
impl State {
    pub fn measuring(&self) -> bool {
        self.balance.state == Phase::Listening || self.alignment.state == Phase::Listening
    }
    pub fn active(&self) -> bool {
        self.tuner_enabled || self.measuring() || self.spectrum.is_some()
    }
    pub fn valid(&self) -> bool {
        self.spectrum.as_ref().is_none_or(Spectrum::valid)
            && self.tuner.as_ref().is_none_or(|r| {
                r.frequency.is_finite()
                    && (0.0..=24000.0).contains(&r.frequency)
                    && r.confidence.is_finite()
                    && (0.0..=1.0).contains(&r.confidence)
                    && r.level.is_finite()
            })
            && [&self.balance, &self.alignment].iter().all(|m| {
                m.progress.is_finite()
                    && (0.0..=1.0).contains(&m.progress)
                    && [m.matched_db, m.matched_ms, m.confidence, m.peak_sharpness]
                        .into_iter()
                        .flatten()
                        .all(f64::is_finite)
            })
            && self
                .error
                .as_ref()
                .is_none_or(|e| e.len() <= 1024 && !e.chars().any(char::is_control))
    }
}

/// Device/session utilities, deliberately outside native or portable tone state.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostUtility {
    HearYourself { enabled: bool },
    TestTone,
    StopTestTone,
}
pub const fn hear_yourself_default() -> bool {
    true
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HostState {
    pub hear_yourself: bool,
    pub test_tone_active: bool,
}
#[derive(Debug)]
pub struct HostSignal {
    hear: bool,
    rate: u32,
    test_frame: u32,
    test_active: bool,
}
impl HostSignal {
    pub fn new(rate: u32, hear: bool) -> Self {
        Self {
            hear,
            rate,
            test_frame: 0,
            test_active: false,
        }
    }
    pub fn command(&mut self, command: HostUtility) {
        match command {
            HostUtility::HearYourself { enabled } => self.hear = enabled,
            HostUtility::TestTone => {
                if !self.test_active {
                    self.test_frame = 0;
                    self.test_active = true;
                }
            }
            HostUtility::StopTestTone => self.test_active = false,
        }
    }
    pub fn state(&self) -> HostState {
        HostState {
            hear_yourself: self.hear,
            test_tone_active: self.test_active,
        }
    }
    pub fn input(&self, left: &mut [f32], right: &mut [f32]) {
        if !self.hear {
            left.fill(0.0);
            right.fill(0.0);
        }
    }
    pub fn output(&mut self, left: &mut [f32], right: &mut [f32]) {
        if !self.test_active {
            return;
        }
        // Half a second at -30 dBFS, with 10 ms ramps, generated after the rig.
        // The frame clock is independent of block boundaries and browser timing.
        let end = self.rate / 2;
        let ramp = (self.rate / 100).max(1);
        for (left, right) in left.iter_mut().zip(right) {
            if self.test_frame >= end {
                self.test_active = false;
                break;
            }
            let frame = self.test_frame;
            let envelope = (frame.min(end.saturating_sub(1 + frame)) as f64 / ramp as f64).min(1.0);
            let sample = (std::f64::consts::TAU * 440.0 * frame as f64 / self.rate as f64).sin()
                * 0.03162277660168379
                * envelope;
            *left += sample as f32;
            *right += sample as f32;
            self.test_frame += 1;
        }
        if self.test_frame >= end {
            self.test_active = false;
        }
    }
}
#[cfg(test)]
mod host_tests {
    use super::*;
    #[test]
    fn input_monitor_and_output_test_are_independent_bounded_and_sample_clocked() {
        for rate in [44100, 48000, 96000] {
            let mut signal = HostSignal::new(rate, true);
            let (mut l, mut r) = ([0.1; 127], [0.2; 127]);
            signal.input(&mut l, &mut r);
            assert_eq!(l, [0.1; 127]);
            signal.output(&mut l, &mut r);
            assert_eq!(r, [0.2; 127]);
            signal.command(HostUtility::HearYourself { enabled: false });
            signal.input(&mut l, &mut r);
            assert_eq!(l, [0.0; 127]);
            assert_eq!(r, [0.0; 127]);
            signal.command(HostUtility::TestTone);
            let mut frames = 0;
            let mut peak = 0.0f32;
            let mut energy = 0.0;
            while signal.state().test_tone_active {
                l.fill(0.0);
                r.fill(0.0);
                signal.output(&mut l, &mut r);
                frames += 127;
                for (a, b) in l.iter().zip(&r) {
                    assert_eq!(a, b);
                    peak = peak.max(a.abs());
                    energy += a * a;
                }
            }
            assert!(frames >= rate / 2 && frames < rate / 2 + 127);
            assert!((0.03..=0.031623).contains(&peak));
            assert!(energy > 1.0);
            l.fill(0.0);
            r.fill(0.0);
            signal.output(&mut l, &mut r);
            assert_eq!(l, [0.0; 127]);
            assert!(!signal.state().hear_yourself);
            signal.command(HostUtility::TestTone);
            signal.command(HostUtility::StopTestTone);
            assert!(!signal.state().test_tone_active);
        }
    }
}
