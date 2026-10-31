//! Explicit scalar-port execution for portable host graphs. Processor preparation
//! and matching native payload/profile qualification remain the caller's job.
use crate::Processor;
use oxidal_presets::{
    Bundle,
    manifest::{NodeKind, ProcessingRole},
};
use oxidal_tone3000::ProcessingRole as NativeRole;
use std::collections::{BTreeMap, VecDeque};

#[derive(Debug)]
struct PortNode {
    id: String,
    kind: NodeKind,
    channels: usize,
    offset: usize,
    sources: Vec<Source>,
    latency: u32,
    dry: Vec<Delay>,
    processor: Option<Processor>,
    /// Render-thread handle for a native processor, created on first render.
    port: Option<oxidal_tone3000::AudioPort>,
    bypassed: bool,
    gains: Vec<Gain>,
}
// Ramp state belongs to each already prepared merge input. No processing-time
// allocation or processor reconstruction is needed when selecting a scene.
#[derive(Debug)]
struct Gain {
    current: f32,
    target: f32,
    step: f32,
    remaining: u32,
}
impl Gain {
    fn new(value: f32) -> Self {
        Self {
            current: value,
            target: value,
            step: 0.0,
            remaining: 0,
        }
    }
    fn set(&mut self, value: f32, frames: u32) {
        self.target = value;
        self.remaining = frames;
        self.step = if frames == 0 {
            0.0
        } else {
            (value - self.current) / frames as f32
        };
        if frames == 0 {
            self.current = value;
        }
    }
    fn next(&mut self) -> f32 {
        if self.remaining != 0 {
            self.remaining -= 1;
            self.current = if self.remaining == 0 {
                self.target
            } else {
                self.current + self.step
            };
        }
        self.current
    }
}
#[derive(Debug, Default)]
pub(crate) struct Delay {
    samples: Vec<f32>,
    cursor: usize,
}
impl Delay {
    pub(crate) fn new(frames: usize, used: &mut usize, budget: usize) -> Result<Self, String> {
        *used = frames
            .checked_mul(size_of::<f32>())
            .and_then(|bytes| used.checked_add(bytes))
            .filter(|bytes| *bytes <= budget)
            .ok_or("Delay compensation exceeds host buffer budget")?;
        let mut samples = Vec::new();
        samples
            .try_reserve_exact(frames)
            .map_err(|_| "Delay buffers unavailable")?;
        samples.resize(frames, 0.0);
        Ok(Self { samples, cursor: 0 })
    }
    pub(crate) fn next(&mut self, input: f32) -> f32 {
        if self.samples.is_empty() {
            return input;
        }
        let output = self.samples[self.cursor];
        self.samples[self.cursor] = input;
        self.cursor += 1;
        if self.cursor == self.samples.len() {
            self.cursor = 0;
        }
        output
    }
}
#[derive(Debug)]
struct Source {
    port: usize,
    sample: usize,
    node: usize,
    delay: Delay,
}
/// One owner, fixed blocks, explicit split/merge gains. This executes prepared
/// instances with reported-delay compensation and verified LV2 state/assets.
/// It does not promise callback-safe transitions.
#[derive(Debug)]
pub struct PreparedPorts {
    nodes: Vec<PortNode>,
    order: Vec<usize>,
    samples: Vec<f32>,
    frames: usize,
    input: usize,
    output: usize,
    failed: bool,
    buffer_bytes: usize,
    latency_frames: u32,
    /// Length of the group of independent native lanes starting at each
    /// position of `order` (0 inside or outside a group).
    waves: Vec<usize>,
    /// Helpers that render a group's lanes in parallel, with the render thread.
    lanes: Option<crate::render::RenderPool>,
    // Declared after nodes so plugins finish worker cleanup before files disappear.
    assets: crate::lv2_state::Assets,
}
/// Cores beyond the render thread that lanes may use (the Pi 5 has four).
const LANE_HELPERS: usize = 3;
impl PreparedPorts {
    /// The caller supplies processors prepared from this same verified document.
    /// Bindings use instance IDs, not display names. Buffer admission is measured
    /// in bytes; there is no fixed instance count. Plugin allocations are separate.
    pub fn new(
        bundle: &Bundle,
        processors: BTreeMap<String, Processor>,
        rate: f64,
        frames: usize,
        buffer_budget: usize,
    ) -> Result<Self, String> {
        let manifest = bundle.manifest();
        manifest.validate().map_err(|e| e.to_string())?;
        manifest
            .check_required_extensions()
            .map_err(|e| e.to_string())?;
        if !rate.is_finite() || !(8000.0..=192000.0).contains(&rate) || frames == 0 || frames > 2048
        {
            return Err("Invalid port graph configuration".into());
        }
        let host = manifest
            .oxidal
            .as_ref()
            .ok_or("Explicit host graph required")?;
        if host.lv2.iter().any(|p| !p.required_features.is_empty()) {
            return Err("Unsupported declared LV2 features".into());
        }
        let assets = crate::lv2_state::Assets::new(bundle)?;
        // The moved parameter must drop before assets on every error path too.
        let mut processors = processors;
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
                    assets.restore(p, instance, bundle)?;
                }
                NodeKind::Input => input = index,
                NodeKind::Output => output = index,
                NodeKind::Split | NodeKind::Merge | NodeKind::Gain => {}
            }
            if let Some(p) = &mut processor {
                if p.configuration() != (rate, frames) {
                    return Err("Processor audio configuration differs".into());
                }
                p.ready()?;
            }
            let latency = processor
                .as_ref()
                .map_or(Ok(0), Processor::latency_frames)?;
            nodes.push(PortNode {
                id: declaration.id.clone(),
                kind: declaration.kind,
                channels,
                offset,
                sources: vec![],
                latency,
                dry: vec![],
                processor,
                port: None,
                bypassed: declaration.bypassed.unwrap_or(false),
                gains: declaration.input_gains.as_ref().map_or_else(Vec::new, |g| {
                    g.iter().map(|v| Gain::new(*v as f32)).collect()
                }),
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
            nodes[to].sources.push(Source {
                port: usize::from(edge.to.port) * frames,
                sample: source,
                node: from,
                delay: Delay::default(),
            });
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
        let mut buffer_bytes = sample_count
            .checked_mul(size_of::<f32>())
            .ok_or("Port buffer size overflow")?;
        for node in &nodes {
            buffer_bytes = node
                .gains
                .len()
                .checked_mul(size_of::<Gain>())
                .and_then(|bytes| buffer_bytes.checked_add(bytes))
                .filter(|bytes| *bytes <= buffer_budget)
                .ok_or("Merge ramp state exceeds host buffer budget")?;
        }
        let mut latency = vec![0u32; nodes.len()];
        for &index in &order {
            let n = &mut nodes[index];
            let arrival = n.sources.iter().map(|s| latency[s.node]).max().unwrap_or(0);
            latency[index] = arrival
                .checked_add(n.latency)
                .ok_or("Path latency overflow")?;
            for source in &mut n.sources {
                source.delay = Delay::new(
                    (arrival - latency[source.node]) as usize,
                    &mut buffer_bytes,
                    buffer_budget,
                )?;
            }
            if n.processor.is_some() {
                for _ in 0..n.channels {
                    n.dry.push(Delay::new(
                        n.latency as usize,
                        &mut buffer_bytes,
                        buffer_budget,
                    )?);
                }
            }
        }
        let mut samples = Vec::new();
        samples
            .try_reserve_exact(sample_count)
            .map_err(|_| "Port graph buffers unavailable")?;
        samples.resize(sample_count, 0.0);
        // Consecutive native lanes that read nothing from each other render in
        // parallel; each keeps its slot (and so its thread) for the graph's life.
        let mut waves = vec![0; order.len()];
        let mut start = 0;
        while start < order.len() {
            let native = |i: usize| {
                nodes[i].kind == NodeKind::Tone3000
                    && matches!(nodes[i].processor, Some(Processor::Native(_)))
            };
            let mut end = start;
            while end < order.len()
                && native(order[end])
                && nodes[order[end]]
                    .sources
                    .iter()
                    .all(|source| !order[start..end].contains(&source.node))
            {
                end += 1;
            }
            if end - start >= 2 {
                waves[start] = end - start;
                start = end;
            } else {
                start += 1;
            }
        }
        let widest = waves.iter().copied().max().unwrap_or(0);
        let lanes = if crate::render::render_thread_enabled() && widest >= 2 {
            let helpers = (widest - 1).min(LANE_HELPERS);
            Some(crate::render::RenderPool::new(
                helpers,
                widest.div_ceil(helpers + 1),
            )?)
        } else {
            None
        };
        Ok(Self {
            nodes,
            order,
            waves,
            lanes,
            samples,
            frames,
            input,
            output,
            failed: false,
            buffer_bytes,
            latency_frames: latency[output],
            assets,
        })
    }
    pub(crate) fn lv2_state(
        &mut self,
        node: &str,
        instance: &str,
    ) -> Result<oxidal_lv2::PluginState, String> {
        let paths = self.assets.paths(instance)?.to_vec();
        let Some(Processor::Lv2(plugin)) = self.processor_mut(node) else {
            return Err("Missing LV2 state processor".into());
        };
        plugin.save_state(&paths)
    }
    pub fn channels(&self) -> (usize, usize) {
        (
            self.nodes[self.input].channels,
            self.nodes[self.output].channels,
        )
    }
    pub fn buffer_bytes(&self) -> usize {
        self.buffer_bytes
    }
    /// Owner-thread check that no processor's latency moved away from the
    /// prepared alignment. Marks the graph failed if one did.
    pub(crate) fn verify_latency(&mut self) -> Result<(), String> {
        for node in &self.nodes {
            if node
                .processor
                .as_ref()
                .map_or(Ok(0), Processor::latency_frames)?
                != node.latency
            {
                self.failed = true;
                return Err("Processor latency changed; prepare a new graph".into());
            }
        }
        Ok(())
    }
    /// Reported processing delay plus host alignment, excluding device/transport.
    pub fn latency_frames(&self) -> u32 {
        self.latency_frames
    }
    /// Isolated startup/recovery only: settle native edits and establish one
    /// stream origin after model/control replay, before any real input arrives.
    pub(crate) fn finish_preparation(&mut self) -> Result<(), String> {
        for node in &mut self.nodes {
            if let Some(Processor::Native(engine)) = &mut node.processor {
                engine.prepare_stream().map_err(|e| e.to_string())?;
                if engine.latency_samples().map_err(|e| e.to_string())? != node.latency {
                    return Err("Replayed native delay differs from prepared routing".into());
                }
            }
            for delay in node
                .dry
                .iter_mut()
                .chain(node.sources.iter_mut().map(|s| &mut s.delay))
            {
                delay.samples.fill(0.0);
                delay.cursor = 0;
            }
        }
        self.samples.fill(0.0);
        Ok(())
    }
    pub(crate) fn frames(&self) -> usize {
        self.frames
    }
    pub(crate) fn expected_latency(&self, node: &str) -> Option<u32> {
        self.nodes.iter().find(|n| n.id == node).map(|n| n.latency)
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
                    .find(|n| &n.id == node && matches!(n.kind, NodeKind::Merge | NodeKind::Gain))
                    .ok_or("Unknown merge")?;
                let gain = n.gains.get_mut(*port).ok_or("Unknown merge port")?;
                if !value.is_finite() || !(0.0..=4.0).contains(&value) {
                    return Err("Invalid merge gain".into());
                }
                gain.set(value as f32, 0);
            }
            _ => return Err("Not a host control".into()),
        }
        Ok(())
    }
    /// Validate every target before touching DSP, then start all gain ramps at
    /// the same stream position. Retargeting starts at the current audible gain.
    /// Ramps scene gains: opening ones over `frames`, closing ones over
    /// `release` (a blend lets the outgoing scene fade out slowly).
    pub(crate) fn scene_gains(
        &mut self,
        values: &[oxidal_presets::manifest::SceneGain],
        frames: u32,
        release: u32,
    ) -> Result<(), String> {
        if self.failed || frames == 0 || release == 0 {
            return Err("Invalid scene transition".into());
        }
        for (i, value) in values.iter().enumerate() {
            if !value.value.is_finite()
                || !(0.0..=4.0).contains(&value.value)
                || values[..i]
                    .iter()
                    .any(|v| v.node == value.node && v.port == value.port)
                || !self.nodes.iter().any(|n| {
                    n.id == value.node
                        && matches!(n.kind, NodeKind::Merge | NodeKind::Gain)
                        && usize::from(value.port) < n.gains.len()
                })
            {
                return Err("Invalid scene gain target".into());
            }
        }
        for value in values {
            let node = self.nodes.iter_mut().find(|n| n.id == value.node).unwrap();
            let gain = &mut node.gains[usize::from(value.port)];
            let closing = (value.value as f32) < gain.target;
            gain.set(value.value as f32, if closing { release } else { frames });
        }
        Ok(())
    }
    pub(crate) fn scene_transitioning(&self) -> bool {
        self.nodes
            .iter()
            .any(|n| n.gains.iter().any(|g| g.remaining != 0))
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
        // With a separate render thread, the owner verifies latency instead
        // (`verify_latency`): native latency queries are owner-thread calls.
        let check_latency = !crate::render::render_thread_enabled();
        let mut position = 0;
        while position < self.order.len() {
            let wave = self.waves[position];
            let slots = self.lanes.as_ref().map_or(0, |l| l.helpers() + 1);
            // The render thread takes at most four lanes of a group itself.
            if wave >= 2 && slots > 0 && wave.div_ceil(slots) <= 4 {
                self.run_lanes(position, wave)?;
                position += wave;
                continue;
            }
            let index = self.order[position];
            self.feed(index, check_latency)?;
            self.process_node(index)?;
            self.check(index)?;
            position += 1;
        }
        Ok(())
    }
    /// Copies a node's sources into its block and keeps its dry history current.
    fn feed(&mut self, index: usize, check_latency: bool) -> Result<(), String> {
        let node = &mut self.nodes[index];
        if check_latency
            && node
                .processor
                .as_ref()
                .map_or(Ok(0), Processor::latency_frames)?
                != node.latency
        {
            return Err("Processor latency changed; prepare a new graph".into());
        }
        for source in &mut node.sources {
            if source.delay.samples.is_empty() {
                self.samples.copy_within(
                    source.sample..source.sample + self.frames,
                    node.offset + source.port,
                );
                continue;
            }
            for frame in 0..self.frames {
                let sample = self.samples[source.sample + frame];
                self.samples[node.offset + source.port + frame] = source.delay.next(sample);
            }
        }
        let data = &mut self.samples[node.offset..node.offset + node.channels * self.frames];
        // Keep dry history current even while wet. Bypass preserves the same
        // declared path delay and never changes a downstream alignment plan.
        for (port, delay) in node.dry.iter_mut().enumerate() {
            if delay.samples.is_empty() {
                continue;
            }
            for sample in &mut data[port * self.frames..(port + 1) * self.frames] {
                let dry = delay.next(*sample);
                if node.bypassed {
                    *sample = dry;
                }
            }
        }
        Ok(())
    }
    fn process_node(&mut self, index: usize) -> Result<(), String> {
        let node = &mut self.nodes[index];
        let data = &mut self.samples[node.offset..node.offset + node.channels * self.frames];
        match node.kind {
            NodeKind::Split => {
                for port in 1..node.channels {
                    data.copy_within(0..self.frames, port * self.frames);
                }
            }
            NodeKind::Merge | NodeKind::Gain => {
                for frame in 0..self.frames {
                    let value = node
                        .gains
                        .iter_mut()
                        .enumerate()
                        .map(|(port, gain)| data[port * self.frames + frame] * gain.next())
                        .sum();
                    data[frame] = value;
                }
            }
            NodeKind::Tone3000 | NodeKind::Lv2 if !node.bypassed => {
                match node.processor.as_mut().ok_or("Missing processor")? {
                    Processor::Native(p) => {
                        let (left, right) = data.split_at_mut(self.frames);
                        if crate::render::render_thread_enabled() {
                            node.port
                                .get_or_insert_with(|| crate::render::audio_port(p))
                                .process(left, right)
                                .map_err(|e| e.to_string())?;
                        } else {
                            p.process(left, right).map_err(|e| e.to_string())?;
                        }
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
        Ok(())
    }
    fn check(&self, index: usize) -> Result<(), String> {
        let node = &self.nodes[index];
        let data = &self.samples[node.offset..node.offset + node.channels * self.frames];
        if data.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite port graph output".into());
        }
        Ok(())
    }
    /// A group of independent native lanes: feed each, render them on the
    /// render thread and the helpers at once, then check each.
    fn run_lanes(&mut self, position: usize, wave: usize) -> Result<(), String> {
        let check_latency = !crate::render::render_thread_enabled();
        for k in position..position + wave {
            self.feed(self.order[k], check_latency)?;
        }
        let Some(lanes) = self.lanes.as_ref() else {
            return Err("Lane helpers unavailable".into());
        };
        let slots = lanes.helpers() + 1;
        let frames = self.frames;
        // Nodes own disjoint blocks of `samples`; from here until every lane is
        // joined, they are reached only through these per-lane jobs.
        let samples = self.samples.as_mut_ptr();
        let mut own = [None; 4];
        let mut owned = 0;
        for (slot, k) in (position..position + wave).enumerate() {
            let node = &mut self.nodes[self.order[k]];
            let Some(Processor::Native(p)) = node.processor.as_mut() else {
                continue;
            };
            if node.bypassed {
                continue;
            }
            let port = node
                .port
                .get_or_insert_with(|| crate::render::audio_port(p));
            let job = crate::render::LaneJob::block(port, samples, node.offset, frames);
            match slot % slots {
                0 => {
                    // `run` admits only groups that fit (wave ≤ 4 × slots).
                    own[owned] = Some(job);
                    owned += 1;
                }
                helper => lanes.queue(helper - 1, job),
            }
        }
        lanes.start();
        let mut result = Ok(());
        for job in own.into_iter().flatten() {
            if result.is_ok() {
                result = job.run();
            }
        }
        // Always join the helpers before the blocks are used again.
        let joined = lanes.finish();
        result?;
        joined?;
        for k in position..position + wave {
            self.check(self.order[k])?;
        }
        Ok(())
    }
}
