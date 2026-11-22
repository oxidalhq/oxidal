// Copyright (c) 2026 Hamidreza Sadeghi
// SPDX-License-Identifier: MIT

//! Model geometry, resolved from the ONNX graph itself.
//!
//! Tensor shapes come from the graph, which cannot disagree with itself; the
//! human-readable parts -- stem names, sample rate -- come from the sidecar
//! JSON written by `tools/export_onnx.py`.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{Error, Result};

pub const DEFAULT_SOURCES: [&str; 4] = ["drums", "bass", "other", "vocals"];

#[derive(Debug, Clone, Deserialize, Default)]
struct Sidecar {
    name: Option<String>,
    sources: Option<Vec<String>>,
    samplerate: Option<u32>,
    nfft: Option<usize>,
    hop: Option<usize>,
    audio_channels: Option<usize>,
    segment_samples: Option<usize>,
    freq_bins: Option<usize>,
    frames: Option<usize>,
    /// Present only in a bag manifest; see [`ModelBundle`].
    models: Option<Vec<BagEntry>>,
}

#[derive(Debug, Clone, Deserialize)]
struct BagEntry {
    model: String,
    weights: Option<Vec<f32>>,
}

/// One network of a bag, and how much of each stem it contributes.
#[derive(Debug, Clone)]
pub struct BagMember {
    pub path: PathBuf,
    /// Per source; `None` means an equal share of every stem.
    pub weights: Option<Vec<f32>>,
}

/// What `-m` resolved to: one graph, or several to be blended.
///
/// `htdemucs_ft`, `mdx`, `mdx_extra` and the quantised pair are *bags* -- four
/// independently trained networks whose stems are averaged with per-stem
/// weights. Upstream runs each of them over the whole track and adds up the
/// results; because every step after the network (ISTFT, cross-fade,
/// denormalisation) is linear, the same answer comes out of blending the raw
/// graph outputs chunk by chunk, which is what [`crate::Separator`] does.
#[derive(Debug, Clone)]
pub struct ModelBundle {
    pub name: String,
    pub members: Vec<BagMember>,
}

impl ModelBundle {
    pub fn is_bag(&self) -> bool {
        self.members.len() > 1
    }

    fn single(path: &Path) -> Self {
        Self {
            name: path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "htdemucs".into()),
            members: vec![BagMember { path: path.to_path_buf(), weights: None }],
        }
    }
}

/// Turns a user-supplied `-m` into the list of graphs to open. Accepts a graph
/// (`htdemucs.onnx`), a bag manifest (`htdemucs_ft.json`), or either one with
/// the extension left off.
pub fn resolve_model(path: &Path) -> Result<ModelBundle> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("onnx") => Ok(ModelBundle::single(path)),
        Some("json") => from_manifest(path),
        _ => {
            let graph = path.with_extension("onnx");
            if graph.exists() {
                return Ok(ModelBundle::single(&graph));
            }
            let manifest = path.with_extension("json");
            if manifest.exists() {
                return from_manifest(&manifest);
            }
            Err(Error::Model(format!(
                "neither {} nor {} exists",
                graph.display(),
                manifest.display()
            )))
        }
    }
}

fn from_manifest(path: &Path) -> Result<ModelBundle> {
    let text = std::fs::read_to_string(path)?;
    let manifest: Sidecar = serde_json::from_str(&text)
        .map_err(|error| Error::Model(format!("{}: {error}", path.display())))?;

    // A plain sidecar, not a manifest: the graph sits next to it.
    let entries = match manifest.models {
        Some(entries) if !entries.is_empty() => entries,
        _ => return Ok(ModelBundle::single(&path.with_extension("onnx"))),
    };

    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    let mut members = Vec::with_capacity(entries.len());
    for entry in entries {
        let member = directory.join(&entry.model);
        if !member.exists() {
            return Err(Error::Model(format!(
                "{} lists {}, which is not beside it",
                path.display(),
                entry.model
            )));
        }
        members.push(BagMember { path: member, weights: entry.weights });
    }

    Ok(ModelBundle {
        name: manifest.name.unwrap_or_else(|| ModelBundle::single(path).name),
        members,
    })
}

/// Normalised `[model][source]` weights, row-major, or `None` for a single graph.
///
/// Upstream sums `weight * estimate` over the bag and divides each stem by the
/// total weight it received; folding that division in here makes the per-chunk
/// blend a plain weighted sum.
pub fn mixing_matrix(bundle: &ModelBundle, num_sources: usize) -> Result<Option<Vec<f32>>> {
    if !bundle.is_bag() {
        return Ok(None);
    }

    let models = bundle.members.len();
    let mut matrix = vec![1.0f32; models * num_sources];
    for (index, member) in bundle.members.iter().enumerate() {
        let Some(row) = member.weights.as_ref() else { continue };
        if row.len() != num_sources {
            return Err(Error::Model(format!(
                "{} carries {} weights but the model has {num_sources} stems",
                member.path.display(),
                row.len()
            )));
        }
        matrix[index * num_sources..(index + 1) * num_sources].copy_from_slice(row);
    }

    for source in 0..num_sources {
        let total: f32 = (0..models).map(|m| matrix[m * num_sources + source]).sum();
        if total <= 0.0 {
            return Err(Error::Model(format!(
                "no model in the bag contributes to stem {source}"
            )));
        }
        for m in 0..models {
            matrix[m * num_sources + source] /= total;
        }
    }
    Ok(Some(matrix))
}

#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub name: String,
    pub sources: Vec<String>,
    pub samplerate: u32,
    pub channels: usize,
    /// Samples per chunk fed to the network.
    pub segment: usize,
    pub nfft: usize,
    pub hop: usize,
    /// `nfft / 2`; the Nyquist bin is dropped.
    pub freq_bins: usize,
    pub frames: usize,
    pub dynamic_batch: bool,
    pub input_names: [String; 2],
    pub output_names: [String; 2],
}

impl ModelConfig {
    pub fn num_sources(&self) -> usize {
        self.sources.len()
    }

    pub fn segment_seconds(&self) -> f64 {
        self.segment as f64 / self.samplerate as f64
    }

    /// Builds the configuration from graph metadata plus the sidecar next to
    /// `model_path`. Shapes are `[mix, mag, spec]`, with negative or missing
    /// dimensions standing for a dynamic axis.
    pub fn from_graph(
        model_path: &Path,
        mix: &[i64],
        mag: &[i64],
        spec: &[i64],
        input_names: [String; 2],
        output_names: [String; 2],
    ) -> Result<Self> {
        if mix.len() != 3 || mag.len() != 4 || spec.len() != 5 {
            return Err(Error::Model(format!(
                "unexpected tensor ranks: mix {}, mag {}, spec {}",
                mix.len(),
                mag.len(),
                spec.len()
            )));
        }

        let sidecar = read_sidecar(model_path);
        let channels = dimension(mix[1], sidecar.audio_channels, "mix channels")?;
        let segment = dimension(mix[2], sidecar.segment_samples, "mix length")?;
        let freq_bins = dimension(mag[2], sidecar.freq_bins, "frequency bins")?;
        let frames = dimension(mag[3], sidecar.frames, "frames")?;

        // torch.onnx.export cannot prove the output shapes, so it leaves every one of their
        // dimensions symbolic, which arrives here as -1. The stem count therefore comes from
        // the sidecar, and the graph is only consulted when it does state a number.
        let declared = (spec[1] > 0).then(|| spec[1] as usize);
        let sources = match sidecar.sources.clone() {
            Some(names) if declared.is_none_or(|n| names.len() == n) => names,
            Some(names) => {
                return Err(Error::Model(format!(
                    "the sidecar lists {} stems but the graph produces {}",
                    names.len(),
                    declared.unwrap_or(0)
                )))
            }
            None => (0..declared.unwrap_or(DEFAULT_SOURCES.len()))
                .map(|i| {
                    DEFAULT_SOURCES
                        .get(i)
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("stem{i}"))
                })
                .collect(),
        };

        Ok(Self {
            name: sidecar.name.unwrap_or_else(|| {
                model_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "htdemucs".into())
            }),
            sources,
            samplerate: sidecar.samplerate.unwrap_or(44100),
            channels,
            segment,
            // htdemucs uses 75 % frame overlap; the sidecar may say otherwise.
            nfft: sidecar.nfft.unwrap_or(freq_bins * 2),
            hop: sidecar.hop.unwrap_or(freq_bins / 2),
            freq_bins,
            frames,
            dynamic_batch: mix[0] < 0,
            input_names,
            output_names,
        })
    }
}

impl fmt::Display for ModelConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: {} stems [{}], {} Hz, {} ch, segment {} samples ({:.2} s), \
             nfft {}/hop {} -> {}x{}, batch {}",
            self.name,
            self.num_sources(),
            self.sources.join(", "),
            self.samplerate,
            self.channels,
            self.segment,
            self.segment_seconds(),
            self.nfft,
            self.hop,
            self.freq_bins,
            self.frames,
            if self.dynamic_batch { "dynamic" } else { "fixed at 1" }
        )
    }
}

/// A concrete dimension from the graph, or the sidecar's word for it if the
/// graph left it symbolic (which ONNX Runtime reports as a negative size).
fn dimension(value: i64, fallback: Option<usize>, label: &str) -> Result<usize> {
    if value > 0 {
        return Ok(value as usize);
    }
    fallback.ok_or_else(|| {
        Error::Model(format!(
            "the graph leaves {label} symbolic and the sidecar does not say"
        ))
    })
}

fn read_sidecar(model_path: &Path) -> Sidecar {
    let path = model_path.with_extension("json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}
