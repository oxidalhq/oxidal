//! Verified whole-native model transactions. Extracted stages need an extended
//! derivation recipe before admitting replacement or insertion.
use super::*;
use oxidal_audio::lifecycle::{ModelOperation, ModelPhase, ModelProgress, valid_models};
use std::path::Path;

impl Session {
    pub fn model_pending(&self) -> bool {
        self.model_task.pending()
    }
    fn whole_model_node(&self, node: &str) -> Result<(), String> {
        if self.failed || !self.state.slots.iter().any(|s| s.node == node) {
            return Err("Model editing requires a whole-native node".into());
        }
        Ok(())
    }
    pub fn model_command(&mut self, mut command: ModelCommand, root: &Path) -> Result<(), String> {
        self.whole_model_node(&command.node)?;
        if !self.matches_cursor(&command.session, command.expected_revision) || !root.is_absolute()
        {
            return Err("Model session conflict or invalid asset store".into());
        }
        if let ModelOperation::Prepare { assignment } = &mut command.operation {
            let current = self.state.models.iter().find(|m| m.node == command.node);
            let coordinate = current
                .and_then(|m| m.assignments.iter().find(|a| a.target == assignment.target))
                .and_then(|a| a.insertion.clone())
                .or_else(|| {
                    self.state
                        .slots
                        .iter()
                        .find(|s| s.node == command.node)
                        .and_then(|s| s.slots.iter().find(|s| s.target == assignment.target))
                        .map(|s| s.position.clone())
                });
            if assignment
                .insertion
                .as_ref()
                .is_some_and(|p| Some(p) != coordinate.as_ref())
            {
                return Err("Model insertion coordinate differs from its owner".into());
            }
            assignment.insertion = coordinate;
            let mut prospective = current.map(|m| m.assignments.clone()).unwrap_or_default();
            if let Some(old) = prospective
                .iter_mut()
                .find(|a| a.target == assignment.target)
            {
                *old = assignment.clone();
            } else {
                prospective.push(assignment.clone());
            }
            if !valid_models(&prospective)
                || serde_json::to_vec(&self.state)
                    .map_err(|e| e.to_string())?
                    .len()
                    + 32768
                    > REPLY_LIMIT
            {
                return Err("Model exceeds the mixed control-state byte budget".into());
            }
        } else if self.model_node.as_deref() != Some(&command.node) {
            return Err("No model transaction for this node".into());
        }
        let serial = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        let Some(Processor::Native(engine)) = self.graph.processor_mut(&command.node) else {
            return Err("Missing native processor".into());
        };
        let progress = self
            .model_task
            .operation(engine, root, command.operation, serial)?;
        self.model_root = Some(root.into());
        self.model_node = Some(command.node.clone());
        self.record_model(&command.node, progress)
    }
    fn record_model(&mut self, node: &str, progress: Option<ModelProgress>) -> Result<(), String> {
        let next = progress.map(|progress| NodeModelChange {
            node: node.into(),
            progress,
        });
        if next == self.state.model_change {
            return Ok(());
        }
        if let Some(change) = &next
            && change.progress.phase == ModelPhase::Applied
        {
            let assignment = change.progress.assignment.clone();
            if let Some(row) = self.state.models.iter_mut().find(|r| r.node == node) {
                if let Some(old) = row
                    .assignments
                    .iter_mut()
                    .find(|a| a.target == assignment.target)
                {
                    *old = assignment;
                } else {
                    row.assignments.push(assignment);
                }
            } else {
                self.state.models.push(NodeModels {
                    node: node.into(),
                    assignments: vec![assignment],
                });
            }
            if let Err(error) = self.refresh_model_node(node) {
                self.failed = true;
                return Err(error);
            }
        }
        self.state.model_change = next;
        self.state.revision = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        Ok(())
    }
    fn refresh_model_node(&mut self, node: &str) -> Result<(), String> {
        let expected = self
            .graph
            .expected_latency(node)
            .ok_or("Missing node latency")?;
        let Some(Processor::Native(engine)) = self.graph.processor_mut(node) else {
            return Err("Missing native processor".into());
        };
        if engine.latency_samples().map_err(|e| e.to_string())? != expected {
            return Err(
                "Native model changed reported delay; fresh graph preparation required".into(),
            );
        }
        let controls = native_controls(node, engine)?;
        let eq = engine.eq_snapshot().map_err(|e| e.to_string())?;
        let slots = engine.slots().map_err(|e| e.to_string())?;
        let matches = |c: &Control| matches!(&c.target,Target::Native {node:n,..} if n==node);
        let start = self
            .state
            .controls
            .iter()
            .position(matches)
            .ok_or("Missing native controls")?;
        let end = self.state.controls.iter().rposition(matches).unwrap() + 1;
        self.state.controls.splice(start..end, controls);
        self.state
            .eq
            .iter_mut()
            .find(|e| e.node == node)
            .ok_or("Missing native EQ")?
            .blocks = eq;
        self.state
            .slots
            .iter_mut()
            .find(|s| s.node == node)
            .ok_or("Missing native slots")?
            .slots = slots;
        Ok(())
    }
    pub(super) fn advance_model(&mut self) -> Result<(), String> {
        if !self.model_pending() {
            return Ok(());
        }
        let node = self.model_node.clone().ok_or("Missing model owner")?;
        let root = self.model_root.clone().ok_or("Missing model asset store")?;
        let operation = if self
            .state
            .model_change
            .as_ref()
            .is_some_and(|m| m.progress.phase == ModelPhase::Ready)
        {
            ModelOperation::Commit
        } else {
            ModelOperation::Poll
        };
        let Some(Processor::Native(engine)) = self.graph.processor_mut(&node) else {
            return Err("Missing model processor".into());
        };
        let progress = self
            .model_task
            .operation(engine, &root, operation, self.state.revision)?;
        self.record_model(&node, progress)
    }
    /// Isolated preparation/export only. Discard this candidate after any failure.
    pub fn restore_with_models(&mut self, recall: &Recall, root: &Path) -> Result<(), String> {
        if self.model_pending() || !self.state.models.is_empty() {
            return Err("Model recall requires a fresh isolated candidate".into());
        }
        if recall.source_revision != self.source_revision() || !root.is_absolute() {
            return Err("Invalid model recall source".into());
        }
        let mut seen = BTreeSet::new();
        let store = oxidal_presets::ModelStore::new(root.join("audition-models"));
        for row in &recall.models {
            self.whole_model_node(&row.node)?;
            if !seen.insert(&row.node)
                || !valid_models(&row.assignments)
                || row.assignments.is_empty()
            {
                return Err("Invalid model recall catalog".into());
            }
            for assignment in &row.assignments {
                store.read(&assignment.asset).map_err(|e| e.to_string())?;
            }
        }
        let frames = self.graph.frames();
        for row in &recall.models {
            let Some(Processor::Native(engine)) = self.graph.processor_mut(&row.node) else {
                return Err("Missing model processor".into());
            };
            oxidal_tone3000::model_preparation::restore(engine, root, &row.assignments, frames)
                .map_err(|e| e.to_string())?;
            self.refresh_model_node(&row.node)?;
        }
        self.state.models = recall.models.clone();
        self.model_root = Some(root.into());
        let mut scalar = recall.clone();
        scalar.models.clear();
        self.restore(&scalar)
    }
}
