//! Shared DSP building blocks for Oxidal's own effects.
//!
//! Original code written from the published descriptions listed in
//! `REFERENCES.md`; standard library only. Nothing here allocates after
//! construction, locks or makes a system call, so every block is safe to use
//! on the audio thread.
//!
//! # References
//!
//! - Smith, "Introduction to Digital Filters with Audio Applications" (2007). <https://ccrma.stanford.edu/~jos/filters/>
//! - Catmull and Rom, "A Class of Local Interpolating Splines" (1974). <https://doi.org/10.1016/B978-0-12-079050-0.50020-5>
//! - Zavalishin, "The Art of VA Filter Design" (2018, rev. 2.1.0).
//! - Schroeder, "Natural Sounding Artificial Reverberation" (1962). <https://aes2.org/publications/elibrary-page/?id=849>
//! - Marsaglia, "Xorshift RNGs" (2003). <https://doi.org/10.18637/jss.v008.i14>
//! - Jot and Chaigne, "Digital Delay Networks for Designing Artificial Reverberators" (1991). <https://aes2.org/publications/elibrary-page/?id=5663>
//!
//! @see docs/native-effects.md

use core::f32::consts::{PI, TAU};

/// Decibels to a linear gain.
pub fn db_to_gain(db: f32) -> f32 {
    10.0_f32.powf(db * 0.05)
}

/// A linear gain to decibels, floored at -180 dB.
pub fn gain_to_db(gain: f32) -> f32 {
    20.0 * gain.max(1.0e-9).log10()
}

/// Linear interpolation from `a` to `b`.
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Equal-power crossfade gains for `t` in 0..1, as `(from, to)`.
pub fn equal_power(t: f32) -> (f32, f32) {
    let angle = t.clamp(0.0, 1.0) * (0.5 * PI);
    (angle.cos(), angle.sin())
}

/// Smooth limiter: the algebraic sigmoid `x / sqrt(1 + x^2)`. Unity slope at
/// zero, monotonic, and bounded by +-1 for every input.
pub fn soft_clip(x: f32) -> f32 {
    x / (1.0 + x * x).sqrt()
}

/// The smallest prime at or above `n`, for choosing delay lengths that share
/// no common factor so echoes do not pile up on one period.
pub fn prime_at_or_above(n: usize) -> usize {
    fn is_prime(v: usize) -> bool {
        if v < 2 {
            return false;
        }
        let mut d = 2;
        while d * d <= v {
            if v.is_multiple_of(d) {
                return false;
            }
            d += 1;
        }
        true
    }
    let mut candidate = n;
    while !is_prime(candidate) {
        candidate += 1;
    }
    candidate
}

/// A control value that glides to its target with a one-pole lag, so a knob,
/// a MIDI message or a scene never steps the sound.
#[derive(Debug, Clone, Copy)]
pub struct Smoothed {
    coefficient: f32,
    current: f32,
    target: f32,
}

impl Smoothed {
    /// A smoother with a time constant of `milliseconds`, resting at `value`.
    pub fn new(sample_rate: f32, milliseconds: f32, value: f32) -> Self {
        let mut smoothed = Self {
            coefficient: 1.0,
            current: value,
            target: value,
        };
        smoothed.set_time(sample_rate, milliseconds);
        smoothed
    }
    pub fn set_time(&mut self, sample_rate: f32, milliseconds: f32) {
        let samples = (sample_rate * milliseconds * 0.001).max(1.0);
        self.coefficient = 1.0 - (-1.0 / samples).exp();
    }
    pub fn set(&mut self, target: f32) {
        self.target = target;
    }
    /// Jumps to `value` with no glide.
    pub fn snap(&mut self, value: f32) {
        self.current = value;
        self.target = value;
    }
    /// Advances one sample and returns the new value.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        self.current += (self.target - self.current) * self.coefficient;
        // Single precision stalls just short of the target; finish the glide.
        if self.settled() {
            self.current = self.target;
        }
        self.current
    }
    pub fn current(&self) -> f32 {
        self.current
    }
    pub fn target(&self) -> f32 {
        self.target
    }
    pub fn settled(&self) -> bool {
        (self.target - self.current).abs() < 1.0e-4 * (1.0 + self.target.abs())
    }
}

/// A circular delay memory with whole-sample, linear and cubic reads. Delays
/// are measured in samples behind the most recent write.
#[derive(Debug, Clone)]
pub struct DelayLine {
    data: Vec<f32>,
    mask: usize,
    write: usize,
}

impl DelayLine {
    /// Allocates for at least `max_samples` of delay. Not for the audio thread.
    pub fn new(max_samples: usize) -> Self {
        let size = (max_samples + 4).next_power_of_two().max(8);
        Self {
            data: vec![0.0; size],
            mask: size - 1,
            write: 0,
        }
    }
    pub fn clear(&mut self) {
        self.data.fill(0.0);
    }
    /// The longest delay that can be read.
    pub fn capacity(&self) -> usize {
        self.data.len() - 4
    }
    pub fn write(&mut self, x: f32) {
        self.write = (self.write + 1) & self.mask;
        self.data[self.write] = x;
    }
    /// The sample written `delay` writes ago; 0 is the newest.
    pub fn tap(&self, delay: usize) -> f32 {
        self.data[self.write.wrapping_sub(delay) & self.mask]
    }
    /// Adds into the sample written `delay` writes ago (for overlap-add).
    pub fn add(&mut self, delay: usize, x: f32) {
        let index = self.write.wrapping_sub(delay) & self.mask;
        self.data[index] += x;
    }
    /// Linear-interpolated read at a fractional delay.
    pub fn read(&self, delay: f32) -> f32 {
        // A delay that is not a number reads the newest sample.
        let delay = if delay.is_finite() { delay } else { 0.0 };
        let clamped = delay.clamp(0.0, self.capacity() as f32);
        let whole = clamped as usize;
        lerp(self.tap(whole), self.tap(whole + 1), clamped - whole as f32)
    }
    /// Four-point, third-order interpolation through the neighbouring samples
    /// (Catmull-Rom form). Needs a delay of at least one sample.
    pub fn read_cubic(&self, delay: f32) -> f32 {
        // A delay that is not a number reads at the shortest delay.
        let delay = if delay.is_finite() { delay } else { 1.0 };
        let clamped = delay.clamp(1.0, self.capacity() as f32 - 2.0);
        let whole = (clamped as usize).max(1);
        let t = clamped - whole as f32;
        let (ym1, y0, y1, y2) = (
            self.tap(whole - 1),
            self.tap(whole),
            self.tap(whole + 1),
            self.tap(whole + 2),
        );
        let c1 = 0.5 * (y1 - ym1);
        let c2 = ym1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2;
        let c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
        ((c3 * t + c2) * t + c1) * t + y0
    }
}

/// First-order low-pass; the high-pass is the input minus it.
#[derive(Debug, Clone, Copy)]
pub struct OnePole {
    coefficient: f32,
    state: f32,
}

impl Default for OnePole {
    fn default() -> Self {
        Self {
            coefficient: 1.0,
            state: 0.0,
        }
    }
}

impl OnePole {
    pub fn set_cutoff(&mut self, sample_rate: f32, hertz: f32) {
        let limited = hertz.clamp(1.0, 0.49 * sample_rate);
        self.coefficient = 1.0 - (-TAU * limited / sample_rate).exp();
    }
    pub fn reset(&mut self, value: f32) {
        self.state = value;
    }
    pub fn lowpass(&mut self, x: f32) -> f32 {
        self.state += (x - self.state) * self.coefficient;
        self.state
    }
    pub fn highpass(&mut self, x: f32) -> f32 {
        x - self.lowpass(x)
    }
}

/// Second-order state-variable filter in the trapezoidal (zero-delay
/// feedback) form: stable while its cutoff is swept at audio rate.
#[derive(Debug, Clone, Copy, Default)]
pub struct StateVariable {
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,
    ic1: f32,
    ic2: f32,
    low: f32,
    band: f32,
    high: f32,
}

impl StateVariable {
    pub fn set(&mut self, sample_rate: f32, hertz: f32, q: f32) {
        let limited = hertz.clamp(10.0, 0.45 * sample_rate);
        let g = (PI * limited / sample_rate).tan();
        self.k = 1.0 / q.max(0.05);
        self.a1 = 1.0 / (1.0 + g * (g + self.k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }
    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }
    /// Processes one sample; read `low`, `band` and `high` afterwards.
    pub fn process(&mut self, x: f32) {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        self.low = v2;
        self.band = v1;
        self.high = x - self.k * v1 - v2;
    }
    pub fn low(&self) -> f32 {
        self.low
    }
    pub fn band(&self) -> f32 {
        self.band
    }
    pub fn high(&self) -> f32 {
        self.high
    }
    /// All-pass output of the same filter (second order).
    pub fn allpass(&mut self, x: f32) -> f32 {
        self.process(x);
        x - 2.0 * self.k * self.band
    }
}

/// First-order all-pass (phase shifter stage): unity gain, phase turning
/// through 90 degrees at the corner frequency.
#[derive(Debug, Clone, Copy, Default)]
pub struct FirstOrderAllpass {
    coefficient: f32,
    x1: f32,
    y1: f32,
}

impl FirstOrderAllpass {
    pub fn set_corner(&mut self, sample_rate: f32, hertz: f32) {
        let t = (PI * hertz.clamp(5.0, 0.45 * sample_rate) / sample_rate).tan();
        self.coefficient = (t - 1.0) / (t + 1.0);
    }
    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.coefficient * x + self.x1 - self.coefficient * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// Delay-based all-pass diffuser (Schroeder form). The delay may be read at a
/// fractional, slowly moving position.
#[derive(Debug, Clone)]
pub struct DiffuserAllpass {
    line: DelayLine,
}

impl DiffuserAllpass {
    /// Allocates for delays up to `max_samples`. Not for the audio thread.
    pub fn new(max_samples: usize) -> Self {
        Self {
            line: DelayLine::new(max_samples),
        }
    }
    pub fn clear(&mut self) {
        self.line.clear();
    }
    pub fn process(&mut self, x: f32, delay: f32, gain: f32) -> f32 {
        let delayed = self.line.read(delay - 1.0);
        let input = x + gain * delayed;
        self.line.write(input);
        delayed - gain * input
    }
}

/// Low-frequency oscillator on a 0..1 phase.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lfo {
    phase: f32,
    step: f32,
}

impl Lfo {
    pub fn set_rate(&mut self, sample_rate: f32, hertz: f32) {
        self.step = hertz / sample_rate;
    }
    pub fn set_phase(&mut self, phase: f32) {
        self.phase = phase - phase.floor();
    }
    pub fn phase(&self) -> f32 {
        self.phase
    }
    /// Advances one sample and returns the phase before the step.
    pub fn advance(&mut self) -> f32 {
        let now = self.phase;
        self.phase += self.step;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        now
    }
    pub fn sine(phase: f32) -> f32 {
        (TAU * phase).sin()
    }
    pub fn triangle(phase: f32) -> f32 {
        let p = phase - phase.floor();
        if p < 0.5 {
            4.0 * p - 1.0
        } else {
            3.0 - 4.0 * p
        }
    }
}

/// Rectified level with separate attack and release times.
#[derive(Debug, Clone, Copy)]
pub struct EnvelopeFollower {
    attack: f32,
    release: f32,
    level: f32,
}

impl Default for EnvelopeFollower {
    fn default() -> Self {
        Self {
            attack: 1.0,
            release: 1.0,
            level: 0.0,
        }
    }
}

impl EnvelopeFollower {
    pub fn set_times(&mut self, sample_rate: f32, attack_ms: f32, release_ms: f32) {
        self.attack = 1.0 - (-1.0 / (sample_rate * attack_ms * 0.001).max(1.0)).exp();
        self.release = 1.0 - (-1.0 / (sample_rate * release_ms * 0.001).max(1.0)).exp();
    }
    pub fn reset(&mut self) {
        self.level = 0.0;
    }
    pub fn process(&mut self, x: f32) -> f32 {
        let magnitude = x.abs();
        let coefficient = if magnitude > self.level {
            self.attack
        } else {
            self.release
        };
        self.level += (magnitude - self.level) * coefficient;
        self.level
    }
    pub fn level(&self) -> f32 {
        self.level
    }
}

/// Small, fast noise source (32-bit xorshift) for hiss and slow random drift.
#[derive(Debug, Clone, Copy)]
pub struct Noise {
    state: u32,
}

impl Noise {
    pub fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 0x9e37_79b9 } else { seed },
        }
    }
    /// White noise in -1..1.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as i32) as f32 * (1.0 / 2_147_483_648.0)
    }
}

/// In-place fast Walsh-Hadamard transform of eight values, scaled to keep
/// energy: an orthogonal mix for feedback delay networks.
pub fn hadamard8(v: &mut [f32; 8]) {
    let mut span = 1;
    while span < 8 {
        let mut i = 0;
        while i < 8 {
            for j in i..i + span {
                let (a, b) = (v[j], v[j + span]);
                v[j] = a + b;
                v[j + span] = a - b;
            }
            i += span << 1;
        }
        span <<= 1;
    }
    for x in v.iter_mut() {
        *x *= core::f32::consts::FRAC_1_SQRT_2 * 0.5; // 1 / sqrt(8)
    }
}

/// Householder reflection of the values (identity minus 2/n times the
/// all-ones matrix): another energy-preserving feedback mix.
pub fn householder(v: &mut [f32]) {
    if v.is_empty() {
        return;
    }
    let offset = v.iter().sum::<f32>() * (2.0 / v.len() as f32);
    for x in v.iter_mut() {
        *x -= offset;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(a: f32, b: f32, tolerance: f32) -> bool {
        (a - b).abs() <= tolerance
    }

    #[test]
    fn delay_reads_a_ramp_exactly() {
        let mut line = DelayLine::new(1000);
        for i in 0..600 {
            line.write(i as f32);
        }
        assert_eq!(line.tap(0), 599.0);
        assert_eq!(line.tap(10), 589.0);
        assert!(near(line.read(10.5), 588.5, 1e-3));
        assert!(near(line.read_cubic(10.25), 588.75, 1e-3));
        assert!(line.capacity() >= 1000);
        line.add(0, 1.0);
        assert_eq!(line.tap(0), 600.0);
        assert!(line.read(f32::NAN).is_finite() && line.read_cubic(f32::NAN).is_finite());
        assert!(line.read(f32::INFINITY).is_finite() && line.read_cubic(-5.0).is_finite());
    }

    #[test]
    fn smoothed_follows_its_time_constant_and_settles() {
        let mut value = Smoothed::new(48_000.0, 10.0, 0.0);
        value.set(1.0);
        let mut v = 0.0;
        for _ in 0..480 {
            v = value.next();
        }
        assert!(near(v, 1.0 - (-1.0_f32).exp(), 0.01));
        for _ in 0..48_000 {
            v = value.next();
        }
        assert!(value.settled() && v == 1.0);
    }

    #[test]
    fn one_pole_and_state_variable_pass_dc_through_the_low_pass() {
        let mut pole = OnePole::default();
        pole.set_cutoff(48_000.0, 100.0);
        let mut filter = StateVariable::default();
        filter.set(48_000.0, 1000.0, 0.707);
        let mut low = 0.0;
        for _ in 0..48_000 {
            low = pole.lowpass(1.0);
            filter.process(1.0);
        }
        assert!(near(low, 1.0, 1e-3));
        assert!(near(filter.low(), 1.0, 1e-3) && near(filter.high(), 0.0, 1e-3));
    }

    #[test]
    fn all_pass_blocks_keep_energy() {
        let mut svf = StateVariable::default();
        svf.set(48_000.0, 1000.0, 0.707);
        let mut stage = FirstOrderAllpass::default();
        stage.set_corner(48_000.0, 800.0);
        let mut diffuser = DiffuserAllpass::new(600);
        let mut noise = Noise::new(7);
        let (mut input, mut second, mut first, mut delayed) = (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
        for _ in 0..200_000 {
            let x = noise.next();
            let (a, b, c) = (
                svf.allpass(x),
                stage.process(x),
                diffuser.process(x, 311.0, 0.6),
            );
            input += f64::from(x * x);
            second += f64::from(a * a);
            first += f64::from(b * b);
            delayed += f64::from(c * c);
        }
        assert!(near((second / input) as f32, 1.0, 0.01));
        assert!(near((first / input) as f32, 1.0, 0.01));
        assert!(near((delayed / input) as f32, 1.0, 0.02));
    }

    #[test]
    fn mixers_keep_energy_and_hadamard_inverts_itself() {
        let original = [1.0, -2.0, 3.0, 0.5, -1.0, 4.0, 0.0, 2.0];
        let energy = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>();
        let mut v = original;
        hadamard8(&mut v);
        assert!(near(energy(&v), energy(&original), 1e-3));
        hadamard8(&mut v);
        assert!(v.iter().zip(original).all(|(a, b)| near(*a, b, 1e-4)));
        let mut w = original;
        householder(&mut w);
        assert!(near(energy(&w), energy(&original), 1e-3));
    }

    #[test]
    fn soft_clip_is_bounded_monotonic_and_linear_near_zero() {
        assert!(near(soft_clip(0.01), 0.01, 1e-5));
        assert!(soft_clip(100.0) <= 1.0 && soft_clip(-100.0) >= -1.0);
        let mut x = -3.0_f32;
        while x < 3.0 {
            assert!(soft_clip(x + 0.01) >= soft_clip(x));
            x += 0.01;
        }
    }

    #[test]
    fn helpers_match_their_definitions() {
        let mut env = EnvelopeFollower::default();
        env.set_times(48_000.0, 1.0, 100.0);
        for _ in 0..4800 {
            env.process(0.5);
        }
        assert!(near(env.level(), 0.5, 1e-3));
        let mut lfo = Lfo::default();
        lfo.set_rate(48_000.0, 1.0);
        for _ in 0..12_000 {
            lfo.advance();
        }
        assert!(near(lfo.phase(), 0.25, 1e-3) && near(Lfo::sine(0.25), 1.0, 1e-5));
        assert!(near(Lfo::triangle(0.5), 1.0, 1e-5) && near(Lfo::triangle(0.0), -1.0, 1e-5));
        let mut noise = Noise::new(1);
        let mut mean = 0.0_f64;
        for _ in 0..100_000 {
            let x = noise.next();
            assert!((-1.0..1.0).contains(&x));
            mean += f64::from(x);
        }
        assert!((mean / 100_000.0).abs() < 0.02);
        assert_eq!(prime_at_or_above(1000), 1009);
        assert_eq!(prime_at_or_above(7), 7);
        let (from, to) = equal_power(0.5);
        assert!(near(from * from + to * to, 1.0, 1e-5));
        assert!(near(db_to_gain(-6.0206), 0.5, 1e-4) && near(gain_to_db(0.5), -6.0206, 1e-3));
    }
}
