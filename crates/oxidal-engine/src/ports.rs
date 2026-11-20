//! Explicit scalar-port execution for portable host graphs. Processor preparation
//! and matching native payload/profile qualification remain the caller's job.
use crate::Processor;
use oxidal_presets::{
    Bundle,
    manifest::{Host, NodeKind, ProcessingRole, SceneBypass, Scenes},
};
use oxidal_tone3000::ProcessingRole as NativeRole;
use std::collections::{BTreeMap, VecDeque};
#[path = "ports/sleep.rs"]
mod sleep;

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
    render_error: Option<oxidal_tone3000::NativeError>,
    bypassed: bool,
    scene_bypass: Option<WarmBypass>,
    gains: Vec<Gain>,
}
// Ramp state belongs to each already prepared merge input. No processing-time
// allocation or processor reconstruction is needed when selecting a scene.
#[derive(Debug, Clone)]
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

#[derive(Debug)]
struct WarmBypass {
    mix: Gain,
    dry: Vec<f32>,
    scene_target: bool,
}
impl WarmBypass {
    fn bytes(samples: usize) -> Option<usize> {
        samples
            .checked_mul(size_of::<f32>())?
            .checked_add(size_of::<Gain>())
    }

    fn new(
        bypassed: bool,
        scene_target: bool,
        samples: usize,
        used: &mut usize,
        budget: usize,
    ) -> Result<Self, String> {
        *used = Self::bytes(samples)
            .and_then(|bytes| used.checked_add(bytes))
            .filter(|bytes| *bytes <= budget)
            .ok_or("Scene bypass exceeds host buffer budget")?;
        let mut dry = Vec::new();
        dry.try_reserve_exact(samples)
            .map_err(|_| "Scene bypass buffer unavailable")?;
        dry.resize(samples, 0.0);
        Ok(Self {
            mix: Gain::new(f32::from(u8::from(bypassed))),
            dry,
            scene_target,
        })
    }
    fn retarget(&mut self, bypassed: bool, frames: u32) {
        let target = f32::from(u8::from(bypassed));
        if self.mix.target != target {
            self.mix.set(
                target,
                if self.mix.current == target {
                    0
                } else {
                    frames
                },
            );
        }
    }
}
/// A plugin control that scenes set. Slots are made when the rig is prepared,
/// one per control the scenes name, so selecting a scene allocates nothing.
/// Continuous controls step once per block in normalized space (logarithmic
/// ports on a log axis) and land exactly on the target; stepped controls
/// (integer, toggle or scale-point enumeration) switch once while silent.
/// @see docs/lv2.md
#[derive(Debug)]
struct ControlRamp {
    node: usize,
    port: u32,
    symbol: String,
    stepped: bool,
    integer: bool,
    toggled: bool,
    logarithmic: bool,
    minimum: f32,
    maximum: f32,
    /// Normalized value last written to the plugin.
    position: f32,
    /// Native value the ramp ends on, written exactly.
    target: f32,
    step: f32,
    /// Blocks left of a continuous ramp.
    remaining: u32,
    /// A stepped value waits for its branch to fall silent.
    pending: bool,
    /// Frames since a stepped value was requested, and when it gives up waiting.
    waited: u32,
    midpoint: u32,
    /// Merge inputs that every path from this plugin to the output passes
    /// first; empty when the plugin is on the shared output chain.
    gates: Vec<(usize, usize)>,
}
impl ControlRamp {
    fn normalized(&self, value: f32) -> f32 {
        let (lo, hi) = (self.minimum, self.maximum);
        let n = if self.logarithmic {
            (value / lo).ln() / (hi / lo).ln()
        } else {
            (value - lo) / (hi - lo)
        };
        n.clamp(0.0, 1.0)
    }
    fn native(&self, normalized: f32) -> f32 {
        let (lo, hi) = (self.minimum, self.maximum);
        let value = if self.logarithmic {
            lo * (hi / lo).powf(normalized)
        } else {
            lo + normalized * (hi - lo)
        };
        value.clamp(lo, hi)
    }
    fn accepts(&self, value: f64) -> bool {
        let v = value as f32;
        v.is_finite()
            && (self.minimum..=self.maximum).contains(&v)
            && (!self.integer || v.fract() == 0.0)
            && (!self.toggled || v == self.minimum || v == self.maximum)
    }
    fn active(&self) -> bool {
        self.remaining != 0 || self.pending
    }
    /// Starts a continuous ramp from the plugin's value over `blocks` blocks.
    fn start(&mut self, current: f32, target: f32, blocks: u32) {
        self.target = target;
        self.pending = false;
        self.position = self.normalized(current);
        self.step = (self.normalized(target) - self.position) / blocks.max(1) as f32;
        self.remaining = if current == target { 0 } else { blocks.max(1) };
    }
    /// The next block's value of a continuous ramp; the last one is exact.
    fn next(&mut self) -> Option<f32> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        if self.remaining == 0 {
            return Some(self.target);
        }
        self.position = (self.position + self.step).clamp(0.0, 1.0);
        Some(self.native(self.position))
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
    warm_bytes: usize,
    native_scene5: bool,
    sleep: Option<sleep::Sleep>,
    latency_frames: u32,
    /// Length of the group of independent native lanes starting at each
    /// position of `order` (0 inside or outside a group).
    waves: Vec<usize>,
    /// Ramp slots for the plugin controls that scenes set.
    ramps: Vec<ControlRamp>,
    /// Helpers that render a group's lanes in parallel, with the render thread.
    lanes: Option<crate::render::RenderPool>,
    // Declared after nodes so plugins finish worker cleanup before files disappear.
    assets: crate::lv2_state::Assets,
}
/// Admits every plugin control the preset's scenes set, before any audio: the
/// node is an LV2 plugin without reported latency, the symbol is a scalar
/// input control, and every scene's value is in range (and whole for integer,
/// an end for toggle ports). Anything else refuses to prepare the rig.
fn scene_ramps(
    scenes: Option<&Scenes>,
    host: &Host,
    nodes: &[PortNode],
    buffer_bytes: &mut usize,
    buffer_budget: usize,
) -> Result<Vec<ControlRamp>, String> {
    let Some(scenes) = scenes else {
        return Ok(Vec::new());
    };
    let bad = || String::from("Invalid scene control target");
    let mut ramps: Vec<ControlRamp> = Vec::new();
    // The manifest requires every scene to set the same controls.
    for control in &scenes.scenes[0].controls {
        let index = nodes
            .iter()
            .position(|n| n.id == control.node)
            .ok_or_else(bad)?;
        let Some(Processor::Lv2(plugin)) = &nodes[index].processor else {
            return Err(bad());
        };
        let info = plugin.info();
        // A control that could move the plugin's reported delay would break
        // the prepared alignment mid-ramp, so such plugins are refused.
        if info.ports.iter().any(|p| p.latency) {
            return Err("Scene controls need a plugin without reported latency".into());
        }
        let port = info
            .ports
            .iter()
            .find(|p| p.symbol == control.symbol && p.input && p.control && !p.atom)
            .ok_or_else(bad)?;
        let (Some(minimum), Some(maximum)) = (port.minimum, port.maximum) else {
            return Err(bad());
        };
        if !minimum.is_finite()
            || !maximum.is_finite()
            || minimum >= maximum
            || (port.logarithmic && minimum <= 0.0)
        {
            return Err(bad());
        }
        let current = plugin.value(port.index)?;
        let mut gates = Vec::new();
        let gated = gates_of(index, nodes, host, &mut gates);
        let ramp = ControlRamp {
            node: index,
            port: port.index,
            symbol: control.symbol.clone(),
            stepped: port.integer || port.toggled || !port.scale_points.is_empty(),
            integer: port.integer,
            toggled: port.toggled,
            logarithmic: port.logarithmic,
            minimum,
            maximum,
            position: 0.0,
            target: current,
            step: 0.0,
            remaining: 0,
            pending: false,
            waited: 0,
            midpoint: 0,
            gates: if gated { gates } else { Vec::new() },
        };
        if !scenes.scenes.iter().all(|scene| {
            scene
                .controls
                .iter()
                .find(|c| c.node == control.node && c.symbol == control.symbol)
                .is_some_and(|c| ramp.accepts(c.value))
        }) {
            return Err(bad());
        }
        *buffer_bytes = (size_of::<ControlRamp>()
            + ramp.symbol.len()
            + ramp.gates.len() * size_of::<(usize, usize)>())
        .checked_add(*buffer_bytes)
        .filter(|bytes| *bytes <= buffer_budget)
        .ok_or("Scene ramp state exceeds host buffer budget")?;
        ramps.push(ramp);
    }
    Ok(ramps)
}
/// Collects the merge inputs that each path from `start` to the output enters
/// first. False when some path reaches the output without one.
fn gates_of(
    start: usize,
    nodes: &[PortNode],
    host: &oxidal_presets::manifest::Host,
    gates: &mut Vec<(usize, usize)>,
) -> bool {
    let mut stack = vec![start];
    let mut seen = vec![false; nodes.len()];
    while let Some(from) = stack.pop() {
        for edge in host
            .graph
            .edges
            .iter()
            .filter(|e| e.from.node == nodes[from].id)
        {
            let Some(to) = nodes.iter().position(|n| n.id == edge.to.node) else {
                continue;
            };
            let port = usize::from(edge.to.port);
            if matches!(nodes[to].kind, NodeKind::Merge | NodeKind::Gain)
                && port < nodes[to].gains.len()
            {
                if !gates.contains(&(to, port)) {
                    gates.push((to, port));
                }
            } else if nodes[to].kind == NodeKind::Output {
                return false;
            } else if !seen[to] {
                seen[to] = true;
                stack.push(to);
            }
        }
    }
    true
}
/// Cores beyond the render thread that lanes may use (the Pi 5 has four).
const LANE_HELPERS: usize = 3;

#[derive(Clone, Copy)]
pub(crate) struct PreparationBudget {
    pub(crate) host: usize,
    pub(crate) warm: usize,
}

impl PreparationBudget {
    pub(crate) fn standalone(bundle: &Bundle, host: usize) -> Self {
        Self {
            host,
            warm: if bundle
                .manifest()
                .extensions
                .contains_key(oxidal_presets::manifest::SCENES_INNER_BYPASS_EXTENSION)
            {
                crate::protocol::WARM_SCENE_BUDGET
            } else {
                usize::MAX
            },
        }
    }
}

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
        Self::new_with_budget(
            bundle,
            processors,
            rate,
            frames,
            PreparationBudget::standalone(bundle, buffer_budget),
        )
    }

    pub(crate) fn new_with_budget(
        bundle: &Bundle,
        processors: BTreeMap<String, Processor>,
        rate: f64,
        frames: usize,
        budget: PreparationBudget,
    ) -> Result<Self, String> {
        let buffer_budget = budget.host;
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
        let scenes = manifest.scenes().map_err(|e| e.to_string())?;
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
                render_error: None,
                bypassed: declaration.bypassed.unwrap_or(false),
                scene_bypass: None,
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
        let native_scene5 = manifest
            .extensions
            .contains_key(oxidal_presets::manifest::SCENES_INNER_BYPASS_EXTENSION);
        let mut warm_bytes: usize = 0;
        if let Some(scenes) = &scenes {
            let first = &scenes.scenes[0];
            for node in &mut nodes {
                let scene_target = first.bypass.iter().any(|target| target.node == node.id);
                if !scene_target
                    && !first
                        .native_controls
                        .iter()
                        .any(|target| target.node == node.id)
                    && !first
                        .native_bypass
                        .iter()
                        .any(|target| target.node == node.id)
                {
                    continue;
                }
                let samples = node.channels * frames;
                warm_bytes = WarmBypass::bytes(samples)
                    .and_then(|bytes| warm_bytes.checked_add(bytes))
                    .filter(|bytes| *bytes <= budget.warm)
                    .ok_or("Warm scenes exceed the owner buffer budget")?;
                node.scene_bypass = Some(WarmBypass::new(
                    node.bypassed,
                    scene_target,
                    samples,
                    &mut buffer_bytes,
                    buffer_budget,
                )?);
            }
        }
        let ramps = scene_ramps(
            scenes.as_ref(),
            host,
            &nodes,
            &mut buffer_bytes,
            buffer_budget,
        )?;
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
        let sleep = manifest
            .sleep_branches()
            .map_err(|e| e.to_string())?
            .map(|config| {
                sleep::Sleep::new(
                    config,
                    scenes.as_ref().unwrap(),
                    host,
                    &indices,
                    &nodes,
                    (rate, frames, latency[output]),
                )
            })
            .transpose()?;
        if let Some(sleep) = &sleep {
            buffer_bytes = buffer_bytes
                .checked_add(sleep.buffer_bytes())
                .filter(|used| *used <= buffer_budget)
                .ok_or("Sleeping branch state exceeds host buffer budget")?;
        }
        let mut graph = Self {
            nodes,
            order,
            waves,
            ramps,
            lanes,
            samples,
            frames,
            input,
            output,
            failed: false,
            buffer_bytes,
            warm_bytes,
            native_scene5,
            sleep,
            latency_frames: latency[output],
            assets,
        };
        if native_scene5 {
            let scene = scenes.as_ref().ok_or("Missing native scene definition")?;
            let preparation = oxidal_tone3000::ScenePreparation {
                base_fade_frames: scene.fade_ms * 48,
                byte_budget: budget.warm - warm_bytes,
            };
            let mut groups = std::collections::BTreeMap::<&str, Vec<_>>::new();
            for row in &scene.scenes[0].native_bypass {
                groups
                    .entry(&row.node)
                    .or_default()
                    .push(oxidal_tone3000::SceneEdit {
                        block: &row.block,
                        parameter: oxidal_tone3000::SceneParameter::Enabled,
                        value: 0.0,
                    });
            }
            let adapter = graph.native_scene_batch(&groups, Some(preparation))?;
            graph.warm_bytes = graph
                .warm_bytes
                .checked_add(adapter)
                .filter(|n| *n <= budget.warm)
                .ok_or("Warm native scenes exceed the owner buffer budget")?;
        }
        Ok(graph)
    }

    pub(crate) fn native_scene_batch(
        &mut self,
        edits: &std::collections::BTreeMap<&str, Vec<oxidal_tone3000::SceneEdit<'_>>>,
        prepare: Option<oxidal_tone3000::ScenePreparation>,
    ) -> Result<usize, String> {
        if self.failed
            || !self.native_scene5
            || edits.keys().any(|id| {
                !self
                    .nodes
                    .iter()
                    .any(|n| n.id == **id && matches!(n.processor, Some(Processor::Native(_))))
            })
        {
            return Err("Missing warm native scene processor".into());
        }
        let groups = self.nodes.iter_mut().filter_map(|n| {
            let Some(Processor::Native(engine)) = &mut n.processor else {
                return None;
            };
            Some((engine, edits.get(n.id.as_str())?.as_slice()))
        });
        oxidal_tone3000::Engine::scene_batch(groups, prepare).map_err(|e| e.to_string())
    }

    pub(crate) fn native_scene5(&self) -> bool {
        self.native_scene5
    }
    pub(crate) fn warm_bytes(&self) -> usize {
        self.warm_bytes
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
        for i in 0..self.nodes.len() {
            if self.sleep_skips(i) {
                continue;
            }
            let node = &self.nodes[i];
            let error = match node
                .processor
                .as_ref()
                .map_or(Ok(0), Processor::latency_frames)
            {
                Ok(latency) if latency == node.latency => continue,
                Ok(_) => "Processor latency changed; prepare a new graph".into(),
                Err(error) => error,
            };
            if !self.sleep_failure(i) {
                self.failed = true;
                return Err(error);
            }
        }
        Ok(())
    }
    /// Confirm armed processors still own the DSP that their readback promises.
    pub(crate) fn verify_warm_scene_health(&mut self) -> Result<(), String> {
        if self.native_scene5 {
            for i in 0..self.nodes.len() {
                if self.sleep_skips(i) {
                    continue;
                }
                if let Some(Processor::Native(engine)) = &self.nodes[i].processor
                    && let Err(error) = engine.scene_transitioning()
                    && !self.sleep_failure(i)
                {
                    return Err(error.to_string());
                }
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
            for gain in &mut node.gains {
                gain.set(gain.target, 0);
            }
            if let Some(bypass) = &mut node.scene_bypass {
                bypass.mix.set(bypass.mix.target, 0);
            }
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
        if let Some(sleep) = &mut self.sleep {
            sleep.reset(&self.nodes);
        }
        self.verify_warm_scene_health()
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
        bypass_frames: u32,
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
                if let Some(bypass) = &mut n.scene_bypass {
                    bypass.retarget(n.bypassed, bypass_frames);
                }
            }
            Target::Merge { node, port } => {
                let n = self
                    .nodes
                    .iter_mut()
                    .find(|n| &n.id == node && matches!(n.kind, NodeKind::Merge | NodeKind::Gain))
                    .ok_or("Unknown merge")?;
                let gain = n.gains.get_mut(*port).ok_or("Unknown merge port")?;
                if !value.is_finite() || !(-4.0..=4.0).contains(&value) {
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
        trails: bool,
    ) -> Result<(), String> {
        self.check_scene_gains(values, frames, release)?;
        if let Some(sleep) = &mut self.sleep {
            sleep.activate(&mut self.nodes, values, frames, release, trails)?;
        }
        for value in values {
            if self.sleep_owns_return(&value.node, usize::from(value.port)) {
                continue;
            }
            let node = self.nodes.iter_mut().find(|n| n.id == value.node).unwrap();
            let gain = &mut node.gains[usize::from(value.port)];
            // A path closes when its level falls, whatever its polarity.
            let closing = (value.value as f32).abs() < gain.target.abs();
            gain.set(value.value as f32, if closing { release } else { frames });
        }
        Ok(())
    }

    pub(crate) fn check_scene_gains(
        &self,
        values: &[oxidal_presets::manifest::SceneGain],
        frames: u32,
        release: u32,
    ) -> Result<(), String> {
        if self.failed || frames == 0 || release == 0 {
            return Err("Invalid scene transition".into());
        }
        for (i, value) in values.iter().enumerate() {
            if !value.value.is_finite()
                || !(-4.0..=4.0).contains(&value.value)
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
        Ok(())
    }
    pub(crate) fn scene_transitioning(&self) -> bool {
        self.nodes.iter().any(|n| {
            n.gains.iter().any(|g| g.remaining != 0)
                || n.scene_bypass
                    .as_ref()
                    .is_some_and(|b| b.mix.remaining != 0)
                || (self.native_scene5 && matches!(&n.processor,
                    Some(Processor::Native(engine)) if engine.scene_transitioning().unwrap_or(true)))
        }) || self.ramps.iter().any(ControlRamp::active)
    }
    pub(crate) fn check_scene_bypass(&self, values: &[SceneBypass]) -> Result<(), String> {
        if self.failed
            || values.len()
                != self
                    .nodes
                    .iter()
                    .filter(|n| n.scene_bypass.as_ref().is_some_and(|b| b.scene_target))
                    .count()
            || values.iter().enumerate().any(|(i, value)| {
                values[..i].iter().any(|v| v.node == value.node)
                    || !self.nodes.iter().any(|n| {
                        n.id == value.node
                            && n.scene_bypass.as_ref().is_some_and(|b| b.scene_target)
                    })
            })
        {
            return Err("Invalid scene bypass target".into());
        }
        Ok(())
    }
    /// Apply bypass targets already checked by `check_scene_bypass`.
    pub(crate) fn scene_bypass(&mut self, values: &[SceneBypass], frames: u32) {
        for value in values {
            let node = self.nodes.iter_mut().find(|n| n.id == value.node).unwrap();
            node.bypassed = value.value;
            node.scene_bypass
                .as_mut()
                .unwrap()
                .retarget(value.value, frames);
        }
    }
    /// Checks every scene control target before any changes, then starts all
    /// ramps at the same block. A continuous control ramps over `frames` from
    /// the value the plugin has now (so a second scene change retargets); a
    /// stepped one waits until its branch is silent, or switches halfway
    /// through the fade if it stays audible (on the shared output chain or
    /// in a branch both scenes play).
    pub(crate) fn scene_controls(
        &mut self,
        values: &[oxidal_presets::manifest::SceneControl],
        frames: u32,
    ) -> Result<(), String> {
        if self.failed || frames == 0 {
            return Err("Invalid scene transition".into());
        }
        let slots = self.scene_control_slots(values)?;
        let blocks = frames.div_ceil(self.frames as u32).max(1);
        for (value, &index) in values.iter().zip(&slots) {
            let ramp = &mut self.ramps[index];
            let target = value.value as f32;
            let Some(Processor::Lv2(plugin)) = &self.nodes[ramp.node].processor else {
                return Err("Missing LV2 processor".into());
            };
            let current = plugin.value(ramp.port)?;
            ramp.target = target;
            if ramp.stepped {
                ramp.remaining = 0;
                ramp.pending = current != target;
                ramp.waited = 0;
                ramp.midpoint = frames / 2;
            } else {
                ramp.start(current, target, blocks);
            }
        }
        Ok(())
    }
    /// Refuses a scene whose controls are not exactly prepared ramp slots with
    /// admissible values; nothing changes.
    pub(crate) fn check_scene_controls(
        &self,
        values: &[oxidal_presets::manifest::SceneControl],
    ) -> Result<(), String> {
        let slots = self.scene_control_slots(values)?;
        for &slot in slots.iter().take(values.len()) {
            let ramp = &self.ramps[slot];
            let Some(Processor::Lv2(plugin)) = &self.nodes[ramp.node].processor else {
                return Err("Missing LV2 processor".into());
            };
            plugin.value(ramp.port)?;
        }
        Ok(())
    }
    fn scene_control_slots(
        &self,
        values: &[oxidal_presets::manifest::SceneControl],
    ) -> Result<[usize; oxidal_presets::manifest::MAX_SCENE_CONTROLS], String> {
        let mut slots = [usize::MAX; oxidal_presets::manifest::MAX_SCENE_CONTROLS];
        if self.failed || values.len() > slots.len() {
            return Err("Invalid scene control target".into());
        }
        for (i, value) in values.iter().enumerate() {
            let slot = self
                .ramps
                .iter()
                .position(|r| self.nodes[r.node].id == value.node && r.symbol == value.symbol);
            match slot {
                Some(index)
                    if self.ramps[index].accepts(value.value) && !slots[..i].contains(&index) =>
                {
                    slots[i] = index;
                }
                _ => return Err("Invalid scene control target".into()),
            }
        }
        Ok(slots)
    }
    /// A live or MIDI edit owns the control from now on: stop its scene ramp.
    pub(crate) fn cancel_control_ramp(&mut self, node: &str, symbol: &str) {
        for ramp in &mut self.ramps {
            if self.nodes[ramp.node].id == node && ramp.symbol == symbol {
                ramp.remaining = 0;
                ramp.pending = false;
            }
        }
    }
    /// Block-start step of every running scene control ramp. Called on the
    /// audio thread: no allocation, no locks; a plugin refusal fails the graph.
    fn advance_ramps(&mut self) -> Result<(), String> {
        for ramp in &mut self.ramps {
            let value = if let Some(value) = ramp.next() {
                value
            } else if ramp.pending {
                let gain = |&(node, port): &(usize, usize)| &self.nodes[node].gains[port];
                let silent =
                    !ramp.gates.is_empty() && ramp.gates.iter().all(|g| gain(g).current == 0.0);
                // A branch that is closing waits for silence; one that stays
                // audible (or the shared chain) switches at the fade midpoint.
                let stays_open =
                    ramp.gates.is_empty() || ramp.gates.iter().any(|g| gain(g).target != 0.0);
                let due = stays_open && ramp.waited >= ramp.midpoint;
                ramp.waited = ramp.waited.saturating_add(self.frames as u32);
                if !(silent || due) {
                    continue;
                }
                ramp.pending = false;
                ramp.target
            } else {
                continue;
            };
            let Some(Processor::Lv2(plugin)) = &mut self.nodes[ramp.node].processor else {
                return Err("Missing LV2 processor".into());
            };
            plugin
                .set_control(ramp.port, value)
                .map_err(|_| "Scene control refused by plugin")?;
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
        // With a separate render thread, the owner verifies latency instead
        // (`verify_latency`): native latency queries are owner-thread calls.
        let check_latency = !crate::render::render_thread_enabled();
        self.advance_ramps()?;
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
            if self.sleep_skips(index) {
                self.clear_node(index);
            } else if let Err(error) = self
                .feed(index, check_latency)
                .and_then(|()| self.process_node(index))
                .and_then(|()| self.finish_node(index))
                && !self.sleep_failure(index)
            {
                return Err(error);
            }
            position += 1;
        }
        if let Some(sleep) = &mut self.sleep {
            sleep.finish(&mut self.nodes, &self.samples, self.frames);
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
        // Keep dry history current even while wet. Warm bypass also needs a
        // dry block for the blend, leaving the processor's input unchanged.
        for (port, delay) in node.dry.iter_mut().enumerate() {
            let block = port * self.frames..(port + 1) * self.frames;
            if let Some(bypass) = &mut node.scene_bypass {
                for (dry, &sample) in bypass.dry[block.clone()].iter_mut().zip(&data[block]) {
                    *dry = delay.next(sample);
                }
                continue;
            }
            if delay.samples.is_empty() {
                continue;
            }
            for sample in &mut data[block] {
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
            NodeKind::Tone3000 | NodeKind::Lv2 if !node.bypassed || node.scene_bypass.is_some() => {
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
    fn finish_node(&mut self, index: usize) -> Result<(), String> {
        let node = &mut self.nodes[index];
        let data = &mut self.samples[node.offset..node.offset + node.channels * self.frames];
        if let Some(sleep) = &mut self.sleep {
            sleep.gate(index, data, self.frames);
        }
        if data.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite port graph output".into());
        }
        if let Some(bypass) = &mut node.scene_bypass {
            if bypass.mix.remaining == 0 {
                if bypass.mix.target == 1.0 {
                    data.copy_from_slice(&bypass.dry);
                }
                return Ok(());
            }
            for frame in 0..self.frames {
                let mix = bypass.mix.next().clamp(0.0, 1.0);
                bypass.mix.current = mix;
                if mix == 0.0 {
                    continue;
                }
                for port in 0..node.channels {
                    let at = port * self.frames + frame;
                    data[at] = if mix == 1.0 {
                        bypass.dry[at]
                    } else {
                        data[at] * (1.0 - mix) + bypass.dry[at] * mix
                    };
                }
            }
        }
        Ok(())
    }
    /// A group of independent native lanes: feed each, render them on the
    /// render thread and the helpers at once, then check each.
    fn run_lanes(&mut self, position: usize, wave: usize) -> Result<(), String> {
        let check_latency = !crate::render::render_thread_enabled();
        for k in position..position + wave {
            let index = self.order[k];
            self.nodes[index].render_error = None;
            if self.sleep_skips(index) {
                self.clear_node(index);
            } else if let Err(error) = self.feed(index, check_latency)
                && !self.sleep_failure(index)
            {
                return Err(error);
            }
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
            let index = self.order[k];
            if self.sleep_skips(index) {
                continue;
            }
            let node = &mut self.nodes[index];
            let Some(Processor::Native(p)) = node.processor.as_mut() else {
                continue;
            };
            if node.bypassed && node.scene_bypass.is_none() {
                continue;
            }
            let port = node
                .port
                .get_or_insert_with(|| crate::render::audio_port(p));
            let job = crate::render::LaneJob::block(port, samples, node.offset, frames);
            let job = if self.sleep.is_some() {
                job.report_failure(&mut node.render_error)
            } else {
                job
            };
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
            let index = self.order[k];
            if self.sleep_skips(index) {
                self.clear_node(index);
                continue;
            }
            let result = if let Some(error) = self.nodes[index].render_error.take() {
                Err(error.to_string())
            } else {
                self.finish_node(index)
            };
            if let Err(error) = result
                && !self.sleep_failure(index)
            {
                return Err(error);
            }
        }
        Ok(())
    }

    fn clear_node(&mut self, index: usize) {
        let node = &self.nodes[index];
        self.samples[node.offset..node.offset + node.channels * self.frames].fill(0.0);
    }

    fn sleep_skips(&self, index: usize) -> bool {
        self.sleep
            .as_ref()
            .is_some_and(|sleep| sleep.skipped(index))
    }

    fn sleep_failure(&mut self, index: usize) -> bool {
        let handled = self
            .sleep
            .as_mut()
            .is_some_and(|sleep| sleep.fail_inactive(index, &mut self.nodes));
        if handled {
            self.clear_node(index);
        }
        handled
    }

    pub(crate) fn sleep_owns_return(&self, node: &str, port: usize) -> bool {
        self.sleep
            .as_ref()
            .is_some_and(|sleep| sleep.targets_return(&self.nodes, node, port))
    }

    pub(crate) fn sleep_enabled(&self) -> Option<bool> {
        self.sleep.as_ref().map(sleep::Sleep::enabled)
    }

    pub(crate) fn sleep_prime(
        &mut self,
        values: &[oxidal_presets::manifest::SceneGain],
    ) -> Result<bool, String> {
        self.sleep
            .as_mut()
            .map_or(Ok(false), |sleep| sleep.prime(&self.nodes, values))
    }

    pub(crate) fn sleep_prime_ready(&self) -> bool {
        self.sleep.as_ref().is_none_or(sleep::Sleep::prime_ready)
    }

    pub(crate) fn cancel_sleep_prime(&mut self) {
        if let Some(sleep) = &mut self.sleep {
            sleep.cancel_prime();
        }
    }

    pub(crate) fn set_sleep_enabled(&mut self, enabled: bool, frames: u32) -> Result<(), String> {
        self.sleep
            .as_mut()
            .ok_or("Rig has no sleeping branch plan")?
            .set_enabled(enabled, &mut self.nodes, frames)
    }

    pub(crate) fn sleep_snapshot(
        &self,
        requested_scene: Option<String>,
        active_scene: Option<String>,
        message: Option<String>,
    ) -> Option<crate::protocol::BranchSleepState> {
        self.sleep
            .as_ref()
            .map(|sleep| sleep.snapshot(requested_scene, active_scene, message))
    }
}
#[cfg(test)]
mod tests {
    use super::ControlRamp;

    fn ramp(minimum: f32, maximum: f32, logarithmic: bool) -> ControlRamp {
        ControlRamp {
            node: 0,
            port: 0,
            symbol: "time".into(),
            stepped: false,
            integer: false,
            toggled: false,
            logarithmic,
            minimum,
            maximum,
            position: 0.0,
            target: minimum,
            step: 0.0,
            remaining: 0,
            pending: false,
            waited: 0,
            midpoint: 0,
            gates: Vec::new(),
        }
    }

    /// Every block moves at most the normalized distance divided by the
    /// number of blocks (plus float rounding), and the last block is exact.
    #[test]
    fn continuous_ramps_are_bounded_per_block_and_land_exactly() {
        for (log, from, to) in [
            (false, 0.1, 1.9),
            (true, 20.0, 4000.0),
            (true, 3000.0, 25.0),
        ] {
            let (lo, hi) = if log { (20.0, 4000.0) } else { (0.0, 2.0) };
            let mut r = ramp(lo, hi, log);
            let blocks = 1920u32.div_ceil(64);
            r.start(from, to, blocks);
            let bound = (r.normalized(to) - r.normalized(from)).abs() / blocks as f32 + 1e-5;
            let mut previous = r.normalized(from);
            let mut values = Vec::new();
            while let Some(value) = r.next() {
                let n = r.normalized(value);
                assert!((n - previous).abs() <= bound, "{from}→{to}: {previous}→{n}");
                previous = n;
                values.push(value);
            }
            assert_eq!(values.len(), blocks as usize);
            assert_eq!(values.last(), Some(&to));
            assert!(!r.active());
            if log {
                // Equal ratios per block on a logarithmic port, not equal steps.
                let ratio = values[1] / values[0];
                assert!((values[10] / values[9] - ratio).abs() < 1e-3);
            }
        }
        // Retargeting from the value reached keeps the bound.
        let mut r = ramp(0.0, 2.0, false);
        r.start(0.0, 2.0, 10);
        for _ in 0..5 {
            r.next();
        }
        let reached = r.native(r.position);
        r.start(reached, 0.0, 10);
        assert!((r.next().unwrap() - (reached - reached / 10.0)).abs() < 1e-5);
        // An unchanged value starts no ramp.
        r.start(1.0, 1.0, 10);
        assert!(!r.active() && r.next().is_none());
    }

    #[test]
    fn ramp_values_respect_range_and_steps() {
        let mut r = ramp(0.0, 4.0, false);
        assert!(r.accepts(4.0) && r.accepts(0.5));
        assert!(!r.accepts(4.5) && !r.accepts(f64::NAN) && !r.accepts(-0.1));
        r.integer = true;
        assert!(r.accepts(3.0) && !r.accepts(0.5));
        r.toggled = true;
        assert!(r.accepts(4.0) && !r.accepts(3.0));
    }
}
