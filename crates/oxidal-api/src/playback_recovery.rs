//! Last confirmed scalar session; separate from the explicit saved-preset boot policy.
use oxidal_audio::lifecycle::{
    LiveControl, ModelAssignment, StartAudio, valid_controls, valid_models,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

const MAX_BYTES: u64 = 128 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Recovery {
    schema: u32,
    pub settings: StartAudio,
    pub controls: Option<Vec<LiveControl>>,
    #[serde(default)]
    pub models: Vec<ModelAssignment>,
}
impl Recovery {
    pub fn new(
        settings: StartAudio,
        controls: Option<Vec<LiveControl>>,
        models: Vec<ModelAssignment>,
    ) -> Self {
        Self {
            schema: 1,
            settings,
            controls,
            models,
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.schema != 1
            || !valid_models(&self.models)
            || self.controls.as_ref().is_some_and(|c| !valid_controls(c))
        {
            return Err("Invalid audio recovery state".into());
        }
        self.settings.validate()
    }
    pub fn read(path: &Path) -> Result<Option<Self>, String> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Cannot read audio recovery: {e}")),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Audio recovery exceeds size limit".into());
        }
        let state: Self =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid audio recovery: {e}"))?;
        state.validate()?;
        Ok(Some(state))
    }
    pub fn write(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Audio recovery exceeds size limit".into());
        }
        let parent = path.parent().ok_or("Audio recovery directory missing")?;
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
    fn recovery_is_atomic_bounded_and_validated() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-recovery-{}-{}",
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
        let settings: StartAudio = serde_json::from_value(json!({"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},"preset_id":"a".repeat(64),"owned":false})).unwrap();
        let control = LiveControl {
            target: "toneBass".into(),
            label: "Bass".into(),
            value: 0.25,
            display: "2.5".into(),
            toggle: false,
        };
        let mut state = Recovery::new(settings, Some(vec![control.clone()]), vec![]);
        state.models = vec![ModelAssignment {
            target: "block-one".into(),
            asset: "a".repeat(64),
        }];
        state.write(&path).unwrap();
        assert_eq!(Recovery::read(&path).unwrap().unwrap().models, state.models);
        state.models.push(state.models[0].clone());
        assert!(state.write(&path).is_err());
        state.models.pop();
        let original = std::fs::read(&path).unwrap();
        // An interrupted temporary write cannot replace the last published state.
        std::fs::write(path.with_extension("tmp"), b"partial").unwrap();
        assert_eq!(
            Recovery::read(&path).unwrap().unwrap().controls.unwrap()[0].value,
            0.25
        );
        state.controls.as_mut().unwrap().push(control);
        assert!(state.write(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::write(&path, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(Recovery::read(&path).unwrap_err().contains("size limit"));
        std::fs::write(&path, b"invalid").unwrap();
        assert!(Recovery::read(&path).is_err());
        let mut invalid: serde_json::Value = serde_json::from_slice(&original).unwrap();
        invalid["schema"] = json!(2);
        std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(Recovery::read(&path).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
