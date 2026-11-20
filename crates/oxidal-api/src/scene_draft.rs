//! The unsaved scene draft of the playing preset (7.7), held by the daemon so
//! every browser and device sees the same one. It is bound to the audio
//! session that made it: a restart or another preset leaves it behind and the
//! clients ignore it. Nothing here is written to disk or reaches the audio
//! engine; Save in Rig still publishes the preset.
//! @see docs/presets/format.md
//! @see docs/lv2.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_presets::manifest::{
    MAX_SCENE_BYPASS, MAX_SCENE_CONTROLS, SceneBypass, SceneControl, SceneNativeControl,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

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
    /// Plugin control values the new scene sets (see the preset's scenes).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub controls: Vec<SceneControl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bypass: Vec<SceneBypass>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub native_controls: Vec<SceneNativeControl>,
}

/// Scene levels changed with Update scene, by scene id, plus new scenes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SceneDraft {
    pub session: String,
    pub gains: BTreeMap<String, Vec<SceneGain>>,
    #[serde(default)]
    pub added: Vec<DraftScene>,
    /// Plugin control values changed with Update scene, by scene id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub controls: BTreeMap<String, Vec<SceneControl>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub bypass: BTreeMap<String, Vec<SceneBypass>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub native_controls: BTreeMap<String, Vec<SceneNativeControl>>,
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
    /// Required when the current or submitted draft has bypass or capture edits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
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
            .all(|g| text(&g.node) && g.value.is_finite() && (-4.0..=4.0).contains(&g.value))
}
fn controls(list: &[SceneControl]) -> bool {
    list.len() <= MAX_SCENE_CONTROLS
        && list
            .iter()
            .all(|c| text(&c.node) && text(&c.symbol) && c.value.is_finite())
}
fn bypass(list: &[SceneBypass]) -> bool {
    let mut nodes = BTreeSet::new();
    list.len() <= MAX_SCENE_BYPASS
        && list.iter().all(|target| {
            text(&target.node)
                && !target.node.chars().any(char::is_control)
                && nodes.insert(&target.node)
        })
}
fn native_controls(list: &[SceneNativeControl], lv2_count: usize) -> bool {
    let mut targets = BTreeSet::new();
    list.len() + lv2_count <= MAX_SCENE_CONTROLS
        && list.iter().all(|c| {
            text(&c.node)
                && !c.node.chars().any(char::is_control)
                && c.capture_parameter().is_some()
                && targets.insert((&c.node, &c.parameter))
        })
}
fn needs_revision(draft: &SceneDraft) -> bool {
    !draft.bypass.is_empty()
        || !draft.native_controls.is_empty()
        || draft
            .added
            .iter()
            .any(|scene| !scene.bypass.is_empty() || !scene.native_controls.is_empty())
}
fn valid(draft: &SceneDraft) -> bool {
    text(&draft.session)
        && draft.gains.len() <= MAX_SCENES
        && draft.added.len() <= MAX_SCENES
        && draft.controls.len() <= MAX_SCENES
        && draft.bypass.len() <= MAX_SCENES
        && draft.native_controls.len() <= MAX_SCENES
        && draft.native_controls.iter().all(|(scene, list)| {
            text(scene) && native_controls(list, draft.controls.get(scene).map_or(0, Vec::len))
        })
        && draft
            .bypass
            .iter()
            .all(|(scene, list)| text(scene) && bypass(list))
        && draft
            .controls
            .iter()
            .all(|(scene, list)| text(scene) && controls(list))
        && draft
            .gains
            .iter()
            .all(|(scene, list)| text(scene) && gains(list))
        && draft.added.iter().all(|s| {
            text(&s.id)
                && text(&s.name)
                && gains(&s.gains)
                && controls(&s.controls)
                && bypass(&s.bypass)
                && native_controls(&s.native_controls, s.controls.len())
        })
}

impl Store {
    fn read(&self) -> SceneDraftState {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn replace(&self, update: SceneDraftUpdate) -> Option<SceneDraftState> {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let guarded = state.draft.as_ref().is_some_and(needs_revision)
            || update.draft.as_ref().is_some_and(needs_revision);
        if (guarded || update.expected_revision.is_some())
            && update.expected_revision != Some(state.revision)
        {
            return None;
        }
        if state.draft != update.draft {
            state.revision += 1;
            state.draft = update.draft;
        }
        Some(state.clone())
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
    match shared.scene_draft.replace(update) {
        Some(state) => Json(state).into_response(),
        None => failure(
            StatusCode::CONFLICT,
            "Scene draft changed; refresh before updating",
        ),
    }
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
            controls: BTreeMap::new(),
            bypass: BTreeMap::new(),
            native_controls: BTreeMap::new(),
        }
    }

    #[test]
    fn revision_moves_only_on_change() {
        let store = Store::default();
        let replace = |draft| {
            store
                .replace(SceneDraftUpdate {
                    draft,
                    expected_revision: None,
                })
                .unwrap()
                .revision
        };
        assert_eq!(replace(Some(draft(1.0))), 1);
        assert_eq!(replace(Some(draft(1.0))), 1);
        assert_eq!(replace(None), 2);
        assert_eq!(store.read().draft, None);
    }

    #[test]
    fn refuses_out_of_range_levels() {
        assert!(valid(&draft(0.5)));
        assert!(!valid(&draft(9.0)));
        assert!(!valid(&draft(f64::NAN)));
    }

    #[test]
    fn carries_bounded_scene_control_values() {
        let control = |value: f64| SceneControl {
            node: "fx".into(),
            symbol: "time".into(),
            value,
        };
        let mut with = draft(1.0);
        with.controls.insert("a".into(), vec![control(600.0)]);
        assert!(valid(&with));
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(json["controls"]["a"][0]["symbol"], "time");
        // Drafts without controls keep their old shape.
        assert!(
            serde_json::to_value(draft(1.0))
                .unwrap()
                .get("controls")
                .is_none()
        );
        with.controls
            .insert("a".into(), vec![control(f64::INFINITY)]);
        assert!(!valid(&with));
        with.controls
            .insert("a".into(), vec![control(1.0); MAX_SCENE_CONTROLS + 1]);
        assert!(!valid(&with));
    }

    #[test]
    fn capture_drafts_share_revision_guard_and_combined_control_budget() {
        let mut with = draft(1.0);
        let capture = SceneNativeControl {
            node: "capture".into(),
            parameter: "block:amp:mix".into(),
            value: 0.65,
        };
        with.native_controls
            .insert("a".into(), vec![capture.clone()]);
        assert!(valid(&with));
        let store = Store::default();
        assert!(
            store
                .replace(SceneDraftUpdate {
                    draft: Some(with.clone()),
                    expected_revision: None
                })
                .is_none()
        );
        assert_eq!(
            store
                .replace(SceneDraftUpdate {
                    draft: Some(with.clone()),
                    expected_revision: Some(0)
                })
                .unwrap()
                .revision,
            1
        );
        assert!(
            store
                .replace(SceneDraftUpdate {
                    draft: None,
                    expected_revision: Some(0)
                })
                .is_none()
        );
        assert_eq!(store.read().draft, Some(with.clone()));
        with.controls.insert(
            "a".into(),
            (0..MAX_SCENE_CONTROLS)
                .map(|i| SceneControl {
                    node: "fx".into(),
                    symbol: format!("p{i}"),
                    value: 0.1,
                })
                .collect(),
        );
        assert!(!valid(&with));
        with.controls.clear();
        with.native_controls
            .insert("a".into(), vec![capture.clone(), capture]);
        assert!(!valid(&with));
    }
}
