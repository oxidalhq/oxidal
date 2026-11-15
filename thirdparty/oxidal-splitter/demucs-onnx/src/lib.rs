// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Demucs v4 (HTDemucs) music source separation on ONNX Runtime.
//!
//! No PyTorch at inference time: the conv/transformer network runs inside ONNX
//! Runtime, while the complex-valued STFT/ISTFT and the overlap-add chunking
//! are done here.
//!
//! ```no_run
//! use std::path::Path;
//! use demucs_onnx::{Device, Separator, SeparatorOptions};
//!
//! let mut options = SeparatorOptions::default();
//! options.session.device = Device::Cuda;
//! options.batch = 4;
//!
//! let mut separator = Separator::new(Path::new("models/htdemucs.onnx"), options)?;
//! let audio = demucs_onnx::audio::load(
//!     Path::new("song.wav"),
//!     separator.config().samplerate,
//!     separator.config().channels,
//! )?;
//!
//! let stems = separator.separate_to_vec(&audio.samples, audio.frames)?;
//! # Ok::<(), demucs_onnx::Error>(())
//! ```

pub mod audio;
pub mod config;
pub mod error;
pub mod fft;
pub mod overlap;
pub mod resample;
pub mod separator;
pub mod session;
pub mod stft;

pub use config::ModelConfig;
pub use error::{Error, Result};
pub use separator::{Benchmark, Separator, SeparatorOptions};
pub use session::{available_devices, Device, SessionConfig};
pub use stft::Spectrogram;
