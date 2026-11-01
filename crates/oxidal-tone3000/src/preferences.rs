//! Device defaults seed new native instances; saved tone/working state still wins.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::Path,
};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "NativeDefaultSettings")]
pub struct Settings {
    pub nam_size: f32,
    pub multi_core: bool,
    /// Normalized native parameter values, limited to the reference machine defaults.
    pub parameters: BTreeMap<String, f32>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            nam_size: 1.0,
            multi_core: true,
            parameters: BTreeMap::from([("osEnabled".into(), 1.0), ("osFactor".into(), 1.0)]),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.nam_size.is_finite() || !(0.0..=1.0).contains(&self.nam_size) {
            return Err("NAM default must be between Lite and Full".into());
        }
        for (id, value) in &self.parameters {
            if !matches!(
                id.as_str(),
                "calibrateInput" | "inputCalibrationLevel" | "osEnabled" | "osFactor"
            ) || !value.is_finite()
                || !(0.0..=1.0).contains(value)
            {
                return Err("Invalid native machine parameter default".into());
            }
            if matches!(id.as_str(), "calibrateInput" | "osEnabled") && !matches!(*value, 0.0 | 1.0)
            {
                return Err("Native machine switch requires Off or On".into());
            }
            if id == "osFactor" && ![0.0, 0.5, 1.0].contains(value) {
                return Err("Oversampling factor requires a declared step".into());
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "NativeDefaults")]
pub struct Snapshot {
    pub revision: String,
    pub settings: Settings,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "NativeDefaultsUpdate")]
pub struct Update {
    pub expected_revision: String,
    pub settings: Settings,
}
fn snapshot(settings: Settings) -> Result<Snapshot, String> {
    settings.validate()?;
    let bytes = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
    Ok(Snapshot {
        revision: format!("{:x}", Sha256::digest(&bytes)),
        settings,
    })
}
pub fn read(root: &Path) -> Result<Snapshot, String> {
    let mut bytes = vec![];
    match std::fs::File::open(root.join("native-defaults.json")) {
        Ok(file) => {
            file.take(4097)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return snapshot(Settings::default()),
        Err(e) => return Err(e.to_string()),
    }
    if bytes.len() > 4096 {
        return Err("Native defaults exceed budget".into());
    }
    snapshot(serde_json::from_slice(&bytes).map_err(|_| "Invalid native defaults file")?)
}
/// The device/API owner serializes this compare-and-write operation.
pub fn save(root: &Path, update: Update) -> Result<Snapshot, String> {
    update.settings.validate()?;
    if read(root)?.revision != update.expected_revision {
        return Err("Native defaults changed; reload before saving".into());
    }
    let result = snapshot(update.settings)?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temporary = root.join(format!(
        ".native-defaults-{}-{}.pending",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let written = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&result.settings).map_err(|e| e.to_string())?)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, root.join("native-defaults.json"))
            .map_err(|e| e.to_string())?;
        std::fs::File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_machine_scope_and_steps() {
        let mut s = Settings::default();
        s.parameters.insert("outputLevel".into(), 0.5);
        assert!(s.validate().is_err());
        s.parameters.clear();
        s.parameters.insert("osFactor".into(), 0.25);
        assert!(s.validate().is_err());
        s.parameters.insert("osFactor".into(), 0.5);
        assert!(s.validate().is_ok());
        s.nam_size = f32::NAN;
        assert!(s.validate().is_err());
    }
    #[test]
    fn defaults_roundtrip_stale_and_corruption() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-defaults-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let initial = read(&root).unwrap();
        let mut settings = initial.settings.clone();
        settings.nam_size = 0.75;
        settings.multi_core = true;
        let update = Update {
            expected_revision: initial.revision,
            settings,
        };
        let saved = save(&root, update.clone()).unwrap();
        assert_eq!(read(&root).unwrap().settings, saved.settings);
        assert!(save(&root, update).is_err());
        std::fs::write(root.join("native-defaults.json"), "broken").unwrap();
        assert!(read(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
