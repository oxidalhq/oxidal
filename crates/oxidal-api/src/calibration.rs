//! Background reference rendering measures saved presets without changing live playback.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_engine::measurement::{Request, Target};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// Seconds of riff measured per preset or scene, after the host's settling second.
const MEASURE_SECONDS: f32 = 3.0;
/// Calibration uses the host's complete correction range. The target is moved
/// down when necessary so the whole measured library remains reachable instead
/// of leaving quiet sounds behind at a smaller arbitrary ceiling.
const MAX_OFFSET_DB: f32 = oxidal_audio::tools::HostLevels::OFFSET_RANGE.1;
/// Stable Oxidal factory riff level. It must not depend on one unit's guitar.
const FACTORY_REFERENCE_PEAK_DB: f32 = -12.0;
/// Changing the reference invalidates cached measurements without changing the file schema.
const FACTORY_REFERENCE_REVISION: &str = "oxidal-factory-riff-v2";

fn measurement_content(content: &str, mono: bool) -> String {
    let mode = if mono { "mono" } else { "stereo" };
    format!("{FACTORY_REFERENCE_REVISION}:{mode}:{content}")
}

/// One measured preset or scene, keyed like boosts (`boosts.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Measured {
    pub name: String,
    /// What was measured: the original's hash, the copy's hash or the scene
    /// preset's revision. A change means measuring again.
    pub content: String,
    pub lufs: f32,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Calibration {
    pub measured: BTreeMap<String, Measured>,
}
impl Calibration {
    /// The loudness every preset is evened out to. Prefer the median, then move
    /// it into the range every measurement can reach with the host correction.
    /// This normally lowers the target instead of adding unsafe gain to a quiet
    /// outlier.
    /// See `docs/audio.md` for the user-visible calibration policy.
    pub fn target(&self) -> Option<f32> {
        let mut values: Vec<f32> = self.measured.values().map(|m| m.lufs).collect();
        if values.is_empty() {
            return None;
        }
        values.sort_by(f32::total_cmp);
        let middle = values.len() / 2;
        let median = if values.len().is_multiple_of(2) {
            (values[middle - 1] + values[middle]) / 2.0
        } else {
            values[middle]
        };
        let lowest_target = values
            .iter()
            .map(|lufs| lufs - MAX_OFFSET_DB)
            .fold(f32::NEG_INFINITY, f32::max);
        let highest_target = values
            .iter()
            .map(|lufs| lufs + MAX_OFFSET_DB)
            .fold(f32::INFINITY, f32::min);
        Some(if lowest_target <= highest_target {
            median.clamp(lowest_target, highest_target)
        } else {
            // A library wider than the complete host range cannot share one
            // reachable target. Centre the unavoidable residual error so Sound
            // Check can identify both sides truthfully.
            (lowest_target + highest_target) / 2.0
        })
    }
    pub fn offset(&self, key: &str) -> Option<f32> {
        let target = self.target()?;
        let lufs = self.measured.get(key)?.lufs;
        Some(((target - lufs) * 2.0).round() / 2.0 + 0.0)
            .map(|db| db.clamp(-MAX_OFFSET_DB, MAX_OFFSET_DB))
    }
    /// Offsets for what is playing: the TONE3000 preset, or the sounding scene.
    pub fn total(&self, playing: &[String]) -> f32 {
        // A scene measurement already includes its complete preset signal.
        // Never add an older whole-preset correction a second time.
        playing
            .iter()
            .rev()
            .find_map(|key| self.offset(key))
            .unwrap_or(0.0)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Progress {
    pub running: bool,
    pub done: usize,
    pub total: usize,
    /// Measured this run; the rest were already measured and unchanged.
    pub measured: usize,
    pub current: Option<String>,
    /// Presets or scenes that could not be measured this run, with why.
    #[serde(default)]
    pub failed: Vec<String>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationEntry {
    pub key: String,
    pub name: String,
    pub lufs: f32,
    pub offset_db: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationState {
    pub target_lufs: Option<f32>,
    pub entries: Vec<CalibrationEntry>,
    pub progress: Progress,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationCoverage {
    /// Visible presets and scenes currently eligible for measurement.
    pub total: usize,
    /// Cached measurements whose content still matches the visible item.
    pub measured: usize,
    /// Cached measurements whose preset or scene content has changed.
    pub stale: usize,
    /// Visible items that have never been measured.
    pub unmeasured: usize,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationAction {
    /// Measure every preset and scene that is new or changed since last time.
    Run,
    /// Measure every preset and scene again.
    RunAll,
    /// Stop the background measurement; live playback stays unchanged.
    Cancel,
    /// Forget every measurement: all presets play at their own level again.
    Reset,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationCommand {
    pub action: CalibrationAction,
}

#[derive(Debug)]
pub(crate) struct Store {
    path: PathBuf,
    value: Mutex<Calibration>,
    progress: Mutex<Progress>,
    playback: Mutex<Option<Calibration>>,
    cancel: AtomicBool,
}
impl Store {
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 1 << 20)
            .and_then(|bytes| serde_json::from_slice::<Calibration>(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            value: Mutex::new(value),
            progress: Mutex::new(Progress::default()),
            playback: Mutex::new(None),
            cancel: AtomicBool::new(false),
        }
    }
    pub(crate) fn current(&self) -> Calibration {
        self.value.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub(crate) fn for_playback(&self) -> Calibration {
        self.playback
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_else(|| self.current())
    }
    fn hold_playback(&self, hold: bool) {
        if let Ok(mut value) = self.playback.lock() {
            *value = hold.then(|| self.current());
        }
    }
    fn progress(&self) -> Progress {
        self.progress.lock().map(|p| p.clone()).unwrap_or_default()
    }
    fn update(&self, change: impl FnOnce(&mut Progress)) {
        if let Ok(mut progress) = self.progress.lock() {
            change(&mut progress);
        }
    }
    fn save(&self, calibration: Calibration) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| "Calibration unavailable")?;
        let parent = self
            .path
            .parent()
            .ok_or("Calibration file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&calibration).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = calibration;
        Ok(())
    }
    /// Duplicate (Library): the copy sounds the same, so the source's
    /// measurements carry over to the copy's preset id and revision.
    pub(crate) fn copy_preset(&self, from: (&str, &str), to: (&str, &str)) -> Result<(), String> {
        let (from_id, from_revision) = from;
        let (to_id, to_revision) = to;
        let mut calibration = self.current();
        let prefix = format!("scenes:{from_id}");
        let copied = calibration
            .measured
            .iter()
            .filter_map(|(key, measured)| {
                let rest = key.strip_prefix(&prefix)?;
                let mono = [false, true]
                    .into_iter()
                    .find(|&mono| measured.content == measurement_content(from_revision, mono))?;
                (rest.is_empty() || rest.starts_with('#')).then(|| {
                    (
                        format!("scenes:{to_id}{rest}"),
                        Measured {
                            content: measurement_content(to_revision, mono),
                            ..measured.clone()
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        if copied.is_empty() {
            return Ok(());
        }
        calibration.measured.extend(copied);
        self.save(calibration)
    }
    fn state(&self) -> CalibrationState {
        let calibration = self.current();
        CalibrationState {
            target_lufs: calibration.target(),
            entries: calibration
                .measured
                .iter()
                .map(|(key, m)| CalibrationEntry {
                    key: key.clone(),
                    name: m.name.clone(),
                    lufs: m.lufs,
                    offset_db: calibration.offset(key).unwrap_or(0.0),
                })
                .collect(),
            progress: self.progress(),
        }
    }
}

#[derive(Debug, Clone)]
struct Item {
    key: String,
    name: String,
    content: String,
    target: Target,
}

/// Every visible preset and scene, in library order.
fn inventory(root: &std::path::Path) -> Result<Vec<Item>, String> {
    use oxidal_presets::LibraryKind;
    let text = |e: oxidal_presets::Error| e.to_string();
    let mut items = Vec::new();
    let originals = oxidal_presets::Store::new(root.to_path_buf())
        .list()
        .map_err(text)?
        .presets;
    for preset in
        crate::presets::visible_native(root, LibraryKind::Original, originals).map_err(text)?
    {
        items.push(Item {
            key: crate::boosts::key_tone3000(&preset.sha256, false),
            name: preset.name.clone(),
            content: preset.sha256.clone(),
            target: Target::Tone3000 {
                id: preset.sha256,
                owned: false,
            },
        });
    }
    let catalog = oxidal_presets::CatalogStore::open(root.to_path_buf()).map_err(text)?;
    for copy in oxidal_presets::OwnedStore::new(root.join("owned"))
        .list()
        .map_err(text)?
    {
        if !catalog
            .visible(LibraryKind::Owned, &copy.id)
            .map_err(text)?
        {
            continue;
        }
        items.push(Item {
            key: crate::boosts::key_tone3000(&copy.id, true),
            name: catalog
                .label(LibraryKind::Owned, &copy.id, &copy.preset.name)
                .map_err(text)?
                .into(),
            content: copy.preset.sha256.clone(),
            target: Target::Tone3000 {
                id: copy.id,
                owned: true,
            },
        });
    }
    let bundles = oxidal_presets::BundleStore::new(root.join("bundles"));
    for revision in bundles.list().map_err(text)? {
        if !catalog.visible(LibraryKind::Rig, &revision).map_err(text)? {
            continue;
        }
        let manifest = bundles.manifest(&revision).map_err(text)?;
        let draft = manifest
            .extensions
            .get("urn:oxidal:authoring")
            .and_then(|a| a.get("draft"))
            == Some(&serde_json::Value::Bool(true));
        if draft {
            continue;
        }
        let preset = catalog
            .label(LibraryKind::Rig, &revision, &manifest.name)
            .map_err(text)?
            .to_owned();
        let Some(scenes) = manifest.scenes().ok().flatten() else {
            // A preset with effects and no scenes is measured as a whole.
            items.push(Item {
                key: format!("scenes:{}", manifest.id),
                name: preset,
                content: revision.clone(),
                target: Target::Scene {
                    revision: revision.clone(),
                    scene: None,
                },
            });
            continue;
        };
        for scene in scenes.scenes {
            items.push(Item {
                key: crate::boosts::key_scene(&manifest.id, &scene.id),
                name: format!("{preset} · {}", scene.name),
                content: revision.clone(),
                target: Target::Scene {
                    revision: revision.clone(),
                    scene: Some(scene.id),
                },
            });
        }
    }
    Ok(items)
}

fn coverage_for(calibration: &Calibration, items: &[Item], mono: bool) -> CalibrationCoverage {
    let mut coverage = CalibrationCoverage {
        total: items.len(),
        measured: 0,
        stale: 0,
        unmeasured: 0,
    };
    for item in items {
        match calibration.measured.get(&item.key) {
            Some(measured) if measured.content == measurement_content(&item.content, mono) => {
                coverage.measured += 1;
            }
            Some(_) => coverage.stale += 1,
            None => coverage.unmeasured += 1,
        }
    }
    coverage
}

/// A separate low-priority worker renders to memory, never the live audio device.
async fn measure(
    shared: &Shared,
    target: Target,
    stream: &oxidal_audio::StreamConfig,
) -> Result<f32, String> {
    let _library = shared.library_access.read().await;
    let executable = shared
        .config
        .rig_worker
        .as_ref()
        .ok_or("Background measurement worker unavailable")?;
    let request = Request {
        target,
        stream: stream.clone(),
        peak_db: FACTORY_REFERENCE_PEAK_DB,
        seconds: MEASURE_SECONDS,
    };
    render(
        executable,
        &shared.config.preset_dir,
        &request,
        &shared.calibration.cancel,
    )
    .await
}

async fn render(
    executable: &std::path::Path,
    root: &std::path::Path,
    request: &Request,
    cancel: &AtomicBool,
) -> Result<f32, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut bytes = serde_json::to_vec(request).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let runtime = root.join("measurement-runtime");
    std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let runtime = std::fs::canonicalize(runtime).map_err(|e| e.to_string())?;
    let mut child = tokio::process::Command::new(executable)
        .arg("--measure-loudness")
        .env("OXIDAL_QUALIFICATION_DATA", runtime)
        .env("OXIDAL_PRESET_DIR", root)
        .env("OXIDAL_BUNDLE_STORE", root.join("bundles"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("Measurement input unavailable")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Measurement output unavailable")?
        .take(2049);
    let operation = async {
        input.write_all(&bytes).await.map_err(|e| e.to_string())?;
        drop(input);
        let mut reply = Vec::new();
        output
            .read_to_end(&mut reply)
            .await
            .map_err(|e| e.to_string())?;
        let status = child.wait().await.map_err(|e| e.to_string())?;
        if !status.success() || reply.len() > 2048 {
            return Err("Background measurement failed".into());
        }
        serde_json::from_slice::<Result<f32, String>>(&reply)
            .map_err(|_| "Invalid measurement reply")?
    };
    let result = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(120), operation) => result.unwrap_or_else(|_| Err("Background measurement timed out".into())),
        _ = async {
            while !cancel.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        } => Err("Cancelled".into()),
    };
    if child.id().is_some() {
        let _ = child.kill().await;
    }
    result
}
const FAILURES_IN_A_ROW: usize = 4;
fn stopped_after_failures() -> String {
    "Stopped after four background measurements failed. Check the listed presets; completed measurements are kept.".into()
}

async fn run(shared: Arc<Shared>, all: bool) {
    let result = run_inner(&shared, all).await;
    shared.calibration.hold_playback(false);
    shared.calibration.update(|p| {
        p.running = false;
        p.current = None;
        if let Err(e) = result {
            p.error = Some(e);
        }
    });
    // Apply the updated correction only after the background run finishes.
    crate::boosts::follow(&shared).await;
}
async fn run_inner(shared: &Shared, all: bool) -> Result<(), String> {
    let native = shared.playback.snapshot();
    let rig = shared.rig_playback.snapshot();
    let mut stream = rig
        .configured
        .as_ref()
        .map(|c| c.stream.clone())
        .or_else(|| native.configured.as_ref().map(|c| c.stream.clone()))
        .ok_or("Choose the input, output and buffer in Settings → Audio first")?;
    stream.levels = shared.levels.current();
    let root = shared.config.preset_dir.clone();
    let items = tokio::task::spawn_blocking(move || inventory(&root))
        .await
        .map_err(|_| "Preset inventory failed")??;
    // Both playback owners replace stored stream levels with current unit levels.
    // A stopped owner may still carry an older channel mode in its configuration.
    let mono = stream.levels.mono;
    let visible: BTreeSet<&str> = items.iter().map(|item| item.key.as_str()).collect();
    let mut cached = shared.calibration.current();
    let cached_len = cached.measured.len();
    cached
        .measured
        .retain(|key, _| visible.contains(key.as_str()));
    if cached.measured.len() != cached_len {
        let store = shared.calibration.clone();
        let retained = cached.clone();
        tokio::task::spawn_blocking(move || store.save(retained))
            .await
            .map_err(|_| "Calibration cleanup failed")??;
    }
    let todo: Vec<Item> = items
        .into_iter()
        .filter(|item| {
            all || cached
                .measured
                .get(&item.key)
                .is_none_or(|m| m.content != measurement_content(&item.content, mono))
        })
        .collect();
    shared.calibration.update(|p| p.total = todo.len());
    if todo.is_empty() {
        return Ok(());
    }
    let mut outcome = Ok(());
    let mut in_a_row = 0;
    for item in todo {
        if outcome.is_err() {
            break;
        }
        if shared.calibration.cancel.load(Ordering::Acquire) {
            outcome = Err("Cancelled".to_string());
            break;
        }
        shared
            .calibration
            .update(|p| p.current = Some(item.name.clone()));
        let measured = measure(shared, item.target.clone(), &stream).await;
        if shared.calibration.cancel.load(Ordering::Acquire) {
            outcome = Err("Cancelled".into());
            break;
        }
        match measured {
            Ok(lufs) => {
                in_a_row = 0;
                let mut next = shared.calibration.current();
                next.measured.insert(
                    item.key.clone(),
                    Measured {
                        name: item.name.clone(),
                        content: measurement_content(&item.content, mono),
                        lufs,
                    },
                );
                let store = shared.calibration.clone();
                if let Ok(Err(e)) = tokio::task::spawn_blocking(move || store.save(next)).await {
                    outcome = Err(e);
                    break;
                }
                shared.calibration.update(|p| p.measured += 1);
            }
            // One preset that will not load or play is skipped, not fatal.
            Err(e) => {
                in_a_row += 1;
                shared.calibration.update(|p| {
                    p.failed.push(format!("{}: {e}", item.name));
                });
            }
        }
        shared.calibration.update(|p| p.done += 1);
        if in_a_row >= FAILURES_IN_A_ROW {
            outcome = Err(stopped_after_failures());
            break;
        }
    }
    outcome
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.calibration.state()),
    )
        .into_response()
}
pub(super) async fn coverage(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    let calibration = shared.calibration.current();
    let mono = shared.levels.current().mono;
    match tokio::task::spawn_blocking(move || {
        inventory(&root).map(|items| coverage_for(&calibration, &items, mono))
    })
    .await
    {
        Ok(Ok(coverage)) => ([(header::CACHE_CONTROL, "no-store")], Json(coverage)).into_response(),
        Ok(Err(error)) => failure(StatusCode::INTERNAL_SERVER_ERROR, &error),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Calibration coverage unavailable",
        ),
    }
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<CalibrationCommand>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid calibration command");
    };
    let running = shared.calibration.progress().running;
    match command.action {
        CalibrationAction::Run | CalibrationAction::RunAll => {
            if running {
                return failure(StatusCode::CONFLICT, "Already evening out");
            }
            shared.calibration.hold_playback(true);
            shared.calibration.cancel.store(false, Ordering::Release);
            shared.calibration.update(|p| {
                *p = Progress {
                    running: true,
                    ..Progress::default()
                }
            });
            let all = matches!(command.action, CalibrationAction::RunAll);
            tokio::spawn(run(shared.clone(), all));
        }
        CalibrationAction::Cancel => shared.calibration.cancel.store(true, Ordering::Release),
        CalibrationAction::Reset => {
            if running {
                return failure(StatusCode::CONFLICT, "Cancel evening out first");
            }
            let store = shared.calibration.clone();
            match tokio::task::spawn_blocking(move || store.save(Calibration::default())).await {
                Ok(Ok(())) => {
                    crate::boosts::follow(&shared).await;
                }
                Ok(Err(e)) => return failure(StatusCode::CONFLICT, &e),
                Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "Reset failed"),
            }
        }
    }
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.calibration.state()),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn background_reply_and_cancellation_reap_the_worker() {
        use std::os::unix::fs::PermissionsExt;
        let root =
            std::env::temp_dir().join(format!("oxidal-measure-process-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker");
        let probe = |direction| oxidal_audio::AudioProbe {
            endpoint: "unavailable".into(),
            direction,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::Float,
            period_frames: 256,
            periods: 3,
        };
        let request = Request {
            target: Target::Tone3000 {
                id: "test".into(),
                owned: false,
            },
            peak_db: -18.0,
            seconds: 4.0,
            stream: oxidal_audio::StreamConfig {
                hear_yourself: false,
                levels: Default::default(),
                input: probe(oxidal_audio::Direction::Capture),
                output: probe(oxidal_audio::Direction::Playback),
                input_map: [0, 1],
                output_map: [0, 1],
                venue: None,
            },
        };
        std::fs::write(
            &executable,
            "#!/bin/sh\nread request\nprintf '{\"Ok\":-24.5}'\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let cancel = AtomicBool::new(false);
        assert_eq!(
            render(&executable, &root, &request, &cancel).await.unwrap(),
            -24.5
        );
        std::fs::write(
            &executable,
            "#!/bin/sh\necho $$ > \"$OXIDAL_PRESET_DIR/pid\"\nexec sleep 30\n",
        )
        .unwrap();
        let stop = async {
            while !root.join("pid").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            cancel.store(true, Ordering::Release);
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(render(&executable, &root, &request, &cancel), stop)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "Cancelled");
        let pid = std::fs::read_to_string(root.join("pid")).unwrap();
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn playback_uses_previous_measurements_until_background_run_finishes() {
        let store = Store::load(std::env::temp_dir().join("oxidal-no-calibration-test.json"));
        *store.value.lock().unwrap() = measured(&[("a", -26.0), ("b", -20.0)]);
        store.hold_playback(true);
        *store.value.lock().unwrap() = measured(&[("a", -20.0), ("b", -20.0)]);
        assert_eq!(store.for_playback().offset("a"), Some(3.0));
        store.hold_playback(false);
        assert_eq!(store.for_playback().offset("a"), Some(0.0));
    }

    fn measured(lufs: &[(&str, f32)]) -> Calibration {
        Calibration {
            measured: lufs
                .iter()
                .map(|(k, v)| {
                    (
                        (*k).to_string(),
                        Measured {
                            name: (*k).into(),
                            content: "c".into(),
                            lufs: *v,
                        },
                    )
                })
                .collect(),
        }
    }
    #[test]
    fn repeated_background_failures_explain_that_completed_results_are_kept() {
        let message = stopped_after_failures();
        assert!(message.contains("background measurements failed"));
        assert!(message.contains("completed measurements are kept"));
    }

    #[test]
    fn offsets_use_the_median_when_every_sound_can_reach_it() {
        let c = measured(&[("clean", -26.0), ("crunch", -20.0), ("heavy", -14.0)]);
        assert_eq!(c.target(), Some(-20.0));
        assert_eq!(c.offset("clean"), Some(6.0));
        assert_eq!(c.offset("crunch"), Some(0.0));
        assert_eq!(c.offset("heavy"), Some(-6.0));
        assert_eq!(c.offset("unknown"), None);
        assert_eq!(c.total(&["heavy".into(), "missing".into()]), -6.0);
        let even = measured(&[("a", -30.0), ("b", -20.0)]);
        assert_eq!(even.target(), Some(-25.0));
        // A wild outlier moves the target down and uses the full bounded host
        // correction rather than claiming that the median was reached.
        let wild = measured(&[("quiet", -60.0), ("a", -20.0), ("b", -20.0)]);
        assert_eq!(wild.target(), Some(-36.0));
        assert_eq!(wild.offset("quiet"), Some(MAX_OFFSET_DB));
        assert_eq!(wild.offset("a"), Some(-16.0));
        assert_eq!(Calibration::default().target(), None);
        assert!(c.offset("crunch").unwrap().is_sign_positive());
    }

    #[test]
    fn reachable_target_evens_a_wide_library_inside_the_host_range() {
        let c = measured(&[
            ("broken-radio", -46.5),
            ("median", -17.9),
            ("studio-glass", -8.6),
        ]);
        assert_eq!(c.target(), Some(-22.5));
        for key in ["broken-radio", "median", "studio-glass"] {
            let corrected = c.measured[key].lufs + c.offset(key).unwrap();
            assert!((corrected + 22.5).abs() <= 0.25, "{key}: {corrected}");
        }
    }

    #[test]
    fn reference_revision_invalidates_personalized_measurements() {
        assert_eq!(
            measurement_content("preset-revision", false),
            "oxidal-factory-riff-v2:stereo:preset-revision"
        );
    }

    #[test]
    fn coverage_distinguishes_current_stale_and_unmeasured_items() {
        let mut calibration = measured(&[("current", -20.0), ("stale", -21.0)]);
        calibration.measured.get_mut("current").unwrap().content = measurement_content("c", false);
        let item = |key: &str, content: &str| Item {
            key: key.into(),
            name: key.into(),
            content: content.into(),
            target: Target::Tone3000 {
                id: key.into(),
                owned: false,
            },
        };
        assert_eq!(
            coverage_for(
                &calibration,
                &[
                    item("current", "c"),
                    item("stale", "changed"),
                    item("new", "new"),
                ],
                false,
            ),
            CalibrationCoverage {
                total: 3,
                measured: 1,
                stale: 1,
                unmeasured: 1,
            }
        );
    }
    #[test]
    fn scene_correction_replaces_an_older_whole_preset_correction() {
        let c = measured(&[("preset", -15.0), ("preset#scene", -25.0), ("other", -20.0)]);
        assert_eq!(c.total(&["preset".into(), "preset#scene".into()]), 5.0);
        assert_eq!(c.total(&["preset".into(), "unknown".into()]), -5.0);
        assert_ne!(
            measurement_content("same", true),
            measurement_content("same", false)
        );
    }
}
