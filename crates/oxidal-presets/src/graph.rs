//! Immutable graph snapshots. Plugin code remains installed separately; opaque
//! plugin state/assets are not represented by this initial document version.
use crate::{Error, Result};
use oxidal_graph::Rig;
use oxidal_lv2::protocol::{Binding, GraphRecall, validate_graph};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};
const LIMIT: u64 = 65536;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphPreset {
    pub version: u8,
    pub name: String,
    pub sample_rate: u32,
    pub rig: Rig,
    pub bindings: Vec<Binding>,
    pub recall: GraphRecall,
}
impl GraphPreset {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.name.trim() != self.name
            || self.name.is_empty()
            || self.name.len() > 80
            || self.name.contains(char::is_control)
            || !(8000..=192000).contains(&self.sample_rate)
        {
            return Err(Error::Invalid("Invalid graph preset metadata"));
        }
        validate_graph(&self.rig, &self.bindings)
            .map_err(|_| Error::Invalid("Invalid graph preset routing"))?;
        self.recall
            .validate()
            .map_err(|_| Error::Invalid("Invalid graph preset controls"))?;
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SavedGraph {
    pub id: String,
    pub preset: GraphPreset,
}
#[derive(Debug)]
pub struct GraphStore {
    root: PathBuf,
}
impl GraphStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("Invalid graph preset identifier"));
        }
        Ok(self.root.join(format!("{id}.json")))
    }
    pub fn read(&self, id: &str) -> Result<SavedGraph> {
        let path = self.path(id)?;
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.len() > LIMIT {
            return Err(Error::Invalid("Invalid graph preset file"));
        }
        let mut bytes = vec![];
        fs::File::open(path)?
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > LIMIT || format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err(Error::Invalid("Graph preset integrity failed"));
        }
        let preset: GraphPreset = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Invalid("Invalid graph preset data"))?;
        preset.validate()?;
        Ok(SavedGraph {
            id: id.into(),
            preset,
        })
    }
    pub fn list(&self) -> Result<Vec<SavedGraph>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.into()),
        };
        let mut result = vec![];
        for entry in entries {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if result.len() >= 128 {
                return Err(Error::Invalid("Graph preset library full"));
            }
            let id = name
                .strip_suffix(".json")
                .ok_or(Error::Invalid("Unexpected graph preset file"))?;
            result.push(self.read(id)?);
        }
        result.sort_by(|a, b| a.preset.name.cmp(&b.preset.name).then(a.id.cmp(&b.id)));
        Ok(result)
    }
    pub fn save(&self, preset: GraphPreset) -> Result<SavedGraph> {
        preset.validate()?;
        let bytes = serde_json::to_vec(&preset)
            .map_err(|_| Error::Invalid("Cannot encode graph preset"))?;
        if bytes.len() as u64 > LIMIT {
            return Err(Error::Invalid("Graph preset exceeds 64 KiB"));
        }
        let id = format!("{:x}", Sha256::digest(&bytes));
        let path = self.path(&id)?;
        if path.try_exists()? {
            return self.read(&id);
        }
        if self.list()?.len() >= 128 {
            return Err(Error::Invalid("Graph preset library full"));
        }
        fs::create_dir_all(&self.root)?;
        let temporary = self.root.join(format!(".save-{id}"));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &path)?;
            fs::File::open(&self.root)?.sync_all()?;
            self.read(&id)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graph_snapshots_roundtrip_without_a_native_original_and_detect_tampering() {
        let root = std::env::temp_dir().join(format!("oxidal-graph-store-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let store = GraphStore::new(root.clone());
        let preset: GraphPreset = serde_json::from_value(serde_json::json!({
            "version":1,"name":"New rig","sample_rate":48000,
            "rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},
            "bindings":[],"recall":{"values":[],"bypassed":false,"mappings":{"version":1,"mappings":[]}}
        })).unwrap();
        let saved = store.save(preset.clone()).unwrap();
        assert_eq!(store.save(preset.clone()).unwrap().id, saved.id);
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.read(&saved.id).unwrap().preset.name, "New rig");
        assert!(store.read("../outside").is_err());
        let mut invalid = preset.clone();
        invalid.version = 2;
        assert!(store.save(invalid).is_err());
        let mut invalid = preset;
        invalid.name = " ".into();
        assert!(store.save(invalid).is_err());
        fs::write(store.path(&saved.id).unwrap(), b"{}").unwrap();
        assert!(store.read(&saved.id).is_err());
        assert!(store.list().is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
