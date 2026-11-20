//! Explicitly owned scene branches. Graph confinement is checked at preparation.
use super::*;

pub const SLEEP_BRANCHES_EXTENSION: &str = "urn:oxidal:sleep-branches:1";
pub const MAX_SLEEP_BRANCHES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SleepBranches {
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    pub branches: Vec<SleepBranch>,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SleepBranch {
    /// Existing scene branch declaration supplies the exact return gain ports.
    pub branch: String,
    /// Each named mono host gain node is an input boundary for this branch.
    pub sends: Vec<String>,
}

impl Manifest {
    pub fn sleep_branches(&self) -> Result<Option<SleepBranches>> {
        let bad = || Error::Invalid("Invalid sleeping branch definition");
        let Some(value) = self.extensions.get(SLEEP_BRANCHES_EXTENSION) else {
            return Ok(None);
        };
        if !self
            .required_extensions
            .iter()
            .any(|id| id == SLEEP_BRANCHES_EXTENSION)
        {
            return Err(bad());
        }
        let config: SleepBranches =
            serde_json::from_value(Value::Object(value.clone())).map_err(|_| bad())?;
        let scenes = self.scenes()?.ok_or_else(bad)?;
        let host = self.oxidal.as_ref().ok_or_else(bad)?;
        let mut branches = std::collections::BTreeSet::new();
        let mut sends = std::collections::BTreeSet::new();
        if config.branches.is_empty() || config.branches.len() > MAX_SLEEP_BRANCHES {
            return Err(bad());
        }
        for row in &config.branches {
            let declared = scenes
                .branches
                .iter()
                .find(|b| b.id == row.branch)
                .ok_or_else(bad)?;
            if !branches.insert(&row.branch)
                || row.sends.is_empty()
                || row.sends.len() > 8
                || row.sends.iter().any(|send| {
                    !sends.insert(send)
                        || !host
                            .graph
                            .nodes
                            .iter()
                            .any(|node| &node.id == send && node.kind == NodeKind::Gain)
                })
                || scenes.scenes.iter().any(|scene| {
                    declared.gains.iter().any(|gain| {
                        !scene
                            .gains
                            .iter()
                            .any(|row| row.node == gain.node && row.port == gain.port)
                    })
                })
            {
                return Err(bad());
            }
        }
        Ok(Some(config))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SleepSendBoundary {
    pub node: String,
    pub from: Endpoint,
    pub to: Endpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigSleepPlan {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<SleepBranches>,
    pub inserted_sends: Vec<SleepSendBoundary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

use std::collections::BTreeSet;

struct Routes<'a> {
    nodes: BTreeMap<&'a str, NodeKind>,
    incoming: BTreeMap<&'a str, Vec<&'a Edge>>,
    outgoing: BTreeMap<&'a str, Vec<&'a Edge>>,
}

impl<'a> Routes<'a> {
    fn new(graph: &'a Graph) -> Self {
        let nodes = graph
            .nodes
            .iter()
            .map(|node| (node.id.as_str(), node.kind))
            .collect();
        let mut incoming: BTreeMap<_, Vec<_>> = BTreeMap::new();
        let mut outgoing: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for edge in &graph.edges {
            incoming
                .entry(edge.to.node.as_str())
                .or_default()
                .push(edge);
            outgoing
                .entry(edge.from.node.as_str())
                .or_default()
                .push(edge);
        }
        Self {
            nodes,
            incoming,
            outgoing,
        }
    }

    fn ancestors(&self, returns: &[SceneGain]) -> BTreeSet<&'a str> {
        let mut ancestors = BTreeSet::new();
        let mut queue: Vec<_> = returns
            .iter()
            .flat_map(|gain| {
                self.incoming
                    .get(gain.node.as_str())
                    .into_iter()
                    .flatten()
                    .filter(move |edge| edge.to.port == gain.port)
                    .map(|edge| edge.from.node.as_str())
            })
            .collect();
        while let Some(node) = queue.pop() {
            if ancestors.insert(node) {
                queue.extend(
                    self.incoming
                        .get(node)
                        .into_iter()
                        .flatten()
                        .map(|edge| edge.from.node.as_str()),
                );
            }
        }
        ancestors
    }
}

impl SleepBranches {
    /// The prepared worker and authoring preview use the same closed-region proof.
    /// Inputs may reach the region only through the declared sends, and outputs
    /// may leave only through its exact, existing scene return ports.
    pub fn regions<'a>(
        &self,
        host: &'a Host,
        scenes: &'a Scenes,
    ) -> Result<Vec<BTreeSet<&'a str>>> {
        let routes = Routes::new(&host.graph);
        let mut owners = BTreeMap::new();
        let mut returns = BTreeSet::new();
        let mut regions = Vec::with_capacity(self.branches.len());
        for (index, branch) in self.branches.iter().enumerate() {
            let entrances: BTreeSet<_> = host
                .graph
                .nodes
                .iter()
                .filter(|node| branch.sends.contains(&node.id))
                .map(|node| node.id.as_str())
                .collect();
            let declaration = scenes
                .branches
                .iter()
                .find(|row| row.id == branch.branch)
                .ok_or(Error::Invalid("Unknown sleeping branch"))?;
            let exits: BTreeSet<_> = declaration
                .gains
                .iter()
                .map(|gain| (gain.node.as_str(), gain.port))
                .collect();
            if exits.iter().any(|port| !returns.insert(*port)) {
                return Err(Error::Invalid("Sleeping branches cannot share returns"));
            }
            let mut region = entrances.clone();
            let mut queue: Vec<_> = entrances.iter().copied().collect();
            let mut seen_exits = BTreeSet::new();
            while let Some(from) = queue.pop() {
                for edge in routes.outgoing.get(from).into_iter().flatten() {
                    let to = edge.to.node.as_str();
                    let exit = (to, edge.to.port);
                    if exits.contains(&exit) {
                        seen_exits.insert(exit);
                    } else if entrances.contains(to)
                        || matches!(routes.nodes[to], NodeKind::Input | NodeKind::Output)
                    {
                        return Err(Error::Invalid(
                            "Sleeping branch sends or audio outputs overlap",
                        ));
                    } else if region.insert(to) {
                        queue.push(to);
                    }
                }
            }
            if seen_exits != exits || exits.iter().any(|(node, _)| region.contains(node)) {
                return Err(Error::Invalid(
                    "Sleeping branches must end only at their declared returns",
                ));
            }
            for &node in &region {
                if owners.insert(node, index).is_some()
                    || (!entrances.contains(node)
                        && routes
                            .incoming
                            .get(node)
                            .into_iter()
                            .flatten()
                            .any(|edge| !region.contains(edge.from.node.as_str())))
                {
                    return Err(Error::Invalid(
                        "Sleeping branches must own every processor and input path",
                    ));
                }
            }
            if !region
                .iter()
                .any(|node| matches!(routes.nodes[node], NodeKind::Tone3000 | NodeKind::Lv2))
            {
                return Err(Error::Invalid("A sleeping branch needs a processor"));
            }
            regions.push(region);
        }
        if host.graph.edges.iter().any(|edge| {
            let from = owners.get(edge.from.node.as_str());
            let to = owners.get(edge.to.node.as_str());
            from.is_some() && to.is_some() && from != to
        }) {
            return Err(Error::Invalid(
                "Sleeping branches cannot feed other sleeping branches",
            ));
        }
        if scenes.scenes.iter().any(|scene| {
            scene
                .gains
                .iter()
                .map(|row| &row.node)
                .chain(scene.controls.iter().map(|row| &row.node))
                .chain(scene.bypass.iter().map(|row| &row.node))
                .chain(scene.native_controls.iter().map(|row| &row.node))
                .chain(scene.native_bypass.iter().map(|row| &row.node))
                .any(|node| owners.contains_key(node.as_str()))
        }) {
            return Err(Error::Invalid(
                "Sleeping branch processors must keep their scene parameters while tails ring",
            ));
        }
        Ok(regions)
    }
}

impl Manifest {
    /// Derive candidate sends on actual edges serving exactly one named return
    /// region. Shared processing remains continuously running.
    pub fn preview_sleep_branches(&self) -> RigSleepPlan {
        match self.derive_sleep_branches() {
            Ok((plan, inserted_sends)) => RigSleepPlan {
                plan: Some(plan),
                inserted_sends,
                reason: None,
            },
            Err(error) => RigSleepPlan {
                plan: None,
                inserted_sends: Vec::new(),
                reason: Some(error.to_string()),
            },
        }
    }

    fn derive_sleep_branches(&self) -> Result<(SleepBranches, Vec<SleepSendBoundary>)> {
        let ineligible =
            || Error::Invalid("This rig has no closed scene branches with separate returns");
        let host = self.oxidal.as_ref().ok_or_else(ineligible)?;
        let scenes = self.scenes()?.ok_or_else(ineligible)?;
        if host.graph.nodes.len() > 256 || host.graph.edges.len() > 512 {
            return Err(Error::Invalid(
                "The rig exceeds the sleeping branch authoring limit",
            ));
        }
        if let Some(config) = self.sleep_branches()? {
            config.regions(host, &scenes)?;
            return Ok((config, Vec::new()));
        }
        if scenes.branches.is_empty() || scenes.branches.len() > MAX_SLEEP_BRANCHES {
            return Err(ineligible());
        }
        let routes = Routes::new(&host.graph);
        let ancestors: Vec<_> = scenes
            .branches
            .iter()
            .map(|branch| routes.ancestors(&branch.gains))
            .collect();
        let mut usage = BTreeMap::new();
        for node in ancestors.iter().flatten() {
            *usage.entry(*node).or_insert(0) += 1;
        }
        let mut ids: BTreeSet<_> = routes.nodes.keys().map(|node| (*node).to_owned()).collect();
        let mut sequence = 0;
        let mut inserted = Vec::new();
        let mut branches = Vec::new();
        for (branch, ancestors) in scenes.branches.iter().zip(ancestors) {
            let owned: BTreeSet<_> = ancestors
                .into_iter()
                .filter(|node| usage[node] == 1 && routes.nodes[node] != NodeKind::Input)
                .collect();
            // A dry/shared-only return stays running. The remaining plan must
            // still pass the same combined isolation proof.
            if !owned
                .iter()
                .any(|node| matches!(routes.nodes[node], NodeKind::Tone3000 | NodeKind::Lv2))
            {
                continue;
            }
            let boundary: Vec<_> = host
                .graph
                .edges
                .iter()
                .filter(|edge| {
                    owned.contains(edge.to.node.as_str())
                        && !owned.contains(edge.from.node.as_str())
                })
                .collect();
            if boundary.is_empty() || boundary.len() > 8 {
                return Err(ineligible());
            }
            let mut sends = Vec::with_capacity(boundary.len());
            for edge in boundary {
                let node = loop {
                    sequence += 1;
                    let id = format!("sleep-send-{sequence}");
                    if ids.insert(id.clone()) {
                        break id;
                    }
                };
                sends.push(node.clone());
                inserted.push(SleepSendBoundary {
                    node,
                    from: edge.from.clone(),
                    to: edge.to.clone(),
                });
            }
            branches.push(SleepBranch {
                branch: branch.id.clone(),
                sends,
            });
        }
        if branches.is_empty() {
            return Err(ineligible());
        }
        let config = SleepBranches {
            enabled: true,
            branches,
        };
        // Publication consumes this same derivation. Check shape, explicit
        // extensions and the complete closed region before previewing success.
        let mut candidate = self.clone();
        candidate.insert_sleep_branches(&config, &inserted)?;
        Ok((config, inserted))
    }

    pub fn prepare_sleep_branches(&mut self) -> Result<()> {
        let (config, inserted) = self.derive_sleep_branches()?;
        self.insert_sleep_branches(&config, &inserted)
    }

    fn insert_sleep_branches(
        &mut self,
        config: &SleepBranches,
        inserted: &[SleepSendBoundary],
    ) -> Result<()> {
        let host = self
            .oxidal
            .as_mut()
            .ok_or(Error::Invalid("This rig has no audio graph"))?;
        for send in inserted {
            let edge = host
                .graph
                .edges
                .iter_mut()
                .find(|edge| edge.from == send.from && edge.to == send.to)
                .ok_or(Error::Invalid("A sleeping branch send route has changed"))?;
            edge.to = Endpoint {
                node: send.node.clone(),
                port: 0,
            };
            host.graph.edges.push(Edge {
                from: Endpoint {
                    node: send.node.clone(),
                    port: 0,
                },
                to: send.to.clone(),
            });
            host.graph.nodes.push(Node {
                id: send.node.clone(),
                kind: NodeKind::Gain,
                audio_inputs: 1,
                audio_outputs: 1,
                instance: None,
                bypassed: None,
                input_gains: Some(vec![1.0]),
            });
        }
        let value = serde_json::to_value(config)
            .map_err(|_| Error::Invalid("Cannot encode sleeping branch plan"))?;
        let Value::Object(value) = value else {
            return Err(Error::Invalid("Cannot encode sleeping branch plan"));
        };
        self.extensions
            .insert(SLEEP_BRANCHES_EXTENSION.into(), value);
        if !inserted.is_empty() {
            self.extensions.entry(GAIN_EXTENSION.into()).or_default();
        }
        for key in [SLEEP_BRANCHES_EXTENSION, GAIN_EXTENSION] {
            if self.extensions.contains_key(key)
                && !self
                    .required_extensions
                    .iter()
                    .any(|required| required == key)
            {
                self.required_extensions.push(key.into());
            }
        }
        self.validate()?;
        config.regions(self.oxidal.as_ref().unwrap(), &self.scenes()?.unwrap())?;
        Ok(())
    }
}
