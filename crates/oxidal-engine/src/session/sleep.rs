//! The owner publishes a scene only after the render thread confirms pre-roll.
use super::*;

#[derive(Debug)]
pub(super) enum Pending {
    Scene(SceneCommand),
    Branch(BranchCommand),
    Control(ControlCommand),
}

impl Pending {
    pub(super) fn requested_scene(&self) -> Option<String> {
        match self {
            Self::Scene(command) => Some(command.scene.clone()),
            _ => None,
        }
    }

    fn cursor(&mut self) -> &mut u64 {
        match self {
            Self::Scene(command) => &mut command.expected_revision,
            Self::Branch(command) => &mut command.expected_revision,
            Self::Control(command) => &mut command.expected_revision,
        }
    }
}

impl Session {
    pub fn cancel_protected_scene_preview(&mut self) -> Result<(), String> {
        if matches!(&self.sleep_pending, Some(Pending::Scene(command)) if command.native_bypass_preview.is_some())
        {
            let revision = self
                .state
                .revision
                .checked_add(1)
                .ok_or("Rig revision exhausted")?;
            self.graph.cancel_sleep_prime();
            self.sleep_pending = None;
            self.sleep_message = Some("Protect cancelled the pending scene preview".into());
            self.state.revision = revision;
        }
        Ok(())
    }

    pub(super) fn queue_sleep_change(
        &mut self,
        gains: &[oxidal_presets::manifest::SceneGain],
        mut request: Pending,
    ) -> Result<bool, String> {
        if self.graph.sleep_enabled().is_none() {
            return Ok(false);
        }
        let next = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        let priming = self.graph.sleep_prime(gains)?;
        self.sleep_message = None;
        self.sleep_pending = None;
        if priming {
            self.state.revision = next;
            *request.cursor() = next;
            self.sleep_pending = Some(request);
        }
        Ok(priming)
    }

    pub(super) fn finish_sleep_change(&mut self) -> Result<(), String> {
        if !self.graph.sleep_prime_ready() {
            return Ok(());
        }
        let Some(request) = self.sleep_pending.take() else {
            return Ok(());
        };
        let result = match request {
            Pending::Scene(command) => self.select_scene(command),
            Pending::Branch(command) => self.set_branch(command),
            Pending::Control(command) => self.apply(command),
        };
        if let Err(error) = result {
            self.graph.cancel_sleep_prime();
            if self.failed {
                return Err(error);
            }
            self.sleep_message = Some(
                if error.len() <= 1024 && !error.chars().any(char::is_control) {
                    error
                } else {
                    "Sleeping scene could not be activated".into()
                },
            );
            self.state.revision = self
                .state
                .revision
                .checked_add(1)
                .ok_or("Rig revision exhausted")?;
        }
        Ok(())
    }

    pub fn set_branch_sleep(&mut self, command: BranchSleepCommand) -> Result<(), String> {
        if self.failed || self.model_pending() {
            return Err("Rig is not ready to change sleeping branches".into());
        }
        if !self.matches_cursor(&command.session, command.expected_revision) {
            return Err("rig_control_conflict; refresh status".into());
        }
        let fade_ms = self
            .state
            .scenes
            .as_ref()
            .ok_or("Rig has no scenes")?
            .fade_ms;
        let next = self
            .state
            .revision
            .checked_add(1)
            .ok_or("Rig revision exhausted")?;
        self.graph
            .set_sleep_enabled(command.enabled, self.fade_frames(fade_ms))?;
        self.sleep_pending = None;
        self.sleep_message = None;
        self.state.revision = next;
        Ok(())
    }
}
