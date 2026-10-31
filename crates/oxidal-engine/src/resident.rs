//! Resident prepared sessions share one continuous PCM owner. Construction and
//! destruction happen before/after streaming; switching never loads a plugin.
use crate::{Session, ports::Delay, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::{BundleStore, manifest::Tails};

#[derive(Debug)]
pub(crate) struct Resident {
    session: Session,
    name: String,
    left: Vec<f32>,
    right: Vec<f32>,
    delay: [Delay; 2],
    input: [Vec<f32>; 2],
    preserve: bool,
    retained: bool,
    error: Option<String>,
}
impl Resident {
    /// Audio-only work on one exclusive resident. Errors are consumed after all
    /// helpers join; no graph ownership/control/state operation runs here.
    pub(crate) fn process_block(&mut self) {
        if self.error.is_some() {
            return;
        }
        if let Err(error) = self.session.process(
            &[&self.input[0], &self.input[1]],
            &mut [&mut self.left, &mut self.right],
        ) {
            self.error = Some(error);
            return;
        }
        for i in 0..self.left.len() {
            self.left[i] = self.delay[0].next(self.left[i]);
            self.right[i] = self.delay[1].next(self.right[i]);
        }
    }
}
#[derive(Debug)]
struct Transition {
    target: usize,
    prime: usize,
    cursor: usize,
    length: usize,
    preserve: bool,
    retained_target: bool,
}
#[derive(Debug)]
pub struct ResidentSet {
    pool: Option<crate::render::RenderPool>,
    residents: Vec<Resident>,
    active: usize,
    transition: Option<Transition>,
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
        Self::new_with_models(store, world, settings, budget, None)
    }
    pub fn new_with_models(
        store: &BundleStore,
        world: &World,
        settings: &StartRig,
        budget: usize,
        model_root: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        settings.validate()?;
        let frames = settings.stream.input.period_frames as usize;
        let rate = settings.stream.input.sample_rate;
        let mut residents = Vec::new();
        let mut used = 0;
        let active = PreparedRecall {
            revision: settings.revision.clone(),
            recall: settings.recall.clone(),
        };
        for choice in std::iter::once(&active).chain(&settings.prepared) {
            let bundle = store.read(&choice.revision).map_err(|e| e.to_string())?;
            let name = bundle.manifest().name.clone();
            let preserve = bundle
                .manifest()
                .oxidal
                .as_ref()
                .is_some_and(|host| host.recall.tails == Tails::Preserve);
            let rows = choice
                .recall
                .as_ref()
                .map(|r| r.working.as_slice())
                .unwrap_or(&[]);
            let working = match model_root {
                Some(root) => Some((root, rows)),
                None if rows.is_empty() => None,
                None => return Err("Native working store unavailable".into()),
            };
            let mut session = Session::new_with_working(
                bundle,
                world,
                f64::from(rate),
                frames,
                budget.saturating_sub(used),
                working,
            )?;
            if session.channels() != (2, 2) {
                return Err("Resident transport requires stereo logical ports".into());
            }
            if let Some(recall) = &choice.recall {
                if recall.models.is_empty() {
                    session.restore(recall)?;
                } else {
                    session.restore_with_models(
                        recall,
                        model_root.ok_or("Model asset store is unavailable")?,
                    )?;
                }
            }
            used = used
                .checked_add(session.buffer_bytes())
                .and_then(|n| n.checked_add(frames * 4 * size_of::<f32>()))
                .filter(|n| *n <= budget)
                .ok_or("Resident buffers exceed host budget")?;
            residents.push(Resident {
                session,
                name,
                left: vec![0.0; frames],
                right: vec![0.0; frames],
                delay: Default::default(),
                input: [vec![0.0; frames], vec![0.0; frames]],
                preserve,
                retained: false,
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
        let helpers = residents.len().saturating_sub(1).min(3);
        let pool = if crate::render::render_thread_enabled() && helpers > 0 {
            Some(crate::render::RenderPool::named(
                helpers,
                residents.len().div_ceil(helpers),
                "oxidal-set",
            )?)
        } else {
            None
        };
        let result = Self {
            pool,
            residents,
            active: 0,
            transition: None,
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
            || self.residents[self.active].session.model_pending()
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
            preserve: self.residents[self.active].preserve,
            retained_target: self.residents[target].retained,
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
        // Render the incoming graph first. If it rejects its first block, the
        // old graph still receives unchanged input in this same callback.
        let target = self.transition.as_ref().map(|t| t.target);
        if let Some(index) = target {
            self.prepare_input(index, input);
            self.render_batch(Some(index), None)?;
            if let Some(error) = &self.residents[index].error {
                self.switch_error = Some(format!("Prepared alternative failed: {error}"));
                self.transition = None;
            }
        }
        // Candidate validation above preserves same-block failure fallback.
        // The remaining independent graphs can overlap without changing the
        // deterministic return-summing order or dropping any tail work.
        for index in 0..self.residents.len() {
            if Some(index) != target {
                self.prepare_input(index, input);
            }
        }
        self.render_batch(None, target)?;
        if let Some(error) = &self.residents[self.active].error {
            for port in output.iter_mut() {
                port.fill(0.0);
            }
            return Err(error.clone());
        }
        let (left_output, right_output) = output.split_at_mut(1);
        for (i, (out_left, out_right)) in left_output[0]
            .iter_mut()
            .zip(right_output[0].iter_mut())
            .enumerate()
        {
            let old = &self.residents[self.active];
            let (mut left, mut right) = (old.left[i], old.right[i]);
            for (index, resident) in self.residents.iter().enumerate() {
                if resident.retained
                    && resident.error.is_none()
                    && index != self.active
                    && self.transition.as_ref().is_none_or(|t| t.target != index)
                {
                    left += resident.left[i];
                    right += resident.right[i];
                }
            }
            if let Some(t) = &mut self.transition {
                if t.preserve {
                    // Fade the sends, never the stored return. Report completion
                    // only after the aligned graph latency has drained the ramp.
                    left += self.residents[t.target].left[i];
                    right += self.residents[t.target].right[i];
                    t.cursor += 1;
                    if t.cursor >= t.length + self.latency as usize {
                        self.residents[self.active].retained = true;
                        self.residents[t.target].retained = false;
                        self.active = t.target;
                        self.transition = None;
                    }
                } else if t.retained_target {
                    // This incoming graph already has an audible return. Keep
                    // it at unity; ramp only its new send. Fading the return a
                    // second time would dip/cut a tail on A → B(Cut) → A.
                    let weight = (t.cursor.saturating_sub(self.latency as usize) as f32
                        / (t.length - 1) as f32)
                        .min(1.0);
                    left += self.residents[t.target].left[i] - old.left[i] * weight;
                    right += self.residents[t.target].right[i] - old.right[i] * weight;
                    t.cursor += 1;
                    if t.cursor >= t.length + self.latency as usize {
                        self.residents[self.active].retained = false;
                        self.residents[t.target].retained = false;
                        self.active = t.target;
                        self.transition = None;
                    }
                } else if t.prime > 0 {
                    t.prime -= 1;
                } else {
                    let next = &self.residents[t.target];
                    let weight = (t.cursor as f32 / (t.length - 1) as f32).min(1.0);
                    left += (next.left[i] - old.left[i]) * weight;
                    right += (next.right[i] - old.right[i]) * weight;
                    t.cursor += 1;
                    if t.cursor == t.length {
                        self.residents[self.active].retained = false;
                        self.residents[t.target].retained = false;
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
    fn prepare_input(&mut self, index: usize, input: &[&[f32]]) {
        let resident = &mut self.residents[index];
        let audible =
            index == self.active || self.transition.as_ref().is_some_and(|t| t.target == index);
        for (i, (&left, &right)) in input[0].iter().zip(input[1]).enumerate() {
            let gain = match &self.transition {
                Some(t) if t.preserve || t.retained_target => {
                    let weight = ((t.cursor + i) as f32 / (t.length - 1) as f32).min(1.0);
                    if index == self.active {
                        if t.preserve { 1.0 - weight } else { 1.0 }
                    } else if index == t.target {
                        weight
                    } else {
                        0.0
                    }
                }
                _ => {
                    if audible {
                        1.0
                    } else {
                        0.0
                    }
                }
            };
            resident.input[0][i] = left * gain;
            resident.input[1][i] = right * gain;
        }
    }
    fn render_batch(&mut self, only: Option<usize>, skip: Option<usize>) -> Result<(), String> {
        let selected = |index| only.is_none_or(|i| i == index) && skip != Some(index);
        let Some(pool) = &self.pool else {
            for (index, resident) in self.residents.iter_mut().enumerate() {
                if selected(index) {
                    resident.process_block();
                }
            }
            return Ok(());
        };
        let (first, others) = self
            .residents
            .split_first_mut()
            .expect("nonempty resident set");
        for (offset, resident) in others.iter_mut().enumerate() {
            let index = offset + 1;
            if selected(index) && resident.error.is_none() {
                // Stable assignment for the full session: native AudioPort binds
                // to its first render thread, including while it is the candidate.
                pool.queue(
                    (index - 1) % pool.helpers(),
                    crate::render::ResidentJob::block(resident),
                );
            }
        }
        pool.start();
        if selected(0) {
            first.process_block();
        }
        // Always join, including when the main resident failed. Owner controls
        // and buffer reuse cannot race work still running on another core.
        pool.finish()
    }
    pub fn take_switch_error(&mut self) -> Option<String> {
        self.switch_error.take()
    }
    /// JUCE dispatch handle from the first healthy resident, for the owner to
    /// pump outside the rig lock (dispatch is process-wide).
    pub fn dispatcher(&mut self) -> Option<oxidal_tone3000::PumpPort> {
        self.residents
            .iter_mut()
            .filter(|r| r.error.is_none())
            .find_map(|r| r.session.dispatcher())
    }
    /// Owner upkeep under the rig lock, without JUCE dispatch.
    pub fn tick(&mut self) -> Result<(), String> {
        for (index, r) in self.residents.iter_mut().enumerate() {
            if r.error.is_some() {
                continue;
            }
            if let Err(error) = r.session.tick() {
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
