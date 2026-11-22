// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! The complex half of HTDemucs, which ONNX cannot express.
//!
//! `torch.stft` / `torch.istft` have no ONNX equivalent -- there is no ISTFT
//! operator at all -- so the exported graph is cut at the complex boundary and
//! the spectrogram lives here. This reproduces `HTDemucs._spec` /
//! `HTDemucs._ispec`, padding quirks included:
//!
//! * `_spec`: reflect-pad by `3*hop/2`, STFT (Hann periodic, normalised,
//!   centred), drop the Nyquist bin, drop two frames at each end;
//! * `_ispec`: put that bin and those frames back, ISTFT, trim.
//!
//! Spectrograms use the "channels as complex" layout the model was trained
//! with: plane `2c` is the real part of channel `c`, plane `2c+1` the imaginary
//! part.

use rayon::prelude::*;

use crate::fft::{RealFft, PI};

/// `torch.hann_window(n)` -- periodic, not the symmetric variant.
pub fn hann_periodic(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| (0.5 * (1.0 - (2.0 * PI * i as f64 / n as f64).cos())) as f32)
        .collect()
}

/// numpy/torch `reflect` padding: `out[-1] == in[1]`, `out[len] == in[len - 2]`.
pub fn reflect_pad(input: &[f32], left: usize, right: usize, out: &mut [f32]) {
    let n = input.len();
    for i in 0..left {
        out[i] = input[left - i];
    }
    out[left..left + n].copy_from_slice(input);
    for i in 0..right {
        out[left + n + i] = input[n - 2 - i];
    }
}

struct Scratch {
    windowed: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    fft: Vec<f32>,
    accumulator: Vec<f32>,
}

pub struct Spectrogram {
    nfft: usize,
    hop: usize,
    channels: usize,
    length: usize,
    freq_bins: usize,
    frames: usize,
    pad: usize,
    right_pad: usize,
    padded: usize,
    centred: usize,
    total_samples: usize,
    trim: usize,
    forward_scale: f32,
    inverse_scale: f32,
    window: Vec<f32>,
    envelope: Vec<f32>,
    fft: RealFft,
}

impl Spectrogram {
    pub fn new(nfft: usize, hop: usize, channels: usize, length: usize) -> Self {
        assert!(nfft % hop == 0, "nfft must be a multiple of hop");

        let freq_bins = nfft / 2; // the Nyquist bin is dropped
        let frames = length.div_ceil(hop); // demucs' `le`
        let pad = hop / 2 * 3;
        let right_pad = pad + frames * hop - length;
        let padded = length + pad + right_pad;
        let centred = padded + nfft;
        let total_frames = 1 + padded / hop; // == frames + 4
        let total_samples = nfft + hop * (total_frames - 1);
        let blocks = nfft / hop;

        let window = hann_periodic(nfft);

        // Overlap-add envelope of the squared window; the ISTFT divides by it.
        // Because the hop divides the FFT size, frame `t` covers output blocks
        // `t..t+blocks`, so this is a handful of strided adds.
        let mut envelope = vec![0f32; total_samples];
        for k in 0..blocks {
            for t in 0..total_frames {
                let at = (t + k) * hop;
                for j in 0..hop {
                    envelope[at + j] += window[k * hop + j] * window[k * hop + j];
                }
            }
        }

        Self {
            nfft,
            hop,
            channels,
            length,
            freq_bins,
            frames,
            pad,
            right_pad,
            padded,
            centred,
            total_samples,
            trim: nfft / 2 + pad,
            forward_scale: 1.0 / (nfft as f32).sqrt(),
            inverse_scale: (nfft as f32).sqrt(),
            window,
            envelope,
            fft: RealFft::new(nfft),
        }
    }

    pub fn freq_bins(&self) -> usize {
        self.freq_bins
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    pub fn length(&self) -> usize {
        self.length
    }

    /// Number of floats one batch item occupies in a spectrogram buffer.
    pub fn spec_stride(&self) -> usize {
        2 * self.channels * self.freq_bins * self.frames
    }

    fn scratch(&self) -> Scratch {
        Scratch {
            windowed: vec![0.0; self.nfft],
            re: vec![0.0; self.freq_bins + 1],
            im: vec![0.0; self.freq_bins + 1],
            fft: vec![0.0; self.fft.scratch_len()],
            accumulator: vec![0.0; self.total_samples],
        }
    }

    /// `mix`: `[batch][channels][length]` -> `out`: `[batch][2*channels][F][T]`.
    pub fn forward(&self, mix: &[f32], batch: usize, out: &mut [f32]) {
        let planes = batch * self.channels;
        assert_eq!(mix.len(), planes * self.length);
        assert_eq!(out.len(), planes * 2 * self.freq_bins * self.frames);

        let mut centred = vec![0f32; planes * self.centred];
        centred
            .par_chunks_mut(self.centred)
            .zip(mix.par_chunks(self.length))
            .for_each(|(dst, src)| {
                let mut inner = vec![0f32; self.padded];
                reflect_pad(src, self.pad, self.right_pad, &mut inner);
                reflect_pad(&inner, self.nfft / 2, self.nfft / 2, dst);
            });

        // Transform frame by frame into a frame-major staging buffer, then
        // transpose. Writing straight into the strided [F][T] layout would
        // hand every worker an interleaved slice of the same output.
        let row = 2 * self.freq_bins;
        let mut staging = vec![0f32; planes * self.frames * row];
        staging
            .par_chunks_mut(row)
            .enumerate()
            .for_each_init(|| self.scratch(), |scratch, (index, dst)| {
                let plane = index / self.frames;
                let frame = index % self.frames;
                let at = plane * self.centred + (frame + 2) * self.hop;
                for j in 0..self.nfft {
                    scratch.windowed[j] = centred[at + j] * self.window[j];
                }
                self.fft.forward(&scratch.windowed, &mut scratch.re, &mut scratch.im,
                                 &mut scratch.fft);
                for f in 0..self.freq_bins {
                    dst[f] = scratch.re[f] * self.forward_scale;
                    dst[self.freq_bins + f] = scratch.im[f] * self.forward_scale;
                }
            });

        out.par_chunks_mut(2 * self.freq_bins * self.frames)
            .enumerate()
            .for_each(|(plane, dst)| {
                let base = plane * self.frames * row;
                for frame in 0..self.frames {
                    let src = &staging[base + frame * row..base + (frame + 1) * row];
                    for f in 0..self.freq_bins {
                        dst[f * self.frames + frame] = src[f];
                        dst[(self.freq_bins + f) * self.frames + frame] =
                            src[self.freq_bins + f];
                    }
                }
            });
    }

    /// `spec`: `[items][2*channels][F][T]` -> `out`: `[items][channels][length]`.
    pub fn inverse(&self, spec: &[f32], items: usize, out: &mut [f32]) {
        let planes = items * self.channels;
        assert_eq!(spec.len(), planes * 2 * self.freq_bins * self.frames);
        assert_eq!(out.len(), planes * self.length);

        let plane_size = self.freq_bins * self.frames;
        out.par_chunks_mut(self.length)
            .enumerate()
            .for_each_init(|| self.scratch(), |scratch, (plane, dst)| {
                scratch.accumulator.iter_mut().for_each(|v| *v = 0.0);
                let base = 2 * plane * plane_size;

                // The dropped Nyquist bin stays zero for every frame.
                scratch.re[self.freq_bins] = 0.0;
                scratch.im[self.freq_bins] = 0.0;

                for frame in 0..self.frames {
                    for f in 0..self.freq_bins {
                        scratch.re[f] = spec[base + f * self.frames + frame];
                        scratch.im[f] = spec[base + plane_size + f * self.frames + frame];
                    }
                    self.fft.inverse(&scratch.re, &scratch.im, &mut scratch.windowed,
                                     &mut scratch.fft);
                    let at = (frame + 2) * self.hop; // two empty frames were prepended
                    for j in 0..self.nfft {
                        scratch.accumulator[at + j] +=
                            scratch.windowed[j] * self.inverse_scale * self.window[j];
                    }
                }

                for i in 0..self.length {
                    dst[i] = scratch.accumulator[self.trim + i] / self.envelope[self.trim + i];
                }
            });
    }
}
