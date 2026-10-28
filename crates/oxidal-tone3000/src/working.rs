//! Immutable local native checkpoints and bounded structural authoring history.
//! No browser-provided path or opaque native payload crosses this boundary.
use crate::{Engine, State};
use oxidal_audio::{
    lifecycle::StartAudio,
    structure::{AuthoringAction, AuthoringStatus, valid_receipt},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const MAX_STATE: usize = 32 * 1024 * 1024;
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
const HISTORY_ENTRIES: usize = 8;
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    schema: u32,
    profile: String,
    origin: String,
}
fn profile() -> String {
    format!(
        "{:x}",
        Sha256::digest(include_bytes!("../../../native/tone3000/sources.json"))
    )
}
pub fn origin(settings: &StartAudio) -> String {
    format!(
        "{}:{}",
        if settings.draft {
            "draft"
        } else if settings.owned {
            "owned"
        } else {
            "original"
        },
        settings.preset_id
    )
}
fn prepared_setting(id: &str) -> bool {
    crate::protocol::writable(id) && !crate::protocol::live_writable(id)
        || matches!(id, "calibrateInput" | "targetLoudness")
}
fn directory(root: &Path) -> PathBuf {
    root.join("native-checkpoints")
}
/// A checkpoint is a full captured session; scalar/model edits after it replay normally.
pub fn read(root: &Path, id: &str, source: &str) -> Result<State, String> {
    if !valid_receipt(id) {
        return Err("Invalid working receipt".into());
    }
    let mut bytes = vec![];
    std::fs::File::open(directory(root).join(id))
        .map_err(|e| format!("Cannot read native working state: {e}"))?
        .take((MAX_STATE + 4097) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_STATE + 4096 || format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Native working checkpoint checksum/size differs".into());
    }
    let split = bytes
        .iter()
        .position(|b| *b == b'\n')
        .filter(|n| *n <= 4096)
        .ok_or("Invalid checkpoint header")?;
    let header: Header = serde_json::from_slice(&bytes[..split]).map_err(|e| e.to_string())?;
    if header.schema != 1
        || header.profile != profile()
        || header.origin != source
        || bytes.len() <= split + 5
    {
        return Err("Native working checkpoint profile/source differs".into());
    }
    Ok(State(bytes.split_off(split + 1)))
}
fn write(root: &Path, source: &str, state: &State) -> Result<String, String> {
    if state.byte_len() < 5 || state.byte_len() > MAX_STATE {
        return Err("Invalid native checkpoint size".into());
    }
    let mut bytes = serde_json::to_vec(&Header {
        schema: 1,
        profile: profile(),
        origin: source.into(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    bytes.extend_from_slice(&state.0);
    let id = format!("{:x}", Sha256::digest(&bytes));
    let parent = directory(root);
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let destination = parent.join(&id);
    if destination.exists() {
        read(root, &id, source)?;
        return Ok(id);
    }
    let temporary = parent.join(format!(
        ".pending-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        std::fs::File::open(&parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(id)
}
pub fn reconstruct(
    root: &Path,
    request: &oxidal_audio::lifecycle::SavePlayback,
) -> Result<Engine, Box<dyn std::error::Error>> {
    request.settings.validate()?;
    if !oxidal_audio::lifecycle::valid_controls(&request.controls)
        || !oxidal_audio::lifecycle::valid_models(&request.models)
        || request
            .eq
            .as_ref()
            .is_some_and(|eq| !oxidal_audio::eq::valid_snapshot(eq))
    {
        return Err("Invalid confirmed native reconstruction".into());
    }
    let settings = &request.settings;
    let preset = if settings.owned || settings.draft {
        oxidal_presets::OwnedStore::new(root.join(if settings.draft {
            "working-native"
        } else {
            "owned"
        }))
        .read(&settings.preset_id)?
        .1
    } else {
        oxidal_presets::Store::new(root.into()).original(&settings.preset_id)?
    };
    let frames = settings.stream.input.period_frames as usize;
    let mut engine = Engine::new(settings.stream.input.sample_rate.into(), frames)?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    if let Some(id) = &settings.working {
        engine.restore(&read(root, id, &origin(settings))?)?;
        engine.wait_ready()?;
    }
    crate::model_preparation::restore(&mut engine, root, &request.models, frames)?;
    engine.apply_live_snapshot(&request.controls)?;
    if let Some(eq) = &request.eq {
        engine.restore_eq(eq, &mut 0)?;
    }
    engine.wait_ready()?;
    Ok(engine)
}

#[derive(Debug)]
pub struct Authoring {
    root: PathBuf,
    source: String,
    working: Option<String>,
    undo: VecDeque<State>,
    redo: VecDeque<State>,
    failed: bool,
}
impl Authoring {
    pub fn new(root: &Path, settings: &StartAudio) -> Self {
        Self::for_source(root, origin(settings), settings.working.clone())
    }
    pub fn for_source(root: &Path, source: String, working: Option<String>) -> Self {
        Self {
            root: root.into(),
            source,
            working,
            undo: VecDeque::new(),
            redo: VecDeque::new(),
            failed: false,
        }
    }
    pub fn failed(&self) -> bool {
        self.failed
    }
    pub fn snapshot(&self, engine: &mut Engine) -> Result<AuthoringStatus, String> {
        let parameters: Vec<crate::protocol::Parameter> =
            serde_json::from_value(engine.catalog().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let setting_steps = parameters
            .iter()
            .filter(|p| prepared_setting(&p.id))
            .map(|p| {
                let step = if p.toggle {
                    1.0
                } else if p.interval > 0.0 && p.maximum > p.minimum {
                    (p.interval / (p.maximum - p.minimum)).min(1.0) as f32
                } else {
                    0.01
                };
                (p.id.clone(), step)
            })
            .collect();
        let settings = parameters
            .into_iter()
            .filter(|p| prepared_setting(&p.id))
            .map(|p| oxidal_audio::lifecycle::LiveControl {
                target: p.id.clone(),
                label: crate::native::parameter_label(&p.id).into(),
                display: crate::native::parameter_display(&p),
                value: p.normalized as f32,
                toggle: p.toggle,
            })
            .collect();
        let state = AuthoringStatus {
            settings,
            setting_steps,
            layout: engine.layout().map_err(|e| e.to_string())?,
            can_paste: engine.chain().map_err(|e| e.to_string())?["canPasteBlock"]
                .as_bool()
                .unwrap_or(false),
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
            working: self.working.clone(),
        };
        if !state.valid() {
            return Err("Invalid native authoring catalog".into());
        }
        Ok(state)
    }
    /// Control-owner transaction between PCM steps. Allocates and may rebuild native
    /// processors: functional authoring, never a gapless/real-time transition claim.
    pub fn command(
        &mut self,
        engine: &mut Engine,
        action: AuthoringAction,
    ) -> Result<AuthoringStatus, String> {
        self.execute(engine, action, false)
    }
    /// Isolated, non-PCM preparation only. The supervisor admits this receipt by
    /// rebuilding the stream and retains the old session if that admission fails.
    pub fn prepare_parameter(
        &mut self,
        engine: &mut Engine,
        parameter: String,
        value: f32,
    ) -> Result<AuthoringStatus, String> {
        self.execute(
            engine,
            AuthoringAction::Parameter { parameter, value },
            true,
        )
    }
    fn execute(
        &mut self,
        engine: &mut Engine,
        action: AuthoringAction,
        reprepare: bool,
    ) -> Result<AuthoringStatus, String> {
        if matches!(action, AuthoringAction::Parameter { .. }) && !reprepare {
            return Err("This setting requires isolated audio preparation".into());
        }
        if self.failed {
            return Err("Native authoring failed; restart required".into());
        }
        if let AuthoringAction::Copy { block_id } = &action {
            engine.copy_block(block_id).map_err(|e| e.to_string())?;
            return self.snapshot(engine);
        }
        if matches!(action, AuthoringAction::Inspect) {
            return self.snapshot(engine);
        }
        if matches!(action, AuthoringAction::Undo) && self.undo.is_empty()
            || matches!(action, AuthoringAction::Redo) && self.redo.is_empty()
        {
            return Err("No structural history available".into());
        }
        let before = engine.capture().map_err(|e| e.to_string())?;
        let latency = engine.latency_samples().map_err(|e| e.to_string())?;
        let result = (|| -> Result<(State, String), String> {
            match &action {
                AuthoringAction::Edit { edit } => {
                    engine.edit_structure(edit).map_err(|e| e.to_string())?
                }
                AuthoringAction::Parameter { parameter, value } => {
                    let allowed = self
                        .snapshot(engine)?
                        .settings
                        .into_iter()
                        .find(|p| p.target == *parameter && p.accepts(*value))
                        .ok_or("Invalid or non-staged native setting")?;
                    engine
                        .set_normalized(&allowed.target, *value)
                        .map_err(|e| e.to_string())?;
                }
                AuthoringAction::Remove { block_id } => {
                    let layout = engine.layout().map_err(|e| e.to_string())?;
                    if !layout
                        .left
                        .iter()
                        .chain(&layout.right)
                        .any(|b| b.id == *block_id && !b.insert)
                    {
                        return Err("Missing or stale native block".into());
                    }
                    engine.remove_block(block_id).map_err(|e| e.to_string())?;
                }
                AuthoringAction::Undo => engine
                    .restore(self.undo.back().ok_or("No undo available")?)
                    .map_err(|e| e.to_string())?,
                AuthoringAction::Redo => engine
                    .restore(self.redo.back().ok_or("No redo available")?)
                    .map_err(|e| e.to_string())?,
                AuthoringAction::Inspect | AuthoringAction::Copy { .. } => unreachable!(),
            }
            engine.wait_ready().map_err(|e| e.to_string())?;
            if !reprepare && engine.latency_samples().map_err(|e| e.to_string())? != latency {
                return Err("Edit changes audio latency; fresh audio preparation required".into());
            }
            engine.live_controls().map_err(|e| e.to_string())?;
            engine.eq_snapshot().map_err(|e| e.to_string())?;
            engine.slots().map_err(|e| e.to_string())?;
            self.snapshot(engine)?;
            let after = engine.capture().map_err(|e| e.to_string())?;
            let receipt = write(&self.root, &self.source, &after)?;
            Ok((after, receipt))
        })();
        let (after, receipt) = match result {
            Ok(value) => value,
            Err(error) => {
                // Invalid/stale requests which never changed native state must not
                // reset the playing processor or its transient histories.
                if engine.capture().is_ok_and(|current| current == before) {
                    return Err(error);
                }
                if let Err(rollback) = engine.restore(&before).and_then(|_| engine.wait_ready()) {
                    self.failed = true;
                    return Err(format!(
                        "Native authoring rollback failed: {rollback}; initial error: {error}"
                    ));
                }
                return Err(error);
            }
        };
        match action {
            AuthoringAction::Undo => {
                self.undo.pop_back();
                self.redo.push_back(before);
            }
            AuthoringAction::Redo => {
                self.redo.pop_back();
                self.undo.push_back(before);
            }
            _ if before != after => {
                self.undo.push_back(before);
                self.redo.clear();
            }
            _ => (),
        }
        self.working = Some(receipt);
        while self.undo.len() + self.redo.len() > HISTORY_ENTRIES
            || self
                .undo
                .iter()
                .chain(&self.redo)
                .map(State::byte_len)
                .sum::<usize>()
                > HISTORY_BYTES
        {
            if self.undo.is_empty() {
                self.redo.pop_front();
            } else {
                self.undo.pop_front();
            }
        }
        self.snapshot(engine)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkpoints_are_atomic_content_verified_and_bound_to_source_and_profile() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-checkpoint-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state = State(b"private native capture fixture".to_vec());
        let id = write(&root, "original:fixture", &state).unwrap();
        assert_eq!(read(&root, &id, "original:fixture").unwrap(), state);
        assert_eq!(write(&root, "original:fixture", &state).unwrap(), id);
        assert!(read(&root, &id, "owned:another-source").is_err());
        assert!(read(&root, "../outside", "original:fixture").is_err());
        let path = directory(&root).join(&id);
        let original = std::fs::read(&path).unwrap();
        let mut corrupted = original.clone();
        *corrupted.last_mut().unwrap() ^= 1;
        std::fs::write(&path, corrupted).unwrap();
        assert!(read(&root, &id, "original:fixture").is_err());
        assert!(
            write(&root, "original:fixture", &state).is_err(),
            "existing damaged receipt must not be silently repaired"
        );
        std::fs::write(&path, &original).unwrap();
        std::fs::write(directory(&root).join(".pending-interrupted"), b"incomplete").unwrap();
        assert_eq!(read(&root, &id, "original:fixture").unwrap(), state);
        std::fs::remove_dir_all(root).unwrap();
    }
}
