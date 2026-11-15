//! Test signals and measurements shared by the integration tests.
//! @see docs/native-sustain.md
#![allow(dead_code)]

use oxidal_lv2_plugin::Plugin;
use oxidal_sustain::{CONTROLS, Sustain, port};
use std::f64::consts::TAU;

/// The plugin with its controls at their defaults, run in fixed blocks.
pub struct Rig<const N: usize> {
    pub plugin: Sustain<N>,
    pub controls: [f32; 9],
    pub rate: f32,
    pub block: usize,
}

impl<const N: usize> Rig<N> {
    pub fn new(rate: f32) -> Self {
        let mut plugin = Sustain::<N>::new(rate);
        plugin.reset();
        Self {
            plugin,
            controls: CONTROLS.map(|control| control.default),
            rate,
            block: 96,
        }
    }

    pub fn with(mut self, port: usize, value: f32) -> Self {
        self.controls[port] = value;
        self
    }

    /// Runs both channels; `before` may change controls ahead of each block.
    pub fn run_with(
        &mut self,
        left: &[f32],
        right: &[f32],
        mut before: impl FnMut(&mut Self, usize),
    ) -> (Vec<f32>, Vec<f32>) {
        let mut out = (vec![0.0; left.len()], vec![0.0; left.len()]);
        let mut at = 0;
        while at < left.len() {
            let end = (at + self.block).min(left.len());
            before(self, at);
            let inputs: [&[f32]; 2] = [&left[at..end], &right[at..end]];
            let mut outputs: [&mut [f32]; 2] = [&mut out.0[at..end], &mut out.1[at..end]];
            self.plugin
                .process(&self.controls, &inputs[..N], &mut outputs[..N]);
            at = end;
        }
        out
    }

    /// Runs the same signal on every channel and returns the left output.
    pub fn run(&mut self, input: &[f32]) -> Vec<f32> {
        self.run_with(input, input, |_, _| {}).0
    }

    /// As [`Self::run`], changing controls ahead of each block.
    pub fn run_changing(
        &mut self,
        input: &[f32],
        before: impl FnMut(&mut Self, usize),
    ) -> Vec<f32> {
        self.run_with(input, input, before).0
    }
}

/// The level a note is held at, relative to its picked level, for a Drive
/// setting: the documented plateau of -9 dB at 0 % rising to 0 dB at 100 %.
pub fn plateau_db(drive_percent: f32) -> f32 {
    -9.0 * (1.0 - drive_percent / 100.0)
}

pub fn default_plateau_db() -> f32 {
    plateau_db(CONTROLS[port::DRIVE].default)
}

/// A plucked string: decaying harmonics whose pitch may move.
#[derive(Clone, Copy)]
pub struct Pluck {
    /// Root mean square at the pick.
    pub level: f64,
    /// Decay of the fundamental in nepers a second; harmonic k decays
    /// `1 + 0.25 (k - 1)` times as fast, as a real string's do.
    pub decay: f64,
    pub harmonics: usize,
}

impl Default for Pluck {
    fn default() -> Self {
        Self {
            level: 0.1,
            decay: 1.5,
            harmonics: 8,
        }
    }
}

impl Pluck {
    /// `seconds` of the note, with `pitch(t)` its frequency at time t.
    pub fn bent(&self, rate: f32, seconds: f64, pitch: impl Fn(f64) -> f64) -> Vec<f32> {
        let rate = f64::from(rate);
        let weights: Vec<f64> = (1..=self.harmonics)
            .map(|k| (k as f64).powf(-1.1))
            .collect();
        let scale = self.level / (weights.iter().map(|w| w * w / 2.0).sum::<f64>()).sqrt();
        let mut phase = 0.0_f64;
        (0..(seconds * rate) as usize)
            .map(|i| {
                let t = i as f64 / rate;
                let mut x = 0.0;
                for (index, weight) in weights.iter().enumerate() {
                    let k = (index + 1) as f64;
                    let fade = (-self.decay * (1.0 + 0.25 * (k - 1.0)) * t).exp();
                    x += weight * fade * (k * phase + 0.7 * k).sin();
                }
                phase += TAU * pitch(t) / rate;
                (scale * x) as f32
            })
            .collect()
    }

    pub fn note(&self, rate: f32, seconds: f64, frequency: f64) -> Vec<f32> {
        self.bent(rate, seconds, |_| frequency)
    }
}

/// Adds `b` into `a` starting at sample `at`.
pub fn add_at(a: &mut [f32], b: &[f32], at: usize) {
    for (slot, x) in a.iter_mut().skip(at).zip(b) {
        *slot += x;
    }
}

/// Fades `signal` to silence over `fade` samples from `at`, as a hand
/// stopping the strings does.
pub fn mute(signal: &mut [f32], at: usize, fade: usize) {
    for (i, x) in signal.iter_mut().enumerate().skip(at) {
        let gone = ((i - at) as f32 / fade.max(1) as f32).min(1.0);
        *x *= 1.0 - gone;
    }
}

/// White noise at a given root mean square (uniform, deterministic).
pub fn noise(length: usize, level: f32, seed: u32) -> Vec<f32> {
    let mut state = seed.max(1);
    (0..length)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (state as i32) as f32 / 2_147_483_648.0 * level * 3.0_f32.sqrt()
        })
        .collect()
}

pub fn rms(signal: &[f32]) -> f64 {
    (signal.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / signal.len().max(1) as f64).sqrt()
}

pub fn db(ratio: f64) -> f64 {
    20.0 * ratio.max(1.0e-12).log10()
}

pub fn cents(a: f64, b: f64) -> f64 {
    1200.0 * (a / b).log2()
}

pub fn peak(signal: &[f32]) -> f32 {
    signal.iter().fold(0.0, |top, x| top.max(x.abs()))
}

/// The largest change between two neighbouring samples.
pub fn steepest(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .fold(0.0, |top, pair| top.max((pair[1] - pair[0]).abs()))
}

/// Hann-windowed correlation with a sinusoid: `(amplitude, phase)`.
fn correlate(signal: &[f32], rate: f64, hertz: f64) -> (f64, f64) {
    let (turn_sin, turn_cos) = (TAU * hertz / rate).sin_cos();
    let (mut cos, mut sin) = (1.0_f64, 0.0_f64);
    let (mut re, mut im, mut weight) = (0.0_f64, 0.0_f64, 0.0_f64);
    let length = signal.len() as f64;
    let (window_sin, window_cos) = (TAU / length).sin_cos();
    let (mut w_cos, mut w_sin) = (1.0_f64, 0.0_f64);
    for x in signal {
        let w = 0.5 - 0.5 * w_cos;
        re += w * f64::from(*x) * cos;
        im -= w * f64::from(*x) * sin;
        weight += w;
        (cos, sin) = (
            cos * turn_cos - sin * turn_sin,
            sin * turn_cos + cos * turn_sin,
        );
        (w_cos, w_sin) = (
            w_cos * window_cos - w_sin * window_sin,
            w_sin * window_cos + w_cos * window_sin,
        );
    }
    (2.0 * (re * re + im * im).sqrt() / weight, im.atan2(re))
}

/// Amplitude of the sinusoid at `hertz` in the signal.
pub fn amplitude(signal: &[f32], rate: f32, hertz: f64) -> f64 {
    correlate(signal, f64::from(rate), hertz).0
}

/// Frequency of the steady component near `guess` (within a major third),
/// from the phase it turns through between two windows two periods apart.
pub fn frequency(signal: &[f32], rate: f32, guess: f64) -> f64 {
    let rate = f64::from(rate);
    let apart = ((2.0 * rate / guess) as usize).min(signal.len() / 4);
    let length = signal.len() - apart;
    let first = correlate(&signal[..length], rate, guess).1;
    let second = correlate(&signal[apart..], rate, guess).1;
    let mut turned = second - first - TAU * guess * apart as f64 / rate;
    turned -= TAU * (turned / TAU).round();
    guess + turned / TAU * rate / apart as f64
}

/// Samples in `seconds` at `rate`.
pub fn at(rate: f32, seconds: f64) -> usize {
    (seconds * f64::from(rate)) as usize
}
