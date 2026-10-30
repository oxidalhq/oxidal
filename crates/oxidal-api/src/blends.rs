//! How a preset with scenes changes scene. By default the incoming scene opens
//! at the preset's own short fade and the outgoing one stops getting guitar,
//! so its delay and reverb tails ring out (trails). A blend instead keeps the
//! whole outgoing scene sounding while it fades out over a few seconds. Kept
//! on the unit by preset id, like boosts, and applied by the daemon to every
//! scene change it forwards.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_engine::protocol::{MAX_RELEASE_MS, RigAudioAction, RigAudioCommand};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc, sync::Mutex};

const MAX_BLENDS: usize = 256;

/// Blend times in ms by scene preset id; a preset without one trails.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Blends {
    pub blends: BTreeMap<String, u32>,
}
/// Sets one preset's blend; 0 returns it to trails.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BlendUpdate {
    pub preset: String,
    pub blend_ms: u32,
}
fn valid_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
impl Blends {
    pub fn validate(&self) -> Result<(), String> {
        if self.blends.len() > MAX_BLENDS
            || !self
                .blends
                .iter()
                .all(|(id, ms)| valid_id(id) && (1..=MAX_RELEASE_MS).contains(ms))
        {
            return Err("Up to 256 blends of 1 ms to 10 s for known presets".into());
        }
        Ok(())
    }
}

#[derive(Debug)]
pub(crate) struct Store {
    path: PathBuf,
    value: Mutex<Blends>,
}
impl Store {
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 65536)
            .and_then(|bytes| serde_json::from_slice::<Blends>(&bytes).ok())
            .filter(|b| b.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: Mutex::new(value),
        }
    }
    fn current(&self) -> Blends {
        self.value.lock().map(|b| b.clone()).unwrap_or_default()
    }
    fn save(&self, blends: Blends) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| "Blend store unavailable")?;
        let parent = self.path.parent().ok_or("Blend file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&blends).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = blends;
        Ok(())
    }
}

/// Gives a scene change from a view the playing preset's blend, unless the
/// command already chose its own release.
pub(crate) async fn apply(shared: &Shared, command: &mut RigAudioCommand) {
    let RigAudioAction::Scene { command: scene } = &mut command.action else {
        return;
    };
    if scene.release_ms.is_some() {
        return;
    }
    let Some(revision) = shared
        .rig_playback
        .snapshot()
        .configured
        .map(|c| c.revision)
    else {
        return;
    };
    if let Some(id) = crate::boosts::preset_id(shared, revision).await {
        scene.release_ms = shared.blends.current().blends.get(&id).copied();
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.blends.current()),
    )
        .into_response()
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<BlendUpdate>, JsonRejection>,
) -> Response {
    let Ok(Json(update)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid blend");
    };
    if !valid_id(&update.preset) || update.blend_ms > MAX_RELEASE_MS {
        return failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Blend must be up to 10 seconds for a preset with scenes",
        );
    }
    let mut next = shared.blends.current();
    if update.blend_ms == 0 {
        next.blends.remove(&update.preset);
    } else {
        next.blends.insert(update.preset, update.blend_ms);
    }
    if let Err(e) = next.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    let store = shared.blends.clone();
    match tokio::task::spawn_blocking(move || store.save(next).map(|()| store.current())).await {
        Ok(Ok(saved)) => ([(header::CACHE_CONTROL, "no-store")], Json(saved)).into_response(),
        Ok(Err(e)) => failure(StatusCode::CONFLICT, &e),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Blend task failed"),
    }
}
