//! Explicit scalar-port execution for portable host graphs. Processor preparation
//! and matching native payload/profile qualification remain the caller's job.
use crate::Processor;
use oxidal_presets::{
    Bundle,
    manifest::{NodeKind, ProcessingRole, Tails},
};
use oxidal_tone3000::ProcessingRole as NativeRole;
use std::collections::{BTreeMap, VecDeque};

#[derive(Debug)]
struct PortNode {
    id: String,
    kind: NodeKind,
    channels: usize,
    offset: usize,
    sources: Vec<(usize, usize)>,
    processor: Option<Processor>,
    bypassed: bool,
    gains: Vec<f32>,
}
/// One owner, fixed blocks, explicit split/merge gains. This executes prepared
/// instances; it does not import plugins, implement latency compensation, restore
/// opaque LV2 state, or promise callback-safe transitions.
#[derive(Debug)]
pub struct PreparedPorts {
    nodes: Vec<PortNode>,
    order: Vec<usize>,
    samples: Vec<f32>,
    frames: usize,
    input: usize,
    output: usize,
    failed: bool,
}
impl PreparedPorts {
    /// The caller supplies processors prepared from this same verified document.
    /// Bindings use instance IDs, not display names. Buffer admission is measured
    /// in bytes; there is no fixed instance count. Plugin allocations are separate.
    pub fn new(
        bundle: &Bundle,
        mut processors: BTreeMap<String, Processor>,
        rate: f64,
        frames: usize,
        buffer_budget: usize,
    ) -> Result<Self, String> {
        let manifest = bundle.manifest();
        manifest.validate().map_err(|e| e.to_string())?;
        manifest
            .check_required_extensions()
            .map_err(|e| e.to_string())?;
        if !rate.is_finite()
            || !(8000.0..=192000.0).contains(&rate)
            || frames == 0
            || frames > 2048
            || !frames.is_power_of_two()
        {
            return Err("Invalid port graph configuration".into());
        }
        let host = manifest
            .oxidal
            .as_ref()
            .ok_or("Explicit host graph required")?;
        if host.recall.tails != Tails::Cut {
            return Err("Preserve tails requires a qualified transition host".into());
        }
        if host
            .lv2
            .iter()
            .any(|p| p.state.is_some() || !p.assets.is_empty() || !p.required_features.is_empty())
        {
            return Err(
                "Portable LV2 state, assets or declared features require unsupported restoration"
                    .into(),
            );
        }
        let indices: BTreeMap<_, _> = host
            .graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();
        let mut nodes = Vec::new();
        let mut sample_count = 0usize;
        let mut input = 0;
        let mut output = 0;
        for (index, declaration) in host.graph.nodes.iter().enumerate() {
            let channels = usize::from(declaration.audio_inputs.max(declaration.audio_outputs));
            let offset = sample_count;
            sample_count = sample_count
                .checked_add(
                    channels
                        .checked_mul(frames)
                        .ok_or("Port buffer size overflow")?,
                )
                .ok_or("Port buffer size overflow")?;
            if sample_count
                .checked_mul(size_of::<f32>())
                .is_none_or(|bytes| bytes > buffer_budget)
            {
                return Err("Port graph exceeds its host buffer budget".into());
            }
            let mut processor = declaration
                .instance
                .as_ref()
                .and_then(|id| processors.remove(id));
            match declaration.kind {
                NodeKind::Tone3000 => {
                    let Some(Processor::Native(p)) = processor.as_ref() else {
                        return Err("Missing native processor".into());
                    };
                    let instance = manifest
                        .tone3000
                        .instances
                        .iter()
                        .find(|n| Some(&n.id) == declaration.instance.as_ref())
                        .ok_or("Missing native declaration")?;
                    let role = match instance.role() {
                        ProcessingRole::Whole => NativeRole::WholePreset,
                        ProcessingRole::Amp => NativeRole::Amp,
                        ProcessingRole::Cab => NativeRole::Cab,
                    };
                    // Native ABI is stereo. Mono stage persistence needs explicit
                    // input-mode/state admission before a one-port node is allowed.
                    if channels != 2 || p.processing_role() != role {
                        return Err("Native role or channel layout differs".into());
                    }
                }
                NodeKind::Lv2 => {
                    let Some(Processor::Lv2(p)) = processor.as_mut() else {
                        return Err("Missing LV2 processor".into());
                    };
                    let instance = host
                        .lv2
                        .iter()
                        .find(|p| Some(&p.id) == declaration.instance.as_ref())
                        .ok_or("Missing LV2 declaration")?;
                    let info = p.info();
                    if info.uri != instance.plugin_uri
                        || p.channels() != channels
                        || info.ports.iter().filter(|p| p.audio && p.input).count()
                            != usize::from(declaration.audio_inputs)
                        || info.ports.iter().filter(|p| p.audio && p.output).count()
                            != usize::from(declaration.audio_outputs)
                    {
                        return Err("LV2 URI or discovered audio ports differ".into());
                    }
                    for (port, value) in crate::loading::control_values(instance, info)? {
                        p.set(port, value)?;
                    }
                }
                NodeKind::Input => input = index,
                NodeKind::Output => output = index,
                NodeKind::Split | NodeKind::Merge => {}
            }
            if let Some(p) = &mut processor {
                if p.configuration() != (rate, frames) {
                    return Err("Processor audio configuration differs".into());
                }
                p.ready()?;
            }
            nodes.push(PortNode {
                id: declaration.id.clone(),
                kind: declaration.kind,
                channels,
                offset,
                sources: vec![],
                processor,
                bypassed: declaration.bypassed.unwrap_or(false),
                gains: declaration
                    .input_gains
                    .as_ref()
                    .map_or_else(Vec::new, |g| g.iter().map(|v| *v as f32).collect()),
            });
        }
        if !processors.is_empty() {
            return Err("Unreferenced prepared processor".into());
        }
        let mut outgoing = vec![vec![]; nodes.len()];
        let mut degree = vec![0; nodes.len()];
        for edge in &host.graph.edges {
            let from = indices[edge.from.node.as_str()];
            let to = indices[edge.to.node.as_str()];
            let source = nodes[from].offset + usize::from(edge.from.port) * frames;
            nodes[to]
                .sources
                .push((usize::from(edge.to.port) * frames, source));
            outgoing[from].push(to);
            degree[to] += 1;
        }
        let mut ready: VecDeque<_> = degree
            .iter()
            .enumerate()
            .filter_map(|(i, d)| (*d == 0).then_some(i))
            .collect();
        let mut order = Vec::with_capacity(nodes.len());
        while let Some(i) = ready.pop_front() {
            order.push(i);
            for &next in &outgoing[i] {
                degree[next] -= 1;
                if degree[next] == 0 {
                    ready.push_back(next);
                }
            }
        }
        if order.len() != nodes.len() {
            return Err("Feedback cycle".into());
        }
        let mut samples = Vec::new();
        samples
            .try_reserve_exact(sample_count)
            .map_err(|_| "Port graph buffers unavailable")?;
        samples.resize(sample_count, 0.0);
        Ok(Self {
            nodes,
            order,
            samples,
            frames,
            input,
            output,
            failed: false,
        })
    }
    pub fn channels(&self) -> (usize, usize) {
        (
            self.nodes[self.input].channels,
            self.nodes[self.output].channels,
        )
    }
    pub fn buffer_bytes(&self) -> usize {
        self.samples.len() * size_of::<f32>()
    }
    /// Control/qualification access, outside concurrent processing. A future Save
    /// must serialize confirmed backend state rather than reuse the initial view.
    pub fn processor_mut(&mut self, node: &str) -> Option<&mut Processor> {
        if self.failed {
            return None;
        }
        self.nodes
            .iter_mut()
            .find(|n| n.id == node)?
            .processor
            .as_mut()
    }
    pub(crate) fn host_value(
        &mut self,
        target: &crate::protocol::Target,
        value: f64,
    ) -> Result<(), String> {
        if self.failed {
            return Err("Failed port graph".into());
        }
        use crate::protocol::Target;
        match target {
            Target::Bypass { node } => {
                let n = self
                    .nodes
                    .iter_mut()
                    .find(|n| &n.id == node && n.processor.is_some())
                    .ok_or("Unknown bypass")?;
                if value != 0.0 && value != 1.0 {
                    return Err("Invalid bypass".into());
                }
                n.bypassed = value == 1.0;
            }
            Target::Merge { node, port } => {
                let n = self
                    .nodes
                    .iter_mut()
                    .find(|n| &n.id == node && n.kind == NodeKind::Merge)
                    .ok_or("Unknown merge")?;
                let gain = n.gains.get_mut(*port).ok_or("Unknown merge port")?;
                if !value.is_finite() || !(0.0..=4.0).contains(&value) {
                    return Err("Invalid merge gain".into());
                }
                *gain = value as f32;
            }
            _ => return Err("Not a host control".into()),
        }
        Ok(())
    }
    pub fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]]) -> Result<(), String> {
        if self.failed
            || inputs.len() != self.channels().0
            || outputs.len() != self.channels().1
            || inputs
                .iter()
                .any(|p| p.len() != self.frames || p.iter().any(|v| !v.is_finite()))
            || outputs.iter().any(|p| p.len() != self.frames)
        {
            for port in outputs {
                port.fill(0.0);
            }
            return Err("Invalid or failed port graph request".into());
        }
        let offset = self.nodes[self.input].offset;
        for (port, samples) in inputs.iter().enumerate() {
            let start = offset + port * self.frames;
            self.samples[start..start + self.frames].copy_from_slice(samples);
        }
        if let Err(error) = self.run() {
            self.failed = true;
            for port in outputs {
                port.fill(0.0);
            }
            return Err(error);
        }
        let offset = self.nodes[self.output].offset;
        for (port, samples) in outputs.iter_mut().enumerate() {
            let start = offset + port * self.frames;
            samples.copy_from_slice(&self.samples[start..start + self.frames]);
        }
        Ok(())
    }
    fn run(&mut self) -> Result<(), String> {
        for &index in &self.order {
            let node = &mut self.nodes[index];
            for &(port, source) in &node.sources {
                self.samples
                    .copy_within(source..source + self.frames, node.offset + port);
            }
            let data = &mut self.samples[node.offset..node.offset + node.channels * self.frames];
            match node.kind {
                NodeKind::Split => {
                    for port in 1..node.channels {
                        data.copy_within(0..self.frames, port * self.frames);
                    }
                }
                NodeKind::Merge => {
                    for frame in 0..self.frames {
                        let value = node
                            .gains
                            .iter()
                            .enumerate()
                            .map(|(port, gain)| data[port * self.frames + frame] * gain)
                            .sum();
                        data[frame] = value;
                    }
                }
                NodeKind::Tone3000 | NodeKind::Lv2 if !node.bypassed => {
                    match node.processor.as_mut().ok_or("Missing processor")? {
                        Processor::Native(p) => {
                            let (left, right) = data.split_at_mut(self.frames);
                            p.process(left, right).map_err(|e| e.to_string())?;
                        }
                        Processor::Lv2(p) if node.channels == 1 => p.process_mono(data)?,
                        Processor::Lv2(p) => {
                            let (left, right) = data.split_at_mut(self.frames);
                            p.process(left, right)?;
                        }
                    }
                }
                _ => {}
            }
            if data.iter().any(|v| !v.is_finite()) {
                return Err("Non-finite port graph output".into());
            }
        }
        Ok(())
    }
}
