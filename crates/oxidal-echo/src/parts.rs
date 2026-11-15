//! The small building blocks of Oxidal Echo: how the delay memory is read
//! (jumping, sliding, backwards), the tape and bucket-brigade colours, and
//! the guards that keep every loop bounded.
//!
//! Original code; `REFERENCES.md` names the published source of each block.
//! @see docs/native-echo.md

use oxidal_dsp::{DelayLine, EnvelopeFollower, Noise, StateVariable, lerp, soft_clip};

/// Rounds a vanishing value to zero, so a tail ends in true silence and no
/// tiny number circulates for ever.
pub fn flush(x: f32) -> f32 {
    if x.abs() < 1.0e-18 { 0.0 } else { x }
}

/// The limiter on everything written to the delay memory: exact up to full
/// scale, then a smooth knee that never passes twice full scale. A value that
/// is not a number becomes silence.
pub fn guard(x: f32) -> f32 {
    if !x.is_finite() {
        return 0.0;
    }
    let size = x.abs();
    if size <= 1.0 {
        x
    } else {
        (1.0 + soft_clip(size - 1.0)).copysign(x)
    }
}

/// The Langevin function `coth(x) - 1/x`: the curve along which a magnetic
/// material saturates when it has no memory (the anhysteretic magnetisation
/// of the Jiles-Atherton model). Slope 1/3 at zero, bounded by +-1.
pub fn langevin(x: f32) -> f32 {
    let size = x.abs();
    if size < 0.5 {
        // Taylor series: the closed form loses precision near zero.
        let x2 = x * x;
        x * (1.0 / 3.0 - x2 * (1.0 / 45.0 - x2 * (2.0 / 945.0 - x2 * (1.0 / 4725.0))))
    } else {
        let e = (2.0 * size.min(20.0)).exp();
        ((e + 1.0) / (e - 1.0) - 1.0 / size).copysign(x)
    }
}

/// Tape saturation with unity gain for quiet signals: the Langevin curve
/// scaled so `drive` only sets how soon it bends.
pub fn tape_curve(x: f32, drive: f32) -> f32 {
    let drive = drive.max(0.1);
    (3.0 / drive) * langevin(drive * x)
}

/// A smooth wave between -1 and 1 on a 0..1 phase, cheap enough to run every
/// sample: a triangle rounded by the cubic `t (3 - t^2) / 2`, which has zero
/// slope at both peaks.
pub fn smooth_wave(phase: f32) -> f32 {
    let p = phase - phase.floor();
    let t = 4.0 * (p - 0.5).abs() - 1.0;
    t * (1.5 - 0.5 * t * t)
}

/// A value that moves to each new target in a straight line over a set number
/// of samples, so a coefficient worked out at the control rate never steps.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ramp {
    value: f32,
    step: f32,
    target: f32,
    left: u32,
}

impl Ramp {
    pub fn snap(&mut self, value: f32) {
        self.value = value;
        self.target = value;
        self.left = 0;
    }
    pub fn aim(&mut self, target: f32, samples: u32) {
        let samples = samples.max(1);
        self.target = target;
        self.step = (target - self.value) / samples as f32;
        self.left = samples;
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        if self.left > 0 {
            self.left -= 1;
            self.value = if self.left == 0 {
                self.target
            } else {
                self.value + self.step
            };
        }
        self.value
    }
    pub fn value(&self) -> f32 {
        self.value
    }
}

/// The sample written `delay` samples before the one about to be written.
pub fn read_whole(line: &DelayLine, delay: usize) -> f32 {
    line.tap(delay.clamp(1, line.capacity()) - 1)
}

/// The same read at a fractional delay, through four neighbouring samples
/// (the Catmull-Rom cubic). The position is split in double precision, so a
/// delay of seconds keeps its fraction.
pub fn read_cubic(line: &DelayLine, delay: f64) -> f32 {
    let last = line.capacity().saturating_sub(3).max(2) as f64;
    let position = if delay.is_finite() { delay - 1.0 } else { 1.0 }.clamp(1.0, last);
    let whole = position as usize;
    let t = (position - whole as f64) as f32;
    let (ym1, y0, y1, y2) = (
        line.tap(whole.saturating_sub(1)),
        line.tap(whole),
        line.tap(whole + 1),
        line.tap(whole + 2),
    );
    let c1 = 0.5 * (y1 - ym1);
    let c2 = ym1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2;
    let c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
    ((c3 * t + c2) * t + c1) * t + y0
}

/// A whole-sample delay that changes by crossfading from the old read
/// position to the new one, so a time change never bends the pitch.
#[derive(Debug, Clone, Copy)]
pub struct JumpTime {
    from: usize,
    to: usize,
    mix: f32,
    step: f32,
    moving: bool,
}

impl JumpTime {
    /// Seconds one crossfade between two read positions takes.
    pub const SECONDS: f32 = 0.03;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            from: 1,
            to: 1,
            mix: 0.0,
            step: 1.0 / (Self::SECONDS * sample_rate).max(1.0),
            moving: false,
        }
    }
    pub fn snap(&mut self, delay: usize) {
        self.from = delay;
        self.to = delay;
        self.mix = 0.0;
        self.moving = false;
    }
    /// Advances one sample towards `target`; a new target waits for the
    /// crossfade in progress to finish.
    pub fn advance(&mut self, target: usize) {
        if self.moving {
            self.mix += self.step;
            if self.mix >= 1.0 {
                self.moving = false;
                self.from = self.to;
            }
        } else if target != self.to {
            self.from = self.to;
            self.to = target;
            self.mix = 0.0;
            self.moving = true;
        }
    }
    pub fn read(&self, line: &DelayLine) -> f32 {
        if self.moving {
            lerp(
                read_whole(line, self.from),
                read_whole(line, self.to),
                self.mix,
            )
        } else {
            read_whole(line, self.to)
        }
    }
    /// The delay being read, or moved to, in samples.
    pub fn length(&self) -> usize {
        self.to
    }
}

/// A fractional delay that slides to its target like a tape machine changing
/// speed: the read position lags, and while it moves the pitch glides. The
/// slide is limited to one octave up or down.
#[derive(Debug, Clone, Copy)]
pub struct SlideTime {
    delay: f64,
    pull: f64,
}

impl SlideTime {
    /// Time constant of the slide in seconds.
    pub const SECONDS: f64 = 0.12;

    pub fn new(sample_rate: f32) -> Self {
        let samples = (Self::SECONDS * f64::from(sample_rate)).max(1.0);
        Self {
            delay: 2.0,
            pull: 1.0 - (-1.0 / samples).exp(),
        }
    }
    pub fn snap(&mut self, delay: f64) {
        self.delay = delay;
    }
    /// Advances one sample and returns the delay in samples. The delay
    /// shrinks by at most one sample per sample (playback at double speed)
    /// and grows by at most half a sample (half speed).
    pub fn advance(&mut self, target: f64) -> f64 {
        self.delay += ((target - self.delay) * self.pull).clamp(-1.0, 0.5);
        self.delay
    }
    pub fn delay(&self) -> f64 {
        self.delay
    }
}

/// Wow and flutter: the slow and the fast unevenness of a tape transport, as
/// two wandering oscillators plus a little noise.
#[derive(Debug, Clone, Copy)]
pub struct Wobble {
    wow: f32,
    flutter: f32,
    wow_step: f32,
    flutter_step: f32,
    wow_drift: f32,
    flutter_drift: f32,
    rough: f32,
    rough_pull: f32,
    rough_gain: f32,
    drift_pull: f32,
    drift_gain: f32,
    per_sample: f32,
    noise: Noise,
}

impl Wobble {
    /// Centre rates in hertz; each wanders around its centre.
    pub const WOW_HZ: f32 = 1.0;
    pub const FLUTTER_HZ: f32 = 9.0;
    /// How far each rate wanders: wow 0.5 to 1.5 Hz, flutter 6 to 12 Hz.
    const WOW_WANDER: f32 = 0.5;
    const FLUTTER_WANDER: f32 = 1.0 / 3.0;

    /// `update_every` is the number of samples between calls to `update`.
    pub fn new(sample_rate: f32, update_every: u32, seed: u32) -> Self {
        // The drift is white noise through a one-pole lag of about a second.
        // Its spread is sqrt(k / (2 - k) / 3) for uniform noise, so the gain
        // below brings two standard deviations to full scale.
        let k = (update_every as f32 / sample_rate).clamp(1.0e-6, 1.0);
        let spread = (k / (2.0 - k) / 3.0).sqrt();
        // The same lag at about 30 Hz makes the random part of flutter; its
        // gain brings that part to a tenth of full scale (RMS) at any rate.
        let rough_pull = 1.0 - (-core::f32::consts::TAU * 30.0 / sample_rate).exp();
        let rough_spread = (rough_pull / (2.0 - rough_pull) / 3.0).sqrt();
        Self {
            wow: 0.0,
            flutter: 0.0,
            wow_step: Self::WOW_HZ / sample_rate,
            flutter_step: Self::FLUTTER_HZ / sample_rate,
            wow_drift: 0.0,
            flutter_drift: 0.0,
            rough: 0.0,
            rough_pull,
            rough_gain: 0.1 / rough_spread.max(1.0e-6),
            drift_pull: k,
            drift_gain: 0.5 / spread,
            per_sample: 1.0 / sample_rate,
            noise: Noise::new(seed),
        }
    }
    pub fn reset(&mut self, seed: u32) {
        self.wow = 0.0;
        self.flutter = 0.0;
        self.wow_drift = 0.0;
        self.flutter_drift = 0.0;
        self.rough = 0.0;
        self.noise = Noise::new(seed);
        self.update();
    }
    /// Lets both rates wander a little; called at the control rate.
    pub fn update(&mut self) {
        self.wow_drift += (self.noise.next() - self.wow_drift) * self.drift_pull;
        self.flutter_drift += (self.noise.next() - self.flutter_drift) * self.drift_pull;
        let wander = |drift: f32| (drift * self.drift_gain).clamp(-1.0, 1.0);
        self.wow_step =
            Self::WOW_HZ * (1.0 + Self::WOW_WANDER * wander(self.wow_drift)) * self.per_sample;
        self.flutter_step = Self::FLUTTER_HZ
            * (1.0 + Self::FLUTTER_WANDER * wander(self.flutter_drift))
            * self.per_sample;
    }
    /// Advances one sample. Returns the wow of the left side, the wow of the
    /// right side (`offset` of a cycle later) and the flutter both share.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self, offset: f32) -> (f32, f32, f32) {
        self.wow += self.wow_step;
        if self.wow >= 1.0 {
            self.wow -= 1.0;
        }
        self.flutter += self.flutter_step;
        if self.flutter >= 1.0 {
            self.flutter -= 1.0;
        }
        // The random part of flutter: noise below about 30 Hz.
        self.rough += (self.noise.next() - self.rough) * self.rough_pull;
        (
            smooth_wave(self.wow),
            smooth_wave(self.wow + offset),
            0.75 * smooth_wave(self.flutter) + self.rough_gain * self.rough,
        )
    }
}

/// How much of a speed error of a given rate shows up as a delay error.
///
/// A transport running `e sin(w t)` too fast changes the delay `D` between
/// record and playback by the integral of that error over the last `D`
/// seconds, whose size is `e D |sin(w D / 2) / (w D / 2)|`. This returns the
/// smooth envelope of that factor, `1 / sqrt(1 + (w D / 2)^2)`: slow wow moves
/// the whole delay, fast flutter mostly averages out.
pub fn speed_to_delay(hertz: f32, seconds: f32) -> f32 {
    let half = core::f32::consts::PI * hertz * seconds;
    1.0 / (1.0 + half * half).sqrt()
}

/// A bucket-brigade delay line's colour, without the delay itself: 2:1
/// compressor, anti-alias filter, sampling and holding at the line's clock,
/// stage noise and saturation, reconstruction filter and 1:2 expander.
#[derive(Debug, Clone, Copy)]
pub struct Bucket {
    squeeze: EnvelopeFollower,
    stretch: EnvelopeFollower,
    anti_alias: StateVariable,
    rebuild: StateVariable,
    clock: f32,
    held: f32,
    before: f32,
}

impl Bucket {
    /// Stages of the modelled line: with the clock at `f`, it delays by
    /// `STAGES / (2 f)`.
    pub const STAGES: f32 = 4096.0;
    /// Filter cutoff as a fraction of the clock, and its lowest value.
    pub const CUTOFF_OF_CLOCK: f32 = 1.0 / 3.0;
    pub const LOWEST_CUTOFF: f32 = 1500.0;
    pub const HIGHEST_CUTOFF: f32 = 9000.0;
    /// The level the compander leaves unchanged, and its largest gain.
    const REFERENCE: f32 = 0.1;
    const MOST: f32 = 4.0;
    const ATTACK_MS: f32 = 2.0;
    const RELEASE_MS: f32 = 20.0;

    pub fn new(sample_rate: f32) -> Self {
        let mut bucket = Self {
            squeeze: EnvelopeFollower::default(),
            stretch: EnvelopeFollower::default(),
            anti_alias: StateVariable::default(),
            rebuild: StateVariable::default(),
            clock: 0.0,
            held: 0.0,
            before: 0.0,
        };
        bucket
            .squeeze
            .set_times(sample_rate, Self::ATTACK_MS, Self::RELEASE_MS);
        bucket
            .stretch
            .set_times(sample_rate, Self::ATTACK_MS, Self::RELEASE_MS);
        bucket.set_cutoff(sample_rate, Self::HIGHEST_CUTOFF);
        bucket
    }
    pub fn reset(&mut self) {
        self.squeeze.reset();
        self.stretch.reset();
        self.anti_alias.reset();
        self.rebuild.reset();
        self.clock = 0.0;
        self.held = 0.0;
        self.before = 0.0;
    }
    /// The clock rate in hertz for a delay of `seconds`, never below the rate
    /// that puts the filters at their lowest cutoff.
    pub fn clock_hertz(seconds: f32) -> f32 {
        (Self::STAGES / (2.0 * seconds.max(1.0e-3)))
            .max(Self::LOWEST_CUTOFF / Self::CUTOFF_OF_CLOCK)
    }
    /// The filter cutoff in hertz that goes with a clock rate.
    pub fn cutoff_hertz(clock_hertz: f32) -> f32 {
        (clock_hertz * Self::CUTOFF_OF_CLOCK).clamp(Self::LOWEST_CUTOFF, Self::HIGHEST_CUTOFF)
    }
    /// Sets both filters, which track the clock.
    pub fn set_cutoff(&mut self, sample_rate: f32, hertz: f32) {
        let q = core::f32::consts::FRAC_1_SQRT_2;
        self.anti_alias.set(sample_rate, hertz, q);
        self.rebuild.set(sample_rate, hertz, q);
    }
    /// One sample through the line's colour. `clock_step` is the clock rate
    /// over the sample rate; `hiss` is a noise sample already scaled.
    pub fn process(&mut self, x: f32, clock_step: f32, hiss: f32) -> f32 {
        // Feedback compressor: its gain is the inverse of its own output level.
        let floor = Self::REFERENCE / Self::MOST;
        let squeezed = x * (Self::REFERENCE / self.squeeze.level().max(floor));
        self.squeeze.process(squeezed);
        self.anti_alias.process(squeezed);
        let now = self.anti_alias.low();
        // The line takes one sample per clock period and holds it. A clock
        // edge inside this sample period splits the period between the old
        // and the new held value.
        let held = if clock_step >= 1.0 {
            self.held = now;
            now
        } else {
            self.clock += clock_step.max(1.0e-4);
            if self.clock >= 1.0 {
                self.clock -= 1.0;
                let after = (self.clock / clock_step.max(1.0e-4)).clamp(0.0, 1.0);
                // Noise joins at the edge and only while there is signal, so
                // the line falls silent when the playing stops.
                let present = (self.squeeze.level() / floor).min(1.0);
                let taken = lerp(now, self.before, after) + hiss * present;
                let out = lerp(self.held, taken, after);
                self.held = taken;
                out
            } else {
                self.held
            }
        };
        self.before = now;
        self.rebuild.process(soft_clip(held));
        let rebuilt = self.rebuild.low();
        // Feed-forward expander: its gain is its input level.
        let level = self.stretch.process(rebuilt);
        rebuilt * (level / Self::REFERENCE).clamp(1.0 / Self::MOST, Self::MOST)
    }
}

/// Backwards playback: the memory is read in windows, each played from its
/// end to its start, with the edges of neighbouring windows crossfaded.
#[derive(Debug, Clone, Copy)]
pub struct Reverse {
    playing: Grain,
    leaving: Grain,
    longest_fade: usize,
}

#[derive(Debug, Clone, Copy, Default)]
struct Grain {
    age: usize,
    window: usize,
    fade_in: usize,
    fade_out: usize,
    live: bool,
}

/// One reader of the memory: how far back to read, and how loud.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Reading {
    pub delay: usize,
    pub gain: f32,
}

impl Reverse {
    /// Seconds of crossfade at each window edge, at most a quarter window.
    pub const FADE_SECONDS: f32 = 0.02;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            playing: Grain::default(),
            leaving: Grain::default(),
            longest_fade: ((Self::FADE_SECONDS * sample_rate) as usize).max(1),
        }
    }
    /// Starts a window of `window` samples now.
    pub fn restart(&mut self, window: usize) {
        self.leaving = Grain::default();
        self.playing = self.grain(window);
        // The first window has nothing to crossfade from.
        self.playing.fade_in = 0;
    }
    fn grain(&self, window: usize) -> Grain {
        let window = window.max(8);
        Grain {
            age: 0,
            window,
            fade_in: (window / 4).clamp(1, self.longest_fade),
            fade_out: 0,
            live: true,
        }
    }
    /// Advances one sample and returns the two readers. A reader that is
    /// `a` samples into its window reads `2a + 1` samples back: the sample
    /// just before the window began, then ever earlier ones.
    pub fn advance(&mut self, window: usize) -> [Reading; 2] {
        let playing = Reading {
            delay: 2 * self.playing.age + 1,
            gain: if self.playing.age < self.playing.fade_in {
                self.playing.age as f32 / self.playing.fade_in as f32
            } else {
                1.0
            },
        };
        let leaving = if self.leaving.live && self.leaving.fade_out > 0 {
            let past = self.leaving.age.saturating_sub(self.leaving.window);
            Reading {
                delay: 2 * self.leaving.age + 1,
                gain: (1.0 - past as f32 / self.leaving.fade_out as f32).max(0.0),
            }
        } else {
            Reading::default()
        };
        self.playing.age += 1;
        if self.leaving.live {
            self.leaving.age += 1;
            if self.leaving.age >= self.leaving.window + self.leaving.fade_out {
                self.leaving.live = false;
            }
        }
        if self.playing.age >= self.playing.window {
            let next = self.grain(window);
            self.leaving = self.playing;
            self.leaving.fade_out = next.fade_in;
            self.playing = next;
        }
        [playing, leaving]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_is_exact_below_full_scale_and_bounded_above() {
        for x in [-1.0, -0.3, 0.0, 0.5, 1.0] {
            assert_eq!(guard(x), x);
        }
        assert!(guard(1.0e9) <= 2.0 && guard(-1.0e9) >= -2.0);
        assert!(guard(1.5) > 1.0 && guard(1.5) < 1.5);
        assert_eq!(guard(f32::NAN), 0.0);
        assert_eq!(guard(f32::INFINITY), 0.0);
        assert_eq!(flush(1.0e-20), 0.0);
        assert_eq!(flush(-0.25), -0.25);
    }

    #[test]
    fn langevin_matches_its_definition() {
        for x in [0.6_f64, 1.0, 3.0, 10.0, 50.0] {
            let exact = 1.0 / x.tanh() - 1.0 / x;
            assert!((f64::from(langevin(x as f32)) - exact).abs() < 1.0e-5);
            assert!((f64::from(langevin(-x as f32)) + exact).abs() < 1.0e-5);
        }
        // The series and the closed form meet where the code switches.
        assert!((langevin(0.499_99) - langevin(0.5)).abs() < 1.0e-5);
        assert!((langevin(0.01) - 0.01 / 3.0).abs() < 1.0e-6);
        assert!(langevin(1.0e6) <= 1.0);
        // Quiet signals pass the tape curve unchanged; loud ones are bounded.
        assert!((tape_curve(0.01, 2.0) - 0.01).abs() < 1.0e-5);
        assert!(tape_curve(100.0, 2.0) <= 1.5);
    }

    #[test]
    fn smooth_wave_is_a_rounded_cycle() {
        assert!((smooth_wave(0.0) - 1.0).abs() < 1.0e-6);
        assert!((smooth_wave(0.5) + 1.0).abs() < 1.0e-6);
        assert!(smooth_wave(0.25).abs() < 1.0e-6);
        let mut previous = smooth_wave(0.0);
        for i in 1..=1000 {
            let now = smooth_wave(i as f32 / 1000.0);
            assert!((-1.0..=1.0).contains(&now) && (now - previous).abs() < 0.01);
            previous = now;
        }
    }

    #[test]
    fn cubic_read_agrees_with_whole_reads_and_keeps_long_fractions() {
        let mut line = DelayLine::new(400_000);
        for i in 0..400_000 {
            line.write(i as f32 * 0.001);
        }
        // Before the next write, a delay of d is the sample d writes back.
        assert!((read_whole(&line, 1) - 399.999).abs() < 1.0e-4);
        assert_eq!(read_whole(&line, 0), read_whole(&line, 1));
        assert!((read_cubic(&line, 100.0) - read_whole(&line, 100)).abs() < 1.0e-3);
        let far = read_cubic(&line, 300_000.25);
        assert!((far - (399_999.0 - 300_000.25 + 1.0) * 0.001).abs() < 2.0e-4);
        assert!(read_cubic(&line, f64::NAN).is_finite());
        assert!(read_cubic(&line, 1.0e12).is_finite());
        assert!(read_cubic(&line, -5.0).is_finite());
    }

    #[test]
    fn a_jump_crossfades_and_a_slide_is_speed_limited() {
        let mut jump = JumpTime::new(48_000.0);
        jump.snap(100);
        jump.advance(200);
        assert_eq!(jump.length(), 200);
        let mut samples = 0;
        while jump.moving {
            jump.advance(300); // waits its turn
            samples += 1;
        }
        assert!((1439..=1441).contains(&samples));
        assert_eq!(jump.length(), 200);
        jump.advance(300);
        assert_eq!(jump.length(), 300);

        let mut slide = SlideTime::new(48_000.0);
        slide.snap(48_000.0);
        let first = slide.advance(480.0);
        assert!((48_000.0 - first - 1.0).abs() < 1.0e-9); // double speed at most
        slide.snap(480.0);
        assert!((slide.advance(48_000.0) - 480.5).abs() < 1.0e-9); // half speed at most
        for _ in 0..400_000 {
            slide.advance(48_000.0);
        }
        assert!((slide.delay() - 48_000.0).abs() < 0.01);
    }

    #[test]
    fn reverse_reads_each_window_backwards_at_full_gain() {
        let mut reverse = Reverse::new(48_000.0);
        reverse.restart(1000);
        let mut total = Vec::new();
        for i in 0..5000_usize {
            let [a, b] = reverse.advance(1000);
            total.push(a.gain + b.gain);
            let age = i % 1000;
            assert_eq!(a.delay, 2 * age + 1);
            if b.gain > 0.0 {
                assert_eq!(b.delay, 2 * (age + 1000) + 1);
            }
        }
        // After the first window the two readers always sum to unity.
        assert!(total.iter().skip(1000).all(|g| (g - 1.0).abs() < 1.0e-5));
        assert!(total.iter().take(1000).all(|g| *g == 1.0));
    }

    #[test]
    fn wobble_stays_in_range_and_wanders() {
        let mut wobble = Wobble::new(48_000.0, 16, 3);
        let (mut low, mut high) = (f32::MAX, f32::MIN);
        for i in 0..480_000 {
            if i % 16 == 0 {
                wobble.update();
            }
            let (left, right, flutter) = wobble.next(0.25);
            assert!(left.abs() <= 1.0 && right.abs() <= 1.0 && flutter.abs() < 2.0);
            low = low.min(wobble.wow_step);
            high = high.max(wobble.wow_step);
        }
        let hertz = |step: f32| step * 48_000.0;
        assert!(hertz(low) >= 0.499 && hertz(high) <= 1.501 && hertz(high) > hertz(low) + 0.1);
        assert!(speed_to_delay(1.0, 0.0) == 1.0 && speed_to_delay(9.0, 1.0) < 0.05);
    }

    #[test]
    fn bucket_compander_is_transparent_for_a_steady_tone() {
        let mut bucket = Bucket::new(48_000.0);
        bucket.set_cutoff(48_000.0, Bucket::HIGHEST_CUTOFF);
        for amplitude in [0.01_f32, 0.1, 0.5] {
            bucket.reset();
            let mut peak = 0.0_f32;
            for i in 0..48_000 {
                let x = amplitude * (core::f32::consts::TAU * 220.0 * i as f32 / 48_000.0).sin();
                let y = bucket.process(x, 1.0, 0.0);
                if i > 24_000 {
                    peak = peak.max(y.abs());
                }
            }
            let db = 20.0 * (peak / amplitude).log10();
            assert!(db.abs() < 1.0, "{amplitude}: {db} dB");
        }
        // The clock follows the delay time down to its floor.
        assert!((Bucket::clock_hertz(0.1) - 20_480.0).abs() < 1.0);
        assert_eq!(Bucket::clock_hertz(3.0), 4500.0);
        assert_eq!(Bucket::cutoff_hertz(4500.0), 1500.0);
    }
}
