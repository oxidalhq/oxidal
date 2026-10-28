//! Resident prepared sessions share one continuous PCM owner. Construction and
//! destruction happen before/after streaming; switching never loads a plugin.
use crate::{Session, ports::Delay, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::BundleStore;

#[derive(Debug)]
struct Resident {
    session: Session,
    name: String,
    left: Vec<f32>,
    right: Vec<f32>,
    delay: [Delay; 2],
    error: Option<String>,
}
#[derive(Debug)]
struct Transition {
    target: usize,
    prime: usize,
    cursor: usize,
    length: usize,
}
#[derive(Debug)]
pub struct ResidentSet {
    residents: Vec<Resident>,
    active: usize,
    transition: Option<Transition>,
    zero: Vec<f32>,
    frames: usize,
    rate: u32,
    latency: u32,
    buffer_bytes: usize,
    switch_error: Option<String>,
}
impl ResidentSet {
    pub fn new(
        store: &BundleStore,
        world: &World,
        settings: &StartRig,
        budget: usize,
    ) -> Result<Self, String> {
        settings.validate()?;
        let frames = settings.stream.input.period_frames as usize;
        let rate = settings.stream.input.sample_rate;
        let mut residents = Vec::new();
        let mut used = frames
            .checked_mul(size_of::<f32>())
            .ok_or("Resident buffer overflow")?;
        let active = PreparedRecall {
            revision: settings.revision.clone(),
            recall: settings.recall.clone(),
        };
        for choice in std::iter::once(&active).chain(&settings.prepared) {
            let bundle = store.read(&choice.revision).map_err(|e| e.to_string())?;
            let name = bundle.manifest().name.clone();
            let mut session = Session::new(
                bundle,
                world,
                f64::from(rate),
                frames,
                budget.saturating_sub(used),
            )?;
            if session.channels() != (2, 2) {
                return Err("Resident transport requires stereo logical ports".into());
            }
            if let Some(recall) = &choice.recall {
                session.restore(recall)?;
            }
            used = used
                .checked_add(session.buffer_bytes())
                .and_then(|n| n.checked_add(frames * 2 * size_of::<f32>()))
                .filter(|n| *n <= budget)
                .ok_or("Resident buffers exceed host budget")?;
            residents.push(Resident {
                session,
                name,
                left: vec![0.0; frames],
                right: vec![0.0; frames],
                delay: Default::default(),
                error: None,
            });
        }
        let latency = residents
            .iter()
            .map(|r| r.session.latency_frames())
            .max()
            .unwrap_or(0);
        if residents.len() > 1 && u64::from(latency) + frames as u64 + 2 > u64::from(rate) {
            return Err("Prepared set delay exceeds the one-second live switch window".into());
        }
        for resident in &mut residents {
            let delay = (latency - resident.session.latency_frames()) as usize;
            resident.delay = [
                Delay::new(delay, &mut used, budget)?,
                Delay::new(delay, &mut used, budget)?,
            ];
        }
        let result = Self {
            residents,
            active: 0,
            transition: None,
            zero: vec![0.0; frames],
            frames,
            rate,
            latency,
            buffer_bytes: used,
            switch_error: None,
        };
        if serde_json::to_vec(&result.snapshot())
            .map_err(|e| e.to_string())?
            .len()
            + 65536
            > REPLY_LIMIT
        {
            return Err("Resident status exceeds IPC budget".into());
        }
        Ok(result)
    }
    pub fn active_mut(&mut self) -> &mut Session {
        &mut self.residents[self.active].session
    }
    pub fn switching(&self) -> bool {
        self.transition.is_some()
    }
    pub fn healthy(&self) -> bool {
        self.residents[self.active].session.healthy()
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut state = self.residents[self.active].session.snapshot();
        state.buffer_bytes = self.buffer_bytes;
        state.latency_frames = self.latency;
        state.prepared = self
            .residents
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != self.active)
            .map(|(_, r)| PreparedStatus {
                revision: r.session.source_revision().into(),
                name: r.name.clone(),
                modified: r.session.is_modified(),
                error: r.error.clone(),
            })
            .collect();
        state
    }
    pub fn switch(&mut self, command: SwitchCommand) -> Result<(), String> {
        if !self.healthy()
            || self.switching()
            || !self.residents[self.active]
                .session
                .matches_cursor(&command.session, command.expected_revision)
        {
            return Err("Resident switch session conflict".into());
        }
        if command.fade_frames < 2 || command.fade_frames > self.rate / 4 {
            return Err("Invalid resident fade length".into());
        }
        if u64::from(self.latency) + self.frames as u64 + u64::from(command.fade_frames)
            > u64::from(self.rate)
        {
            return Err("Prepared transition exceeds the one-second live switch window; previous sound retained".into());
        }
        let target = self
            .residents
            .iter()
            .position(|r| r.session.source_revision() == command.revision)
            .filter(|i| *i != self.active)
            .ok_or("Select a prepared alternative")?;
        if let Some(error) = &self.residents[target].error {
            return Err(format!("Prepared alternative unavailable: {error}"));
        }
        self.switch_error = None;
        // Feed the candidate current input before blending. Both output paths
        // already have the same fixed host delay, including the active path.
        self.transition = Some(Transition {
            target,
            prime: self.latency as usize + self.frames,
            cursor: 0,
            length: command.fade_frames as usize,
        });
        Ok(())
    }
    pub fn process(&mut self, input: &[&[f32]], output: &mut [&mut [f32]]) -> Result<(), String> {
        if input.len() != 2
            || output.len() != 2
            || input.iter().any(|p| p.len() != self.frames)
            || output.iter().any(|p| p.len() != self.frames)
        {
            for port in output.iter_mut() {
                port.fill(0.0);
            }
            return Err("Invalid resident process block".into());
        }
        for (index, resident) in self.residents.iter_mut().enumerate() {
            let audible =
                index == self.active || self.transition.as_ref().is_some_and(|t| t.target == index);
            let (left, right) = if audible {
                (input[0], input[1])
            } else {
                (self.zero.as_slice(), self.zero.as_slice())
            };
            if resident.error.is_some() {
                continue;
            }
            if let Err(error) = resident.session.process(
                &[left, right],
                &mut [&mut resident.left, &mut resident.right],
            ) {
                if index == self.active {
                    for port in output.iter_mut() {
                        port.fill(0.0);
                    }
                    return Err(error);
                }
                resident.error = Some(error.clone());
                if self.transition.as_ref().is_some_and(|t| t.target == index) {
                    self.transition = None;
                    self.switch_error = Some(format!("Prepared alternative failed: {error}"));
                }
                continue;
            }
            for i in 0..self.frames {
                resident.left[i] = resident.delay[0].next(resident.left[i]);
                resident.right[i] = resident.delay[1].next(resident.right[i]);
            }
        }
        let (left_output, right_output) = output.split_at_mut(1);
        for (i, (out_left, out_right)) in left_output[0]
            .iter_mut()
            .zip(right_output[0].iter_mut())
            .enumerate()
        {
            let old = &self.residents[self.active];
            let (mut left, mut right) = (old.left[i], old.right[i]);
            if let Some(t) = &mut self.transition {
                if t.prime > 0 {
                    t.prime -= 1;
                } else {
                    let next = &self.residents[t.target];
                    let weight = (t.cursor as f32 / (t.length - 1) as f32).min(1.0);
                    left += (next.left[i] - left) * weight;
                    right += (next.right[i] - right) * weight;
                    t.cursor += 1;
                    if t.cursor == t.length {
                        self.active = t.target;
                        self.transition = None;
                    }
                }
            }
            *out_left = left;
            *out_right = right;
        }
        Ok(())
    }
    pub fn take_switch_error(&mut self) -> Option<String> {
        self.switch_error.take()
    }
    pub fn pump(&mut self) -> Result<(), String> {
        for (index, r) in self.residents.iter_mut().enumerate() {
            if r.error.is_some() {
                continue;
            }
            if let Err(error) = r.session.pump() {
                if index == self.active {
                    return Err(error);
                }
                r.error = Some(error.clone());
                if self.transition.as_ref().is_some_and(|t| t.target == index) {
                    self.transition = None;
                    self.switch_error = Some(format!("Prepared alternative failed: {error}"));
                }
            }
        }
        Ok(())
    }
}
