//! Even out all: plays the built-in reference riff through every TONE3000
//! preset and every scene of each preset with scenes, measures the loudness
//! the rig makes of it, and keeps an offset per preset or scene so they all
//! land at the same loudness. Measurements are cached by preset content, so a
//! later run measures only what is new or changed. The run is silent (the host
//! mutes its output while the riff plays) and puts back whatever was playing.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::{
    lifecycle::{AudioAction, AudioCommand, AudioPhase, StartAudio},
    tools::HostUtility,
};
use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand, SceneCommand, StartRig};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
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
/// Offsets are kept within this, so one odd preset cannot swing the output.
const MAX_OFFSET_DB: f32 = 12.0;
/// A typical humbucker strum when no guitar has been measured.
const DEFAULT_PEAK_DB: f32 = -12.0;

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
    /// The loudness every preset is evened out to: the median of all measured,
    /// so the unit as a whole stays about as loud as it was.
    pub fn target(&self) -> Option<f32> {
        let mut values: Vec<f32> = self.measured.values().map(|m| m.lufs).collect();
        if values.is_empty() {
            return None;
        }
        values.sort_by(f32::total_cmp);
        let middle = values.len() / 2;
        Some(if values.len().is_multiple_of(2) {
            (values[middle - 1] + values[middle]) / 2.0
        } else {
            values[middle]
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
        playing
            .iter()
            .filter_map(|k| self.offset(k))
            .fold(0.0, |sum, db| sum + db)
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationAction {
    /// Measure every preset and scene that is new or changed since last time.
    Run,
    /// Measure every preset and scene again.
    RunAll,
    /// Stop after the current measurement and put back what was playing.
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
            cancel: AtomicBool::new(false),
        }
    }
    pub(crate) fn current(&self) -> Calibration {
        self.value.lock().map(|v| v.clone()).unwrap_or_default()
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

/// Something to measure: a TONE3000 preset, or one scene of a preset with scenes.
#[derive(Debug, Clone)]
enum Target {
    Tone3000 { id: String, owned: bool },
    Scene { revision: String, scene: String },
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
        let Some(scenes) = manifest.scenes().ok().flatten().filter(|_| !draft) else {
            continue;
        };
        let preset = catalog
            .label(LibraryKind::Rig, &revision, &manifest.name)
            .map_err(text)?
            .to_owned();
        for scene in scenes.scenes {
            items.push(Item {
                key: crate::boosts::key_scene(&manifest.id, &scene.id),
                name: format!("{preset} · {}", scene.name),
                content: revision.clone(),
                target: Target::Scene {
                    revision: revision.clone(),
                    scene: scene.id,
                },
            });
        }
    }
    Ok(items)
}

async fn until(
    what: &str,
    timeout: Duration,
    mut ready: impl FnMut() -> bool,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + timeout;
    while !ready() {
        if tokio::time::Instant::now() > deadline {
            return Err(format!("{what} took too long"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}
async fn stop_native(shared: &Shared) -> Result<(), String> {
    let s = shared.playback.snapshot();
    if s.device_owned {
        shared
            .playback
            .dispatch(AudioCommand {
                session: s.session,
                expected_revision: s.revision,
                action: AudioAction::Stop,
            })
            .await?;
        until(
            "Stopping the TONE3000 preset",
            Duration::from_secs(10),
            || !shared.playback.snapshot().device_owned,
        )
        .await?;
    }
    Ok(())
}
async fn stop_rig(shared: &Shared) -> Result<(), String> {
    let s = shared.rig_playback.snapshot();
    if s.device_owned {
        shared
            .rig_playback
            .dispatch(RigAudioCommand {
                session: s.session,
                expected_revision: s.revision,
                action: RigAudioAction::Stop,
            })
            .await?;
        until(
            "Stopping the preset with scenes",
            Duration::from_secs(10),
            || !shared.rig_playback.snapshot().device_owned,
        )
        .await?;
    }
    Ok(())
}
async fn play_tone3000(
    shared: &Shared,
    id: &str,
    owned: bool,
    stream: &oxidal_audio::StreamConfig,
) -> Result<(), String> {
    stop_rig(shared).await?;
    let s = shared.playback.snapshot();
    let action = if s.configured.is_some() {
        AudioAction::LoadPreset {
            preset_id: id.into(),
            owned,
        }
    } else {
        AudioAction::Start {
            settings: StartAudio {
                midi: None,
                stream: stream.clone(),
                preset_id: id.into(),
                owned,
                draft: false,
                working: None,
            },
        }
    };
    shared
        .playback
        .dispatch(AudioCommand {
            session: s.session,
            expected_revision: s.revision,
            action,
        })
        .await?;
    until("Loading the preset", Duration::from_secs(20), || {
        let s = shared.playback.snapshot();
        s.phase == AudioPhase::Running
            && s.configured
                .as_ref()
                .is_some_and(|c| c.preset_id == id && c.owned == owned)
    })
    .await
}
async fn play_scene(
    shared: &Shared,
    revision: &str,
    scene: &str,
    stream: &oxidal_audio::StreamConfig,
) -> Result<(), String> {
    let s = shared.rig_playback.snapshot();
    let loaded = s.phase == AudioPhase::Running
        && s.configured
            .as_ref()
            .is_some_and(|c| c.revision == revision);
    if !loaded {
        stop_native(shared).await?;
        stop_rig(shared).await?;
        let s = shared.rig_playback.snapshot();
        shared
            .rig_playback
            .dispatch(RigAudioCommand {
                session: s.session,
                expected_revision: s.revision,
                action: RigAudioAction::Start {
                    settings: Box::new(StartRig {
                        revision: revision.into(),
                        stream: stream.clone(),
                        recall: None,
                        prepared: Vec::new(),
                        midi: None,
                    }),
                },
            })
            .await?;
        until(
            "Loading the preset with scenes",
            Duration::from_secs(30),
            || {
                let s = shared.rig_playback.snapshot();
                s.phase == AudioPhase::Running && s.control.is_some()
            },
        )
        .await?;
    }
    select_scene(shared, scene).await
}
async fn select_scene(shared: &Shared, scene: &str) -> Result<(), String> {
    let s = shared.rig_playback.snapshot();
    let control = s.control.ok_or("The preset with scenes is not running")?;
    if control.scene.as_deref() != Some(scene) {
        shared
            .rig_playback
            .dispatch(RigAudioCommand {
                session: s.session,
                expected_revision: s.revision,
                action: RigAudioAction::Scene {
                    command: SceneCommand {
                        session: control.session,
                        expected_revision: control.revision,
                        scene: scene.into(),
                    },
                },
            })
            .await?;
    }
    until("Switching scene", Duration::from_secs(10), || {
        shared
            .rig_playback
            .snapshot()
            .control
            .is_some_and(|c| c.scene.as_deref() == Some(scene) && !c.scene_transitioning)
    })
    .await
}
/// Sends a host utility to whichever engine plays.
async fn host(shared: &Shared, command: HostUtility) -> Result<(), String> {
    let native = shared.playback.snapshot();
    if native.phase == AudioPhase::Running {
        return shared
            .playback
            .dispatch(AudioCommand {
                session: native.session,
                expected_revision: native.revision,
                action: AudioAction::HostUtility { command },
            })
            .await
            .map(|_| ());
    }
    let rig = shared.rig_playback.snapshot();
    shared
        .rig_playback
        .dispatch(RigAudioCommand {
            session: rig.session,
            expected_revision: rig.revision,
            action: RigAudioAction::HostUtility { command },
        })
        .await
        .map(|_| ())
}
fn reading(shared: &Shared) -> Option<oxidal_audio::reference::ReferenceReading> {
    let native = shared.playback.snapshot();
    let telemetry = if native.phase == AudioPhase::Running {
        shared.playback.telemetry().map(|t| t.0)
    } else {
        shared.rig_playback.snapshot().telemetry
    };
    telemetry?.monitoring?.reference
}
/// Plays the riff into whatever is loaded and returns its loudness.
async fn measure(shared: &Shared, peak_db: f32) -> Result<f32, String> {
    host(
        shared,
        HostUtility::Reference {
            enabled: true,
            peak_db,
        },
    )
    .await?;
    let measured = until("Measuring", Duration::from_secs(15), || {
        reading(shared).is_some_and(|r| r.seconds >= MEASURE_SECONDS)
    })
    .await
    .and_then(|()| {
        reading(shared)
            .and_then(|r| r.lufs)
            .filter(|v| v.is_finite())
            .ok_or_else(|| "The preset made no sound from the reference riff".to_string())
    });
    // Always back to the guitar, even when the measurement failed.
    let stopped = host(
        shared,
        HostUtility::Reference {
            enabled: false,
            peak_db,
        },
    )
    .await;
    let lufs = measured?;
    stopped?;
    Ok(lufs)
}

/// What was playing before the run, to put back afterwards.
#[derive(Debug)]
enum Playing {
    Nothing,
    Tone3000 {
        id: String,
        owned: bool,
    },
    Scenes {
        start: Box<StartRig>,
        scene: Option<String>,
    },
}
async fn restore(shared: &Shared, playing: Playing, stream: &oxidal_audio::StreamConfig) {
    let result = match playing {
        Playing::Nothing => {
            async {
                stop_native(shared).await?;
                stop_rig(shared).await
            }
            .await
        }
        Playing::Tone3000 { id, owned } => play_tone3000(shared, &id, owned, stream).await,
        Playing::Scenes { start, scene } => {
            async {
                stop_native(shared).await?;
                stop_rig(shared).await?;
                let s = shared.rig_playback.snapshot();
                // The saved settings carry unsaved edits (`recall`), so they come back.
                shared
                    .rig_playback
                    .dispatch(RigAudioCommand {
                        session: s.session,
                        expected_revision: s.revision,
                        action: RigAudioAction::Start { settings: start },
                    })
                    .await?;
                until(
                    "Restoring the preset with scenes",
                    Duration::from_secs(30),
                    || {
                        let s = shared.rig_playback.snapshot();
                        s.phase == AudioPhase::Running && s.control.is_some()
                    },
                )
                .await?;
                match scene {
                    Some(scene) => select_scene(shared, &scene).await,
                    None => Ok(()),
                }
            }
            .await
        }
    };
    if let Err(e) = result {
        shared.calibration.update(|p| {
            p.error
                .get_or_insert(format!("Could not restore what was playing: {e}"));
        });
    }
    crate::boosts::follow(shared).await;
}

async fn run(shared: Arc<Shared>, all: bool) {
    let result = run_inner(&shared, all).await;
    shared.calibration.update(|p| {
        p.running = false;
        p.current = None;
        if let Err(e) = result {
            p.error = Some(e);
        }
    });
}
async fn run_inner(shared: &Shared, all: bool) -> Result<(), String> {
    if shared.graph_playback.snapshot().device_owned {
        return Err("Stop the effects preset before evening out".into());
    }
    let native = shared.playback.snapshot();
    let rig = shared.rig_playback.snapshot();
    let stream = native
        .configured
        .as_ref()
        .map(|c| c.stream.clone())
        .or_else(|| rig.configured.as_ref().map(|c| c.stream.clone()))
        .ok_or("Choose the input, output and buffer in Settings → Audio first")?;
    let playing = if native.phase == AudioPhase::Running
        && let Some(c) = native.configured.as_ref().filter(|c| !c.draft)
    {
        Playing::Tone3000 {
            id: c.preset_id.clone(),
            owned: c.owned,
        }
    } else if rig.phase == AudioPhase::Running
        && let Some(c) = rig.configured.clone()
    {
        Playing::Scenes {
            start: Box::new(c),
            scene: rig.control.and_then(|c| c.scene),
        }
    } else {
        Playing::Nothing
    };
    let root = shared.config.preset_dir.clone();
    let items = tokio::task::spawn_blocking(move || inventory(&root))
        .await
        .map_err(|_| "Preset inventory failed")??;
    let cached = shared.calibration.current();
    let todo: Vec<Item> = items
        .into_iter()
        .filter(|item| {
            all || cached
                .measured
                .get(&item.key)
                .is_none_or(|m| m.content != item.content)
        })
        .collect();
    shared.calibration.update(|p| p.total = todo.len());
    if todo.is_empty() {
        return Ok(());
    }
    // The riff stands in for the reference guitar as it reaches the rig.
    let guitars = shared.guitars.current();
    let peak_db = guitars
        .reference
        .as_ref()
        .and_then(|id| guitars.guitars.iter().find(|g| &g.id == id))
        .and_then(|g| g.peak_dbfs.map(|p| p + g.trim_db))
        .unwrap_or(DEFAULT_PEAK_DB)
        .clamp(-30.0, -3.0);
    let mut outcome = Ok(());
    for item in todo {
        if shared.calibration.cancel.load(Ordering::Acquire) {
            outcome = Err("Cancelled".to_string());
            break;
        }
        shared
            .calibration
            .update(|p| p.current = Some(item.name.clone()));
        let measured = async {
            match &item.target {
                Target::Tone3000 { id, owned } => {
                    play_tone3000(shared, id, *owned, &stream).await?
                }
                Target::Scene { revision, scene } => {
                    play_scene(shared, revision, scene, &stream).await?
                }
            }
            measure(shared, peak_db).await
        }
        .await;
        match measured {
            Ok(lufs) => {
                let mut next = shared.calibration.current();
                next.measured.insert(
                    item.key.clone(),
                    Measured {
                        name: item.name.clone(),
                        content: item.content.clone(),
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
            Err(e) => shared.calibration.update(|p| {
                p.error = Some(format!("{}: {e}", item.name));
            }),
        }
        shared.calibration.update(|p| p.done += 1);
    }
    restore(shared, playing, &stream).await;
    outcome
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.calibration.state()),
    )
        .into_response()
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<CalibrationCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid calibration command");
    };
    let running = shared.calibration.progress().running;
    match command.action {
        CalibrationAction::Run | CalibrationAction::RunAll => {
            if running {
                return failure(StatusCode::CONFLICT, "Already evening out");
            }
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
    fn offsets_bring_every_preset_to_the_median() {
        let c = measured(&[("clean", -26.0), ("crunch", -20.0), ("heavy", -14.0)]);
        assert_eq!(c.target(), Some(-20.0));
        assert_eq!(c.offset("clean"), Some(6.0));
        assert_eq!(c.offset("crunch"), Some(0.0));
        assert_eq!(c.offset("heavy"), Some(-6.0));
        assert_eq!(c.offset("unknown"), None);
        assert_eq!(c.total(&["heavy".into(), "missing".into()]), -6.0);
        let even = measured(&[("a", -30.0), ("b", -20.0)]);
        assert_eq!(even.target(), Some(-25.0));
        // A wild outlier is limited, never a huge jump.
        let wild = measured(&[("quiet", -60.0), ("a", -20.0), ("b", -20.0)]);
        assert_eq!(wild.offset("quiet"), Some(MAX_OFFSET_DB));
        assert_eq!(Calibration::default().target(), None);
        assert!(c.offset("crunch").unwrap().is_sign_positive());
    }
}
