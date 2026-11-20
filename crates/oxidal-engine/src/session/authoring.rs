//! Whole-native node authoring; host topology and guarded extracted roles stay separate.
use super::*;
use oxidal_audio::structure::{AuthoringAction, StructureEdit};
use std::path::Path;
pub(crate) fn origin(revision: &str, node: &str) -> String {
    format!("mixed:{revision}:{node}")
}
impl Session {
    pub(crate) fn gesture_pending(&self) -> bool {
        self.authoring_histories
            .values()
            .any(|owner| owner.gesture_pending())
    }
    pub(crate) fn measurement_pending(&self) -> bool {
        self.authoring_histories
            .values()
            .any(|owner| owner.measurement_pending())
    }
    pub fn settle_authoring(&mut self) -> Result<bool, String> {
        let mut settled = true;
        let mut changed = false;
        for (node, history) in &mut self.authoring_histories {
            settled &= history.history_settled()?;
            let Some(receipt) = history.working_receipt() else {
                continue;
            };
            let working = self
                .state
                .working
                .iter_mut()
                .find(|entry| entry.node == *node);
            match working {
                Some(entry) if entry.receipt == receipt => continue,
                Some(entry) => entry.receipt = receipt.to_owned(),
                None => self.state.working.push(NodeWorking {
                    node: node.clone(),
                    receipt: receipt.to_owned(),
                }),
            }
            if let Some(authoring) = self
                .state
                .authoring
                .iter_mut()
                .find(|entry| entry.node == *node)
            {
                authoring.status.working = Some(receipt.to_owned());
            }
            self.state.models.retain(|entry| entry.node != *node);
            changed = true;
        }
        if changed {
            self.state.revision = self
                .state
                .revision
                .checked_add(1)
                .ok_or("Rig revision exhausted")?;
            if !self.reply_fits()? {
                return Err("Authored native state exceeds IPC budget".into());
            }
        }
        Ok(settled)
    }

    pub fn authoring_command(
        &mut self,
        command: AuthoringCommand,
        root: &Path,
    ) -> Result<(), String> {
        if self.failed
            || self.model_pending()
            || !self.matches_cursor(&command.session, command.expected_revision)
            || !root.is_absolute()
        {
            return Err("Native authoring state conflict or model pending".into());
        }
        if self.has_armed_native_node(&command.node)
            && matches!(
                &command.action,
                AuthoringAction::Edit { .. }
                    | AuthoringAction::Remove { .. }
                    | AuthoringAction::SelectModel { .. }
                    | AuthoringAction::Undo
                    | AuthoringAction::Redo
                    | AuthoringAction::Parameter { .. }
            )
        {
            return Err("This native edit requires a rebuilt warm scene candidate".into());
        }
        let orphaned = match &command.action {
            AuthoringAction::Remove { block_id } => {
                self.protects_capture_target(&command.node, Some(block_id))
            }
            AuthoringAction::Edit {
                edit: StructureEdit::Reset,
            } => self.protects_capture_target(&command.node, None),
            _ => false,
        };
        if orphaned {
            return Err("Edit would remove a capture scene control".into());
        }
        let source = origin(self.source_revision(), &command.node);
        let receipt = self
            .state
            .working
            .iter()
            .find(|r| r.node == command.node)
            .map(|r| r.receipt.clone());
        let before_working = receipt.clone();
        let Some(Processor::Native(engine)) = self.graph.processor_mut(&command.node) else {
            return Err("Native authoring requires a native node".into());
        };
        if engine.processing_role() != oxidal_tone3000::ProcessingRole::WholePreset {
            return Err("Extracted stages retain their guarded editing contract".into());
        }
        let owner = self
            .authoring_histories
            .entry(command.node.clone())
            .or_insert_with(|| {
                oxidal_tone3000::working::Authoring::for_source(root, source, receipt)
            });
        let tuner_command = match &command.action {
            oxidal_audio::structure::AuthoringAction::Utility {
                command:
                    utility @ (oxidal_audio::tools::Command::Tuner { .. }
                    | oxidal_audio::tools::Command::Poll),
            } => Some(*utility),
            _ => None,
        };
        if let Some(utility) = tuner_command
            && let Some(tools) = owner.lightweight_tuner_command(engine, utility)?
        {
            let row = self
                .state
                .authoring
                .iter_mut()
                .find(|row| row.node == command.node)
                .ok_or("Missing native authoring status")?;
            row.status.tools = tools;
            return Ok(());
        }
        let mutating = command.action.changes_tone();
        let utility_poll = matches!(
            command.action,
            oxidal_audio::structure::AuthoringAction::Utility {
                command: oxidal_audio::tools::Command::Poll
            }
        );
        let required_controls = self.state.scenes.as_ref().map_or_else(Vec::new, |scenes| {
            scenes.scenes[0]
                .native_controls
                .iter()
                .filter(|c| c.node == command.node)
                .map(|c| c.parameter.as_str())
                .collect()
        });
        let result = owner.command_retaining(engine, command.action, &required_controls);
        if owner.failed() {
            self.failed = true;
        }
        let status = result?;
        let mutating = mutating || status.working != before_working;
        if mutating {
            let receipt = status
                .working
                .clone()
                .ok_or("Missing authored native working state")?;
            if let Some(row) = self
                .state
                .working
                .iter_mut()
                .find(|r| r.node == command.node)
            {
                row.receipt = receipt;
            } else {
                self.state.working.push(NodeWorking {
                    node: command.node.clone(),
                    receipt,
                });
            }
            self.state.models.retain(|row| row.node != command.node);
            self.state.model_change = None;
        }
        if let Err(error) = self.refresh_model_node(&command.node) {
            self.failed = true;
            return Err(error);
        }
        if let Some(row) = self
            .state
            .authoring
            .iter_mut()
            .find(|r| r.node == command.node)
        {
            row.status = status;
        }
        if !utility_poll || mutating {
            self.state.revision = self
                .state
                .revision
                .checked_add(1)
                .ok_or("Rig revision exhausted")?;
        }
        if !self.reply_fits()? {
            self.failed = true;
            return Err("Authored native state exceeds IPC budget".into());
        }
        Ok(())
    }
}

impl Session {
    /// Apply an edit to an independent native engine. The receipt is not
    /// eligible for PCM until a fresh resident set can re-arm its exact scene
    /// targets and verify routing, recovery and the combined memory budget.
    pub(crate) fn prepare_native_edit(
        &mut self,
        node: &str,
        operation: PreparedNativeEdit,
        root: &Path,
    ) -> Result<Recall, String> {
        if matches!(&operation, PreparedNativeEdit::Authoring { action } if !matches!(
            action,
            AuthoringAction::Parameter { .. }
                | AuthoringAction::Edit { .. }
                | AuthoringAction::Remove { .. }
                | AuthoringAction::SelectModel { .. }
                | AuthoringAction::Undo
                | AuthoringAction::Redo
        )) {
            return Err("Unsupported prepared native edit".into());
        }

        let source = origin(self.source_revision(), node);
        let mut recall = self.snapshot().recall();
        let receipt = recall
            .working
            .iter()
            .find(|r| r.node == node)
            .map(|r| r.receipt.clone());
        let frames = self.graph.frames();
        let operation = match operation {
            PreparedNativeEdit::Model { mut assignment } => {
                super::models::validate_model_assignment(&self.bundle, node, &assignment)?;
                let coordinate = recall
                    .models
                    .iter()
                    .find(|m| m.node == node)
                    .and_then(|m| m.assignments.iter().find(|a| a.target == assignment.target))
                    .and_then(|a| a.insertion.clone())
                    .or_else(|| {
                        self.state
                            .slots
                            .iter()
                            .find(|s| s.node == node)
                            .and_then(|s| s.slots.iter().find(|s| s.target == assignment.target))
                            .map(|s| s.position.clone())
                    });
                if assignment
                    .insertion
                    .as_ref()
                    .is_some_and(|value| Some(value) != coordinate.as_ref())
                {
                    return Err("Model insertion coordinate differs from its owner".into());
                }
                assignment.insertion = coordinate;
                PreparedNativeEdit::Model { assignment }
            }
            other => other,
        };
        let Some(Processor::Native(engine)) = self.graph.processor_mut(node) else {
            return Err("Native node required".into());
        };
        let whole = engine.processing_role() == oxidal_tone3000::ProcessingRole::WholePreset;
        if !whole && matches!(operation, PreparedNativeEdit::Authoring { .. }) {
            return Err("Whole-native node required".into());
        }

        let mut candidate = engine.copy_for_edit().map_err(|e| e.to_string())?;
        let mut owner = oxidal_tone3000::working::Authoring::for_source(root, source, receipt);
        let status = match operation {
            PreparedNativeEdit::Authoring {
                action: AuthoringAction::Parameter { parameter, value },
            } => Some(owner.prepare_parameter(&mut candidate, parameter, value)?),
            PreparedNativeEdit::Authoring { action } => {
                let required = self.state.scenes.as_ref().map_or_else(Vec::new, |scenes| {
                    let first = &scenes.scenes[0];
                    first
                        .native_controls
                        .iter()
                        .filter(|row| row.node == node)
                        .map(|row| row.parameter.clone())
                        .chain(
                            first
                                .native_bypass
                                .iter()
                                .filter(|row| row.node == node)
                                .map(|row| format!("block:{}:enabled", row.block)),
                        )
                        .collect()
                });
                let required: Vec<_> = required.iter().map(String::as_str).collect();
                Some(owner.command_retaining(&mut candidate, action, &required)?)
            }
            PreparedNativeEdit::Model { assignment } => {
                if !assignment.valid() {
                    return Err("Invalid prepared model assignment".into());
                }
                let before = candidate.capture().map_err(|e| e.to_string())?;
                oxidal_tone3000::model_preparation::restore(
                    &mut candidate,
                    root,
                    std::slice::from_ref(&assignment),
                    frames,
                )
                .map_err(|e| e.to_string())?;
                if whole {
                    Some(owner.record_external(&mut candidate, before)?)
                } else {
                    recall.models.retain(|r| r.node != node);
                    recall.models.push(NodeModels {
                        node: node.into(),
                        assignments: vec![assignment],
                    });
                    None
                }
            }
        };
        if let Some(status) = status {
            let receipt = status.working.ok_or("Missing prepared working receipt")?;
            recall.working.retain(|r| r.node != node);
            recall.working.push(NodeWorking {
                node: node.into(),
                receipt,
            });
            recall.models.retain(|r| r.node != node);
        }
        recall
            .values
            .retain(|row| !matches!(&row.target, Target::Native { node: id, .. } if id == node));
        recall.values.extend(
            native_controls(node, &mut candidate)?
                .into_iter()
                .map(|control| Value {
                    target: control.target,
                    value: control.value,
                }),
        );
        if let Some(eq) = &mut recall.eq {
            let row = eq
                .iter_mut()
                .find(|r| r.node == node)
                .ok_or("Missing prepared native EQ row")?;
            row.blocks = candidate.eq_snapshot().map_err(|e| e.to_string())?;
        }
        Ok(recall)
    }
}
