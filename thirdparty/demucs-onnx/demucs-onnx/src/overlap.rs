// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Weighted overlap-add over a window that slides with the input.
//!
//! Chunks are added at absolute sample offsets; once a sample can no longer be
//! touched by a future chunk it is normalised by the accumulated weight and
//! handed back. Only `capacity` samples are ever held, so memory does not grow
//! with track length.

pub struct OverlapAdd {
    planes: usize,
    capacity: usize,
    base: usize,
    accumulator: Vec<f32>,
    weight: Vec<f32>,
}

impl OverlapAdd {
    pub fn new(planes: usize, capacity: usize) -> Self {
        Self {
            planes,
            capacity,
            base: 0,
            accumulator: vec![0.0; planes * capacity],
            weight: vec![0.0; capacity],
        }
    }

    /// Absolute index of the first sample still held.
    pub fn base(&self) -> usize {
        self.base
    }

    /// Adds `planes` rows of `count` samples, `stride` apart in `block`, at
    /// absolute sample `offset`, under the first `count` values of `weight`.
    pub fn add(&mut self, offset: usize, block: &[f32], stride: usize, count: usize,
               weight: &[f32]) {
        let start = offset
            .checked_sub(self.base)
            .expect("chunk starts before the overlap-add window");
        assert!(start + count <= self.capacity, "overlap-add window is too small");

        for plane in 0..self.planes {
            let src = &block[plane * stride..plane * stride + count];
            let dst = &mut self.accumulator[plane * self.capacity + start..][..count];
            for (out, (value, w)) in dst.iter_mut().zip(src.iter().zip(&weight[..count])) {
                *out += value * w;
            }
        }
        for (sum, w) in self.weight[start..start + count].iter_mut().zip(&weight[..count]) {
            *sum += w;
        }
    }

    /// Finalises everything before absolute sample `upto` into `out`, laid out
    /// as `planes` rows of the returned length. Returns 0 if nothing is ready.
    pub fn flush(&mut self, upto: usize, out: &mut Vec<f32>) -> usize {
        if upto <= self.base {
            return 0;
        }
        let count = upto - self.base;
        out.resize(self.planes * count, 0.0);

        for plane in 0..self.planes {
            let src = &self.accumulator[plane * self.capacity..][..count];
            let dst = &mut out[plane * count..][..count];
            for (value, (acc, w)) in dst.iter_mut().zip(src.iter().zip(&self.weight[..count])) {
                *value = acc / w;
            }
        }

        let keep = self.capacity - count;
        for plane in 0..self.planes {
            let row = &mut self.accumulator[plane * self.capacity..][..self.capacity];
            row.copy_within(count.., 0);
            row[keep..].fill(0.0);
        }
        self.weight.copy_within(count.., 0);
        self.weight[keep..].fill(0.0);

        self.base = upto;
        count
    }
}

/// demucs' triangular cross-fade: up over the first half, down over the second.
pub fn transition_weight(segment: usize, power: f32) -> Vec<f32> {
    let mut weight: Vec<f32> = (0..segment)
        .map(|i| if i < segment / 2 { (i + 1) as f32 } else { (segment - i) as f32 })
        .collect();
    let peak = weight.iter().copied().fold(f32::MIN, f32::max);
    for value in &mut weight {
        *value /= peak;
        if power != 1.0 {
            *value = value.powf(power);
        }
    }
    weight
}
