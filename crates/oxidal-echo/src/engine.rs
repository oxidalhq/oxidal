//! The echo engine: one delay memory per channel, the voice that plays it,
//! Mix, Hold, the crossfade between modes and the stereo spread.
//! @see docs/native-echo.md

use crate::controls::{MAX_SECONDS, MIN_SECONDS, Mode, Settings};
use crate::parts::{flush, guard, read_whole, smooth_wave};
use crate::voice::{CONTROL_EVERY, Frame, Slow, Voice};
use oxidal_dsp::{DelayLine, Smoothed, lerp};

/// Seconds of memory per channel: 4 s of delay, the wobble of a worn tape on
/// top, and room for Reverse to read twice its window back.
const MEMORY_SECONDS: f32 = 5.1;
/// Seconds a change of Mode takes to crossfade.
pub const MODE_FADE_SECONDS: f32 = 0.045;
/// Seconds Hold takes to close and to open.
pub const HOLD_FADE_SECONDS: f32 = 0.03;
/// The right side's repeats trail the left by up to this long at full Width,
/// and never by more than an eighth of the delay time.
const SPREAD_SECONDS: f32 = 0.012;
/// Depth (half the swing) and rate of the chorus Mod puts on the repeats in
/// Digital, Reverse and Ping.
const CHORUS_SECONDS: f32 = 0.0015;
const CHORUS_HZ: f32 = 0.6;
/// Time constant of the smoothing on Mix, Feedback, Width and Mod.
const SMOOTH_MS: f32 = 25.0;
/// Seeds of the noise in the two voices; fixed, so every run is the same.
const SEEDS: [u32; 2] = [0x1f3d_5b79, 0x2e4c_6a80];

/// The whole effect for `N` channels.
pub struct Engine<const N: usize> {
    rate: f32,
    lines: [DelayLine; N],
    spread: [DelayLine; N],
    /// The voice that sounds, and the one fading in while Mode changes.
    current: Voice<N>,
    next: Voice<N>,
    fading: bool,
    fade: f32,
    fade_step: f32,
    starts: u32,
    primed: bool,
    settings: Settings,
    send: Smoothed,
    dry: Smoothed,
    feedback: Smoothed,
    width: Smoothed,
    amount: Smoothed,
    trail: Smoothed,
    chorus: Smoothed,
    tone: Smoothed,
    age: Smoothed,
    spacing: Smoothed,
    modulation: Smoothed,
    countdown: u32,
    chorus_phase: f32,
    chorus_step: f32,
    hold: f32,
    hold_step: f32,
    hold_length: usize,
    hold_crossed: bool,
    whole: usize,
    exact: f64,
    longest: usize,
}

impl<const N: usize> core::fmt::Debug for Engine<N> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Engine")
            .field("channels", &N)
            .field("rate", &self.rate)
            .field("mode", &self.current.mode())
            .field("settings", &self.settings)
            .finish_non_exhaustive()
    }
}

impl<const N: usize> Engine<N> {
    /// Allocates everything the effect will ever need.
    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate.is_finite() {
            sample_rate.clamp(8000.0, 192_000.0)
        } else {
            48_000.0
        };
        let memory = (MEMORY_SECONDS * rate) as usize + 8;
        let lines: [DelayLine; N] = core::array::from_fn(|_| DelayLine::new(memory));
        let longest = lines
            .first()
            .map_or(memory, DelayLine::capacity)
            .saturating_sub(4)
            .max(8);
        let spread_memory = ((SPREAD_SECONDS + 2.0 * CHORUS_SECONDS) * rate) as usize + 8;
        let slow_rate = rate / CONTROL_EVERY as f32;
        let settings = Settings::default();
        Self {
            rate,
            lines,
            spread: core::array::from_fn(|_| DelayLine::new(spread_memory)),
            current: Voice::new(rate, longest, SEEDS[0]),
            next: Voice::new(rate, longest, SEEDS[1]),
            fading: false,
            fade: 0.0,
            fade_step: 1.0 / (MODE_FADE_SECONDS * rate).max(1.0),
            starts: 0,
            primed: false,
            settings,
            send: Smoothed::new(rate, SMOOTH_MS, 0.0),
            dry: Smoothed::new(rate, SMOOTH_MS, 1.0),
            feedback: Smoothed::new(rate, SMOOTH_MS, 0.0),
            width: Smoothed::new(rate, SMOOTH_MS, 0.0),
            amount: Smoothed::new(rate, SMOOTH_MS, 0.0),
            trail: Smoothed::new(rate, 60.0, 0.0),
            chorus: Smoothed::new(rate, 60.0, 0.0),
            tone: Smoothed::new(slow_rate, SMOOTH_MS, 0.5),
            age: Smoothed::new(slow_rate, SMOOTH_MS, 0.0),
            spacing: Smoothed::new(slow_rate, SMOOTH_MS, 0.0),
            modulation: Smoothed::new(slow_rate, SMOOTH_MS, 0.0),
            countdown: 0,
            chorus_phase: 0.0,
            chorus_step: CHORUS_HZ / rate,
            hold: 0.0,
            hold_step: 1.0 / (HOLD_FADE_SECONDS * rate).max(1.0),
            hold_length: 1,
            hold_crossed: false,
            whole: 1,
            exact: 2.0,
            longest,
        }
    }

    /// Empties the memory; the next sample starts from the settings as given.
    pub fn reset(&mut self) {
        for line in self.lines.iter_mut().chain(&mut self.spread) {
            line.clear();
        }
        self.primed = false;
        self.fading = false;
        self.fade = 0.0;
        self.starts = 0;
        self.countdown = 0;
        self.chorus_phase = 0.0;
        self.hold = 0.0;
    }

    /// The sample rate the engine runs at.
    pub fn sample_rate(&self) -> f32 {
        self.rate
    }

    /// Takes the controls of the next block as targets. Values outside their
    /// range are clamped, and one that is not a number is ignored.
    pub fn set(&mut self, settings: &Settings) {
        let kept = self.settings;
        let within = |value: f32, most: f32, fallback: f32| {
            if value.is_finite() {
                value.clamp(0.0, most)
            } else {
                fallback
            }
        };
        let seconds = if settings.seconds.is_finite() {
            settings.seconds.clamp(MIN_SECONDS, MAX_SECONDS)
        } else {
            kept.seconds
        };
        let settings = Settings {
            seconds,
            feedback: within(settings.feedback, 1.1, kept.feedback),
            tone: within(settings.tone, 1.0, kept.tone),
            modulation: within(settings.modulation, 1.0, kept.modulation),
            age: within(settings.age, 1.0, kept.age),
            spacing: within(settings.spacing, 1.0, kept.spacing),
            width: within(settings.width, 1.0, kept.width),
            mix: within(settings.mix, 1.0, kept.mix),
            ..*settings
        };
        self.settings = settings;
        let samples = f64::from(seconds) * f64::from(self.rate);
        self.exact = samples.clamp(2.0, self.longest as f64);
        self.whole = (samples.round() as usize).clamp(1, self.longest);
        // Up to the middle Mix raises the send into the echo and leaves the
        // dry signal alone; past the middle it lowers the dry signal.
        self.send.set((2.0 * settings.mix).min(1.0));
        self.dry.set((2.0 * (1.0 - settings.mix)).min(1.0));
        self.feedback.set(settings.feedback);
        self.width.set(settings.width);
        self.amount.set(settings.modulation);
        self.tone.set(settings.tone);
        self.age.set(settings.age);
        self.spacing.set(settings.spacing);
        self.modulation.set(settings.modulation);
        let trail = if N == 2 && settings.mode != Mode::Ping {
            settings.width * SPREAD_SECONDS.min(seconds / 8.0) * self.rate
        } else {
            0.0
        };
        let chorus = match settings.mode {
            Mode::Digital | Mode::Reverse | Mode::Ping => {
                settings.modulation * CHORUS_SECONDS * self.rate
            }
            _ => 0.0,
        };
        self.trail.set(trail);
        self.chorus.set(chorus);
    }

    fn slow(&self) -> Slow {
        Slow {
            tone: self.tone.current(),
            age: self.age.current(),
            spacing: self.spacing.current(),
            modulation: self.modulation.current(),
            width: self.width.current(),
            heads: self.settings.heads,
        }
    }

    fn seed(&mut self) -> u32 {
        self.starts = self.starts.wrapping_add(1);
        // 2^32 over the golden ratio spreads the count over all the bits.
        SEEDS[(self.starts & 1) as usize] ^ self.starts.wrapping_mul(0x9e37_79b9)
    }

    /// The first sample after a reset: every glide starts at its target.
    fn prime(&mut self) {
        for smoothed in [
            &mut self.send,
            &mut self.dry,
            &mut self.feedback,
            &mut self.width,
            &mut self.amount,
            &mut self.trail,
            &mut self.chorus,
            &mut self.tone,
            &mut self.age,
            &mut self.spacing,
            &mut self.modulation,
        ] {
            let target = smoothed.target();
            smoothed.snap(target);
        }
        let (slow, seed) = (self.slow(), self.seed());
        self.current
            .start(self.settings.mode, self.whole, self.exact, &slow, seed);
        self.hold = if self.settings.hold { 1.0 } else { 0.0 };
        self.latch_hold();
        self.countdown = CONTROL_EVERY;
        self.primed = true;
    }

    fn latch_hold(&mut self) {
        self.hold_length = self.current.loop_length().clamp(1, self.longest);
        self.hold_crossed = N == 2 && self.current.mode() == Mode::Ping;
    }

    /// One sample in, one sample out.
    pub fn tick(&mut self, dry: [f32; N]) -> [f32; N] {
        if !self.primed {
            self.prime();
        }
        if self.countdown == 0 {
            self.countdown = CONTROL_EVERY;
            self.tone.next();
            self.age.next();
            self.spacing.next();
            self.modulation.next();
            let slow = self.slow();
            self.current.update(&slow, false);
            if self.fading {
                self.next.update(&slow, false);
            }
        }
        self.countdown -= 1;

        // Hold closes the input and loops the memory; it fades in and out.
        if self.settings.hold {
            if self.hold == 0.0 {
                self.latch_hold();
            }
            self.hold = (self.hold + self.hold_step).min(1.0);
        } else {
            self.hold = (self.hold - self.hold_step).max(0.0);
        }
        let hold = self.hold;

        let send = self.send.next() * (1.0 - hold);
        let dry_gain = self.dry.next();
        let width = self.width.next();
        let mut frame = Frame {
            input: [0.0; N],
            level: 0.0,
            feedback: self.feedback.next(),
            width,
            amount: self.amount.next(),
            whole: self.whole,
            exact: self.exact,
        };
        let centre = dry.iter().sum::<f32>() / N.max(1) as f32;
        for (input, x) in frame.input.iter_mut().zip(dry) {
            // Width narrows what goes in, so Width at zero gives mono repeats.
            *input = (centre + width * (x - centre)) * send;
            frame.level = frame.level.max(x.abs());
        }

        // A change of Mode starts the other voice and crossfades to it.
        if !self.fading && self.settings.mode != self.current.mode() {
            let (slow, seed) = (self.slow(), self.seed());
            self.next
                .start(self.settings.mode, self.whole, self.exact, &slow, seed);
            self.fading = true;
            self.fade = 0.0;
        }
        let mut out = self.current.tick(&self.lines, &frame);
        if self.fading {
            let arriving = self.next.tick(&self.lines, &frame);
            self.fade = (self.fade + self.fade_step).min(1.0);
            for (a, b) in out.wet.iter_mut().zip(arriving.wet) {
                *a = lerp(*a, b, self.fade);
            }
            for (a, b) in out.write.iter_mut().zip(arriving.write) {
                *a = lerp(*a, b, self.fade);
            }
            if self.fade >= 1.0 {
                core::mem::swap(&mut self.current, &mut self.next);
                self.fading = false;
            }
        }

        // What Hold recirculates: the memory one loop back, sample for sample.
        let mut held = [0.0_f32; N];
        if hold > 0.0 {
            for (c, held) in held.iter_mut().enumerate() {
                let source = if self.hold_crossed { (c + 1) % N } else { c };
                if let Some(line) = self.lines.get(source) {
                    *held = read_whole(line, self.hold_length);
                }
            }
        }
        for ((line, write), held) in self.lines.iter_mut().zip(out.write).zip(held) {
            let normal = guard(flush(write));
            line.write(if hold >= 1.0 {
                held
            } else if hold > 0.0 {
                lerp(normal, held, hold)
            } else {
                normal
            });
        }

        // Stereo spread and chorus act on the repeats only, after the loop.
        self.chorus_phase += self.chorus_step;
        if self.chorus_phase >= 1.0 {
            self.chorus_phase -= 1.0;
        }
        let (trail, chorus) = (self.trail.next(), self.chorus.next());
        let mut result = [0.0_f32; N];
        for (c, (((spread, wet), x), y)) in self
            .spread
            .iter_mut()
            .zip(out.wet)
            .zip(dry)
            .zip(&mut result)
            .enumerate()
        {
            let wet = flush(wet);
            spread.write(wet);
            let (trail, phase) = if c == 0 {
                (0.0, self.chorus_phase)
            } else {
                (trail, self.chorus_phase + 0.5 * width)
            };
            let delay = trail + chorus * (1.0 + smooth_wave(phase));
            let repeats = if delay > 0.0 { spread.read(delay) } else { wet };
            *y = x * dry_gain + repeats;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_that_are_not_numbers_are_ignored() {
        let mut engine = Engine::<2>::new(48_000.0);
        let good = Settings {
            mix: 0.5,
            feedback: 0.9,
            ..Settings::default()
        };
        engine.set(&good);
        let bad = Settings {
            seconds: f32::NAN,
            feedback: f32::INFINITY,
            tone: f32::NAN,
            modulation: f32::NAN,
            age: f32::NAN,
            spacing: f32::NAN,
            width: f32::NAN,
            mix: f32::NAN,
            ..good
        };
        for mode in Mode::ALL {
            engine.set(&Settings { mode, ..bad });
            assert_eq!(engine.settings, Settings { mode, ..good });
            for i in 0..4800 {
                let x = if i % 7 == 0 { 0.5 } else { -0.25 };
                let [left, right] = engine.tick([x, -x]);
                assert!(left.is_finite() && right.is_finite());
            }
        }
        // Out-of-range values are clamped, not trusted.
        engine.set(&Settings {
            seconds: 1.0e9,
            feedback: 50.0,
            mix: -3.0,
            ..good
        });
        assert_eq!(engine.settings.seconds, MAX_SECONDS);
        assert_eq!(engine.settings.feedback, 1.1);
        assert_eq!(engine.settings.mix, 0.0);
    }

    #[test]
    fn the_memory_holds_four_seconds_and_two_reverse_windows_at_every_rate() {
        for rate in [44_100.0_f32, 48_000.0, 88_200.0, 96_000.0] {
            let engine = Engine::<1>::new(rate);
            assert_eq!(engine.sample_rate(), rate);
            // Four seconds, plus the 1.2% a worn tape can wobble.
            assert!(engine.longest as f32 > 4.05 * rate);
            assert!(engine.current.longest_window() as f32 > 2.5 * rate);
            assert!(format!("{engine:?}").len() < 400);
        }
    }
}
