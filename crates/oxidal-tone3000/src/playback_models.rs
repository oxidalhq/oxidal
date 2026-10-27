//! Model verification runs away from PCM; only the owner touches the native engine.
use oxidal_audio::lifecycle::{
    ModelAssignment, ModelOperation, ModelPhase, ModelProgress, valid_models,
};
use oxidal_presets::{ModelAsset, ModelStore};
use oxidal_tone3000::Engine;
use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    thread::JoinHandle,
    time::{Duration, Instant},
};

type Verified = Result<(ModelAsset, PathBuf), String>;
#[derive(Default)]
pub struct Models {
    progress: Option<ModelProgress>,
    verification: Option<(JoinHandle<()>, mpsc::Receiver<Verified>)>,
}
impl Models {
    pub fn pending(&self) -> bool {
        self.progress.as_ref().is_some_and(|p| p.phase.pending())
    }
    pub fn operation(
        &mut self,
        engine: &mut Engine,
        root: &Path,
        operation: ModelOperation,
        serial: u64,
    ) -> Result<Option<ModelProgress>, String> {
        match operation {
            ModelOperation::Prepare { assignment } => {
                if !assignment.valid()
                    || self.pending()
                    || self
                        .verification
                        .as_ref()
                        .is_some_and(|(t, _)| !t.is_finished())
                {
                    return Err("Invalid assignment or previous model still preparing".into());
                }
                let runtime = engine.runtime().map_err(|e| e.to_string())?;
                if !runtime["blocks"].as_array().is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|b| b["blockId"].as_str() == Some(&assignment.target))
                }) && !engine
                    .slots()
                    .map_err(|e| e.to_string())?
                    .iter()
                    .any(|slot| {
                        slot.target == assignment.target
                            && Some(&slot.position) == assignment.insertion.as_ref()
                    })
                {
                    return Err("Select an existing tone block or current insertion slot".into());
                }
                let store = ModelStore::new(root.join("audition-models"));
                let id = assignment.asset.clone();
                let (send, receive) = mpsc::sync_channel(1);
                let task = std::thread::spawn(move || {
                    let _ = send.send(store.read(&id).map_err(|e| e.to_string()));
                });
                self.verification = Some((task, receive));
                self.progress = Some(ModelProgress {
                    request: serial,
                    assignment,
                    phase: ModelPhase::Verifying,
                    error: None,
                });
            }
            ModelOperation::Poll => self.poll(engine)?,
            ModelOperation::Commit => {
                self.poll(engine)?;
                if self
                    .progress
                    .as_ref()
                    .is_some_and(|p| p.phase == ModelPhase::Failed)
                {
                    return Ok(self.progress.clone());
                }
                if self
                    .progress
                    .as_ref()
                    .is_none_or(|p| p.phase != ModelPhase::Ready)
                {
                    return Err("Model is not ready".into());
                }
                self.native(engine, 1)?;
            }
            ModelOperation::Cancel => {
                if let Some(progress) = &mut self.progress {
                    if progress.phase == ModelPhase::Verifying {
                        progress.phase = ModelPhase::Cancelled;
                    } else if progress.phase.pending() {
                        self.native(engine, 2)?;
                    }
                }
            }
        }
        Ok(self.progress.clone())
    }
    fn fail(&mut self, error: String) {
        if let Some(p) = &mut self.progress {
            p.phase = ModelPhase::Failed;
            p.error = Some(error);
        }
    }
    fn native(&mut self, engine: &mut Engine, action: i32) -> Result<(), String> {
        let status = engine
            .model_preparation(action)
            .map_err(|e| e.to_string())?;
        let phase: ModelPhase =
            serde_json::from_value(status["phase"].clone()).map_err(|e| e.to_string())?;
        if let Some(p) = &mut self.progress {
            if status["block_id"].as_str() != Some(&p.assignment.target) {
                return Err("Model target identity changed".into());
            }
            p.phase = phase;
            p.error = status["error"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
        }
        Ok(())
    }
    fn poll(&mut self, engine: &mut Engine) -> Result<(), String> {
        if self
            .progress
            .as_ref()
            .is_some_and(|p| p.phase == ModelPhase::Verifying)
            && let Some((_, receive)) = &self.verification
        {
            match receive.try_recv() {
                Ok(Ok((asset, path))) => {
                    let target = &self.progress.as_ref().unwrap().assignment.target;
                    match engine.prepare_model(target, &path, &asset.tone) {
                        Ok(()) => self.progress.as_mut().unwrap().phase = ModelPhase::Preparing,
                        Err(e) => self.fail(e.to_string()),
                    }
                }
                Ok(Err(e)) => self.fail(e),
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.fail("Model verification stopped".into())
                }
                Err(mpsc::TryRecvError::Empty) => (),
            }
        }
        if self.progress.as_ref().is_some_and(|p| {
            matches!(
                p.phase,
                ModelPhase::Preparing | ModelPhase::Ready | ModelPhase::Applying
            )
        }) {
            self.native(engine, 0)?;
        }
        Ok(())
    }
}

/// Used before PCM opens, or in the isolated save worker. No network required.
pub fn restore(
    engine: &mut Engine,
    root: &Path,
    assignments: &[ModelAssignment],
    frames: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if !valid_models(assignments) {
        return Err("Invalid model assignments".into());
    }
    let mut left = vec![0.0; frames];
    let mut right = left.clone();
    let store = ModelStore::new(root.join("audition-models"));
    for assignment in assignments {
        let (asset, path) = store.read(&assignment.asset)?;
        if let Some(position) = &assignment.insertion {
            engine.restore_slot(&assignment.target, position)?;
        }
        engine.prepare_model(&assignment.target, &path, &asset.tone)?;
        let started = Instant::now();
        loop {
            let state = engine.model_preparation(0)?;
            match state["phase"].as_str() {
                Some("ready") => {
                    engine.model_preparation(1)?;
                }
                Some("applied") => break,
                Some("failed" | "cancelled") => {
                    return Err("Cannot restore confirmed model assignment".into());
                }
                _ => (),
            }
            if started.elapsed() > Duration::from_secs(20) {
                return Err("Model restore timed out".into());
            }
            left.fill(0.0);
            right.fill(0.0);
            engine.process(&mut left, &mut right)?;
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    Ok(())
}

/// Compare model identities separately from scalar readback when verifying a saved copy.
pub fn identities(
    engine: &mut Engine,
) -> Result<Vec<serde_json::Value>, Box<dyn std::error::Error>> {
    let chain = engine.chain()?;
    let mut result = vec![];
    for lane in ["chain", "chainRight"] {
        if let Some(blocks) = chain[lane].as_array() {
            for block in blocks.iter().filter(|b| b["kind"] == "tone") {
                result.push(serde_json::json!({"lane":lane,"id":block["blockId"],"tone":block["tone"]["id"],"model":block["activeModelId"]}));
            }
        }
    }
    Ok(result)
}
