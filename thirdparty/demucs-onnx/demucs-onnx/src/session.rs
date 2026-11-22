// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! ONNX Runtime session construction and execution-provider selection.
//!
//! Accelerators are cargo features, because `ort` only compiles the provider
//! bindings you ask for: build with `--features cuda`, `--features tensorrt`,
//! `--features directml`, `--features coreml` or `--features rocm`. A provider
//! that is not compiled in simply reports itself as unavailable.

use std::fmt;
use std::path::Path;
use std::str::FromStr;

#[allow(unused_imports)]
use ort::ep::ExecutionProvider;
use ort::ep::{ExecutionProviderDispatch, CPU};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Device {
    #[default]
    Auto,
    Cpu,
    Cuda,
    TensorRt,
    DirectMl,
    CoreMl,
    Rocm,
}

impl Device {
    pub fn as_str(self) -> &'static str {
        match self {
            Device::Auto => "auto",
            Device::Cpu => "cpu",
            Device::Cuda => "cuda",
            Device::TensorRt => "tensorrt",
            Device::DirectMl => "directml",
            Device::CoreMl => "coreml",
            Device::Rocm => "rocm",
        }
    }

    /// Whether this build has the provider *and* the loaded runtime supports it.
    pub fn is_available(self) -> bool {
        match self {
            Device::Auto | Device::Cpu => true,
            #[cfg(feature = "cuda")]
            Device::Cuda => ort::ep::CUDA::default().is_available().unwrap_or(false),
            #[cfg(feature = "tensorrt")]
            Device::TensorRt => ort::ep::TensorRT::default().is_available().unwrap_or(false),
            #[cfg(feature = "directml")]
            Device::DirectMl => ort::ep::DirectML::default().is_available().unwrap_or(false),
            #[cfg(feature = "coreml")]
            Device::CoreMl => ort::ep::CoreML::default().is_available().unwrap_or(false),
            #[cfg(feature = "rocm")]
            Device::Rocm => ort::ep::ROCm::default().is_available().unwrap_or(false),
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }
}

impl fmt::Display for Device {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Device {
    type Err = Error;

    fn from_str(text: &str) -> Result<Self> {
        Ok(match text.to_ascii_lowercase().as_str() {
            "auto" => Device::Auto,
            "cpu" => Device::Cpu,
            "cuda" => Device::Cuda,
            "tensorrt" | "trt" => Device::TensorRt,
            "directml" | "dml" => Device::DirectMl,
            "coreml" => Device::CoreMl,
            "rocm" => Device::Rocm,
            other => return Err(Error::Unsupported(format!("unknown device '{other}'"))),
        })
    }
}

/// Order in which [`Device::Auto`] prefers accelerators.
const AUTO_ORDER: [Device; 5] =
    [Device::TensorRt, Device::Cuda, Device::Rocm, Device::DirectMl, Device::CoreMl];

/// Devices this build can actually use, best first. CPU is always last and
/// always present.
pub fn available_devices() -> Vec<Device> {
    let mut devices: Vec<Device> = AUTO_ORDER.into_iter().filter(|d| d.is_available()).collect();
    devices.push(Device::Cpu);
    devices
}

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub device: Device,
    pub device_id: i32,
    /// Intra-op threads; 0 leaves it to ONNX Runtime (all cores).
    pub threads: usize,
    /// Ask TensorRT for half precision.
    pub fp16: bool,
    /// TensorRT engine cache directory.
    pub cache_dir: Option<String>,
    pub verbose: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            device: Device::Auto,
            device_id: 0,
            threads: 0,
            fp16: false,
            cache_dir: None,
            verbose: false,
        }
    }
}

#[allow(unused_variables)]
fn dispatch(device: Device, config: &SessionConfig) -> Option<ExecutionProviderDispatch> {
    match device {
        #[cfg(feature = "cuda")]
        Device::Cuda => Some(
            ort::ep::CUDA::default()
                .with_device_id(config.device_id)
                // Every chunk has identical shapes, so paying once for an
                // exhaustive convolution search is repaid from chunk two on.
                .with_conv_algorithm_search(ort::ep::cuda::ConvAlgorithmSearch::Exhaustive)
                .build(),
        ),
        #[cfg(feature = "tensorrt")]
        Device::TensorRt => {
            let mut provider = ort::ep::TensorRT::default()
                .with_device_id(config.device_id)
                .with_fp16(config.fp16);
            if let Some(dir) = &config.cache_dir {
                provider = provider.with_engine_cache(true).with_engine_cache_path(dir);
            }
            Some(provider.build())
        }
        #[cfg(feature = "directml")]
        Device::DirectMl => {
            Some(ort::ep::DirectML::default().with_device_id(config.device_id).build())
        }
        #[cfg(feature = "coreml")]
        Device::CoreMl => Some(ort::ep::CoreML::default().build()),
        #[cfg(feature = "rocm")]
        Device::Rocm => Some(ort::ep::ROCm::default().with_device_id(config.device_id).build()),
        _ => None,
    }
}

/// Opens `path` on the requested device and reports which provider took it.
///
/// The accelerator is always followed by the CPU provider, so a node it cannot
/// run falls back instead of failing the whole session.
pub fn create_session(path: &Path, config: &SessionConfig) -> Result<(Session, Device)> {
    if config.device != Device::Auto {
        let mut device = config.device;
        if device != Device::Cpu && dispatch(device, config).is_none() {
            // Asked for a provider this build does not carry: say so once and
            // carry on rather than refusing to run at all.
            eprintln!("[warn] {device} is not compiled into this build; using CPU");
            device = Device::Cpu;
        }
        return match open(path, device, config) {
            Ok(session) => Ok((session, device)),
            Err(error) if device != Device::Cpu => {
                eprintln!("[warn] {device} did not start ({error}); falling back to CPU");
                Ok((open(path, Device::Cpu, config)?, Device::Cpu))
            }
            Err(error) => Err(error),
        };
    }

    // The compiled-in provider list is not a promise that any of them will start: a
    // TensorRT-enabled build still needs NVIDIA's own libraries beside it, and a CUDA
    // one needs cuDNN. So `auto` walks the list and only reaches the CPU once every
    // accelerator has refused.
    for candidate in available_devices() {
        if candidate == Device::Cpu {
            break;
        }
        match open(path, candidate, config) {
            Ok(session) => return Ok((session, candidate)),
            Err(error) => eprintln!("[warn] {candidate} did not start ({error}); trying the next"),
        }
    }
    Ok((open(path, Device::Cpu, config)?, Device::Cpu))
}

/// Opens the model on exactly one device. Each attempt needs its own builder, since a
/// provider that fails part way through registering leaves it in no state to reuse.
fn open(path: &Path, device: Device, config: &SessionConfig) -> Result<Session> {
    let mut providers = Vec::new();
    if let Some(provider) = dispatch(device, config) {
        providers.push(provider);
    }
    providers.push(CPU::default().build());

    let mut builder = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_execution_providers(providers)?
        .with_inter_threads(1)?;
    if config.threads > 0 {
        builder = builder.with_intra_threads(config.threads)?;
    }
    Ok(builder.commit_from_file(path)?)
}
