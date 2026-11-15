//! Test rig and signals shared by the Oxidal Echo tests.
//! @see docs/native-echo.md
#![allow(dead_code)]

use oxidal_echo::Echo;
use oxidal_echo::controls::{self, CONTROLS, Mode};
use oxidal_lv2_plugin::Plugin;

/// The plugin with `N` channels, its control values and a block size.
pub struct Rig<const N: usize> {
    pub echo: Echo<N>,
    pub controls: [f32; CONTROLS.len()],
    pub rate: f32,
    pub block: usize,
}

impl<const N: usize> Rig<N> {
    pub fn new(rate: f32) -> Self {
        let mut echo = Echo::<N>::new(rate);
        echo.reset();
        Self {
            echo,
            controls: controls::defaults(),
            rate,
            block: 96,
        }
    }

    pub fn set(&mut self, index: usize, value: f32) -> &mut Self {
        self.controls[index] = value;
        self
    }

    pub fn mode(&mut self, mode: Mode) -> &mut Self {
        let index = Mode::ALL.iter().position(|m| *m == mode).unwrap_or(0);
        self.set(controls::MODE, index as f32)
    }

    /// Only the repeats, with nothing that moves them about: Mix 100, no
    /// feedback, no modulation, no wear, no stereo spread.
    pub fn repeats_only(&mut self) -> &mut Self {
        self.set(controls::MIX, 100.0)
            .set(controls::FEEDBACK, 0.0)
            .set(controls::MOD, 0.0)
            .set(controls::AGE, 0.0)
            .set(controls::WIDTH, 0.0)
    }

    pub fn samples(&self, seconds: f32) -> usize {
        (seconds * self.rate).round() as usize
    }

    /// Runs the same signal into every channel; returns each channel's output.
    pub fn run(&mut self, input: &[f32]) -> Vec<Vec<f32>> {
        self.run_sides(input, input)
    }

    /// Runs `left` and (in the stereo plugin) `right`; `before` may change the
    /// controls at the start of each block, as a host does.
    pub fn run_with(
        &mut self,
        left: &[f32],
        right: &[f32],
        mut before: impl FnMut(usize, &mut [f32; CONTROLS.len()]),
    ) -> Vec<Vec<f32>> {
        let frames = left.len().min(right.len());
        let mut out = vec![vec![0.0_f32; frames]; N];
        let mut done = 0;
        while done < frames {
            let len = self.block.min(frames - done);
            before(done, &mut self.controls);
            let ins = [&left[done..done + len], &right[done..done + len]];
            let mut slices: Vec<&mut [f32]> = out
                .iter_mut()
                .map(|side| &mut side[done..done + len])
                .collect();
            self.echo.process(&self.controls, &ins[..N], &mut slices);
            done += len;
        }
        out
    }

    pub fn run_sides(&mut self, left: &[f32], right: &[f32]) -> Vec<Vec<f32>> {
        self.run_with(left, right, |_, _| {})
    }
}

pub const TAU: f64 = core::f64::consts::TAU;

pub fn sine(rate: f32, hertz: f64, amplitude: f64, frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| (amplitude * (TAU * hertz * i as f64 / f64::from(rate)).sin()) as f32)
        .collect()
}

pub fn silence(frames: usize) -> Vec<f32> {
    vec![0.0; frames]
}

pub fn impulse(frames: usize) -> Vec<f32> {
    let mut signal = vec![0.0; frames];
    if let Some(first) = signal.first_mut() {
        *first = 1.0;
    }
    signal
}

/// Repeatable noise in -1..1 (a linear congruential generator).
pub fn noise(seed: u32, amplitude: f32, frames: usize) -> Vec<f32> {
    let mut state = seed;
    (0..frames)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            amplitude * ((state >> 8) as f32 / 8_388_608.0 - 1.0)
        })
        .collect()
}

/// A guitar-like note: decaying harmonics of `hertz` plus a little noise,
/// plucked again every `every` seconds.
pub fn pluck(rate: f32, hertz: f64, every: f64, frames: usize) -> Vec<f32> {
    let hiss = noise(11, 0.003, frames);
    (0..frames)
        .map(|i| {
            let t = (i as f64 / f64::from(rate)) % every;
            let mut x = 0.0;
            for harmonic in 1..=6 {
                let h = f64::from(harmonic);
                x += (TAU * hertz * h * t).sin() / h * (-t * (1.5 + 0.8 * h)).exp();
            }
            (0.35 * x * (1.0 - (-t * 800.0).exp())) as f32 + hiss[i]
        })
        .collect()
}

pub fn rms(signal: &[f32]) -> f64 {
    if signal.is_empty() {
        return 0.0;
    }
    (signal.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / signal.len() as f64).sqrt()
}

pub fn peak(signal: &[f32]) -> f32 {
    signal.iter().fold(0.0, |p, x| p.max(x.abs()))
}

pub fn db(ratio: f64) -> f64 {
    20.0 * ratio.max(1.0e-12).log10()
}

/// The largest difference between neighbouring samples.
pub fn largest_step(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .fold(0.0, |step, pair| step.max((pair[1] - pair[0]).abs()))
}

/// The frequency of a steady tone, from its upward zero crossings.
pub fn frequency(signal: &[f32], rate: f32) -> f64 {
    let mut crossings = Vec::new();
    for (i, pair) in signal.windows(2).enumerate() {
        if pair[0] < 0.0 && pair[1] >= 0.0 {
            let fraction = f64::from(-pair[0]) / f64::from(pair[1] - pair[0]);
            crossings.push(i as f64 + fraction);
        }
    }
    match (crossings.first(), crossings.last()) {
        (Some(first), Some(last)) if crossings.len() > 1 => {
            (crossings.len() - 1) as f64 * f64::from(rate) / (last - first)
        }
        _ => 0.0,
    }
}

/// The amplitude of the component of `signal` at `hertz` (a single-bin DFT).
pub fn amplitude_at(signal: &[f32], rate: f32, hertz: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (i, x) in signal.iter().enumerate() {
        let phase = TAU * hertz * i as f64 / f64::from(rate);
        re += f64::from(*x) * phase.cos();
        im += f64::from(*x) * phase.sin();
    }
    2.0 * (re * re + im * im).sqrt() / signal.len().max(1) as f64
}

pub fn all_finite_within(out: &[Vec<f32>], bound: f32) -> bool {
    out.iter()
        .all(|side| side.iter().all(|x| x.is_finite() && x.abs() <= bound))
}
