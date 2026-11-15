//! Offline waveform overview and beat detection for the backing transport.

use crate::{
    Shared,
    media::{self, MediaError, Store},
    media_api::{blocking, no_store, store},
    song_api,
    songs::{self, SongError},
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Response,
};
use oxidal_splitter::TempoAnalyzer;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, BufReader, Read},
    num::NonZeroU32,
    path::PathBuf,
    sync::Arc,
};

const BINS: usize = 240;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    pub source: String,
    pub rate: u32,
    pub frames: u64,
    pub bpm: Option<f64>,
    pub beats: Vec<u64>,
    pub peaks: Vec<f32>,
}

fn source_id(store: &Store, asset: &str) -> Result<String, MediaError> {
    let manifest = store.manifest(asset)?;
    Ok(songs::generated_mix(&manifest).map_or(manifest.id.clone(), |(source, _)| source.into()))
}

fn file(store: &Store, source: &str) -> Result<PathBuf, MediaError> {
    if !media::valid_id(source) {
        return Err(MediaError::NotFound);
    }
    Ok(store.root().join("timing").join(format!("{source}.json")))
}

pub(crate) fn load(store: &Store, asset: &str) -> Result<Option<Timing>, MediaError> {
    let source = source_id(store, asset)?;
    match fs::read(file(store, &source)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| {
            MediaError::Invalid("Timing analysis is damaged. Analyse the song again.".into())
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn calculate(store: &Store, asset: &str, allowed: impl Fn() -> bool) -> Result<Timing, SongError> {
    let source = source_id(store, asset)?;
    let _lease = store.lease(&source)?;
    let manifest = store.manifest(&source)?;
    let render = manifest.renders.first().ok_or(MediaError::NotFound)?;
    let rate = NonZeroU32::new(render.rate).ok_or(MediaError::NotFound)?;
    let channels = usize::from(render.channels);
    let mut pcm = BufReader::new(File::open(store.file(&source, &render.file)?)?);
    let mut estimator = TempoAnalyzer::new(rate);
    let mut peaks = vec![0.0_f32; BINS];
    let mut chunk = vec![0u8; 4096 * channels * 4];
    let mut mono = Vec::with_capacity(4096);
    let mut pos = 0u64;
    while pos < render.frames {
        if !allowed() {
            return Err(SongError::Interrupted);
        }
        let count = (render.frames - pos).min(4096) as usize;
        let bytes = &mut chunk[..count * channels * 4];
        pcm.read_exact(bytes)?;
        mono.clear();
        for frame in bytes.chunks_exact(4 * channels) {
            let sample = frame
                .as_chunks::<4>()
                .0
                .iter()
                .map(|&x| f32::from_le_bytes(x))
                .filter(|sample| sample.is_finite())
                .max_by(|a, b| a.abs().total_cmp(&b.abs()))
                .unwrap_or(0.0);
            mono.push(sample);
            let bin = (u128::from(pos) * BINS as u128 / u128::from(render.frames)) as usize;
            peaks[bin] = peaks[bin].max(sample.abs().min(1.0));
            pos += 1;
        }
        estimator.push_mono(&mono);
    }
    let estimate = estimator.finish();
    let record = Timing {
        rate: rate.get(),
        frames: render.frames,
        source: source.clone(),
        peaks,
        bpm: estimate
            .as_ref()
            .map(|found| (found.bpm * 10.0).round() / 10.0),
        beats: estimate.map_or_else(Vec::new, |found| {
            found.beats.beats_in(0..render.frames).to_vec()
        }),
    };
    let path = file(store, &source)?;
    media::create_private_dir(path.parent().expect("timing directory"))?;
    if !allowed() {
        return Err(SongError::Interrupted);
    }
    media::write_atomic(
        &path,
        &serde_json::to_vec(&record).expect("timing serializes"),
    )?;
    Ok(record)
}

pub(crate) async fn read(State(shared): State<Arc<Shared>>, Path(asset): Path<String>) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || load(&store, &asset)).await {
        Ok(record) => no_store(StatusCode::OK, record),
        Err(response) => *response,
    }
}

pub(crate) async fn analyse(
    State(shared): State<Arc<Shared>>,
    Path(asset): Path<String>,
) -> Response {
    song_api::change(shared, move |store, shared| {
        Ok(no_store(
            StatusCode::OK,
            crate::background::run(|| {
                calculate(store, &asset, || shared.protect.refuse(false).is_none())
            })?,
        ))
    })
    .await
}
