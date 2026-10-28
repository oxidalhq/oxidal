//! Explicit scalar gesture boundaries give one undo entry per adjustment.
use super::*;
use oxidal_audio::structure::{GestureOwner, LiveGesture};
#[derive(Debug)]
pub(super) struct Pending {
    pub owner: GestureOwner,
    before: State,
    controls: Vec<oxidal_audio::lifecycle::LiveControl>,
    sequence: u32,
    pub updated: std::time::Instant,
}
impl Pending {
    pub(super) fn byte_len(&self) -> usize {
        self.before.byte_len()
    }
}
impl Authoring {
    pub fn gesture_pending(&self) -> bool {
        self.gesture.is_some()
    }
    fn remember_finished(&mut self, owner: GestureOwner) {
        self.finished_gestures.push_back((owner.owner, owner.token));
        while self.finished_gestures.len() > 8 {
            self.finished_gestures.pop_front();
        }
    }
    fn cancel_gesture(&mut self, engine: &mut Engine) -> Result<(), String> {
        let pending = self.gesture.take().ok_or("No active native adjustment")?;
        if let Err(e) = engine.apply_live_snapshot(&pending.controls) {
            self.failed = true;
            return Err(format!("Adjustment rollback failed: {e}"));
        }
        self.remember_finished(pending.owner);
        Ok(())
    }
    pub(super) fn finish_gesture(&mut self, engine: &mut Engine) -> Result<(), String> {
        let Some(pending) = self.gesture.as_ref() else {
            return Ok(());
        };
        let current = engine.capture().map_err(|e| e.to_string())?;
        if current != pending.before {
            let receipt = match write(&self.root, &self.source, &current) {
                Ok(r) => r,
                Err(e) => {
                    self.cancel_gesture(engine)?;
                    return Err(e);
                }
            };
            let pending = self.gesture.take().unwrap();
            self.undo.push_back(pending.before);
            self.redo.clear();
            self.working = Some(receipt);
            self.remember_finished(pending.owner);
            self.trim_history();
        } else {
            let pending = self.gesture.take().unwrap();
            self.remember_finished(pending.owner);
        }
        Ok(())
    }
    pub(super) fn gesture_command(
        &mut self,
        engine: &mut Engine,
        edit: LiveGesture,
    ) -> Result<AuthoringStatus, String> {
        if self.measurement_pending() {
            return Err("Cancel measurement before adjusting".into());
        }
        if let LiveGesture::Begin {
            owner,
            token,
            target,
        } = &edit
        {
            let owner = GestureOwner {
                owner: owner.clone(),
                token: token.clone(),
                target: target.clone(),
            };
            if !owner.valid() {
                return Err("Invalid adjustment identity".into());
            }
            if let Some(pending) = &self.gesture {
                return if pending.owner == owner {
                    self.snapshot(engine)
                } else {
                    Err("Another adjustment owns the native controls".into())
                };
            }
            if self
                .finished_gestures
                .iter()
                .any(|(o, t)| o == &owner.owner && t == &owner.token)
            {
                return Err("Adjustment already finished".into());
            }
            let controls = engine.live_controls().map_err(|e| e.to_string())?;
            if !controls.iter().any(|p| p.target == owner.target) {
                return Err("Unknown live adjustment target".into());
            }
            self.gesture = Some(Pending {
                owner,
                before: engine.capture().map_err(|e| e.to_string())?,
                controls,
                sequence: 0,
                updated: std::time::Instant::now(),
            });
            self.trim_history();
            return self.snapshot(engine);
        }
        let (owner, token) = match &edit {
            LiveGesture::Preview { owner, token, .. }
            | LiveGesture::Commit { owner, token, .. }
            | LiveGesture::Cancel { owner, token } => (owner, token),
            _ => unreachable!(),
        };
        // An uncertain terminal request cannot later undo a completed adjustment.
        if self
            .finished_gestures
            .iter()
            .any(|(o, t)| o == owner && t == token)
        {
            return if matches!(edit, LiveGesture::Preview { .. }) {
                Err("Adjustment already finished; reopen the control".into())
            } else {
                self.snapshot(engine)
            };
        }
        let pending = self
            .gesture
            .as_mut()
            .filter(|g| &g.owner.owner == owner && &g.owner.token == token)
            .ok_or("Adjustment ownership changed")?;
        match edit {
            LiveGesture::Cancel { .. } => self.cancel_gesture(engine)?,
            LiveGesture::Preview {
                sequence, value, ..
            }
            | LiveGesture::Commit {
                sequence, value, ..
            } => {
                if sequence <= pending.sequence {
                    return Err("Adjustment sequence is stale".into());
                }
                engine
                    .set_live_control(&pending.owner.target, value)
                    .map_err(|e| e.to_string())?;
                pending.sequence = sequence;
                pending.updated = std::time::Instant::now();
                if matches!(edit, LiveGesture::Commit { .. }) {
                    self.finish_gesture(engine)?;
                }
            }
            _ => unreachable!(),
        }
        self.snapshot(engine)
    }
}
