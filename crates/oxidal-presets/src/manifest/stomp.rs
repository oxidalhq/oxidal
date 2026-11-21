//! Per-rig switch definitions. Controller assignments remain on the device.
use super::{Error, Manifest, Result, validation::id};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const STOMP_GROUPS_EXTENSION: &str = "urn:oxidal:stomp-groups:1";
pub const MAX_STOMP_GROUPS: usize = 16;
const MAX_STOMP_TARGETS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StompGroup {
    pub id: String,
    pub name: String,
    pub nodes: Vec<String>,
}

impl StompGroup {
    pub fn valid(&self) -> bool {
        id(&self.id)
            && !self.name.is_empty()
            && self.name.len() <= 80
            && self.name.trim() == self.name
            && !self.name.chars().any(char::is_control)
            && (1..=MAX_STOMP_TARGETS).contains(&self.nodes.len())
            && self
                .nodes
                .iter()
                .enumerate()
                .all(|(i, node)| id(node) && !self.nodes[..i].contains(node))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StompGroups {
    groups: Vec<StompGroup>,
}

impl Manifest {
    pub fn stomp_groups(&self) -> Result<Vec<StompGroup>> {
        let Some(extension) = self.extensions.get(STOMP_GROUPS_EXTENSION) else {
            return Ok(Vec::new());
        };
        if !self
            .required_extensions
            .iter()
            .any(|key| key == STOMP_GROUPS_EXTENSION)
        {
            return Err(Error::Invalid(
                "Stomp groups must be a required preset extension",
            ));
        }
        let groups: StompGroups = serde_json::from_value(extension.clone().into())
            .map_err(|_| Error::Invalid("Invalid stomp groups format"))?;
        let scenes = self
            .scenes()?
            .ok_or(Error::Invalid("Stomp groups require named scenes"))?;
        if !(1..=MAX_STOMP_GROUPS).contains(&groups.groups.len())
            || groups.groups.iter().enumerate().any(|(i, group)| {
                !group.valid()
                    || groups.groups[..i].iter().any(|old| old.id == group.id)
                    || group.nodes.iter().any(|node| {
                        !scenes.scenes[0]
                            .bypass
                            .iter()
                            .any(|target| &target.node == node)
                    })
            })
        {
            return Err(Error::Invalid(
                "Invalid stomp group or target missing from scene bypass",
            ));
        }
        Ok(groups.groups)
    }
}
