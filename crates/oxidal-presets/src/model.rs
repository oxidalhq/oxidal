//! Verified temporary audition assets. A staged asset is not a saved rig.
use crate::{Error, MAX_FILE_BYTES, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelAsset {
    pub schema: u32,
    pub tone_id: u64,
    pub model_id: u64,
    pub title: String,
    pub name: String,
    pub format: String,
    pub sha256: String,
    /// Creator, license, artwork sources and one model descriptor, without credentials or signed URLs.
    pub tone: serde_json::Value,
}
impl ModelAsset {
    fn validate(&self) -> Result<()> {
        if self.schema != 1
            || self.tone_id == 0
            || self.model_id == 0
            || !matches!(self.format.as_str(), "nam" | "ir")
            || !hash(&self.sha256)
            || self.title.is_empty()
            || self.title.len() > 512
            || self.name.is_empty()
            || self.name.len() > 512
            || self
                .title
                .chars()
                .chain(self.name.chars())
                .any(char::is_control)
            || !self.tone.is_object()
            || self.tone["id"].as_u64() != Some(self.tone_id)
        {
            return Err(Error::Invalid("Invalid model metadata"));
        }
        Ok(())
    }
    pub fn filename(&self) -> &'static str {
        if self.format == "nam" {
            "model.nam"
        } else {
            "model.wav"
        }
    }
}
fn hash(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read(path: &Path, max: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() > max as u64 {
        return Err(Error::Invalid("Invalid model cache file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(Error::Invalid("Model cache file exceeds limit"));
    }
    Ok(bytes)
}
fn directory(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(Error::Invalid("Invalid model cache directory"));
    }
    Ok(())
}
#[derive(Debug)]
pub struct ModelStore {
    root: PathBuf,
}
impl ModelStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn read(&self, id: &str) -> Result<(ModelAsset, PathBuf)> {
        if !hash(id) {
            return Err(Error::Invalid("Invalid model asset identifier"));
        }
        directory(&self.root)?;
        let path = self.root.join(id);
        directory(&path)?;
        let metadata = read(&path.join("metadata.json"), 32768)?;
        if digest(&metadata) != id {
            return Err(Error::Invalid("Model metadata integrity failed"));
        }
        let asset: ModelAsset = serde_json::from_slice(&metadata)
            .map_err(|_| Error::Invalid("Invalid model metadata"))?;
        asset.validate()?;
        let model = path.join(asset.filename());
        let bytes = read(&model, MAX_FILE_BYTES)?;
        if bytes.is_empty() || digest(&bytes) != asset.sha256 {
            return Err(Error::Invalid("Model content integrity failed"));
        }
        Ok((asset, fs::canonicalize(model)?))
    }
    pub fn stage(&self, asset: &ModelAsset, bytes: &[u8]) -> Result<String> {
        asset.validate()?;
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES || digest(bytes) != asset.sha256 {
            return Err(Error::Invalid("Invalid model content"));
        }
        let metadata =
            serde_json::to_vec(asset).map_err(|_| Error::Invalid("Invalid model metadata"))?;
        if metadata.len() > 32768 {
            return Err(Error::Invalid("Model metadata exceeds limit"));
        }
        let id = digest(&metadata);
        fs::create_dir_all(&self.root)?;
        directory(&self.root)?;
        let destination = self.root.join(&id);
        if destination.try_exists()? {
            self.read(&id)?;
            return Ok(id);
        }
        let temporary = self.root.join(format!(
            ".stage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir(&temporary)?;
        let result = (|| {
            for (name, data) in [
                (asset.filename(), bytes),
                ("metadata.json", metadata.as_slice()),
            ] {
                let mut options = fs::OpenOptions::new();
                options.create_new(true).write(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options.open(temporary.join(name))?;
                file.write_all(data)?;
                file.sync_all()?;
            }
            fs::File::open(&temporary)?.sync_all()?;
            if let Err(error) = fs::rename(&temporary, &destination) {
                if destination.exists() {
                    self.read(&id)?;
                } else {
                    return Err(error.into());
                }
            }
            fs::File::open(&self.root)?.sync_all()?;
            Ok(id)
        })();
        let _ = fs::remove_dir_all(temporary);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn staged_model_survives_restart_and_rejects_tampering_and_traversal() {
        let root = std::env::temp_dir().join(format!("oxidal-model-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let bytes = br#"{"architecture":"Linear","weights":[1]}"#;
        let asset = ModelAsset {
            schema: 1,
            tone_id: 7,
            model_id: 9,
            title: "Amp".into(),
            name: "Crunch".into(),
            format: "nam".into(),
            sha256: digest(bytes),
            tone: serde_json::json!({"id":7,"title":"Amp","license":"test"}),
        };
        let id = ModelStore::new(root.clone()).stage(&asset, bytes).unwrap();
        let store = ModelStore::new(root.clone());
        let (loaded, path) = store.read(&id).unwrap();
        assert_eq!(loaded.model_id, 9);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(store.stage(&asset, bytes).unwrap(), id);
        assert!(store.read("../outside").is_err());
        fs::write(&path, b"corrupt").unwrap();
        assert!(store.read(&id).is_err());
        assert!(store.stage(&asset, bytes).is_err());
        fs::write(&path, bytes).unwrap();
        fs::write(root.join(&id).join("metadata.json"), b"{}").unwrap();
        assert!(store.read(&id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
