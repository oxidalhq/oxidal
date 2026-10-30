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
    Levels { levels: HostLevels },
}
/// Unit-wide gain staging around every rig: guitar input trim before the rig,
/// master output level after it. Never stored in presets.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HostLevels {
    /// Input trim in dB, applied before the rig (−24 to +24).
    pub input_trim_db: f32,
    /// Master output level in dB, applied after the rig (−60 to +12; −60 is silent).
    pub output_level_db: f32,
    /// Sum left and right to both outputs: for mono PAs and for checking that a
    /// wide rig survives mono without thinning out.
    #[serde(default)]
    pub mono: bool,
}
impl HostLevels {
    pub const INPUT_RANGE: (f32, f32) = (-24.0, 24.0);
    pub const OUTPUT_RANGE: (f32, f32) = (-60.0, 12.0);
    pub fn validate(&self) -> Result<(), String> {
        let within = |v: f32, (lo, hi): (f32, f32)| v.is_finite() && (lo..=hi).contains(&v);
        if within(self.input_trim_db, Self::INPUT_RANGE)
            && within(self.output_level_db, Self::OUTPUT_RANGE)
        {
            Ok(())
        } else {
            Err("Levels must be finite: input trim −24 to +24 dB, output −60 to +12 dB".into())
        }
    }
    fn input_gain(&self) -> f32 {
        10f32.powf(self.input_trim_db / 20.0)
    }
    fn output_gain(&self) -> f32 {
        if self.output_level_db <= Self::OUTPUT_RANGE.0 {
            0.0
        } else {
            10f32.powf(self.output_level_db / 20.0)
        }
    }
}
pub const fn hear_yourself_default() -> bool {
    true
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HostState {
    pub hear_yourself: bool,
    pub test_tone_active: bool,
    #[serde(default)]
    pub levels: HostLevels,
}
#[derive(Debug)]
pub struct HostSignal {
    hear: bool,
    rate: u32,
    test_frame: u32,
    test_active: bool,
    levels: HostLevels,
    input_gain: Glide,
    output_gain: Glide,
}
/// Per-sample one-pole glide (about 10 ms) so level moves never click.
#[derive(Debug)]
struct Glide {
    current: f32,
    target: f32,
    coefficient: f32,
}
impl Glide {
    fn new(rate: u32, value: f32) -> Self {
        Self {
            current: value,
            target: value,
            coefficient: 1.0 - (-1.0 / (0.01 * rate.max(1) as f32)).exp(),
        }
    }
    fn apply(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.current == self.target {
            if self.current != 1.0 {
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    *l *= self.current;
                    *r *= self.current;
                }
            }
            return;
        }
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            self.current += (self.target - self.current) * self.coefficient;
            *l *= self.current;
            *r *= self.current;
        }
        if (self.current - self.target).abs() < 1e-6 {
            self.current = self.target;
        }
    }
}
impl HostSignal {
    pub fn new(rate: u32, hear: bool, levels: HostLevels) -> Self {
        Self {
            hear,
            rate,
            test_frame: 0,
            test_active: false,
            levels,
            input_gain: Glide::new(rate, levels.input_gain()),
            output_gain: Glide::new(rate, levels.output_gain()),
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
            HostUtility::Levels { levels } => {
                // Invalid levels never reach the audio path; the caller validates first.
                if levels.validate().is_ok() {
                    self.levels = levels;
                    self.input_gain.target = levels.input_gain();
                    self.output_gain.target = levels.output_gain();
                }
            }
        }
    }
    pub fn state(&self) -> HostState {
        HostState {
            hear_yourself: self.hear,
            test_tone_active: self.test_active,
            levels: self.levels,
        }
    }
    pub fn input(&mut self, left: &mut [f32], right: &mut [f32]) {
        if !self.hear {
            left.fill(0.0);
            right.fill(0.0);
            return;
        }
        self.input_gain.apply(left, right);
    }
    pub fn output(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.test_tone(left, right);
        self.output_gain.apply(left, right);
        if self.levels.mono {
            for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                let sum = (*l + *r) * 0.5;
                *l = sum;
                *r = sum;
            }
        }
    }
    fn test_tone(&mut self, left: &mut [f32], right: &mut [f32]) {
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
            let mut signal = HostSignal::new(rate, true, HostLevels::default());
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
    #[test]
    fn levels_trim_input_and_scale_output_without_clicks() {
        let rate = 48000;
        let mut signal = HostSignal::new(
            rate,
            true,
            HostLevels {
                input_trim_db: -6.0,
                output_level_db: 0.0,
                mono: false,
            },
        );
        let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
        signal.input(&mut l, &mut r);
        assert!((l[0] - 0.501).abs() < 0.002 && (r[63] - 0.501).abs() < 0.002);
        signal.command(HostUtility::Levels {
            levels: HostLevels {
                input_trim_db: -6.0,
                output_level_db: -60.0,
                mono: false,
            },
        });
        assert_eq!(signal.state().levels.output_level_db, -60.0);
        // The first block glides toward silence: no single-sample jump.
        let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
        signal.output(&mut l, &mut r);
        assert!(l[0] > 0.99 && l[63] < l[0] && l[63] > 0.0);
        for _ in 0..200 {
            let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
            signal.output(&mut l, &mut r);
        }
        let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
        signal.output(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| v.abs() < 1e-5));
        // Out-of-range levels are ignored, never applied.
        signal.command(HostUtility::Levels {
            levels: HostLevels {
                input_trim_db: f32::NAN,
                output_level_db: 0.0,
                mono: false,
            },
        });
        assert_eq!(signal.state().levels.output_level_db, -60.0);
        assert!(
            HostLevels {
                input_trim_db: 25.0,
                output_level_db: 0.0,
                mono: false,
            }
            .validate()
            .is_err()
        );
        assert!(
            HostLevels {
                input_trim_db: 0.0,
                output_level_db: 12.5,
                mono: false,
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn mono_sums_both_sides_and_cancels_opposite_polarity() {
        let mut signal = HostSignal::new(
            48000,
            true,
            HostLevels {
                mono: true,
                ..HostLevels::default()
            },
        );
        let (mut l, mut r) = ([0.8; 8], [0.2; 8]);
        signal.output(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| (v - 0.5).abs() < 1e-6));
        let (mut l, mut r) = ([0.5; 8], [-0.5; 8]);
        signal.output(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| v.abs() < 1e-6));
    }
}
