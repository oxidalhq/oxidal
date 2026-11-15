//! Lifecycle for locally installed Rust Demucs/ONNX inference.
//! @see docs/media.md#local-splitter-runtime

use crate::{
    Shared, failure,
    media::{self, MediaError, Store},
    media_api::{blocking, media_error, no_store, store},
    songs,
};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_splitter::SplitMode;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Write},
    path::{Path as FsPath, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Running,
    Ready,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitJob {
    pub id: String,
    pub request_id: String,
    pub mode: SplitMode,
    pub phase: Phase,
    pub error: Option<String>,
    /// Live progress while the job runs in this daemon; absent once stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<SplitProgress>,
}

/// What a running split is doing, with an overall percentage for one bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SplitStage {
    Preparing,
    Separating,
    Saving,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitProgress {
    pub stage: SplitStage,
    /// 0 to 100 across the whole job.
    pub percent: u8,
}

impl SplitProgress {
    fn at(stage: SplitStage, done: u64, total: u64) -> Self {
        let (start, span) = match stage {
            SplitStage::Preparing => (0, 5),
            SplitStage::Separating => (5, 85),
            SplitStage::Saving => (90, 10),
        };
        let part = (done.min(total) * span).checked_div(total).unwrap_or(0);
        Self {
            stage,
            percent: (start + part).min(100) as u8,
        }
    }
}

/// The runner prints `chunk DONE/TOTAL` with carriage returns to stdout.
fn runner_chunks(output: &[u8]) -> Option<(u64, u64)> {
    let text = String::from_utf8_lossy(output);
    let tail = &text[text.rfind("chunk ")? + "chunk ".len()..];
    let (done, rest) = tail.split_once('/')?;
    let total: String = rest.chars().take_while(char::is_ascii_digit).collect();
    Some((done.trim().parse().ok()?, total.parse().ok()?))
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSplit {
    pub mode: SplitMode,
    pub request_id: String,
}

/// The one split running on this device, wherever it was started.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentSplit {
    pub source: String,
    pub job: SplitJob,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct Options {
    pub modes: Vec<SplitMode>,
}

#[derive(Debug, Default)]
pub(crate) struct Jobs {
    runner: Option<PathBuf>,
    models: Option<PathBuf>,
    active: Mutex<Option<Active>>,
}

#[derive(Debug)]
struct Active {
    id: String,
    source: String,
    cancel: Arc<AtomicBool>,
    progress: Arc<Mutex<SplitProgress>>,
}

fn installed(variable: &str, appliance_default: &str) -> Option<PathBuf> {
    match std::env::var_os(variable) {
        Some(value) => {
            let path = PathBuf::from(value);
            path.is_absolute().then_some(path)
        }
        None if cfg!(target_os = "linux") => Some(PathBuf::from(appliance_default)),
        None => None,
    }
}

impl Jobs {
    /// Paths are checked on each use, so a runtime installed or replaced
    /// after start-up is found without restarting the daemon.
    pub(crate) fn load() -> Self {
        Self {
            runner: installed(
                "OXIDAL_SPLITTER_RUNNER",
                "/opt/oxidal/splitter/current/bin/demucs-onnx",
            ),
            models: installed(
                "OXIDAL_SPLITTER_MODELS",
                "/opt/oxidal/splitter/current/models",
            ),
            ..Default::default()
        }
    }

    fn model(&self, mode: SplitMode) -> Option<Model> {
        let runner = self.runner.clone().filter(|p| p.is_file())?;
        let base = self.models.as_ref()?.join(match mode {
            SplitMode::Four => "htdemucs",
            SplitMode::Six => "htdemucs_6s",
        });
        let graph = base.with_extension("onnx");
        let config = base.with_extension("json");
        (graph.is_file() && config.is_file()).then_some(Model {
            runner,
            graph,
            config,
        })
    }
}

struct Model {
    runner: PathBuf,
    graph: PathBuf,
    config: PathBuf,
}

pub(crate) async fn options(State(shared): State<Arc<Shared>>) -> Response {
    no_store(
        StatusCode::OK,
        Options {
            modes: [SplitMode::Four, SplitMode::Six]
                .into_iter()
                .filter(|&mode| shared.split_jobs.model(mode).is_some())
                .collect(),
        },
    )
}

/// SHA-256 of a model graph, cached by path, size and modification time:
/// the graphs are hundreds of megabytes and do not change between splits.
fn model_digest(path: &FsPath) -> Result<String, MediaError> {
    type Key = (u64, Option<SystemTime>);
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (Key, String)>>> = OnceLock::new();
    let metadata = fs::metadata(path)?;
    let key = (metadata.len(), metadata.modified().ok());
    let cache = CACHE.get_or_init(Default::default);
    if let Some((cached, digest)) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(path)
        && *cached == key
    {
        return Ok(digest.clone());
    }
    let digest = crate::media_import::hash_file(path)?;
    cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(path.to_owned(), (key, digest.clone()));
    Ok(digest)
}

/// The running split, for status shown on every page; `null` when idle.
pub(crate) async fn current(State(shared): State<Arc<Shared>>) -> Response {
    let running = shared
        .split_jobs
        .active
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|active| {
            (
                active.source.clone(),
                active.id.clone(),
                *active.progress.lock().unwrap_or_else(|e| e.into_inner()),
            )
        });
    let Some((source, id, progress)) = running else {
        return no_store(StatusCode::OK, Option::<CurrentSplit>::None);
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || {
        Ok(load(&store, &source)?
            .filter(|job| job.id == id)
            .map(|job| CurrentSplit {
                source,
                job: SplitJob {
                    progress: Some(progress),
                    ..job
                },
            }))
    })
    .await
    {
        Ok(current) => no_store(StatusCode::OK, current),
        Err(response) => *response,
    }
}

fn job_path(store: &Store, source: &str) -> Result<PathBuf, MediaError> {
    Ok(songs::song_dir(store, source)?.join("split-job.json"))
}

fn load(store: &Store, source: &str) -> Result<Option<SplitJob>, MediaError> {
    match fs::read(job_path(store, source)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| MediaError::Invalid(format!("Damaged split job: {error}"))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn persist(store: &Store, source: &str, job: &SplitJob) -> Result<(), MediaError> {
    let dir = songs::song_dir(store, source)?;
    media::create_private_dir(&dir)?;
    media::write_atomic(
        &dir.join("split-job.json"),
        &serde_json::to_vec(job).expect("job serializes"),
    )?;
    Ok(())
}

pub(crate) async fn status(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || {
        let Some(mut job) = load(&store, &source)? else {
            return Ok(None);
        };
        let live = shared
            .split_jobs
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|active| active.id == job.id)
            .map(|active| *active.progress.lock().unwrap_or_else(|e| e.into_inner()));
        if job.phase == Phase::Running && live.is_some() {
            job.progress = live;
        } else if job.phase == Phase::Running {
            job.phase = if songs::read_split(&store, &source, &job.id).is_ok() {
                Phase::Ready
            } else {
                Phase::Interrupted
            };
        }
        Ok(Some(job))
    })
    .await
    {
        Ok(job) => no_store(StatusCode::OK, job),
        Err(response) => *response,
    }
}

pub(crate) async fn start(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
    body: Result<Json<StartSplit>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Choose four or six stems");
    };
    if request.request_id.is_empty() || request.request_id.len() > 100 {
        return failure(StatusCode::BAD_REQUEST, "Send a split request ID");
    }
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Some(model) = shared.split_jobs.model(request.mode) else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "The local runner and model for this mode are not installed",
        );
    };
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    let result = tokio::task::spawn_blocking(move || {
        let mut active = shared
            .split_jobs
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(job) = load(&store, &source)?
            && job.request_id == request.request_id
        {
            if job.mode != request.mode {
                return Ok(failure(
                    StatusCode::CONFLICT,
                    "That split request ID has already been used",
                ));
            }
            return Ok(no_store(StatusCode::ACCEPTED, job));
        }
        let Ok(permit) = shared.song_write.clone().try_acquire_owned() else {
            return Ok(failure(
                StatusCode::CONFLICT,
                "Song preparation is already in progress",
            ));
        };
        let lease = store.lease(&source)?;
        let hash = songs::split_source_sha(&store.manifest(&source)?)?.to_owned();
        let job = SplitJob {
            id: media::new_id(),
            request_id: request.request_id,
            mode: request.mode,
            phase: Phase::Running,
            error: None,
            progress: None,
        };
        persist(&store, &source, &job)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let progress = Arc::new(Mutex::new(SplitProgress::at(SplitStage::Preparing, 0, 1)));
        *active = Some(Active {
            id: job.id.clone(),
            source: source.clone(),
            cancel: cancel.clone(),
            progress: progress.clone(),
        });
        drop(active);
        let accepted = SplitJob {
            progress: Some(*progress.lock().unwrap_or_else(|e| e.into_inner())),
            ..job.clone()
        };
        // The job owns the lease and permit even if the client disconnects. It
        // runs beside live audio at idle priority; Protect or Cancel stop it.
        crate::background::spawn(move || {
            let (_permit, _lease) = (permit, lease);
            let stopped = || {
                cancel.load(Ordering::Acquire)
                    || shared.protect.refuse(false).is_some()
                    || shared
                        .config
                        .shutdown
                        .as_ref()
                        .is_some_and(|signal| *signal.borrow())
            };
            let mut done = job;
            let report = |value| *progress.lock().unwrap_or_else(|e| e.into_inner()) = value;
            let prepared = split(&store, &source, &hash, &done, model, stopped, report);
            match prepared {
                Ok(()) => done.phase = Phase::Ready,
                Err(_) if cancel.load(Ordering::Acquire) => done.phase = Phase::Cancelled,
                Err(_) if stopped() => done.phase = Phase::Interrupted,
                Err(error) => {
                    done.phase = Phase::Failed;
                    done.error = Some(match error {
                        MediaError::Invalid(reason) => reason,
                        MediaError::NoSpace(_) => {
                            "There is insufficient space to split the song".into()
                        }
                        _ => "Reading or writing the split failed".into(),
                    });
                }
            }
            let _ = persist(&store, &source, &done);
            *shared
                .split_jobs
                .active
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = None;
        });
        Ok::<_, MediaError>(no_store(StatusCode::ACCEPTED, accepted))
    })
    .await;
    match result {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => media_error(error),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Cannot start the split"),
    }
}

pub(crate) async fn cancel(
    State(shared): State<Arc<Shared>>,
    Path(source): Path<String>,
) -> Response {
    let running = shared
        .split_jobs
        .active
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(active) = &*running
        && active.source == source
    {
        active.cancel.store(true, Ordering::Release);
        return StatusCode::ACCEPTED.into_response();
    }
    failure(
        StatusCode::NOT_FOUND,
        "There is no running split for this song",
    )
}

fn check(stopped: impl Fn() -> bool) -> Result<(), MediaError> {
    if stopped() {
        Err(MediaError::Invalid("Split interrupted".into()))
    } else {
        Ok(())
    }
}

fn split(
    store: &Store,
    source: &str,
    source_hash: &str,
    job: &SplitJob,
    model: Model,
    stopped: impl Fn() -> bool,
    progress: impl Fn(SplitProgress),
) -> Result<(), MediaError> {
    check(&stopped)?;
    let manifest = store.manifest(source)?;
    let render = manifest.renders.first().ok_or(MediaError::NotFound)?;
    let wav_header = crate::media_wav::stem_header(render.frames, render.rate)
        .ok_or_else(|| MediaError::Invalid("Track exceeds the runner's WAV input size".into()))?;
    let estimated = render
        .frames
        .checked_mul(8 * (3 + 3 * job.mode.roles().len() as u64))
        .ok_or_else(|| MediaError::Invalid("Split is too large".into()))?;
    store.admit(estimated)?;
    let staging = store.stage()?;
    let result = (|| {
        let input = staging.file("input.wav")?;
        let output = staging.file("output")?;
        let ready = staging.file("ready")?;
        media::create_private_dir(&output)?;
        media::create_private_dir(&ready)?;
        let mut source_file = BufReader::new(File::open(store.file(source, &render.file)?)?);
        let mut wav = BufWriter::new(File::create(&input)?);
        wav.write_all(&wav_header)?;
        let mut bytes = [0; 32 * 1024];
        let mut frames = render.frames;
        let stride = usize::from(render.channels) * 4;
        while frames > 0 {
            check(&stopped)?;
            let count = frames.min((bytes.len() / stride) as u64) as usize;
            let bytes = &mut bytes[..count * stride];
            source_file.read_exact(bytes)?;
            if render.channels == 2 {
                wav.write_all(bytes)?;
            } else {
                for frame in bytes.chunks_exact(4) {
                    wav.write_all(frame)?;
                    wav.write_all(frame)?;
                }
            }
            frames -= count as u64;
            progress(SplitProgress::at(
                SplitStage::Preparing,
                render.frames - frames,
                render.frames,
            ));
        }
        wav.flush()?;
        drop(wav);
        let digest = model_digest(&model.graph)?;
        check(&stopped)?;
        // The runner inherits this thread's idle CPU and disk priority.
        let mut command = Command::new(&model.runner);
        let stderr = File::create(staging.file("worker.log")?)?;
        let stdout_path = staging.file("runner.out")?;
        let stdout = File::create(&stdout_path)?;
        let mut child = command
            .arg("separate")
            .arg(&input)
            .arg("-m")
            .arg(&model.config)
            .arg("-o")
            .arg(&output)
            .args(["-d", "cpu", "-b", "1", "--threads", "2"])
            .env("OMP_NUM_THREADS", "2")
            .env("RAYON_NUM_THREADS", "2")
            .current_dir(&output)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .map_err(|_| {
                MediaError::Invalid("Cannot start the installed splitter runner".into())
            })?;
        progress(SplitProgress::at(SplitStage::Separating, 0, 1));
        let mut last_read = Instant::now();
        loop {
            if last_read.elapsed() >= Duration::from_millis(400) {
                last_read = Instant::now();
                if let Some((done, total)) = fs::read(&stdout_path)
                    .ok()
                    .and_then(|bytes| runner_chunks(&bytes))
                {
                    progress(SplitProgress::at(SplitStage::Separating, done, total));
                }
            }
            if stopped() || store.admit(1).is_err() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(MediaError::Invalid(
                    "Split stopped or ran out of storage".into(),
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(_)) => {
                    return Err(MediaError::Invalid(
                        "The installed splitter could not separate this song".into(),
                    ));
                }
                Ok(None) => thread::sleep(Duration::from_millis(90)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.into());
                }
            }
        }
        let roles = job.mode.roles();
        for (index, &role) in roles.iter().enumerate() {
            check(&stopped)?;
            progress(SplitProgress::at(
                SplitStage::Saving,
                index as u64,
                roles.len() as u64,
            ));
            let path = output.join(format!("{}.wav", role.name()));
            let path = if path.is_file() {
                path
            } else {
                output.join("input").join(path.file_name().unwrap())
            };
            if !path.is_file() {
                return Err(MediaError::Invalid(format!(
                    "Runner output is missing the {} WAV",
                    role.name()
                )));
            }
            let target = songs::mixing_file(&ready, role);
            let (frames, channels) =
                crate::media_import::render_stem(&path, true, render.rate, &target, store, || {
                    !stopped()
                })?;
            if channels != 2 || frames.abs_diff(render.frames) > 2 {
                return Err(MediaError::Invalid(
                    "Separated stems do not match the song duration or channel count".into(),
                ));
            }
            let file = OpenOptions::new().write(true).open(&target)?;
            file.set_len(render.frames * 8)?;
            file.sync_all()?;
        }
        let prepared = songs::Split {
            id: job.id.clone(),
            source_sha256: source_hash.into(),
            model_sha256: Some(digest),
            imported_roles: None,
            mode: job.mode,
            rate: render.rate,
            frames: render.frames,
        };
        media::write_atomic(
            &ready.join("manifest.json"),
            &serde_json::to_vec(&prepared).expect("split serializes"),
        )?;
        let final_path = songs::split_dir(store, source, &job.id)?;
        let parent = final_path.parent().expect("split directory");
        media::create_private_dir(parent)?;
        check(&stopped)?;
        fs::rename(&ready, &final_path)?;
        media::sync_dir(parent)?;
        Ok(())
    })();
    let _ = store.abandon(staging);
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture(wav: bool) -> (PathBuf, Store, media::MediaManifest) {
        let root = std::env::temp_dir().join(format!("oxidal-runner-{}", media::new_id()));
        let store = Store::open(&root).unwrap();
        let input = if wav {
            let path = root.join("fixture.wav");
            let rate = 44_100;
            let mut bytes = crate::media_wav::header(u64::from(rate), 1, rate)
                .unwrap()
                .to_vec();
            for frame in 0..rate {
                let phase = std::f64::consts::TAU * 997.0 * f64::from(frame) / f64::from(rate);
                let sample = (1_000_000.0 * phase.sin()) as i32;
                bytes.extend_from_slice(&sample.to_le_bytes()[..3]);
            }
            fs::write(&path, bytes).unwrap();
            path
        } else {
            let path = root.join("fixture.mp3");
            fs::write(
                &path,
                include_bytes!("../tests/fixtures/media/tone-44k-mono-vbr.mp3"),
            )
            .unwrap();
            path
        };
        let source = crate::media_import::import(
            &store,
            &input,
            &crate::media_import::ImportRequest {
                title: "Test source".into(),
                wav,
                kind: media::MediaKind::Backing,
                rate: 48_000,
            },
            &mut |_| {},
        )
        .unwrap();
        (root, store, source)
    }

    #[test]
    fn runner_boundary_publishes_both_modes_and_preserves_completed_splits_on_cancel() {
        let (root, store, source) = fixture(true);
        let source_hash = songs::split_source_sha(&source).unwrap();
        let runner = root.join("fixture-runner");
        fs::write(
            &runner,
            r#"#!/bin/sh
set -eu
test "$1" = separate
mkdir "$6/input"
for role in vocals drums bass other; do cp "$2" "$6/input/$role.wav"; done
case "$4" in
  *htdemucs_6s.json) cp "$2" "$6/input/guitar.wav"; cp "$2" "$6/input/piano.wav";;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700)).unwrap();
        let jobs = Jobs {
            runner: Some(runner),
            models: Some(root.clone()),
            ..Default::default()
        };
        for (mode, name) in [
            (SplitMode::Four, "htdemucs"),
            (SplitMode::Six, "htdemucs_6s"),
        ] {
            fs::write(root.join(format!("{name}.json")), b"{}").unwrap();
            fs::write(root.join(format!("{name}.onnx")), name).unwrap();
            let id = media::new_id();
            let job = SplitJob {
                id: id.clone(),
                request_id: id.clone(),
                mode,
                phase: Phase::Running,
                error: None,
                progress: None,
            };
            split(
                &store,
                &source.id,
                source_hash,
                &job,
                jobs.model(mode).unwrap(),
                || false,
                |_| {},
            )
            .unwrap();
            let (record, _) = songs::read_split(&store, &source.id, &id).unwrap();
            assert_eq!(record.mode, mode);
            assert_eq!(record.frames, source.renders[0].frames);
            let interrupted = SplitJob {
                id: media::new_id(),
                ..job
            };
            assert!(
                split(
                    &store,
                    &source.id,
                    source_hash,
                    &interrupted,
                    jobs.model(mode).unwrap(),
                    || true,
                    |_| {}
                )
                .is_err()
            );
        }
        assert_eq!(songs::view(&store, &source.id).unwrap().splits.len(), 2);
        assert_eq!(fs::read_dir(root.join("incoming")).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runner_progress_reads_the_last_chunk_count() {
        assert_eq!(
            runner_chunks(b"[i] x\n\r    chunk 1/9  0.5s elapsed\r    chunk 12/30  4.0s elapsed"),
            Some((12, 30))
        );
        assert_eq!(runner_chunks(b"[i] loading"), None);
        assert_eq!(
            SplitProgress::at(SplitStage::Separating, 15, 30).percent,
            47
        );
        assert_eq!(SplitProgress::at(SplitStage::Saving, 4, 4).percent, 100);
    }

    #[test]
    #[ignore = "requires provisioned local Demucs models and ONNX Runtime"]
    fn real_runner_splits_an_mp3_into_both_stem_counts() {
        verify_real_runner(false);
    }

    #[test]
    #[ignore = "requires provisioned local Demucs models and ONNX Runtime"]
    fn real_runner_splits_a_wav_into_both_stem_counts() {
        verify_real_runner(true);
    }

    fn verify_real_runner(wav: bool) {
        let jobs = Jobs::load();
        let (root, store, source) = fixture(wav);
        let hash = songs::split_source_sha(&source).unwrap();
        for mode in [SplitMode::Four, SplitMode::Six] {
            let id = media::new_id();
            let job = SplitJob {
                request_id: id.clone(),
                id: id.clone(),
                mode,
                phase: Phase::Running,
                error: None,
                progress: None,
            };
            split(
                &store,
                &source.id,
                hash,
                &job,
                jobs.model(mode).unwrap(),
                || false,
                |_| {},
            )
            .unwrap();
            let (record, path) = songs::read_split(&store, &source.id, &id).unwrap();
            assert_eq!(record.frames, source.renders[0].frames);
            let mut digests = std::collections::BTreeSet::new();
            for &role in mode.roles() {
                let stem = songs::mixing_file(&path, role);
                let pcm = fs::read(&stem).unwrap();
                assert!(
                    pcm.as_chunks::<4>()
                        .0
                        .iter()
                        .all(|sample| f32::from_le_bytes(*sample).is_finite())
                );
                assert!(
                    pcm.as_chunks::<4>()
                        .0
                        .iter()
                        .any(|sample| f32::from_le_bytes(*sample).abs() > 1e-7)
                );
                digests.insert(crate::media_import::hash_file(&stem).unwrap());
            }
            assert_eq!(digests.len(), mode.roles().len());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
