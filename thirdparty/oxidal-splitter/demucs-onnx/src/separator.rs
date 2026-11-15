// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Chunked separation on top of the exported graph.
//!
//! The chunk offsets, the triangular cross-fade and the global normalisation
//! are demucs' own, so the output matches `apply_model(split=True, shifts=0)`.
//! What differs is the scheduling:
//!
//! * consecutive chunks are batched into one inference call, which is what
//!   keeps a GPU busy -- upstream demucs feeds chunks one at a time;
//! * the spectrogram of the next batch is built on a worker thread while the
//!   current batch is in the network;
//! * output is finalised front-to-back and streamed out, so peak memory does
//!   not grow with track length.
//!
//! Bags of models (`htdemucs_ft`, `mdx`, `mdx_extra`, ...) are handled here
//! too: every member sees the same chunk, and their `spec` and `wav` outputs
//! are blended with the manifest's per-stem weights before the single ISTFT.
//! Upstream instead runs each member over the whole track and adds up the
//! finished stems; the results agree because the ISTFT, the cross-fade and the
//! denormalisation are all linear, and this way the expensive half is done once.

use std::path::Path;
use std::time::Instant;

use ort::session::Session;
use ort::value::TensorRef;

use crate::config::{mixing_matrix, resolve_model, ModelConfig};
use crate::error::{Error, Result};
use crate::overlap::{transition_weight, OverlapAdd};
use crate::session::{create_session, Device, SessionConfig};
use crate::stft::Spectrogram;

#[derive(Debug, Clone)]
pub struct SeparatorOptions {
    pub session: SessionConfig,
    /// Chunks per inference call; 0 means 1 on CPU and 4 on an accelerator.
    pub batch: usize,
    /// demucs' default is 0.25. Lower is faster and slightly rougher at the seams.
    pub overlap: f32,
    pub transition_power: f32,
    /// Overlap spectrogram work with inference.
    pub pipeline: bool,
}

impl Default for SeparatorOptions {
    fn default() -> Self {
        Self {
            session: SessionConfig::default(),
            batch: 0,
            overlap: 0.25,
            transition_power: 1.0,
            pipeline: true,
        }
    }
}

/// One chunk's place in the track.
#[derive(Debug, Clone, Copy)]
struct Chunk {
    /// Absolute position in the track.
    offset: usize,
    /// Useful samples; shorter than a segment only for the last chunk.
    length: usize,
    /// Samples to drop from the front of the model output.
    trim: usize,
}

/// One batch's inputs, filled ahead of the inference call that consumes them.
struct Frame {
    mix: Vec<f32>,
    mag: Vec<f32>,
    chunks: Vec<Chunk>,
}

impl Frame {
    fn new(batch: usize, config: &ModelConfig) -> Self {
        Self {
            mix: vec![0.0; batch * config.channels * config.segment],
            mag: vec![0.0; batch * 2 * config.channels * config.freq_bins * config.frames],
            chunks: Vec::with_capacity(batch),
        }
    }
}

/// Timing report from [`Separator::benchmark`].
#[derive(Debug, Clone)]
pub struct Benchmark {
    pub device: Device,
    pub batch: usize,
    /// How many networks each chunk went through.
    pub models: usize,
    pub audio_seconds: f64,
    pub elapsed: f64,
    pub realtime_factor: f64,
}

pub struct Separator {
    sessions: Vec<Session>,
    config: ModelConfig,
    spectro: Spectrogram,
    device: Device,
    batch: usize,
    overlap: f32,
    pipeline: bool,
    weight: Vec<f32>,
    /// Row-major `[model][source]` blend weights; `None` unless this is a bag.
    mixing: Option<Vec<f32>>,
}

impl Separator {
    pub fn new(model_path: &Path, options: SeparatorOptions) -> Result<Self> {
        let bundle = resolve_model(model_path)?;
        let mut sessions = Vec::with_capacity(bundle.members.len());
        let mut device = Device::Cpu;
        for member in &bundle.members {
            let (session, chosen) = create_session(&member.path, &options.session)?;
            sessions.push(session);
            device = chosen;
        }

        let session = &sessions[0];
        if session.inputs().len() != 2 || session.outputs().len() != 2 {
            return Err(Error::Model("expected a 2-in/2-out graph".into()));
        }
        let input_names =
            [session.inputs()[0].name().to_owned(), session.inputs()[1].name().to_owned()];
        let output_names =
            [session.outputs()[0].name().to_owned(), session.outputs()[1].name().to_owned()];

        let mix = tensor_shape(session.inputs()[0].dtype())?;
        let mag = tensor_shape(session.inputs()[1].dtype())?;
        let spec = tensor_shape(session.outputs()[0].dtype())?;

        // Every member of a bag is fed the same tensors and read back the same way,
        // so they have to agree on their shapes and on their tensor names.
        for (member, other) in bundle.members.iter().zip(&sessions).skip(1) {
            if tensor_shape(other.inputs()[1].dtype())? != mag
                || other.inputs()[0].name() != input_names[0]
                || other.outputs()[0].name() != output_names[0]
            {
                return Err(Error::Model(format!(
                    "{} does not match the first model in the bag",
                    member.path.display()
                )));
            }
        }

        let mut config = ModelConfig::from_graph(
            &bundle.members[0].path, &mix, &mag, &spec, input_names, output_names)?;
        config.name = bundle.name.clone();
        let mixing = mixing_matrix(&bundle, config.num_sources())?;

        let batch = match options.batch {
            0 if device == Device::Cpu => 1,
            0 => 4,
            n => n,
        };
        if batch > 1 && !config.dynamic_batch {
            return Err(Error::Unsupported(
                "this graph has a fixed batch of 1; re-export it with tools/export_onnx.py, \
                 which enables a dynamic batch axis"
                    .into(),
            ));
        }

        let spectro =
            Spectrogram::new(config.nfft, config.hop, config.channels, config.segment);
        if spectro.frames() != config.frames {
            return Err(Error::Model(format!(
                "the STFT produces {} frames but the graph expects {}",
                spectro.frames(),
                config.frames
            )));
        }

        let weight = transition_weight(config.segment, options.transition_power);
        Ok(Self {
            sessions,
            config,
            spectro,
            device,
            batch,
            overlap: options.overlap,
            pipeline: options.pipeline,
            weight,
            mixing,
        })
    }

    pub fn config(&self) -> &ModelConfig {
        &self.config
    }

    pub fn device(&self) -> Device {
        self.device
    }

    pub fn batch(&self) -> usize {
        self.batch
    }

    /// How many networks each chunk goes through.
    pub fn models(&self) -> usize {
        self.sessions.len()
    }

    /// Separates planar `[channels][samples]` audio.
    ///
    /// `sink` is called as `sink(offset, count, block)` where `block` is
    /// `[sources][channels][count]`, planar. Spans arrive in order, are
    /// contiguous and never overlap. `progress` gets `(done, total)` chunk
    /// counts.
    pub fn separate<S, P>(&mut self, mix: &[f32], samples: usize, mut sink: S,
                          mut progress: P) -> Result<()>
    where
        S: FnMut(usize, usize, &[f32]) -> Result<()>,
        P: FnMut(usize, usize),
    {
        if samples == 0 {
            return Ok(());
        }
        let sources = self.config.num_sources();
        let channels = self.config.channels;
        let segment = self.config.segment;
        let (mean, gain) = reference_stats(mix, samples, channels);

        let stride = (((1.0 - self.overlap) * segment as f32) as usize).max(1);
        let chunks = samples.div_ceil(stride);
        let groups = chunks.div_ceil(self.batch);

        // Borrow the fields separately so the spectrogram (shared) and the
        // session (exclusive) can be used by the two halves of the pipeline.
        let config = &self.config;
        let spectro = &self.spectro;
        let sessions = &mut self.sessions;
        let mixing = self.mixing.as_deref();
        let weight = &self.weight;
        let batch = self.batch;
        let pipeline = self.pipeline;

        let mut frames = [Frame::new(batch, config), Frame::new(batch, config)];
        let mut accumulator = OverlapAdd::new(sources * channels, segment + (batch - 1) * stride);
        let mut stems = vec![0f32; batch * sources * channels * segment];
        let mut ready: Vec<f32> = Vec::new();
        // Only a bag needs somewhere to accumulate; a single graph writes straight
        // through to the ISTFT.
        let mut blend = Blend::new(mixing.is_some(), batch, config);

        fill_frame(&mut frames[0], 0, batch, stride, mix, samples, mean, gain, config, spectro);

        for group in 0..groups {
            let (head, tail) = frames.split_at_mut(1);
            let (current, next) = if group % 2 == 0 {
                (&mut head[0], &mut tail[0])
            } else {
                (&mut tail[0], &mut head[0])
            };

            let count = current.chunks.len();
            let planes = count * sources * channels;
            let stems = &mut stems[..planes * segment];

            let build_next = |frame: &mut Frame| {
                if group + 1 < groups {
                    fill_frame(frame, group + 1, batch, stride, mix, samples, mean, gain,
                               config, spectro);
                }
            };
            let mut run = |sessions: &mut [Session], stems: &mut [f32]| -> Result<()> {
                infer(sessions, mixing, &mut blend, config, spectro, current, count, stems,
                      group == 0)
            };

            // join() runs the first closure here and may steal the second, so
            // the network goes on this thread and the next spectrogram is what
            // gets handed off.
            let outcome = if pipeline {
                let (outcome, ()) = rayon::join(|| run(sessions, stems), || build_next(next));
                outcome
            } else {
                let outcome = run(sessions, stems);
                build_next(next);
                outcome
            };
            outcome?;

            for (index, chunk) in current.chunks.iter().enumerate() {
                let base = index * sources * channels * segment + chunk.trim;
                accumulator.add(chunk.offset, &stems[base..], segment, chunk.length, weight);
            }

            let last = current.chunks.last().expect("a group always has a chunk");
            let upto = samples.min(last.offset + stride);
            let flushed = accumulator.flush(upto, &mut ready);
            if flushed > 0 {
                for value in ready.iter_mut() {
                    *value = *value * gain + mean;
                }
                sink(accumulator.base() - flushed, flushed, &ready)?;
            }
            progress(chunks.min((group + 1) * batch), chunks);
        }
        Ok(())
    }

    /// Convenience wrapper that keeps the whole result in memory, laid out as
    /// `[sources][channels][samples]`.
    pub fn separate_to_vec(&mut self, mix: &[f32], samples: usize) -> Result<Vec<f32>> {
        let planes = self.config.num_sources() * self.config.channels;
        let mut out = vec![0f32; planes * samples];
        self.separate(
            mix,
            samples,
            |offset, count, block| {
                for plane in 0..planes {
                    let src = &block[plane * count..(plane + 1) * count];
                    out[plane * samples + offset..plane * samples + offset + count]
                        .copy_from_slice(src);
                }
                Ok(())
            },
            |_, _| {},
        )?;
        Ok(out)
    }

    /// Times the full pipeline on synthetic audio.
    pub fn benchmark(&mut self, seconds: f64) -> Result<Benchmark> {
        let channels = self.config.channels;
        let frames = (seconds * self.config.samplerate as f64) as usize;

        // A cheap deterministic noise source; the content does not matter, only
        // that it is not silence.
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        let noise: Vec<f32> = (0..channels * frames)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                // 24 random bits mapped to a quiet [-0.05, 0.05).
                ((state >> 40) as f32 / 8_388_608.0 - 1.0) * 0.05
            })
            .collect();

        // One warm-up chunk so the measured run is not paying for lazy kernel
        // selection or an engine build.
        self.separate(&noise[..channels * self.config.segment], self.config.segment,
                      |_, _, _| Ok(()), |_, _| {})?;

        let started = Instant::now();
        self.separate(&noise, frames, |_, _, _| Ok(()), |_, _| {})?;
        let elapsed = started.elapsed().as_secs_f64();

        Ok(Benchmark {
            device: self.device,
            batch: self.batch,
            models: self.sessions.len(),
            audio_seconds: seconds,
            elapsed,
            realtime_factor: seconds / elapsed,
        })
    }
}

/// demucs normalises by the mean and standard deviation of the mono downmix of
/// the whole track.
fn reference_stats(mix: &[f32], samples: usize, channels: usize) -> (f32, f32) {
    let mut sum = 0.0f64;
    let mut sum_squares = 0.0f64;
    for i in 0..samples {
        let mut value = 0.0f64;
        for c in 0..channels {
            value += mix[c * samples + i] as f64;
        }
        value /= channels as f64;
        sum += value;
        sum_squares += value * value;
    }
    let mean = sum / samples as f64;
    let variance = (sum_squares / samples as f64 - mean * mean).max(0.0);
    (mean as f32, variance.sqrt() as f32 + 1e-8)
}

#[allow(clippy::too_many_arguments)]
fn fill_frame(frame: &mut Frame, group: usize, batch: usize, stride: usize, mix: &[f32],
              samples: usize, mean: f32, gain: f32, config: &ModelConfig,
              spectro: &Spectrogram) {
    let channels = config.channels;
    let segment = config.segment;

    frame.chunks.clear();
    frame.mix.fill(0.0);

    for slot in 0..batch {
        let offset = (group * batch + slot) * stride;
        if offset >= samples {
            break;
        }
        let length = (samples - offset).min(segment);
        let delta = segment - length;
        // Short chunks are centred, exactly as demucs does it, which is why
        // `start` may fall before the track and `at` shifts the copy.
        let start = offset as isize - (delta / 2) as isize;
        let from = start.max(0) as usize;
        let to = (start + segment as isize).min(samples as isize).max(0) as usize;
        let at = (from as isize - start) as usize;

        for c in 0..channels {
            let base = (slot * channels + c) * segment + at;
            let src = &mix[c * samples + from..c * samples + to];
            for (i, value) in src.iter().enumerate() {
                frame.mix[base + i] = (value - mean) / gain;
            }
        }
        frame.chunks.push(Chunk { offset, length, trim: delta / 2 });
    }

    let count = frame.chunks.len();
    let mix_len = count * channels * segment;
    let mag_len = count * 2 * channels * config.freq_bins * config.frames;
    spectro.forward(&frame.mix[..mix_len], count, &mut frame.mag[..mag_len]);
}

/// Where a bag's members are summed before the single ISTFT. Empty for a lone graph.
struct Blend {
    spec: Vec<f32>,
    wav: Vec<f32>,
}

impl Blend {
    fn new(needed: bool, batch: usize, config: &ModelConfig) -> Self {
        if !needed {
            return Self { spec: Vec::new(), wav: Vec::new() };
        }
        let planes = batch * config.num_sources() * config.channels;
        Self {
            spec: vec![0.0; planes * 2 * config.freq_bins * config.frames],
            wav: vec![0.0; planes * config.segment],
        }
    }
}

/// `out[b][s] += weight[s] * part[b][s]`, over `plane` values per stem.
fn accumulate(out: &mut [f32], part: &[f32], weights: &[f32], count: usize, plane: usize,
              overwrite: bool) {
    for (index, block) in out[..count * weights.len() * plane]
        .chunks_exact_mut(plane)
        .enumerate()
    {
        let weight = weights[index % weights.len()];
        let source = &part[index * plane..(index + 1) * plane];
        if overwrite {
            for (target, value) in block.iter_mut().zip(source) {
                *target = weight * value;
            }
        } else if weight != 0.0 {
            for (target, value) in block.iter_mut().zip(source) {
                *target += weight * value;
            }
        }
    }
}

/// Runs one graph and hands back its two output tensors.
fn forward<'a>(session: &'a mut Session, config: &ModelConfig, frame: &Frame, count: usize)
    -> Result<ort::session::SessionOutputs<'a>> {
    let channels = config.channels;
    let segment = config.segment;

    let mix_shape = [count as i64, channels as i64, segment as i64];
    let mag_shape = [
        count as i64,
        2 * channels as i64,
        config.freq_bins as i64,
        config.frames as i64,
    ];
    let mix = TensorRef::from_array_view((mix_shape, &frame.mix[..count * channels * segment]))?;
    let mag = TensorRef::from_array_view((
        mag_shape,
        &frame.mag[..count * 2 * channels * config.freq_bins * config.frames],
    ))?;

    Ok(session.run(ort::inputs![
        config.input_names[0].as_str() => mix,
        config.input_names[1].as_str() => mag,
    ])?)
}

/// A provider that overflows -- TensorRT asked for fp16 on this model is the known
/// case -- returns NaN for every sample, and the only symptom downstream is a file
/// full of silence. Checked on the first batch only.
fn check_finite(values: &[f32], name: &str) -> Result<()> {
    match values.iter().position(|value| !value.is_finite()) {
        None => Ok(()),
        Some(bad) => Err(Error::Model(format!(
            "the network returned a non-finite '{name}' (at index {bad}). Half precision              overflows on this model with some providers; use the fp32 graph, or the              fp16 one from export_onnx.py --fp16 rather than asking the provider to convert"
        ))),
    }
}

/// One inference call per member, the blend, and the ISTFT of the spectral branch.
#[allow(clippy::too_many_arguments)]
fn infer(sessions: &mut [Session], mixing: Option<&[f32]>, blend: &mut Blend,
         config: &ModelConfig, spectro: &Spectrogram, frame: &Frame, count: usize,
         stems: &mut [f32], first_batch: bool) -> Result<()> {
    let channels = config.channels;
    let sources = config.num_sources();
    let expected = count * sources * 2 * channels * config.freq_bins * config.frames;

    let Some(mixing) = mixing else {
        let outputs = forward(&mut sessions[0], config, frame, count)?;
        let (_, spec) = outputs[config.output_names[0].as_str()].try_extract_tensor::<f32>()?;
        let (_, wav) = outputs[config.output_names[1].as_str()].try_extract_tensor::<f32>()?;
        if first_batch {
            check_finite(spec, &config.output_names[0])?;
        }
        return finish(spec, wav, expected, sources, config, spectro, count, stems);
    };

    let spec_plane = 2 * channels * config.freq_bins * config.frames;
    let wav_plane = channels * config.segment;
    let mut written = false;
    for (model, session) in sessions.iter_mut().enumerate() {
        let weights = &mixing[model * sources..(model + 1) * sources];
        if weights.iter().all(|w| *w == 0.0) {
            continue;                       // this member owns none of the stems
        }
        let outputs = forward(session, config, frame, count)?;
        let (_, spec) = outputs[config.output_names[0].as_str()].try_extract_tensor::<f32>()?;
        let (_, wav) = outputs[config.output_names[1].as_str()].try_extract_tensor::<f32>()?;
        if first_batch {
            check_finite(spec, &config.output_names[0])?;
        }
        check_size(spec, expected, sources, config)?;
        accumulate(&mut blend.spec, spec, weights, count, spec_plane, !written);
        accumulate(&mut blend.wav, wav, weights, count, wav_plane, !written);
        written = true;
    }

    // The buffers are sized for a full batch; the last group is usually shorter.
    let spec = std::mem::take(&mut blend.spec);
    let wav = std::mem::take(&mut blend.wav);
    let outcome = finish(&spec[..expected], &wav[..count * sources * wav_plane], expected,
                         sources, config, spectro, count, stems);
    blend.spec = spec;
    blend.wav = wav;
    outcome
}

/// The graph declares its outputs symbolically, so this is the first point at which
/// the stem count can actually be checked against what the network produced.
fn check_size(spec: &[f32], expected: usize, sources: usize, config: &ModelConfig)
    -> Result<()> {
    if spec.len() == expected {
        return Ok(());
    }
    Err(Error::Model(format!(
        "'{}' holds {} values, expected {expected} for {sources} stems;          the sidecar and the graph disagree",
        config.output_names[0],
        spec.len()
    )))
}

/// ISTFT of the spectral branch, plus the waveform branch.
#[allow(clippy::too_many_arguments)]
fn finish(spec: &[f32], wav: &[f32], expected: usize, sources: usize, config: &ModelConfig,
          spectro: &Spectrogram, count: usize, stems: &mut [f32]) -> Result<()> {
    check_size(spec, expected, sources, config)?;
    spectro.inverse(spec, count * sources, stems);
    // The network splits its prediction between a spectral and a waveform
    // branch; the stem is the sum of the two.
    for (stem, value) in stems.iter_mut().zip(wav) {
        *stem += value;
    }
    Ok(())
}

fn tensor_shape(value: &ort::value::ValueType) -> Result<Vec<i64>> {
    match value {
        ort::value::ValueType::Tensor { shape, .. } => Ok(shape.iter().copied().collect()),
        other => Err(Error::Model(format!("expected a tensor, got {other:?}"))),
    }
}
