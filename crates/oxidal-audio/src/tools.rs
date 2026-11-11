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
    HearYourself {
        enabled: bool,
    },
    /// Temporary post-rig mute for tuning or other monitoring views. Unlike
    /// master level, this is never persisted and never removes input from DSP.
    OutputMute {
        enabled: bool,
    },
    /// Flip the output mute. The worker owns the state, so a footswitch needs no
    /// mirrored copy that could disagree with the screen.
    OutputMuteToggle,
    TestTone,
    StopTestTone,
    Levels {
        levels: HostLevels,
    },
    /// Plays the calibration riff into the rig in place of the guitar, at
    /// `peak_db`, and measures the rig's loudness; disabled returns to the guitar.
    Reference {
        enabled: bool,
        peak_db: f32,
    },
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
    /// Noise gate threshold after the trim, in dBFS (−96 to −20); none plays
    /// ungated. Set from the active guitar's measured noise floor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_db: Option<f32>,
    /// Calibration offset plus boost of the playing preset and scene in dB
    /// (−24 to +24), added to the
    /// output level. Set by the daemon from the boost store, never by a view.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub boost_db: f32,
}
fn is_zero(value: &f32) -> bool {
    *value == 0.0
}
impl HostLevels {
    pub const INPUT_RANGE: (f32, f32) = (-24.0, 24.0);
    pub const OUTPUT_RANGE: (f32, f32) = (-60.0, 12.0);
    pub const GATE_RANGE: (f32, f32) = (-96.0, -20.0);
    pub const BOOST_RANGE: (f32, f32) = (-12.0, 12.0);
    /// Calibration offset plus boost, as applied at the output.
    pub const OFFSET_RANGE: (f32, f32) = (-24.0, 24.0);
    pub fn validate(&self) -> Result<(), String> {
        let within = |v: f32, (lo, hi): (f32, f32)| v.is_finite() && (lo..=hi).contains(&v);
        if within(self.input_trim_db, Self::INPUT_RANGE)
            && within(self.output_level_db, Self::OUTPUT_RANGE)
            && self.gate_db.is_none_or(|g| within(g, Self::GATE_RANGE))
            && within(self.boost_db, Self::OFFSET_RANGE)
        {
            Ok(())
        } else {
            Err("Levels must be finite: input trim −24 to +24 dB, output −60 to +12 dB, gate −96 to −20 dBFS, offset −24 to +24 dB".into())
        }
    }
    fn input_gain(&self) -> f32 {
        10f32.powf(self.input_trim_db / 20.0)
    }
    /// Preset and scene boost: part of the guitar signal, applied before the
    /// session mix so a backing track never receives it.
    fn tone_gain(&self) -> f32 {
        10f32.powf(self.boost_db / 20.0)
    }
    /// Master level after the mix and venue EQ; −60 dB is silent.
    fn master_gain(&self) -> f32 {
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
    #[serde(default)]
    pub output_muted: bool,
    pub test_tone_active: bool,
    #[serde(default)]
    pub levels: HostLevels,
    /// The calibration measurement while the reference riff plays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<crate::reference::ReferenceReading>,
}
#[derive(Debug)]
pub struct HostSignal {
    hear: bool,
    output_muted: bool,
    rate: u32,
    test_frame: u32,
    test_active: bool,
    levels: HostLevels,
    input_gain: Glide,
    tone_gain: Glide,
    master_gain: Glide,
    monitor_gain: Glide,
    gate: Gate,
    reference: crate::reference::Reference,
    source: crate::session_media::InputSource,
    source_underruns: u64,
    raw_tap: Option<crate::session_media::Producer>,
    raw_dropped: u64,
    session_return: Option<crate::session_media::Consumer>,
    return_gain: Glide,
    return_underruns: u64,
    venue: crate::venue::VenueEq,
}
/// Downward gate on the trimmed guitar signal: opens within about 1 ms, holds
/// 50 ms, then fades over about 80 ms. Closes 6 dB below the threshold so
/// a decaying note does not chatter at the edge.
#[derive(Debug)]
struct Gate {
    open_at: Option<f32>,
    envelope: f32,
    envelope_fall: f32,
    hold: u32,
    hold_frames: u32,
    open: bool,
    gain: f32,
    attack: f32,
    release: f32,
}
impl Gate {
    fn new(rate: u32, threshold_db: Option<f32>) -> Self {
        let rate = rate.max(1) as f32;
        let pole = |seconds: f32| 1.0 - (-1.0 / (seconds * rate)).exp();
        let mut gate = Self {
            open_at: None,
            envelope: 0.0,
            envelope_fall: (-1.0 / (0.01 * rate)).exp(),
            hold: 0,
            hold_frames: (0.05 * rate) as u32,
            open: true,
            gain: 1.0,
            attack: pole(0.001),
            release: pole(0.08),
        };
        gate.set(threshold_db);
        gate
    }
    fn set(&mut self, threshold_db: Option<f32>) {
        self.open_at = threshold_db.map(|db| 10f32.powf(db / 20.0));
    }
    fn apply(&mut self, left: &mut [f32], right: &mut [f32]) {
        let Some(open_at) = self.open_at else {
            // Ungated: finish any fade back to unity instead of jumping.
            if self.gain < 1.0 {
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    self.gain += (1.0 - self.gain) * self.attack;
                    *l *= self.gain;
                    *r *= self.gain;
                }
                if self.gain > 0.9999 {
                    self.gain = 1.0;
                }
            }
            self.open = true;
            return;
        };
        let close_at = open_at * 0.5;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let level = l.abs().max(r.abs());
            self.envelope = level.max(self.envelope * self.envelope_fall);
            if self.envelope >= open_at || (self.open && self.envelope >= close_at) {
                self.open = true;
                self.hold = self.hold_frames;
            } else if self.hold > 0 {
                self.hold -= 1;
            } else {
                self.open = false;
            }
            let (target, pole) = if self.open {
                (1.0, self.attack)
            } else {
                (0.0, self.release)
            };
            self.gain += (target - self.gain) * pole;
            *l *= self.gain;
            *r *= self.gain;
        }
    }
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
            self.step();
            *l *= self.current;
            *r *= self.current;
        }
        if (self.current - self.target).abs() < 1e-6 {
            self.current = self.target;
        }
    }
    /// One frame of glide. In f32 the step can round to nothing short of
    /// the target (about 5e-5 away near 2.0); land on it then, or the glide
    /// would stall there and never take the fast path.
    #[inline]
    fn step(&mut self) {
        if self.current != self.target {
            let next = self.current + (self.target - self.current) * self.coefficient;
            self.current = if next == self.current {
                self.target
            } else {
                next
            };
        }
    }
}
impl HostSignal {
    pub fn new(rate: u32, hear: bool, levels: HostLevels) -> Self {
        Self {
            hear,
            output_muted: false,
            rate,
            test_frame: 0,
            test_active: false,
            levels,
            input_gain: Glide::new(rate, levels.input_gain()),
            tone_gain: Glide::new(rate, levels.tone_gain()),
            master_gain: Glide::new(rate, levels.master_gain()),
            monitor_gain: Glide::new(rate, 1.0),
            gate: Gate::new(rate, levels.gate_db),
            reference: crate::reference::Reference::new(rate),
            source: crate::session_media::InputSource::Live,
            source_underruns: 0,
            raw_tap: None,
            raw_dropped: 0,
            session_return: None,
            return_gain: Glide::new(rate, 1.0),
            return_underruns: 0,
            venue: crate::venue::VenueEq::new(rate),
        }
    }
    /// Selects what feeds the rig. Returns the previous source so its ring is
    /// released by the caller, off the audio thread.
    pub fn set_input_source(
        &mut self,
        source: crate::session_media::InputSource,
    ) -> crate::session_media::InputSource {
        std::mem::replace(&mut self.source, source)
    }
    /// Starts or stops copying the raw interface input (R0: the left mapped
    /// channel, before the input source, trim and gate) into a ring. Returns
    /// the previous tap for the caller to release off the audio thread.
    pub fn set_raw_tap(
        &mut self,
        tap: Option<crate::session_media::Producer>,
    ) -> Option<crate::session_media::Producer> {
        std::mem::replace(&mut self.raw_tap, tap)
    }
    /// Connects the session mix return: interleaved stereo frames (left,
    /// right) added after the rig's tone gain and before venue EQ. Returns the
    /// previous return for the caller to release off the audio thread.
    pub fn set_session_return(
        &mut self,
        frames: Option<crate::session_media::Consumer>,
    ) -> Option<crate::session_media::Consumer> {
        std::mem::replace(&mut self.session_return, frames)
    }
    /// Level of the session mix return, gliding like every other level.
    pub fn set_return_level(&mut self, gain: f32) {
        if gain.is_finite() && (0.0..=4.0).contains(&gain) {
            self.return_gain.target = gain;
        }
    }
    /// Blocks in which the session return ran dry and silence was mixed.
    pub fn return_underruns(&self) -> u64 {
        self.return_underruns
    }
    pub fn set_venue_eq(&mut self, bands: &[crate::venue::VenueBand], bypass: bool) {
        self.venue.set(bands);
        self.venue.set_bypass(bypass);
    }
    /// Blocks in which the injected source ran dry and silence was played.
    pub fn source_underruns(&self) -> u64 {
        self.source_underruns
    }
    /// Raw samples the tap could not keep because its writer fell behind.
    pub fn raw_dropped(&self) -> u64 {
        self.raw_dropped
    }
    /// Start a newly opened playback stream at silence and glide to its saved
    /// level. ALSA may begin after only a few queued periods, so the envelope
    /// belongs before sample encoding rather than around device open/close.
    #[cfg(any(feature = "alsa", feature = "qualification"))]
    pub(crate) fn begin_output(&mut self) {
        self.monitor_gain.current = 0.0;
        self.monitor_gain.target = if self.output_muted { 0.0 } else { 1.0 };
    }
    pub fn command(&mut self, command: HostUtility) {
        match command {
            HostUtility::HearYourself { enabled } => self.hear = enabled,
            HostUtility::OutputMute { enabled } => {
                self.output_muted = enabled;
                self.monitor_gain.target = if enabled { 0.0 } else { 1.0 };
            }
            HostUtility::OutputMuteToggle => {
                self.output_muted = !self.output_muted;
                self.monitor_gain.target = if self.output_muted { 0.0 } else { 1.0 };
            }
            HostUtility::TestTone => {
                if !self.test_active {
                    self.test_frame = 0;
                    self.test_active = true;
                }
            }
            HostUtility::StopTestTone => self.test_active = false,
            HostUtility::Reference { enabled, peak_db } => {
                if enabled && peak_db.is_finite() && (-40.0..=0.0).contains(&peak_db) {
                    self.reference.start(peak_db);
                } else {
                    self.reference.stop();
                }
            }
            HostUtility::Levels { levels } => {
                // Invalid levels never reach the audio path; the caller validates first.
                if levels.validate().is_ok() {
                    self.levels = levels;
                    self.input_gain.target = levels.input_gain();
                    self.tone_gain.target = levels.tone_gain();
                    self.master_gain.target = levels.master_gain();
                    self.gate.set(levels.gate_db);
                }
            }
        }
    }
    pub fn state(&self) -> HostState {
        HostState {
            hear_yourself: self.hear,
            output_muted: self.output_muted,
            test_tone_active: self.test_active,
            levels: self.levels,
            reference: self.reference.reading(),
        }
    }
    pub fn input(&mut self, left: &mut [f32], right: &mut [f32]) {
        // R0 is captured first, exactly as the interface delivered it.
        if let Some(tap) = &mut self.raw_tap {
            let kept = tap.push(left);
            self.raw_dropped += (left.len() - kept) as u64;
        }
        // The riff stands in for a guitar at the reference level: no trim or gate.
        if self.reference.active() {
            self.reference.input(left, right);
            return;
        }
        if let crate::session_media::InputSource::Reamp {
            frames,
            trim_and_gate,
        } = &mut self.source
        {
            // A DI is the rig's input, not the live guitar, so Hear yourself
            // does not silence it. Mono DI feeds both sides, like the Jogg map.
            let got = frames.pop(left);
            if got < left.len() {
                left[got..].fill(0.0);
                self.source_underruns += 1;
            }
            right.copy_from_slice(left);
            if *trim_and_gate {
                self.input_gain.apply(left, right);
                self.gate.apply(left, right);
            }
            return;
        }
        if !self.hear {
            left.fill(0.0);
            right.fill(0.0);
            return;
        }
        self.input_gain.apply(left, right);
        self.gate.apply(left, right);
    }
    pub fn output(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.reference.active() {
            // Calibration is silent: measure the rig, send nothing to the speakers.
            self.reference.measure(left, right);
            left.fill(0.0);
            right.fill(0.0);
            return;
        }
        // [DES-SIGNAL]: rig → tone gain → (W0) → session mix → venue EQ →
        // mono fold → Master → Mute.
        self.tone_gain.apply(left, right);
        self.test_tone(left, right);
        self.mix_return(left, right);
        // Venue correction sits after the mix and before mono fold, so a mono
        // PA hears the corrected sum.
        self.venue.apply(left, right);
        if self.levels.mono {
            for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                let sum = (*l + *r) * 0.5;
                *l = sum;
                *r = sum;
            }
        }
        self.master_gain.apply(left, right);
        self.monitor_gain.apply(left, right);
    }
    fn mix_return(&mut self, left: &mut [f32], right: &mut [f32]) {
        let Some(frames) = &mut self.session_return else {
            return;
        };
        // Pop in stack-sized chunks: no allocation, any block size.
        let mut chunk = [0.0f32; 256];
        let mut short = false;
        for (left, right) in left.chunks_mut(128).zip(right.chunks_mut(128)) {
            let want = left.len() * 2;
            let got = frames.pop(&mut chunk[..want]);
            if got < want {
                chunk[got..want].fill(0.0);
                short = true;
            }
            for (i, (l, r)) in left.iter_mut().zip(right.iter_mut()).enumerate() {
                // The glide is per frame, as in Glide::apply.
                self.return_gain.step();
                let g = self.return_gain.current;
                *l += chunk[2 * i] * g;
                *r += chunk[2 * i + 1] * g;
            }
        }
        if short {
            self.return_underruns += 1;
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
    fn mute_toggle_flips_the_worker_state_and_agrees_with_explicit_mute() {
        let mut signal = HostSignal::new(48000, true, HostLevels::default());
        assert!(!signal.state().output_muted);
        signal.command(HostUtility::OutputMuteToggle);
        assert!(signal.state().output_muted);
        // An explicit command after a toggle sets the same single flag.
        signal.command(HostUtility::OutputMute { enabled: true });
        assert!(signal.state().output_muted);
        signal.command(HostUtility::OutputMuteToggle);
        assert!(!signal.state().output_muted);
        signal.command(HostUtility::OutputMuteToggle);
        signal.command(HostUtility::OutputMuteToggle);
        assert!(!signal.state().output_muted, "two quick presses cancel out");
    }

    #[test]
    fn temporary_output_mute_keeps_input_available_and_fades_without_changing_levels() {
        let levels = HostLevels {
            output_level_db: -3.0,
            ..HostLevels::default()
        };
        let mut signal = HostSignal::new(48000, true, levels);
        signal.command(HostUtility::OutputMute { enabled: true });
        let (mut left, mut right) = ([0.25; 128], [0.25; 128]);
        signal.input(&mut left, &mut right);
        assert_eq!(left, [0.25; 128], "tuner input remains available");
        for _ in 0..40 {
            left.fill(0.25);
            right.fill(0.25);
            signal.output(&mut left, &mut right);
        }
        assert!(left[127].abs() < 0.0001);
        assert!(signal.state().output_muted);
        assert_eq!(signal.state().levels, levels);
        signal.command(HostUtility::OutputMute { enabled: false });
        for _ in 0..40 {
            left.fill(0.25);
            right.fill(0.25);
            signal.output(&mut left, &mut right);
        }
        assert!(left[127] > 0.17);
        assert!(!signal.state().output_muted);
    }
    #[test]
    #[cfg(any(feature = "alsa", feature = "qualification"))]
    fn a_new_output_stream_fades_in_without_a_sample_step() {
        let mut signal = HostSignal::new(48000, true, HostLevels::default());
        signal.begin_output();
        let (mut left, mut right) = ([0.25; 64], [0.25; 64]);
        signal.output(&mut left, &mut right);
        assert!(left[0] > 0.0 && left[0] < 0.001);
        assert!(left.windows(2).all(|samples| samples[0] < samples[1]));
        assert_eq!(left, right);
        for _ in 0..80 {
            left.fill(0.25);
            right.fill(0.25);
            signal.output(&mut left, &mut right);
        }
        assert!(left[63] > 0.249);
    }
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
                gate_db: None,
                boost_db: 0.0,
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
                gate_db: None,
                boost_db: 0.0,
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
                gate_db: None,
                boost_db: 0.0,
            },
        });
        assert_eq!(signal.state().levels.output_level_db, -60.0);
        assert!(
            HostLevels {
                input_trim_db: 25.0,
                output_level_db: 0.0,
                mono: false,
                gate_db: None,
                boost_db: 0.0,
            }
            .validate()
            .is_err()
        );
        assert!(
            HostLevels {
                input_trim_db: 0.0,
                output_level_db: 12.5,
                mono: false,
                gate_db: None,
                boost_db: 0.0,
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn gate_mutes_noise_passes_playing_and_fades_without_clicks() {
        let rate = 48000;
        let levels = HostLevels {
            gate_db: Some(-50.0),
            ..HostLevels::default()
        };
        let mut signal = HostSignal::new(rate, true, levels);
        let block = |signal: &mut HostSignal, value: f32| {
            let (mut l, mut r) = ([value; 64], [-value; 64]);
            signal.input(&mut l, &mut r);
            (l, r)
        };
        // Hiss at −60 dBFS fades to silence within hold plus release.
        let hiss = 0.001;
        let first = block(&mut signal, hiss).0;
        assert!((first[0] - hiss).abs() < 1e-6, "starts open, no jump");
        let mut previous = first[63];
        for _ in 0..(rate as usize / 64) {
            let (l, _) = block(&mut signal, hiss);
            // Never a step bigger than the release slope allows.
            assert!((l[0] - previous).abs() < hiss * 0.01);
            previous = l[63];
        }
        assert!(previous.abs() < hiss * 1e-3);
        // A note at −20 dBFS opens it within about 1 ms.
        let note = 0.1;
        let (l, r) = block(&mut signal, note);
        assert!(l[63] > note * 0.7 && r[63] < -note * 0.7);
        for _ in 0..10 {
            block(&mut signal, note);
        }
        assert!((block(&mut signal, note).0[63] - note).abs() < 1e-4);
        // A decay between the close (−56) and open (−50) thresholds stays open.
        for _ in 0..(rate as usize / 64) {
            block(&mut signal, 0.002);
        }
        assert!((block(&mut signal, 0.002).0[63] - 0.002).abs() < 1e-5);
        // Removing the gate glides back to unity.
        for _ in 0..(rate as usize / 64) {
            block(&mut signal, hiss);
        }
        signal.command(HostUtility::Levels {
            levels: HostLevels::default(),
        });
        for _ in 0..40 {
            block(&mut signal, hiss);
        }
        assert!((block(&mut signal, hiss).0[63] - hiss).abs() < 1e-7);
        assert!(
            HostLevels {
                gate_db: Some(-10.0),
                ..HostLevels::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn boost_adds_to_the_output_level_but_never_unmutes_it() {
        let mut signal = HostSignal::new(
            48000,
            true,
            HostLevels {
                output_level_db: -6.0,
                boost_db: 6.0,
                ..HostLevels::default()
            },
        );
        let (mut l, mut r) = ([0.5; 8], [0.5; 8]);
        signal.output(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| (v - 0.5).abs() < 1e-4));
        let muted = HostLevels {
            output_level_db: -60.0,
            boost_db: 12.0,
            ..HostLevels::default()
        };
        assert_eq!(muted.master_gain(), 0.0);
        assert!(
            HostLevels {
                boost_db: 24.5,
                ..HostLevels::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn the_reference_replaces_the_guitar_measures_the_rig_and_stays_silent() {
        let mut signal = HostSignal::new(48000, true, HostLevels::default());
        signal.command(HostUtility::Reference {
            enabled: true,
            peak_db: -12.0,
        });
        let mut heard = 0.0f32;
        for _ in 0..(48000 * 2 / 64) {
            // A loud live guitar is ignored while the riff plays.
            let (mut l, mut r) = ([0.9; 64], [0.9; 64]);
            signal.input(&mut l, &mut r);
            assert!(l.iter().all(|v| v.abs() < 0.5));
            signal.output(&mut l, &mut r);
            heard = heard.max(l.iter().chain(&r).fold(0.0, |m, v| m.max(v.abs())));
        }
        assert_eq!(heard, 0.0);
        let reading = signal.state().reference.unwrap();
        assert!(reading.seconds > 0.9 && reading.lufs.is_some());
        signal.command(HostUtility::Reference {
            enabled: false,
            peak_db: 0.0,
        });
        assert!(signal.state().reference.is_none());
        let (mut l, mut r) = ([0.25; 64], [0.25; 64]);
        signal.input(&mut l, &mut r);
        signal.output(&mut l, &mut r);
        assert!((l[63] - 0.25).abs() < 1e-6, "the guitar is back");
    }
    #[test]
    fn a_reamp_source_replaces_the_guitar_after_the_raw_tap() {
        use crate::session_media::{InputSource, ring};
        let levels = HostLevels {
            input_trim_db: -6.0,
            ..HostLevels::default()
        };
        let trim = levels.input_gain();
        let mut signal = HostSignal::new(48000, false, levels);
        let (tap_tx, mut tap_rx) = ring(256);
        assert!(signal.set_raw_tap(Some(tap_tx)).is_none());
        let (mut di_tx, di_rx) = ring(256);
        let di: Vec<f32> = (0..96).map(|i| (i as f32 - 48.0) / 64.0).collect();
        assert_eq!(di_tx.push(&di), 96);
        let previous = signal.set_input_source(InputSource::Reamp {
            frames: di_rx,
            trim_and_gate: true,
        });
        assert!(matches!(previous, InputSource::Live));
        // The live guitar (0.9) is tapped raw but never reaches the rig, and
        // Hear yourself being off does not silence the DI.
        let (mut l, mut r) = ([0.9; 64], [0.1; 64]);
        signal.input(&mut l, &mut r);
        for (i, (a, b)) in l.iter().zip(&r).enumerate() {
            assert_eq!(*a, di[i] * trim);
            assert_eq!(a, b, "mono DI feeds both sides");
        }
        let mut raw = [0.0; 64];
        assert_eq!(tap_rx.pop(&mut raw), 64);
        assert_eq!(raw, [0.9; 64], "R0 is the interface input, untouched");
        // The DI runs dry after 32 more frames: the rest is silence, counted once.
        let (mut l, mut r) = ([0.9; 64], [0.9; 64]);
        signal.input(&mut l, &mut r);
        assert_eq!(l[31], di[95] * trim);
        assert!(l[32..].iter().chain(&r[32..]).all(|v| *v == 0.0));
        assert_eq!(signal.source_underruns(), 1);
        // Without trim and gate the DI reaches the rig exactly as recorded.
        let (mut di_tx, di_rx) = ring(64);
        di_tx.push(&[0.5; 64]);
        signal.set_input_source(InputSource::Reamp {
            frames: di_rx,
            trim_and_gate: false,
        });
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        signal.input(&mut l, &mut r);
        assert_eq!(l, [0.5; 64]);
        // Back to Live: Hear yourself applies again, and the tap stops on request.
        assert!(matches!(
            signal.set_input_source(InputSource::Live),
            InputSource::Reamp { .. }
        ));
        let (mut l, mut r) = ([0.9; 64], [0.9; 64]);
        signal.input(&mut l, &mut r);
        assert_eq!(l, [0.0; 64]);
        // Four 64-frame blocks tapped into 256 samples, one block read back.
        let tap_tx = signal.set_raw_tap(None).unwrap();
        assert_eq!(tap_tx.free(), 64);
        assert_eq!(signal.raw_dropped(), 0);
    }
    #[test]
    fn a_full_raw_tap_drops_and_counts_instead_of_blocking() {
        let mut signal = HostSignal::new(48000, true, HostLevels::default());
        let (tap_tx, _tap_rx) = crate::session_media::ring(100);
        signal.set_raw_tap(Some(tap_tx));
        let (mut l, mut r) = ([0.25; 64], [0.25; 64]);
        signal.input(&mut l, &mut r);
        signal.input(&mut l, &mut r);
        assert_eq!(signal.raw_dropped(), 28);
        assert_eq!(l, [0.25; 64], "the guitar still plays");
    }
    #[test]
    fn venue_eq_corrects_the_output_only_and_before_mono_fold() {
        use crate::venue::{VenueBand, VenueKind};
        let rate = 48000;
        let mut signal = HostSignal::new(
            rate,
            true,
            HostLevels {
                mono: true,
                ..HostLevels::default()
            },
        );
        let cut = VenueBand {
            kind: VenueKind::Bell,
            freq_hz: 1000.0,
            gain_db: -6.0,
            q: 1.0,
        };
        signal.set_venue_eq(&[cut], false);
        let tone = |i: usize| (std::f32::consts::TAU * 1000.0 * i as f32 / rate as f32).sin() * 0.5;
        // The input path never sees venue correction (FR-15).
        let (mut l, mut r) = ([0.0f32; 480], [0.0f32; 480]);
        for (i, s) in l.iter_mut().enumerate() {
            *s = tone(i);
        }
        let source = l;
        signal.input(&mut l, &mut r.clone());
        assert_eq!(l, source);
        // The output is about 6 dB down at 1 kHz once settled; left-only input
        // proves the fold happens after the correction (both sides equal).
        let mut peak = 0.0f32;
        for block in 0..100 {
            for (i, (a, b)) in l.iter_mut().zip(r.iter_mut()).enumerate() {
                *a = tone(block * 480 + i);
                *b = 0.0;
            }
            signal.output(&mut l, &mut r);
            assert_eq!(l, r);
            if block > 50 {
                peak = l.iter().fold(peak, |m, v| m.max(v.abs()));
            }
        }
        let db = 20.0 * (peak / 0.25).log10();
        assert!((db + 6.0).abs() < 0.2, "{db}");
        // Bypass restores the uncorrected (mono-folded) signal exactly.
        signal.set_venue_eq(&[cut], true);
        for (i, (a, b)) in l.iter_mut().zip(r.iter_mut()).enumerate() {
            *a = tone(i);
            *b = 0.0;
        }
        let expected: Vec<f32> = l.iter().map(|v| v * 0.5).collect();
        signal.output(&mut l, &mut r);
        assert_eq!(l.to_vec(), expected);
    }
    /// The output chain before the CF-01 split: one glide of Master plus boost,
    /// then mono fold, then the mute glide.
    struct BeforeSplit {
        gain: Glide,
        monitor: Glide,
        mono: bool,
    }
    impl BeforeSplit {
        fn combined(levels: &HostLevels) -> f32 {
            if levels.output_level_db <= HostLevels::OUTPUT_RANGE.0 {
                0.0
            } else {
                10f32.powf((levels.output_level_db + levels.boost_db) / 20.0)
            }
        }
        fn output(&mut self, left: &mut [f32], right: &mut [f32]) {
            self.gain.apply(left, right);
            if self.mono {
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    let sum = (*l + *r) * 0.5;
                    *l = sum;
                    *r = sum;
                }
            }
            self.monitor.apply(left, right);
        }
    }
    #[test]
    fn the_default_path_matches_the_chain_before_the_split() {
        let rate = 48000;
        let start = HostLevels {
            output_level_db: -3.0,
            boost_db: 4.5,
            ..HostLevels::default()
        };
        let mut signal = HostSignal::new(rate, true, start);
        let mut before = BeforeSplit {
            gain: Glide::new(rate, BeforeSplit::combined(&start)),
            monitor: Glide::new(rate, 1.0),
            mono: false,
        };
        // Master moves, mono flips and mute ramps in and out, with a constant
        // preset boost: the split is the same product, glide for glide.
        let script: [(usize, Option<HostLevels>, Option<bool>); 7] = [
            (0, None, None),
            (
                40,
                Some(HostLevels {
                    output_level_db: -12.0,
                    ..start
                }),
                None,
            ),
            (
                90,
                Some(HostLevels {
                    mono: true,
                    output_level_db: -12.0,
                    ..start
                }),
                None,
            ),
            (140, None, Some(true)),
            (200, None, Some(false)),
            (
                260,
                Some(HostLevels {
                    output_level_db: -60.0,
                    ..start
                }),
                None,
            ),
            (
                330,
                Some(HostLevels {
                    output_level_db: 6.0,
                    ..start
                }),
                None,
            ),
        ];
        let mut worst = 0.0f32;
        let mut settled = 0.0f32;
        for block in 0..600usize {
            for (at, levels, mute) in &script {
                if *at == block {
                    if let Some(levels) = levels {
                        signal.command(HostUtility::Levels { levels: *levels });
                        before.gain.target = BeforeSplit::combined(levels);
                        before.mono = levels.mono;
                    }
                    if let Some(mute) = mute {
                        signal.command(HostUtility::OutputMute { enabled: *mute });
                        before.monitor.target = if *mute { 0.0 } else { 1.0 };
                    }
                }
            }
            let mut l: Vec<f32> = (0..96)
                .map(|i| ((block * 96 + i) as f32 * 0.031).sin() * 0.7)
                .collect();
            let mut r: Vec<f32> = l.iter().map(|v| v * -0.4).collect();
            let (mut bl, mut br) = (l.clone(), r.clone());
            signal.output(&mut l, &mut r);
            before.output(&mut bl, &mut br);
            for (a, b) in l.iter().chain(&r).zip(bl.iter().chain(&br)) {
                worst = worst.max((a - b).abs());
                if block >= 500 {
                    settled = settled.max((a - b).abs());
                }
            }
        }
        // Inside ramps the two glides land on their targets on slightly
        // different frames: at most about −90 dB below a 2.3 peak.
        assert!(worst < 1e-4, "{worst}");
        // Once settled the split is the same product, to float rounding.
        assert!(settled < 1e-6, "{settled}");
    }
    #[test]
    fn a_boost_change_differs_only_inside_its_ramp() {
        let rate = 48000;
        let start = HostLevels::default();
        let mut signal = HostSignal::new(rate, true, start);
        let mut before = BeforeSplit {
            gain: Glide::new(rate, 1.0),
            monitor: Glide::new(rate, 1.0),
            mono: false,
        };
        let boosted = HostLevels {
            boost_db: 6.0,
            output_level_db: -6.0,
            ..start
        };
        signal.command(HostUtility::Levels { levels: boosted });
        before.gain.target = BeforeSplit::combined(&boosted);
        let mut during = 0.0f32;
        let mut after = 0.0f32;
        for block in 0..200 {
            let (mut l, mut r) = ([0.5f32; 96], [0.5f32; 96]);
            let (mut bl, mut br) = (l, r);
            signal.output(&mut l, &mut r);
            before.output(&mut bl, &mut br);
            let diff = l
                .iter()
                .zip(&bl)
                .fold(0.0f32, |m, (a, b)| m.max((a - b).abs()));
            if block < 50 {
                during = during.max(diff);
            } else if block >= 100 {
                after = after.max(diff);
            }
        }
        // Two 10 ms glides in series are a little slower than one; both end
        // at the same level.
        assert!(during < 0.1, "{during}");
        assert!(after < 1e-6, "{after}");
    }
    #[test]
    fn the_session_return_skips_boost_and_follows_master_and_mute() {
        use crate::session_media::ring;
        let rate = 48000;
        let levels = HostLevels {
            boost_db: 6.0,
            ..HostLevels::default()
        };
        let mut signal = HostSignal::new(rate, true, levels);
        let (mut tx, rx) = ring(4096);
        assert!(signal.set_session_return(Some(rx)).is_none());
        let frame = |tx: &mut crate::session_media::Producer, n: usize| {
            for _ in 0..n {
                tx.push(&[0.25, -0.125]);
            }
        };
        // Rig silent, track at unity: the track is not boosted.
        frame(&mut tx, 64);
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        signal.output(&mut l, &mut r);
        assert_eq!((l, r), ([0.25; 64], [-0.125; 64]));
        // The rig is boosted and the track is added after it.
        frame(&mut tx, 64);
        let (mut l, mut r) = ([0.1; 64], [0.1; 64]);
        signal.output(&mut l, &mut r);
        let boost = 10f32.powf(6.0 / 20.0);
        assert!((l[0] - (0.1 * boost + 0.25)).abs() < 1e-6);
        assert!((r[0] - (0.1 * boost - 0.125)).abs() < 1e-6);
        // Master −60 dB silences the track too; Mute also does.
        signal.command(HostUtility::Levels {
            levels: HostLevels {
                output_level_db: -60.0,
                ..levels
            },
        });
        for _ in 0..250 {
            frame(&mut tx, 64);
            let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
            signal.output(&mut l, &mut r);
        }
        frame(&mut tx, 64);
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        signal.output(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| v.abs() < 1e-5));
        // A dry return mixes silence and is counted; the rig keeps playing.
        signal.command(HostUtility::Levels { levels });
        for _ in 0..250 {
            let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
            signal.output(&mut l, &mut r);
        }
        let underruns = signal.return_underruns();
        assert!(underruns >= 250);
        let (mut l, mut r) = ([0.1; 64], [0.1; 64]);
        signal.output(&mut l, &mut r);
        assert!((l[63] - 0.1 * boost).abs() < 1e-5);
        // Return level glides; disconnecting hands the ring back.
        signal.set_return_level(0.5);
        signal.set_return_level(f32::NAN);
        for _ in 0..250 {
            frame(&mut tx, 64);
            let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
            signal.output(&mut l, &mut r);
        }
        frame(&mut tx, 64);
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        signal.output(&mut l, &mut r);
        assert!((l[63] - 0.125).abs() < 1e-5);
        assert!(signal.set_session_return(None).is_some());
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
