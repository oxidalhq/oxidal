//! Immutable owned snapshots, published atomically with provenance beside the native bytes.
use crate::{Error, Inspection, MAX_FILE_BYTES, Result, Store, inspect};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OwnedPreset {
    pub id: String,
    pub source_sha256: String,
    pub preset: Inspection,
}
#[derive(Debug)]
pub struct OwnedStore {
    root: PathBuf,
}
impl OwnedStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("Invalid owned identifier"));
        }
        Ok(self.root.join(id))
    }
    pub fn list(&self) -> Result<Vec<OwnedPreset>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.into()),
        };
        let mut result = vec![];
        for e in entries {
            let e = e?;
            let id = e.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') {
                continue;
            }
            if result.len() >= 128 {
                return Err(Error::Invalid("Owned library full"));
            }
            result.push(self.read(&id)?.0);
        }
        result.sort_by(|a, b| a.preset.name.cmp(&b.preset.name).then(a.id.cmp(&b.id)));
        Ok(result)
    }
    pub fn read(&self, id: &str) -> Result<(OwnedPreset, Vec<u8>)> {
        let path = self.path(id)?;
        if !fs::symlink_metadata(&path)?.file_type().is_dir() {
            return Err(Error::Invalid("Invalid owned directory"));
        }
        let metadata = path.join("metadata.json");
        let m = fs::symlink_metadata(&metadata)?;
        if !m.file_type().is_file() || m.len() > 16384 {
            return Err(Error::Invalid("Invalid owned metadata"));
        }
        let info: OwnedPreset = serde_json::from_slice(&fs::read(metadata)?)
            .map_err(|_| Error::Invalid("Invalid owned metadata"))?;
        let bytes = Store::new(path).original(id)?;
        if info.id != id
            || info.preset != inspect(&bytes)?
            || !info
                .preset
                .source_id
                .as_deref()
                .is_some_and(|s| s.starts_with("oxidal-"))
        {
            return Err(Error::Invalid("Owned snapshot integrity failed"));
        }
        self.path(&info.source_sha256)?;
        Ok((info, bytes))
    }
    pub fn save(&self, source_sha256: &str, bytes: &[u8]) -> Result<OwnedPreset> {
        self.path(source_sha256)?;
        let preset = inspect(bytes)?;
        if !preset
            .source_id
            .as_deref()
            .is_some_and(|id| id.starts_with("oxidal-"))
        {
            return Err(Error::Invalid("Owned identity required"));
        }
        let entries = self.list()?;
        if entries.len() >= 128
            || entries
                .iter()
                .map(|e| u64::from(e.preset.size_bytes))
                .sum::<u64>()
                + bytes.len() as u64
                > 256 * 1024 * 1024
        {
            return Err(Error::Invalid("Owned library full"));
        }
        let info = OwnedPreset {
            id: preset.sha256.clone(),
            source_sha256: source_sha256.into(),
            preset,
        };
        let path = self.path(&info.id)?;
        if path.try_exists()? {
            return Err(Error::Invalid("Owned snapshot already exists"));
        }
        fs::create_dir_all(&self.root)?;
        let temporary = self.root.join(format!(".save-{}", info.id));
        fs::create_dir(&temporary)?;
        let result = (|| {
            let mut payload = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(temporary.join(format!("{}.t3kpreset", info.id)))?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err(Error::Invalid("Owned snapshot too large"));
            }
            payload.write_all(bytes)?;
            payload.sync_all()?;
            let mut metadata = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(temporary.join("metadata.json"))?;
            metadata.write_all(
                &serde_json::to_vec(&info)
                    .map_err(|_| Error::Invalid("Owned metadata serialization failed"))?,
            )?;
            metadata.sync_all()?;
            fs::rename(&temporary, &path)?;
            Ok(info)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(temporary);
        }
        result
    }
}
