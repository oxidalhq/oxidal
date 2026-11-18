//! The wet half: Smear, Delay and Slip, with Chance, Freeze and Tone.
//!
//! Each mode keeps its own memory and takes its input through its own fade,
//! so the old mode's tail rings out after a change. All times are counted in
//! engine steps, so they stretch as the Clock falls.
//! @see docs/native-moment.md

use crate::controls::WetMode;
use crate::memory::knee;
use core::f32::consts::{PI, TAU};
use oxidal_dsp::{DelayLine, DiffuserAllpass, Noise, OnePole, Smoothed};

/// Steps a change of mode takes.
const MODE_STEPS: f32 = 1024.0;
/// Steps the input gate takes to open or close.
const GATE_STEPS: f32 = 64.0;
/// Steps a Delay time change crossfades over.
const JUMP_STEPS: f32 = 1024.0;
/// Milliseconds Smear's size and Slip's window glide over.
const GLIDE_MS: f32 = 80.0;
/// Feedback of a mode that is no longer in use, so its tail ends.
const TAIL_FEEDBACK: f32 = 0.9;
/// Steps a change of feedback takes, so that it writes no step into a memory.
const FEEDBACK_STEPS: f32 = 256.0;
/// Milliseconds Shape and Width glide over.
const CONTROL_MS: f32 = 30.0;
/// Output below this counts as silence.
const QUIET: f32 = 1.0e-5;

/// Smear's output taps, as fractions of its size: the fractional parts of the
/// first five multiples of the golden ratio, sorted.
const TAP_PLACES: [f32; 5] = [0.090, 0.236, 0.472, 0.618, 0.854];
/// Smear's diffusers, as fractions of its size: ratios of Fibonacci numbers.
const DIFFUSER_PLACES: [f32; 4] = [0.034, 0.055, 0.089, 0.144];
/// The diffusers' gain with Shape at its top.
const DIFFUSER_GAIN: f32 = 0.72;

const SMEAR_SECONDS: (f32, f32) = (0.05, 12.0);
const DELAY_SECONDS: (f32, f32) = (0.02, 100.0);
const SLIP_SECONDS: (f32, f32) = (0.03, 33.3);

/// The time a mode's Time control selects, in steps.
pub fn period(mode: WetMode, time: f32, rate: f32) -> f32 {
    let (shortest, range) = match mode {
        WetMode::Smear => SMEAR_SECONDS,
        WetMode::Delay => DELAY_SECONDS,
        WetMode::Slip => SLIP_SECONDS,
    };
    shortest * range.powf(time) * rate
}

fn longest(mode: WetMode, rate: f32) -> f32 {
    period(mode, 1.0, rate)
}

/// Moves `value` towards `target` by at most `step`.
#[inline]
fn approach(value: f32, target: f32, step: f32) -> f32 {
    value + (target - value).clamp(-step, step)
}

/// The controls of the wet half for one block.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WetSettings {
    pub on: bool,
    pub mode: WetMode,
    pub time: f32,
    pub shape: f32,
    pub tone: f32,
    pub chance: f32,
    pub freeze: bool,
    pub width: f32,
    /// A time in steps that replaces the Time control.
    pub linked: Option<f32>,
}

impl Default for WetSettings {
    fn default() -> Self {
        Self {
            on: true,
            mode: WetMode::Smear,
            time: 0.5,
            shape: 0.5,
            tone: 0.7,
            chance: 1.0,
            freeze: false,
            width: 0.0,
            linked: None,
        }
    }
}

/// A multi-tap delay whose repeats pass through all-pass diffusers: separate
/// echoes with Shape low, a wash with Shape high.
#[derive(Debug)]
struct Smear<const N: usize> {
    lines: [DelayLine; N],
    diffusers: [[DiffuserAllpass; 4]; N],
    damping: [OnePole; N],
    size: Smoothed,
    target: f32,
    /// Diffuser delays per step of size; whole samples once the size settles.
    places: [f32; 4],
    tap_gains: [f32; 5],
    /// How far the damping is lifted while frozen, 0 to 1.
    held: f32,
}

impl<const N: usize> Smear<N> {
    fn new(rate: f32) -> Self {
        let most = longest(WetMode::Smear, rate) as usize + 8;
        let longest_diffuser = (most as f32 * DIFFUSER_PLACES[3]) as usize + 8;
        let mut tap_gains = TAP_PLACES.map(|place| 1.0 - 0.5 * place);
        let energy: f32 = tap_gains.iter().map(|g| g * g).sum();
        for gain in &mut tap_gains {
            *gain /= energy.sqrt();
        }
        let start = period(WetMode::Smear, 0.5, rate).round();
        Self {
            lines: core::array::from_fn(|_| DelayLine::new(most)),
            diffusers: core::array::from_fn(|_| {
                core::array::from_fn(|_| DiffuserAllpass::new(longest_diffuser))
            }),
            damping: [OnePole::default(); N],
            size: Smoothed::new(rate, GLIDE_MS, start),
            target: start,
            places: DIFFUSER_PLACES,
            tap_gains,
            held: 0.0,
        }
    }

    fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
        for diffuser in self.diffusers.iter_mut().flatten() {
            diffuser.clear();
        }
        for pole in &mut self.damping {
            pole.reset(0.0);
        }
        self.held = 0.0;
    }

    fn set_size(&mut self, steps: f32, rate: f32, snap: bool) {
        let target = steps
            .clamp(64.0, longest(WetMode::Smear, rate))
            .round()
            .max(1.0);
        if target != self.target {
            self.target = target;
            self.places = DIFFUSER_PLACES.map(|place| (target * place).round().max(2.0) / target);
        }
        self.size.set(target);
        if snap {
            self.size.snap(target);
        }
    }

    #[inline]
    fn step(&mut self, x: [f32; N], shape: f32, feedback: f32, hold: bool, width: f32) -> [f32; N] {
        let size = self.size.next();
        let gain = DIFFUSER_GAIN * shape;
        self.held = approach(self.held, if hold { 1.0 } else { 0.0 }, 1.0 / GATE_STEPS);
        let mut out = [0.0; N];
        for channel in 0..N {
            let delayed = self.lines[channel].read_cubic(size);
            let mut diffused = knee(x[channel] + delayed * feedback);
            for (diffuser, place) in self.diffusers[channel].iter_mut().zip(self.places) {
                diffused = diffuser.process(diffused, size * place, gain);
            }
            let damped = self.damping[channel].lowpass(diffused);
            let stored = damped + (diffused - damped) * self.held;
            let mut sum = 0.0;
            for (index, (place, tap)) in TAP_PLACES.iter().zip(self.tap_gains).enumerate() {
                // In stereo, odd taps lean to one side and even taps to the other.
                let side = if N == 2 && (index + channel).is_multiple_of(2) {
                    1.0 - width
                } else {
                    1.0
                };
                sum += self.lines[channel].read_cubic(size * place) * tap * side;
            }
            self.lines[channel].write(knee(stored));
            out[channel] = sum + diffused * shape * 0.7;
        }
        out
    }
}

/// A clean delay; a time change crossfades, so existing repeats do not bend.
#[derive(Debug)]
struct Delay<const N: usize> {
    lines: [DelayLine; N],
    current: usize,
    previous: usize,
    target: usize,
    fade: f32,
}

impl<const N: usize> Delay<N> {
    fn new(rate: f32) -> Self {
        let most = longest(WetMode::Delay, rate) as usize + 8;
        let start = period(WetMode::Delay, 0.5, rate).round() as usize;
        Self {
            lines: core::array::from_fn(|_| DelayLine::new(most)),
            current: start,
            previous: start,
            target: start,
            fade: 1.0,
        }
    }

    fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
    }

    fn set_time(&mut self, steps: f32, rate: f32, snap: bool) {
        self.target = steps.clamp(1.0, longest(WetMode::Delay, rate)).round() as usize;
        if snap {
            self.current = self.target;
            self.previous = self.target;
            self.fade = 1.0;
        }
    }

    #[inline]
    fn step(&mut self, x: [f32; N], feedback: f32, width: f32) -> [f32; N] {
        if self.fade >= 1.0 && self.target != self.current {
            self.previous = self.current;
            self.current = self.target;
            self.fade = 0.0;
        }
        self.fade = (self.fade + 1.0 / JUMP_STEPS).min(1.0);
        let mut out = [0.0; N];
        for channel in 0..N {
            let old = self.lines[channel].tap(self.previous.saturating_sub(1));
            let new = self.lines[channel].tap(self.current.saturating_sub(1));
            out[channel] = old + (new - old) * self.fade;
        }
        for channel in 0..N {
            // In stereo the input moves to the left line and the lines feed
            // each other, which makes the repeats cross from side to side.
            let other = (channel + 1) % N;
            let input = match (N, channel) {
                (2, 0) => x[0] + (0.5 * (x[0] + x[1]) - x[0]) * width,
                (2, _) => x[channel] * (1.0 - width),
                _ => x[channel],
            };
            let repeat = out[channel] + (out[other] - out[channel]) * width;
            self.lines[channel].write(knee(input + repeat * feedback));
        }
        out
    }
}

/// Plays the recent input back faster or backwards through two crossfaded
/// read positions that slide through a short memory.
#[derive(Debug)]
struct Slip<const N: usize> {
    lines: [DelayLine; N],
    window: Smoothed,
    phase: f32,
    pan_phase: f32,
}

impl<const N: usize> Slip<N> {
    fn new(rate: f32) -> Self {
        let most = longest(WetMode::Slip, rate) as usize + 16;
        Self {
            lines: core::array::from_fn(|_| DelayLine::new(most)),
            window: Smoothed::new(rate, GLIDE_MS, period(WetMode::Slip, 0.5, rate)),
            phase: 0.5,
            pan_phase: 0.0,
        }
    }

    fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
        self.phase = 0.5;
        self.pan_phase = 0.0;
    }

    fn set_window(&mut self, steps: f32, rate: f32, snap: bool) {
        let target = steps.clamp(64.0, longest(WetMode::Slip, rate));
        self.window.set(target);
        if snap {
            self.window.snap(target);
        }
    }

    #[inline]
    fn step(&mut self, x: [f32; N], speed: f32, hold: bool, width: f32) -> [f32; N] {
        if !hold {
            for (line, sample) in self.lines.iter_mut().zip(x) {
                line.write(knee(sample));
            }
        }
        let window = self.window.next();
        // While frozen nothing is written, so the reads travel by their own speed.
        let travel = if hold { -speed } else { 1.0 - speed };
        let mut phase = self.phase + travel / window;
        if !hold && travel.abs() < 1.0e-4 {
            // At normal speed one read position settles in the window's middle.
            phase += (0.5 - phase) * 1.0e-3;
        }
        phase -= phase.floor();
        self.phase = phase;
        let other = if phase < 0.5 {
            phase + 0.5
        } else {
            phase - 0.5
        };
        let swing = (PI * phase).sin();
        let first = swing * swing;

        self.pan_phase += 0.25 / window;
        self.pan_phase -= self.pan_phase.floor();
        let pan = (TAU * self.pan_phase).sin() * width;

        let mut out = [0.0; N];
        for channel in 0..N {
            let a = self.lines[channel].read_cubic(phase * window + 1.0);
            let b = self.lines[channel].read_cubic(other * window + 1.0);
            let side = match (N, channel) {
                (2, 0) => 1.0 - pan.max(0.0),
                (2, _) => 1.0 + pan.min(0.0),
                _ => 1.0,
            };
            out[channel] = (a * first + b * (1.0 - first)) * side;
        }
        out
    }
}

/// The speed Slip plays at for a Shape value: in semitone steps up to an
/// octave, forwards from the middle upwards and backwards below the middle.
pub fn slip_speed(shape: f32) -> f32 {
    let semitones = ((shape - 0.5).abs() * 24.0).round();
    let speed = 2.0_f32.powf(semitones / 12.0);
    if shape < 0.5 { -speed } else { speed }
}

#[derive(Debug)]
pub struct Wet<const N: usize> {
    rate: f32,
    settings: WetSettings,
    smear: Smear<N>,
    delay: Delay<N>,
    slip: Slip<N>,
    /// Input fade of each mode, and how long each has been silent.
    gains: [f32; 3],
    quiet: [u32; 3],
    limits: [u32; 3],
    gate: f32,
    open: bool,
    countdown: f32,
    period: f32,
    slip_speed: f32,
    shape: Smoothed,
    width: Smoothed,
    smear_feedback: f32,
    delay_feedback: f32,
    noise: Noise,
    tone: [OnePole; N],
    started: bool,
}

impl<const N: usize> Wet<N> {
    pub fn new(rate: f32) -> Self {
        let limits = WetMode::ALL.map(|mode| longest(mode, rate) as u32 + 16);
        Self {
            rate,
            settings: WetSettings::default(),
            smear: Smear::new(rate),
            delay: Delay::new(rate),
            slip: Slip::new(rate),
            gains: [0.0; 3],
            quiet: limits,
            limits,
            gate: 1.0,
            open: true,
            countdown: 0.0,
            period: rate,
            slip_speed: 1.0,
            shape: Smoothed::new(rate, CONTROL_MS, 0.5),
            width: Smoothed::new(rate, CONTROL_MS, 0.0),
            smear_feedback: 0.55,
            delay_feedback: 0.5,
            noise: Noise::new(0x4d4f_4d54),
            tone: [OnePole::default(); N],
            started: false,
        }
    }

    pub fn reset(&mut self) {
        self.smear.clear();
        self.delay.clear();
        self.slip.clear();
        self.gains = [0.0; 3];
        self.quiet = self.limits;
        self.gate = 1.0;
        self.open = true;
        self.countdown = 0.0;
        for pole in &mut self.tone {
            pole.reset(0.0);
        }
        self.started = false;
    }

    pub fn set(&mut self, settings: WetSettings) {
        let snap = !self.started;
        self.settings = settings;
        let time = |mode| {
            settings
                .linked
                .unwrap_or(period(mode, settings.time, self.rate))
        };
        self.smear.set_size(time(WetMode::Smear), self.rate, snap);
        self.delay.set_time(time(WetMode::Delay), self.rate, snap);
        self.slip.set_window(time(WetMode::Slip), self.rate, snap);
        self.period = time(settings.mode).max(1.0);
        self.slip_speed = slip_speed(settings.shape);
        self.shape.set(settings.shape);
        self.width.set(settings.width);
        let corner = 300.0 * (20_000.0_f32 / 300.0).powf(settings.tone);
        for pole in self.tone.iter_mut().chain(self.smear.damping.iter_mut()) {
            pole.set_cutoff(self.rate, corner);
        }
        if snap {
            self.shape.snap(settings.shape);
            self.width.snap(settings.width);
            self.smear_feedback = 0.25 + 0.6 * settings.time;
            self.delay_feedback = settings.shape;
            let index = Self::index(settings.mode);
            if settings.on {
                self.gains[index] = 1.0;
            }
            if settings.chance <= 0.0 || settings.freeze {
                self.gate = 0.0;
            }
            self.started = true;
        }
    }

    fn index(mode: WetMode) -> usize {
        match mode {
            WetMode::Smear => 0,
            WetMode::Delay => 1,
            WetMode::Slip => 2,
        }
    }

    /// Chance: once per period, decides whether the input may enter next.
    fn update_gate(&mut self) {
        let chance = self.settings.chance;
        self.countdown -= 1.0;
        if self.countdown <= 0.0 {
            self.countdown = self.period;
            self.open = 0.5 * (self.noise.next() + 1.0) < chance;
        }
        if chance >= 1.0 {
            self.open = true;
        } else if chance <= 0.0 {
            self.open = false;
        }
        let target = if self.open && !self.settings.freeze {
            1.0
        } else {
            0.0
        };
        self.gate = approach(self.gate, target, 1.0 / GATE_STEPS);
    }

    /// One engine step.
    pub fn step(&mut self, input: [f32; N]) -> [f32; N] {
        let settings = self.settings;
        self.update_gate();
        let shape = self.shape.next();
        let width = self.width.next();
        let mut sum = [0.0; N];
        for (index, mode) in WetMode::ALL.into_iter().enumerate() {
            let selected = mode == settings.mode;
            let wanted = selected && settings.on;
            let target = if wanted { 1.0 } else { 0.0 };
            self.gains[index] = approach(self.gains[index], target, 1.0 / MODE_STEPS);
            if self.gains[index] <= 0.0 && self.quiet[index] >= self.limits[index] {
                continue;
            }
            let fade = self.gate * self.gains[index];
            let feed = input.map(|x| x * fade);
            let hold = selected && settings.freeze;
            let out = match mode {
                WetMode::Smear => {
                    let target = if hold {
                        1.0
                    } else {
                        0.25 + 0.6 * settings.time
                    };
                    self.smear_feedback =
                        approach(self.smear_feedback, target, 1.0 / FEEDBACK_STEPS);
                    self.smear
                        .step(feed, shape, self.smear_feedback, hold, width)
                }
                WetMode::Delay => {
                    let target = if hold {
                        1.0
                    } else if wanted {
                        settings.shape
                    } else {
                        settings.shape.min(TAIL_FEEDBACK)
                    };
                    self.delay_feedback =
                        approach(self.delay_feedback, target, 1.0 / FEEDBACK_STEPS);
                    self.delay.step(feed, self.delay_feedback, width)
                }
                WetMode::Slip => self.slip.step(feed, self.slip_speed, hold, width),
            };
            let mut loudest = 0.0_f32;
            for (total, y) in sum.iter_mut().zip(out) {
                *total += y;
                loudest = loudest.max(y.abs());
            }
            self.quiet[index] = if loudest < QUIET {
                self.quiet[index].saturating_add(1)
            } else {
                0
            };
        }
        for (y, pole) in sum.iter_mut().zip(self.tone.iter_mut()) {
            *y = pole.lowpass(*y);
        }
        sum
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_spans_each_modes_range() {
        let rate = 48_000.0;
        assert!((period(WetMode::Smear, 0.0, rate) - 2400.0).abs() < 0.5);
        assert!((period(WetMode::Smear, 1.0, rate) - 28_800.0).abs() < 1.0);
        assert!((period(WetMode::Delay, 0.0, rate) - 960.0).abs() < 0.5);
        assert!((period(WetMode::Delay, 1.0, rate) - 96_000.0).abs() < 1.0);
        assert!((period(WetMode::Slip, 1.0, rate) - 47_952.0).abs() < 1.0);
    }

    #[test]
    fn slip_moves_in_semitones_up_to_an_octave_either_way() {
        assert_eq!(slip_speed(0.5), 1.0);
        assert!((slip_speed(1.0) - 2.0).abs() < 1.0e-5);
        assert!((slip_speed(0.0) + 2.0).abs() < 1.0e-5);
        assert!((slip_speed(0.75) - 2.0_f32.powf(0.5)).abs() < 1.0e-5);
    }
}
