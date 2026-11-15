//! Listening, part one: reading the pitch of the played note and deciding
//! which readings to believe.
//!
//! [`PitchReader`] is Oxidal's tuner method (the cumulative mean normalised
//! difference function) with a shorter window, so it answers in about 50 ms
//! instead of resolving a fraction of a cent. [`PitchGuard`] turns the stream
//! of readings into one steady pitch: it needs agreement before it starts,
//! follows small movements (bends, vibrato), holds the last good pitch when a
//! reading is unclear, and makes octave-wrong readings wait.
//!
//! # References
//!
//! - de Cheveigné and Kawahara, "YIN, a fundamental frequency estimator for speech and music" (2002). <https://doi.org/10.1121/1.1458024>
//! - Harris, "On the use of windows for harmonic analysis with the discrete Fourier transform" (1978). <https://doi.org/10.1109/PROC.1978.10837>
//! - Rabiner, Sambur and Schmidt, "Applications of a nonlinear smoothing algorithm to speech processing" (1975). <https://doi.org/10.1109/TASSP.1975.1162749>
//!
//! @see docs/native-sustain.md

use core::f32::consts::TAU;
use oxidal_dsp::OnePole;

/// Samples compared at every lag: 24 ms at 8 kHz, two periods of a low E.
const WINDOW: usize = 192;
/// Longest period searched: 200 samples at 8 kHz is 40 Hz, below a bass E.
const MAX_TAU: usize = 200;
/// Shortest period searched: 5 samples at 8 kHz is 1.6 kHz, above the
/// highest fretted note of a guitar (1.32 kHz).
const MIN_TAU: usize = 5;
const FRAME: usize = WINDOW + MAX_TAU;
/// The refinement over several periods compares samples at most this far
/// apart (12.5 ms at 8 kHz), so a reading of a moving pitch is not an
/// average over the whole frame.
const REFINE_SPAN: usize = 100;
/// New input needed before the next reading (10 ms at 8 kHz).
const HOP: usize = 80;
/// Lags worked out per analysed sample: 200 lags take 67 samples, inside a hop.
const LAGS_PER_STEP: usize = 3;
/// A dip this deep is a period (the paper's absolute threshold, its step 4).
const CLEAR: f32 = 0.15;
/// Without a clear dip, the deepest one still counts if it is this deep.
const FALLBACK: f32 = 0.3;
/// Mean square below which a frame is silence (-90 dBFS).
const SILENCE: f32 = 1.0e-9;
/// Harmonics that a single note has and that two notes sharing a common
/// period do not: 1 and the primes from 7 up are in no interval's pattern.
const OWN_HARMONICS: [f32; 4] = [1.0, 7.0, 11.0, 13.0];
/// Share of the frame's power those harmonics must hold. A Hann window leaks
/// less than -31 dB from a neighbouring harmonic, so 1.5 % is well clear.
const OWN_SHARE: f32 = 0.015;

/// One reading of the pitch.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Reading {
    /// Period in input samples; zero when no period was found.
    pub period: f32,
    /// One minus the depth of the dip: 1 is a perfectly periodic frame.
    pub confidence: f32,
    /// The period's own fundamental is there, so this is one note and not
    /// the common period of two.
    pub single: bool,
    /// Root mean square of the analysed frame.
    pub level: f32,
    /// The two halves of the frame are within 6 dB of each other: no pick,
    /// cut or swell inside it, so the period found belongs to one sound.
    pub steady: bool,
}

/// Reads the pitch continuously from the input, a bounded amount of work per
/// sample, and publishes a reading every 10 ms.
#[derive(Debug, Clone)]
pub struct PitchReader {
    /// Input frames averaged into one analysed sample (about 8 kHz).
    step: usize,
    lows: [OnePole; 2],
    sum: f32,
    count: usize,
    ring: [f32; FRAME],
    write: usize,
    filled: usize,
    fresh: usize,
    frame: [f32; FRAME],
    window: [f32; FRAME],
    difference: [f32; MAX_TAU + 2],
    /// Next lag to compute; zero when no analysis is in progress.
    tau: usize,
    mean_square: f32,
    steady: bool,
    reading: Reading,
}

impl PitchReader {
    pub fn new(sample_rate: f32) -> Self {
        let step = ((sample_rate / 8000.0).round() as usize).clamp(1, 64);
        // Two gentle low-passes keep the upper harmonics of a bright or
        // clipped signal from folding back when samples are averaged.
        let mut low = OnePole::default();
        low.set_cutoff(sample_rate, 1500.0);
        let mut window = [0.0; FRAME];
        for (i, w) in window.iter_mut().enumerate() {
            *w = 0.5 - 0.5 * (TAU * i as f32 / FRAME as f32).cos();
        }
        Self {
            step,
            lows: [low; 2],
            sum: 0.0,
            count: 0,
            ring: [0.0; FRAME],
            write: 0,
            filled: 0,
            fresh: 0,
            frame: [0.0; FRAME],
            window,
            difference: [0.0; MAX_TAU + 2],
            tau: 0,
            mean_square: 0.0,
            steady: false,
            reading: Reading::default(),
        }
    }

    pub fn reset(&mut self) {
        for low in &mut self.lows {
            low.reset(0.0);
        }
        self.sum = 0.0;
        self.count = 0;
        self.ring = [0.0; FRAME];
        self.write = 0;
        self.filled = 0;
        self.fresh = 0;
        self.tau = 0;
        self.reading = Reading::default();
    }

    /// Seconds between two readings.
    pub fn hop_seconds(&self, sample_rate: f32) -> f32 {
        (HOP * self.step) as f32 / sample_rate
    }

    /// Seconds of input one reading looks at.
    pub fn frame_seconds(&self, sample_rate: f32) -> f32 {
        (FRAME * self.step) as f32 / sample_rate
    }

    /// The newest reading.
    pub fn reading(&self) -> Reading {
        self.reading
    }

    /// Takes one input sample; true when a new reading has just been made.
    /// The work is tied to the sample count, never to the block size.
    pub fn push(&mut self, x: f32) -> bool {
        let [first, second] = &mut self.lows;
        self.sum += second.lowpass(first.lowpass(x));
        self.count += 1;
        if self.count < self.step {
            return false;
        }
        let sample = self.sum / self.step as f32;
        self.sum = 0.0;
        self.count = 0;
        if let Some(slot) = self.ring.get_mut(self.write) {
            *slot = sample;
        }
        self.write = (self.write + 1) % FRAME;
        self.filled = (self.filled + 1).min(FRAME);
        self.fresh = (self.fresh + 1).min(HOP);
        if self.tau == 0 && self.filled == FRAME && self.fresh >= HOP && !self.begin() {
            return true; // a silent frame is a reading too: nothing there
        }
        self.tau > 0 && self.advance()
    }

    /// Copies the newest frame out of the ring. False when it is silent.
    fn begin(&mut self) -> bool {
        let (old, new) = self.ring.split_at(self.write.min(FRAME));
        for (slot, value) in self.frame.iter_mut().zip(new.iter().chain(old)) {
            *slot = *value;
        }
        let mean = self.frame.iter().sum::<f32>() / FRAME as f32;
        let mut energy = 0.0;
        for sample in &mut self.frame {
            *sample -= mean;
            energy += *sample * *sample;
        }
        self.mean_square = energy / FRAME as f32;
        let (early, late) = self.frame.split_at(FRAME / 2);
        let power = |part: &[f32]| part.iter().map(|x| x * x).sum::<f32>();
        let (early, late) = (power(early), power(late));
        self.steady = early <= 4.0 * late && late <= 4.0 * early;
        self.fresh = 0;
        if self.mean_square < SILENCE {
            self.reading = Reading {
                level: self.mean_square.sqrt(),
                ..Reading::default()
            };
            return false;
        }
        self.tau = 1;
        true
    }

    /// Works out the next few lags; true when the reading is finished.
    fn advance(&mut self) -> bool {
        let end = (self.tau + LAGS_PER_STEP).min(MAX_TAU + 1);
        for tau in self.tau..end {
            let (Some(head), Some(tail), Some(slot)) = (
                // The newest samples against those one lag earlier: the
                // reading then stands for the last (WINDOW + tau) / 2
                // samples, 12 to 25 ms, not the middle of the frame.
                self.frame.get(FRAME - WINDOW - tau..FRAME - tau),
                self.frame.get(FRAME - WINDOW..),
                self.difference.get_mut(tau),
            ) else {
                continue;
            };
            // Four running sums, so the loop can use four-wide arithmetic.
            let mut sums = [0.0_f32; 4];
            for (a, b) in head.chunks_exact(4).zip(tail.chunks_exact(4)) {
                for ((sum, x), y) in sums.iter_mut().zip(a).zip(b) {
                    let d = x - y;
                    *sum += d * d;
                }
            }
            *slot = (sums[0] + sums[1]) + (sums[2] + sums[3]);
        }
        self.tau = end;
        if end <= MAX_TAU {
            return false;
        }
        self.tau = 0;
        self.reading = self.finish();
        true
    }

    fn at(&self, tau: usize) -> f32 {
        self.difference.get(tau).copied().unwrap_or(f32::MAX)
    }

    /// Lag of the minimum near `at`, between samples, by a parabola.
    fn dip(&self, at: usize) -> f32 {
        if at <= 1 || at >= MAX_TAU {
            return at as f32;
        }
        let (a, b, c) = (self.at(at - 1), self.at(at), self.at(at + 1));
        let curve = a - 2.0 * b + c;
        if curve <= 0.0 {
            at as f32
        } else {
            at as f32 + (0.5 * (a - c) / curve).clamp(-0.5, 0.5)
        }
    }

    fn finish(&self) -> Reading {
        let level = self.mean_square.sqrt();
        // Normalise each lag by the mean difference of the shorter lags.
        let mut running = 0.0;
        let mut best = (f32::MAX, 0);
        let mut found = None;
        for tau in 1..=MAX_TAU {
            running += self.at(tau);
            let value = if running > 0.0 {
                self.at(tau) * tau as f32 / running
            } else {
                1.0
            };
            if tau < MIN_TAU {
                continue;
            }
            if value < best.0 {
                best = (value, tau);
            }
            if value < CLEAR {
                // Walk down to the bottom of this dip.
                let (mut low, mut at) = (value, tau);
                while at < MAX_TAU {
                    running += self.at(at + 1);
                    let next = self.at(at + 1) * (at + 1) as f32 / running;
                    if next >= low {
                        break;
                    }
                    low = next;
                    at += 1;
                }
                found = Some((low, at));
                break;
            }
        }
        let unclear = Reading {
            period: 0.0,
            confidence: (1.0 - best.0).clamp(0.0, 1.0),
            single: false,
            level,
            steady: self.steady,
        };
        let Some((depth, at)) = found.or((best.0 < FALLBACK).then_some(best)) else {
            return unclear;
        };
        if !(MIN_TAU..MAX_TAU).contains(&at) {
            return unclear;
        }
        let mut period = self.dip(at);
        // The same dip repeats at every whole number of periods, and a dip
        // further out divides the error by that number. Doubling the distance
        // each time keeps every search inside the reach of the last estimate.
        let most = (REFINE_SPAN.min(MAX_TAU - 2) as f32 / period).floor() as usize;
        let mut used = 1;
        while used < most {
            let next = (used * 2).min(most);
            let centre = (period * next as f32).round() as usize;
            let from = centre.saturating_sub(2).max(MIN_TAU);
            let to = (centre + 2).min(MAX_TAU - 1);
            let Some(far) = (from..=to).min_by(|a, b| self.at(*a).total_cmp(&self.at(*b))) else {
                break;
            };
            let refined = self.dip(far) / next as f32;
            if (refined / period - 1.0).abs() >= 0.03 / used as f32 {
                break;
            }
            period = refined;
            used = next;
        }
        Reading {
            period: period * self.step as f32,
            confidence: (1.0 - depth).clamp(0.0, 1.0),
            single: self.own_harmonics(period),
            level,
            steady: self.steady,
        }
    }

    /// Whether the frame holds the fundamental of `period` (in analysed
    /// samples) or one of its prime harmonics. Two notes a fifth, a fourth or
    /// a third apart repeat together at a period where neither has its
    /// fundamental, so their common period fails this and reads as a chord.
    fn own_harmonics(&self, period: f32) -> bool {
        // A sinusoid of amplitude a has a Hann-windowed sum of a·N/4, so its
        // power a²/2 is 8·|X|²/N²; compare with the frame's mean square.
        let scale = 8.0 / (FRAME as f32 * FRAME as f32 * self.mean_square.max(SILENCE));
        let mut share = 0.0;
        for harmonic in OWN_HARMONICS {
            let cycles = harmonic / period; // per analysed sample
            if cycles > 0.4 {
                break;
            }
            let (turn_sin, turn_cos) = (TAU * cycles).sin_cos();
            let (mut cos, mut sin) = (1.0_f32, 0.0_f32);
            let (mut real, mut imaginary) = (0.0_f32, 0.0_f32);
            for (x, w) in self.frame.iter().zip(&self.window) {
                let weighted = x * w;
                real += weighted * cos;
                imaginary += weighted * sin;
                (cos, sin) = (
                    cos * turn_cos - sin * turn_sin,
                    sin * turn_cos + cos * turn_sin,
                );
            }
            share += scale * (real * real + imaginary * imaginary);
            if share >= OWN_SHARE {
                return true;
            }
        }
        false
    }
}

/// What the guard made of one reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Nothing changed: the reading was unclear or is waiting for agreement.
    Hold,
    /// A steady pitch has been found where there was none.
    Start,
    /// The tracked pitch moved a little (a bend, vibrato, drift).
    Follow,
    /// The tracked pitch moved to a different note.
    Jump,
}

/// Readings that must agree before a pitch is believed.
const AGREE: usize = 3;
/// Confidence needed to start, and the lower one that keeps a pitch going.
const START_CONFIDENCE: f32 = 0.8;
const KEEP_CONFIDENCE: f32 = 0.7;
/// A faint string, which may only be followed, needs a clearer reading:
/// a confidence c means a signal-to-noise ratio of about c/(1 - c), and
/// 0.95 (13 dB) keeps noise from steering the pitch.
const FAINT_CONFIDENCE: f32 = 0.95;
/// Cents a reading may differ from the tracked pitch and still be a bend:
/// 60 cents in 10 ms is faster than a hand moves a string.
const FOLLOW_CENTS: f32 = 60.0;
/// A reading this close to the one before it continues a smooth movement
/// and is taken as it is; a larger step goes through the median of three.
/// Vibrato moves at most about 10 cents and a fast bend 25 cents per reading.
const SMOOTH_CENTS: f32 = 30.0;
/// ...if the reading is also this clear; a frame caught in a change of
/// sound reads less clearly and waits for the median.
const SMOOTH_CONFIDENCE: f32 = 0.9;
/// Cents within which candidate readings count as the same pitch.
const SAME_CENTS: f32 = 40.0;
/// Cents around an octave, a twelfth or two octaves that mark a reading as
/// a likely octave error.
const OCTAVE_CENTS: f32 = 50.0;
/// How long an octave-wrong pitch must persist before it is believed.
const OCTAVE_SECONDS: f32 = 0.15;
/// After a gap of unclear readings a bend may have moved on: the follow
/// window widens by `FOLLOW_CENTS` per missed reading, up to this far (a
/// two-semitone bend and a little more).
const FOLLOW_MOST_CENTS: f32 = 250.0;
/// Unclear readings in a row after which the string counts as lost in the
/// noise (300 ms), and agreeing readings near the held pitch that find it
/// again.
const LOSE_READINGS: u32 = 30;

/// Median of three, the smoother that drops a single outlier.
fn median(a: f32, b: f32, c: f32) -> f32 {
    a.min(b).max(a.max(b).min(c))
}

/// Chooses the pitch the Driver is tuned to from the stream of readings.
#[derive(Debug, Clone, Copy)]
pub struct PitchGuard {
    /// Log2 of the tracked period.
    tracked: f32,
    tracking: bool,
    /// The last three readings accepted near the tracked pitch.
    recent: [f32; 3],
    /// Readings in a row that agree on a new pitch.
    candidate: [f32; 3],
    agreeing: usize,
    unclear: u32,
    octave_readings: usize,
    lost: bool,
    regain: usize,
    /// The last reading was accepted as following the tracked pitch.
    in_step: bool,
}

impl PitchGuard {
    /// `hop_seconds` is the time between readings.
    pub fn new(hop_seconds: f32) -> Self {
        let octave_readings = (OCTAVE_SECONDS / hop_seconds.max(1.0e-3)).round() as usize;
        Self {
            tracked: 0.0,
            tracking: false,
            recent: [0.0; 3],
            candidate: [0.0; 3],
            agreeing: 0,
            unclear: 0,
            octave_readings: octave_readings.max(AGREE + 1),
            lost: false,
            regain: 0,
            in_step: false,
        }
    }

    /// Forgets the pitch: the next note has to establish itself.
    pub fn reset(&mut self) {
        self.tracking = false;
        self.agreeing = 0;
        self.unclear = 0;
        self.lost = false;
        self.regain = 0;
        self.in_step = false;
    }

    pub fn tracking(&self) -> bool {
        self.tracking
    }

    /// The tracked period in input samples.
    pub fn period(&self) -> f32 {
        self.tracked.exp2()
    }

    /// Readings in a row that gave no usable single pitch.
    pub fn unclear(&self) -> u32 {
        self.unclear
    }

    /// Readings an octave-wrong pitch has to last.
    pub fn octave_readings(&self) -> usize {
        self.octave_readings
    }

    /// True once the string has been unclear for long enough to count as
    /// gone; the pitch is then held until clear readings near it return.
    pub fn lost(&self) -> bool {
        self.lost
    }

    /// True when the last reading continued a smooth movement of the pitch.
    pub fn in_step(&self) -> bool {
        self.in_step
    }

    /// Takes one reading. `fresh` is true shortly after a note began, when a
    /// wrong first lock may still be corrected quickly. `may_jump` allows a
    /// move to a different note without a pick (a hammer-on); a faint
    /// string is only ever followed, never replaced.
    pub fn accept(&mut self, reading: Reading, fresh: bool, may_jump: bool) -> Verdict {
        let needed = if !may_jump {
            FAINT_CONFIDENCE
        } else if self.tracking {
            KEEP_CONFIDENCE
        } else {
            START_CONFIDENCE
        };
        let usable = reading.period > 0.0
            && reading.period.is_finite()
            && reading.single
            && reading.confidence >= needed
            && (may_jump || reading.steady);
        if !usable {
            self.unclear = self.unclear.saturating_add(1);
            self.agreeing = 0;
            self.regain = 0;
            self.in_step = false;
            if self.tracking && self.unclear >= LOSE_READINGS {
                self.lost = true;
            }
            return Verdict::Hold;
        }
        let missed = self.unclear.min(LOSE_READINGS);
        self.unclear = 0;
        let log = reading.period.log2();
        let reach = if may_jump {
            (FOLLOW_CENTS * (1 + missed) as f32).min(FOLLOW_MOST_CENTS)
        } else {
            FOLLOW_CENTS
        };
        if self.tracking && 1200.0 * (log - self.tracked).abs() <= reach {
            self.agreeing = 0;
            if self.lost {
                // Back out of the noise: only clear readings in a row count.
                self.regain += 1;
                if self.regain < AGREE {
                    return Verdict::Hold;
                }
                self.lost = false;
                self.regain = 0;
            }
            let previous = self.recent[2];
            self.recent = [self.recent[1], self.recent[2], log];
            let direct = self.in_step
                && 1200.0 * (log - previous).abs() <= SMOOTH_CENTS
                && reading.confidence >= SMOOTH_CONFIDENCE;
            self.in_step = true;
            if direct {
                // In step with the last reading: a bend or vibrato in
                // progress, taken at once rather than a reading late.
                let before = self.tracked;
                self.tracked = log;
                return if self.tracked == before {
                    Verdict::Hold
                } else {
                    Verdict::Follow
                };
            }
            let before = self.tracked;
            self.tracked = median(self.recent[0], self.recent[1], self.recent[2]);
            return if self.tracked == before {
                Verdict::Hold
            } else {
                Verdict::Follow
            };
        }
        // A different pitch: it must repeat before it is believed.
        self.in_step = false;
        if self.agreeing > 0 && 1200.0 * (log - self.candidate[2]).abs() <= SAME_CENTS {
            self.agreeing += 1;
        } else {
            self.agreeing = 1;
        }
        self.candidate = [self.candidate[1], self.candidate[2], log];
        let wait = if self.tracking && !fresh && Self::octave_apart(log - self.tracked) {
            self.octave_readings
        } else {
            AGREE
        };
        if self.agreeing < wait || (self.tracking && !may_jump) {
            return Verdict::Hold;
        }
        let verdict = if self.tracking {
            Verdict::Jump
        } else {
            Verdict::Start
        };
        self.tracked = median(self.candidate[0], self.candidate[1], self.candidate[2]);
        self.recent = [self.tracked; 3];
        self.tracking = true;
        self.agreeing = 0;
        verdict
    }

    /// Whether a distance in octaves is an octave, a twelfth or two octaves,
    /// up or down: the ways a period reading goes wrong.
    fn octave_apart(octaves: f32) -> bool {
        let cents = 1200.0 * octaves.abs();
        [1200.0, 1901.955, 2400.0]
            .iter()
            .any(|interval| (cents - interval).abs() <= OCTAVE_CENTS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cents(a: f32, b: f32) -> f32 {
        1200.0 * (a / b).log2()
    }

    /// A plucked-string-like tone: harmonics over the fundamental.
    fn tone(frequency: f32, rate: f32, i: usize) -> f32 {
        let w = TAU * frequency * i as f32 / rate;
        0.2 * w.sin() + 0.12 * (2.0 * w).sin() + 0.06 * (3.0 * w + 0.4).sin()
    }

    fn read(rate: f32, mut signal: impl FnMut(usize) -> f32) -> Reading {
        let mut reader = PitchReader::new(rate);
        for i in 0..(rate * 0.3) as usize {
            reader.push(signal(i));
        }
        reader.reading()
    }

    #[test]
    fn reads_guitar_notes_within_two_cents_at_every_rate() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            for frequency in [
                41.2, 82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 440.0, 659.26, 987.77, 1318.5,
            ] {
                let reading = read(rate, |i| tone(frequency, rate, i));
                assert!(
                    reading.period > 0.0,
                    "no reading for {frequency} Hz at {rate}"
                );
                let error = cents(rate / reading.period, frequency);
                assert!(
                    error.abs() < 2.0,
                    "{frequency} Hz at {rate}: {error:+.2} cents"
                );
                assert!(
                    reading.confidence > 0.8 && reading.single,
                    "{frequency}: {reading:?}"
                );
            }
        }
    }

    #[test]
    fn a_reading_arrives_within_seventy_milliseconds() {
        let rate = 48_000.0;
        let mut reader = PitchReader::new(rate);
        let mut first = None;
        for i in 0..(rate * 0.2) as usize {
            if reader.push(tone(196.0, rate, i)) && reader.reading().period > 0.0 {
                first = Some(i);
                break;
            }
        }
        let at = first.expect("no reading") as f32 / rate;
        assert!(at < 0.07, "first reading after {at} s");
        assert!((reader.hop_seconds(rate) - 0.01).abs() < 1.0e-6);
    }

    #[test]
    fn two_notes_with_a_common_period_are_not_one_note() {
        let rate = 48_000.0;
        // A fifth, a fourth and a major third in equal temperament.
        for semitones in [7.0_f32, 5.0, 4.0] {
            let upper = 2.0_f32.powf(semitones / 12.0);
            for root in [110.0, 164.81, 220.0] {
                let reading = read(rate, |i| {
                    0.6 * tone(root, rate, i) + 0.6 * tone(root * upper, rate, i)
                });
                assert!(
                    reading.period == 0.0 || !reading.single || reading.confidence < 0.8,
                    "{root} Hz + {semitones} semitones read as one note: {reading:?}"
                );
            }
        }
    }

    #[test]
    fn silence_and_noise_give_no_pitch() {
        let silent = read(48_000.0, |_| 0.0);
        assert_eq!(silent.period, 0.0);
        let mut seed = 1_u32;
        let noisy = read(48_000.0, |_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / 8_388_608.0 - 1.0
        });
        assert!(noisy.period == 0.0 || noisy.confidence < 0.7, "{noisy:?}");
    }

    fn clear(period: f32) -> Reading {
        Reading {
            period,
            confidence: 0.95,
            single: true,
            level: 0.1,
            steady: true,
        }
    }

    fn started(period: f32) -> PitchGuard {
        let mut guard = PitchGuard::new(0.01);
        assert_eq!(guard.accept(clear(period), true, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(period), true, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(period), true, true), Verdict::Start);
        guard
    }

    #[test]
    fn the_guard_needs_agreement_and_holds_through_unclear_readings() {
        let mut guard = PitchGuard::new(0.01);
        assert_eq!(guard.accept(clear(400.0), true, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(300.0), true, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(400.0), true, true), Verdict::Hold);
        assert!(!guard.tracking());
        let mut guard = started(400.0);
        assert!((guard.period() - 400.0).abs() < 0.01);
        for _ in 0..500 {
            let unclear = Reading {
                confidence: 0.3,
                ..clear(123.0)
            };
            assert_eq!(guard.accept(unclear, false, true), Verdict::Hold);
            let chord = Reading {
                single: false,
                ..clear(800.0)
            };
            assert_eq!(guard.accept(chord, false, true), Verdict::Hold);
        }
        assert!((guard.period() - 400.0).abs() < 0.01);
        assert!(guard.unclear() >= 1000);
    }

    #[test]
    fn injected_wrong_octave_readings_do_not_move_the_pitch() {
        // Every way a period reading goes wrong, for up to 100 ms at a time.
        for ratio in [2.0, 0.5, 3.0, 1.0 / 3.0, 4.0, 0.25] {
            let mut guard = started(400.0);
            for burst in 1..=10 {
                for _ in 0..burst {
                    assert_eq!(
                        guard.accept(clear(400.0 * ratio), false, true),
                        Verdict::Hold
                    );
                    assert!(
                        (guard.period() - 400.0).abs() < 0.01,
                        "ratio {ratio} moved it"
                    );
                }
                guard.accept(clear(400.0), false, true);
            }
        }
        // One that lasts longer than 150 ms is a real note an octave away.
        let mut guard = started(400.0);
        let mut verdict = Verdict::Hold;
        for _ in 0..guard.octave_readings() {
            verdict = guard.accept(clear(200.0), false, true);
        }
        assert_eq!(verdict, Verdict::Jump);
        assert!((guard.period() - 200.0).abs() < 0.01);
    }

    #[test]
    fn a_single_outlier_is_dropped_and_a_bend_is_followed() {
        let mut guard = started(400.0);
        // One stray reading 30 cents off does not move the median.
        assert_eq!(
            guard.accept(clear(400.0 * 1.0175), false, true),
            Verdict::Hold
        );
        assert!((guard.period() - 400.0).abs() < 0.01);
        // A two-semitone bend in 20 readings (200 ms) is followed closely.
        let mut guard = started(400.0);
        for step in 1..=20 {
            let period = 400.0 * 2.0_f32.powf(-2.0 * step as f32 / 20.0 / 12.0);
            let verdict = guard.accept(clear(period), false, true);
            assert!(verdict == Verdict::Follow || verdict == Verdict::Hold);
            assert!(cents(guard.period(), period).abs() < 25.0);
        }
        guard.accept(clear(400.0 * 2.0_f32.powf(-2.0 / 12.0)), false, true);
        assert!(cents(guard.period(), 400.0 * 2.0_f32.powf(-2.0 / 12.0)).abs() < 0.1);
    }

    #[test]
    fn a_new_note_three_semitones_away_is_taken_after_three_readings() {
        let mut guard = started(400.0);
        let next = 400.0 * 2.0_f32.powf(-3.0 / 12.0);
        assert_eq!(guard.accept(clear(next), false, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(next), false, true), Verdict::Hold);
        assert_eq!(guard.accept(clear(next), false, true), Verdict::Jump);
        assert!((guard.period() - next).abs() < 0.01);
    }
}
