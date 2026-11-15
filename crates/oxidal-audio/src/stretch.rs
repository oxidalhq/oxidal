//! Bounded waveform-similarity overlap-add for the backing reader thread.
//! Based on Roelands and Verhelst (1993), linked from docs/media.md.

use std::io;

pub(crate) struct Stretch {
    hop: usize,
    search: u64,
    tail: Vec<[f32; 2]>,
    input: Vec<[f32; 2]>,
    output: Vec<[f32; 2]>,
}

impl Stretch {
    pub(crate) fn new(rate: u32) -> Self {
        let hop = (rate / 50).max(1) as usize;
        let search = u64::from(rate / 160);
        Self {
            hop,
            search,
            tail: Vec::with_capacity(hop),
            input: vec![[0.0; 2]; hop * 2 + search as usize * 2],
            output: Vec::with_capacity(hop),
        }
    }

    pub(crate) fn hop(&self) -> usize {
        self.hop
    }

    pub(crate) fn reset(&mut self) {
        self.tail.clear();
    }

    pub(crate) fn grain(
        &mut self,
        nominal: u64,
        lower: u64,
        upper: u64,
        count: usize,
        mut read: impl FnMut(u64, &mut [[f32; 2]]) -> io::Result<()>,
    ) -> io::Result<&[[f32; 2]]> {
        let start = nominal.saturating_sub(self.search).max(lower);
        let last = (nominal + self.search).min(upper - 1);
        let candidates = (last - start) as usize;
        let available = (upper - start).min((candidates + self.hop * 2) as u64) as usize;
        self.input.fill([0.0; 2]);
        read(start, &mut self.input[..available])?;
        let center = (nominal - start) as usize;
        let chosen = if self.tail.is_empty() {
            center
        } else {
            let mut best = (f64::NEG_INFINITY, center);
            for offset in 0..=candidates {
                let candidate = &self.input[offset..offset + self.hop];
                let mut dot = 0.0;
                let mut energy = 0.0;
                for (&[a, b], &[l, r]) in self.tail.iter().zip(candidate).step_by(8) {
                    dot += f64::from(a) * f64::from(l) + f64::from(b) * f64::from(r);
                    energy += f64::from(l).powi(2) + f64::from(r).powi(2);
                }
                let similarity = if energy > 1e-12 {
                    dot / energy.sqrt()
                } else {
                    0.0
                };
                let score = similarity - offset.abs_diff(center) as f64 * 1e-7;
                if score > best.0 {
                    best = (score, offset);
                }
            }
            best.1
        };
        self.output.clear();
        for (index, &frame) in self.input[chosen..chosen + count].iter().enumerate() {
            let sample = self.tail.get(index).map_or(frame, |old| {
                let blend = index as f32 / self.hop as f32;
                [
                    old[0] + (frame[0] - old[0]) * blend,
                    old[1] + (frame[1] - old[1]) * blend,
                ]
            });
            self.output.push(sample);
        }
        self.tail.clear();
        self.tail
            .extend_from_slice(&self.input[chosen + self.hop..chosen + self.hop * 2]);
        Ok(&self.output)
    }
}
