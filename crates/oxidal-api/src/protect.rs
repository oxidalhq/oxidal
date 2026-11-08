//! Protect: one device-wide performance lock, stored by the daemon so it holds
//! across browsers, navigation and restart until explicitly turned off. It is
//! checked at the command boundary for HTTP and MIDI, not only in the UI.
//! @see docs/interface.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::{
    lifecycle::{AudioAction, AudioPhase},
    tools::HostUtility,
};
use oxidal_engine::protocol::{RigAudioAction, Target};
use oxidal_lv2::protocol::GraphAudioAction;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProtectState {
    pub on: bool,
}

#[derive(Debug)]
pub struct Protect {
    path: PathBuf,
    on: AtomicBool,
}

const LOCKED: &str = "Protect is on. Turn Protect off to change this.";
pub(crate) type Update = (bool, tokio::sync::oneshot::Sender<Result<(), String>>);

impl Protect {
    /// A missing or unreadable file means off; a damaged file never locks a
    /// player out of their own device.
    pub fn new(path: PathBuf) -> Self {
        let on = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ProtectState>(&bytes).ok())
            .is_some_and(|state| state.on);
        Self {
            path,
            on: AtomicBool::new(on),
        }
    }
    pub fn on(&self) -> bool {
        self.on.load(Ordering::SeqCst)
    }
    pub fn state(&self) -> ProtectState {
        ProtectState { on: self.on() }
    }
    /// Writes atomically before changing the live flag.
    pub fn set(&self, on: bool) -> Result<ProtectState, String> {
        let next = ProtectState { on };
        let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("json.next");
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        self.on.store(on, Ordering::SeqCst);
        Ok(next)
    }
    /// Why a request must be refused now, if it must.
    pub fn refuse(&self, allowed: bool) -> Option<&'static str> {
        (self.on() && !allowed).then_some(LOCKED)
    }
}

/// Output mute and listening aids stay available; test tones, level changes
/// and reference changes do not.
fn utility(command: &HostUtility) -> bool {
    matches!(
        command,
        HostUtility::OutputMute { .. }
            | HostUtility::OutputMuteToggle
            | HostUtility::HearYourself { .. }
    )
}

fn tuner(action: &oxidal_audio::structure::AuthoringAction) -> bool {
    matches!(
        action,
        oxidal_audio::structure::AuthoringAction::Utility {
            command: oxidal_audio::tools::Command::Tuner { .. }
        }
    )
}

/// Prepared recall, scene and branch mixes, stomp bypass, mute and recovery of
/// failed audio are performance actions; everything else changes the rig.
pub fn rig(action: &RigAudioAction, phase: AudioPhase) -> bool {
    match action {
        RigAudioAction::Authoring { command } => tuner(&command.action),
        RigAudioAction::HostUtility { command } => utility(command),
        RigAudioAction::Switch { .. }
        | RigAudioAction::Scene { .. }
        | RigAudioAction::Branch { .. }
        | RigAudioAction::Save { .. } => true,
        RigAudioAction::Control { command } => matches!(command.target, Target::Bypass { .. }),
        RigAudioAction::Restart => phase == AudioPhase::Failed,
        _ => false,
    }
}
pub fn native(action: &AudioAction, phase: AudioPhase) -> bool {
    match action {
        AudioAction::Authoring { action } => tuner(action),
        AudioAction::HostUtility { command } => utility(command),
        AudioAction::CancelModel { .. }
        | AudioAction::SaveCopy { .. }
        | AudioAction::ResolveCopy { .. } => true,
        AudioAction::Restart | AudioAction::Resume => phase == AudioPhase::Failed,
        _ => false,
    }
}
pub fn graph(action: &GraphAudioAction, phase: AudioPhase) -> bool {
    match action {
        GraphAudioAction::HostUtility { command } => utility(command),
        GraphAudioAction::SaveCopy { .. } => true,
        GraphAudioAction::Restart => phase == AudioPhase::Failed,
        _ => false,
    }
}

/// The response for a refused request: 423 Locked with a plain reason.
pub fn locked(reason: &str) -> Response {
    failure(StatusCode::LOCKED, reason)
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    Json(shared.protect.state()).into_response()
}
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<ProtectState>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid Protect request");
    };
    // Finish even if the browser loses its reply. Exclusive access drains existing
    // owner commands and prevents a start/configuration race with worker acknowledgement.
    let result = tokio::spawn(async move {
        let _access = shared.library_access.clone().write_owned().await;
        if [
            shared.playback.snapshot().phase,
            shared.rig_playback.snapshot().phase,
        ]
        .contains(&AudioPhase::Starting)
        {
            return Err("Wait for audio preparation before changing Protect".to_owned());
        }
        let previous = shared.protect.on();
        if request.on {
            // Lock the daemon before workers; an acknowledgement failure stays locked.
            shared.protect.set(true)?;
        }
        let acknowledged = async {
            shared.playback.set_protect(request.on).await?;
            shared.rig_playback.set_protect(request.on).await
        }
        .await;
        if let Err(error) = acknowledged {
            if !request.on {
                let _ = shared.playback.set_protect(previous).await;
                let _ = shared.rig_playback.set_protect(previous).await;
            }
            return Err(error);
        }
        if !request.on
            && let Err(error) = shared.protect.set(false)
        {
            // A failed unlock must restore the still-persisted lock at MIDI ingress.
            let _ = shared.playback.set_protect(previous).await;
            let _ = shared.rig_playback.set_protect(previous).await;
            return Err(error);
        }
        Ok(shared.protect.state())
    })
    .await
    .unwrap_or_else(|_| Err("Protect update interrupted; refresh its state".into()));
    match result {
        Ok(state) => Json(state).into_response(),
        Err(e) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Protect could not be saved: {e}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxidal_engine::protocol::{ControlCommand, SwitchCommand};

    fn path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("oxidal-protect-{}-{name}.json", std::process::id()))
    }

    #[test]
    fn tuner_start_and_stop_are_allowed_but_other_authoring_utilities_stay_locked() {
        use oxidal_audio::{structure::AuthoringAction, tools::Command};
        use oxidal_engine::protocol::AuthoringCommand;
        for command in [
            Command::Tuner { enabled: true },
            Command::Tuner { enabled: false },
            Command::Balance,
            Command::Align,
            Command::Solo {
                side: oxidal_audio::tools::Solo::Left,
            },
        ] {
            let allowed = matches!(command, Command::Tuner { .. });
            let action = AuthoringAction::Utility { command };
            assert_eq!(
                native(
                    &AudioAction::Authoring {
                        action: action.clone()
                    },
                    AudioPhase::Running
                ),
                allowed
            );
            assert_eq!(
                rig(
                    &RigAudioAction::Authoring {
                        command: AuthoringCommand {
                            session: "live".into(),
                            expected_revision: 2,
                            node: "amp".into(),
                            action,
                        }
                    },
                    AudioPhase::Running
                ),
                allowed
            );
        }
    }
    #[test]
    fn protect_persists_across_restart_and_damaged_files_unlock() {
        let file = path("persist");
        let _ = std::fs::remove_file(&file);
        let protect = Protect::new(file.clone());
        assert!(!protect.on());
        protect.set(true).unwrap();
        assert!(Protect::new(file.clone()).on());
        std::fs::write(&file, b"{broken").unwrap();
        assert!(!Protect::new(file.clone()).on());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn performance_actions_pass_and_edits_are_refused() {
        let switch = RigAudioAction::Switch {
            command: SwitchCommand {
                session: "s".into(),
                expected_revision: 1,
                revision: "r".into(),
                fade_frames: 480,
            },
        };
        assert!(rig(&switch, AudioPhase::Running));
        let bypass = RigAudioAction::Control {
            command: ControlCommand {
                session: "s".into(),
                expected_revision: 1,
                target: Target::Bypass { node: "n".into() },
                value: 1.0,
            },
        };
        assert!(rig(&bypass, AudioPhase::Running));
        assert!(!rig(&RigAudioAction::Stop, AudioPhase::Running));
        assert!(!rig(&RigAudioAction::Restart, AudioPhase::Running));
        assert!(rig(&RigAudioAction::Restart, AudioPhase::Failed));
        assert!(rig(
            &RigAudioAction::HostUtility {
                command: HostUtility::OutputMute { enabled: true }
            },
            AudioPhase::Running
        ));
        assert!(!rig(
            &RigAudioAction::HostUtility {
                command: HostUtility::TestTone
            },
            AudioPhase::Running
        ));
        assert!(!native(&AudioAction::Stop, AudioPhase::Running));
        assert!(native(&AudioAction::Resume, AudioPhase::Failed));
        assert!(!graph(&GraphAudioAction::Stop, AudioPhase::Running));
        let protect = Protect::new(path("refuse"));
        assert_eq!(protect.refuse(false), None);
        protect.set(true).unwrap();
        assert_eq!(protect.refuse(true), None);
        assert_eq!(protect.refuse(false), Some(LOCKED));
        let _ = std::fs::remove_file(path("refuse"));
    }
}
