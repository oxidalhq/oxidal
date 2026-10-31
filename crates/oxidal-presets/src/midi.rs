//! Device-local MIDI map keyed by immutable preset identity.
//! Portable tone and rig payloads never carry controller or device bindings.
use crate::{Error, LibraryKind, LibraryReference, Result};
use oxidal_audio::midi::{Binding, BranchBinding, ParameterBinding, Settings};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const LIMIT: u64 = 16 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PresetMap {
    bindings: Vec<Binding>,
    branch_bindings: Vec<BranchBinding>,
    parameter_bindings: Vec<ParameterBinding>,
}

impl PresetMap {
    fn settings(&self, input: String, channel: u8) -> Settings {
        Settings {
            input,
            channel,
            bindings: self.bindings.clone(),
            branch_bindings: self.branch_bindings.clone(),
            parameter_bindings: self.parameter_bindings.clone(),
        }
    }

    fn from_settings(settings: &Settings) -> Self {
        Self {
            bindings: settings.bindings.clone(),
            branch_bindings: settings.branch_bindings.clone(),
            parameter_bindings: settings.parameter_bindings.clone(),
        }
    }

    fn empty(&self) -> bool {
        self.bindings.is_empty()
            && self.branch_bindings.is_empty()
            && self.parameter_bindings.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    schema: u8,
    input: Option<String>,
    channel: u8,
    entries: BTreeMap<String, PresetMap>,
}

impl Default for Book {
    fn default() -> Self {
        Self {
            schema: 1,
            input: None,
            channel: 1,
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiMapEntry {
    pub entry: LibraryReference,
    pub bindings: Vec<Binding>,
    pub branch_bindings: Vec<BranchBinding>,
    pub parameter_bindings: Vec<ParameterBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiMap {
    pub revision: String,
    pub input: Option<String>,
    pub channel: u8,
    pub entries: Vec<MidiMapEntry>,
}

/// Optimistic whole-map replacement used by the management screen and imports.
/// The revision is deliberately separate from the portable JSON payload so an
/// exported map cannot overwrite changes made after it was downloaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiMapUpdate {
    pub expected_revision: String,
    pub input: Option<String>,
    pub channel: u8,
    pub entries: Vec<MidiMapEntry>,
}

fn identity(key: &str) -> Result<LibraryReference> {
    let (kind, id) = key
        .split_once(':')
        .ok_or(Error::Invalid("Invalid MIDI preset identity"))?;
    let kind = match kind {
        "original" => LibraryKind::Original,
        "owned" => LibraryKind::Owned,
        "graph" => LibraryKind::Graph,
        "rig" => LibraryKind::Rig,
        _ => return Err(Error::Invalid("Invalid MIDI preset kind")),
    };
    kind.key(id)?;
    Ok(LibraryReference {
        kind,
        id: id.into(),
    })
}

fn revision(book: &Book) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(book).map_err(|_| Error::Invalid("Invalid MIDI map"))?)
    ))
}

#[derive(Debug)]
pub struct MidiMapStore {
    root: PathBuf,
}

impl MidiMapStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn read(&self) -> Result<Book> {
        let path = self.root.join("midi-map.json");
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Book::default());
            }
            Err(error) => return Err(error.into()),
        };
        if !metadata.is_file() || metadata.len() > LIMIT {
            return Err(Error::Invalid("Invalid MIDI map file"));
        }
        let mut bytes = Vec::new();
        File::open(path)?.take(LIMIT + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > LIMIT {
            return Err(Error::Invalid("MIDI map exceeds storage limit"));
        }
        let book: Book = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Invalid("MIDI map could not be read"))?;
        if book.schema != 1 || book.channel > 16 || book.entries.len() > 4096 {
            return Err(Error::Invalid("Unsupported or oversized MIDI map"));
        }
        if let Some(input) = &book.input {
            Settings {
                input: input.clone(),
                channel: book.channel,
                bindings: vec![],
                branch_bindings: vec![],
                parameter_bindings: vec![],
            }
            .validate()
            .map_err(|_| Error::Invalid("Invalid MIDI map device"))?;
        }
        for (key, mapping) in &book.entries {
            identity(key)?;
            let input = book.input.clone().unwrap_or_else(|| "hw:Stored,0,0".into());
            mapping
                .settings(input, book.channel)
                .validate()
                .map_err(|_| Error::Invalid("Invalid stored MIDI mapping"))?;
        }
        Ok(book)
    }

    fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(".midi-map.lock");
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(Error::Invalid("Invalid MIDI map lock"));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => (),
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        file.lock()?;
        Ok(file)
    }

    fn write(&self, book: &Book) -> Result<()> {
        let bytes = serde_json::to_vec(book).map_err(|_| Error::Invalid("Invalid MIDI map"))?;
        if bytes.len() as u64 > LIMIT {
            return Err(Error::Invalid("MIDI map exceeds storage limit"));
        }
        let temporary = self.root.join(format!(
            ".midi-map-{}-{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, self.root.join("midi-map.json"))?;
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub fn snapshot(&self) -> Result<MidiMap> {
        let book = self.read()?;
        let revision = revision(&book)?;
        let entries = book
            .entries
            .into_iter()
            .map(|(key, mapping)| {
                Ok(MidiMapEntry {
                    entry: identity(&key)?,
                    bindings: mapping.bindings,
                    branch_bindings: mapping.branch_bindings,
                    parameter_bindings: mapping.parameter_bindings,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(MidiMap {
            revision,
            input: book.input,
            channel: book.channel,
            entries,
        })
    }

    pub fn settings(&self, entry: Option<&LibraryReference>) -> Result<Option<Settings>> {
        let book = self.read()?;
        let Some(input) = book.input else {
            return Ok(None);
        };
        let mapping = entry
            .map(|entry| entry.kind.key(&entry.id))
            .transpose()?
            .and_then(|key| book.entries.get(&key).cloned())
            .unwrap_or_default();
        Ok(Some(mapping.settings(input, book.channel)))
    }

    /// Adopt the legacy mapping embedded in a recovered playback session once.
    /// A real device-local map always wins, including an intentionally disabled one.
    pub fn adopt(
        &self,
        entry: Option<&LibraryReference>,
        settings: Option<&Settings>,
    ) -> Result<()> {
        let Some(settings) = settings else {
            return Ok(());
        };
        let mut settings = settings.clone();
        // CC 0/32 became global Bank Select in schema 1. Preserve the old device,
        // channel and all other mappings rather than making an upgrade unbootable.
        settings.bindings.retain(|binding| {
            !binding
                .controller
                .is_some_and(|controller| matches!(controller, 0 | 32))
        });
        settings
            .branch_bindings
            .retain(|binding| !matches!(binding.controller, 0 | 32));
        settings
            .parameter_bindings
            .retain(|binding| !matches!(binding.controller, 0 | 32));
        settings
            .validate()
            .map_err(|_| Error::Invalid("Invalid legacy MIDI configuration"))?;
        let _lock = self.lock()?;
        match fs::symlink_metadata(self.root.join("midi-map.json")) {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
        let mut book = Book {
            input: Some(settings.input.clone()),
            channel: settings.channel,
            ..Book::default()
        };
        let mapping = PresetMap::from_settings(&settings);
        if !mapping.empty()
            && let Some(entry) = entry
        {
            book.entries.insert(entry.kind.key(&entry.id)?, mapping);
        }
        self.write(&book)
    }

    pub fn configure(&self, entry: LibraryReference, settings: Settings) -> Result<MidiMap> {
        settings
            .validate()
            .map_err(|_| Error::Invalid("Invalid MIDI configuration"))?;
        let key = entry.kind.key(&entry.id)?;
        let _lock = self.lock()?;
        let mut book = self.read()?;
        book.input = Some(settings.input.clone());
        book.channel = settings.channel;
        let mapping = PresetMap::from_settings(&settings);
        if mapping.empty() {
            book.entries.remove(&key);
        } else {
            book.entries.insert(key, mapping);
        }
        self.write(&book)?;
        self.snapshot()
    }

    pub fn replace(&self, update: MidiMapUpdate) -> Result<MidiMap> {
        if update.entries.len() > 4096 || update.channel > 16 {
            return Err(Error::Invalid("Unsupported or oversized MIDI map"));
        }
        let lock = self.lock()?;
        let current = self.read()?;
        if revision(&current)? != update.expected_revision {
            return Err(Error::Conflict("MIDI map changed; refresh before editing"));
        }
        let mut entries = BTreeMap::new();
        for entry in update.entries {
            let key = entry.entry.kind.key(&entry.entry.id)?;
            let mapping = PresetMap {
                bindings: entry.bindings,
                branch_bindings: entry.branch_bindings,
                parameter_bindings: entry.parameter_bindings,
            };
            if mapping.empty() {
                continue;
            }
            let input = update
                .input
                .clone()
                .unwrap_or_else(|| "hw:Stored,0,0".into());
            mapping
                .settings(input, update.channel)
                .validate()
                .map_err(|_| Error::Invalid("Invalid stored MIDI mapping"))?;
            if entries.insert(key, mapping).is_some() {
                return Err(Error::Invalid("Duplicate MIDI preset mapping"));
            }
        }
        if let Some(input) = &update.input {
            Settings {
                input: input.clone(),
                channel: update.channel,
                bindings: vec![],
                branch_bindings: vec![],
                parameter_bindings: vec![],
            }
            .validate()
            .map_err(|_| Error::Invalid("Invalid MIDI map device"))?;
        }
        let book = Book {
            schema: 1,
            input: update.input,
            channel: update.channel,
            entries,
        };
        self.write(&book)?;
        drop(lock);
        self.snapshot()
    }

    pub fn disable(&self) -> Result<MidiMap> {
        let _lock = self.lock()?;
        let mut book = self.read()?;
        book.input = None;
        self.write(&book)?;
        self.snapshot()
    }

    pub fn forget(&self, kind: LibraryKind, id: &str) -> Result<()> {
        let key = kind.key(id)?;
        let _lock = self.lock()?;
        let mut book = self.read()?;
        if book.entries.remove(&key).is_some() {
            self.write(&book)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "oxidal-midi-map-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn entry(id: char) -> LibraryReference {
        LibraryReference {
            kind: LibraryKind::Rig,
            id: id.to_string().repeat(64),
        }
    }

    fn settings(program: u8) -> Settings {
        Settings {
            input: "hw:Controller,0,0".into(),
            channel: 2,
            bindings: vec![Binding {
                scene: "clean".into(),
                program: Some(program),
                controller: None,
            }],
            branch_bindings: vec![],
            parameter_bindings: vec![],
        }
    }

    #[test]
    fn device_is_global_while_mappings_follow_immutable_preset_identity() {
        let root = root("identity");
        let store = MidiMapStore::new(root.clone());
        store.configure(entry('a'), settings(7)).unwrap();
        let mut second = settings(9);
        second.channel = 4;
        store.configure(entry('b'), second).unwrap();
        let first = store.settings(Some(&entry('a'))).unwrap().unwrap();
        let second = store.settings(Some(&entry('b'))).unwrap().unwrap();
        assert_eq!(first.input, "hw:Controller,0,0");
        assert_eq!(first.channel, 4);
        assert_eq!(first.bindings[0].program, Some(7));
        assert_eq!(second.bindings[0].program, Some(9));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn empty_local_map_keeps_global_preset_recall_and_disable_keeps_maps() {
        let root = root("global");
        let store = MidiMapStore::new(root.clone());
        store.configure(entry('a'), settings(7)).unwrap();
        let empty = Settings {
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![],
            branch_bindings: vec![],
            parameter_bindings: vec![],
        };
        store.configure(entry('b'), empty).unwrap();
        assert!(
            store
                .settings(Some(&entry('b')))
                .unwrap()
                .unwrap()
                .bindings
                .is_empty()
        );
        store.disable().unwrap();
        assert!(store.settings(Some(&entry('a'))).unwrap().is_none());
        assert_eq!(store.snapshot().unwrap().entries.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn whole_map_replace_is_validated_and_revision_bound() {
        let root = root("replace");
        let store = MidiMapStore::new(root.clone());
        let initial = store.snapshot().unwrap();
        let updated = store
            .replace(MidiMapUpdate {
                expected_revision: initial.revision.clone(),
                input: Some("hw:Controller,0,0".into()),
                channel: 3,
                entries: vec![MidiMapEntry {
                    entry: entry('a'),
                    bindings: settings(11).bindings,
                    branch_bindings: vec![],
                    parameter_bindings: vec![],
                }],
            })
            .unwrap();
        assert_ne!(updated.revision, initial.revision);
        assert_eq!(updated.channel, 3);
        assert_eq!(updated.entries[0].bindings[0].program, Some(11));

        let stale = store.replace(MidiMapUpdate {
            expected_revision: initial.revision,
            input: None,
            channel: 1,
            entries: vec![],
        });
        assert!(matches!(stale, Err(Error::Conflict(_))));

        let duplicate = store.replace(MidiMapUpdate {
            expected_revision: updated.revision,
            input: Some("hw:Controller,0,0".into()),
            channel: 1,
            entries: vec![
                MidiMapEntry {
                    entry: entry('b'),
                    bindings: settings(1).bindings,
                    branch_bindings: vec![],
                    parameter_bindings: vec![],
                },
                MidiMapEntry {
                    entry: entry('b'),
                    bindings: settings(2).bindings,
                    branch_bindings: vec![],
                    parameter_bindings: vec![],
                },
            ],
        });
        assert!(matches!(duplicate, Err(Error::Invalid(_))));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adopts_a_legacy_mapping_once_without_overwriting_local_state() {
        let root = root("adopt");
        let store = MidiMapStore::new(root.clone());
        let first = entry('a');
        store
            .adopt(Some(&first), Some(&settings(7)))
            .expect("adopt legacy map");
        assert_eq!(store.settings(Some(&first)).unwrap(), Some(settings(7)));

        let second = entry('b');
        store
            .adopt(Some(&second), Some(&settings(8)))
            .expect("existing map wins");
        assert_eq!(store.settings(Some(&first)).unwrap(), Some(settings(7)));
        assert_eq!(
            store.settings(Some(&second)).unwrap().unwrap().bindings,
            vec![]
        );
        fs::remove_dir_all(root).unwrap();
    }
}
