// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! WAV decoding and incremental writing.
//!
//! Everything is exchanged planar -- `[channels][frames]` -- because that is
//! what the model and the spectrogram want. Compressed formats are out of
//! scope on purpose; decode them first
//! (`ffmpeg -i song.mp3 -ar 44100 -ac 2 song.wav`).

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};

use crate::error::Result;
use crate::resample::resample;

/// Planar float32 audio.
#[derive(Debug, Clone, Default)]
pub struct AudioBuffer {
    pub samples: Vec<f32>,
    pub channels: usize,
    pub samplerate: u32,
    pub frames: usize,
}

impl AudioBuffer {
    pub fn new(channels: usize, frames: usize, samplerate: u32) -> Self {
        Self { samples: vec![0.0; channels * frames], channels, samplerate, frames }
    }

    pub fn duration(&self) -> f64 {
        self.frames as f64 / self.samplerate as f64
    }

    pub fn channel(&self, index: usize) -> &[f32] {
        &self.samples[index * self.frames..(index + 1) * self.frames]
    }

    pub fn channel_mut(&mut self, index: usize) -> &mut [f32] {
        let frames = self.frames;
        &mut self.samples[index * frames..(index + 1) * frames]
    }

    /// Keeps only the first `frames` samples of every channel.
    pub fn truncate(&mut self, frames: usize) {
        if frames >= self.frames {
            return;
        }
        let mut trimmed = Vec::with_capacity(self.channels * frames);
        for c in 0..self.channels {
            trimmed.extend_from_slice(&self.channel(c)[..frames]);
        }
        self.samples = trimmed;
        self.frames = frames;
    }
}

/// Decodes a WAV file to planar float32.
pub fn read_wav(path: &Path) -> Result<AudioBuffer> {
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    // hound hands back interleaved samples; scale integers to [-1, 1).
    let interleaved: Vec<f32> = match spec.sample_format {
        SampleFormat::Float => reader.samples::<f32>().collect::<std::result::Result<_, _>>()?,
        SampleFormat::Int => {
            let scale = 1.0 / (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<std::result::Result<_, _>>()?
        }
    };

    let frames = interleaved.len() / channels.max(1);
    let mut buffer = AudioBuffer::new(channels, frames, spec.sample_rate);
    for frame in 0..frames {
        for c in 0..channels {
            buffer.samples[c * frames + frame] = interleaved[frame * channels + c];
        }
    }
    Ok(buffer)
}

/// Folds or duplicates channels to reach exactly `channels`.
pub fn remix(input: AudioBuffer, channels: usize) -> AudioBuffer {
    if input.channels == channels {
        return input;
    }
    let mut out = AudioBuffer::new(channels, input.frames, input.samplerate);
    if input.channels == 1 {
        for c in 0..channels {
            out.channel_mut(c).copy_from_slice(input.channel(0));
        }
    } else if channels == 1 {
        let scale = 1.0 / input.channels as f32;
        for c in 0..input.channels {
            for (dst, src) in out.channel_mut(0).iter_mut().zip(input.channel(c)) {
                *dst += src * scale;
            }
        }
    } else {
        for c in 0..channels {
            let source = c.min(input.channels - 1);
            out.channel_mut(c).copy_from_slice(input.channel(source));
        }
    }
    out
}

/// Decode, resample and remix in one step.
pub fn load(path: &Path, samplerate: u32, channels: usize) -> Result<AudioBuffer> {
    Ok(remix(resample(read_wav(path)?, samplerate), channels))
}

/// Output sample format for the stem files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Float32,
    Int16,
    Int24,
}

impl OutputFormat {
    fn spec(self, samplerate: u32, channels: usize) -> WavSpec {
        let (bits, format) = match self {
            OutputFormat::Float32 => (32, SampleFormat::Float),
            OutputFormat::Int24 => (24, SampleFormat::Int),
            OutputFormat::Int16 => (16, SampleFormat::Int),
        };
        WavSpec {
            channels: channels as u16,
            sample_rate: samplerate,
            bits_per_sample: bits,
            sample_format: format,
        }
    }
}

/// Incremental writer: the separator finalises its output front-to-back, so
/// stems can be written as they are produced.
pub struct StemWriter {
    writers: Vec<WavWriter<BufWriter<File>>>,
    paths: Vec<std::path::PathBuf>,
    channels: usize,
    format: OutputFormat,
}

impl StemWriter {
    pub fn create(directory: &Path, names: &[String], samplerate: u32, channels: usize,
                  format: OutputFormat) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let spec = format.spec(samplerate, channels);
        let mut writers = Vec::with_capacity(names.len());
        let mut paths = Vec::with_capacity(names.len());
        for name in names {
            let path = directory.join(format!("{name}.wav"));
            writers.push(WavWriter::create(&path, spec)?);
            paths.push(path);
        }
        Ok(Self { writers, paths, channels, format })
    }

    pub fn paths(&self) -> &[std::path::PathBuf] {
        &self.paths
    }

    /// `block` is `[stems][channels][count]`, planar.
    pub fn write(&mut self, block: &[f32], count: usize) -> Result<()> {
        let stride = self.channels * count;
        for (index, writer) in self.writers.iter_mut().enumerate() {
            let stem = &block[index * stride..(index + 1) * stride];
            write_planar(writer, stem, self.channels, count, self.format)?;
        }
        Ok(())
    }

    /// Writes one already-folded stem to file `index`.
    pub fn write_one(&mut self, index: usize, stem: &[f32], count: usize) -> Result<()> {
        write_planar(&mut self.writers[index], stem, self.channels, count, self.format)
    }

    pub fn finish(self) -> Result<()> {
        for writer in self.writers {
            writer.finalize()?;
        }
        Ok(())
    }
}

fn write_planar(writer: &mut WavWriter<BufWriter<File>>, stem: &[f32], channels: usize,
                count: usize, format: OutputFormat) -> Result<()> {
    for frame in 0..count {
        for c in 0..channels {
            let value = stem[c * count + frame];
            match format {
                OutputFormat::Float32 => writer.write_sample(value)?,
                OutputFormat::Int24 => {
                    writer.write_sample((value.clamp(-1.0, 1.0) * 8_388_607.0) as i32)?
                }
                OutputFormat::Int16 => {
                    writer.write_sample((value.clamp(-1.0, 1.0) * 32_767.0) as i16)?
                }
            }
        }
    }
    Ok(())
}
