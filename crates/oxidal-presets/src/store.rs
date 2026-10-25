use crate::{Error, Inspection, MAX_FILE_BYTES, Result, inspect};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_ENTRIES: usize = 128;
const MAX_LIBRARY_BYTES: u64 = 256 * 1024 * 1024;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Library {
    pub presets: Vec<Inspection>,
}

/// Single-daemon store. Serialize access, and call off the async/audio threads.
/// Each file is an immutable original addressed by its full SHA-256, never a user path.
#[derive(Debug)]
pub struct Store {
    root: PathBuf,
}
impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("Invalid preset identifier"));
        }
        Ok(self.root.join(format!("{id}.t3kpreset")))
    }
    pub fn list(&self) -> Result<Library> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Library {
                    presets: Vec::new(),
                });
            }
            Err(error) => return Err(error.into()),
        };
        let mut presets = Vec::new();
        let mut size = 0u64;
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("t3kpreset") {
                continue;
            }
            if presets.len() >= MAX_ENTRIES {
                return Err(Error::Invalid("Preset library entry limit exceeded"));
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or(Error::Invalid("Invalid stored filename"))?;
            let bytes = self.original(id)?;
            size += bytes.len() as u64;
            if size > MAX_LIBRARY_BYTES {
                return Err(Error::Invalid("Preset library size limit exceeded"));
            }
            presets.push(inspect(&bytes)?);
        }
        presets.sort_by(|a, b| a.name.cmp(&b.name).then(a.sha256.cmp(&b.sha256)));
        Ok(Library { presets })
    }
    pub fn original(&self, id: &str) -> Result<Vec<u8>> {
        let path = self.path(id)?;
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.file_type().is_file() {
            return Err(Error::Invalid("Stored preset is not a regular file"));
        }
        if metadata.len() > MAX_FILE_BYTES as u64 {
            return Err(Error::Invalid("Stored preset exceeds admission limit"));
        }
        let mut bytes = Vec::new();
        File::open(path)?
            .take(MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        let info = inspect(&bytes)?;
        if info.sha256 != id {
            return Err(Error::Invalid("Stored preset integrity check failed"));
        }
        Ok(bytes)
    }
    pub fn import(&mut self, bytes: &[u8]) -> Result<Inspection> {
        let info = inspect(bytes)?;
        let path = self.path(&info.sha256)?;
        if path.try_exists()? {
            if self.original(&info.sha256)? != bytes {
                return Err(Error::Invalid("Stored preset integrity check failed"));
            }
            return Ok(info);
        }
        let library = self.list()?;
        if library.presets.len() >= MAX_ENTRIES
            || library
                .presets
                .iter()
                .map(|p| u64::from(p.size_bytes))
                .sum::<u64>()
                + bytes.len() as u64
                > MAX_LIBRARY_BYTES
        {
            return Err(Error::Invalid("Preset library is full"));
        }
        fs::create_dir_all(&self.root)?;
        let temporary_path = self.root.join(format!(
            ".import-{}-{}.tmp",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        let temporary = Temporary(temporary_path);
        output.write_all(bytes)?;
        output.sync_all()?;
        drop(output);
        // Atomic no-clobber publication on the same filesystem. A concurrent identical
        // import can win; verify it rather than replacing an existing original.
        match fs::hard_link(&temporary.0, &path) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if self.original(&info.sha256)? != bytes {
                    return Err(Error::Invalid("Stored preset integrity check failed"));
                }
            }
            Err(error) => return Err(error.into()),
        }
        Ok(info)
    }
}
#[derive(Debug)]
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const CURRENT: &[u8] = include_bytes!("../tests/fixtures/authored-current.t3kpreset");
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "oxidal-store-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ))
    }
    #[test]
    fn originals_are_immutable_deduplicated_and_survive_restart() {
        let root = root();
        let mut store = Store::new(root.clone());
        let info = store.import(CURRENT).unwrap();
        assert_eq!(store.import(CURRENT).unwrap(), info);
        assert_eq!(store.list().unwrap().presets.len(), 1);
        assert!(store.import(b"invalid").is_err());
        let reloaded = Store::new(root.clone());
        assert_eq!(reloaded.original(&info.sha256).unwrap(), CURRENT);
        assert_eq!(reloaded.list().unwrap().presets[0], info);
        assert!(reloaded.original("../escape").is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::write(store.path(&info.sha256).unwrap(), b"corrupt").unwrap();
        assert!(store.original(&info.sha256).is_err());
        assert!(store.import(CURRENT).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_storage_does_not_report_import_success() {
        let root = root();
        fs::write(&root, b"not a directory").unwrap();
        assert!(Store::new(root.clone()).import(CURRENT).is_err());
        assert_eq!(fs::read(&root).unwrap(), b"not a directory");
        fs::remove_file(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_payloads() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let store = Store::new(root.clone());
        let original = root.join("outside");
        fs::write(&original, CURRENT).unwrap();
        let id = inspect(CURRENT).unwrap().sha256;
        std::os::unix::fs::symlink(original, store.path(&id).unwrap()).unwrap();
        assert!(store.original(&id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
