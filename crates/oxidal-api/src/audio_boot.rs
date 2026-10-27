//! One durable boot choice for all audio owners; confirmed recovery is separate.
use crate::{playback_recovery, rig_recovery};
use oxidal_audio::lifecycle::{LiveControl, ModelAssignment, StartAudio};
use oxidal_engine::protocol::{REQUEST_LIMIT, StartRig};
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
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Choice {
    Native {
        settings: StartAudio,
        controls: Option<Vec<LiveControl>>,
        models: Vec<ModelAssignment>,
    },
    Mixed {
        settings: StartRig,
    },
}
impl Choice {
    fn role(&self) -> Role {
        match self {
            Self::Native { .. } => Role::Native,
            Self::Mixed { .. } => Role::Mixed,
        }
    }
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Native {
                settings,
                controls,
                models,
            } => {
                if settings.draft {
                    return Err("Save and recall the new rig before enabling boot playback".into());
                }
                playback_recovery::Recovery::new(settings.clone(), controls.clone(), models.clone())
                    .validate()
            }
            Self::Mixed { settings } => rig_recovery::Recovery::new(settings.clone()).validate(),
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

#[derive(Debug)]
pub(super) struct Policy {
    path: PathBuf,
    choice: Mutex<Result<Option<Choice>, String>>,
}
impl Policy {
    pub fn new(path: PathBuf) -> Self {
        let choice = Mutex::new(read(&path));
        Self { path, choice }
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
        let mixed: StartRig=serde_json::from_value(json!({"revision":"b".repeat(64),"stream":stream,"recall":{"source_revision":"b".repeat(64),"values":[]}})).unwrap();
        p.set(Choice::Mixed {
            settings: mixed.clone(),
        })
        .unwrap();
        assert!(p.enabled(Role::Mixed));
        assert!(!p.enabled(Role::Native));
        let original = std::fs::read(&path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&original).unwrap()["schema"],
            2
        );
        p.clear(Role::Native).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let native = Choice::Native {
            settings: settings.clone(),
            controls: None,
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
