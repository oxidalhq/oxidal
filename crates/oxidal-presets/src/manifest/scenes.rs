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
/// Scenes that can crossfade between a processor and its aligned dry signal.
pub const SCENES_BYPASS_EXTENSION: &str = "urn:oxidal:scenes:3";
/// Scenes that also set capture controls on native nodes.
pub const SCENES_NATIVE_EXTENSION: &str = "urn:oxidal:scenes:4";
/// Scenes with independently armed warm bypass inside native processors.
pub const SCENES_INNER_BYPASS_EXTENSION: &str = "urn:oxidal:scenes:5";
const SCENES_PREFIX: &str = "urn:oxidal:scenes:";
const SCENES_VERSIONS: [&str; 5] = [
    SCENES_EXTENSION,
    SCENES_CONTROLS_EXTENSION,
    SCENES_BYPASS_EXTENSION,
    SCENES_NATIVE_EXTENSION,
    SCENES_INNER_BYPASS_EXTENSION,
];
/// The refusal for a scenes version this reader does not know.
pub const UNSUPPORTED_SCENES: &str = "Unsupported scenes format: this preset needs a newer Oxidal";
/// Most plugin controls one scene may set. Every scene of a preset sets the
/// same controls, so this also bounds the host's ramp slots.
pub const MAX_SCENE_CONTROLS: usize = 32;
pub const MAX_SCENE_BYPASS: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Scenes {
    pub fade_ms: u32,
    pub scenes: Vec<Scene>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub initial_scene: Option<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bypass: Vec<SceneBypass>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub native_controls: Vec<SceneNativeControl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub native_bypass: Vec<SceneNativeBypass>,
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
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SceneBypass {
    pub node: String,
    pub value: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SceneNativeControl {
    pub node: String,
    pub parameter: String,
    pub value: f64,
}
impl SceneNativeControl {
    /// Preparation resolves the exact block against the native node.
    pub fn capture_parameter(&self) -> Option<(&str, &str)> {
        let (block, parameter) = self.parameter.strip_prefix("block:")?.rsplit_once(':')?;
        (!block.is_empty()
            && self.parameter.len() <= 200
            && !block.chars().any(char::is_control)
            && matches!(parameter, "inputGain" | "outputGain" | "mix")
            && self.value.is_finite()
            && (0.0..=1.0).contains(&self.value))
        .then_some((block, parameter))
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SceneNativeBypassKey {
    pub node: String,
    pub block: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SceneNativeBypass {
    pub node: String,
    pub block: String,
    /// True means bypassed.
    pub value: bool,
}
impl SceneNativeBypass {
    pub fn valid_block(id: &str) -> bool {
        (1..=128).contains(&id.len()) && !id.chars().any(char::is_control)
    }
    pub fn key(&self) -> SceneNativeBypassKey {
        SceneNativeBypassKey {
            node: self.node.clone(),
            block: self.block.clone(),
        }
    }
}
impl Manifest {
    /// Scenes are sonic data: require explicit support rather than allowing an
    /// older reader to silently discard their meaning. Initial mix remains the
    /// graph's gains, so Save/recovery use the existing confirmed scalar path.
    /// Versions 1 through 5 are read; any other scenes version is
    /// refused as unsupported rather than read as invalid.
    pub fn scenes(&self) -> Result<Option<Scenes>> {
        let bad = || Error::Invalid("Invalid prepared scene definitions");
        if self
            .extensions
            .keys()
            .chain(&self.required_extensions)
            .any(|key| key.starts_with(SCENES_PREFIX) && !SCENES_VERSIONS.contains(&key.as_str()))
        {
            return Err(Error::Invalid(UNSUPPORTED_SCENES));
        }
        let mut present = SCENES_VERSIONS
            .into_iter()
            .filter_map(|key| self.extensions.get(key).map(|extension| (key, extension)));
        let Some((key, extension)) = present.next() else {
            return Ok(None);
        };
        if present.next().is_some() || !self.required_extensions.iter().any(|k| k == key) {
            return Err(bad());
        }
        let uses = |field| {
            ["scenes", "branches"].into_iter().any(|part| {
                extension
                    .get(part)
                    .and_then(Value::as_array)
                    .is_some_and(|rows| rows.iter().any(|row| row.get(field).is_some()))
            })
        };
        if (!matches!(
            key,
            SCENES_BYPASS_EXTENSION | SCENES_NATIVE_EXTENSION | SCENES_INNER_BYPASS_EXTENSION
        ) && uses("bypass"))
            || (!matches!(key, SCENES_NATIVE_EXTENSION | SCENES_INNER_BYPASS_EXTENSION)
                && (uses("native_controls") || extension.contains_key("initial_scene")))
            || (key != SCENES_INNER_BYPASS_EXTENSION && uses("native_bypass"))
        {
            return Err(bad());
        }
        let definition: Scenes =
            serde_json::from_value(Value::Object(extension.clone())).map_err(|_| bad())?;
        let host = self.oxidal.as_ref().ok_or_else(bad)?;
        if !(1..=1000).contains(&definition.fade_ms)
            || definition.scenes.is_empty()
            || definition
                .initial_scene
                .as_ref()
                .is_some_and(|id| !definition.scenes.iter().any(|scene| &scene.id == id))
        {
            return Err(bad());
        }
        let mut ids = BTreeSet::new();
        let mut expected = None;
        let mut expected_controls = None;
        let mut expected_bypass = None;
        let mut expected_native = None;
        let mut expected_inner = None;
        for scene in &definition.scenes {
            if !validation::id(&scene.id)
                || !ids.insert(&scene.id)
                || scene.name.trim().is_empty()
                || scene.name.chars().count() > 128
                || scene.name.chars().any(char::is_control)
                || (scene.gains.is_empty()
                    && scene.bypass.is_empty()
                    && scene.native_controls.is_empty()
                    && scene.native_bypass.is_empty())
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
            if scene.controls.len() + scene.native_controls.len() > MAX_SCENE_CONTROLS {
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
            if scene.bypass.len() + scene.native_bypass.len() > MAX_SCENE_BYPASS {
                return Err(bad());
            }
            let mut bypass = BTreeSet::new();
            for target in &scene.bypass {
                if !host.graph.nodes.iter().any(|n| {
                    n.id == target.node && matches!(n.kind, NodeKind::Tone3000 | NodeKind::Lv2)
                }) || !bypass.insert(&target.node)
                {
                    return Err(bad());
                }
            }
            if expected_bypass
                .as_ref()
                .is_some_and(|previous| previous != &bypass)
            {
                return Err(bad());
            }
            expected_bypass = Some(bypass);
            let mut native = BTreeSet::new();
            for target in &scene.native_controls {
                if target.capture_parameter().is_none()
                    || !host
                        .graph
                        .nodes
                        .iter()
                        .any(|n| n.id == target.node && n.kind == NodeKind::Tone3000)
                    || !native.insert((&target.node, &target.parameter))
                {
                    return Err(bad());
                }
            }
            if expected_native
                .as_ref()
                .is_some_and(|previous| previous != &native)
            {
                return Err(bad());
            }
            expected_native = Some(native);
            let mut inner = BTreeSet::new();
            for target in &scene.native_bypass {
                if !SceneNativeBypass::valid_block(&target.block)
                    || !host
                        .graph
                        .nodes
                        .iter()
                        .any(|n| n.id == target.node && n.kind == NodeKind::Tone3000)
                    || !inner.insert((&target.node, &target.block))
                {
                    return Err(bad());
                }
            }
            if expected_inner
                .as_ref()
                .is_some_and(|previous| previous != &inner)
            {
                return Err(bad());
            }
            expected_inner = Some(inner);
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
                || !branch.bypass.is_empty()
                || !branch.native_controls.is_empty()
                || !branch.native_bypass.is_empty()
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
