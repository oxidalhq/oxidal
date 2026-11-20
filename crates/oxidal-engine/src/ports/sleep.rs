//! Explicit closed regions with independent send and return envelopes.
use super::*;
use crate::protocol::{BranchSleepPhase as Phase, BranchSleepState, SleepingBranchState};
use oxidal_presets::manifest::{MAX_SLEEP_BRANCHES, SceneGain, SleepBranches};

// The pinned LSTM's ARM DC-filter residual is about 1.12e-7 FS.
// Allow that numerical floor while requiring two seconds of quiet.
const SILENCE: f32 = 2.0e-7;
const SETTLE_SECONDS: u64 = 2;

#[derive(Debug)]
struct Return {
    node: usize,
    port: usize,
    source: usize,
    desired: f32,
}

#[derive(Debug)]
struct Branch {
    id: String,
    processors: usize,
    returns: Vec<Return>,
    send: Gain,
    phase: Phase,
    prime: u32,
    quiet: u64,
    blend: bool,
    send_fade: u32,
}

impl Branch {
    fn wanted(&self) -> bool {
        self.returns.iter().any(|output| output.desired != 0.0)
    }
}

#[derive(Debug)]
pub(super) struct Sleep {
    enabled: bool,
    branches: Vec<Branch>,
    owners: Vec<Option<usize>>,
    sends: Vec<bool>,
    prime_frames: u32,
    quiet_frames: u64,
    admitted: usize,
    shared: usize,
}

impl Sleep {
    pub(super) fn new(
        config: SleepBranches,
        scenes: &Scenes,
        host: &Host,
        indices: &BTreeMap<&str, usize>,
        nodes: &[PortNode],
        geometry: (f64, usize, u32),
    ) -> Result<Self, String> {
        let (rate, frames, latency) = geometry;
        let mut owners = vec![None; nodes.len()];
        let mut sends = vec![false; nodes.len()];
        let regions = config
            .regions(host, scenes)
            .map_err(|error| error.to_string())?;
        let mut branches = Vec::with_capacity(config.branches.len());
        for (index, (row, region)) in config.branches.into_iter().zip(regions).enumerate() {
            let declaration = scenes.branches.iter().find(|b| b.id == row.branch).unwrap();
            for id in &region {
                let node = indices[id];
                owners[node] = Some(index);
            }
            for id in &row.sends {
                sends[indices[id.as_str()]] = true;
            }
            let processors = region
                .iter()
                .filter(|id| nodes[indices[**id]].processor.is_some())
                .count();
            let exits = declaration
                .gains
                .iter()
                .map(|gain| (indices[gain.node.as_str()], usize::from(gain.port)));
            let returns = exits
                .into_iter()
                .map(|(node, port)| {
                    let input = nodes[node]
                        .sources
                        .iter()
                        .find(|s| s.port == port * frames)
                        .unwrap();
                    Return {
                        node,
                        port,
                        source: input.sample,
                        desired: nodes[node].gains[port].target,
                    }
                })
                .collect();
            branches.push(Branch {
                id: row.branch,
                processors,
                returns,
                send: Gain::new(1.0),
                phase: Phase::Playing,
                prime: 0,
                quiet: 0,
                blend: false,
                send_fade: 0,
            });
        }
        let admitted = nodes.iter().filter(|node| node.processor.is_some()).count();
        let shared = admitted
            - branches
                .iter()
                .map(|branch| branch.processors)
                .sum::<usize>();
        let mut plan = Self {
            enabled: config.enabled,
            branches,
            owners,
            sends,
            prime_frames: latency
                .checked_add(frames as u32)
                .ok_or("Sleeping branch prime overflow")?,
            quiet_frames: (rate.ceil() as u64) * SETTLE_SECONDS,
            admitted,
            shared,
        };
        plan.reset(nodes);
        Ok(plan)
    }

    pub(super) fn reset(&mut self, nodes: &[PortNode]) {
        for branch in &mut self.branches {
            for output in &mut branch.returns {
                output.desired = nodes[output.node].gains[output.port].target;
            }
            let muted = self.enabled && !branch.wanted();
            branch.phase = if muted {
                Phase::Draining
            } else {
                Phase::Playing
            };
            branch.send.set(f32::from(u8::from(!muted)), 0);
            branch.quiet = 0;
            branch.prime = 0;
            branch.blend = false;
        }
    }

    pub(super) fn buffer_bytes(&self) -> usize {
        self.owners.capacity() * size_of::<Option<usize>>()
            + self.sends.capacity() * size_of::<bool>()
            + self.branches.capacity() * size_of::<Branch>()
            + self
                .branches
                .iter()
                .map(|b| b.id.capacity() + b.returns.capacity() * size_of::<Return>())
                .sum::<usize>()
    }

    pub(super) fn enabled(&self) -> bool {
        self.enabled
    }

    pub(super) fn targets_return(&self, nodes: &[PortNode], node: &str, port: usize) -> bool {
        self.branches.iter().any(|branch| {
            branch
                .returns
                .iter()
                .any(|out| out.port == port && nodes[out.node].id == node)
        })
    }

    fn wants(&self, nodes: &[PortNode], gains: &[SceneGain]) -> [bool; MAX_SLEEP_BRANCHES] {
        let mut wanted = [false; MAX_SLEEP_BRANCHES];
        for (index, branch) in self.branches.iter().enumerate() {
            wanted[index] = branch.returns.iter().any(|out| {
                gains
                    .iter()
                    .find(|g| nodes[out.node].id == g.node && usize::from(g.port) == out.port)
                    .map_or(out.desired, |g| g.value as f32)
                    != 0.0
            });
        }
        wanted
    }

    /// None of these operations may change a sounding return. A second
    /// request reuses matching pre-roll and releases any now-unused reservation.
    pub(super) fn prime(
        &mut self,
        nodes: &[PortNode],
        gains: &[SceneGain],
    ) -> Result<bool, String> {
        let wanted = self.wants(nodes, gains);
        if self
            .branches
            .iter()
            .zip(wanted)
            .any(|(b, want)| want && b.phase == Phase::Failed)
        {
            return Err("A requested sleeping branch needs to be prepared again".into());
        }
        // With no measured device profile, the all-resident processor count
        // is the only upper bound. No branch is admitted on optimistic tails.
        let mut active = self.shared;
        for (branch, want) in self.branches.iter().zip(wanted) {
            if want
                || matches!(
                    branch.phase,
                    Phase::Playing | Phase::Draining | Phase::Priming
                )
            {
                active += branch.processors;
            }
        }
        if active > self.admitted {
            return Err("Sleeping branch wake exceeds the admitted processing bound".into());
        }
        for (branch, want) in self.branches.iter_mut().zip(wanted) {
            if want && branch.phase == Phase::Asleep {
                branch.phase = Phase::Priming;
                branch.prime = self.prime_frames;
                branch.send.set(1.0, 0);
            } else if self.enabled && !want && branch.phase == Phase::Priming {
                branch.phase = Phase::Draining;
                branch.send.set(0.0, 0);
                branch.quiet = 0;
            }
        }
        Ok(self
            .branches
            .iter()
            .any(|b| b.phase == Phase::Priming && b.prime != 0))
    }

    pub(super) fn prime_ready(&self) -> bool {
        !self
            .branches
            .iter()
            .any(|b| b.phase == Phase::Priming && b.prime != 0)
    }

    pub(super) fn cancel_prime(&mut self) {
        for branch in &mut self.branches {
            if branch.phase == Phase::Priming {
                branch.phase = Phase::Draining;
                branch.send.set(0.0, 0);
                branch.quiet = 0;
            }
        }
    }

    pub(super) fn activate(
        &mut self,
        nodes: &mut [PortNode],
        gains: &[SceneGain],
        frames: u32,
        release: u32,
        trails: bool,
    ) -> Result<(), String> {
        if self.prime(nodes, gains)? {
            return Err("Sleeping branches are still preparing".into());
        }
        for branch in &mut self.branches {
            let was_wanted = branch.wanted();
            for output in &mut branch.returns {
                if let Some(value) = gains
                    .iter()
                    .find(|g| nodes[output.node].id == g.node && usize::from(g.port) == output.port)
                {
                    output.desired = value.value as f32;
                }
            }
            let wanted = branch.wanted();
            if !self.enabled || wanted {
                // A still-draining branch can take live input immediately
                // because it has not stopped processing.
                if branch.phase != Phase::Playing {
                    branch.send.set(1.0, frames);
                }
                branch.phase = Phase::Playing;
                branch.blend = false;
            } else if was_wanted {
                branch.phase = Phase::Draining;
                branch.quiet = 0;
                branch.send_fade = frames;
                branch.blend = !trails;
                if trails {
                    branch.send.set(0.0, frames);
                    // Finish an interrupted ramp at the currently audible
                    // level and carry that level until the tail settles.
                    for output in &branch.returns {
                        let gain = &mut nodes[output.node].gains[output.port];
                        gain.set(gain.current, 0);
                    }
                }
            }
            if wanted || !self.enabled || branch.blend {
                for output in &branch.returns {
                    let gain = &mut nodes[output.node].gains[output.port];
                    if gain.target != output.desired {
                        let closing = output.desired.abs() < gain.current.abs();
                        gain.set(output.desired, if closing { release } else { frames });
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn set_enabled(
        &mut self,
        enabled: bool,
        nodes: &mut [PortNode],
        frames: u32,
    ) -> Result<(), String> {
        if !enabled
            && self
                .branches
                .iter()
                .any(|branch| branch.phase == Phase::Failed)
        {
            return Err("A failed branch requires preparing the rig again".into());
        }
        if self.enabled == enabled {
            return Ok(());
        }
        self.enabled = enabled;
        for branch in &mut self.branches {
            let muted = enabled && !branch.wanted();
            if !enabled && matches!(branch.phase, Phase::Asleep | Phase::Priming) {
                branch.phase = Phase::Priming;
                branch.prime = self.prime_frames.saturating_add(frames);
            } else if branch.phase != Phase::Failed {
                branch.phase = if muted {
                    Phase::Draining
                } else {
                    Phase::Playing
                };
            }
            branch.send.set(f32::from(u8::from(!muted)), frames);
            branch.quiet = 0;
            branch.blend = false;
            for output in &branch.returns {
                let gain = &mut nodes[output.node].gains[output.port];
                gain.set(output.desired, frames);
            }
        }
        Ok(())
    }

    pub(super) fn skipped(&self, node: usize) -> bool {
        self.owners[node]
            .is_some_and(|i| matches!(self.branches[i].phase, Phase::Asleep | Phase::Failed))
    }

    pub(super) fn gate(&mut self, index: usize, samples: &mut [f32], frames: usize) {
        if self.sends[index] {
            let branch = &mut self.branches[self.owners[index].unwrap()];
            // Different stereo send boundaries share one envelope advanced
            // once after the block, irrespective of the topological order.
            let mut envelope = branch.send.clone();
            for sample in &mut samples[..frames] {
                *sample *= envelope.next();
            }
        }
    }

    pub(super) fn fail_inactive(&mut self, index: usize, nodes: &mut [PortNode]) -> bool {
        let Some(owner) = self.owners[index] else {
            return false;
        };
        let branch = &mut self.branches[owner];
        if branch.phase == Phase::Playing {
            return false;
        }
        branch.phase = Phase::Failed;
        branch.send.set(0.0, 0);
        for output in &branch.returns {
            nodes[output.node].gains[output.port].set(0.0, 0);
        }
        true
    }

    pub(super) fn finish(&mut self, nodes: &mut [PortNode], samples: &[f32], frames: usize) {
        for branch in &mut self.branches {
            let zero_at_start = branch.send.current == 0.0 && branch.send.remaining == 0;
            for _ in 0..frames.min(branch.send.remaining as usize) {
                branch.send.next();
            }
            match branch.phase {
                Phase::Priming => {
                    branch.prime = branch.prime.saturating_sub(frames as u32);
                    if !self.enabled && branch.prime == 0 {
                        branch.phase = Phase::Playing;
                    }
                }
                Phase::Draining => {
                    if branch.blend {
                        if branch
                            .returns
                            .iter()
                            .all(|out| nodes[out.node].gains[out.port].current == 0.0)
                        {
                            branch.blend = false;
                            branch.send.set(0.0, branch.send_fade);
                        }
                        continue;
                    }
                    if zero_at_start
                        && branch.returns.iter().all(|out| {
                            samples[out.source..out.source + frames]
                                .iter()
                                .all(|s| s.abs() < SILENCE)
                        })
                    {
                        branch.quiet += frames as u64;
                    } else {
                        branch.quiet = 0;
                    }
                    if branch.quiet >= self.quiet_frames + u64::from(self.prime_frames) {
                        for out in &branch.returns {
                            nodes[out.node].gains[out.port].set(0.0, 0);
                        }
                        branch.phase = Phase::Asleep;
                    }
                }
                _ => {}
            }
        }
    }

    pub(super) fn snapshot(
        &self,
        requested_scene: Option<String>,
        active_scene: Option<String>,
        message: Option<String>,
    ) -> BranchSleepState {
        BranchSleepState {
            enabled: self.enabled,
            requested_scene,
            active_scene,
            branches: self
                .branches
                .iter()
                .map(|branch| SleepingBranchState {
                    branch: branch.id.clone(),
                    phase: branch.phase,
                    processors: branch.processors,
                })
                .collect(),
            running_processors: self.shared
                + self
                    .branches
                    .iter()
                    .filter(|b| !matches!(b.phase, Phase::Asleep | Phase::Failed))
                    .map(|b| b.processors)
                    .sum::<usize>(),
            admitted_processors: self.admitted,
            message,
        }
    }
}
