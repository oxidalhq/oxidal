//! Named mixes of already prepared branches, with shared downstream processors.
use super::*;
use std::collections::BTreeSet;

pub const SCENES_EXTENSION: &str = "urn:oxidal:scenes:1";

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
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SceneGain {
    pub node: String,
    pub port: u8,
    pub value: f64,
}
impl Manifest {
    /// Scenes are sonic data: require explicit support rather than allowing an
    /// older reader to silently discard their meaning. Initial mix remains the
    /// graph's gains, so Save/recovery use the existing confirmed scalar path.
    pub fn scenes(&self) -> Result<Option<Scenes>> {
        let Some(extension) = self.extensions.get(SCENES_EXTENSION) else {
            return Ok(None);
        };
        let bad = || Error::Invalid("Invalid prepared scene definitions");
        if !self
            .required_extensions
            .iter()
            .any(|key| key == SCENES_EXTENSION)
        {
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
                    || !(0.0..=4.0).contains(&gain.value)
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
            {
                return Err(bad());
            }
            for gain in &branch.gains {
                if !gain.value.is_finite()
                    || !(0.0..=4.0).contains(&gain.value)
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
