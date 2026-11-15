//! One echo voice: how a mode reads the shared delay memory and what it does
//! to the signal on its way back in.
//!
//! Every mode has the same shape. It reads its repeats from the memory, takes
//! its feedback from there too, and colours the sum of input and feedback
//! before the engine writes it. The memory therefore always holds finished
//! audio, so a change of mode keeps the tail and Hold can loop it untouched.
//! @see docs/native-echo.md

use crate::controls::Mode;
use crate::parts::{
    Bucket, JumpTime, Ramp, Reverse, SlideTime, Wobble, read_cubic, read_whole, speed_to_delay,
    tape_curve,
};
use oxidal_dsp::{DelayLine, EnvelopeFollower, Noise, OnePole, Smoothed, StateVariable, lerp};

/// Filter coefficients and modulation depths are worked out once every this
/// many samples, counted from reset, so the block size never matters.
pub const CONTROL_EVERY: u32 = 16;

/// The level above which the feedback is turned down. A loop asked for more
/// than unity gain settles here instead of growing.
pub const LOOP_CEILING: f32 = 0.7;
/// Seconds the loop guard takes to let go again.
const LOOP_RELEASE_SECONDS: f32 = 0.2;

/// Tone: cutoff of the low-pass with Tone at zero, and fully open.
const DARK_HZ: f32 = 600.0;
const OPEN_HZ: f32 = 18_000.0;
/// Tone: cutoff of the high-pass up to the middle (it only removes DC), and
/// with Tone at maximum.
const DC_HZ: f32 = 20.0;
const THIN_HZ: f32 = 1200.0;
/// The little low loss of a tape head.
const TAPE_LOW_LOSS_HZ: f32 = 55.0;

/// Tape speed in metres per second (19 cm/s) and the gap between tape and
/// head in metres when new; wear multiplies the gap.
const TAPE_SPEED: f32 = 0.19;
const TAPE_SPACING: f32 = 1.0e-6;
const TAPE_WEAR: f32 = 6.0;
const DRUM_WEAR: f32 = 9.0;
/// Speed error of the transport at full Mod: wow and flutter. Age adds a
/// little flutter of its own.
const WOW_ERROR: f32 = 0.008;
const FLUTTER_ERROR: f32 = 0.003;
const WORN_FLUTTER_ERROR: f32 = 0.001;

/// Bucket: what tells the hiss generator's seed from the wobble's (any odd
/// pattern of bits will do).
const HISS_SEED: u32 = 0x1357_9bdf;
/// Bucket: noise per clocked sample at full Age and the slowest clock.
const BUCKET_HISS: f32 = 0.008;

/// Duck: the input level (about -26 dBFS) at which the repeats are fully
/// ducked is the inverse of this; and how fast the follower reacts.
const DUCK_FULL: f32 = 20.0;
const DUCK_ATTACK_MS: f32 = 5.0;
const DUCK_RELEASE_MS: f32 = 100.0;

/// Filter: resonance, the gain that brings its peak back to unity
/// (`sqrt(1 - 1/(4 Q^2)) / Q`), sweep centre range and reach in octaves.
const SWEEP_Q: f32 = 2.0;
const SWEEP_TRIM: f32 = 0.484_123;
/// Filter: gain on the repeats that makes up half of that trim (its square
/// root), so the first repeat is about as loud as in the other modes.
const SWEEP_MAKE_UP: f32 = 1.437_22;
const SWEEP_LOW_HZ: f32 = 250.0;
const SWEEP_SPAN: f32 = 16.0;
const SWEEP_OCTAVES: f32 = 2.0;
const SWEEP_FASTEST_HZ: f32 = 8.0;
/// One sweep lasts this many repeats.
const SWEEP_REPEATS: f32 = 4.0;

/// Heads: positions along the loop as fractions of Time, evenly spaced and
/// spaced by powers of the golden ratio; and where each head sits in stereo.
const EVEN: [f32; 4] = [0.25, 0.5, 0.75, 1.0];
const GOLDEN: [f32; 4] = [0.236_068, 0.381_966, 0.618_034, 1.0];
const PAN: [f32; 4] = [-1.0, 1.0, -0.5, 0.5];

/// What every voice is given for one sample.
#[derive(Debug, Clone, Copy)]
pub struct Frame<const N: usize> {
    /// The input on its way into the echo, already scaled by Mix.
    pub input: [f32; N],
    /// The level of the dry input (for Duck).
    pub level: f32,
    pub feedback: f32,
    pub width: f32,
    /// Mod, smoothed every sample (the Duck amount).
    pub amount: f32,
    /// The delay time in whole samples and exactly.
    pub whole: usize,
    pub exact: f64,
}

/// Control values that are followed at the control rate.
#[derive(Debug, Clone, Copy)]
pub struct Slow {
    pub tone: f32,
    pub age: f32,
    pub spacing: f32,
    pub modulation: f32,
    pub width: f32,
    pub heads: u8,
}

/// What a voice returns: its repeats, and what it wants written to memory.
#[derive(Debug, Clone, Copy)]
pub struct Out<const N: usize> {
    pub wet: [f32; N],
    pub write: [f32; N],
}

#[derive(Debug, Clone, Copy)]
struct Side {
    low_cut: OnePole,
    high_cut: OnePole,
    head_loss: [OnePole; 2],
    sweep: StateVariable,
    bucket: Bucket,
}

#[derive(Debug, Clone, Copy)]
struct Head {
    ratio: Ramp,
    level: Smoothed,
    feed: Smoothed,
}

/// One mode at work on the shared memory. The engine runs one voice, and a
/// second one for the length of a crossfade when Mode changes.
#[derive(Debug, Clone)]
pub struct Voice<const N: usize> {
    mode: Mode,
    rate: f32,
    longest_window: usize,
    jump: JumpTime,
    slide: SlideTime,
    reverse: Reverse,
    wobble: Wobble,
    wow_depth: Ramp,
    flutter_depth: Ramp,
    drive: Ramp,
    sides: [Side; N],
    heads: [Head; 4],
    loop_level: f32,
    loop_release: f32,
    duck: EnvelopeFollower,
    sweep_phase: f32,
    clock_step: f32,
    bucket_cutoff: f32,
    hiss_level: f32,
    hiss: Noise,
}

fn tone_cutoffs(tone: f32) -> (f32, f32) {
    let tone = tone.clamp(0.0, 1.0);
    let low_pass = if tone >= 0.5 {
        OPEN_HZ
    } else {
        DARK_HZ * (OPEN_HZ / DARK_HZ).powf(tone * 2.0)
    };
    let high_pass = if tone <= 0.5 {
        DC_HZ
    } else {
        DC_HZ * (THIN_HZ / DC_HZ).powf(tone * 2.0 - 1.0)
    };
    (low_pass, high_pass)
}

/// Cutoff of each of the two one-pole filters that stand for the spacing
/// loss of a tape head, `exp(-2 pi f d / v)`: the loss reaches 3 dB at
/// `f = ln(sqrt 2) v / (2 pi d)`, and two equal poles are 3 dB down together
/// at `sqrt(sqrt 2 - 1)` = 0.6436 of their own cutoff.
fn head_loss_hertz(spacing_metres: f32) -> f32 {
    let down_3_db = 0.346_574 * TAPE_SPEED / (core::f32::consts::TAU * spacing_metres);
    down_3_db / 0.643_594
}

/// Gain of a source panned to `position` (-1 left, 1 right) on side `c`:
/// unity in the middle, falling to nothing on the far side.
fn pan_gain<const N: usize>(c: usize, position: f32) -> f32 {
    if N < 2 {
        1.0
    } else if c == 0 {
        (1.0 - position).clamp(0.0, 1.0)
    } else {
        (1.0 + position).clamp(0.0, 1.0)
    }
}

impl<const N: usize> Voice<N> {
    /// `longest` is the longest delay in samples the memory can be read at.
    pub fn new(sample_rate: f32, longest: usize, seed: u32) -> Self {
        let mut duck = EnvelopeFollower::default();
        duck.set_times(sample_rate, DUCK_ATTACK_MS, DUCK_RELEASE_MS);
        let side = Side {
            low_cut: OnePole::default(),
            high_cut: OnePole::default(),
            head_loss: [OnePole::default(); 2],
            sweep: StateVariable::default(),
            bucket: Bucket::new(sample_rate),
        };
        let head = Head {
            ratio: Ramp::default(),
            level: Smoothed::new(sample_rate, 30.0, 0.0),
            feed: Smoothed::new(sample_rate, 30.0, 0.0),
        };
        let fade = (Reverse::FADE_SECONDS * sample_rate) as usize + 2;
        Self {
            mode: Mode::Digital,
            rate: sample_rate,
            // A backwards window reads twice its own length back.
            longest_window: (longest / 2).saturating_sub(fade).max(8),
            jump: JumpTime::new(sample_rate),
            slide: SlideTime::new(sample_rate),
            reverse: Reverse::new(sample_rate),
            wobble: Wobble::new(sample_rate, CONTROL_EVERY, seed),
            wow_depth: Ramp::default(),
            flutter_depth: Ramp::default(),
            drive: Ramp::default(),
            sides: [side; N],
            heads: [head; 4],
            loop_level: 0.0,
            loop_release: (-1.0 / (LOOP_RELEASE_SECONDS * sample_rate).max(1.0)).exp(),
            duck,
            sweep_phase: 0.0,
            clock_step: 1.0,
            bucket_cutoff: 0.0,
            hiss_level: 0.0,
            hiss: Noise::new(seed ^ HISS_SEED),
        }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// The longest backwards window in samples.
    pub fn longest_window(&self) -> usize {
        self.longest_window
    }

    /// Starts the voice afresh in `mode` at the given delay time.
    pub fn start(&mut self, mode: Mode, whole: usize, exact: f64, slow: &Slow, seed: u32) {
        self.mode = mode;
        self.jump.snap(whole);
        self.slide.snap(exact);
        self.reverse.restart(whole.min(self.longest_window));
        self.wobble.reset(seed);
        self.hiss = Noise::new(seed ^ HISS_SEED);
        self.loop_level = 0.0;
        self.duck.reset();
        for side in &mut self.sides {
            side.low_cut.reset(0.0);
            side.high_cut.reset(0.0);
            for pole in &mut side.head_loss {
                pole.reset(0.0);
            }
            side.sweep.reset();
            side.bucket.reset();
        }
        self.sweep_phase = 0.0;
        self.bucket_cutoff = 0.0;
        self.update(slow, true);
    }

    /// The delay the voice is at, in seconds.
    fn seconds(&self) -> f32 {
        if self.mode.slides() {
            self.slide.delay() as f32 / self.rate
        } else {
            self.jump.length() as f32 / self.rate
        }
    }

    /// The length in samples of the loop the feedback travels.
    pub fn loop_length(&self) -> usize {
        match self.mode {
            Mode::Heads => {
                let feeding = self
                    .heads
                    .iter()
                    .max_by(|a, b| a.feed.target().total_cmp(&b.feed.target()))
                    .map_or(1.0, |head| head.ratio.value());
                (self.slide.delay() * f64::from(feeding)).round() as usize
            }
            Mode::Tape | Mode::Bucket => self.slide.delay().round() as usize,
            _ => self.jump.length(),
        }
    }

    /// Works out filters and depths from the slow controls. Called every
    /// `CONTROL_EVERY` samples; `snap` jumps to the values with no glide.
    pub fn update(&mut self, slow: &Slow, snap: bool) {
        let seconds = self.seconds();
        let aim = |ramp: &mut Ramp, target: f32| {
            if snap {
                ramp.snap(target);
            } else {
                ramp.aim(target, CONTROL_EVERY);
            }
        };
        let (mut low_pass, mut high_pass) = tone_cutoffs(slow.tone);
        let age = slow.age.clamp(0.0, 1.0);
        let (mut drive, mut loss) = (1.0, OPEN_HZ);
        let (mut wow, mut flutter) = (0.0, 0.0);
        match self.mode {
            Mode::Tape | Mode::Heads => {
                // Heads leans further with Age, towards a drum-style voicing.
                let (wear, push) = if self.mode == Mode::Heads {
                    (DRUM_WEAR, 4.7)
                } else {
                    (TAPE_WEAR, 3.2)
                };
                drive = 0.8 + push * age;
                loss = head_loss_hertz(TAPE_SPACING * wear.powf(age));
                high_pass = high_pass.max(TAPE_LOW_LOSS_HZ);
                wow = slow.modulation * WOW_ERROR * speed_to_delay(Wobble::WOW_HZ, seconds);
                flutter = (slow.modulation * FLUTTER_ERROR + age * WORN_FLUTTER_ERROR)
                    * speed_to_delay(Wobble::FLUTTER_HZ, seconds);
                self.wobble.update();
            }
            Mode::Bucket => {
                let clock = Bucket::clock_hertz(seconds);
                let cutoff = Bucket::cutoff_hertz(clock);
                self.clock_step = clock / self.rate;
                if (cutoff - self.bucket_cutoff).abs() > 0.002 * cutoff {
                    self.bucket_cutoff = cutoff;
                    for side in &mut self.sides {
                        side.bucket.set_cutoff(self.rate, cutoff);
                    }
                }
                let slowest = Bucket::LOWEST_CUTOFF / Bucket::CUTOFF_OF_CLOCK;
                self.hiss_level = age * BUCKET_HISS * (slowest / clock).sqrt();
                wow = slow.modulation * WOW_ERROR * speed_to_delay(Wobble::WOW_HZ, seconds);
                self.wobble.update();
            }
            Mode::Filter => {
                // The sweep keeps time with the repeats; Tone sets its centre.
                let hertz = (1.0 / (SWEEP_REPEATS * seconds.max(1.0e-3))).min(SWEEP_FASTEST_HZ);
                self.sweep_phase += hertz * CONTROL_EVERY as f32 / self.rate;
                self.sweep_phase -= self.sweep_phase.floor();
                let centre = SWEEP_LOW_HZ * SWEEP_SPAN.powf(slow.tone.clamp(0.0, 1.0));
                for (c, side) in self.sides.iter_mut().enumerate() {
                    let phase = self.sweep_phase + if c == 0 { 0.0 } else { 0.25 * slow.width };
                    let octaves =
                        SWEEP_OCTAVES * slow.modulation * crate::parts::smooth_wave(phase);
                    side.sweep.set(self.rate, centre * octaves.exp2(), SWEEP_Q);
                }
                low_pass = OPEN_HZ;
                high_pass = DC_HZ;
            }
            _ => {}
        }
        for side in &mut self.sides {
            side.low_cut.set_cutoff(self.rate, low_pass);
            side.high_cut.set_cutoff(self.rate, high_pass);
            for pole in &mut side.head_loss {
                pole.set_cutoff(self.rate, loss);
            }
        }
        aim(&mut self.drive, drive);
        aim(&mut self.wow_depth, wow);
        aim(&mut self.flutter_depth, flutter);
        if self.mode == Mode::Heads {
            let sounding = (slow.heads & 0b1111).max(1);
            let share = 1.0 / (sounding.count_ones() as f32).sqrt();
            let last = 7 - sounding.leading_zeros() as usize;
            let spacing = slow.spacing.clamp(0.0, 1.0);
            for (k, ((head, even), golden)) in
                self.heads.iter_mut().zip(EVEN).zip(GOLDEN).enumerate()
            {
                let on = (sounding >> k) & 1 == 1;
                let level = if on { share } else { 0.0 };
                let feed = if k == last { 1.0 } else { 0.0 };
                aim(&mut head.ratio, lerp(even, golden, spacing));
                if snap {
                    head.level.snap(level);
                    head.feed.snap(feed);
                } else {
                    head.level.set(level);
                    head.feed.set(feed);
                }
            }
        }
    }

    /// One sample: reads the repeats from `lines` and returns them with what
    /// should be written next.
    pub fn tick(&mut self, lines: &[DelayLine; N], s: &Frame<N>) -> Out<N> {
        self.jump.advance(s.whole);
        let exact = self.slide.advance(s.exact);
        let mut wet = [0.0_f32; N];
        let mut back = [0.0_f32; N];
        match self.mode {
            Mode::Digital | Mode::Duck | Mode::Filter | Mode::Ping | Mode::Reverse => {
                let mut taps = [0.0_f32; N];
                for (tap, line) in taps.iter_mut().zip(lines) {
                    *tap = self.jump.read(line);
                }
                if self.mode == Mode::Ping && N == 2 {
                    // Each side feeds the other, so repeats change sides.
                    let near = 0.5 * (1.0 + s.width);
                    for (c, (wet, back)) in wet.iter_mut().zip(&mut back).enumerate() {
                        let own = taps.get(c).copied().unwrap_or(0.0);
                        let other = taps.get((c + 1) % N).copied().unwrap_or(0.0);
                        *wet = near * own + (1.0 - near) * other;
                        *back = other;
                    }
                } else {
                    wet = taps;
                    back = taps;
                }
                if self.mode == Mode::Reverse {
                    let readings = self.reverse.advance(s.whole.min(self.longest_window));
                    for (wet, line) in wet.iter_mut().zip(lines) {
                        *wet = 0.0;
                        for reading in readings {
                            if reading.gain > 0.0 {
                                *wet += reading.gain * read_whole(line, reading.delay);
                            }
                        }
                    }
                }
            }
            Mode::Tape | Mode::Bucket | Mode::Heads => {
                let (wow_left, wow_right, flutter) = self.wobble.next(0.25 * s.width);
                let (wow_depth, flutter_depth) = (self.wow_depth.next(), self.flutter_depth.next());
                let mut shares = [(0.0_f32, 0.0_f32, 0.0_f32); 4];
                if self.mode == Mode::Heads {
                    for (share, head) in shares.iter_mut().zip(&mut self.heads) {
                        *share = (head.ratio.next(), head.level.next(), head.feed.next());
                    }
                }
                for (c, ((wet, back), line)) in wet.iter_mut().zip(&mut back).zip(lines).enumerate()
                {
                    let wow = if c == 0 { wow_left } else { wow_right };
                    let moved =
                        exact * (1.0 + f64::from(wow_depth * wow + flutter_depth * flutter));
                    if self.mode == Mode::Heads {
                        for ((ratio, level, feed), pan) in shares.iter().zip(PAN) {
                            if *level == 0.0 && *feed == 0.0 {
                                continue;
                            }
                            let tap = read_cubic(line, moved * f64::from(*ratio));
                            *wet += tap * level * pan_gain::<N>(c, pan * s.width);
                            *back += tap * feed;
                        }
                    } else {
                        *wet = read_cubic(line, moved);
                        *back = *wet;
                    }
                }
            }
        }
        if self.mode == Mode::Filter {
            for wet in &mut wet {
                *wet *= SWEEP_MAKE_UP;
            }
        }
        if self.mode == Mode::Duck {
            let playing = (self.duck.process(s.level) * DUCK_FULL).min(1.0);
            let gain = 1.0 - s.amount.clamp(0.0, 1.0) * playing;
            for wet in &mut wet {
                *wet *= gain;
            }
        }
        // The loop guard: turn the feedback down while it is above the ceiling.
        let mut loudest = 0.0_f32;
        for back in &mut back {
            *back *= s.feedback;
            loudest = loudest.max(back.abs());
        }
        // The level rises with the feedback at once and falls back slowly, so
        // what is fed back never passes the ceiling, not even for a sample.
        self.loop_level = loudest.max(self.loop_level * self.loop_release);
        let level = self.loop_level;
        let trim = if level > LOOP_CEILING {
            LOOP_CEILING / level
        } else {
            1.0
        };
        let drive = self.drive.next();
        let hiss = self.hiss.next();
        let ping = self.mode == Mode::Ping && N == 2;
        let centre = s.input.iter().sum::<f32>() / N.max(1) as f32;
        let mut write = [0.0_f32; N];
        for (c, (((side, write), back), input)) in self
            .sides
            .iter_mut()
            .zip(&mut write)
            .zip(back)
            .zip(s.input)
            .enumerate()
        {
            let input = match (ping, c) {
                (false, _) => input,
                (true, 0) => centre,
                (true, _) => 0.0,
            };
            let fed = back * trim;
            *write = match self.mode {
                // Tape, bucket brigade and filter colour everything that is
                // recorded, so the first repeat already carries the sound.
                Mode::Tape | Mode::Heads => {
                    let mut y = tape_curve(input + fed, drive);
                    for pole in &mut side.head_loss {
                        y = pole.lowpass(y);
                    }
                    side.high_cut.highpass(side.low_cut.lowpass(y))
                }
                Mode::Bucket => {
                    // One noise source at Width zero, one per side at full Width.
                    let own = if c == 0 {
                        hiss
                    } else {
                        lerp(hiss, self.hiss.next(), s.width)
                    };
                    let y =
                        side.bucket
                            .process(input + fed, self.clock_step, own * self.hiss_level);
                    side.high_cut.highpass(side.low_cut.lowpass(y))
                }
                Mode::Filter => {
                    side.sweep.process(input + fed);
                    side.high_cut.highpass(side.sweep.low() * SWEEP_TRIM)
                }
                // The clean modes record the input untouched; Tone works on
                // the feedback only, so each further repeat is cut again.
                _ => input + side.high_cut.highpass(side.low_cut.lowpass(fed)),
            };
        }
        Out { wet, write }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_is_open_in_the_middle_and_cuts_towards_either_end() {
        assert_eq!(tone_cutoffs(0.5), (OPEN_HZ, DC_HZ));
        let (dark, _) = tone_cutoffs(0.0);
        let (_, thin) = tone_cutoffs(1.0);
        assert!((dark - DARK_HZ).abs() < 0.5 && (thin - THIN_HZ).abs() < 0.5);
        let (quarter, low) = tone_cutoffs(0.25);
        assert!(quarter > DARK_HZ && quarter < OPEN_HZ && low == DC_HZ);
    }

    #[test]
    fn head_loss_darkens_with_spacing() {
        // New tape: 3 dB down near 10.5 kHz, so each pole sits near 16.3 kHz.
        let new = head_loss_hertz(TAPE_SPACING);
        assert!((new * 0.643_594 - 10_480.0).abs() < 20.0);
        assert!(head_loss_hertz(TAPE_SPACING * TAPE_WEAR) < new / 5.9);
    }

    #[test]
    fn pans_and_constants_are_consistent() {
        assert_eq!(pan_gain::<1>(0, -1.0), 1.0);
        assert_eq!(pan_gain::<2>(0, -1.0), 1.0);
        assert_eq!(pan_gain::<2>(1, -1.0), 0.0);
        assert_eq!(pan_gain::<2>(1, 0.0), 1.0);
        let golden = 0.5 * (5.0_f32.sqrt() - 1.0);
        for (k, ratio) in GOLDEN.iter().enumerate() {
            assert!((ratio - golden.powi(3 - k as i32)).abs() < 1.0e-5);
        }
        let peak = SWEEP_Q / (1.0 - 1.0 / (4.0 * SWEEP_Q * SWEEP_Q)).sqrt();
        assert!((SWEEP_TRIM * peak - 1.0).abs() < 1.0e-4);
        assert!((SWEEP_MAKE_UP * SWEEP_MAKE_UP * SWEEP_TRIM - 1.0).abs() < 1.0e-4);
    }
}
