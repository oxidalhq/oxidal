//! Calibration reference: a built-in guitar riff played into a rig in place of
//! the live input, and a loudness meter on the rig's output. Every preset hears
//! the same riff at the same level, so their measured loudness can be evened
//! out. Allocation happens once, when the host stage is built.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Loudness of the rig's output while the reference riff plays.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferenceReading {
    /// Seconds measured so far (the first second after starting is skipped).
    pub seconds: f32,
    /// K-weighted loudness (LUFS) over those seconds; none until measured.
    pub lufs: Option<f32>,
}

const STRINGS: usize = 6;
/// Long enough for low E (82.4 Hz) up to 192 kHz.
const LINE: usize = 2400;
/// The riff repeats every four seconds.
const LOOP_SECONDS: f64 = 4.0;
/// Skip the first second: amps, compressors and delays settle.
const SETTLE_SECONDS: f64 = 1.0;
/// (start in seconds, frequency in Hz, sustain per period: low is palm-muted).
const NOTES: &[(f64, f64, f32)] = &[
    // E5 power chord, strummed.
    (0.000, 82.41, 0.996),
    (0.008, 123.47, 0.996),
    (0.016, 164.81, 0.996),
    // Palm-muted chugs on low E.
    (1.000, 82.41, 0.93),
    (1.125, 82.41, 0.93),
    (1.250, 82.41, 0.93),
    (1.375, 82.41, 0.93),
    // A5 power chord.
    (1.500, 110.00, 0.996),
    (1.508, 164.81, 0.996),
    (1.516, 220.00, 0.996),
    // Single notes up the neck.
    (2.500, 196.00, 0.995),
    (2.750, 220.00, 0.995),
    (3.000, 246.94, 0.995),
    (3.250, 293.66, 0.995),
    // Open low E to finish.
    (3.500, 82.41, 0.996),
];

#[derive(Debug)]
struct Voice {
    line: Box<[f32]>,
    period: usize,
    position: usize,
    sustain: f32,
}

/// Karplus–Strong plucked strings playing the riff above, deterministic and
/// identical on every unit.
#[derive(Debug)]
struct Riff {
    rate: f64,
    voices: Vec<Voice>,
    next_voice: usize,
    frame: u64,
    next_note: usize,
    amplitude: f32,
    noise: u32,
}
impl Riff {
    fn new(rate: u32) -> Self {
        Self {
            rate: f64::from(rate.max(1)),
            voices: (0..STRINGS)
                .map(|_| Voice {
                    line: vec![0.0; LINE].into_boxed_slice(),
                    period: 2,
                    position: 0,
                    sustain: 0.0,
                })
                .collect(),
            next_voice: 0,
            frame: 0,
            next_note: 0,
            amplitude: 0.0,
            noise: 0x1234_5678,
        }
    }
    fn restart(&mut self, peak_db: f32) {
        for voice in &mut self.voices {
            voice.line.fill(0.0);
            voice.sustain = 0.0;
        }
        self.frame = 0;
        self.next_note = 0;
        self.noise = 0x1234_5678;
        // Three strings ring together at most; each pluck takes a third.
        self.amplitude = 10f32.powf(peak_db / 20.0) / 3.0;
    }
    fn pluck(&mut self, frequency: f64, sustain: f32) {
        let voice = &mut self.voices[self.next_voice];
        self.next_voice = (self.next_voice + 1) % STRINGS;
        voice.period = ((self.rate / frequency).round() as usize).clamp(2, LINE);
        voice.position = 0;
        voice.sustain = sustain;
        for sample in &mut voice.line[..voice.period] {
            // Deterministic noise burst, the string's initial shape.
            self.noise = self
                .noise
                .wrapping_mul(1_664_525)
                .wrapping_add(1_013_904_223);
            *sample = ((self.noise >> 9) as f32 / (1u32 << 23) as f32 * 2.0 - 1.0) * self.amplitude;
        }
    }
    fn next(&mut self) -> f32 {
        let loop_frames = (LOOP_SECONDS * self.rate) as u64;
        let at = self.frame % loop_frames;
        if at == 0 {
            self.next_note = 0;
        }
        while let Some(&(start, frequency, sustain)) = NOTES.get(self.next_note) {
            if ((start * self.rate) as u64) > at {
                break;
            }
            self.pluck(frequency, sustain);
            self.next_note += 1;
        }
        self.frame += 1;
        let mut out = 0.0;
        for voice in &mut self.voices {
            if voice.sustain == 0.0 {
                continue;
            }
            let i = voice.position;
            let j = (i + 1) % voice.period;
            let value = voice.line[i];
            voice.line[i] = (value + voice.line[j]) * 0.5 * voice.sustain;
            voice.position = j;
            out += value;
        }
        out
    }
}

/// One direct-form-I biquad.
#[derive(Debug, Clone, Copy, Default)]
struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
    x: [f64; 2],
    y: [f64; 2],
}
impl Biquad {
    fn run(&mut self, input: f64) -> f64 {
        let out = self.b[0] * input + self.b[1] * self.x[0] + self.b[2] * self.x[1]
            - self.a[0] * self.y[0]
            - self.a[1] * self.y[1];
        self.x = [input, self.x[0]];
        self.y = [out, self.y[0]];
        out
    }
}
/// ITU-R BS.1770 K-weighting at any sample rate: a high shelf, then a high pass.
fn k_weighting(rate: f64) -> [Biquad; 2] {
    let shelf = {
        let (f0, gain, q) = (
            1_681.974_450_955_533,
            3.999_843_853_973_347,
            0.707_175_236_955_419_6,
        );
        let k = (std::f64::consts::PI * f0 / rate).tan();
        let vh = 10f64.powf(gain / 20.0);
        let vb = vh.powf(0.499_666_774_154_541_6);
        let a0 = 1.0 + k / q + k * k;
        Biquad {
            b: [
                (vh + vb * k / q + k * k) / a0,
                2.0 * (k * k - vh) / a0,
                (vh - vb * k / q + k * k) / a0,
            ],
            a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
            ..Biquad::default()
        }
    };
    let high_pass = {
        let (f0, q) = (38.135_470_876_024_44, 0.500_327_037_323_877_3);
        let k = (std::f64::consts::PI * f0 / rate).tan();
        let a0 = 1.0 + k / q + k * k;
        Biquad {
            b: [1.0, -2.0, 1.0],
            a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
            ..Biquad::default()
        }
    };
    [shelf, high_pass]
}

/// The riff, while active, and the loudness of what the rig makes of it.
#[derive(Debug)]
pub(crate) struct Reference {
    riff: Riff,
    active: bool,
    rate: f64,
    filters: [[Biquad; 2]; 2],
    frames: u64,
    energy: f64,
}
impl Reference {
    pub(crate) fn new(rate: u32) -> Self {
        Self {
            riff: Riff::new(rate),
            active: false,
            rate: f64::from(rate.max(1)),
            filters: [k_weighting(f64::from(rate.max(1))); 2],
            frames: 0,
            energy: 0.0,
        }
    }
    /// Starts the riff from the top at `peak_db`, with a fresh measurement.
    pub(crate) fn start(&mut self, peak_db: f32) {
        self.riff.restart(peak_db);
        self.filters = [k_weighting(self.rate); 2];
        self.frames = 0;
        self.energy = 0.0;
        self.active = true;
    }
    pub(crate) fn stop(&mut self) {
        self.active = false;
    }
    pub(crate) fn active(&self) -> bool {
        self.active
    }
    /// Replaces the live input with the riff.
    pub(crate) fn input(&mut self, left: &mut [f32], right: &mut [f32]) {
        if !self.active {
            return;
        }
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let sample = self.riff.next();
            *l = sample;
            *r = sample;
        }
    }
    /// Measures the rig's output, before Level, Boost or Mono.
    pub(crate) fn measure(&mut self, left: &[f32], right: &[f32]) {
        if !self.active {
            return;
        }
        let settle = (SETTLE_SECONDS * self.rate) as u64;
        for (l, r) in left.iter().zip(right) {
            let [lf, rf] = &mut self.filters;
            let l = lf.iter_mut().fold(f64::from(*l), |x, f| f.run(x));
            let r = rf.iter_mut().fold(f64::from(*r), |x, f| f.run(x));
            self.frames += 1;
            if self.frames > settle {
                self.energy += l * l + r * r;
            }
        }
    }
    pub(crate) fn reading(&self) -> Option<ReferenceReading> {
        if !self.active {
            return None;
        }
        let settle = (SETTLE_SECONDS * self.rate) as u64;
        let measured = self.frames.saturating_sub(settle);
        let lufs = (measured > 0 && self.energy > 0.0)
            .then(|| (-0.691 + 10.0 * (self.energy / measured as f64).log10()) as f32);
        Some(ReferenceReading {
            seconds: (measured as f64 / self.rate) as f32,
            lufs,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn measure(rate: u32, seconds: f64, gain: f32) -> ReferenceReading {
        let mut reference = Reference::new(rate);
        reference.start(-12.0);
        let mut remaining = (seconds * f64::from(rate)) as usize;
        while remaining > 0 {
            let n = remaining.min(64);
            let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
            reference.input(&mut l, &mut r);
            for v in l.iter_mut().chain(r.iter_mut()) {
                *v *= gain;
            }
            reference.measure(&l, &r);
            remaining -= n;
        }
        reference.reading().unwrap()
    }
    #[test]
    fn the_riff_is_deterministic_audible_and_bounded() {
        let mut a = Riff::new(48000);
        let mut b = Riff::new(48000);
        a.restart(-12.0);
        b.restart(-12.0);
        let (mut peak, mut energy) = (0.0f32, 0.0f64);
        for _ in 0..48000 * 4 {
            let (x, y) = (a.next(), b.next());
            assert_eq!(x.to_bits(), y.to_bits());
            peak = peak.max(x.abs());
            energy += f64::from(x * x);
        }
        // Peaks stay near the −12 dBFS target and the riff is not silent.
        assert!(peak < 10f32.powf(-6.0 / 20.0), "peak {peak}");
        assert!(energy / (48000.0 * 4.0) > 1e-5);
    }
    #[test]
    fn loudness_tracks_gain_and_skips_the_settling_second() {
        let unity = measure(48000, 5.0, 1.0);
        assert!((unity.seconds - 4.0).abs() < 0.01);
        let quieter = measure(48000, 5.0, 0.5);
        // Half the amplitude is 6.02 dB less loudness.
        let difference = unity.lufs.unwrap() - quieter.lufs.unwrap();
        assert!((difference - 6.02).abs() < 0.05, "{difference}");
        assert_eq!(measure(48000, 0.5, 1.0).lufs, None);
        // The same riff at another sample rate reads about the same.
        let other = measure(44100, 5.0, 1.0);
        assert!((other.lufs.unwrap() - unity.lufs.unwrap()).abs() < 1.0);
    }
    #[test]
    fn k_weighting_matches_the_standard_at_48k() {
        // BS.1770 publishes these 48 kHz coefficients.
        let [shelf, high_pass] = k_weighting(48000.0);
        assert!((shelf.b[0] - 1.535_124_859_586_97).abs() < 1e-9);
        assert!((shelf.a[0] + 1.690_659_293_182_41).abs() < 1e-9);
        assert!((high_pass.a[0] + 1.990_047_454_833_98).abs() < 1e-9);
        assert!((high_pass.a[1] - 0.990_072_250_366_21).abs() < 1e-9);
    }
}
