//! Small parts the reverb engines share: control interpolation, delay taps
//! that crossfade when their length changes, the diffusing all-pass, the
//! absorption filter and the settings every engine reads.
//!
//! # References
//!
//! - Jot and Chaigne, "Digital Delay Networks for Designing Artificial Reverberators" (1991). <https://aes2.org/publications/elibrary-page/?id=5663>
//! - Schroeder, "Natural Sounding Artificial Reverberation" (1962). <https://aes2.org/publications/elibrary-page/?id=849>
//!
//! @see docs/native-bloom.md

use oxidal_dsp::{DelayLine, Smoothed};

/// Control values move once every this many samples; gains that multiply
/// audio are interpolated in a straight line in between.
pub const TICK: usize = 16;

/// A delay length change crossfades over this long.
pub const FADE_SECONDS: f32 = 0.04;

/// An engine that no longer receives input rings out with at most this decay
/// time, so two engines never run side by side for long.
pub const RING_OUT_SECONDS: f32 = 6.0;

/// The natural logarithm of 1000: a level falls 60 dB over one decay time.
pub const LN_1000: f32 = 6.907_755;

/// The control values an engine reads at every tick. Continuous values are
/// already smoothed at the tick rate.
#[derive(Debug, Clone, Copy)]
pub struct Settings {
    /// Mode number, 0 to 7, in the order of the Mode control.
    pub mode: usize,
    /// Decay time in seconds.
    pub decay: f32,
    /// Size, 0 to 1.
    pub size: f32,
    /// Tone, 0 (dark) to 1 (no damping).
    pub tone: f32,
    /// Modulation depth, 0 to 1.
    pub modulation: f32,
    /// Modulation speed trim, 0 to 1 (0.5 is the mode's own rate).
    pub speed: f32,
    /// Shimmer amount, 0 to 1.
    pub shimmer: f32,
    /// Shimmer interval: 0 octave up, 1 fifth up, 2 octave down.
    pub interval: usize,
    /// Nonlinear shape: 0 gate, 1 reverse, 2 swell.
    pub shape: usize,
    /// Bloom build time in seconds.
    pub build: f32,
    /// Freeze target: 1 held, 0 released.
    pub freeze: f32,
}

/// One reverb engine: a group of modes that share their memory.
pub trait Engine {
    /// One control tick. `active` is false while the engine only rings out;
    /// `snap` sets everything at once, when the effect starts or the engine
    /// wakes with its memory clear.
    fn tick(&mut self, settings: &Settings, active: bool, snap: bool);
    /// Processes one stretch of at most [`TICK`] samples, adding the wet
    /// signal to the outputs. Returns the largest level seen inside, which
    /// decides when the engine may sleep.
    fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) -> f32;
    /// Clears one buffer per call, so going to sleep never costs one long
    /// block. Returns true when `step` was the last.
    fn clear_step(&mut self, step: usize) -> bool;
    /// Clears every memory at once.
    fn reset(&mut self) {
        let mut step = 0;
        while !self.clear_step(step) {
            step += 1;
        }
    }
}

/// A value that moves in a straight line from one tick to the next.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lin {
    value: f32,
    target: f32,
    step: f32,
}

impl Lin {
    pub fn snap(&mut self, value: f32) {
        self.value = value;
        self.target = value;
        self.step = 0.0;
    }
    /// Called once per tick: lands exactly on the previous target and heads
    /// for the new one.
    pub fn aim(&mut self, target: f32) {
        self.value = self.target;
        self.target = target;
        self.step = (target - self.value) * (1.0 / TICK as f32);
    }
    /// The value for this sample; advances one sample.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        let now = self.value;
        self.value += self.step;
        now
    }
    /// True while the value sits at `value` and is not moving.
    pub fn rests_at(&self, value: f32) -> bool {
        self.value == value && self.target == value
    }
    pub fn target(&self) -> f32 {
        self.target
    }
    /// `aim`, or `snap` when the effect is being set up.
    pub fn drive(&mut self, target: f32, snap: bool) {
        if snap {
            self.snap(target);
        } else {
            self.aim(target);
        }
    }
}

/// One tick of a tick-rate smoother towards `target`; `snap` jumps there.
pub fn follow(smoothed: &mut Smoothed, target: f32, snap: bool) -> f32 {
    if snap {
        smoothed.snap(target);
        target
    } else {
        smoothed.set(target);
        smoothed.next()
    }
}

/// A smoother that runs at the tick rate.
pub fn tick_smoother(sample_rate: f32, milliseconds: f32, value: f32) -> Smoothed {
    Smoothed::new(sample_rate / TICK as f32, milliseconds, value)
}

/// A control that glides with a one-pole lag at the tick rate and is
/// interpolated per sample: nothing that multiplies audio ever steps.
#[derive(Debug, Clone, Copy)]
pub struct Glide {
    smooth: Smoothed,
    lin: Lin,
}

impl Glide {
    pub fn new(sample_rate: f32, milliseconds: f32, value: f32) -> Self {
        let mut lin = Lin::default();
        lin.snap(value);
        Self {
            smooth: Smoothed::new(sample_rate / TICK as f32, milliseconds, value),
            lin,
        }
    }
    pub fn snap(&mut self, value: f32) {
        self.smooth.snap(value);
        self.lin.snap(value);
    }
    /// Called once per tick with the newest target.
    pub fn tick(&mut self, target: f32) {
        self.smooth.set(target);
        self.lin.aim(self.smooth.next());
    }
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        self.lin.next()
    }
    pub fn rests_at(&self, value: f32) -> bool {
        self.lin.rests_at(value)
    }
    /// `tick`, or `snap` when the effect is being set up.
    pub fn drive(&mut self, target: f32, snap: bool) {
        if snap {
            self.snap(target);
        } else {
            self.tick(target);
        }
    }
}

/// Third-order Lagrange read at a fractional delay (the polynomial through
/// the four nearest samples). Its gain is at most one at every frequency, so
/// it is safe inside a feedback loop.
#[inline]
pub fn read_lagrange(line: &DelayLine, delay: f32) -> f32 {
    let limit = (line.capacity() as f32 - 3.0).max(1.0);
    let clamped = if delay.is_finite() {
        delay.clamp(1.0, limit)
    } else {
        1.0
    };
    let whole = (clamped as usize).max(1);
    let t = clamped - whole as f32;
    let (tm1, tm2, tp1) = (t - 1.0, t - 2.0, t + 1.0);
    line.tap(whole - 1) * (-t * tm1 * tm2 * (1.0 / 6.0))
        + line.tap(whole) * (tp1 * tm1 * tm2 * 0.5)
        + line.tap(whole + 1) * (-tp1 * t * tm2 * 0.5)
        + line.tap(whole + 2) * (tp1 * t * tm1 * (1.0 / 6.0))
}

/// A read position in a delay line. When the wanted delay changes, the tap
/// crossfades from the old position to the new one instead of sliding, so a
/// length change neither clicks nor bends the pitch. The fade is a convex
/// blend of two taps, so it never adds gain to a loop.
#[derive(Debug, Clone, Copy)]
pub struct FadingTap {
    from: usize,
    to: usize,
    mix: f32,
    step: f32,
}

impl FadingTap {
    pub fn new(sample_rate: f32, delay: usize) -> Self {
        Self {
            from: delay,
            to: delay,
            mix: 1.0,
            step: 1.0 / (FADE_SECONDS * sample_rate).max(1.0),
        }
    }
    pub fn snap(&mut self, delay: usize) {
        self.from = delay;
        self.to = delay;
        self.mix = 1.0;
    }
    pub fn idle(&self) -> bool {
        self.mix >= 1.0
    }
    /// Starts a crossfade to `delay` unless one is running.
    pub fn aim(&mut self, delay: usize) {
        if self.idle() && delay != self.to {
            self.from = self.to;
            self.to = delay;
            self.mix = 0.0;
        }
    }
    pub fn target(&self) -> usize {
        self.to
    }
    /// `aim`, or `snap` when the effect is being set up.
    pub fn drive(&mut self, delay: usize, snap: bool) {
        if snap {
            self.snap(delay);
        } else {
            self.aim(delay);
        }
    }
    #[inline]
    fn blend(&mut self, a: f32, b: f32) -> f32 {
        let m = self.mix;
        self.mix += self.step;
        a + (b - a) * (m * m * (3.0 - 2.0 * m))
    }
    /// The sample at the tap; advances a running crossfade by one sample.
    #[inline]
    pub fn read(&mut self, line: &DelayLine) -> f32 {
        if self.mix >= 1.0 {
            line.tap(self.to)
        } else {
            let (a, b) = (line.tap(self.from), line.tap(self.to));
            self.blend(a, b)
        }
    }
    /// As `read`, but `back` samples nearer the newest sample.
    #[inline]
    pub fn read_back(&mut self, line: &DelayLine, back: usize) -> f32 {
        if self.mix >= 1.0 {
            line.tap(self.to.saturating_sub(back))
        } else {
            let a = line.tap(self.from.saturating_sub(back));
            let b = line.tap(self.to.saturating_sub(back));
            self.blend(a, b)
        }
    }
    /// As `read`, at a fractional `offset` in samples from the tap.
    #[inline]
    pub fn read_frac(&mut self, line: &DelayLine, offset: f32) -> f32 {
        if self.mix >= 1.0 {
            read_lagrange(line, self.to as f32 + offset)
        } else {
            let a = read_lagrange(line, self.from as f32 + offset);
            let b = read_lagrange(line, self.to as f32 + offset);
            self.blend(a, b)
        }
    }
}

/// Delay-line all-pass diffuser (Schroeder form) whose length can change by
/// crossfade. The delay is in samples and at least one.
#[derive(Debug, Clone)]
pub struct Allpass {
    line: DelayLine,
    tap: FadingTap,
}

impl Allpass {
    /// Allocates for delays up to `max_samples`. Not for the audio thread.
    pub fn new(sample_rate: f32, max_samples: usize) -> Self {
        Self {
            line: DelayLine::new(max_samples + 4),
            tap: FadingTap::new(sample_rate, 1),
        }
    }
    fn limit(&self, delay: usize) -> usize {
        delay.clamp(1, self.line.capacity().saturating_sub(4).max(1)) - 1
    }
    pub fn snap(&mut self, delay: usize) {
        self.tap.snap(self.limit(delay));
    }
    pub fn aim(&mut self, delay: usize) {
        self.tap.aim(self.limit(delay));
    }
    pub fn idle(&self) -> bool {
        self.tap.idle()
    }
    /// `aim`, or `snap` when the effect is being set up.
    pub fn drive(&mut self, delay: usize, snap: bool) {
        self.tap.drive(self.limit(delay), snap);
    }
    /// The delay the all-pass is at or fading to, in samples.
    pub fn delay(&self) -> usize {
        self.tap.target() + 1
    }
    pub fn clear(&mut self) {
        self.line.clear();
    }
    /// The memory inside the all-pass, for output taps.
    pub fn line(&self) -> &DelayLine {
        &self.line
    }
    #[inline]
    fn finish(&mut self, x: f32, delayed: f32, gain: f32) -> f32 {
        let inner = x + gain * delayed;
        self.line.write(inner);
        delayed - gain * inner
    }
    #[inline]
    pub fn process(&mut self, x: f32, gain: f32) -> f32 {
        let delayed = self.tap.read(&self.line);
        self.finish(x, delayed, gain)
    }
    /// With the delay attenuated by `inner`, for an all-pass inside a
    /// decaying loop: its poles then decay at the loop's own rate.
    #[inline]
    pub fn process_lossy(&mut self, x: f32, gain: f32, inner: f32) -> f32 {
        let delayed = inner * self.tap.read(&self.line);
        self.finish(x, delayed, gain)
    }
    /// As `process_lossy`, with the delay read `offset` samples away, for
    /// slow modulation.
    #[inline]
    pub fn process_frac(&mut self, x: f32, gain: f32, inner: f32, offset: f32) -> f32 {
        let delayed = inner * self.tap.read_frac(&self.line, offset);
        self.finish(x, delayed, gain)
    }
}

/// Coefficient of the one-pole low-pass inside [`absorb`] and the largest
/// high-frequency cut it can make, for a corner at `hertz`.
pub fn absorb_corner(sample_rate: f32, hertz: f32) -> (f32, f32) {
    let limited = hertz.clamp(20.0, 0.45 * sample_rate);
    let coefficient = 1.0 - (-core::f32::consts::TAU * limited / sample_rate).exp();
    (coefficient, (2.0 - 2.0 * coefficient) / (2.0 - coefficient))
}

/// The `cut` of [`absorb`] that leaves the top of the band at `ratio` times
/// the gain below the corner; `reach` comes from [`absorb_corner`].
pub fn absorb_cut(ratio: f32, reach: f32) -> f32 {
    ((1.0 - ratio) / reach.max(1.0e-3)).clamp(0.0, 1.0)
}

/// Absorption filter of a decaying loop: gain `gain` below the corner,
/// falling above it by `cut` times a one-pole high-pass. Its gain never
/// exceeds `gain`, and with `cut` at zero it is exactly `gain * x`.
#[inline]
pub fn absorb(state: &mut f32, x: f32, coefficient: f32, gain: f32, cut: f32) -> f32 {
    *state += (x - *state) * coefficient;
    gain * (x - cut * (x - *state))
}

/// Loop gain that gives a decay of 60 dB in `seconds` for a loop of
/// `loop_seconds`; `hold` from 0 to 1 moves it to exactly one (no decay).
pub fn loop_gain(loop_seconds: f32, seconds: f32, hold: f32) -> f32 {
    let rate = -LN_1000 / seconds.max(0.01) * (1.0 - hold.clamp(0.0, 1.0));
    (rate * loop_seconds).exp().min(1.0)
}

/// Input level trim so that long decays do not grow as loud as their energy
/// would make them: steady level rises with the fourth root of the decay
/// time instead of its square root.
pub fn decay_trim(seconds: f32) -> f32 {
    (2.5 / seconds.clamp(0.1, 60.0)).sqrt().sqrt()
}

/// `sin` and `cos` gains of an energy-keeping blend that puts `share` of the
/// power on the second path. The pair is rounded so that the squares never
/// sum above one: a loop that uses it cannot gain energy.
pub fn passive_pair(share: f32) -> (f32, f32) {
    let second = share.clamp(0.0, 1.0).sqrt();
    let wide = f64::from(second);
    let first = ((1.0 - wide * wide).max(0.0).sqrt() as f32)
        .next_down()
        .max(0.0);
    (first, second)
}

/// A bound for a signal that should never be loud: nearly linear below one,
/// never beyond four.
#[inline]
pub fn guard(x: f32) -> f32 {
    4.0 * oxidal_dsp::soft_clip(0.25 * x)
}

/// Writes a short `Debug` for a type that holds large buffers.
macro_rules! opaque_debug {
    ($name:ident) => {
        impl core::fmt::Debug for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                f.debug_struct(stringify!($name)).finish_non_exhaustive()
            }
        }
    };
}
pub(crate) use opaque_debug;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lagrange_read_is_exact_on_a_cubic_and_passive() {
        let mut line = DelayLine::new(64);
        for i in 0..40 {
            let x = i as f32 * 0.1;
            line.write(x * x * x - x);
        }
        // Newest sample is i = 39; a delay of 10.3 is i = 28.7.
        let x = 28.7_f32 * 0.1;
        assert!((read_lagrange(&line, 10.3) - (x * x * x - x)).abs() < 1e-3);
        // Weights sum to one and their absolute sum stays small.
        for step in 0..=20 {
            let t = step as f32 / 20.0;
            let (tm1, tm2, tp1) = (t - 1.0, t - 2.0, t + 1.0);
            let w = [
                -t * tm1 * tm2 / 6.0,
                tp1 * tm1 * tm2 * 0.5,
                -tp1 * t * tm2 * 0.5,
                tp1 * t * tm1 / 6.0,
            ];
            assert!((w.iter().sum::<f32>() - 1.0).abs() < 1e-6);
            // Gain at half the sample rate: alternating sum, at most one.
            assert!((w[0] - w[1] + w[2] - w[3]).abs() <= 1.0 + 1e-6);
        }
    }

    #[test]
    fn fading_tap_moves_without_a_step() {
        let mut line = DelayLine::new(4096);
        let mut tap = FadingTap::new(48_000.0, 100);
        let mut last = 0.0;
        let mut worst = 0.0_f32;
        for i in 0..20_000 {
            line.write((i as f32 * 0.01).sin());
            if i == 8000 {
                tap.aim(1700);
            }
            let y = tap.read(&line);
            if i > 200 {
                worst = worst.max((y - last).abs());
            }
            last = y;
        }
        assert!(tap.idle() && tap.target() == 1700);
        assert!(worst < 0.012, "step {worst}");
    }

    #[test]
    fn allpass_keeps_energy_and_absorb_never_gains() {
        let mut allpass = Allpass::new(48_000.0, 700);
        allpass.snap(613);
        let mut noise = oxidal_dsp::Noise::new(3);
        let (mut input, mut output) = (0.0_f64, 0.0_f64);
        for _ in 0..200_000 {
            let x = noise.next();
            let y = allpass.process(x, 0.6);
            input += f64::from(x * x);
            output += f64::from(y * y);
        }
        assert!((output / input - 1.0).abs() < 0.02);
        let (coefficient, reach) = absorb_corner(48_000.0, 3000.0);
        let cut = absorb_cut(0.5, reach);
        let mut state = 0.0;
        // Alternating input is the top of the band: gain is `ratio`.
        let mut y = 0.0;
        for i in 0..2000 {
            y = absorb(
                &mut state,
                if i % 2 == 0 { 1.0 } else { -1.0 },
                coefficient,
                1.0,
                cut,
            );
        }
        assert!((y.abs() - 0.5).abs() < 0.01);
        let mut state = 0.0;
        assert_eq!(absorb(&mut state, 0.37, coefficient, 1.0, 0.0), 0.37);
    }

    #[test]
    fn passive_pair_never_exceeds_unit_energy() {
        for step in 0..=1000 {
            let (a, b) = passive_pair(step as f32 / 1000.0);
            let energy = f64::from(a) * f64::from(a) + f64::from(b) * f64::from(b);
            assert!(energy <= 1.0 && energy > 0.999_999);
        }
        assert!((loop_gain(0.05, 2.0, 0.0) - 10.0_f32.powf(-3.0 * 0.05 / 2.0)).abs() < 1e-6);
        assert_eq!(loop_gain(0.05, 2.0, 1.0), 1.0);
    }
}
