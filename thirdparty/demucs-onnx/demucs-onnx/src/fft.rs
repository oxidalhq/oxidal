// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Radix-2 real FFT.
//!
//! Conventions match `numpy.fft.rfft` / `numpy.fft.irfft`: the forward
//! transform is unnormalised and the inverse carries the `1/n`. A length-`n`
//! real transform is computed as a length-`n/2` complex transform plus a
//! recombination step, which is the usual factor-of-two saving.
//!
//! The struct holds nothing but immutable twiddle tables, so it is `Sync` and
//! one instance can serve every worker thread; per-call scratch is passed in.

pub const PI: f64 = std::f64::consts::PI;

pub struct RealFft {
    n: usize,
    half: usize,
    cos: Vec<f32>,
    sin: Vec<f32>,
    cos_n: Vec<f32>,
    sin_n: Vec<f32>,
    reverse: Vec<usize>,
}

impl RealFft {
    /// `n` must be a power of two and at least 4.
    pub fn new(n: usize) -> Self {
        assert!(n >= 4 && n.is_power_of_two(), "fft size must be a power of two >= 4");
        let half = n / 2;

        let mut cos = Vec::with_capacity(half / 2);
        let mut sin = Vec::with_capacity(half / 2);
        for i in 0..half / 2 {
            let angle = -2.0 * PI * i as f64 / half as f64;
            cos.push(angle.cos() as f32);
            sin.push(angle.sin() as f32);
        }

        let mut cos_n = Vec::with_capacity(half);
        let mut sin_n = Vec::with_capacity(half);
        for k in 0..half {
            let angle = -2.0 * PI * k as f64 / n as f64;
            cos_n.push(angle.cos() as f32);
            sin_n.push(angle.sin() as f32);
        }

        let bits = half.trailing_zeros();
        let reverse = (0..half)
            .map(|i| i.reverse_bits() >> (usize::BITS - bits))
            .collect();

        Self { n, half, cos, sin, cos_n, sin_n, reverse }
    }

    pub fn size(&self) -> usize {
        self.n
    }

    pub fn bins(&self) -> usize {
        self.half + 1
    }

    pub fn scratch_len(&self) -> usize {
        self.half * 2
    }

    /// `input`: `n` real samples. `re`/`im`: `n/2 + 1` bins.
    pub fn forward(&self, input: &[f32], re: &mut [f32], im: &mut [f32], scratch: &mut [f32]) {
        let (work_re, work_im) = scratch.split_at_mut(self.half);
        for k in 0..self.half {
            work_re[k] = input[2 * k];
            work_im[k] = input[2 * k + 1];
        }
        self.transform(work_re, work_im, false);

        let mask = self.half - 1;
        for k in 0..self.half {
            let j = (self.half - k) & mask;
            let (ar, ai) = (work_re[k], work_im[k]);
            let (br, bi) = (work_re[j], -work_im[j]); // conj(Z[m - k])
            let even_r = 0.5 * (ar + br);
            let even_i = 0.5 * (ai + bi);
            let odd_r = 0.5 * (ai - bi);
            let odd_i = -0.5 * (ar - br);
            let (wr, wi) = (self.cos_n[k], self.sin_n[k]);
            re[k] = even_r + (odd_r * wr - odd_i * wi);
            im[k] = even_i + (odd_r * wi + odd_i * wr);
        }
        re[self.half] = work_re[0] - work_im[0];
        im[self.half] = 0.0;
    }

    /// `re`/`im`: `n/2 + 1` bins. `output`: `n` real samples, `1/n` included.
    pub fn inverse(&self, re: &[f32], im: &[f32], output: &mut [f32], scratch: &mut [f32]) {
        let (work_re, work_im) = scratch.split_at_mut(self.half);
        for k in 0..self.half {
            // DC and Nyquist are taken as purely real, as numpy and torch do.
            // A predicted (non-physical) spectrum can carry a spurious
            // imaginary part there, and keeping it injects broadband noise.
            let xr = re[k];
            let xi = if k == 0 { 0.0 } else { im[k] };
            let yr = re[self.half - k];
            let yi = if k == 0 { 0.0 } else { -im[self.half - k] };
            let even_r = 0.5 * (xr + yr);
            let even_i = 0.5 * (xi + yi);
            let diff_r = 0.5 * (xr - yr);
            let diff_i = 0.5 * (xi - yi);
            let (wr, wi) = (self.cos_n[k], -self.sin_n[k]); // e^{+2 pi i k / n}
            let odd_r = diff_r * wr - diff_i * wi;
            let odd_i = diff_r * wi + diff_i * wr;
            work_re[k] = even_r - odd_i;
            work_im[k] = even_i + odd_r;
        }
        self.transform(work_re, work_im, true);

        let scale = 1.0 / self.half as f32;
        for k in 0..self.half {
            output[2 * k] = work_re[k] * scale;
            output[2 * k + 1] = work_im[k] * scale;
        }
    }

    /// In-place iterative radix-2 decimation-in-time complex FFT, unscaled.
    fn transform(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        for i in 0..self.half {
            let j = self.reverse[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }

        let mut len = 2;
        while len <= self.half {
            let span = len / 2;
            let step = self.half / len;
            let mut base = 0;
            while base < self.half {
                let mut t = 0;
                for k in 0..span {
                    let wr = self.cos[t];
                    let wi = if inverse { -self.sin[t] } else { self.sin[t] };
                    let (a, b) = (base + k, base + k + span);
                    let (ur, ui) = (re[a], im[a]);
                    let vr = re[b] * wr - im[b] * wi;
                    let vi = re[b] * wi + im[b] * wr;
                    re[a] = ur + vr;
                    im[a] = ui + vi;
                    re[b] = ur - vr;
                    im[b] = ui - vi;
                    t += step;
                }
                base += len;
            }
            len <<= 1;
        }
    }
}
