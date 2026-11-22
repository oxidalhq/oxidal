// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! One error type for the whole crate.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("onnxruntime: {0}")]
    Runtime(#[from] ort::Error),

    #[error("audio: {0}")]
    Audio(#[from] hound::Error),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// The graph is not the one this crate knows how to drive.
    #[error("model: {0}")]
    Model(String),

    /// The caller asked for something the model or the build cannot do.
    #[error("{0}")]
    Unsupported(String),
}

// `ort`'s session builder returns a recoverable error that carries the builder
// back to the caller; we never want it back, so collapse it to the plain one.
impl From<ort::Error<ort::session::builder::SessionBuilder>> for Error {
    fn from(error: ort::Error<ort::session::builder::SessionBuilder>) -> Self {
        Error::Runtime(error.into())
    }
}
