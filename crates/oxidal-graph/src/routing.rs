//! Validated processing order shared by DSP hosts; contains no audio resources.
use crate::{BlockKind, Rig};
use std::collections::BTreeMap;

/// Node indexes remain tied to the supplied rig's node order. Hosts must retain
/// that order when replacing edges so existing processor state stays attached.
#[derive(Debug)]
pub struct PreparedRouting {
    order: Vec<usize>,
    sources: Vec<Vec<usize>>,
    input: usize,
    output: usize,
}
impl PreparedRouting {
    /// Allocating control-thread work. Invalid routes never replace a live schedule.
    pub fn new(rig: &Rig) -> Result<Self, String> {
        let validation = rig.validate();
        if !validation.valid {
            return Err(validation.errors.join("; "));
        }
        let ids: BTreeMap<_, _> = rig
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();
        let mut sources = vec![Vec::new(); rig.nodes.len()];
        for edge in &rig.edges {
            sources[ids[edge.to.as_str()]].push(ids[edge.from.as_str()]);
        }
        let mut order = Vec::with_capacity(rig.nodes.len());
        while order.len() < rig.nodes.len() {
            let next = (0..rig.nodes.len())
                .find(|i| !order.contains(i) && sources[*i].iter().all(|s| order.contains(s)))
                .ok_or("Cyclic graph")?;
            order.push(next);
        }
        Ok(Self {
            order,
            sources,
            input: rig
                .nodes
                .iter()
                .position(|n| n.kind == BlockKind::Input)
                .expect("validated input"),
            output: rig
                .nodes
                .iter()
                .position(|n| n.kind == BlockKind::Output)
                .expect("validated output"),
        })
    }
    pub fn order(&self) -> &[usize] {
        &self.order
    }
    pub fn sources(&self, node: usize) -> &[usize] {
        &self.sources[node]
    }
    pub fn input(&self) -> usize {
        self.input
    }
    pub fn output(&self) -> usize {
        self.output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parallel_routes_resolve_identity_independently_of_storage_order() {
        let mut rig = Rig::example(true);
        rig.nodes.reverse();
        let route = PreparedRouting::new(&rig).unwrap();
        assert_eq!(rig.nodes[route.input()].id, "input");
        assert_eq!(rig.nodes[route.output()].id, "output");
        let delay = rig.nodes.iter().position(|n| n.id == "delay").unwrap();
        let inputs: Vec<_> = route
            .sources(delay)
            .iter()
            .map(|&i| rig.nodes[i].id.as_str())
            .collect();
        assert_eq!(inputs, ["nam-a", "nam-b"]);
        for (position, &node) in route.order().iter().enumerate() {
            assert!(
                route
                    .sources(node)
                    .iter()
                    .all(|source| route.order()[..position].contains(source))
            );
        }
        rig.edges.push(crate::Edge {
            from: "delay".into(),
            to: "nam-a".into(),
        });
        assert!(PreparedRouting::new(&rig).is_err());
    }
}
