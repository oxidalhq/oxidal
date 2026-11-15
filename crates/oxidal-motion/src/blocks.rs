//! Small pieces the modulation engine is built from: a straight-line ramp, a
//! first-order low-pass and all-pass whose coefficient may move every sample,
//! the oscillator shapes and the feedback guard.
//! @see docs/native-motion.md

use core::f32::consts::{PI, TAU};
use oxidal_dsp::soft_clip;

/// A value that moves in a straight line to its target over one control
/// interval, so a setting worked out a few hundred times a second still
/// changes a little on every sample.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ramp {
    value: f32,
    target: f32,
    step: f32,
}

impl Ramp {
    /// Jumps to `value` with no ramp.
    pub fn snap(&mut self, value: f32) {
        self.value = value;
        self.target = value;
        self.step = 0.0;
    }
    /// Starts a ramp to `target` over `1 / inverse_frames` samples. The ramp
    /// before it is first landed exactly, so rounding never accumulates.
    pub fn aim(&mut self, target: f32, inverse_frames: f32) {
        self.value = self.target;
        self.target = target;
        self.step = (target - self.value) * inverse_frames;
    }
    /// Advances one sample and returns the new value.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        self.value += self.step;
        self.value
    }
    pub fn target(&self) -> f32 {
        self.target
    }
}

/// First-order low-pass whose coefficient is given with every sample.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lag {
    state: f32,
}

impl Lag {
    pub fn reset(&mut self) {
        self.state = 0.0;
    }
    pub fn process(&mut self, x: f32, coefficient: f32) -> f32 {
        self.state += (x - self.state) * coefficient;
        self.state
    }
}

/// Coefficient of [`Lag`] for a cutoff in hertz: `1 - e^(-2 pi f / fs)`.
pub fn lag_coefficient(sample_rate: f32, hertz: f32) -> f32 {
    1.0 - (-TAU * hertz.clamp(1.0, 0.45 * sample_rate) / sample_rate).exp()
}

/// First-order all-pass (one phase shifter stage) whose coefficient is given
/// with every sample: `H(z) = (a + z^-1) / (1 + a z^-1)`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Stage {
    x1: f32,
    y1: f32,
}

impl Stage {
    pub fn process(&mut self, x: f32, coefficient: f32) -> f32 {
        let y = coefficient * (x - self.y1) + self.x1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// Coefficient of [`Stage`] whose phase passes 90 degrees at `hertz`, from
/// the bilinear transform: `a = (tan(pi f / fs) - 1) / (tan(pi f / fs) + 1)`.
pub fn stage_coefficient(sample_rate: f32, hertz: f32) -> f32 {
    let t = (PI * hertz.clamp(5.0, 0.45 * sample_rate) / sample_rate).tan();
    (t - 1.0) / (t + 1.0)
}

/// A lamp shining on a photocell, as a control source: the light follows the
/// drive with a lag, quicker to brighten than to fade, and the cell's
/// conductance follows the light by a power law, which holds a sweep near
/// its bottom for most of the cycle.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lamp {
    light: f32,
}

impl Lamp {
    /// Sets the light with no lag.
    pub fn snap(&mut self, drive: f32) {
        self.light = drive.clamp(0.0, 1.0);
    }
    /// Moves the light toward `drive` (0 to 1) over `seconds`, with time
    /// constants `rise` and `fall` in seconds, and returns the conductance
    /// (0 to 1) for the power law `power`.
    pub fn follow(&mut self, drive: f32, seconds: f32, rise: f32, fall: f32, power: f32) -> f32 {
        let time = if drive > self.light { rise } else { fall };
        self.light +=
            (drive.clamp(0.0, 1.0) - self.light) * (1.0 - (-seconds / time.max(1.0e-4)).exp());
        self.conductance(power)
    }
    /// The conductance for the light as it is now.
    pub fn conductance(&self, power: f32) -> f32 {
        self.light.clamp(0.0, 1.0).powf(power)
    }
}

/// Sine of a phase in turns.
pub fn sine(turns: f32) -> f32 {
    (TAU * turns).sin()
}

/// Triangle in step with [`sine`]: 0 at 0, 1 at a quarter turn, -1 at three
/// quarters.
pub fn triangle(turns: f32) -> f32 {
    let p = turns + 0.25;
    1.0 - 4.0 * ((p - p.floor()) - 0.5).abs()
}

/// How hard [`square`] drives the limiter: the edge takes about a twelfth of
/// the cycle, long enough never to click.
const SQUARE_DRIVE: f32 = 6.0;

/// Square with rounded edges in step with [`sine`]: a sine pushed through the
/// soft limiter and scaled back to reach exactly +-1.
pub fn square(turns: f32) -> f32 {
    let top = SQUARE_DRIVE / (1.0 + SQUARE_DRIVE * SQUARE_DRIVE).sqrt();
    soft_clip(SQUARE_DRIVE * sine(turns)) / top
}

/// Two parabolic arcs in step with [`sine`]: the running sum of a triangle,
/// so a delay that follows it changes pitch along a triangle. Its steepest
/// slope is 8 per turn.
pub fn parabola(turns: f32) -> f32 {
    let p = turns - turns.floor();
    if p < 0.5 {
        1.0 - 16.0 * (p - 0.25) * (p - 0.25)
    } else {
        16.0 * (p - 0.75) * (p - 0.75) - 1.0
    }
}

/// Rounds the corners of a -1..1 triangle: `1.5 t - 0.5 t^3` has zero slope
/// at both ends and still reaches them.
pub fn rounded(t: f32) -> f32 {
    let t = t.clamp(-1.0, 1.0);
    t * (1.5 - 0.5 * t * t)
}

/// Feedback guard: close to a straight wire for guitar levels (0.26 dB low at
/// 0.5) and never beyond +-2, so no feedback loop can run away.
pub fn guard(x: f32) -> f32 {
    2.0 * soft_clip(0.5 * x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ramp_lands_exactly_and_holds() {
        let mut ramp = Ramp::default();
        ramp.snap(0.25);
        ramp.aim(1.0, 1.0 / 16.0);
        let mut last = 0.0;
        for _ in 0..16 {
            let next = ramp.next();
            assert!(next > last);
            last = next;
        }
        assert!((last - 1.0).abs() < 1e-6);
        ramp.aim(1.0, 1.0 / 16.0);
        assert_eq!(ramp.next(), 1.0);
        assert_eq!(ramp.target(), 1.0);
    }

    #[test]
    fn shapes_share_their_phase_and_range() {
        for (shape, name) in [
            (sine as fn(f32) -> f32, "sine"),
            (triangle, "triangle"),
            (square, "square"),
            (parabola, "parabola"),
        ] {
            assert!(shape(0.0).abs() < 1e-5, "{name} starts at zero");
            assert!(
                (shape(0.25) - 1.0).abs() < 1e-5,
                "{name} peaks at a quarter"
            );
            assert!(
                (shape(0.75) + 1.0).abs() < 1e-5,
                "{name} troughs at three quarters"
            );
            let mut turns = 0.0_f32;
            while turns < 2.0 {
                assert!(shape(turns).abs() <= 1.0 + 1e-5, "{name} stays in range");
                turns += 0.001;
            }
        }
        assert_eq!(rounded(1.0), 1.0);
        assert_eq!(rounded(-3.0), -1.0);
    }

    #[test]
    fn the_parabola_has_no_corner_and_a_slope_of_eight() {
        let step = 1.0e-3_f32;
        let mut steepest = 0.0_f32;
        let mut turns = 0.0_f32;
        while turns < 1.0 {
            let slope = (parabola(turns + step) - parabola(turns)) / step;
            steepest = steepest.max(slope.abs());
            turns += step;
        }
        assert!((steepest - 8.0).abs() < 0.05);
    }

    #[test]
    fn the_lamp_lags_rises_faster_than_it_falls_and_is_squashed_at_the_bottom() {
        // One sweep a second, worked out 3000 times a second.
        let (step, rise, fall, power) = (1.0 / 3_000.0, 0.008, 0.045, 2.7);
        let mut lamp = Lamp::default();
        lamp.snap(0.5);
        let mut sweep = Vec::new();
        for i in 0..9_000 {
            let drive = 0.5 + 0.5 * sine(i as f32 * step);
            sweep.push(lamp.follow(drive, step, rise, fall, power));
        }
        let cycle = &sweep[6_000..];
        let (least, most) = cycle
            .iter()
            .fold((f32::MAX, f32::MIN), |(l, m), x| (l.min(*x), m.max(*x)));
        assert!(least >= 0.0 && most <= 1.0 && most - least > 0.8);
        // Squashed at the bottom: well over half the cycle lies below the middle.
        let middle = 0.5 * (least + most);
        let below = cycle.iter().filter(|x| **x < middle).count() as f32 / cycle.len() as f32;
        assert!(below > 0.62, "{below} of the cycle is below the middle");
        // Lagging: the peak comes after the drive's peak at a quarter turn.
        let peak = cycle.iter().position(|x| *x == most).unwrap();
        assert!(peak > 750 && peak < 900, "peak at {peak} of 3000");
        // Uneven: the climb from trough to peak is shorter than the way back.
        let trough = cycle.iter().position(|x| *x == least).unwrap();
        let climb = (peak + 3_000 - trough) % 3_000;
        assert!(climb < 1_450, "the climb takes {climb} of 3000");
        // With no lag and a power of one the lamp is the drive itself.
        let mut plain = Lamp::default();
        plain.snap(0.2);
        assert!((plain.follow(0.9, 1.0, 1.0e-4, 1.0e-4, 1.0) - 0.9).abs() < 1e-4);
    }

    #[test]
    fn the_guard_is_bounded_and_nearly_linear_at_guitar_level() {
        assert!(guard(1.0e6) <= 2.0 && guard(-1.0e6) >= -2.0);
        assert!((guard(0.5) / 0.5 - 1.0).abs() < 0.04);
        assert!((guard(0.01) - 0.01).abs() < 1e-6);
    }

    #[test]
    fn a_stage_keeps_energy_and_turns_ninety_degrees_at_its_corner() {
        let sample_rate = 48_000.0_f32;
        let corner = 1_000.0_f32;
        let coefficient = stage_coefficient(sample_rate, corner);
        let mut stage = Stage::default();
        let (mut power_in, mut power_out, mut product) = (0.0_f64, 0.0_f64, 0.0_f64);
        for i in 0..48_000 {
            let x = sine(corner * i as f32 / sample_rate);
            let y = stage.process(x, coefficient);
            if i > 4_800 {
                power_in += f64::from(x * x);
                power_out += f64::from(y * y);
                product += f64::from(x * y);
            }
        }
        assert!((power_out / power_in - 1.0).abs() < 1e-3);
        assert!(
            (product / power_in).abs() < 1e-2,
            "in quadrature at the corner"
        );
    }
}
