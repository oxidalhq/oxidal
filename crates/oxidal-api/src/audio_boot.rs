//! One durable boot choice for all audio owners; confirmed recovery is separate.
use crate::{playback_recovery, rig_recovery};
use oxidal_audio::eq::BlockEqState;
use oxidal_audio::lifecycle::{LiveControl, ModelAssignment, StartAudio};
use oxidal_engine::protocol::{REQUEST_LIMIT, StartRig};
use oxidal_lv2::protocol::StartGraph;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Role {
    Native,
    Mixed,
    Effects,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Choice {
    Native {
        settings: StartAudio,
        controls: Option<Vec<LiveControl>>,
        models: Vec<ModelAssignment>,
        #[serde(default)]
        eq: Option<Vec<BlockEqState>>,
    },
    Mixed {
        settings: StartRig,
    },
    Effects {
        settings: StartGraph,
    },
}
impl Choice {
    fn role(&self) -> Role {
        match self {
            Self::Native { .. } => Role::Native,
            Self::Mixed { .. } => Role::Mixed,
            Self::Effects { .. } => Role::Effects,
        }
    }
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Native {
                settings,
                controls,
                models,
                eq,
            } => {
                if settings.draft {
                    return Err("Save and recall the new rig before enabling boot playback".into());
                }
                playback_recovery::Recovery::new(
                    settings.clone(),
                    controls.clone(),
                    models.clone(),
                    eq.clone(),
                )
                .validate()
            }
            Self::Mixed { settings } => rig_recovery::Recovery::new(settings.clone()).validate(),
            Self::Effects { settings } => {
                settings.validate()?;
                settings
                    .recall
                    .as_ref()
                    .ok_or("No confirmed effects session")?
                    .validate()
            }
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u32,
    choice: Choice,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Legacy {
    schema: u32,
    settings: StartAudio,
}
fn read(path: &Path) -> Result<Option<Choice>, String> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read boot audio configuration: {e}")),
    };
    let mut bytes = Vec::new();
    file.take((REQUEST_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() >= REQUEST_LIMIT {
        return Err("Boot audio configuration exceeds byte limit".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid boot audio configuration: {e}"))?;
    let choice = match value.get("schema").and_then(|v| v.as_u64()) {
        Some(1) => {
            let legacy: Legacy = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            debug_assert_eq!(legacy.schema, 1);
            Choice::Native {
                settings: legacy.settings,
                controls: None,
                eq: None,
                models: vec![],
            }
        }
        Some(2) => {
            serde_json::from_slice::<Record>(&bytes)
                .map_err(|e| e.to_string())?
                .choice
        }
        _ => return Err("Unsupported boot audio configuration".into()),
    };
    choice.validate()?;
    Ok(Some(choice))
}
fn follow_path(path: &Path) -> PathBuf {
    path.with_file_name("boot-follow.json")
}
fn write(path: &Path, choice: Option<&Choice>) -> Result<(), String> {
    // Validate before creating files or replacing the preceding boot choice.
    let bytes = choice
        .map(|choice| -> Result<Vec<u8>, String> {
            choice.validate()?;
            let bytes = serde_json::to_vec(&Record {
                schema: 2,
                choice: choice.clone(),
            })
            .map_err(|e| e.to_string())?;
            if bytes.len() >= REQUEST_LIMIT {
                return Err("Boot audio configuration exceeds byte limit".into());
            }
            Ok(bytes)
        })
        .transpose()?;
    let parent = path
        .parent()
        .ok_or("Boot audio configuration has no directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if let Some(bytes) = bytes {
        let temporary = path.with_extension("tmp");
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    std::fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}

/// What starts when Oxidal starts (7.25). `Pinned` keeps the exact saved
/// session; `Follow` replaces it with each preset the player explicitly plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StartupPolicy {
    Off,
    Follow,
    Pinned,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartupState {
    pub policy: StartupPolicy,
    /// The library entry that will start, when one is chosen.
    pub target: Option<oxidal_presets::LibraryReference>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartupUpdate {
    pub follow: bool,
}

#[derive(Debug)]
pub(super) struct Policy {
    path: PathBuf,
    choice: Mutex<Result<Option<Choice>, String>>,
    follow: std::sync::atomic::AtomicBool,
}
impl Policy {
    pub fn new(path: PathBuf) -> Self {
        let choice = Mutex::new(read(&path));
        let follow = std::fs::read(follow_path(&path))
            .ok()
            .and_then(|b| serde_json::from_slice::<StartupUpdate>(&b).ok())
            .is_some_and(|f| f.follow);
        Self {
            path,
            choice,
            follow: follow.into(),
        }
    }
    pub fn follows(&self) -> bool {
        self.follow.load(std::sync::atomic::Ordering::SeqCst)
    }
    /// Follow is stored beside the boot choice; it only matters while one is set.
    pub fn set_follow(&self, follow: bool) -> Result<(), String> {
        let path = follow_path(&self.path);
        let bytes = serde_json::to_vec(&StartupUpdate { follow }).map_err(|e| e.to_string())?;
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        self.follow
            .store(follow, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
    /// After an explicit, confirmed recall: Follow points startup at it.
    /// Never enables startup by itself and never picks a different sound.
    pub fn follow(&self, choice: Choice) -> Result<(), String> {
        if !self.follows() || !matches!(self.snapshot(), Ok(Some(_))) {
            return Ok(());
        }
        self.set(choice)
    }
    pub fn startup(&self) -> StartupState {
        let snapshot = self.snapshot();
        let target = match &snapshot {
            Ok(Some(Choice::Mixed { settings })) => Some(oxidal_presets::LibraryReference {
                kind: oxidal_presets::LibraryKind::Rig,
                id: settings.revision.clone(),
            }),
            Ok(Some(Choice::Native { settings, .. })) if !settings.draft => {
                Some(oxidal_presets::LibraryReference {
                    kind: if settings.owned {
                        oxidal_presets::LibraryKind::Owned
                    } else {
                        oxidal_presets::LibraryKind::Original
                    },
                    id: settings.preset_id.clone(),
                })
            }
            Ok(Some(Choice::Effects { settings })) => {
                settings
                    .library_id
                    .clone()
                    .map(|id| oxidal_presets::LibraryReference {
                        kind: oxidal_presets::LibraryKind::Graph,
                        id,
                    })
            }
            _ => None,
        };
        StartupState {
            policy: match &snapshot {
                Ok(Some(_)) if self.follows() => StartupPolicy::Follow,
                Ok(Some(_)) => StartupPolicy::Pinned,
                _ => StartupPolicy::Off,
            },
            target,
            error: snapshot.err(),
        }
    }
    /// Refresh memory after an exclusive library transaction removed its boot record.
    pub fn reload(&self) -> Result<(), String> {
        let mut choice = self.choice.lock().map_err(|_| "Boot policy unavailable")?;
        *choice = read(&self.path);
        choice.as_ref().map(|_| ()).map_err(Clone::clone)
    }
    pub fn snapshot(&self) -> Result<Option<Choice>, String> {
        self.choice
            .lock()
            .map_err(|_| "Boot audio policy unavailable".to_owned())?
            .clone()
    }
    pub fn error(&self) -> Option<String> {
        match self.choice.lock() {
            Ok(choice) => choice.as_ref().err().cloned(),
            Err(_) => Some("Boot audio policy unavailable".into()),
        }
    }
    pub fn enabled(&self, role: Role) -> bool {
        self.choice
            .lock()
            .is_ok_and(|c| matches!(&*c, Ok(Some(c)) if c.role() == role))
    }
    pub fn set(&self, choice: Choice) -> Result<(), String> {
        let mut current = self
            .choice
            .lock()
            .map_err(|_| "Boot audio policy unavailable".to_owned())?;
        let result = write(&self.path, Some(&choice));
        // Even if directory fsync fails after rename, report what is actually published.
        *current = read(&self.path);
        result
    }
    pub fn clear(&self, role: Role) -> Result<(), String> {
        let mut current = self
            .choice
            .lock()
            .map_err(|_| "Boot audio policy unavailable".to_owned())?;
        if matches!(&*current, Ok(Some(c)) if c.role() != role) {
            return Ok(());
        }
        let result = write(&self.path, None);
        *current = read(&self.path);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn follow_never_enables_startup_and_persists() {
        let root = std::env::temp_dir().join(format!("oxidal-follow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("boot-audio.json");
        let policy = Policy::new(path.clone());
        assert_eq!(policy.startup().policy, StartupPolicy::Off);
        policy.set_follow(true).unwrap();
        // Follow alone is not a startup sound: nothing plays at startup.
        assert_eq!(policy.startup().policy, StartupPolicy::Off);
        assert!(policy.startup().target.is_none());
        assert!(Policy::new(path.clone()).follows());
        policy.set_follow(false).unwrap();
        assert!(!Policy::new(path).follows());
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn boot_selection_is_exclusive_atomic_and_backward_compatible() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-boot-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("boot-audio.json");
        let p = Policy::new(path.clone());
        assert!(p.snapshot().unwrap().is_none());
        let input = json!({"endpoint":"hw:CARD=USB,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
        let mut output = input.clone();
        output["direction"] = json!("playback");
        let stream = json!({"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]});
        let settings: StartAudio = serde_json::from_value(
            json!({"stream":stream,"preset_id":"a".repeat(64),"owned":false}),
        )
        .unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let legacy = serde_json::to_vec(&json!({"schema":1,"settings":settings})).unwrap();
        std::fs::write(&path, &legacy).unwrap();
        let duplicate = format!(
            "{{\"schema\":1,\"schema\":1,\"settings\":{}}}",
            serde_json::to_string(&settings).unwrap()
        );
        std::fs::write(&path, duplicate).unwrap();
        assert!(Policy::new(path.clone()).snapshot().is_err());
        std::fs::write(&path, &legacy).unwrap();
        let p = Policy::new(path.clone());
        assert!(p.enabled(Role::Native));
        assert!(!p.enabled(Role::Mixed));
        p.clear(Role::Mixed).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), legacy);
        let mut mixed: StartRig=serde_json::from_value(json!({"revision":"b".repeat(64),"stream":stream,"recall":{"source_revision":"b".repeat(64),"values":[]}})).unwrap();
        mixed.midi = Some(oxidal_audio::midi::Settings {
            branch_bindings: vec![],
            parameter_bindings: vec![oxidal_audio::midi::ParameterBinding {
                target: oxidal_engine::protocol::Target::Native {
                    node: "amp".into(),
                    parameter: "toneBass".into(),
                },
                controller: 21,
                mode: oxidal_audio::midi::ControlMode::RelativeTwosComplement,
            }],
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![oxidal_audio::midi::Binding {
                scene: "lead".into(),
                program: Some(1),
                controller: None,
            }],
        });
        p.set(Choice::Mixed {
            settings: mixed.clone(),
        })
        .unwrap();
        assert!(p.enabled(Role::Mixed));
        let Some(Choice::Mixed { settings: restored }) =
            Policy::new(path.clone()).snapshot().unwrap()
        else {
            panic!("Missing mixed boot choice")
        };
        assert_eq!(restored.midi, mixed.midi);

        assert!(!p.enabled(Role::Native));
        let original = std::fs::read(&path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&original).unwrap()["schema"],
            2
        );
        p.clear(Role::Native).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let effects: StartGraph = serde_json::from_value(json!({
            "stream":stream,
            "rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},
            "bindings":[],
            "recall":{"bypassed":false,"values":[],"mappings":{"version":1,"mappings":[]}}
        })).unwrap();
        p.set(Choice::Effects {
            settings: effects.clone(),
        })
        .unwrap();
        assert!(p.enabled(Role::Effects));
        assert!(!p.enabled(Role::Mixed));
        p.clear(Role::Native).unwrap();
        p.clear(Role::Mixed).unwrap();
        assert!(p.enabled(Role::Effects));
        let mut invalid_name = effects.clone();
        invalid_name.name = Some("bad\nname".into());
        assert!(
            p.set(Choice::Effects {
                settings: invalid_name
            })
            .is_err()
        );
        assert!(p.enabled(Role::Effects));
        let mut incomplete = effects;
        incomplete.recall = None;
        assert!(
            p.set(Choice::Effects {
                settings: incomplete
            })
            .is_err()
        );
        assert!(p.enabled(Role::Effects));
        mixed.midi = Some(oxidal_audio::midi::Settings {
            branch_bindings: vec![],
            parameter_bindings: vec![oxidal_audio::midi::ParameterBinding {
                target: oxidal_engine::protocol::Target::Native {
                    node: "amp".into(),
                    parameter: "toneBass".into(),
                },
                controller: 21,
                mode: oxidal_audio::midi::ControlMode::RelativeTwosComplement,
            }],
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![oxidal_audio::midi::Binding {
                scene: "lead".into(),
                program: Some(1),
                controller: None,
            }],
        });
        p.set(Choice::Mixed {
            settings: mixed.clone(),
        })
        .unwrap();
        let original = std::fs::read(&path).unwrap();
        let native = Choice::Native {
            settings: settings.clone(),
            controls: None,
            eq: None,
            models: vec![],
        };
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(p.set(native.clone()).is_err());
        assert!(p.enabled(Role::Mixed));
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let mut invalid = mixed;
        invalid.recall = None;
        assert!(p.set(Choice::Mixed { settings: invalid }).is_err());
        let mut draft = settings;
        draft.draft = true;
        assert!(
            p.set(Choice::Native {
                settings: draft,
                controls: None,
                eq: None,
                models: vec![]
            })
            .is_err()
        );
        assert!(p.enabled(Role::Mixed));
        p.set(native).unwrap();
        assert!(Policy::new(path.clone()).enabled(Role::Native));
        p.clear(Role::Native).unwrap();
        assert!(!path.exists());
        for invalid in [
            b"partial".to_vec(),
            vec![b' '; REQUEST_LIMIT],
            serde_json::to_vec(&json!({"schema":3})).unwrap(),
        ] {
            std::fs::write(&path, invalid).unwrap();
            let p = Policy::new(path.clone());
            assert!(p.snapshot().is_err());
            assert!(!p.enabled(Role::Native));
            assert!(!p.enabled(Role::Mixed));
            p.clear(Role::Mixed).unwrap();
            assert!(!path.exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub(super) async fn startup(
    axum::extract::State(shared): axum::extract::State<std::sync::Arc<crate::Shared>>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    axum::Json(shared.boot.startup()).into_response()
}
/// Switches between Last played (follow) and Pinned for an enabled startup.
/// Enabling or turning startup off stays with each owner's SetBoot command.
pub(super) async fn set_startup(
    axum::extract::State(shared): axum::extract::State<std::sync::Arc<crate::Shared>>,
    body: Result<axum::Json<StartupUpdate>, axum::extract::rejection::JsonRejection>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let Ok(axum::Json(update)) = body else {
        return crate::failure(
            axum::http::StatusCode::BAD_REQUEST,
            "Invalid startup policy",
        );
    };
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason);
    }
    match shared.boot.set_follow(update.follow) {
        Ok(()) => axum::Json(shared.boot.startup()).into_response(),
        Err(e) => crate::failure(axum::http::StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}
