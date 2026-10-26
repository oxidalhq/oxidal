use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// Persisted routing data, independent of UI layout and audio resources.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Rig {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// Stable block identity and a declared PoC block kind.
/// @see docs/architecture.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub kind: BlockKind,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Input,
    Nam,
    Cabinet,
    Lv2,
    Delay,
    Reverb,
    Output,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Validation {
    pub valid: bool,
    pub errors: Vec<String>,
}

impl Rig {
    /// A small serial or parallel NAM rig; describes routing, not an audio engine.
    /// @see docs/architecture.md
    pub fn example(parallel: bool) -> Self {
        let mut nodes = vec![
            Node {
                id: "input".into(),
                kind: BlockKind::Input,
                level: 1.0,
            },
            Node {
                id: "nam-a".into(),
                kind: BlockKind::Nam,
                level: 0.5,
            },
            Node {
                id: "delay".into(),
                kind: BlockKind::Delay,
                level: 0.25,
            },
            Node {
                id: "reverb".into(),
                kind: BlockKind::Reverb,
                level: 0.2,
            },
            Node {
                id: "output".into(),
                kind: BlockKind::Output,
                level: 0.7,
            },
        ];
        let mut edges = vec![
            ("input", "nam-a"),
            ("nam-a", "delay"),
            ("delay", "reverb"),
            ("reverb", "output"),
        ];
        if parallel {
            nodes.insert(
                2,
                Node {
                    id: "nam-b".into(),
                    kind: BlockKind::Nam,
                    level: 0.5,
                },
            );
            edges.extend([("input", "nam-b"), ("nam-b", "delay")]);
        }
        Self {
            nodes,
            edges: edges
                .into_iter()
                .map(|(from, to)| Edge {
                    from: from.into(),
                    to: to.into(),
                })
                .collect(),
        }
    }

    /// Validates bounded DAG routing, endpoint direction, reachability and levels.
    /// @see docs/architecture.md
    pub fn validate(&self) -> Validation {
        let mut errors = Vec::new();
        if self.nodes.is_empty() || self.nodes.len() > 64 || self.edges.len() > 128 {
            return Validation {
                valid: false,
                errors: vec!["A rig needs 1–64 nodes and at most 128 edges".into()],
            };
        }
        let mut nodes = BTreeMap::new();
        for node in &self.nodes {
            if node.id.is_empty()
                || node.id.len() > 64
                || !node
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                errors.push(format!("Invalid node ID: {}", node.id));
            }
            if nodes.insert(node.id.as_str(), node).is_some() {
                errors.push(format!("Duplicate node: {}", node.id));
            }
            if !node.level.is_finite() || !(0.0..=1.0).contains(&node.level) {
                errors.push(format!("Invalid level: {}", node.id));
            }
        }
        if self
            .nodes
            .iter()
            .filter(|n| n.kind == BlockKind::Input)
            .count()
            != 1
            || self
                .nodes
                .iter()
                .filter(|n| n.kind == BlockKind::Output)
                .count()
                != 1
        {
            errors.push("Exactly one input and one output are required".into());
        }
        let mut degree: BTreeMap<&str, usize> = nodes.keys().map(|id| (*id, 0)).collect();
        let mut edges = BTreeSet::new();
        for edge in &self.edges {
            let (Some(from), Some(to)) =
                (nodes.get(edge.from.as_str()), nodes.get(edge.to.as_str()))
            else {
                errors.push(format!("Missing endpoint: {} → {}", edge.from, edge.to));
                continue;
            };
            if !edges.insert((edge.from.as_str(), edge.to.as_str())) {
                errors.push("Duplicate edge".into());
            }
            if from.kind == BlockKind::Output || to.kind == BlockKind::Input {
                errors.push("Invalid input/output direction".into());
            }
            *degree.get_mut(edge.to.as_str()).expect("known endpoint") += 1;
        }
        let mut queue: VecDeque<&str> = degree
            .iter()
            .filter(|(_, d)| **d == 0)
            .map(|(id, _)| *id)
            .collect();
        let mut visited = 0;
        while let Some(id) = queue.pop_front() {
            visited += 1;
            for (_, to) in edges.iter().filter(|(from, _)| *from == id) {
                let d = degree.get_mut(to).expect("known endpoint");
                *d = d.saturating_sub(1);
                if *d == 0 {
                    queue.push_back(to);
                }
            }
        }
        if visited != nodes.len() {
            errors.push("Routing contains a cycle".into());
        }
        for node in &self.nodes {
            let reaches = |reverse: bool, kind: BlockKind| {
                let mut seen = BTreeSet::new();
                let mut todo = vec![node.id.as_str()];
                while let Some(id) = todo.pop() {
                    if !seen.insert(id) {
                        continue;
                    }
                    if nodes.get(id).is_some_and(|n| n.kind == kind) {
                        return true;
                    }
                    for (from, to) in &edges {
                        if (!reverse && *from == id) || (reverse && *to == id) {
                            todo.push(if reverse { from } else { to });
                        }
                    }
                }
                false
            };
            if !reaches(true, BlockKind::Input) || !reaches(false, BlockKind::Output) {
                errors.push(format!("Disconnected block: {}", node.id));
            }
        }
        Validation {
            valid: errors.is_empty(),
            errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serial_and_parallel_are_valid() {
        for parallel in [false, true] {
            assert!(Rig::example(parallel).validate().valid);
        }
    }
    #[test]
    fn rejects_cycles_and_missing_endpoints() {
        let mut rig = Rig::example(false);
        rig.edges.push(Edge {
            from: "reverb".into(),
            to: "nam-a".into(),
        });
        assert!(rig.validate().errors.iter().any(|e| e.contains("cycle")));
        rig.edges.push(Edge {
            from: "missing".into(),
            to: "delay".into(),
        });
        assert!(
            rig.validate()
                .errors
                .iter()
                .any(|e| e.contains("Missing endpoint"))
        );
    }
    #[test]
    fn rejects_duplicates_nonfinite_and_disconnected() {
        let mut rig = Rig::example(false);
        rig.nodes.push(rig.nodes[1].clone());
        assert!(!rig.validate().valid);
        let mut rig = Rig::example(false);
        rig.nodes[1].level = f64::NAN;
        assert!(!rig.validate().valid);
        let mut rig = Rig::example(false);
        rig.edges.remove(0);
        assert!(
            rig.validate()
                .errors
                .iter()
                .any(|e| e.contains("Disconnected"))
        );
    }
}
