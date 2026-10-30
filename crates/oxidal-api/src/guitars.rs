//! Guitar profiles: one input trim and noise gate per instrument, so every
//! guitar reaches the rig at the same level and only as quiet as it can.
//! The trim is a plain number; measuring a strum only suggests it. Unit-wide, never stored in presets.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::tools::HostLevels;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Arc};

const MAX_GUITARS: usize = 16;
const GATE_MARGIN_DB: f32 = 6.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Guitar {
    pub id: String,
    pub name: String,
    /// Input trim for this guitar in dB (−24 to +24), applied before every rig.
    #[serde(default)]
    pub trim_db: f32,
    /// Peak of the player's loudest stage strum, before any trim, in dBFS.
    pub peak_dbfs: Option<f32>,
    /// Peak hiss and hum with the strings muted, before any trim, in dBFS.
    #[serde(default)]
    pub noise_dbfs: Option<f32>,
    /// Gate this guitar just above its measured noise.
    #[serde(default)]
    pub gate: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Guitars {
    pub guitars: Vec<Guitar>,
    /// The guitar presets were set up with: Measure matches others to its strum.
    pub reference: Option<String>,
    pub active: Option<String>,
}

impl Guitars {
    pub fn validate(&self) -> Result<(), String> {
        let known = |id: &Option<String>| {
            id.as_ref()
                .is_none_or(|id| self.guitars.iter().any(|g| &g.id == id))
        };
        let mut ids = std::collections::HashSet::new();
        let (lo, hi) = HostLevels::INPUT_RANGE;
        if self.guitars.len() > MAX_GUITARS
            || !known(&self.reference)
            || !known(&self.active)
            || !self.guitars.iter().all(|g| {
                ids.insert(g.id.as_str())
                    && (1..=64).contains(&g.id.len())
                    && g.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    && (1..=40).contains(&g.name.chars().count())
                    && !g.name.chars().any(char::is_control)
                    && g.trim_db.is_finite()
                    && (lo..=hi).contains(&g.trim_db)
                    && [g.peak_dbfs, g.noise_dbfs]
                        .iter()
                        .flatten()
                        .all(|p| p.is_finite() && (-120.0..=0.0).contains(p))
            })
        {
            return Err("Up to 16 guitars with unique ids, names of 1–40 characters, trims −24 to +24 dB and levels −120 to 0 dBFS".into());
        }
        Ok(())
    }
    /// Input trim for the active guitar; none chosen plays untrimmed.
    pub fn trim_db(&self) -> f32 {
        self.active
            .as_ref()
            .and_then(|id| self.guitars.iter().find(|g| &g.id == id))
            .map_or(0.0, |g| g.trim_db)
    }
    /// Levels with the fields this store owns: the active guitar's trim, and
    /// its gate. A view holding older levels can never undo a guitar switch.
    pub fn own(&self, levels: HostLevels) -> HostLevels {
        HostLevels {
            input_trim_db: if self.active.is_some() {
                self.trim_db()
            } else {
                levels.input_trim_db
            },
            gate_db: self.gate_db(),
            ..levels
        }
    }
    /// Gate threshold for the active guitar: its noise peak plus the trim it
    /// plays with, and a 6 dB margin so hiss never flickers the gate open.
    pub fn gate_db(&self) -> Option<f32> {
        let (lo, hi) = HostLevels::GATE_RANGE;
        self.active
            .as_ref()
            .and_then(|id| self.guitars.iter().find(|g| &g.id == id))
            .filter(|g| g.gate)
            .and_then(|g| g.noise_dbfs)
            .map(|noise| {
                (noise + self.trim_db() + GATE_MARGIN_DB)
                    .round()
                    .clamp(lo, hi)
            })
    }
}

/// Profiles saved before trims were stored per guitar carry a reference peak
/// and a character amount instead; turn them into the trims they produced.
fn migrate(mut value: serde_json::Value) -> Option<Guitars> {
    let object = value.as_object_mut()?;
    let character = object
        .remove("character")
        .and_then(|c| c.as_f64())
        .unwrap_or(0.0) as f32;
    let reference = object
        .get("reference")
        .and_then(|r| r.as_str())
        .map(str::to_owned);
    let peak = |g: &serde_json::Value| g.get("peak_dbfs").and_then(|p| p.as_f64());
    let guitars = object.get_mut("guitars")?.as_array_mut()?;
    let reference_peak = guitars
        .iter()
        .find(|g| g.get("id").and_then(|i| i.as_str()) == reference.as_deref())
        .and_then(peak);
    for guitar in guitars.iter_mut() {
        if guitar.get("trim_db").is_some() {
            continue;
        }
        let trim = match (reference_peak, peak(guitar)) {
            (Some(r), Some(p)) => {
                let (lo, hi) = HostLevels::INPUT_RANGE;
                (((r - p) as f32 * (1.0 - character) * 2.0).round() / 2.0).clamp(lo, hi)
            }
            _ => 0.0,
        };
        guitar
            .as_object_mut()?
            .insert("trim_db".into(), trim.into());
    }
    serde_json::from_value(value).ok()
}

#[derive(Debug)]
pub(crate) struct Store {
    path: PathBuf,
    value: std::sync::Mutex<Guitars>,
}
impl Store {
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 16384)
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(migrate)
            .filter(|g| g.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: std::sync::Mutex::new(value),
        }
    }
    pub(crate) fn current(&self) -> Guitars {
        self.value.lock().map(|g| g.clone()).unwrap_or_default()
    }
    fn save(&self, guitars: Guitars) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| "Guitar store unavailable")?;
        let parent = self.path.parent().ok_or("Guitar file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&guitars).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = guitars;
        Ok(())
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.guitars.current()),
    )
        .into_response()
}
/// Saves the profiles and applies the active guitar's trim to the unit levels,
/// live on a running engine as well as for later starts.
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Guitars>, JsonRejection>,
) -> Response {
    let Ok(Json(guitars)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid guitar profiles");
    };
    if let Err(e) = guitars.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    let levels = guitars.own(HostLevels {
        ..shared.levels.current()
    });
    if let Err(e) = crate::levels::apply_running(&shared, levels).await {
        return failure(StatusCode::CONFLICT, &e);
    }
    let (store, unit) = (shared.guitars.clone(), shared.levels.clone());
    match tokio::task::spawn_blocking(move || {
        unit.save(levels)?;
        store.save(guitars)?;
        Ok::<_, String>(store.current())
    })
    .await
    {
        Ok(Ok(saved)) => ([(header::CACHE_CONTROL, "no-store")], Json(saved)).into_response(),
        Ok(Err(e)) => failure(StatusCode::CONFLICT, &e),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Guitar task failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn guitar(id: &str, trim_db: f32) -> Guitar {
        Guitar {
            id: id.into(),
            name: id.into(),
            trim_db,
            peak_dbfs: None,
            noise_dbfs: None,
            gate: false,
        }
    }
    fn profiles() -> Guitars {
        Guitars {
            guitars: vec![guitar("jiva", 0.0), guitar("steinberger", 4.0)],
            reference: None,
            active: Some("steinberger".into()),
        }
    }
    #[test]
    fn the_active_guitar_plays_with_its_own_trim() {
        let mut g = profiles();
        assert!(g.validate().is_ok());
        assert_eq!(g.trim_db(), 4.0);
        g.active = Some("jiva".into());
        assert_eq!(g.trim_db(), 0.0);
        g.active = None;
        assert_eq!(g.trim_db(), 0.0);
        // Without an active guitar the posted trim stands.
        let posted = HostLevels {
            input_trim_db: -3.0,
            ..HostLevels::default()
        };
        assert_eq!(g.own(posted).input_trim_db, -3.0);
    }
    #[test]
    fn gate_sits_above_the_active_guitars_trimmed_noise() {
        let mut g = profiles();
        g.guitars[1].noise_dbfs = Some(-70.0);
        g.guitars[1].gate = true;
        // −70 noise, +4 trim, +6 margin.
        assert_eq!(g.gate_db(), Some(-60.0));
        g.guitars[1].gate = false;
        assert_eq!(g.gate_db(), None);
        g.guitars[1].gate = true;
        g.guitars[1].noise_dbfs = Some(-118.0);
        assert_eq!(g.gate_db(), Some(-96.0));
        g.active = Some("jiva".into());
        assert_eq!(g.gate_db(), None);
        g.guitars[1].noise_dbfs = Some(1.0);
        assert!(g.validate().is_err());
    }
    #[test]
    fn rejects_unknown_references_duplicates_and_bad_values() {
        let base = profiles();
        let mut bad = base.clone();
        bad.active = Some("strat".into());
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.guitars.push(guitar("jiva", 0.0));
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.guitars[0].trim_db = 24.5;
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.guitars[0].peak_dbfs = Some(3.0);
        assert!(bad.validate().is_err());
        let mut bad = base;
        bad.guitars[0].name = String::new();
        assert!(bad.validate().is_err());
    }
    #[test]
    fn older_profiles_keep_the_trim_they_played_with() {
        let old = serde_json::json!({
            "guitars": [
                {"id": "jiva", "name": "Jiva", "peak_dbfs": -8.0},
                {"id": "steinberger", "name": "Steinberger", "peak_dbfs": -14.3},
                {"id": "jericho", "name": "Jericho", "peak_dbfs": null}
            ],
            "reference": "jiva",
            "active": "steinberger",
            "character": 0.0
        });
        let g = migrate(old).unwrap();
        assert!(g.validate().is_ok());
        let trims: Vec<f32> = g.guitars.iter().map(|g| g.trim_db).collect();
        assert_eq!(trims, [0.0, 6.5, 0.0]);
        assert_eq!(g.trim_db(), 6.5);
        // Current files pass through unchanged.
        let current = serde_json::to_value(&g).unwrap();
        assert_eq!(migrate(current).unwrap(), g);
    }
}
