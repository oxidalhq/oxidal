//! Whole-native node authoring; host topology and guarded extracted roles stay separate.
use super::*;
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
        let result = owner.command(engine, command.action);
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
        if serde_json::to_vec(&self.snapshot())
            .map_err(|e| e.to_string())?
            .len()
            + 65536
            > REPLY_LIMIT
        {
            self.failed = true;
            return Err("Authored native state exceeds IPC budget".into());
        }
        Ok(())
    }
}

impl Session {
    /// Isolated preparation only; callers must rebuild before processing PCM.
    pub(crate) fn prepare_native_setting(
        &mut self,
        node: &str,
        parameter: String,
        value: f32,
        root: &Path,
    ) -> Result<(), String> {
        let source = origin(self.source_revision(), node);
        let receipt = self
            .state
            .working
            .iter()
            .find(|r| r.node == node)
            .map(|r| r.receipt.clone());
        let Some(Processor::Native(engine)) = self.graph.processor_mut(node) else {
            return Err("Native node required".into());
        };
        if engine.processing_role() != oxidal_tone3000::ProcessingRole::WholePreset {
            return Err("Whole-native node required".into());
        }
        let mut owner = oxidal_tone3000::working::Authoring::for_source(root, source, receipt);
        let status = owner.prepare_parameter(engine, parameter, value)?;
        let receipt = status.working.ok_or("Missing prepared working receipt")?;
        self.state.working.retain(|r| r.node != node);
        self.state.working.push(NodeWorking {
            node: node.into(),
            receipt,
        });
        self.state.models.retain(|r| r.node != node);
        Ok(())
    }
}
