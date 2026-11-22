// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Command line front end for the Demucs ONNX runtime.

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use clap::{Parser, Subcommand, ValueEnum};

use demucs_onnx::audio::{load, OutputFormat, StemWriter};
use demucs_onnx::session::available_devices;
use demucs_onnx::{Device, Error, Result, Separator, SeparatorOptions};

const MODEL_ENV: &str = "DEMUCS_ONNX_MODEL";

#[derive(Parser)]
#[command(name = "demucs-onnx", version, about = "Demucs v4 stem separation on ONNX Runtime")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Split audio files into stems.
    Separate(SeparateArgs),
    /// Measure throughput on synthetic audio.
    Bench(BenchArgs),
    /// List usable execution providers.
    Devices,
}

#[derive(Parser)]
struct SeparateArgs {
    /// Input WAV files.
    #[arg(required = true)]
    inputs: Vec<PathBuf>,

    /// Model name (htdemucs, htdemucs_ft, htdemucs_6s, hdemucs_mmi, mdx, ...)
    /// or a path to a graph or a bag manifest.
    #[arg(short, long)]
    model: Option<PathBuf>,

    /// Output directory.
    #[arg(short, long, default_value = "separated")]
    out: PathBuf,

    #[command(flatten)]
    engine: EngineArgs,

    /// Output sample format.
    #[arg(long, value_enum, default_value_t = Format::Float)]
    format: Format,

    /// Write only this stem and its complement.
    #[arg(long, value_name = "STEM")]
    two_stems: Option<String>,

    /// Process only the first N seconds.
    #[arg(long, default_value_t = 0.0)]
    limit: f64,

    /// Only report errors.
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Parser)]
struct BenchArgs {
    #[arg(short, long)]
    model: Option<PathBuf>,

    #[command(flatten)]
    engine: EngineArgs,

    /// Seconds of synthetic audio to push through.
    #[arg(long, default_value_t = 30.0)]
    seconds: f64,
}

#[derive(Parser, Clone)]
struct EngineArgs {
    /// Execution provider: auto, cpu, cuda, tensorrt, directml, coreml, rocm.
    #[arg(short, long, default_value = "auto")]
    device: String,

    /// GPU index.
    #[arg(long, default_value_t = 0)]
    device_id: i32,

    /// Chunks per inference call (0 = 1 on CPU, 4 on GPU).
    #[arg(short, long, default_value_t = 0)]
    batch: usize,

    /// Intra-op threads (0 = all cores).
    #[arg(short, long, default_value_t = 0)]
    threads: usize,

    /// Chunk overlap; 0.25 matches upstream demucs.
    #[arg(long, default_value_t = 0.25)]
    overlap: f32,

    /// Allow half precision (TensorRT).
    #[arg(long)]
    fp16: bool,

    /// TensorRT engine cache directory.
    #[arg(long)]
    cache_dir: Option<String>,

    /// Do not overlap spectrogram work with inference.
    #[arg(long)]
    no_pipeline: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, ValueEnum)]
enum Format {
    Float,
    Int16,
    Int24,
}

impl From<Format> for OutputFormat {
    fn from(value: Format) -> Self {
        match value {
            Format::Float => OutputFormat::Float32,
            Format::Int16 => OutputFormat::Int16,
            Format::Int24 => OutputFormat::Int24,
        }
    }
}

impl EngineArgs {
    fn options(&self) -> Result<SeparatorOptions> {
        let mut options = SeparatorOptions {
            batch: self.batch,
            overlap: self.overlap,
            pipeline: !self.no_pipeline,
            ..Default::default()
        };
        options.session.device = self.device.parse::<Device>()?;
        options.session.device_id = self.device_id;
        options.session.threads = self.threads;
        options.session.fp16 = self.fp16;
        options.session.cache_dir = self.cache_dir.clone();
        Ok(options)
    }
}

/// Turns `-m` into a path. It may be a file, or just a model name: a name with
/// no directory in it is looked for as `<name>.onnx` -- a single graph -- and
/// then as `<name>.json`, which is how bags such as `htdemucs_ft` arrive.
fn find_model(spec: &Option<PathBuf>) -> Result<PathBuf> {
    let spec = spec.clone().unwrap_or_else(|| {
        PathBuf::from(std::env::var(MODEL_ENV).unwrap_or_else(|_| "htdemucs".into()))
    });

    let names: Vec<PathBuf> = if spec.extension().is_some() {
        vec![spec.clone()]
    } else {
        vec![spec.with_extension("onnx"), spec.with_extension("json")]
    };
    let roots: Vec<PathBuf> = match spec.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => vec![PathBuf::new()],
        _ => vec![PathBuf::new(), "models".into(), "../models".into()],
    };

    let mut tried = Vec::new();
    for root in &roots {
        for name in &names {
            let candidate = if root.as_os_str().is_empty() { name.clone() } else { root.join(name) };
            if candidate.exists() {
                return Ok(candidate);
            }
            tried.push(candidate.display().to_string());
        }
    }
    Err(Error::Unsupported(format!(
        "model not found: {}
tried:
  {}
export one with: python tools/export_onnx.py --name {}",
        spec.display(),
        tried.join("
  "),
        spec.display()
    )))
}

fn open(model: &Option<PathBuf>, options: SeparatorOptions) -> Result<Separator> {
    Separator::new(&find_model(model)?, options)
}

fn separate(args: &SeparateArgs) -> Result<()> {
    let mut separator = open(&args.model, args.engine.options()?)?;
    if !args.quiet {
        println!("[i] {}", separator.config());
        print!("[i] device {}, batch {}", separator.device(), separator.batch());
        if separator.models() > 1 {
            print!(", {} models blended", separator.models());
        }
        println!();
    }

    let sources = separator.config().sources.clone();
    let keep = match &args.two_stems {
        None => None,
        Some(name) => match sources.iter().position(|s| s == name) {
            Some(index) => Some(index),
            None => {
                return Err(Error::Unsupported(format!(
                    "unknown stem '{name}'; model has {}",
                    sources.join(", ")
                )))
            }
        },
    };
    let names: Vec<String> = match keep {
        None => sources.clone(),
        Some(index) => vec![sources[index].clone(), format!("no_{}", sources[index])],
    };

    let samplerate = separator.config().samplerate;
    let channels = separator.config().channels;
    let total_sources = sources.len();

    for input in &args.inputs {
        let mut audio = load(input, samplerate, channels)?;
        if args.limit > 0.0 {
            audio.truncate((args.limit * samplerate as f64) as usize);
        }

        let stem_dir = args.out.join(input.file_stem().unwrap_or_default());
        if !args.quiet {
            println!("[i] {}: {:.1}s, {} ch -> {}", input.display(), audio.duration(),
                     audio.channels, stem_dir.display());
        }

        let mut writer =
            StemWriter::create(&stem_dir, &names, samplerate, channels, args.format.into())?;
        let started = Instant::now();
        let quiet = args.quiet;

        separator.separate(
            &audio.samples,
            audio.frames,
            |_offset, count, block| match keep {
                None => writer.write(block, count),
                // Two-stem mode: the chosen stem, plus everything else summed.
                Some(index) => {
                    let stride = channels * count;
                    let mut rest = vec![0f32; stride];
                    for stem in (0..total_sources).filter(|s| *s != index) {
                        for (dst, value) in
                            rest.iter_mut().zip(&block[stem * stride..(stem + 1) * stride])
                        {
                            *dst += value;
                        }
                    }
                    writer.write_one(0, &block[index * stride..(index + 1) * stride], count)?;
                    writer.write_one(1, &rest, count)
                }
            },
            |done, total| {
                if !quiet {
                    let elapsed = started.elapsed().as_secs_f64();
                    print!("\r    chunk {done}/{total}  {elapsed:5.1}s elapsed, {:5.1}s left   ",
                           elapsed / done as f64 * (total - done) as f64);
                    let _ = std::io::stdout().flush();
                }
            },
        )?;

        let paths: Vec<_> = writer.paths().to_vec();
        writer.finish()?;

        if !args.quiet {
            let elapsed = started.elapsed().as_secs_f64();
            println!("\r[i] done in {elapsed:.1}s ({:.1}x realtime)          ",
                     audio.duration() / elapsed);
            for path in paths {
                println!("     {}", path.display());
            }
        }
    }
    Ok(())
}

fn bench(args: &BenchArgs) -> Result<()> {
    let mut separator = open(&args.model, args.engine.options()?)?;
    println!("[i] {}", separator.config());
    let report = separator.benchmark(args.seconds)?;
    println!("device            {}", report.device);
    println!("batch             {}", report.batch);
    println!("models            {}", report.models);
    println!("audio             {:.1} s", report.audio_seconds);
    println!("elapsed           {:.2} s", report.elapsed);
    println!("realtime factor   {:.2}x", report.realtime_factor);
    Ok(())
}

fn run() -> Result<()> {
    match Cli::parse().command {
        Command::Separate(args) => separate(&args),
        Command::Bench(args) => bench(&args),
        Command::Devices => {
            for device in available_devices() {
                println!("{device}");
            }
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
