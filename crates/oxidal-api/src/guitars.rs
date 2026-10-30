//! Guitar profiles: one measured input level per instrument, so every guitar
//! reaches the rig at the same level. Unit-wide, never stored in presets.
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Guitar {
    pub id: String,
    pub name: String,
    /// Peak of the player's loudest stage strum, before any trim, in dBFS.
    pub peak_dbfs: Option<f32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Guitars {
    pub guitars: Vec<Guitar>,
    /// The guitar presets were set up with; it plays with no trim.
    pub reference: Option<String>,
    pub active: Option<String>,
    /// 0 matches every guitar exactly; 1 keeps each guitar's natural output.
    pub character: f32,
}

impl Guitars {
    pub fn validate(&self) -> Result<(), String> {
        let known = |id: &Option<String>| {
            id.as_ref()
                .is_none_or(|id| self.guitars.iter().any(|g| &g.id == id))
        };
        let mut ids = std::collections::HashSet::new();
        if self.guitars.len() > MAX_GUITARS
            || !self.character.is_finite()
            || !(0.0..=1.0).contains(&self.character)
            || !known(&self.reference)
            || !known(&self.active)
            || !self.guitars.iter().all(|g| {
                ids.insert(g.id.as_str())
                    && (1..=64).contains(&g.id.len())
                    && g.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    && (1..=40).contains(&g.name.chars().count())
                    && !g.name.chars().any(char::is_control)
                    && g.peak_dbfs
                        .is_none_or(|p| p.is_finite() && (-120.0..=0.0).contains(&p))
            })
        {
            return Err("Up to 16 guitars with unique ids, names of 1–40 characters, peaks −120 to 0 dBFS and character 0–1".into());
        }
        Ok(())
    }
    /// Input trim for the active guitar: the gap to the reference guitar's
    /// peak, scaled down by character. Unmeasured guitars play untrimmed.
    pub fn trim_db(&self) -> f32 {
        let peak = |id: &Option<String>| {
            id.as_ref()
                .and_then(|id| self.guitars.iter().find(|g| &g.id == id))
                .and_then(|g| g.peak_dbfs)
        };
        match (peak(&self.reference), peak(&self.active)) {
            (Some(reference), Some(active)) => {
                let (lo, hi) = HostLevels::INPUT_RANGE;
                let trim = (reference - active) * (1.0 - self.character);
                ((trim * 2.0).round() / 2.0).clamp(lo, hi)
            }
            _ => 0.0,
        }
    }
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
            .and_then(|bytes| serde_json::from_slice::<Guitars>(&bytes).ok())
            .filter(|g| g.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: std::sync::Mutex::new(value),
        }
    }
    fn current(&self) -> Guitars {
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
    let levels = HostLevels {
        input_trim_db: guitars.trim_db(),
        ..shared.levels.current()
    };
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
    fn guitar(id: &str, peak: Option<f32>) -> Guitar {
        Guitar {
            id: id.into(),
            name: id.into(),
            peak_dbfs: peak,
        }
    }
    #[test]
    fn trim_matches_the_reference_guitar_scaled_by_character() {
        let mut g = Guitars {
            guitars: vec![
                guitar("jiva", Some(-8.0)),
                guitar("steinberger", Some(-14.3)),
            ],
            reference: Some("jiva".into()),
            active: Some("steinberger".into()),
            character: 0.0,
        };
        assert!(g.validate().is_ok());
        assert_eq!(g.trim_db(), 6.5);
        g.character = 0.5;
        assert_eq!(g.trim_db(), 3.0);
        g.character = 1.0;
        assert_eq!(g.trim_db(), 0.0);
        g.active = Some("jiva".into());
        assert_eq!(g.trim_db(), 0.0);
        g.guitars[1].peak_dbfs = None;
        g.active = Some("steinberger".into());
        assert_eq!(g.trim_db(), 0.0);
        g.guitars[1].peak_dbfs = Some(-110.0);
        g.character = 0.0;
        assert_eq!(g.trim_db(), 24.0);
    }
    #[test]
    fn rejects_unknown_references_duplicates_and_bad_values() {
        let base = Guitars {
            guitars: vec![guitar("a", None)],
            reference: None,
            active: Some("a".into()),
            character: 0.0,
        };
        assert!(base.validate().is_ok());
        let mut bad = base.clone();
        bad.active = Some("b".into());
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.guitars.push(guitar("a", None));
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.character = 1.5;
        assert!(bad.validate().is_err());
        let mut bad = base.clone();
        bad.guitars[0].peak_dbfs = Some(3.0);
        assert!(bad.validate().is_err());
        let mut bad = base;
        bad.guitars[0].name = String::new();
        assert!(bad.validate().is_err());
    }
}
