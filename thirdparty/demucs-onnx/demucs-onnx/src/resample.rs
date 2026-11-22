// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Band-limited resampling by windowed-sinc interpolation.
//!
//! htdemucs only ever runs at 44.1 kHz, so this exists to get other files
//! there. The filter is a Blackman-windowed sinc, tabulated once and read with
//! linear interpolation between entries -- fine enough that the interpolation
//! error sits well below the quantisation floor, without a transcendental per
//! tap.

use crate::audio::AudioBuffer;
use crate::fft::PI;

pub struct SincResampler {
    ratio: f64,
    cutoff: f64,
    support: f64,
    half: usize,
    steps: usize,
    table: Vec<f32>,
}

impl SincResampler {
    /// `half_width` counts zero crossings on each side of the filter; 16 puts
    /// the stopband well below 16-bit noise for music material.
    pub fn new(ratio: f64, half_width: usize, steps: usize) -> Self {
        let cutoff = ratio.min(1.0);
        let table = (0..=2 * half_width * steps)
            .map(|i| {
                let x = i as f64 / steps as f64 - half_width as f64;
                (sinc(x) * blackman(x / half_width as f64)) as f32
            })
            .collect();
        Self { ratio, cutoff, support: half_width as f64 / cutoff, half: half_width, steps, table }
    }

    pub fn output_frames(&self, input_frames: usize) -> usize {
        (input_frames as f64 * self.ratio).round() as usize
    }

    pub fn process(&self, input: &[f32], output: &mut [f32]) {
        let frames = input.len() as i64;
        for (i, out) in output.iter_mut().enumerate() {
            let centre = i as f64 / self.ratio;
            let first = (centre - self.support).ceil() as i64;
            let last = (centre + self.support).floor() as i64;

            let mut sum = 0.0f64;
            for j in first..=last {
                let clamped = j.clamp(0, frames - 1) as usize;
                sum += input[clamped] as f64 * self.tap((centre - j as f64) * self.cutoff);
            }
            *out = (sum * self.cutoff) as f32;
        }
    }

    fn tap(&self, x: f64) -> f64 {
        let position = (x + self.half as f64) * self.steps as f64;
        if position <= 0.0 || position >= (self.table.len() - 1) as f64 {
            return 0.0;
        }
        let index = position as usize;
        let frac = position - index as f64;
        self.table[index] as f64 * (1.0 - frac) + self.table[index + 1] as f64 * frac
    }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        return 1.0;
    }
    let t = PI * x;
    t.sin() / t
}

fn blackman(t: f64) -> f64 {
    if t.abs() >= 1.0 {
        return 0.0;
    }
    let phase = PI * (t + 1.0);
    0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos()
}

pub fn resample(input: AudioBuffer, target_rate: u32) -> AudioBuffer {
    if input.samplerate == target_rate || input.frames == 0 {
        return input;
    }
    let resampler = SincResampler::new(target_rate as f64 / input.samplerate as f64, 16, 512);
    let frames = resampler.output_frames(input.frames);

    let mut out = AudioBuffer::new(input.channels, frames, target_rate);
    for c in 0..input.channels {
        let source = input.channel(c).to_vec();
        resampler.process(&source, out.channel_mut(c));
    }
    out
}
