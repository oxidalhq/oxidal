//! Deliberate loudness offsets: a few dB more for a solo preset or scene.
//! Kept on the unit beside the levels, keyed by what is playing, so originals
//! stay untouched and calibration never changes them. The daemon applies the
//! playing preset's and scene's boost at the host output after every change.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::{lifecycle::AudioPhase, tools::HostLevels};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};

const MAX_BOOSTS: usize = 512;

/// Stored boosts in dB by key: `tone3000:original:<sha256>`,
/// `tone3000:copy:<id>`, `scenes:<preset id>` and `scenes:<preset id>#<scene id>`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Boosts {
    pub boosts: BTreeMap<String, f32>,
}
/// Sets one boost; 0 dB removes it.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoostUpdate {
    pub key: String,
    pub boost_db: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoostState {
    pub boosts: BTreeMap<String, f32>,
    /// Keys of what is playing: the preset, then its scene when it has one.
    pub playing: Vec<String>,
    /// Their sum as applied at the output, clamped to −12…+12 dB.
    pub applied_db: f32,
}

fn valid_key(key: &str) -> bool {
    let id = |s: &str| {
        (1..=128).contains(&s.len())
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    };
    if let Some(rest) = key
        .strip_prefix("tone3000:original:")
        .or_else(|| key.strip_prefix("tone3000:copy:"))
    {
        return id(rest);
    }
    key.strip_prefix("scenes:")
        .is_some_and(|rest| match rest.split_once('#') {
            Some((preset, scene)) => id(preset) && id(scene),
            None => id(rest),
        })
}
fn valid_boost(db: f32) -> bool {
    let (lo, hi) = HostLevels::BOOST_RANGE;
    db.is_finite() && (lo..=hi).contains(&db)
}
impl Boosts {
    pub fn validate(&self) -> Result<(), String> {
        if self.boosts.len() > MAX_BOOSTS
            || !self
                .boosts
                .iter()
                .all(|(k, db)| valid_key(k) && valid_boost(*db) && *db != 0.0)
        {
            return Err("Up to 512 boosts of −12 to +12 dB for known preset or scene keys".into());
        }
        Ok(())
    }
    /// The sum for what is playing, in 0.5 dB steps within the boost range.
    pub fn total(&self, playing: &[String]) -> f32 {
        let (lo, hi) = HostLevels::BOOST_RANGE;
        playing
            .iter()
            .filter_map(|k| self.boosts.get(k))
            .sum::<f32>()
            .clamp(lo, hi)
    }
}

#[derive(Debug)]
pub(crate) struct Store {
    path: PathBuf,
    value: Mutex<Boosts>,
    /// Scenes preset revision → its stable preset id, read once per revision.
    ids: Mutex<HashMap<String, String>>,
}
impl Store {
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 65536)
            .and_then(|bytes| serde_json::from_slice::<Boosts>(&bytes).ok())
            .filter(|b| b.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: Mutex::new(value),
            ids: Mutex::new(HashMap::new()),
        }
    }
    fn current(&self) -> Boosts {
        self.value.lock().map(|b| b.clone()).unwrap_or_default()
    }
    fn save(&self, boosts: Boosts) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| "Boost store unavailable")?;
        let parent = self.path.parent().ok_or("Boost file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&boosts).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = boosts;
        Ok(())
    }
}

/// Keys of what is sounding now: one engine plays at a time.
async fn playing(shared: &Shared) -> Vec<String> {
    let native = shared.playback.snapshot();
    if native.phase == AudioPhase::Running
        && let Some(c) = native.configured.filter(|c| !c.draft)
    {
        let kind = if c.owned { "copy" } else { "original" };
        return vec![format!("tone3000:{kind}:{}", c.preset_id)];
    }
    let rig = shared.rig_playback.snapshot();
    let (Some(configured), AudioPhase::Running) = (rig.configured, rig.phase) else {
        return Vec::new();
    };
    let revision = configured.revision;
    let cached = shared
        .boosts
        .ids
        .lock()
        .ok()
        .and_then(|ids| ids.get(&revision).cloned());
    let id = match cached {
        Some(id) => id,
        None => {
            let root = shared.config.preset_dir.join("bundles");
            let lookup = revision.clone();
            let Ok(Ok(manifest)) = tokio::task::spawn_blocking(move || {
                oxidal_presets::BundleStore::new(root).manifest(&lookup)
            })
            .await
            else {
                return Vec::new();
            };
            if let Ok(mut ids) = shared.boosts.ids.lock() {
                ids.insert(revision, manifest.id.clone());
            }
            manifest.id
        }
    };
    let preset = format!("scenes:{id}");
    match rig.control.and_then(|c| c.scene) {
        Some(scene) => vec![preset.clone(), format!("{preset}#{scene}")],
        None => vec![preset],
    }
}

/// Applies the playing preset's and scene's boost when it differs from the
/// output's. Called after every confirmed playback command and boost change.
pub(crate) async fn follow(shared: &Shared) -> BoostState {
    let playing = playing(shared).await;
    let boosts = shared.boosts.current();
    let applied_db = boosts.total(&playing);
    let current = shared.levels.current();
    if current.boost_db != applied_db {
        let levels = HostLevels {
            boost_db: applied_db,
            ..current
        };
        // A stopped unit has nothing to change, and a refused change is
        // retried by the next command; neither may fail the caller.
        let _ = crate::levels::apply_running(shared, levels).await;
    }
    BoostState {
        boosts: boosts.boosts,
        playing,
        applied_db,
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    let state = follow(&shared).await;
    ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response()
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<BoostUpdate>, JsonRejection>,
) -> Response {
    let Ok(Json(update)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid boost");
    };
    if !valid_key(&update.key) || !valid_boost(update.boost_db) {
        return failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Boost must be −12 to +12 dB for a preset or scene key",
        );
    }
    let mut next = shared.boosts.current();
    let db = (update.boost_db * 2.0).round() / 2.0;
    if db == 0.0 {
        next.boosts.remove(&update.key);
    } else {
        next.boosts.insert(update.key, db);
    }
    if let Err(e) = next.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    let store = shared.boosts.clone();
    match tokio::task::spawn_blocking(move || store.save(next)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return failure(StatusCode::CONFLICT, &e),
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "Boost task failed"),
    }
    let state = follow(&shared).await;
    ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_name_presets_and_scenes_only() {
        for key in [
            "tone3000:original:03a70cd3f5a52caf",
            "tone3000:copy:abc-123",
            "scenes:f9a3d633-fa4c-40fc-ad66-8591a9508baf",
            "scenes:f9a3d633#native-7bad0a5e",
        ] {
            assert!(valid_key(key), "{key}");
        }
        for key in [
            "",
            "tone3000:x",
            "scenes:",
            "scenes:a#",
            "scenes:a b",
            "other:a",
        ] {
            assert!(!valid_key(key), "{key}");
        }
    }
    #[test]
    fn the_playing_preset_and_scene_add_up_within_range() {
        let boosts = Boosts {
            boosts: BTreeMap::from([
                ("scenes:p".into(), 2.0),
                ("scenes:p#solo".into(), 3.0),
                ("scenes:q".into(), 12.0),
                ("scenes:q#solo".into(), 6.0),
            ]),
        };
        assert!(boosts.validate().is_ok());
        assert_eq!(
            boosts.total(&["scenes:p".into(), "scenes:p#solo".into()]),
            5.0
        );
        assert_eq!(
            boosts.total(&["scenes:p".into(), "scenes:p#clean".into()]),
            2.0
        );
        assert_eq!(
            boosts.total(&["scenes:q".into(), "scenes:q#solo".into()]),
            12.0
        );
        assert_eq!(boosts.total(&[]), 0.0);
        let mut bad = boosts.clone();
        bad.boosts.insert("scenes:r".into(), 13.0);
        assert!(bad.validate().is_err());
    }
}
