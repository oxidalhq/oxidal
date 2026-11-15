//! Helpers shared by the test files: control values by symbol, block-wise
//! rendering through the plugin interface, test signals and measurements.
#![allow(dead_code)]

use core::f32::consts::TAU;

use oxidal_dsp::Noise;
use oxidal_lv2_plugin::Plugin;
use oxidal_motion::{CONTROLS, Mode, Motion};

/// Every control at its default.
pub fn defaults() -> Vec<f32> {
    CONTROLS.iter().map(|control| control.default).collect()
}

/// Sets the control with `symbol`.
pub fn set(controls: &mut [f32], symbol: &str, value: f32) {
    let index = CONTROLS
        .iter()
        .position(|control| control.symbol == symbol)
        .unwrap_or_else(|| panic!("no control {symbol}"));
    controls[index] = value;
}

/// The defaults with the given controls changed.
pub fn with(changes: &[(&str, f32)]) -> Vec<f32> {
    let mut controls = defaults();
    for (symbol, value) in changes {
        set(&mut controls, symbol, *value);
    }
    controls
}

/// The defaults in `mode` with the given controls changed.
pub fn in_mode(mode: Mode, changes: &[(&str, f32)]) -> Vec<f32> {
    let mut controls = with(changes);
    set(&mut controls, "mode", mode as usize as f32);
    controls
}

/// Runs `input` (one vector per channel) through the plugin in blocks of
/// `block` frames and returns one output vector per channel.
pub fn render<const N: usize>(
    plugin: &mut Motion<N>,
    controls: &[f32],
    input: &[Vec<f32>],
    block: usize,
) -> Vec<Vec<f32>> {
    render_with(plugin, input, block, |_| controls.to_vec())
}

/// As [`render`], asking `controls_at(frame)` for the controls of each block.
pub fn render_with<const N: usize>(
    plugin: &mut Motion<N>,
    input: &[Vec<f32>],
    block: usize,
    mut controls_at: impl FnMut(usize) -> Vec<f32>,
) -> Vec<Vec<f32>> {
    assert_eq!(input.len(), N);
    let frames = input[0].len();
    let mut output = vec![vec![0.0_f32; frames]; N];
    let mut start = 0;
    while start < frames {
        let end = (start + block).min(frames);
        let controls = controls_at(start);
        let ins: Vec<&[f32]> = input.iter().map(|channel| &channel[start..end]).collect();
        let mut outs: Vec<&mut [f32]> = output
            .iter_mut()
            .map(|channel| &mut channel[start..end])
            .collect();
        plugin.process(&controls, &ins, &mut outs);
        start = end;
    }
    output
}

/// A fresh plugin at `sample_rate`, reset as a host would.
pub fn plugin<const N: usize>(sample_rate: f32) -> Motion<N> {
    let mut plugin = Motion::<N>::new(sample_rate);
    plugin.reset();
    plugin
}

/// Renders a mono signal through the mono plugin with fixed controls.
pub fn mono(sample_rate: f32, controls: &[f32], input: &[f32]) -> Vec<f32> {
    render(
        &mut plugin::<1>(sample_rate),
        controls,
        &[input.to_vec()],
        96,
    )
    .remove(0)
}

/// Renders a mono signal into both sides of the stereo plugin.
pub fn stereo(sample_rate: f32, controls: &[f32], input: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let mut out = render(
        &mut plugin::<2>(sample_rate),
        controls,
        &[input.to_vec(), input.to_vec()],
        96,
    );
    let right = out.remove(1);
    (out.remove(0), right)
}

pub fn sine(hertz: f32, amplitude: f32, frames: usize, sample_rate: f32) -> Vec<f32> {
    (0..frames)
        .map(|i| amplitude * (TAU * (hertz * i as f32 / sample_rate).fract()).sin())
        .collect()
}

pub fn silence(frames: usize) -> Vec<f32> {
    vec![0.0; frames]
}

pub fn impulse(frames: usize) -> Vec<f32> {
    let mut signal = vec![0.0; frames];
    signal[0] = 1.0;
    signal
}

pub fn noise(amplitude: f32, frames: usize, seed: u32) -> Vec<f32> {
    let mut source = Noise::new(seed);
    (0..frames).map(|_| amplitude * source.next()).collect()
}

/// A guitar-like signal: a note plucked twice a second, eight decaying
/// harmonics, with a little noise.
pub fn plucked(frames: usize, sample_rate: f32) -> Vec<f32> {
    let notes = [110.0_f32, 164.8, 220.0, 146.8, 196.0, 329.6];
    let period = (0.5 * sample_rate) as usize;
    let mut hiss = Noise::new(11);
    (0..frames)
        .map(|i| {
            let note = notes[(i / period) % notes.len()];
            let t = (i % period) as f32 / sample_rate;
            let attack = (t * 400.0).min(1.0);
            let mut sample = 0.0;
            for harmonic in 1..=8 {
                let h = harmonic as f32;
                let level = 0.3 / h * (-t * (1.5 + 0.8 * h)).exp();
                sample += level * (TAU * (note * h * t).fract()).sin();
            }
            attack * sample + 0.002 * hiss.next()
        })
        .collect()
}

pub fn rms(signal: &[f32]) -> f32 {
    (signal
        .iter()
        .map(|x| f64::from(*x) * f64::from(*x))
        .sum::<f64>()
        / signal.len().max(1) as f64)
        .sqrt() as f32
}

pub fn peak(signal: &[f32]) -> f32 {
    signal.iter().fold(0.0_f32, |peak, x| peak.max(x.abs()))
}

pub fn decibels(ratio: f32) -> f32 {
    20.0 * ratio.max(1.0e-12).log10()
}

/// The largest difference between two neighbouring samples.
pub fn largest_step(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .fold(0.0_f32, |step, pair| step.max((pair[1] - pair[0]).abs()))
}

/// Times, in fractional samples, at which the signal crosses `level` upward.
pub fn upward_crossings(signal: &[f32], level: f32) -> Vec<f32> {
    signal
        .windows(2)
        .enumerate()
        .filter(|(_, pair)| pair[0] < level && pair[1] >= level)
        .map(|(index, pair)| index as f32 + (level - pair[0]) / (pair[1] - pair[0]))
        .collect()
}

/// The repetition rate in hertz of a slow wave, from the mean spacing of its
/// upward crossings of its own mid level.
pub fn repetition_hertz(signal: &[f32], sample_rate: f32) -> f32 {
    let (low, high) = signal.iter().fold((f32::MAX, f32::MIN), |(low, high), x| {
        (low.min(*x), high.max(*x))
    });
    let crossings = upward_crossings(signal, 0.5 * (low + high));
    assert!(crossings.len() >= 2, "fewer than two cycles in the signal");
    let span = crossings[crossings.len() - 1] - crossings[0];
    (crossings.len() - 1) as f32 * sample_rate / span
}

/// The level of a signal over time: its root mean square in windows of
/// `window` frames.
pub fn envelope(signal: &[f32], window: usize) -> Vec<f32> {
    signal.chunks_exact(window).map(rms).collect()
}

/// The frequency of a near-sine over time, one value per cycle, as
/// `(time in samples, hertz)`.
pub fn pitch_track(signal: &[f32], sample_rate: f32) -> Vec<(f32, f32)> {
    upward_crossings(signal, 0.0)
        .windows(2)
        .map(|pair| (0.5 * (pair[0] + pair[1]), sample_rate / (pair[1] - pair[0])))
        .collect()
}

/// The strength of `hertz` in the signal: the amplitude of that sine
/// component (a single-bin Fourier sum).
pub fn component(signal: &[f32], hertz: f32, sample_rate: f32) -> f32 {
    let (mut real, mut imaginary) = (0.0_f64, 0.0_f64);
    for (i, x) in signal.iter().enumerate() {
        let angle = f64::from(TAU) * f64::from(hertz) * i as f64 / f64::from(sample_rate);
        real += f64::from(*x) * angle.cos();
        imaginary += f64::from(*x) * angle.sin();
    }
    (2.0 * (real * real + imaginary * imaginary).sqrt() / signal.len().max(1) as f64) as f32
}
