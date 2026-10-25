//! Owned control-plane previews. Native state capture belongs to the future audio adapter.
use crate::Control;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

pub const EDIT_LEASE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Begin {
        owner: String,
        token: String,
        target: String,
    },
    Preview {
        owner: String,
        token: String,
        sequence: u32,
        value: f64,
    },
    Commit {
        owner: String,
        token: String,
        sequence: u32,
        value: f64,
    },
    Cancel {
        owner: String,
        token: String,
    },
}
impl Edit {
    fn identity(&self) -> (&str, &str) {
        match self {
            Self::Begin { owner, token, .. }
            | Self::Preview { owner, token, .. }
            | Self::Commit { owner, token, .. }
            | Self::Cancel { owner, token } => (owner, token),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EditStatus {
    pub owner: String,
    pub target: String,
}
#[derive(Debug, Clone)]
pub(crate) struct ActiveEdit {
    owner: String,
    token: String,
    target: String,
    baseline: f64,
    sequence: u32,
    touched: Instant,
}
#[derive(Debug, Clone)]
pub(crate) struct Receipt {
    owner: String,
    token: String,
    committed: Option<(u32, f64)>,
}
impl Control {
    pub(crate) fn editing(&self, target: &str) -> bool {
        self.active_edit
            .as_ref()
            .is_some_and(|e| e.target == target)
    }
    fn finish_edit(&mut self, committed: Option<(u32, f64)>) {
        let edit = self.active_edit.take().expect("active owned edit");
        if self.edit_receipts.len() == 32 {
            self.edit_receipts.pop_front();
        }
        self.edit_receipts.push_back(Receipt {
            owner: edit.owner,
            token: edit.token,
            committed,
        });
        self.state.edit = None;
    }
    pub(crate) fn cancel_edit(&mut self) -> Result<(), String> {
        if let Some(edit) = &self.active_edit {
            let target = edit.target.clone();
            let baseline = edit.baseline;
            self.set(&target, baseline)?;
            self.reset_pickup(&target);
            self.finish_edit(None);
        }
        Ok(())
    }
    pub(crate) fn edit(&mut self, action: &Edit, now: Instant) -> Result<bool, String> {
        let (owner, token) = action.identity();
        if [owner, token].iter().any(|s| {
            s.is_empty()
                || s.len() > 80
                || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        }) {
            return Err("invalid_edit_identity".into());
        }
        if let Some(receipt) = self.edit_receipts.iter().find(|r| r.token == token) {
            if receipt.owner != owner {
                return Err("edit_owner_conflict".into());
            }
            return match action {
                // A late cancel must not undo a committed edit or affect a newer gesture.
                Edit::Cancel { .. } => Ok(false),
                Edit::Commit {
                    sequence, value, ..
                } if receipt.committed == Some((*sequence, *value)) => Ok(false),
                _ => Err("edit_finished".into()),
            };
        }
        if let Edit::Begin { target, .. } = action {
            if self.active_edit.is_some() {
                return Err("edit_busy".into());
            }
            let parameter = self.parameter(target)?;
            if !parameter.writable {
                return Err("read_only_target".into());
            }
            self.active_edit = Some(ActiveEdit {
                owner: owner.into(),
                token: token.into(),
                target: target.clone(),
                baseline: parameter.value,
                sequence: 0,
                touched: now,
            });
            self.state.edit = Some(EditStatus {
                owner: owner.into(),
                target: target.clone(),
            });
            return Ok(true);
        }
        let active = self.active_edit.as_ref().ok_or("edit_stale")?;
        if active.owner != owner || active.token != token {
            return Err("edit_owner_conflict".into());
        }
        if matches!(action, Edit::Cancel { .. }) {
            self.cancel_edit()?;
            return Ok(true);
        }
        let (sequence, value, commit) = match action {
            Edit::Preview {
                sequence, value, ..
            } => (*sequence, *value, false),
            Edit::Commit {
                sequence, value, ..
            } => (*sequence, *value, true),
            _ => unreachable!(),
        };
        if sequence <= active.sequence {
            return Err("edit_sequence_conflict".into());
        }
        let target = active.target.clone();
        self.set(&target, value)?;
        self.reset_pickup(&target);
        let active = self.active_edit.as_mut().expect("active edit");
        active.sequence = sequence;
        active.touched = now;
        if commit {
            self.finish_edit(Some((sequence, value)));
        }
        Ok(true)
    }
    /// Roll back abandoned previews using monotonic time; emit an ordinary state revision.
    /// Caller publishes the returned snapshot to all subscribers.
    pub fn expire_edit(&mut self, now: Instant) -> Option<crate::Snapshot> {
        let edit = self.active_edit.as_ref()?;
        if now.saturating_duration_since(edit.touched) < EDIT_LEASE {
            return None;
        }
        let mut next = self.clone();
        next.cancel_edit().ok()?;
        next.state.revision = next.state.revision.checked_add(1)?;
        next.state.origin = "edit_timeout".into();
        next.state.request_id = "edit_timeout".into();
        next.feedback();
        let state = next.snapshot();
        *self = next;
        Some(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Action, Command, MidiInput};
    fn run(c: &mut Control, action: Action) -> Result<crate::Snapshot, String> {
        c.apply(
            Command {
                protocol: 1,
                session: c.state.session.clone(),
                expected_revision: Some(c.state.revision),
                request_id: "test-edit".into(),
                action,
            },
            true,
        )
    }
    fn begin(c: &mut Control, token: &str) {
        run(
            c,
            Action::Edit {
                edit: Edit::Begin {
                    owner: "client-a".into(),
                    token: token.into(),
                    target: "nam-a.level".into(),
                },
            },
        )
        .unwrap();
    }
    fn change(
        c: &mut Control,
        token: &str,
        sequence: u32,
        value: f64,
        commit: bool,
    ) -> Result<crate::Snapshot, String> {
        let edit = if commit {
            Edit::Commit {
                owner: "client-a".into(),
                token: token.into(),
                sequence,
                value,
            }
        } else {
            Edit::Preview {
                owner: "client-a".into(),
                token: token.into(),
                sequence,
                value,
            }
        };
        run(c, Action::Edit { edit })
    }
    fn cancel(c: &mut Control, token: &str) -> Result<crate::Snapshot, String> {
        run(
            c,
            Action::Edit {
                edit: Edit::Cancel {
                    owner: "client-a".into(),
                    token: token.into(),
                },
            },
        )
    }
    #[test]
    fn ownership_sequences_and_exact_final_commit_are_authoritative() {
        let mut c = Control::default();
        begin(&mut c, "first");
        change(&mut c, "first", 2, 0.31, false).unwrap();
        let before = c.state.revision;
        assert_eq!(
            change(&mut c, "first", 1, 0.2, false).unwrap_err(),
            "edit_sequence_conflict"
        );
        assert_eq!(
            run(
                &mut c,
                Action::Set {
                    target: "nam-a.level".into(),
                    value: 0.9
                }
            )
            .unwrap_err(),
            "edit_busy"
        );
        assert_eq!(
            run(
                &mut c,
                Action::Edit {
                    edit: Edit::Cancel {
                        owner: "client-b".into(),
                        token: "first".into()
                    }
                }
            )
            .unwrap_err(),
            "edit_owner_conflict"
        );
        assert_eq!(c.state.revision, before);
        change(&mut c, "first", 3, 0.73, true).unwrap();
        let committed = c.state.revision;
        assert_eq!(c.state.parameters[0].value, 0.73);
        assert!(c.state.edit.is_none());
        change(&mut c, "first", 3, 0.73, true).unwrap();
        cancel(&mut c, "first").unwrap();
        assert_eq!(c.state.revision, committed);
        assert_eq!(c.state.parameters[0].value, 0.73);
        assert!(change(&mut c, "first", 4, 0.99, true).is_err());
        begin(&mut c, "second");
        cancel(&mut c, "first").unwrap();
        assert!(c.state.edit.is_some());
        cancel(&mut c, "second").unwrap();
    }
    #[test]
    fn cancel_and_expiry_restore_only_the_owned_target_and_feedback() {
        let mut c = Control::default();
        begin(&mut c, "first");
        change(&mut c, "first", 1, 0.9, false).unwrap();
        run(
            &mut c,
            Action::Set {
                target: "delay.mix".into(),
                value: 0.6,
            },
        )
        .unwrap();
        cancel(&mut c, "first").unwrap();
        assert_eq!(c.state.parameters[0].value, 0.5);
        assert_eq!(c.parameter("delay.mix").unwrap().value, 0.6);
        assert_eq!(c.state.feedback[0].value, 64);
        begin(&mut c, "second");
        change(&mut c, "second", 1, 0.9, false).unwrap();
        let touched = c.active_edit.as_ref().unwrap().touched;
        assert!(
            c.expire_edit(touched + EDIT_LEASE - Duration::from_millis(1))
                .is_none()
        );
        let expired = c.expire_edit(touched + EDIT_LEASE).unwrap();
        assert_eq!(expired.origin, "edit_timeout");
        assert_eq!(expired.parameters[0].value, 0.5);
        assert_eq!(expired.feedback[0].value, 64);
        assert!(change(&mut c, "second", 2, 0.7, true).is_err());
    }
    #[test]
    fn midi_and_rig_changes_supersede_previews_without_late_rollback() {
        let mut c = Control::default();
        begin(&mut c, "first");
        change(&mut c, "first", 1, 0.9, false).unwrap();
        run(
            &mut c,
            Action::Midi {
                input: MidiInput {
                    device: "simulator".into(),
                    channel: 1,
                    cc: 21,
                    value: 0,
                },
            },
        )
        .unwrap();
        cancel(&mut c, "first").unwrap();
        assert_eq!(c.state.parameters[0].value, 0.0);
        assert!(c.state.edit.is_none());
        begin(&mut c, "second");
        change(&mut c, "second", 1, 0.9, false).unwrap();
        run(
            &mut c,
            Action::Set {
                target: "rig.preset".into(),
                value: 1.0,
            },
        )
        .unwrap();
        assert!(change(&mut c, "second", 2, 0.7, true).is_err());
        assert_eq!(c.state.preset, "parallel");
        assert_eq!(c.state.parameters[0].value, 0.5);
        begin(&mut c, "third");
        change(&mut c, "third", 1, 0.9, false).unwrap();
        run(
            &mut c,
            Action::Routing {
                rig: oxidal_graph::Rig::example(false),
            },
        )
        .unwrap();
        cancel(&mut c, "third").unwrap();
        assert_eq!(c.state.parameters[0].value, 0.5);
        assert!(c.state.edit.is_none());
    }
    #[test]
    fn invalid_edits_do_not_mutate_or_drop_ownership_and_receipts_are_bounded() {
        let mut c = Control::default();
        begin(&mut c, "first");
        let before = c.state.revision;
        assert!(change(&mut c, "first", 1, f64::NAN, true).is_err());
        assert_eq!(c.state.revision, before);
        assert!(c.state.edit.is_some());
        cancel(&mut c, "first").unwrap();
        for i in 0..40 {
            let token = format!("token-{i}");
            begin(&mut c, &token);
            cancel(&mut c, &token).unwrap();
        }
        assert_eq!(c.edit_receipts.len(), 32);
    }
}
