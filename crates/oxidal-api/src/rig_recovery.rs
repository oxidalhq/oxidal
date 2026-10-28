//! Confirmed mixed session recovery, independent of named Save and boot policy.
use oxidal_engine::protocol::{REQUEST_LIMIT, StartRig};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Recovery {
    schema: u32,
    pub settings: StartRig,
}
impl Recovery {
    pub fn new(settings: StartRig) -> Self {
        Self {
            schema: 1,
            settings,
        }
    }
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.schema != 1 || self.settings.recall.is_none() {
            return Err("Invalid mixed recovery state".into());
        }
        self.settings.validate()?;
        let recall = self.settings.recall.as_ref().unwrap();
        let mut seen = std::collections::BTreeSet::new();
        if recall
            .values
            .iter()
            .any(|v| !v.value.is_finite() || !seen.insert(&v.target))
        {
            return Err("Invalid mixed recovery controls".into());
        }
        Ok(())
    }
    pub fn read(path: &Path) -> Result<Option<Self>, String> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Cannot read mixed recovery: {e}")),
        };
        let mut bytes = Vec::new();
        file.take((REQUEST_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() >= REQUEST_LIMIT {
            return Err("Mixed recovery exceeds size limit".into());
        }
        let state: Self =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid mixed recovery: {e}"))?;
        state.validate()?;
        Ok(Some(state))
    }
    pub fn write(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() >= REQUEST_LIMIT {
            return Err("Mixed recovery exceeds size limit".into());
        }
        let parent = path.parent().ok_or("Mixed recovery directory missing")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = path.with_extension("tmp");
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        std::fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn recovery_preserves_confirmed_values_and_rejects_invalid_or_incomplete_state() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-rig-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("last.json");
        assert!(Recovery::read(&path).unwrap().is_none());
        let input = json!({"endpoint":"hw:CARD=USB,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
        let mut output = input.clone();
        output["direction"] = json!("playback");
        let mut settings: StartRig = serde_json::from_value(json!({"revision":"a".repeat(64),"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},"recall":{"source_revision":"a".repeat(64),"values":[{"target":{"kind":"native","node":"amp","parameter":"toneBass"},"value":0.25}]}})).unwrap();
        assert!(settings.midi.is_none()); // older checkpoints remain readable
        settings.midi = Some(oxidal_audio::midi::Settings {
            input: "hw:Controller,0,0".into(),
            channel: 2,
            bindings: vec![oxidal_audio::midi::Binding {
                scene: "clean".into(),
                program: Some(0),
                controller: None,
            }],
        });
        let mut recovery = Recovery::new(settings.clone());
        recovery.write(&path).unwrap();
        let original = std::fs::read(&path).unwrap();
        std::fs::write(path.with_extension("tmp"), b"interrupted").unwrap();
        assert_eq!(
            serde_json::to_value(Recovery::read(&path).unwrap().unwrap().settings).unwrap(),
            serde_json::to_value(&settings).unwrap()
        );
        let value = recovery.settings.recall.as_ref().unwrap().values[0].clone();
        recovery
            .settings
            .recall
            .as_mut()
            .unwrap()
            .values
            .push(value);
        assert!(recovery.write(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        recovery.settings = settings.clone();
        recovery.settings.recall.as_mut().unwrap().values[0].value = f64::NAN;
        assert!(recovery.write(&path).is_err());
        recovery.settings = settings.clone();
        recovery.settings.recall = None;
        assert!(recovery.write(&path).is_err());
        recovery.settings = settings;
        recovery.settings.recall.as_mut().unwrap().source_revision = "b".repeat(64);
        assert!(recovery.write(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let mut bad: serde_json::Value = serde_json::from_slice(&original).unwrap();
        bad["schema"] = json!(2);
        std::fs::write(&path, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(Recovery::read(&path).is_err());
        std::fs::write(&path, b"partial").unwrap();
        assert!(Recovery::read(&path).is_err());
        std::fs::write(&path, vec![b' '; REQUEST_LIMIT + 1]).unwrap();
        assert!(Recovery::read(&path).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
