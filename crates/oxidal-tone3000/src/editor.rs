//! Single native owner with bounded transactions. No live audio thread is used by this offline editor.
use crate::{Engine, State, protocol::*};
use oxidal_presets::{OwnedStore, Store};
use std::{
    collections::VecDeque,
    path::PathBuf,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
fn identity(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
#[derive(Debug)]
struct Gesture {
    owner: String,
    token: String,
    target: String,
    sequence: u32,
    touched: Instant,
}
#[derive(Debug)]
struct Checkpoint {
    state: State,
    dirty: bool,
}
// History is control-thread memory, separate from active model capacity.
const HISTORY_ENTRIES: usize = 8;
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
#[derive(Debug)]
pub struct Editor {
    engine: Engine,
    originals: Store,
    owned: OwnedStore,
    state: EditorSnapshot,
    committed: State,
    gesture: Option<Gesture>,
    finished: VecDeque<String>,
    receipts: VecDeque<(String, String)>,
    failed: bool,
    undo: VecDeque<Checkpoint>,
    redo: VecDeque<Checkpoint>,
}
impl Editor {
    pub fn new(root: PathBuf) -> Result<Self> {
        let mut engine = Engine::new(48000.0, 128).map_err(|e| e.to_string())?;
        engine.wait_ready().map_err(|e| e.to_string())?;
        let committed = engine.capture().map_err(|e| e.to_string())?;
        let session = format!(
            "native-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        );
        Ok(Self {
            engine,
            committed,
            originals: Store::new(root.clone()),
            owned: OwnedStore::new(root.join("owned")),
            state: EditorSnapshot {
                session,
                revision: 0,
                loaded: None,
                source_sha256: None,
                dirty: false,
                edit: None,
                parameters: vec![],
                block_controls: vec![],
                owned: vec![],
                state_captures: 0,
                live_audio: false,
                can_undo: false,
                can_redo: false,
            },
            gesture: None,
            finished: VecDeque::new(),
            receipts: VecDeque::new(),
            failed: false,
            undo: VecDeque::new(),
            redo: VecDeque::new(),
        })
    }
    fn finish(&mut self) {
        if let Some(g) = self.gesture.take() {
            if self.finished.len() == 32 {
                self.finished.pop_front();
            }
            self.finished.push_back(g.token);
        }
        self.state.edit = None;
    }
    fn rollback(&mut self) -> Result<()> {
        if let Err(e) = self
            .engine
            .restore(&self.committed)
            .and_then(|_| self.engine.wait_ready())
        {
            self.failed = true;
            return Err(format!("Native rollback failed; restart required: {e}"));
        }
        Ok(())
    }
    fn capture(&mut self) -> Result<()> {
        self.committed = self.engine.capture().map_err(|e| e.to_string())?;
        self.state.state_captures += 1;
        Ok(())
    }
    fn capture_change(&mut self) -> Result<()> {
        let next = self.engine.capture().map_err(|e| e.to_string())?;
        self.undo.push_back(Checkpoint {
            state: std::mem::replace(&mut self.committed, next),
            dirty: self.state.dirty,
        });
        self.redo.clear();
        while self.undo.len() > HISTORY_ENTRIES
            || self.undo.iter().map(|p| p.state.byte_len()).sum::<usize>() > HISTORY_BYTES
        {
            self.undo.pop_front();
        }
        self.state.state_captures += 1;
        Ok(())
    }
    fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
    fn restore_history(&mut self, redo: bool) -> Result<()> {
        if self.gesture.is_some() {
            return Err("edit_busy".into());
        }
        let history = if redo { &self.redo } else { &self.undo };
        let target = history.back().ok_or("No history available")?;
        if let Err(error) = self
            .engine
            .restore(&target.state)
            .and_then(|_| self.engine.wait_ready())
            .and_then(|_| self.engine.block_controls().map(|_| ()))
        {
            self.rollback()?;
            return Err(error.to_string());
        }
        let (from, to) = if redo {
            (&mut self.redo, &mut self.undo)
        } else {
            (&mut self.undo, &mut self.redo)
        };
        let target = from.pop_back().expect("checked history");
        to.push_back(Checkpoint {
            state: std::mem::replace(&mut self.committed, target.state),
            dirty: self.state.dirty,
        });
        self.state.dirty = target.dirty;
        // A structural edit may change state size; moving history can bring a
        // larger current state into the retained set. Keep the combined budget.
        while self
            .undo
            .iter()
            .chain(&self.redo)
            .map(|p| p.state.byte_len())
            .sum::<usize>()
            > HISTORY_BYTES
        {
            if redo {
                self.undo.pop_front();
            } else {
                self.redo.pop_front();
            }
        }
        Ok(())
    }
    pub fn tick(&mut self) -> Result<()> {
        if self.failed {
            return Err("Native editor unavailable; restart required".into());
        }
        self.engine.pump().map_err(|e| e.to_string())?;
        if self
            .gesture
            .as_ref()
            .is_some_and(|g| g.touched.elapsed() >= Duration::from_secs(30))
        {
            self.rollback()?;
            self.finish();
            self.state.revision += 1;
        }
        Ok(())
    }
    pub fn snapshot(&mut self) -> Result<EditorSnapshot> {
        self.tick()?;
        self.state.parameters =
            serde_json::from_value(self.engine.catalog().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        for parameter in &mut self.state.parameters {
            parameter.writable = writable(&parameter.id);
            parameter.staged = staged(&parameter.id);
        }
        self.state.block_controls = self.engine.block_controls().map_err(|e| e.to_string())?;
        self.state.can_undo = !self.undo.is_empty();
        self.state.can_redo = !self.redo.is_empty();
        self.state.owned = self.owned.list().map_err(|e| e.to_string())?;
        Ok(self.state.clone())
    }
    pub fn command(&mut self, command: EditorCommand) -> Result<EditorSnapshot> {
        self.tick()?;
        if command.session != self.state.session {
            return Err("native_session_conflict".into());
        }
        if !identity(&command.request_id) {
            return Err("invalid_request_id".into());
        }
        let fingerprint = serde_json::to_string(&command).map_err(|e| e.to_string())?;
        if let Some((_, old)) = self
            .receipts
            .iter()
            .find(|(id, _)| id == &command.request_id)
        {
            if old != &fingerprint {
                return Err("request_id_conflict".into());
            }
            return self.snapshot();
        }
        if command.expected_revision != self.state.revision {
            return Err("native_revision_conflict".into());
        }
        self.apply(command.action)?;
        self.state.revision += 1;
        if self.receipts.len() == 32 {
            self.receipts.pop_front();
        }
        self.receipts.push_back((command.request_id, fingerprint));
        self.snapshot()
    }
    fn apply(&mut self, action: EditorAction) -> Result<()> {
        match action {
            EditorAction::Load { id, owned } => {
                if self.gesture.is_some() {
                    return Err("edit_busy".into());
                }
                let (source, bytes) = if owned {
                    let (info, bytes) = self.owned.read(&id).map_err(|e| e.to_string())?;
                    (info.source_sha256, bytes)
                } else {
                    (
                        id.clone(),
                        self.originals.original(&id).map_err(|e| e.to_string())?,
                    )
                };
                if let Err(error) = self
                    .engine
                    .load_preset(&bytes)
                    .and_then(|_| self.engine.wait_ready())
                    // Reject an unrepresentable control catalog before committing a load.
                    .and_then(|_| self.engine.block_controls().map(|_| ()))
                {
                    self.rollback()?;
                    return Err(error.to_string());
                }
                if let Err(error) = self.capture() {
                    self.rollback()?;
                    return Err(error);
                }
                self.state.source_sha256 = Some(source);
                self.state.loaded = Some(id);
                self.state.dirty = false;
                self.clear_history();
            }
            EditorAction::Save { name } => {
                if self.gesture.is_some() {
                    return Err("edit_busy".into());
                }
                let source = self
                    .state
                    .source_sha256
                    .clone()
                    .ok_or("Load a preset first")?;
                let bytes = self.engine.save_preset(&name).map_err(|e| e.to_string());
                // Upstream save changes native active-preset identity. Restore the exact working
                // session before storage, so a storage failure never changes our committed state.
                self.rollback()?;
                let info = self
                    .owned
                    .save(&source, &bytes?)
                    .map_err(|e| e.to_string())?;
                self.state.loaded = Some(info.id);
                self.state.dirty = false;
                self.clear_history();
            }
            EditorAction::Undo => self.restore_history(false)?,
            EditorAction::Redo => self.restore_history(true)?,
            EditorAction::RemoveBlock { block_id } => {
                if self.gesture.is_some() {
                    return Err("edit_busy".into());
                }
                if self.state.loaded.is_none() {
                    return Err("Load a preset first".into());
                }
                if !self
                    .engine
                    .block_controls()
                    .map_err(|e| e.to_string())?
                    .iter()
                    .any(|p| p.block_id == block_id)
                {
                    return Err("Missing or stale native block".into());
                }
                if let Err(error) = self
                    .engine
                    .remove_block(&block_id)
                    .and_then(|_| self.engine.wait_ready())
                    .and_then(|_| self.engine.block_controls().map(|_| ()))
                {
                    self.rollback()?;
                    return Err(error.to_string());
                }
                if let Err(error) = self.capture_change() {
                    self.rollback()?;
                    return Err(error);
                }
                self.state.dirty = true;
            }
            EditorAction::Begin {
                owner,
                token,
                target,
            } => {
                if self.state.loaded.is_none() {
                    return Err("Load a preset first".into());
                }
                if !identity(&owner) || !identity(&token) {
                    return Err("invalid_edit_identity".into());
                }
                if self.finished.contains(&token) {
                    return Err("edit_finished".into());
                }
                if self.gesture.is_some() {
                    return Err("edit_busy".into());
                }
                let blocks = self.engine.block_controls().map_err(|e| e.to_string())?;
                if !writable(&target) && !blocks.iter().any(|p| p.id == target) {
                    return Err("Native control is not qualified for editing".into());
                }
                self.state.edit = Some(Editing {
                    owner: owner.clone(),
                    target: target.clone(),
                });
                self.gesture = Some(Gesture {
                    owner,
                    token,
                    target,
                    sequence: 0,
                    touched: Instant::now(),
                });
            }
            EditorAction::Cancel { owner, token } => {
                self.check_owner(&owner, &token)?;
                self.rollback()?;
                self.finish();
            }
            EditorAction::Preview {
                owner,
                token,
                sequence,
                value,
            } => self.change(owner, token, sequence, value, false)?,
            EditorAction::Commit {
                owner,
                token,
                sequence,
                value,
            } => self.change(owner, token, sequence, value, true)?,
        }
        Ok(())
    }
    fn check_owner(&self, owner: &str, token: &str) -> Result<()> {
        let g = self.gesture.as_ref().ok_or("edit_stale")?;
        if g.owner != owner || g.token != token {
            return Err("edit_owner_conflict".into());
        }
        Ok(())
    }
    fn change(
        &mut self,
        owner: String,
        token: String,
        sequence: u32,
        value: f32,
        commit: bool,
    ) -> Result<()> {
        self.check_owner(&owner, &token)?;
        let g = self.gesture.as_ref().expect("checked owner");
        if sequence <= g.sequence || !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err("invalid_edit_sequence_or_value".into());
        }
        let target = g.target.clone();
        let block = self
            .engine
            .block_controls()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|p| p.id == target);
        let parameters: Vec<Parameter> =
            serde_json::from_value(self.engine.catalog().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let parameter = parameters.iter().find(|p| p.id == target);
        let requires_commit = staged(&target) || block.as_ref().is_some_and(|p| p.staged);
        if requires_commit && !commit {
            return Err("Processing changes apply only on commit".into());
        }
        if (block.as_ref().is_some_and(|p| p.step == 1.0) || parameter.is_some_and(|p| p.toggle))
            && value != 0.0
            && value != 1.0
        {
            return Err("Toggles require 0 or 1".into());
        }
        let changed = if let Some(p) = &block {
            self.engine.set_block(&p.block_id, &p.parameter, value)
        } else {
            self.engine.set_normalized(&target, value)
        };
        let result = changed.and_then(|_| {
            if requires_commit {
                self.engine.wait_ready()
            } else {
                Ok(())
            }
        });
        if let Err(error) = result {
            self.rollback()?;
            self.finish();
            return Err(error.to_string());
        }
        if commit {
            if let Err(error) = self.capture_change() {
                self.rollback()?;
                self.finish();
                return Err(error);
            }
            self.state.dirty |= block.is_some() || parameter.is_some_and(|p| p.tone);
            self.finish();
        } else {
            let g = self.gesture.as_mut().unwrap();
            g.sequence = sequence;
            g.touched = Instant::now();
        }
        Ok(())
    }
}
