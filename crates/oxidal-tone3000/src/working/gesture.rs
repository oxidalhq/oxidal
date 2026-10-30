//! Explicit scalar gesture boundaries give one undo entry per adjustment.
use super::*;
use oxidal_audio::structure::{GestureOwner, LiveGesture};
#[derive(Debug)]
enum Target {
    Scalar,
    Eq {
        block: String,
        index: usize,
        field: String,
    },
}
impl Target {
    fn resolve(
        engine: &mut Engine,
        target: &str,
        controls: &[oxidal_audio::lifecycle::LiveControl],
    ) -> Result<Self, String> {
        if controls.iter().any(|p| p.target == target) {
            return Ok(Self::Scalar);
        }
        let Some(encoded) = target.strip_prefix("eq:") else {
            return Err("Unknown live adjustment target".into());
        };
        let mut parts = encoded.rsplitn(3, ':');
        let field = parts.next().ok_or("Missing EQ field")?;
        let index: usize = parts
            .next()
            .ok_or("Missing EQ band")?
            .parse()
            .map_err(|_| "Invalid EQ band")?;
        let block = parts.next().ok_or("Missing EQ block")?;
        if index >= 6
            || !matches!(field, "freqHz" | "gainDb" | "q")
            || !engine
                .eq_snapshot()
                .map_err(|e| e.to_string())?
                .iter()
                .any(|r| r.block_id == block)
        {
            return Err("Unknown EQ adjustment target".into());
        }
        Ok(Self::Eq {
            block: block.into(),
            index,
            field: field.into(),
        })
    }
    fn set(&self, engine: &mut Engine, target: &str, value: f32) -> Result<(), String> {
        match self {
            Self::Scalar => engine
                .set_live_control(target, value)
                .map_err(|e| e.to_string()),
            Self::Eq {
                block,
                index,
                field,
            } => {
                let mut band = engine
                    .eq_snapshot()
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .find(|r| &r.block_id == block)
                    .ok_or("EQ block changed")?
                    .eq
                    .bands[*index]
                    .clone();
                match field.as_str() {
                    "freqHz" => band.freq_hz = value.into(),
                    "gainDb" => band.gain_db = value.into(),
                    "q" => band.q = value.into(),
                    _ => unreachable!(),
                }
                engine
                    .set_eq(
                        block,
                        &oxidal_audio::eq::EqEdit::Band {
                            index: *index as u8,
                            band,
                        },
                    )
                    .map_err(|e| e.to_string())
            }
        }
    }
}
#[derive(Debug)]
pub(super) struct Pending {
    pub owner: GestureOwner,
    before: State,
    controls: Vec<oxidal_audio::lifecycle::LiveControl>,
    target: Target,
    eq: Vec<oxidal_audio::eq::BlockEqState>,
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
        let rollback = match pending.target {
            // Only the adjusted control moved: put just that one back.
            Target::Scalar => match pending
                .controls
                .iter()
                .find(|c| c.target == pending.owner.target)
            {
                Some(original) => engine
                    .set_live_control(&original.target, original.value)
                    .map_err(|e| e.to_string()),
                None => engine
                    .apply_live_snapshot(&pending.controls)
                    .map_err(|e| e.to_string()),
            },
            Target::Eq { .. } => (|| -> Result<(), String> {
                let current = engine.eq_snapshot().map_err(|e| e.to_string())?;
                for row in &pending.eq {
                    let actual = &current
                        .iter()
                        .find(|r| r.block_id == row.block_id)
                        .ok_or("EQ block changed")?
                        .eq;
                    for (index, band) in row.eq.bands.iter().enumerate() {
                        if actual.bands[index] != *band {
                            engine
                                .set_eq(
                                    &row.block_id,
                                    &oxidal_audio::eq::EqEdit::Band {
                                        index: index as u8,
                                        band: band.clone(),
                                    },
                                )
                                .map_err(|e| e.to_string())?;
                        }
                    }
                }
                Ok(())
            })(),
        };
        if let Err(e) = rollback {
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
            // Knob adjustments persist in the background: the write takes about
            // 100 ms on an SD card and must never stall the audio thread.
            let pending = self.gesture.take().unwrap();
            self.checkpoint_later(current, &pending.before)?;
            self.undo.push_back(pending.before);
            self.redo.clear();
            self.history_error = None;
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
            let target = Target::resolve(engine, &owner.target, &controls)?;
            let eq = engine.eq_snapshot().map_err(|e| e.to_string())?;
            let before = engine.capture().map_err(|e| e.to_string())?;
            self.gesture = Some(Pending {
                owner,
                before,
                controls,
                target,
                eq,
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
                pending.target.set(engine, &pending.owner.target, value)?;
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
