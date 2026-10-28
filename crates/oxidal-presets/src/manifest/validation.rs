use super::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

fn require(valid: bool, reason: &'static str) -> Result<()> {
    if valid {
        Ok(())
    } else {
        Err(Error::Invalid(reason))
    }
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.chars().count() <= max
}
pub(super) fn id(s: &str) -> bool {
    text(s, 64)
        && s.as_bytes()[0].is_ascii_alphabetic()
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn symbol(s: &str) -> bool {
    !s.is_empty()
        && (s.as_bytes()[0].is_ascii_alphabetic() || s.starts_with('_'))
        && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn uri(s: &str) -> bool {
    let Some((scheme, rest)) = s.split_once(':') else {
        return false;
    };
    text(s, 2048)
        && !scheme.is_empty()
        && scheme.as_bytes()[0].is_ascii_alphabetic()
        && scheme
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"+.-".contains(&c))
        && !rest.is_empty()
        && !rest.chars().any(char::is_whitespace)
}
pub(super) fn safe_path(s: &str) -> bool {
    text(s, 240)
        && s.split('/').all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphanumeric()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
}
pub(super) fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(c)
            }
        })
        && (b'1'..=b'8').contains(&b[14])
        && b"89ab".contains(&b[19])
}
impl Manifest {
    pub(super) fn shape(&self) -> Result<()> {
        require(
            self.format == "oxidal.preset" && self.format_version == 1,
            "Unsupported preset format",
        )?;
        require(
            uuid(&self.id) && text(&self.name, 128),
            "Invalid preset identity",
        )?;
        require(
            self.extensions.len() <= 32
                && self.required_extensions.len() <= 32
                && self.extensions.keys().all(|key| uri(key))
                && self.required_extensions.iter().all(|key| uri(key))
                && self
                    .required_extensions
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
                    == self.required_extensions.len(),
            "Invalid preset extensions",
        )?;
        for native in &self.tone3000.instances {
            require(
                id(&native.id) && id(&native.preset) && text(&native.profile, 128),
                "Invalid native instance declaration",
            )?;
            if let Some(partition) = &native.partition {
                let target = |value: &str, limit| {
                    text(value, limit) && value.bytes().all(|b| b.is_ascii_graphic())
                };
                require(
                    match (partition.version, &partition.eq) {
                        (1, None) => true,
                        (2, Some(eq)) => {
                            eq.len() == 1
                                && eq[0].valid()
                                && match native.role() {
                                    ProcessingRole::Amp => eq[0].block_id == partition.amp,
                                    ProcessingRole::Cab => eq[0].block_id == partition.cab,
                                    ProcessingRole::Whole => false,
                                }
                        }
                        _ => false,
                    } && id(&partition.pair)
                        && target(&partition.amp, 128)
                        && target(&partition.cab, 128)
                        && partition.controls.iter().all(|(key, value)| {
                            target(key, 192) && value.is_finite() && (0.0..=1.0).contains(value)
                        }),
                    "Invalid native partition recipe",
                )?;
            }
            if let Some(origin) = &native.origin {
                require(
                    id(&origin.resource)
                        && origin
                            .source_preset_id
                            .as_ref()
                            .is_none_or(|s| text(s, 256)),
                    "Invalid native provenance",
                )?;
            }
        }
        require(self.resources.len() <= 4096, "Too many preset resources")?;
        for resource in &self.resources {
            require(
                id(&resource.id)
                    && safe_path(&resource.path)
                    && hash(&resource.sha256)
                    && (1..=MAX_RESOURCE_BYTES).contains(&resource.bytes),
                "Invalid resource declaration",
            )?;
        }
        if let Some(host) = &self.oxidal {
            require(
                host.graph.nodes.len() >= 2 && !host.graph.edges.is_empty(),
                "Empty host graph",
            )?;
            for plugin in &host.lv2 {
                require(
                    id(&plugin.id)
                        && uri(&plugin.plugin_uri)
                        && plugin.controls.len() <= 1024
                        && plugin
                            .controls
                            .iter()
                            .all(|(key, value)| symbol(key) && value.is_finite())
                        && plugin.state.as_ref().is_none_or(|s| id(s))
                        && plugin.assets.len() <= 1024
                        && plugin.assets.iter().all(|s| id(s))
                        && plugin.required_features.len() <= 128
                        && plugin.required_features.iter().all(|s| uri(s)),
                    "Invalid LV2 declaration",
                )?;
            }
            for node in &host.graph.nodes {
                let processing = matches!(node.kind, NodeKind::Tone3000 | NodeKind::Lv2);
                require(
                    id(&node.id)
                        && node.audio_inputs <= 64
                        && node.audio_outputs <= 64
                        && node.instance.is_some() == processing
                        && node.bypassed.is_some() == processing
                        && node.instance.as_ref().is_none_or(|s| id(s))
                        && node.input_gains.is_some() == (node.kind == NodeKind::Merge)
                        && node.input_gains.as_ref().is_none_or(|gains| {
                            !gains.is_empty()
                                && gains.len() <= 64
                                && gains
                                    .iter()
                                    .all(|g| g.is_finite() && (0.0..=4.0).contains(g))
                        }),
                    "Invalid host node shape",
                )?;
            }
            for edge in &host.graph.edges {
                require(
                    id(&edge.from.node)
                        && id(&edge.to.node)
                        && edge.from.port <= 63
                        && edge.to.port <= 63,
                    "Invalid host edge shape",
                )?;
            }
        }
        Ok(())
    }
    pub(super) fn semantics(&self) -> Result<()> {
        require(
            self.required_extensions
                .iter()
                .all(|key| self.extensions.contains_key(key)),
            "Missing required extension declaration",
        )?;
        let resources = unique(
            self.resources.iter().map(|r| (r.id.as_str(), r)),
            "Duplicate resource identifier",
        )?;
        // Include every directory component to reject case aliases and file/directory
        // conflicts on both case-sensitive and case-insensitive filesystems.
        let mut paths: BTreeMap<String, (String, bool)> =
            BTreeMap::from([("manifest.json".into(), ("manifest.json".into(), false))]);
        let mut total = MAX_MANIFEST_BYTES as u64;
        for resource in &self.resources {
            total = total
                .checked_add(resource.bytes)
                .ok_or(Error::Invalid("Preset size overflow"))?;
            require(total <= MAX_BUNDLE_BYTES, "Preset resources exceed 1 GiB")?;
            let parts: Vec<_> = resource.path.split('/').collect();
            for end in 1..=parts.len() {
                let path = parts[..end].join("/");
                let directory = end < parts.len();
                let folded = path.to_ascii_lowercase();
                if let Some((existing, was_directory)) = paths.get(&folded) {
                    require(
                        directory && *was_directory && *existing == path,
                        "Duplicate, case-colliding or conflicting resource path",
                    )?;
                } else {
                    paths.insert(folded, (path, directory));
                }
            }
        }
        let native = unique(
            self.tone3000.instances.iter().map(|n| (n.id.as_str(), n)),
            "Duplicate native instance",
        )?;
        let mut pairs: BTreeMap<&str, Vec<&NativeInstance>> = BTreeMap::new();
        for n in native.values() {
            if let Some(p) = &n.partition {
                require(
                    n.role() != ProcessingRole::Whole && p.amp != p.cab,
                    "Partition needs an extracted role and distinct blocks",
                )?;
                pairs.entry(&p.pair).or_default().push(n);
            }
        }
        for pair in pairs.values() {
            require(
                pair.len() == 2,
                "Partition needs exactly one amp and one cab",
            )?;
            let (a, b) = (pair[0], pair[1]);
            let (x, y) = (a.partition.as_ref().unwrap(), b.partition.as_ref().unwrap());
            require(
                a.role() != b.role()
                    && a.preset == b.preset
                    && a.profile == b.profile
                    && x.amp == y.amp
                    && x.cab == y.cab
                    && x.input == y.input,
                "Partition pair declarations disagree",
            )?;
        }
        let mut used_resources = BTreeSet::new();
        for n in native.values() {
            reference(
                &resources,
                &mut used_resources,
                &n.preset,
                ResourceKind::Tone3000Preset,
            )?;
            if let Some(origin) = &n.origin {
                reference(
                    &resources,
                    &mut used_resources,
                    &origin.resource,
                    ResourceKind::Tone3000Source,
                )?;
            }
        }
        if let Some(host) = &self.oxidal {
            let plugins = unique(
                host.lv2.iter().map(|p| (p.id.as_str(), p)),
                "Duplicate LV2 instance",
            )?;
            let mut owned = BTreeSet::new();
            for p in plugins.values() {
                require(
                    !native.contains_key(p.id.as_str()),
                    "Duplicate processing instance identifier",
                )?;
                for (resource, kind) in p
                    .state
                    .iter()
                    .map(|s| (s, ResourceKind::Lv2State))
                    .chain(p.assets.iter().map(|s| (s, ResourceKind::Lv2Asset)))
                {
                    require(
                        owned.insert(resource.as_str()),
                        "LV2 resource has multiple owners",
                    )?;
                    reference(&resources, &mut used_resources, resource, kind)?;
                }
            }
            host.graph.validate(&native, &plugins)?;
        } else {
            require(
                native.len() == 1 && native.values().all(|n| n.role() == ProcessingRole::Whole),
                "A pure preset requires one whole native instance",
            )?;
        }
        require(
            self.resources.iter().all(|r| {
                r.kind == ResourceKind::Tone3000Source || used_resources.contains(r.id.as_str())
            }),
            "Unreferenced processing resource",
        )?;
        Ok(())
    }
}
fn unique<'a, T>(
    pairs: impl Iterator<Item = (&'a str, T)>,
    reason: &'static str,
) -> Result<BTreeMap<&'a str, T>> {
    let mut result = BTreeMap::new();
    for (id, value) in pairs {
        require(result.insert(id, value).is_none(), reason)?;
    }
    Ok(result)
}
fn reference<'a>(
    resources: &BTreeMap<&str, &Resource>,
    used: &mut BTreeSet<&'a str>,
    id: &'a str,
    kind: ResourceKind,
) -> Result<()> {
    require(
        resources.get(id).is_some_and(|r| r.kind == kind),
        "Missing resource or incorrect resource kind",
    )?;
    used.insert(id);
    Ok(())
}
impl Graph {
    fn validate(
        &self,
        native: &BTreeMap<&str, &NativeInstance>,
        plugins: &BTreeMap<&str, &Lv2Instance>,
    ) -> Result<()> {
        let indices = unique(
            self.nodes
                .iter()
                .enumerate()
                .map(|(i, n)| (n.id.as_str(), i)),
            "Duplicate graph node",
        )?;
        let mut inputs = Vec::new();
        let mut outputs = Vec::new();
        let mut used_native = BTreeSet::new();
        let mut used_plugins = BTreeSet::new();
        for (index, node) in self.nodes.iter().enumerate() {
            let (ins, outs) = (node.audio_inputs, node.audio_outputs);
            match node.kind {
                NodeKind::Input => {
                    require(
                        ins == 0 && (1..=2).contains(&outs),
                        "Invalid logical input channels",
                    )?;
                    inputs.push(index);
                }
                NodeKind::Output => {
                    require(
                        outs == 0 && (1..=2).contains(&ins),
                        "Invalid logical output channels",
                    )?;
                    outputs.push(index);
                }
                NodeKind::Tone3000 => {
                    let id = node
                        .instance
                        .as_deref()
                        .ok_or(Error::Invalid("Missing native instance"))?;
                    require(
                        native.contains_key(id) && used_native.insert(id),
                        "Missing or reused native instance",
                    )?;
                    require(
                        (1..=2).contains(&ins) && ins == outs,
                        "Invalid native audio channels",
                    )?;
                }
                NodeKind::Lv2 => {
                    let id = node
                        .instance
                        .as_deref()
                        .ok_or(Error::Invalid("Missing LV2 instance"))?;
                    require(
                        plugins.contains_key(id) && used_plugins.insert(id),
                        "Missing or reused LV2 instance",
                    )?;
                    require(ins > 0 && outs > 0, "Disconnected LV2 processor")?;
                }
                NodeKind::Split => require(ins == 1 && outs >= 2, "Invalid split channels")?,
                NodeKind::Merge => require(
                    ins >= 2
                        && outs == 1
                        && node
                            .input_gains
                            .as_ref()
                            .is_some_and(|g| g.len() == usize::from(ins)),
                    "Invalid merge channels or gains",
                )?,
            }
        }
        require(
            inputs.len() == 1 && outputs.len() == 1,
            "A rig requires one input and one output",
        )?;
        require(
            used_native.len() == native.len() && used_plugins.len() == plugins.len(),
            "Unused processing instance",
        )?;
        let count = self.nodes.len();
        let mut outgoing = vec![vec![]; count];
        let mut incoming = vec![vec![]; count];
        let mut source_ports = BTreeSet::new();
        let mut destination_ports = BTreeSet::new();
        for edge in &self.edges {
            let from = *indices
                .get(edge.from.node.as_str())
                .ok_or(Error::Invalid("Missing edge source"))?;
            let to = *indices
                .get(edge.to.node.as_str())
                .ok_or(Error::Invalid("Missing edge destination"))?;
            require(
                edge.from.port < self.nodes[from].audio_outputs
                    && edge.to.port < self.nodes[to].audio_inputs,
                "Graph edge port out of range",
            )?;
            require(
                source_ports.insert(&edge.from) && destination_ports.insert(&edge.to),
                "Duplicate edge or implicit fan-in/fan-out; use split and merge nodes",
            )?;
            outgoing[from].push(to);
            incoming[to].push(from);
        }
        for node in &self.nodes {
            for port in 0..node.audio_inputs {
                require(
                    destination_ports.contains(&Endpoint {
                        node: node.id.clone(),
                        port,
                    }),
                    "Unconnected audio input",
                )?;
            }
        }
        let mut indegree: Vec<_> = incoming.iter().map(Vec::len).collect();
        let mut ready: VecDeque<_> = indegree
            .iter()
            .enumerate()
            .filter_map(|(i, degree)| (*degree == 0).then_some(i))
            .collect();
        let mut processed = 0;
        while let Some(node) = ready.pop_front() {
            processed += 1;
            for &next in &outgoing[node] {
                indegree[next] -= 1;
                if indegree[next] == 0 {
                    ready.push_back(next);
                }
            }
        }
        require(processed == count, "Feedback cycles are unsupported")?;
        require(
            reachable(inputs[0], &outgoing).iter().all(|v| *v)
                && reachable(outputs[0], &incoming).iter().all(|v| *v),
            "Graph contains disconnected processing",
        )?;
        Ok(())
    }
}
fn reachable(start: usize, edges: &[Vec<usize>]) -> Vec<bool> {
    let mut seen = vec![false; edges.len()];
    let mut pending = vec![start];
    while let Some(node) = pending.pop() {
        if !seen[node] {
            seen[node] = true;
            pending.extend(&edges[node]);
        }
    }
    seen
}
