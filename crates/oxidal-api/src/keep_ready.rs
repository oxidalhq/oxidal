//! Keep ready: the presets the player chose to keep loaded for gapless
//! switching, stored on the device so every browser sees the same choice
//! (Sprint 07 7.7). Ready itself is only ever reported by the audio worker.
//! @see docs/audio.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};

/// The existing qualified bank: at most four prepared presets.
pub const KEEP_READY_LIMIT: usize = 4;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct KeepReady {
    pub revisions: Vec<String>,
}

fn valid(revision: &str) -> bool {
    revision.len() == 64
        && revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Debug)]
pub struct Store {
    path: PathBuf,
    lock: std::sync::Mutex<()>,
}
impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: std::sync::Mutex::new(()),
        }
    }
    pub fn read(&self) -> KeepReady {
        std::fs::read(&self.path)
            .ok()
            .and_then(|b| serde_json::from_slice::<KeepReady>(&b).ok())
            .map(|k| Self::clean(k.revisions))
            .unwrap_or_default()
    }
    fn clean(revisions: Vec<String>) -> KeepReady {
        let mut out: Vec<String> = Vec::new();
        for revision in revisions {
            if valid(&revision) && !out.contains(&revision) {
                out.push(revision);
            }
        }
        out.truncate(KEEP_READY_LIMIT);
        KeepReady { revisions: out }
    }
    pub fn write(&self, revisions: Vec<String>) -> Result<KeepReady, String> {
        if revisions.len() > KEEP_READY_LIMIT || revisions.iter().any(|r| !valid(r)) {
            return Err(format!(
                "Choose up to {KEEP_READY_LIMIT} saved presets to keep ready"
            ));
        }
        let _guard = self.lock.lock().map_err(|_| "Keep ready unavailable")?;
        let next = Self::clean(revisions);
        let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("json.next");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        Ok(next)
    }
    /// A preset saved again stays in Keep ready under its new revision.
    pub fn replace(&self, old: &str, new: &str) -> Result<(), String> {
        let current = self.read();
        if !current.revisions.iter().any(|r| r == old) {
            return Ok(());
        }
        self.write(
            current
                .revisions
                .into_iter()
                .map(|r| if r == old { new.to_owned() } else { r })
                .collect(),
        )
        .map(|_| ())
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    Json(shared.keep_ready.read()).into_response()
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<KeepReady>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid Keep ready request");
    };
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason);
    }
    match shared.keep_ready.write(request.revisions) {
        Ok(state) => Json(state).into_response(),
        Err(e) => failure(StatusCode::UNPROCESSABLE_ENTITY, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keep_ready_is_bounded_deduplicated_and_follows_saves() {
        let path = std::env::temp_dir().join(format!("oxidal-keep-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::new(path.clone());
        assert!(store.read().revisions.is_empty());
        let r = |c: &str| c.repeat(64);
        assert!(store.write(vec![r("a"); 5]).is_err());
        assert!(store.write(vec!["nope".into()]).is_err());
        store.write(vec![r("a"), r("b"), r("a")]).unwrap();
        assert_eq!(Store::new(path.clone()).read().revisions, [r("a"), r("b")]);
        store.replace(&r("a"), &r("c")).unwrap();
        assert_eq!(store.read().revisions, [r("c"), r("b")]);
        store.replace(&r("c"), &r("a")).unwrap();
        assert_eq!(Store::new(path.clone()).read().revisions, [r("a"), r("b")]);
        let _ = std::fs::remove_file(path);
    }
}
