//! Test signals, a rig that drives the plugin as a host does, and measures.
//!
//! # References
//!
//! - Cooley and Tukey, "An algorithm for the machine calculation of complex Fourier series" (1965). <https://doi.org/10.1090/S0025-5718-1965-0178586-1>
//! - Schroeder, "New Method of Measuring Reverberation Time" (1965). <https://doi.org/10.1121/1.1909343>
//!
//! @see docs/native-bloom.md
#![allow(dead_code)]

use oxidal_bloom::{Bloom, defaults};
use oxidal_lv2_plugin::Plugin;

pub use oxidal_bloom::port;

/// Mode numbers, in the order of the Mode control.
pub const ROOM: f32 = 0.0;
pub const HALL: f32 = 1.0;
pub const PLATE: f32 = 2.0;
pub const SPRING: f32 = 3.0;
pub const CLOUD: f32 = 4.0;
pub const BLOOM: f32 = 5.0;
pub const SHIMMER: f32 = 6.0;
pub const NONLINEAR: f32 = 7.0;
pub const MODES: [f32; 8] = [ROOM, HALL, PLATE, SPRING, CLOUD, BLOOM, SHIMMER, NONLINEAR];

/// The plugin with its controls and sample rate.
pub struct Rig<const N: usize> {
    pub plugin: Bloom<N>,
    pub controls: [f32; 14],
    pub rate: f32,
}

impl<const N: usize> Rig<N> {
    pub fn new(rate: f32) -> Self {
        let mut plugin = Bloom::<N>::new(rate);
        plugin.reset();
        Self {
            plugin,
            controls: defaults(),
            rate,
        }
    }

    pub fn with(mut self, port: usize, value: f32) -> Self {
        self.controls[port] = value;
        self
    }

    pub fn set(&mut self, port: usize, value: f32) {
        self.controls[port] = value;
    }

    /// Runs `left` (and `right`, or `left` again) through the plugin in
    /// blocks of `block` frames and returns both outputs.
    pub fn run_stereo(
        &mut self,
        left: &[f32],
        right: &[f32],
        block: usize,
    ) -> (Vec<f32>, Vec<f32>) {
        let mut out_l = vec![0.0; left.len()];
        let mut out_r = vec![0.0; left.len()];
        let mut done = 0;
        while done < left.len() {
            let end = (done + block).min(left.len());
            let ins: [&[f32]; 2] = [&left[done..end], &right[done..end]];
            let (l, r) = (&mut out_l[done..end], &mut out_r[done..end]);
            let mut outs: [&mut [f32]; 2] = [l, r];
            self.plugin
                .process(&self.controls, &ins[..N], &mut outs[..N]);
            done = end;
        }
        (out_l, out_r)
    }

    /// Runs a mono signal (the same on both inputs of the stereo plugin).
    pub fn run(&mut self, input: &[f32], block: usize) -> (Vec<f32>, Vec<f32>) {
        self.run_stereo(input, input, block)
    }

    /// Runs `seconds` of silence.
    pub fn silence(&mut self, seconds: f32) -> (Vec<f32>, Vec<f32>) {
        let input = vec![0.0; (seconds * self.rate) as usize];
        self.run(&input, 96)
    }

    /// Runs the signal block by block, calling `before` with the frame
    /// number ahead of each block so a test can move controls as a scene does.
    pub fn run_with(
        &mut self,
        input: &[f32],
        block: usize,
        mut before: impl FnMut(usize, &mut [f32; 14]),
    ) -> (Vec<f32>, Vec<f32>) {
        let mut out_l = Vec::with_capacity(input.len());
        let mut out_r = Vec::with_capacity(input.len());
        for (index, chunk) in input.chunks(block).enumerate() {
            before(index * block, &mut self.controls);
            let (l, r) = self.run(chunk, block);
            out_l.extend(l);
            out_r.extend(r);
        }
        (out_l, out_r)
    }
}

pub fn sine(rate: f32, seconds: f32, hertz: f32, level: f32) -> Vec<f32> {
    (0..(seconds * rate) as usize)
        .map(|i| level * (core::f32::consts::TAU * hertz * i as f32 / rate).sin())
        .collect()
}

pub fn noise(rate: f32, seconds: f32, level: f32, seed: u32) -> Vec<f32> {
    let mut random = oxidal_dsp::Noise::new(seed);
    (0..(seconds * rate) as usize)
        .map(|_| level * random.next())
        .collect()
}

/// Steady noise with a guitar-like tilt: white noise through two gentle
/// low-passes, so most of its energy lies below 2 kHz.
pub fn tilted(rate: f32, seconds: f32, level: f32, seed: u32) -> Vec<f32> {
    let (mut a, mut b) = (0.0_f32, 0.0_f32);
    let scale = 48_000.0 / rate;
    noise(rate, seconds, 1.0, seed)
        .into_iter()
        .map(|x| {
            a += (x - a) * (0.12 * scale).min(1.0);
            b += (a - b) * (0.25 * scale).min(1.0);
            level * 4.0 * b
        })
        .collect()
}

/// `signal` followed by `seconds` of silence.
pub fn then_silence(mut signal: Vec<f32>, rate: f32, seconds: f32) -> Vec<f32> {
    signal.extend(vec![0.0; (seconds * rate) as usize]);
    signal
}

/// Level in decibels of each stretch of `window` seconds.
pub fn envelope(signal: &[f32], rate: f32, window: f32) -> Vec<f32> {
    signal
        .chunks_exact((window * rate) as usize)
        .map(|chunk| db(rms(chunk)))
        .collect()
}

pub fn impulse(rate: f32, seconds: f32, level: f32) -> Vec<f32> {
    let mut signal = vec![0.0; (seconds * rate) as usize];
    signal[0] = level;
    signal
}

/// A guitar-like note: decaying harmonics of `hertz`, plucked every
/// `every` seconds, with a little noise.
pub fn plucks(rate: f32, seconds: f32, hertz: f32, every: f32, level: f32) -> Vec<f32> {
    let mut random = oxidal_dsp::Noise::new(11);
    let period = (every * rate) as usize;
    (0..(seconds * rate) as usize)
        .map(|i| {
            let t = (i % period.max(1)) as f32 / rate;
            let mut sum = 0.0;
            for harmonic in 1..=8 {
                let h = harmonic as f32;
                let decay = (-t * (1.5 + 0.9 * h)).exp();
                sum += decay / h * (core::f32::consts::TAU * hertz * h * t).sin();
            }
            let attack = (t * 400.0).min(1.0);
            level * (0.6 * attack * sum + 0.002 * random.next())
        })
        .collect()
}

/// A steady note with harmonics: a guitar note held by a sustainer.
pub fn held(rate: f32, seconds: f32, hertz: f32, level: f32) -> Vec<f32> {
    (0..(seconds * rate) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            let mut sum = 0.0;
            for harmonic in 1..=6 {
                let h = harmonic as f32;
                sum += (core::f32::consts::TAU * hertz * h * t).sin() / (h * h);
            }
            level * 0.8 * sum
        })
        .collect()
}

pub fn rms(signal: &[f32]) -> f32 {
    let energy: f64 = signal.iter().map(|x| f64::from(*x) * f64::from(*x)).sum();
    (energy / signal.len().max(1) as f64).sqrt() as f32
}

pub fn peak(signal: &[f32]) -> f32 {
    signal.iter().fold(0.0, |peak, x| peak.max(x.abs()))
}

pub fn db(ratio: f32) -> f32 {
    20.0 * ratio.max(1.0e-12).log10()
}

/// The largest change from one sample to the next.
pub fn max_step(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .fold(0.0, |step, pair| step.max((pair[1] - pair[0]).abs()))
}

pub fn all_finite(signal: &[f32]) -> bool {
    signal.iter().all(|x| x.is_finite())
}

/// Decay time: the energy still to come after each instant (backward
/// integration of the squared response, Schroeder 1965), with a straight
/// line fitted between `from_db` and `to_db` below the start and stretched
/// to 60 dB.
pub fn decay_time(response: &[f32], rate: f32, from_db: f32, to_db: f32) -> f32 {
    let mut remaining = vec![0.0_f64; response.len()];
    let mut sum = 0.0_f64;
    for (slot, x) in remaining.iter_mut().zip(response).rev() {
        sum += f64::from(*x) * f64::from(*x);
        *slot = sum;
    }
    let total = remaining[0].max(1.0e-30);
    let level = |i: usize| 10.0 * (remaining[i].max(1.0e-30) / total).log10();
    let start = (0..response.len()).find(|&i| level(i) <= f64::from(from_db));
    let end = (0..response.len()).find(|&i| level(i) <= f64::from(to_db));
    match (start, end) {
        (Some(start), Some(end)) if end > start => {
            let slope = (level(end) - level(start)) / (end - start) as f64 * f64::from(rate);
            (-60.0 / slope) as f32
        }
        _ => f32::INFINITY,
    }
}

/// Correlation of two signals, -1 to 1.
pub fn correlation(a: &[f32], b: &[f32]) -> f32 {
    let (mut ab, mut aa, mut bb) = (0.0_f64, 0.0_f64, 0.0_f64);
    for (x, y) in a.iter().zip(b) {
        ab += f64::from(*x) * f64::from(*y);
        aa += f64::from(*x) * f64::from(*x);
        bb += f64::from(*y) * f64::from(*y);
    }
    (ab / (aa * bb).sqrt().max(1.0e-30)) as f32
}

/// In-place radix-2 fast Fourier transform (Cooley and Tukey 1965), written
/// out from the definition: bit-reversal, then butterflies of doubling span.
pub fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    assert!(n.is_power_of_two() && im.len() == n);
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut span = 2;
    while span <= n {
        let angle = -core::f64::consts::TAU / span as f64;
        for start in (0..n).step_by(span) {
            for k in 0..span / 2 {
                let (sin, cos) = (angle * k as f64).sin_cos();
                let (a, b) = (start + k, start + k + span / 2);
                let (tr, ti) = (re[b] * cos - im[b] * sin, re[b] * sin + im[b] * cos);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        span <<= 1;
    }
}

/// Power spectrum of the first power-of-two samples of `signal`, with a
/// raised-cosine window; bin `k` is `k * rate / n` hertz.
pub fn spectrum(signal: &[f32]) -> Vec<f64> {
    let n = if signal.len().is_power_of_two() {
        signal.len()
    } else {
        signal.len().next_power_of_two() / 2
    };
    let mut re: Vec<f64> = signal[..n]
        .iter()
        .enumerate()
        .map(|(i, x)| {
            let window = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / n as f64).cos();
            f64::from(*x) * window
        })
        .collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    (0..n / 2).map(|k| re[k] * re[k] + im[k] * im[k]).collect()
}

/// The power-weighted mean frequency of `signal` in hertz.
pub fn centroid(signal: &[f32], rate: f32) -> f32 {
    let power = spectrum(signal);
    let n = 2 * power.len();
    let (mut weighted, mut total) = (0.0_f64, 0.0_f64);
    for (k, p) in power.iter().enumerate() {
        weighted += p * k as f64 * f64::from(rate) / n as f64;
        total += p;
    }
    (weighted / total.max(1.0e-30)) as f32
}

/// The frequency of the strongest bin between `low` and `high` hertz.
pub fn strongest(signal: &[f32], rate: f32, low: f32, high: f32) -> f32 {
    let power = spectrum(signal);
    let n = 2 * power.len();
    let hertz = |k: usize| k as f32 * rate / n as f32;
    let mut best = (0, 0.0_f64);
    for (k, p) in power.iter().enumerate() {
        if hertz(k) >= low && hertz(k) <= high && *p > best.1 {
            best = (k, *p);
        }
    }
    hertz(best.0)
}
