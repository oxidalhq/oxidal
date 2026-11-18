//! Test rig and signals shared by the Oxidal Moment tests.
//! @see docs/native-moment.md
#![allow(dead_code)]

use oxidal_lv2_plugin::Plugin;
use oxidal_moment::Moment;
use oxidal_moment::controls::{self, CONTROLS};

pub const RATE: f32 = 48_000.0;

/// The plugin with `N` channels, its control values and a block size.
pub struct Rig<const N: usize> {
    pub moment: Moment<N>,
    pub controls: [f32; CONTROLS.len()],
    pub block: usize,
}

impl<const N: usize> Rig<N> {
    pub fn new() -> Self {
        let mut moment = Moment::<N>::new(RATE);
        moment.reset();
        Self {
            moment,
            controls: controls::defaults(),
            block: 96,
        }
    }

    pub fn set(&mut self, index: usize, value: f32) -> &mut Self {
        self.controls[index] = value;
        self
    }

    /// Only the loop is heard: no dry signal, nothing from the wet half.
    pub fn loop_only(&mut self) -> &mut Self {
        self.set(controls::MIX, 100.0)
            .set(controls::BALANCE, 0.0)
            .set(controls::WET, 0.0)
            .set(controls::ROUTE, 0.0)
    }

    /// Only the wet half is heard, fed by the input, with the Tone wide open.
    pub fn wet_only(&mut self, mode: f32) -> &mut Self {
        self.set(controls::MIX, 100.0)
            .set(controls::BALANCE, 100.0)
            .set(controls::ROUTE, 0.0)
            .set(controls::WET_MODE, mode)
            .set(controls::TONE, 100.0)
    }

    /// Runs the same signal into every channel; returns each channel's output.
    pub fn run(&mut self, input: &[f32]) -> Vec<Vec<f32>> {
        self.run_sides(input, input)
    }

    pub fn run_sides(&mut self, left: &[f32], right: &[f32]) -> Vec<Vec<f32>> {
        let frames = left.len().min(right.len());
        let mut out = vec![vec![0.0_f32; frames]; N];
        let mut done = 0;
        while done < frames {
            let len = self.block.min(frames - done);
            let ins = [&left[done..done + len], &right[done..done + len]];
            let mut slices: Vec<&mut [f32]> = out
                .iter_mut()
                .map(|side| &mut side[done..done + len])
                .collect();
            self.moment.process(&self.controls, &ins[..N], &mut slices);
            done += len;
        }
        out
    }

    /// Plays `seconds` of silence and returns the first channel.
    pub fn listen(&mut self, seconds: f32) -> Vec<f32> {
        self.run(&silence(seconds)).swap_remove(0)
    }

    /// Records `tone`, catches it, and lets the catch finish fading in.
    pub fn catch(&mut self, tone: &[f32]) -> &mut Self {
        self.run(tone);
        self.set(controls::CATCH, 1.0);
        self.listen(0.1);
        self
    }

    /// The length of the loop playing now, in steps.
    pub fn loop_length(&self) -> f64 {
        self.moment.engine().looper().length()
    }

    /// The Stretch and Touch position.
    pub fn head(&self) -> f64 {
        self.moment.engine().looper().head()
    }
}

pub const TAU: f64 = core::f64::consts::TAU;

pub fn samples(seconds: f32) -> usize {
    (seconds * RATE).round() as usize
}

pub fn sine(hertz: f64, amplitude: f64, seconds: f32) -> Vec<f32> {
    (0..samples(seconds))
        .map(|i| (amplitude * (TAU * hertz * i as f64 / f64::from(RATE)).sin()) as f32)
        .collect()
}

pub fn silence(seconds: f32) -> Vec<f32> {
    vec![0.0; samples(seconds)]
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

pub fn rms(signal: &[f32]) -> f64 {
    if signal.is_empty() {
        return 0.0;
    }
    (signal.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / signal.len() as f64).sqrt()
}

pub fn peak(signal: &[f32]) -> f32 {
    signal.iter().fold(0.0, |most, x| most.max(x.abs()))
}

/// The largest step between two neighbouring samples.
pub fn largest_step(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .fold(0.0, |most, pair| most.max((pair[1] - pair[0]).abs()))
}

/// The index of the loudest sample.
pub fn loudest(signal: &[f32]) -> usize {
    let mut best = 0;
    for (index, x) in signal.iter().enumerate() {
        if x.abs() > signal[best].abs() {
            best = index;
        }
    }
    best
}

/// The frequency of a tone, from its rising zero crossings.
pub fn frequency(signal: &[f32]) -> f64 {
    let crossings: Vec<usize> = signal
        .windows(2)
        .enumerate()
        .filter(|(_, pair)| pair[0] <= 0.0 && pair[1] > 0.0)
        .map(|(index, _)| index)
        .collect();
    match (crossings.first(), crossings.last()) {
        (Some(first), Some(last)) if last > first => {
            (crossings.len() - 1) as f64 * f64::from(RATE) / (last - first) as f64
        }
        _ => 0.0,
    }
}

/// The amplitude of one frequency in a signal.
pub fn tone_level(signal: &[f32], hertz: f64) -> f64 {
    let (mut real, mut imaginary) = (0.0, 0.0);
    for (index, x) in signal.iter().enumerate() {
        let angle = TAU * hertz * index as f64 / f64::from(RATE);
        real += f64::from(*x) * angle.cos();
        imaginary += f64::from(*x) * angle.sin();
    }
    2.0 * (real * real + imaginary * imaginary).sqrt() / signal.len().max(1) as f64
}

pub fn near(value: f64, expected: f64, share: f64) -> bool {
    (value - expected).abs() <= expected.abs() * share
}
