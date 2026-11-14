//! Named mixes of already prepared branches, with shared downstream processors,
//! plus optional plugin control values that the host ramps on scene change.
//! @see docs/lv2.md
use super::*;
use std::collections::BTreeSet;

/// Scenes that mix prepared paths. Saved presets may also carry scene
/// `controls` under this version: they are read, but new writers use
/// [`SCENES_CONTROLS_EXTENSION`] for them.
pub const SCENES_EXTENSION: &str = "urn:oxidal:scenes:1";
/// Scenes that also set plugin controls. A reader that only knows version 1
/// refuses it as an unsupported required extension instead of failing to
/// parse it. Writers use it only when a scene sets a control.
pub const SCENES_CONTROLS_EXTENSION: &str = "urn:oxidal:scenes:2";
const SCENES_PREFIX: &str = "urn:oxidal:scenes:";
/// The refusal for a scenes version this reader does not know.
pub const UNSUPPORTED_SCENES: &str = "Unsupported scenes format: this preset needs a newer Oxidal";
/// Most plugin controls one scene may set. Every scene of a preset sets the
/// same controls, so this also bounds the host's ramp slots.
pub const MAX_SCENE_CONTROLS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Scenes {
    pub fade_ms: u32,
    pub scenes: Vec<Scene>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branches: Vec<Scene>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub gains: Vec<SceneGain>,
    /// Plugin control values this scene sets (none for branches). Continuous
    /// controls ramp over `fade_ms`; stepped ones switch while silent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub controls: Vec<SceneControl>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SceneGain {
    pub node: String,
    pub port: u8,
    pub value: f64,
}
/// One LV2 input control value of a scene, in the plugin's native units.
/// The engine checks the port, range and step when it prepares the rig.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SceneControl {
    pub node: String,
    pub symbol: String,
    pub value: f64,
}
impl Manifest {
    /// Scenes are sonic data: require explicit support rather than allowing an
    /// older reader to silently discard their meaning. Initial mix remains the
    /// graph's gains, so Save/recovery use the existing confirmed scalar path.
    /// Version 1 and version 2 are both read; any other scenes version is
    /// refused as unsupported rather than read as invalid.
    pub fn scenes(&self) -> Result<Option<Scenes>> {
        let bad = || Error::Invalid("Invalid prepared scene definitions");
        let known = |key: &str| key == SCENES_EXTENSION || key == SCENES_CONTROLS_EXTENSION;
        if self
            .extensions
            .keys()
            .chain(&self.required_extensions)
            .any(|key| key.starts_with(SCENES_PREFIX) && !known(key))
        {
            return Err(Error::Invalid(UNSUPPORTED_SCENES));
        }
        let mut present = [SCENES_EXTENSION, SCENES_CONTROLS_EXTENSION]
            .into_iter()
            .filter_map(|key| self.extensions.get(key).map(|extension| (key, extension)));
        let Some((key, extension)) = present.next() else {
            return Ok(None);
        };
        if present.next().is_some() || !self.required_extensions.iter().any(|k| k == key) {
            return Err(bad());
        }
        let definition: Scenes =
            serde_json::from_value(Value::Object(extension.clone())).map_err(|_| bad())?;
        let host = self.oxidal.as_ref().ok_or_else(bad)?;
        if !(1..=1000).contains(&definition.fade_ms) || definition.scenes.is_empty() {
            return Err(bad());
        }
        let mut ids = BTreeSet::new();
        let mut expected = None;
        let mut expected_controls = None;
        for scene in &definition.scenes {
            if !validation::id(&scene.id)
                || !ids.insert(&scene.id)
                || scene.name.trim().is_empty()
                || scene.name.chars().count() > 128
                || scene.name.chars().any(char::is_control)
                || scene.gains.is_empty()
            {
                return Err(bad());
            }
            let mut targets = BTreeSet::new();
            for gain in &scene.gains {
                let node = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| {
                        n.id == gain.node && matches!(n.kind, NodeKind::Merge | NodeKind::Gain)
                    })
                    .ok_or_else(bad)?;
                if !gain.value.is_finite()
                    || !(-4.0..=4.0).contains(&gain.value)
                    || usize::from(gain.port) >= node.input_gains.as_ref().ok_or_else(bad)?.len()
                    || !targets.insert((&gain.node, gain.port))
                {
                    return Err(bad());
                }
            }
            // Every scene declares the complete set of selected merge inputs.
            // Otherwise a previous scene's gain could leak into the next one.
            for (node, _) in &targets {
                let count = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| &n.id == *node)
                    .unwrap()
                    .input_gains
                    .as_ref()
                    .unwrap()
                    .len();
                if targets.iter().filter(|(n, _)| n == node).count() != count {
                    return Err(bad());
                }
            }
            if expected
                .as_ref()
                .is_some_and(|previous| previous != &targets)
            {
                return Err(bad());
            }
            expected = Some(targets);
            // Every scene sets the same plugin controls, for the same reason:
            // otherwise a control's value would depend on the previous scene.
            if scene.controls.len() > MAX_SCENE_CONTROLS {
                return Err(bad());
            }
            let mut controls = BTreeSet::new();
            for control in &scene.controls {
                if !validation::symbol(&control.symbol)
                    || control.symbol.len() > 64
                    || !control.value.is_finite()
                    || !host
                        .graph
                        .nodes
                        .iter()
                        .any(|n| n.id == control.node && n.kind == NodeKind::Lv2)
                    || !controls.insert((&control.node, &control.symbol))
                {
                    return Err(bad());
                }
            }
            if expected_controls
                .as_ref()
                .is_some_and(|previous| previous != &controls)
            {
                return Err(bad());
            }
            expected_controls = Some(controls);
        }
        let mut branches = BTreeSet::new();
        let mut branch_targets = BTreeSet::new();
        for branch in &definition.branches {
            if !validation::id(&branch.id)
                || !branches.insert(&branch.id)
                || branch.name.trim().is_empty()
                || branch.name.chars().count() > 128
                || branch.name.chars().any(char::is_control)
                || branch.gains.is_empty()
                || !branch.controls.is_empty()
            {
                return Err(bad());
            }
            for gain in &branch.gains {
                if !gain.value.is_finite()
                    || !(-4.0..=4.0).contains(&gain.value)
                    || gain.value == 0.0
                    || !expected
                        .as_ref()
                        .unwrap()
                        .contains(&(&gain.node, gain.port))
                    || !branch_targets.insert((&gain.node, gain.port))
                {
                    return Err(bad());
                }
            }
        }
        if !definition.branches.is_empty() && Some(&branch_targets) != expected.as_ref() {
            return Err(bad());
        }
        Ok(Some(definition))
    }
}
