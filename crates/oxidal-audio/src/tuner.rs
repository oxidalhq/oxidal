//! Oxidal's own input tuner. It listens to the raw interface input, so it
//! works under any playing preset, with or without a TONE3000 chain.
//!
//! The pitch is the first clear dip of the cumulative mean normalised
//! difference function, refined over as many whole periods as fit so that a
//! reading resolves well under a cent. The work is spread over audio blocks:
//! fixed buffers, no allocation, and a bounded share of each block.
//! @see docs/audio.md
use crate::tools::TunerReading;

/// Samples compared at every lag (128 ms at 8 kHz).
const WINDOW: usize = 1024;
/// Longest period searched: 288 samples at 8 kHz is 27.8 Hz, below a low B.
const MAX_TAU: usize = 288;
/// Shortest period searched: 5 samples at 8 kHz is 1.6 kHz.
const MIN_TAU: usize = 5;
const FRAME: usize = WINDOW + MAX_TAU;
/// New input needed before the next reading (40 ms at 8 kHz).
const HOP: usize = 320;
/// A dip this deep is a period; shallower ones are noise or a chord.
const CLEAR: f32 = 0.2;
/// Mean square below which the input is treated as silence (−66 dBFS).
const SILENCE: f32 = 2.5e-7;

#[derive(Debug)]
pub struct Tuner {
    enabled: bool,
    /// Input frames averaged into one analysed sample (about 8 kHz).
    step: usize,
    rate: f32,
    sum: f32,
    count: usize,
    ring: [f32; FRAME],
    write: usize,
    filled: usize,
    fresh: usize,
    frame: [f32; FRAME],
    difference: [f32; MAX_TAU + 1],
    /// Next lag to compute; zero when no analysis is in progress.
    tau: usize,
    level: f32,
    reading: Option<TunerReading>,
}

impl Tuner {
    pub fn new(rate: u32) -> Self {
        let step = ((rate as f32 / 8000.0).round() as usize).max(1);
        Self {
            enabled: false,
            step,
            rate: rate.max(1) as f32 / step as f32,
            sum: 0.0,
            count: 0,
            ring: [0.0; FRAME],
            write: 0,
            filled: 0,
            fresh: 0,
            frame: [0.0; FRAME],
            difference: [0.0; MAX_TAU + 1],
            tau: 0,
            level: 0.0,
            reading: None,
        }
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    pub fn set(&mut self, enabled: bool) {
        if enabled != self.enabled {
            self.enabled = enabled;
            self.sum = 0.0;
            self.count = 0;
            self.filled = 0;
            self.fresh = 0;
            self.tau = 0;
            self.reading = None;
        }
    }
    pub fn reading(&self) -> Option<TunerReading> {
        self.reading
    }
    /// Takes one block of raw input. Costs nothing while the tuner is off.
    pub fn input(&mut self, block: &[f32]) {
        if !self.enabled {
            return;
        }
        for &sample in block {
            self.sum += sample;
            self.count += 1;
            if self.count == self.step {
                self.ring[self.write] = self.sum / self.step as f32;
                self.write = (self.write + 1) % FRAME;
                self.filled = (self.filled + 1).min(FRAME);
                self.fresh += 1;
                self.sum = 0.0;
                self.count = 0;
            }
        }
        if self.tau == 0 && self.filled == FRAME && self.fresh >= HOP {
            self.begin();
        }
        if self.tau > 0 {
            // Finish within one hop of input, whatever the block size.
            let taken = block.len() / self.step + 1;
            let budget = (MAX_TAU * taken).div_ceil(HOP).max(2);
            self.advance(budget);
        }
    }
    fn begin(&mut self) {
        let (old, new) = self.ring.split_at(self.write);
        self.frame[..new.len()].copy_from_slice(new);
        self.frame[new.len()..].copy_from_slice(old);
        let mean = self.frame.iter().sum::<f32>() / FRAME as f32;
        let mut energy = 0.0;
        for sample in &mut self.frame {
            *sample -= mean;
            energy += *sample * *sample;
        }
        self.level = energy / FRAME as f32;
        self.fresh = 0;
        if self.level < SILENCE {
            self.reading = None;
        } else {
            self.tau = 1;
        }
    }
    fn advance(&mut self, budget: usize) {
        let end = (self.tau + budget).min(MAX_TAU + 1);
        for tau in self.tau..end {
            let (head, tail) = (&self.frame[..WINDOW], &self.frame[tau..tau + WINDOW]);
            self.difference[tau] = head
                .iter()
                .zip(tail)
                .map(|(a, b)| (a - b) * (a - b))
                .sum::<f32>();
        }
        self.tau = end;
        if end > MAX_TAU {
            self.tau = 0;
            self.reading = self.finish();
        }
    }
    /// Lag of the minimum near `at`, between samples, by a parabola.
    fn dip(&self, at: usize) -> f32 {
        let d = &self.difference;
        if at <= 1 || at >= MAX_TAU {
            return at as f32;
        }
        let (a, b, c) = (d[at - 1], d[at], d[at + 1]);
        let curve = a - 2.0 * b + c;
        if curve <= 0.0 {
            at as f32
        } else {
            at as f32 + (0.5 * (a - c) / curve).clamp(-0.5, 0.5)
        }
    }
    fn finish(&self) -> Option<TunerReading> {
        let d = &self.difference;
        // Normalise each lag by the mean difference of the shorter lags.
        let mut running = 0.0;
        let mut best = (f32::MAX, 0);
        let mut found = None;
        let mut tau = 1;
        while tau <= MAX_TAU {
            running += d[tau];
            let value = if running > 0.0 {
                d[tau] * tau as f32 / running
            } else {
                1.0
            };
            if tau >= MIN_TAU {
                if value < best.0 {
                    best = (value, tau);
                }
                if value < CLEAR {
                    // Walk down to the bottom of this dip.
                    let mut at = tau;
                    let mut low = value;
                    while at < MAX_TAU {
                        running += d[at + 1];
                        let next = d[at + 1] * (at + 1) as f32 / running;
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
            tau += 1;
        }
        let (depth, at) = found.or((best.0 < 0.35).then_some(best))?;
        if !(MIN_TAU..MAX_TAU).contains(&at) {
            return None;
        }
        let mut period = self.dip(at);
        // The same dip repeats at every whole number of periods; the furthest
        // one that fits divides the remaining error by that number.
        let periods = ((MAX_TAU - 2) as f32 / period).floor() as usize;
        if periods > 1 {
            let centre = (period * periods as f32).round() as usize;
            let from = centre.saturating_sub(2).max(MIN_TAU);
            let to = (centre + 2).min(MAX_TAU - 1);
            let far = (from..=to).min_by(|a, b| d[*a].total_cmp(&d[*b]))?;
            let refined = self.dip(far) / periods as f32;
            if (refined / period - 1.0).abs() < 0.03 {
                period = refined;
            }
        }
        let frequency = f64::from(self.rate / period);
        Some(TunerReading {
            frequency,
            confidence: f64::from((1.0 - depth).clamp(0.0, 1.0)),
            level: f64::from(self.level.sqrt()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cents(a: f64, b: f64) -> f64 {
        1200.0 * (a / b).log2()
    }
    /// A plucked-string-like tone: decaying harmonics over the fundamental.
    fn read(rate: u32, block: usize, frequency: f64) -> Option<TunerReading> {
        let mut tuner = Tuner::new(rate);
        tuner.set(true);
        let mut out = vec![0.0f32; block];
        let mut n = 0u64;
        for _ in 0..(rate as usize / block) {
            for sample in &mut out {
                let t = n as f64 / f64::from(rate);
                let w = std::f64::consts::TAU * frequency * t;
                *sample =
                    (0.2 * w.sin() + 0.12 * (2.0 * w).sin() + 0.06 * (3.0 * w + 0.4).sin()) as f32;
                n += 1;
            }
            tuner.input(&out);
        }
        tuner.reading()
    }

    #[test]
    fn reads_every_open_string_within_a_fifth_of_a_cent() {
        // Five-string bass low B to the guitar's high E, and the twelfth fret.
        for frequency in [
            30.87, 41.2, 55.0, 82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 440.0, 659.26,
        ] {
            for (rate, block) in [(48000, 96), (44100, 128), (96000, 512), (48000, 1024)] {
                let reading = read(rate, block, frequency)
                    .unwrap_or_else(|| panic!("no reading for {frequency} Hz at {rate}/{block}"));
                let error = cents(reading.frequency, frequency);
                assert!(
                    error.abs() < 0.2,
                    "{frequency} Hz at {rate}/{block} read {} ({error:+.3} cents)",
                    reading.frequency
                );
                assert!(reading.confidence > 0.8, "{frequency} Hz: {reading:?}");
            }
        }
    }

    #[test]
    fn follows_a_string_that_is_a_few_cents_flat() {
        let flat = 110.0 * 2f64.powf(-3.0 / 1200.0);
        let reading = read(48000, 96, flat).unwrap();
        assert!((cents(reading.frequency, 110.0) + 3.0).abs() < 0.2);
    }

    #[test]
    fn stays_quiet_on_silence_noise_and_when_off() {
        let mut tuner = Tuner::new(48000);
        tuner.set(true);
        for _ in 0..500 {
            tuner.input(&[0.0; 96]);
        }
        assert!(tuner.reading().is_none());
        // Deterministic noise: no period to find.
        let mut seed = 1u32;
        for _ in 0..500 {
            let mut block = [0.0f32; 96];
            for sample in &mut block {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                *sample = (seed >> 8) as f32 / 8_388_608.0 - 1.0;
            }
            tuner.input(&block);
        }
        assert!(tuner.reading().is_none_or(|r| r.confidence < 0.7));
        assert!(read(48000, 96, 110.0).is_some());
        let mut off = Tuner::new(48000);
        for _ in 0..500 {
            off.input(&[0.5; 96]);
        }
        assert!(off.reading().is_none());
    }
}
