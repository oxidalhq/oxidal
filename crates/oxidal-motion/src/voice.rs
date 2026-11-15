//! One audio channel of one effect: its delay memories and filters, the
//! targets every mode works out a few hundred times a second, and the
//! per-sample loop of each mode.
//! @see docs/native-motion.md

use core::f32::consts::{FRAC_1_SQRT_2, FRAC_2_PI, LN_2, LN_10, SQRT_2, TAU};
use core::fmt;

use oxidal_dsp::{DelayLine, OnePole, StateVariable, equal_power, soft_clip};

use crate::blocks::{
    Lag, Lamp, Ramp, Stage, guard, lag_coefficient, parabola, rounded, sine, square,
    stage_coefficient, triangle,
};
use crate::controls::Mode;

/// The longest delay any mode reads: the three-voice chorus needs 17 ms plus
/// 4 ms of sweep.
const MAX_DELAY_SECONDS: f32 = 0.024;

/// Chorus voice delays in seconds: distinct primes of milliseconds inside the
/// usual 5 to 25 ms, so the comb notches of the voices never line up.
const CHORUS_TWO: [f32; 3] = [0.007, 0.013, 0.013];
const CHORUS_THREE: [f32; 3] = [0.007, 0.011, 0.017];
/// Chorus sweep at full Depth, each way. A delay moving as `A sin(2 pi f t)`
/// bends pitch by up to `2 pi f A`; 4 ms at 1 Hz is 2.5 % (43 cents).
const CHORUS_SWING: f32 = 0.004;
/// Above this rate the chorus sweep shrinks as `1 / f`, which keeps the pitch
/// bend the same instead of letting it grow with the rate.
const CHORUS_KNEE_HZ: f32 = 1.0;
/// Rate of the second, faster oscillator of the Shape C ensemble: seven times
/// the default Rate.
pub const ENSEMBLE_HZ: f32 = 5.6;
/// Its sweep at full Depth: a pitch bend of 0.5 % (9 cents) at that rate.
const ENSEMBLE_SWING: f32 = 0.005 / (TAU * ENSEMBLE_HZ);

/// The flanger delay sweeps between 0.3 and 10 ms at full Depth, evenly in
/// octaves around their geometric mean.
const FLANGER_CENTRE: f32 = 0.001_732;
/// Half of `ln(10 ms / 0.3 ms)`.
const FLANGER_HALF_LOG_SPAN: f32 = 1.753;
/// The fixed copy of the through-zero flanger; the moving copy sweeps from
/// 2 % to 198 % of it, passing through it twice a cycle.
const ZERO_CENTRE: f32 = 0.0025;
const ZERO_REACH: f32 = 0.98;
/// Feedback at 100 %. Below 1, so every loop decays.
const FLANGER_FEEDBACK: f32 = 0.95;
const PHASER_FEEDBACK: f32 = 0.9;

/// The phaser sweeps two octaves each way at full Depth: `ln 4`.
const PHASER_LOG_REACH: f32 = 1.386_294;
/// Corner frequencies of the four vibe stages relative to the swept
/// frequency: a factor of three (1.6 octaves) between neighbours, centred on
/// it. Spread like this the stages give two broad notches nearly four
/// octaves apart, where four equal stages give two narrow ones 2.5 apart.
const VIBE_SPREAD: [f32; 4] = [0.192_45, 0.577_35, 1.732_05, 5.196_15];
/// `ln 20`: the vibe sweeps over a 20:1 range at full Depth.
const VIBE_LOG_SPAN: f32 = 2.995_732;
/// Lamp and photocell of each vibe Shape: seconds for the light to rise and
/// to fade, and the power law from lamp drive to cell conductance.
const VIBE_LAMPS: [(f32, f32, f32); 3] = [
    (0.008, 0.045, 2.7),
    (0.020, 0.110, 3.4),
    (0.004, 0.004, 1.5),
];

/// Delay of both rotor paths with the rotor side-on, in seconds.
const ROTARY_CENTRE: f32 = 0.0015;
/// Doppler sweep of the horn: a mouth 0.18 m from the axis moves the path by
/// that much each way, and sound travels 343 m/s.
const HORN_SWING: f32 = 0.18 / 343.0;
/// The drum's opening sits closer to its axis: 0.09 m.
const DRUM_SWING: f32 = 0.09 / 343.0;
/// Level difference between a rotor facing the microphone and facing away.
const HORN_DB: f32 = 8.0;
const DRUM_DB: f32 = 4.0;
/// The two rotors split the signal here.
const ROTARY_CROSSOVER_HZ: f32 = 800.0;

/// Vibrato at full Depth bends pitch by 60 cents each way: `2^(60/1200) - 1`.
const VIBRATO_BEND: f32 = 0.035_265;
/// The vibrato sweep never exceeds this, so slow rates bend less.
const VIBRATO_MAX_SWING: f32 = 0.006;
/// Shortest vibrato delay.
const VIBRATO_FLOOR: f32 = 0.0005;

/// Mean square of the tremolo oscillator by Shape: a sine (1/2), a triangle
/// (1/3) and the rounded square (0.859, from the same integral as
/// [`RING_SQUARE_GAIN`] with a drive of 6).
const TREMOLO_MEAN_SQUARES: [f32; 3] = [0.5, 1.0 / 3.0, 0.859];

/// Flanger Shapes B and C add or subtract two copies of the signal. Low
/// notes are longer than the sweep, so the sum gains and the difference loses
/// level on a guitar; these gains bring a plucked note back to its own level
/// at the default Depth (0.707 would suit copies with nothing in common).
const ZERO_GAINS: [f32; 2] = [0.60, 0.90];

/// A full-wave rectified sine has a mean of 2/pi; taking that off and scaling
/// by `1 / sqrt(2 (1/2 - 4/pi^2))` leaves a carrier one octave up with the
/// power of a sine.
const RING_RECTIFIED_MEAN: f32 = FRAC_2_PI;
const RING_RECTIFIED_GAIN: f32 = 2.2973;

/// Drive of the Ring mode's square carrier.
const RING_SQUARE_DRIVE: f32 = 4.0;
/// Brings that carrier to the power of a sine: the mean square of
/// `k s / sqrt(1 + k^2 s^2)` over a cycle of `s = sin` is
/// `1 - 1 / sqrt(1 + k^2)`, here 0.757.
const RING_SQUARE_GAIN: f32 = 0.8124;

const RAMPS: usize = 7;

/// An effect and its variant: what one slot of the engine runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Program {
    pub mode: Mode,
    pub shape: usize,
}

impl Program {
    /// Whether the effect replaces the signal (true) or is blended with it.
    /// Whole-signal effects are fully on from Mix 50 % up.
    pub fn whole(self) -> bool {
        match self.mode {
            Mode::Chorus | Mode::Phaser | Mode::Vibe => false,
            Mode::Flanger => self.shape != 0,
            Mode::Rotary | Mode::Tremolo | Mode::Harmonic | Mode::Vibrato | Mode::Ring => true,
        }
    }
}

/// The state of every oscillator and smoothed control at one instant; the
/// arrays hold the left and the right side.
#[derive(Debug, Clone, Copy, Default)]
pub struct Frame {
    /// Main oscillator, in turns.
    pub phase: [f32; 2],
    /// Slow drift oscillator of the vibrato's Shape C.
    pub wander: [f32; 2],
    /// Fast oscillator of the chorus's Shape C.
    pub ensemble: [f32; 2],
    /// Rotor angles as each microphone sees them.
    pub horn: [f32; 2],
    pub drum: [f32; 2],
    /// Main oscillator rate in hertz.
    pub rate: f32,
    pub depth: f32,
    pub feedback: f32,
    pub tone: f32,
}

/// Sample rate and control interval.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub sample_rate: f32,
    /// One over the samples in a control interval.
    pub inverse_interval: f32,
    /// Seconds in a control interval.
    pub interval_seconds: f32,
}

/// A delay in seconds as the read position that gives it. A read happens
/// before the write of the same sample, hence the one.
fn position(seconds: f32, sample_rate: f32) -> f32 {
    (seconds * sample_rate - 1.0).max(1.0)
}

/// The Tone control as a low-pass corner: 3 kHz to 20 kHz, 7.7 kHz at noon.
fn tone_hertz(tone: f32) -> f32 {
    3_000.0 * (tone * 1.897_12).exp()
}

/// The oscillator of the two tremolos by Shape.
fn tremolo_shape(shape: usize, turns: f32) -> f32 {
    match shape {
        0 => sine(turns),
        1 => triangle(turns),
        _ => square(turns),
    }
}

/// One channel of one effect.
#[derive(Clone)]
pub struct Voice {
    line_a: DelayLine,
    line_b: DelayLine,
    stages: [Stage; 8],
    tone: Lag,
    block: OnePole,
    split: StateVariable,
    feedback: f32,
    lamp: Lamp,
    ramps: [Ramp; RAMPS],
}

impl fmt::Debug for Voice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Voice")
            .field("delay_capacity", &self.line_a.capacity())
            .field("feedback", &self.feedback)
            .field("lamp", &self.lamp)
            .finish_non_exhaustive()
    }
}

impl Voice {
    /// Allocates the delay memories for `sample_rate`.
    pub fn new(sample_rate: f32) -> Self {
        let length = (MAX_DELAY_SECONDS * sample_rate).ceil().max(64.0) as usize + 8;
        let mut block = OnePole::default();
        block.set_cutoff(sample_rate, 20.0);
        let mut split = StateVariable::default();
        // Q of one half: the low and high outputs are then exactly opposite
        // in phase, and low minus high is all-pass.
        split.set(sample_rate, ROTARY_CROSSOVER_HZ, 0.5);
        Self {
            line_a: DelayLine::new(length),
            line_b: DelayLine::new(length),
            stages: [Stage::default(); 8],
            tone: Lag::default(),
            block,
            split,
            feedback: 0.0,
            lamp: Lamp::default(),
            ramps: [Ramp::default(); RAMPS],
        }
    }

    /// Empties every memory.
    pub fn clear(&mut self) {
        self.line_a.clear();
        self.line_b.clear();
        self.stages = [Stage::default(); 8];
        self.tone.reset();
        self.block.reset(0.0);
        self.split.reset();
        self.feedback = 0.0;
        self.lamp = Lamp::default();
    }

    /// Sets where every moving value of `program` should be at `frame`:
    /// reached by a ramp over one control interval, or at once with `snap`.
    pub fn aim(
        &mut self,
        program: Program,
        frame: &Frame,
        channel: usize,
        timing: &Timing,
        snap: bool,
    ) {
        let targets = self.targets(program, frame, channel & 1, timing, snap);
        for (ramp, target) in self.ramps.iter_mut().zip(targets) {
            if snap {
                ramp.snap(target);
            } else {
                ramp.aim(target, timing.inverse_interval);
            }
        }
    }

    fn targets(
        &mut self,
        program: Program,
        frame: &Frame,
        side: usize,
        timing: &Timing,
        snap: bool,
    ) -> [f32; RAMPS] {
        let rate = timing.sample_rate;
        let side = side & 1;
        let phase = frame.phase[side];
        let depth = frame.depth;
        let mut t = [0.0_f32; RAMPS];
        match program.mode {
            Mode::Chorus => {
                let (centres, spacing) = if program.shape == 0 {
                    (CHORUS_TWO, 0.25)
                } else {
                    (CHORUS_THREE, 1.0 / 3.0)
                };
                let swing = depth * CHORUS_SWING * CHORUS_KNEE_HZ / frame.rate.max(CHORUS_KNEE_HZ);
                let fast = if program.shape == 2 {
                    depth * ENSEMBLE_SWING
                } else {
                    0.0
                };
                for (voice, (target, centre)) in t.iter_mut().zip(centres).enumerate() {
                    let offset = voice as f32 * spacing;
                    let seconds = centre
                        + swing * sine(phase + offset)
                        + fast * sine(frame.ensemble[side] + offset);
                    *target = position(seconds, rate);
                }
                t[6] = lag_coefficient(rate, tone_hertz(frame.tone));
            }
            Mode::Flanger => {
                let seconds = if program.shape == 0 {
                    FLANGER_CENTRE * (FLANGER_HALF_LOG_SPAN * depth * sine(phase)).exp()
                } else {
                    ZERO_CENTRE * (1.0 + ZERO_REACH * depth * rounded(triangle(phase)))
                };
                let feedback = frame.feedback * FLANGER_FEEDBACK;
                t[0] = position(seconds, rate);
                t[1] = feedback;
                // A comb with feedback g has a mean power gain of 1/(1 - g^2).
                t[2] = (1.0 - feedback * feedback).max(0.0).sqrt();
                t[3] = position(ZERO_CENTRE, rate);
                t[6] = lag_coefficient(rate, tone_hertz(frame.tone));
            }
            Mode::Phaser => {
                let centre = 300.0 * (frame.tone * 1.609_44).exp();
                let hertz = centre * (PHASER_LOG_REACH * depth * sine(phase)).exp();
                let coefficient = stage_coefficient(rate, hertz);
                let feedback = frame.feedback * PHASER_FEEDBACK;
                t[..4].fill(coefficient);
                t[4] = feedback;
                t[5] = (1.0 - feedback * feedback).max(0.0).sqrt();
            }
            Mode::Vibe => {
                let (rise, fall, power) = VIBE_LAMPS[program.shape.min(2)];
                let drive = 0.5 + 0.5 * sine(phase);
                let light = if snap {
                    self.lamp.snap(drive);
                    self.lamp.conductance(power)
                } else {
                    self.lamp
                        .follow(drive, timing.interval_seconds, rise, fall, power)
                };
                let span = (VIBE_LOG_SPAN * depth).exp();
                let centre = 120.0 * (frame.tone * 1.791_76).exp();
                let base = centre / span.sqrt() * (1.0 + (span - 1.0) * light);
                for (target, spread) in t.iter_mut().zip(VIBE_SPREAD) {
                    *target = stage_coefficient(rate, base * spread);
                }
                let feedback = frame.feedback * PHASER_FEEDBACK;
                t[4] = feedback;
                t[5] = (1.0 - feedback * feedback).max(0.0).sqrt();
            }
            Mode::Rotary => {
                let amount = 2.0 * depth;
                let horn = (TAU * frame.horn[side]).cos();
                // Shape B holds the drum still and side-on: no sweep, no colour.
                let drum = if program.shape == 1 {
                    0.0
                } else {
                    (TAU * frame.drum[side]).cos()
                };
                let decibels =
                    |range: f32, facing: f32| (LN_10 / 20.0 * 0.5 * range * amount * facing).exp();
                t[0] = position(ROTARY_CENTRE - amount * HORN_SWING * horn, rate);
                t[1] = decibels(HORN_DB, horn);
                // Facing away, the horn's corner falls two octaves at Depth 50 %.
                let corner = tone_hertz(frame.tone) * (-LN_2 * amount * (1.0 - horn)).exp();
                t[2] = lag_coefficient(rate, corner);
                t[3] = position(ROTARY_CENTRE - amount * DRUM_SWING * drum, rate);
                t[4] = decibels(DRUM_DB, drum);
            }
            Mode::Tremolo => {
                // The gain is a + b u for the oscillator u, whose mean is zero:
                // its mean square is a^2 + b^2 mean(u^2). Dividing by the root
                // of that keeps the loudness where it was.
                let (a, b) = (1.0 - 0.5 * depth, 0.5 * depth);
                let power = a * a + b * b * TREMOLO_MEAN_SQUARES[program.shape.min(2)];
                t[0] = (a + b * tremolo_shape(program.shape, phase)).max(0.0) / power.sqrt();
            }
            Mode::Harmonic => {
                let swing = 0.5 + 0.5 * tremolo_shape(program.shape, phase);
                // Keeps low^2 + high^2 at 2, whatever the Depth and the phase.
                let level = (2.0 / (2.0 - depth)).sqrt();
                t[0] = (1.0 - depth * (1.0 - swing)).max(0.0).sqrt() * level; // lows
                t[1] = (1.0 - depth * swing).max(0.0).sqrt() * level; // highs
                t[2] = lag_coefficient(rate, 250.0 * (frame.tone * 2.079_44).exp());
            }
            Mode::Vibrato => {
                let (wave, slope) = match program.shape {
                    0 => (sine(phase), TAU),
                    1 => (parabola(phase), 8.0),
                    _ => ((sine(phase) + 0.5 * sine(frame.wander[side])) / 1.5, TAU),
                };
                // A sweep of A seconds at f hertz bends pitch by slope * f * A.
                let swing =
                    (VIBRATO_BEND * depth / (slope * frame.rate.max(0.01))).min(VIBRATO_MAX_SWING);
                t[0] = position(VIBRATO_FLOOR + swing * (1.0 + wave), rate);
                t[6] = lag_coefficient(rate, tone_hertz(frame.tone));
            }
            Mode::Ring => {
                let (straight, ring) = equal_power(depth);
                t[0] = straight;
                t[1] = ring * SQRT_2;
                t[6] = lag_coefficient(rate, tone_hertz(frame.tone));
            }
        }
        t
    }

    /// Runs `program` over `input`, writing the effect alone to `output`.
    /// `carrier` is the Ring mode's oscillator for this side.
    pub fn run(&mut self, program: Program, input: &[f32], carrier: &[f32], output: &mut [f32]) {
        let [r0, r1, r2, r3, r4, r5, r6] = &mut self.ramps;
        let samples = input.iter().zip(output.iter_mut());
        match program.mode {
            Mode::Chorus => {
                let three = program.shape != 0;
                let gain = if three { 0.577_35 } else { FRAC_1_SQRT_2 };
                for (x, out) in samples {
                    let (first, second, third) = (r0.next(), r1.next(), r2.next());
                    let mut sum = self.line_a.read_cubic(first) + self.line_a.read_cubic(second);
                    if three {
                        sum += self.line_a.read_cubic(third);
                    }
                    self.line_a.write(self.tone.process(*x, r6.next()));
                    *out = sum * gain;
                }
            }
            Mode::Flanger => {
                let through_zero = program.shape != 0;
                let (sign, gain) = if program.shape == 2 {
                    (-1.0, ZERO_GAINS[1])
                } else {
                    (1.0, ZERO_GAINS[0])
                };
                for (x, out) in samples {
                    let (feedback, level) = (r1.next(), r2.next());
                    let filtered = self.tone.process(*x, r6.next());
                    let moving = self.line_b.read_cubic(r0.next());
                    let still = r3.next();
                    self.line_b
                        .write(level * filtered + feedback * guard(self.block.highpass(moving)));
                    if through_zero {
                        let fixed = self.line_a.read_cubic(still);
                        self.line_a.write(filtered);
                        *out = gain * (fixed + sign * moving);
                    } else {
                        *out = moving;
                    }
                }
            }
            Mode::Phaser | Mode::Vibe => {
                let count = if program.mode == Mode::Vibe {
                    4
                } else {
                    4 + 2 * program.shape.min(2)
                };
                for (x, out) in samples {
                    let coefficients = [r0.next(), r1.next(), r2.next(), r3.next()];
                    let mut y = r5.next() * *x + r4.next() * guard(self.feedback);
                    for (stage, coefficient) in self
                        .stages
                        .iter_mut()
                        .take(count)
                        .zip(coefficients.iter().cycle())
                    {
                        y = stage.process(y, *coefficient);
                    }
                    self.feedback = self.block.highpass(y);
                    *out = y;
                }
            }
            Mode::Rotary => {
                for (x, out) in samples {
                    self.split.process(*x);
                    let horn = self.line_a.read_cubic(r0.next());
                    self.line_a.write(self.split.high());
                    let drum = self.line_b.read_cubic(r3.next());
                    self.line_b.write(self.split.low());
                    *out = drum * r4.next() - self.tone.process(horn, r2.next()) * r1.next();
                }
            }
            Mode::Tremolo => {
                for (x, out) in samples {
                    *out = *x * r0.next();
                }
            }
            Mode::Harmonic => {
                for (x, out) in samples {
                    let low = self.tone.process(*x, r2.next());
                    *out = low * r0.next() + (*x - low) * r1.next();
                }
            }
            Mode::Vibrato => {
                for (x, out) in samples {
                    *out = self.line_a.read_cubic(r0.next());
                    self.line_a.write(self.tone.process(*x, r6.next()));
                }
            }
            Mode::Ring => {
                for ((x, out), wave) in samples.zip(carrier) {
                    let wave = match program.shape {
                        0 => *wave,
                        1 => soft_clip(RING_SQUARE_DRIVE * *wave) * RING_SQUARE_GAIN,
                        _ => (wave.abs() - RING_RECTIFIED_MEAN) * RING_RECTIFIED_GAIN,
                    };
                    let rung = *x * (r0.next() + r1.next() * wave);
                    *out = self.tone.process(rung, r6.next());
                }
            }
        }
    }
}
