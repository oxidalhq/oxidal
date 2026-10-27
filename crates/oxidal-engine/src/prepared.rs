use oxidal_graph::{BlockKind, PreparedRouting, Rig};
use oxidal_lv2::Plugin;
use oxidal_tone3000::{Engine, ProcessingRole};
use std::collections::BTreeMap;

/// Owned processors; discovery and asset loading are initiated before admission.
/// The graph waits for native readiness before accepting them. Neither variant
/// can move to another thread.
#[derive(Debug)]
pub enum Processor {
    Native(Engine),
    Lv2(Plugin),
}
impl Processor {
    pub(crate) fn configuration(&self) -> (f64, usize) {
        match self {
            Self::Native(p) => p.configuration(),
            Self::Lv2(p) => p.configuration(),
        }
    }
    pub(crate) fn latency_frames(&self) -> Result<u32, String> {
        match self {
            Self::Native(p) => p.latency_samples().map_err(|e| e.to_string()),
            Self::Lv2(p) => p.latency_frames(),
        }
    }
    fn matches(&self, kind: &BlockKind) -> bool {
        match self {
            Self::Lv2(p) => *kind == BlockKind::Lv2 && p.channels() == 2,
            Self::Native(p) => {
                *kind
                    == match p.processing_role() {
                        ProcessingRole::WholePreset => BlockKind::Native,
                        ProcessingRole::Amp => BlockKind::Nam,
                        ProcessingRole::Cab => BlockKind::Cabinet,
                    }
            }
        }
    }
    pub(crate) fn ready(&mut self) -> Result<(), String> {
        match self {
            Self::Native(p) => p.prepare_stream().map_err(|e| e.to_string()),
            Self::Lv2(p) => p.prepare_latency().map(|_| ()),
        }
    }
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<(), String> {
        match self {
            Self::Native(p) => p.process(left, right).map_err(|e| e.to_string()),
            Self::Lv2(p) => p.process(left, right),
        }
    }
}
#[derive(Debug)]
struct Node {
    processor: Option<Processor>,
    left: Vec<f32>,
    right: Vec<f32>,
}
/// A prepared stereo DAG with persistent processor instances. Fan-in sums at
/// unity without limiting. Latency compensation and streaming replacement are
/// not implemented; preparing this object is not a gapless-switch operation.
#[derive(Debug)]
pub struct PreparedRig {
    rig: Rig,
    routing: PreparedRouting,
    nodes: Vec<Node>,
    frames: usize,
    failed: bool,
}
impl PreparedRig {
    pub fn new(
        rig: Rig,
        mut processors: BTreeMap<String, Processor>,
        rate: f64,
        frames: usize,
    ) -> Result<Self, String> {
        if !rate.is_finite()
            || !(8000.0..=192000.0).contains(&rate)
            || frames == 0
            || frames > 2048
            || !frames.is_power_of_two()
        {
            return Err("Invalid graph audio configuration".into());
        }
        let routing = PreparedRouting::new(&rig)?;
        let mut nodes = Vec::with_capacity(rig.nodes.len());
        for node in &rig.nodes {
            if node.level != 1.0 {
                return Err("Use explicit processor gain controls".into());
            }
            let mut processor = processors.remove(&node.id);
            if matches!(node.kind, BlockKind::Input | BlockKind::Output) {
                if processor.is_some() {
                    return Err("Endpoints cannot own processors".into());
                }
            } else {
                let p = processor.as_mut().ok_or("Missing prepared processor")?;
                if !p.matches(&node.kind) {
                    return Err("Processor role differs from declared node kind".into());
                }
                if p.configuration() != (rate, frames) {
                    return Err("Processor audio configuration differs".into());
                }
                p.ready()?;
            }
            nodes.push(Node {
                processor,
                left: vec![0.0; frames],
                right: vec![0.0; frames],
            });
        }
        if !processors.is_empty() {
            return Err("Unknown processor binding".into());
        }
        Ok(Self {
            rig,
            routing,
            nodes,
            frames,
            failed: false,
        })
    }
    /// Control-thread routing only: preserves every processor/history. Audible
    /// route changes still need transition policy before exposure in live UI.
    pub fn reroute(&mut self, rig: Rig) -> Result<(), String> {
        if self.failed {
            return Err("Failed rig must be recreated".into());
        }
        if self.rig.nodes != rig.nodes {
            return Err("Node changes require preparation".into());
        }
        let routing = PreparedRouting::new(&rig)?;
        self.routing = routing;
        self.rig = rig;
        Ok(())
    }
    /// Same-owner control access; never call during a concurrent process block.
    pub fn processor_mut(&mut self, id: &str) -> Option<&mut Processor> {
        if self.failed {
            return None;
        }
        let index = self.rig.nodes.iter().position(|n| n.id == id)?;
        self.nodes[index].processor.as_mut()
    }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<(), String> {
        if self.failed
            || left.len() != self.frames
            || right.len() != self.frames
            || left.iter().chain(right.iter()).any(|s| !s.is_finite())
        {
            left.fill(0.0);
            right.fill(0.0);
            return Err("Invalid or failed graph processing request".into());
        }
        let input = self.routing.input();
        self.nodes[input].left.copy_from_slice(left);
        self.nodes[input].right.copy_from_slice(right);
        if let Err(error) = self.run() {
            self.failed = true;
            left.fill(0.0);
            right.fill(0.0);
            return Err(error);
        }
        let output = &self.nodes[self.routing.output()];
        left.copy_from_slice(&output.left);
        right.copy_from_slice(&output.right);
        Ok(())
    }
    fn run(&mut self) -> Result<(), String> {
        for &index in self.routing.order() {
            if index == self.routing.input() {
                continue;
            }
            self.nodes[index].left.fill(0.0);
            self.nodes[index].right.fill(0.0);
            for &source in self.routing.sources(index) {
                for frame in 0..self.frames {
                    self.nodes[index].left[frame] += self.nodes[source].left[frame];
                    self.nodes[index].right[frame] += self.nodes[source].right[frame];
                }
            }
            let node = &mut self.nodes[index];
            if let Some(processor) = &mut node.processor {
                if node.left.iter().chain(&node.right).any(|s| !s.is_finite()) {
                    return Err("Nonfinite graph input sum".into());
                }
                processor.process(&mut node.left, &mut node.right)?;
            }
            if node.left.iter().chain(&node.right).any(|s| !s.is_finite()) {
                return Err("Nonfinite graph output".into());
            }
        }
        Ok(())
    }
}
