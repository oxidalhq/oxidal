//! Unit-wide gain staging: guitar input trim and master output level.
//! Kept apart from presets so every rig, engine and restart uses the same levels.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::tools::HostLevels;
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, RwLock},
};

#[derive(Debug)]
pub(crate) struct Levels {
    path: PathBuf,
    value: RwLock<HostLevels>,
}
impl Levels {
    /// A missing or unreadable file starts at unity; it never blocks audio.
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 4096)
            .and_then(|bytes| serde_json::from_slice::<HostLevels>(&bytes).ok())
            .filter(|levels| levels.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: RwLock::new(value),
        }
    }
    pub(crate) fn current(&self) -> HostLevels {
        self.value.read().map(|v| *v).unwrap_or_default()
    }
    pub(crate) fn save(&self, levels: HostLevels) -> Result<(), String> {
        levels.validate()?;
        let mut value = self.value.write().map_err(|_| "Levels store unavailable")?;
        if *value == levels {
            return Ok(());
        }
        let parent = self.path.parent().ok_or("Levels file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&levels).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = levels;
        Ok(())
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.levels.current()),
    )
        .into_response()
}
/// Stores levels for the next start. A running rig takes them through its own
/// host-utility command, which also stores them.
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<HostLevels>, JsonRejection>,
) -> Response {
    let Ok(Json(levels)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid levels");
    };
    if let Err(e) = levels.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    let store = shared.levels.clone();
    match tokio::task::spawn_blocking(move || store.save(levels).map(|()| store.current())).await {
        Ok(Ok(levels)) => ([(header::CACHE_CONTROL, "no-store")], Json(levels)).into_response(),
        Ok(Err(e)) => failure(StatusCode::CONFLICT, &e),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Levels task failed"),
    }
}
