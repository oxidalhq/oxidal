//! The Driver: a feedback loop tuned to the played note.
//!
//! A delay line one period long feeds its output back to its input: a comb
//! filter that resonates at the note and its harmonics. The played note is
//! added into the loop, so what goes round is the guitar's own waveform; a
//! gain inside the loop holds the level at a target, so the loop keeps going
//! at that level when the string stops feeding it.
//!
//! # References
//!
//! - Karplus and Strong, "Digital Synthesis of Plucked-String and Drum Timbres" (1983). <https://doi.org/10.2307/3680062>
//! - Jaffe and Smith, "Extensions of the Karplus-Strong Plucked-String Algorithm" (1983). <https://doi.org/10.2307/3680063>
//! - Smith, "Physical Audio Signal Processing" (2010). <https://ccrma.stanford.edu/~jos/pasp/>
//!
//! @see docs/native-sustain.md

use oxidal_dsp::DelayLine;

/// Shortest loop: 8 samples is 6 kHz at 48 kHz, above any harmonic used.
const SHORTEST: f32 = 8.0;
/// Lowest loop frequency the delay memory is sized for.
const LOWEST_HERTZ: f32 = 36.0;
/// Time over which the loop glides to a new period. The engine already
/// moves the period smoothly between pitch readings; this only rounds off
/// the corners, so it is short enough for vibrato.
const GLIDE_SECONDS: f32 = 0.004;
/// Time over which the loop gain moves between control updates.
const GAIN_SECONDS: f32 = 0.001;
/// The level detector is two averages in a row, each over this many periods
/// (between the limits below). A squared sinusoid ripples at twice its
/// frequency; each average passes 1/(4·pi·1.5) of that, so 0.3 % is left. The
/// ripple matters: a loop gain that wobbles at twice the note's frequency
/// pumps energy between the note, its harmonics and a constant offset.
const LEVEL_PERIODS: f32 = 1.5;
const LEVEL_SHORTEST: f32 = 0.003;
const LEVEL_LONGEST: f32 = 0.040;
/// How hard the gain pulls an over-loud loop down, gain = (target/level)^0.3,
/// once the level is more than `MARGIN` nepers (0.5 dB) over the target.
/// With the detector's lag of three periods the phase margin is about 45
/// degrees. Inside the margin the gentle growing slope applies on both
/// sides, so what ripple is left is never rectified.
const PULL_DOWN: f32 = 0.3;
const MARGIN: f32 = 0.06;
/// Corner of the high-pass inside the loop. A comb resonates at zero hertz
/// too, and nothing else stops an offset there from growing.
const OFFSET_HERTZ: f32 = 0.5;
/// The loop may grow by at most 60 dB a second (6.9 nepers).
const GROW_NEPERS: f32 = 6.9;
/// The smallest loop gain: a loop this damped forgets in two periods.
const LEAST_GAIN: f32 = 0.3;
/// Partials at 3 kHz fade by about 1 dB a second while the loop runs alone,
/// so a long note mellows slowly; lower partials last in proportion to the
/// square of their frequency.
const DAMPING_HERTZ: f32 = 3000.0;
const DAMPING_NEPERS: f32 = 0.115;
/// Hard bound on the loop signal: far above any playing level, so it acts
/// only if something has gone wrong.
const BOUND: f32 = 8.0;

/// One self-sustaining string loop.
#[derive(Debug, Clone)]
pub struct StringLoop {
    line: DelayLine,
    rate: f32,
    longest: f32,
    period: f32,
    wanted: f32,
    glide: f32,
    gain: f32,
    gain_wanted: f32,
    gain_glide: f32,
    /// The last two loop samples, for the three-point damping filter.
    newer: f32,
    older: f32,
    damping: f32,
    /// Mean square of the loop's output: first and second average.
    rough: f32,
    power: f32,
    power_step: f32,
    /// Running mean of the loop signal, taken out of it.
    offset: f32,
    offset_step: f32,
    /// Samples added to the delay to undo the high-pass's phase lead.
    trim: f32,
}

impl StringLoop {
    pub fn new(sample_rate: f32) -> Self {
        let longest = (sample_rate / LOWEST_HERTZ).ceil();
        let mut created = Self {
            line: DelayLine::new(longest as usize + 8),
            rate: sample_rate,
            longest,
            period: 100.0,
            wanted: 100.0,
            glide: 1.0 - (-1.0 / (GLIDE_SECONDS * sample_rate)).exp(),
            gain: 1.0,
            gain_wanted: 1.0,
            gain_glide: 1.0 - (-1.0 / (GAIN_SECONDS * sample_rate)).exp(),
            newer: 0.0,
            older: 0.0,
            damping: 0.0,
            rough: 0.0,
            power: 0.0,
            power_step: 0.0,
            offset: 0.0,
            offset_step: core::f32::consts::TAU * OFFSET_HERTZ / sample_rate,
            trim: 0.0,
        };
        created.tune(100.0, true);
        created
    }

    /// Empties the loop.
    pub fn clear(&mut self) {
        self.line.clear();
        self.newer = 0.0;
        self.older = 0.0;
        self.rough = 0.0;
        self.power = 0.0;
        self.offset = 0.0;
        self.gain = 1.0;
        self.gain_wanted = 1.0;
    }

    /// Sets the loop period in samples. It glides there unless `snap`.
    pub fn tune(&mut self, period: f32, snap: bool) {
        // max then min: a period that is not a number becomes the shortest.
        self.wanted = period.max(SHORTEST).min(self.longest);
        if snap {
            self.period = self.wanted;
        }
        // Loss per pass of the damping filter at frequency w is c·w² (see
        // `process`), and the loop makes rate/period passes a second, so a
        // fixed fade at the reference frequency needs c in proportion to the
        // period.
        let reference = core::f32::consts::TAU * DAMPING_HERTZ / self.rate;
        self.damping =
            (DAMPING_NEPERS * self.wanted / (self.rate * reference * reference)).min(0.2);
        let seconds =
            (LEVEL_PERIODS * self.wanted / self.rate).clamp(LEVEL_SHORTEST, LEVEL_LONGEST);
        self.power_step = 1.0 / (seconds * self.rate);
        // A first-order high-pass at fc leads by fc/f radians at the note's
        // frequency f, which would sharpen the loop by that share of a turn:
        // fc/(2·pi·f) periods, or fc·P²/(2·pi·rate) samples for a period P.
        self.trim = OFFSET_HERTZ * self.wanted * self.wanted / (core::f32::consts::TAU * self.rate);
    }

    /// The loop period now, in samples.
    pub fn period(&self) -> f32 {
        self.period
    }

    /// Mean square of what the loop puts out.
    pub fn power(&self) -> f32 {
        self.power
    }

    /// The limiter inside the loop, run a few thousand times a second: sets
    /// the loop gain from the measured level so the loop settles at
    /// `target_power`. Below the target the gain rises a little above one
    /// and the level approaches the target with time constant
    /// `grow_seconds`; above it the gain falls and the loop becomes a
    /// broader comb that follows the string closely.
    pub fn control(&mut self, target_power: f32, grow_seconds: f32) {
        let period_seconds = self.wanted / self.rate;
        // Level changes by ln(gain) per pass, so ln(gain) = k·ln(target/level)
        // with k = period/time gives a first-order approach in `time`.
        let grow = (period_seconds / grow_seconds.max(0.01)).min(PULL_DOWN);
        let error = 0.5 * (target_power.max(1.0e-12) / self.power.max(1.0e-12)).ln();
        let error = error.clamp(-4.0, 4.0);
        let log_gain = if error > -MARGIN {
            (grow * error).min(GROW_NEPERS * period_seconds)
        } else {
            (PULL_DOWN * (error + MARGIN) - grow * MARGIN).max(LEAST_GAIN.ln())
        };
        self.gain_wanted = log_gain.exp();
    }

    /// One sample: adds `excitation` to the loop and returns what comes
    /// round, which is the sustained voice.
    pub fn process(&mut self, excitation: f32) -> f32 {
        self.period += (self.wanted - self.period) * self.glide;
        self.gain += (self.gain_wanted - self.gain) * self.gain_glide;
        // The read sits two samples short of the period: one for reading
        // before this sample is written, one for the damping filter's delay.
        let back = self.gain * self.line.read_cubic(self.period - 2.0 + self.trim);
        self.rough += (back * back - self.rough) * self.power_step;
        self.power += (self.rough - self.power) * self.power_step;
        let sum = excitation + back;
        self.offset += (sum - self.offset) * self.offset_step;
        let now = (sum - self.offset).clamp(-BOUND, BOUND);
        // Three-point symmetric smoothing, gain 1 - 4c·sin²(w/2): a tiny loss
        // that grows with frequency and a delay of exactly one sample.
        let damped = self.newer + self.damping * (now - 2.0 * self.newer + self.older);
        self.older = self.newer;
        self.newer = now;
        self.line.write(damped);
        back
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;

    /// Frequency of the strongest steady component near `guess`, from the
    /// phase a correlation turns through between two half-second windows.
    fn frequency(signal: &[f32], rate: f32, guess: f32) -> f32 {
        let half = signal.len() / 2;
        let phase = |part: &[f32]| {
            let (mut re, mut im) = (0.0_f64, 0.0_f64);
            for (i, x) in part.iter().enumerate() {
                let angle = f64::from(TAU * guess / rate) * i as f64;
                re += f64::from(*x) * angle.cos();
                im -= f64::from(*x) * angle.sin();
            }
            im.atan2(re)
        };
        let mut turned = phase(&signal[half..])
            - phase(&signal[..half])
            - f64::from(TAU * guess / rate) * half as f64;
        turned -= f64::from(TAU) * (turned / f64::from(TAU)).round();
        guess + (turned / f64::from(TAU)) as f32 * rate / half as f32
    }

    fn pluck(frequency: f32, rate: f32, i: usize) -> f32 {
        let w = TAU * frequency * i as f32 / rate;
        0.2 * w.sin() + 0.1 * (2.0 * w).sin() + 0.05 * (3.0 * w).sin() + 0.03 * (4.0 * w).sin()
    }

    /// Feeds a note for half a second, then lets the loop run alone.
    fn sustain(rate: f32, note: f32, tuned: f32, seconds: f32) -> Vec<f32> {
        let mut string = StringLoop::new(rate);
        string.tune(rate / tuned, true);
        let fed = (0.5 * rate) as usize;
        let mut out = Vec::new();
        for i in 0..(seconds * rate) as usize {
            if i % 16 == 0 {
                string.control(0.01, 0.1);
            }
            let excitation = if i < fed {
                0.25 * pluck(note, rate, i)
            } else {
                0.0
            };
            out.push(string.process(excitation));
        }
        out
    }

    fn rms(signal: &[f32]) -> f32 {
        (signal.iter().map(|x| x * x).sum::<f32>() / signal.len() as f32).sqrt()
    }

    #[test]
    fn the_loop_holds_its_level_and_pitch_alone() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            for note in [82.41, 220.0, 659.26, 1318.5] {
                let out = sustain(rate, note, note, 6.0);
                let from = (4.0 * rate) as usize;
                let level = rms(&out[from..]);
                assert!(
                    (20.0 * (level / 0.1).log10()).abs() < 0.5,
                    "{note} Hz at {rate}: level {level}"
                );
                let found = frequency(&out[from..from + rate as usize], rate, note);
                let cents = 1200.0 * (found / note).log2();
                assert!(cents.abs() < 2.0, "{note} Hz at {rate}: {cents:+.2} cents");
            }
        }
    }

    #[test]
    fn a_loop_tuned_to_a_harmonic_keeps_only_that_harmonic_series() {
        let rate = 48_000.0;
        let out = sustain(rate, 110.0, 220.0, 4.0);
        let tail = &out[(3.0 * rate) as usize..];
        let power = |hertz: f32| {
            let (mut re, mut im) = (0.0_f32, 0.0_f32);
            for (i, x) in tail.iter().enumerate() {
                let angle = TAU * hertz * i as f32 / rate;
                re += x * angle.cos();
                im += x * angle.sin();
            }
            (re * re + im * im).sqrt() / tail.len() as f32
        };
        assert!(
            power(220.0) > 30.0 * power(110.0),
            "the fundamental was kept"
        );
        assert!((20.0 * (rms(tail) / 0.1).log10()).abs() < 1.0);
    }

    #[test]
    fn it_stays_bounded_whatever_it_is_given() {
        let mut string = StringLoop::new(48_000.0);
        for period in [f32::NAN, -5.0, 0.0, 1.0e9, f32::INFINITY] {
            string.tune(period, true);
            for i in 0..20_000 {
                if i % 16 == 0 {
                    string.control(1.0e6, 0.0);
                }
                let out = string.process(if i % 2 == 0 { 100.0 } else { -100.0 });
                assert!(out.is_finite() && out.abs() <= 2.0 * BOUND);
            }
        }
        string.clear();
        assert_eq!(string.process(0.0), 0.0);
    }

    #[test]
    fn retuning_glides_without_a_step() {
        let rate = 48_000.0;
        let mut string = StringLoop::new(rate);
        string.tune(rate / 220.0, true);
        let mut last = 0.0;
        let mut steepest = 0.0_f32;
        let mut reference = 0.0_f32;
        for i in 0..(2.0 * rate) as usize {
            if i % 16 == 0 {
                string.control(0.01, 0.1);
            }
            if i == rate as usize {
                reference = steepest;
                string.tune(rate / 246.94, false);
            }
            let excitation = if i < 12_000 {
                0.25 * (TAU * 220.0 * i as f32 / rate).sin()
            } else {
                0.0
            };
            let out = string.process(excitation);
            steepest = steepest.max((out - last).abs());
            last = out;
        }
        assert!(
            steepest < 1.5 * reference,
            "retuning stepped: {steepest} against {reference}"
        );
        assert!((string.period() - rate / 246.94).abs() < 0.01);
    }
}
