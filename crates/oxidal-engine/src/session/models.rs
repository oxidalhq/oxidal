//! Verified native model transactions; extracted roles permit replacement only.
use super::*;
use oxidal_audio::lifecycle::{ModelOperation, ModelPhase, ModelProgress, valid_models};
use std::path::Path;

impl Session {
    pub fn model_pending(&self) -> bool {
        self.model_task.pending()
    }
    fn editable_model_node(&self, node: &str) -> Result<(), String> {
        if self.measurement_pending() || self.gesture_pending() {
            return Err("Cancel measurement before loading models".into());
        }
        if self.failed || !self.state.slots.iter().any(|s| s.node == node) {
            return Err("Model editing requires a native node".into());
        }
        Ok(())
    }
    fn validate_model_assignment(
        &self,
        node_id: &str,
        assignment: &oxidal_audio::lifecycle::ModelAssignment,
    ) -> Result<(), String> {
        if let Some(instance) = self
            .bundle
            .manifest()
            .tone3000
            .instances
            .iter()
            .find(|instance| {
                self.bundle
                    .manifest()
                    .oxidal
                    .as_ref()
                    .unwrap()
                    .graph
                    .nodes
                    .iter()
                    .any(|node| node.id == node_id && node.instance.as_ref() == Some(&instance.id))
            })
            && let Some(recipe) = &instance.partition
        {
            let target = match instance.role() {
                oxidal_presets::manifest::ProcessingRole::Amp => &recipe.amp,
                oxidal_presets::manifest::ProcessingRole::Cab => &recipe.cab,
                _ => return Err("Invalid model processing role".into()),
            };
            if assignment.target != *target || assignment.insertion.is_some() {
                return Err("Extracted stages support only their existing model".into());
            }
        }
        Ok(())
    }
    pub fn model_command(&mut self, mut command: ModelCommand, root: &Path) -> Result<(), String> {
        self.editable_model_node(&command.node)?;
        if !self.matches_cursor(&command.session, command.expected_revision) || !root.is_absolute()
        {
            return Err("Model session conflict or invalid asset store".into());
        }
        if let ModelOperation::Prepare { assignment } = &mut command.operation {
            self.validate_model_assignment(&command.node, assignment)?;
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
    fn record_model(
        &mut self,
        node: &str,
        mut progress: Option<ModelProgress>,
    ) -> Result<(), String> {
        if let Some(before) = self.model_task.take_applied_history() {
            let root = self
                .model_root
                .as_ref()
                .ok_or("Missing model history store")?
                .clone();
            let source = super::authoring::origin(self.source_revision(), node);
            let receipt = self
                .state
                .working
                .iter()
                .find(|r| r.node == node)
                .map(|r| r.receipt.clone());
            let Some(Processor::Native(engine)) = self.graph.processor_mut(node) else {
                return Err("Missing model history processor".into());
            };
            let owner = self
                .authoring_histories
                .entry(node.into())
                .or_insert_with(|| {
                    oxidal_tone3000::working::Authoring::for_source(&root, source, receipt)
                });
            match owner.record_external(engine, before) {
                Ok(status) => {
                    let receipt = status.working.ok_or("Missing model history receipt")?;
                    if let Some(row) = self.state.working.iter_mut().find(|r| r.node == node) {
                        row.receipt = receipt;
                    } else {
                        self.state.working.push(NodeWorking {
                            node: node.into(),
                            receipt,
                        });
                    }
                }
                Err(error) => {
                    if owner.failed() {
                        self.failed = true;
                        return Err(error);
                    }
                    progress = self.model_task.reject_history(error);
                }
            }
        }
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
    pub(super) fn refresh_model_node(&mut self, node: &str) -> Result<(), String> {
        let source = super::authoring::origin(self.source_revision(), node);
        let receipt = self
            .state
            .working
            .iter()
            .find(|r| r.node == node)
            .map(|r| r.receipt.clone());
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
        let status = if engine.processing_role() == oxidal_tone3000::ProcessingRole::WholePreset {
            let fallback =
                oxidal_tone3000::working::Authoring::for_source(Path::new("."), source, receipt);
            Some(
                self.authoring_histories
                    .get(node)
                    .unwrap_or(&fallback)
                    .snapshot(engine)?,
            )
        } else {
            None
        };
        let controls = native_controls(node, engine)?;
        let eq = engine.eq_snapshot().map_err(|e| e.to_string())?;
        let slots = if engine.processing_role() == oxidal_tone3000::ProcessingRole::WholePreset {
            engine.slots().map_err(|e| e.to_string())?
        } else {
            vec![]
        };
        let matches = |c: &Control| matches!(&c.target,Target::Native {node:n,..} if n==node);
        let start = self
            .state
            .controls
            .iter()
            .position(matches)
            .ok_or("Missing native controls")?;
        let end = self.state.controls.iter().rposition(matches).unwrap() + 1;
        self.state.controls.splice(start..end, controls);
        if let Some(status) = status
            && let Some(row) = self.state.authoring.iter_mut().find(|r| r.node == node)
        {
            row.status = status;
        }
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
            self.editable_model_node(&row.node)?;
            if !seen.insert(&row.node)
                || !valid_models(&row.assignments)
                || row.assignments.is_empty()
            {
                return Err("Invalid model recall catalog".into());
            }
            for assignment in &row.assignments {
                self.validate_model_assignment(&row.node, assignment)?;
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
