//! The unsaved scene draft of the playing preset (7.7), held by the daemon so
//! every browser and device sees the same one. It is bound to the audio
//! session that made it: a restart or another preset leaves it behind and the
//! clients ignore it. Nothing here is written to disk or reaches the audio
//! engine; Save in Rig still publishes the preset.
//! @see docs/presets/format.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc, sync::Mutex};

const MAX_SCENES: usize = 64;
const MAX_GAINS: usize = 64;
const MAX_TEXT: usize = 128;

/// One merge input level kept for a scene.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SceneGain {
    pub node: String,
    pub port: u32,
    pub value: f64,
}

/// A scene drafted with Save as new scene.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DraftScene {
    pub id: String,
    pub name: String,
    pub gains: Vec<SceneGain>,
}

/// Scene levels changed with Update scene, by scene id, plus new scenes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SceneDraft {
    pub session: String,
    pub gains: BTreeMap<String, Vec<SceneGain>>,
    #[serde(default)]
    pub added: Vec<DraftScene>,
}

/// The shared draft; `revision` moves on every change so clients notice.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SceneDraftState {
    pub revision: u64,
    pub draft: Option<SceneDraft>,
}

/// Replaces the draft; None clears it after Save or Discard.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SceneDraftUpdate {
    pub draft: Option<SceneDraft>,
}

#[derive(Debug, Default)]
pub(crate) struct Store(Mutex<SceneDraftState>);

fn text(value: &str) -> bool {
    (1..=MAX_TEXT).contains(&value.chars().count())
}
fn gains(list: &[SceneGain]) -> bool {
    list.len() <= MAX_GAINS
        && list
            .iter()
            .all(|g| text(&g.node) && g.value.is_finite() && (0.0..=4.0).contains(&g.value))
}
fn valid(draft: &SceneDraft) -> bool {
    text(&draft.session)
        && draft.gains.len() <= MAX_SCENES
        && draft.added.len() <= MAX_SCENES
        && draft
            .gains
            .iter()
            .all(|(scene, list)| text(scene) && gains(list))
        && draft
            .added
            .iter()
            .all(|s| text(&s.id) && text(&s.name) && gains(&s.gains))
}

impl Store {
    fn read(&self) -> SceneDraftState {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn replace(&self, draft: Option<SceneDraft>) -> SceneDraftState {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if state.draft != draft {
            state.revision += 1;
            state.draft = draft;
        }
        state.clone()
    }
}

pub(crate) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.scene_draft.read()),
    )
        .into_response()
}

pub(crate) async fn replace(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<SceneDraftUpdate>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason);
    }
    let update = match body {
        Ok(Json(update)) => update,
        Err(error) => return failure(error.status(), "Invalid scene draft"),
    };
    if update.draft.as_ref().is_some_and(|d| !valid(d)) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "Invalid scene draft");
    }
    Json(shared.scene_draft.replace(update.draft)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(value: f64) -> SceneDraft {
        SceneDraft {
            session: "s".into(),
            gains: BTreeMap::from([(
                "a".into(),
                vec![SceneGain {
                    node: "m".into(),
                    port: 0,
                    value,
                }],
            )]),
            added: vec![],
        }
    }

    #[test]
    fn revision_moves_only_on_change() {
        let store = Store::default();
        assert_eq!(store.replace(Some(draft(1.0))).revision, 1);
        assert_eq!(store.replace(Some(draft(1.0))).revision, 1);
        assert_eq!(store.replace(None).revision, 2);
        assert_eq!(store.read().draft, None);
    }

    #[test]
    fn refuses_out_of_range_levels() {
        assert!(valid(&draft(0.5)));
        assert!(!valid(&draft(9.0)));
        assert!(!valid(&draft(f64::NAN)));
    }
}
