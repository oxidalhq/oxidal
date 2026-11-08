//! Device-local MIDI map keyed by immutable preset identity.
//! Portable tone and rig payloads never carry controller or device bindings.
use crate::{Error, LibraryKind, LibraryReference, Result};
use oxidal_audio::midi::{Binding, BranchBinding, Message, ParameterBinding, Settings};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    template: Option<MidiTemplate>,
    #[serde(default, skip_serializing_if = "Navigation::is_empty")]
    navigation: Navigation,
    entries: BTreeMap<String, PresetMap>,
}

impl Default for Book {
    fn default() -> Self {
        Self {
            schema: 1,
            input: None,
            channel: 1,
            template: None,
            navigation: Navigation::default(),
            entries: BTreeMap::new(),
        }
    }
}

/// One PC or CC press that runs a device-wide action. A Program Change fires
/// on arrival; a CC fires on a value of 64 or more, like scene buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Trigger {
    pub program: Option<u8>,
    pub controller: Option<u8>,
}

impl Trigger {
    fn valid(self) -> bool {
        self.program.is_some() != self.controller.is_some()
            && self.program.is_none_or(|program| program <= 127)
            && self
                .controller
                .is_none_or(|controller| controller <= 127 && !matches!(controller, 0 | 32))
    }

    /// Whether a received message is this trigger's press.
    pub fn matches(self, message: Message) -> bool {
        match message {
            Message::Program { program, .. } => self.program == Some(program),
            Message::Control {
                controller, value, ..
            } => self.controller == Some(controller) && value >= 64,
        }
    }
}

/// Device-wide preset navigation through the current Mine set-list. They sit
/// outside every preset map, so no preset can silently change what they do.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Navigation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<Trigger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<Trigger>,
    /// Flips the output mute, like the Mute button.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mute: Option<Trigger>,
}

/// A device-wide action a footswitch can run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceAction {
    Previous,
    Next,
    MuteToggle,
}

impl Navigation {
    pub fn is_empty(&self) -> bool {
        self.previous.is_none() && self.next.is_none() && self.mute.is_none()
    }

    /// Which device action a message runs, if any.
    pub fn action(&self, message: Message) -> Option<DeviceAction> {
        if self.previous.is_some_and(|t| t.matches(message)) {
            Some(DeviceAction::Previous)
        } else if self.next.is_some_and(|t| t.matches(message)) {
            Some(DeviceAction::Next)
        } else if self.mute.is_some_and(|t| t.matches(message)) {
            Some(DeviceAction::MuteToggle)
        } else {
            None
        }
    }

    fn triggers(&self) -> impl Iterator<Item = Trigger> {
        [self.previous, self.next, self.mute].into_iter().flatten()
    }

    fn validate(&self, entries: &BTreeMap<String, PresetMap>) -> Result<()> {
        let all: Vec<_> = self.triggers().collect();
        if all.iter().any(|t| !t.valid())
            || all.iter().enumerate().any(|(i, a)| all[..i].contains(a))
        {
            return Err(Error::Invalid("Invalid MIDI navigation control"));
        }
        let taken = |program: Option<u8>, controller: Option<u8>| {
            self.triggers().any(|t| {
                (program.is_some() && t.program == program)
                    || (controller.is_some() && t.controller == controller)
            })
        };
        for mapping in entries.values() {
            if mapping
                .bindings
                .iter()
                .any(|b| taken(b.program, b.controller))
                || mapping
                    .branch_bindings
                    .iter()
                    .any(|b| taken(None, Some(b.controller)))
                || mapping
                    .parameter_bindings
                    .iter()
                    .any(|b| taken(None, Some(b.controller)))
            {
                return Err(Error::Invalid(
                    "A MIDI navigation control is also assigned inside a preset",
                ));
            }
        }
        Ok(())
    }
}

/// Unit default for controllers whose buttons emit consecutive CC messages.
/// Program Change remains reserved for the Mine set-list; these buttons select
/// scenes inside the recalled preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiTemplate {
    pub scene_buttons: u8,
    pub first_controller: u8,
}

impl MidiTemplate {
    fn validate(self) -> Result<()> {
        if !matches!(self.scene_buttons, 2 | 4 | 8)
            || self.first_controller >= 128
            || u16::from(self.first_controller) + u16::from(self.scene_buttons) > 128
            || (u16::from(self.first_controller)
                ..u16::from(self.first_controller) + u16::from(self.scene_buttons))
                .any(|controller| matches!(controller, 0 | 32))
        {
            return Err(Error::Invalid("Invalid MIDI controller template"));
        }
        Ok(())
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<MidiTemplate>,
    #[serde(default, skip_serializing_if = "Navigation::is_empty")]
    pub navigation: Navigation,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<MidiTemplate>,
    #[serde(default, skip_serializing_if = "Navigation::is_empty")]
    pub navigation: Navigation,
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
        if let Some(template) = book.template {
            template.validate()?;
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
        book.navigation.validate(&book.entries)?;
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
            template: book.template,
            navigation: book.navigation,
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
        if let Some(template) = update.template {
            template.validate()?;
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
            template: update.template,
            navigation: update.navigation,
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

    fn template_map(template: MidiTemplate, scenes: &[String]) -> Result<PresetMap> {
        template.validate()?;
        let mut unique = BTreeSet::new();
        if scenes.len() > 1024
            || scenes
                .iter()
                .any(|scene| scene.is_empty() || !unique.insert(scene))
        {
            return Err(Error::Invalid("Invalid MIDI template scene list"));
        }
        Ok(PresetMap {
            bindings: scenes
                .iter()
                .take(usize::from(template.scene_buttons))
                .enumerate()
                .map(|(index, scene)| Binding {
                    scene: scene.clone(),
                    program: None,
                    controller: Some(template.first_controller + index as u8),
                })
                .collect(),
            branch_bindings: vec![],
            parameter_bindings: vec![],
        })
    }

    /// Replace one preset's local assignments with the current unit template.
    pub fn apply_template(
        &self,
        expected_revision: &str,
        entry: LibraryReference,
        scenes: &[String],
    ) -> Result<MidiMap> {
        let key = entry.kind.key(&entry.id)?;
        let lock = self.lock()?;
        let mut book = self.read()?;
        if revision(&book)? != expected_revision {
            return Err(Error::Conflict("MIDI map changed; refresh before editing"));
        }
        let template = book
            .template
            .ok_or(Error::Invalid("Choose a MIDI controller template first"))?;
        let mapping = Self::template_map(template, scenes)?;
        if mapping.empty() {
            book.entries.remove(&key);
        } else {
            book.entries.insert(key, mapping);
        }
        self.write(&book)?;
        drop(lock);
        self.snapshot()
    }

    /// Give a newly published scene preset the unit template once. Retrying a
    /// publication never overwrites an explicit map the musician already made.
    pub fn inherit_template(&self, entry: LibraryReference, scenes: &[String]) -> Result<()> {
        let key = entry.kind.key(&entry.id)?;
        let _lock = self.lock()?;
        let mut book = self.read()?;
        if book.entries.contains_key(&key) {
            return Ok(());
        }
        let Some(template) = book.template else {
            return Ok(());
        };
        let mapping = Self::template_map(template, scenes)?;
        if !mapping.empty() {
            book.entries.insert(key, mapping);
            self.write(&book)?;
        }
        Ok(())
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
    fn navigation_is_global_validated_and_never_overlaps_a_preset_mapping() {
        let root = root("navigation");
        let store = MidiMapStore::new(root);
        let initial = store.snapshot().unwrap();
        let program = |p| Trigger {
            program: Some(p),
            controller: None,
        };
        let update = |nav: Navigation, entries: Vec<MidiMapEntry>, revision: &str| MidiMapUpdate {
            navigation: nav,
            expected_revision: revision.into(),
            input: Some("hw:Controller,0,0".into()),
            channel: 1,
            template: None,
            entries,
        };
        let nav = Navigation {
            previous: Some(program(2)),
            next: Some(Trigger {
                program: None,
                controller: Some(21),
            }),
            mute: Some(Trigger {
                program: None,
                controller: Some(22),
            }),
        };
        let saved = store
            .replace(update(nav, vec![], &initial.revision))
            .unwrap();
        assert_eq!(saved.navigation, nav);
        assert_ne!(saved.revision, initial.revision);
        // Same trigger twice, Bank Select and a trigger with both fields are refused.
        for bad in [
            Navigation {
                previous: Some(program(2)),
                next: Some(program(2)),
                mute: None,
            },
            // Mute may not reuse Previous either.
            Navigation {
                previous: Some(program(2)),
                next: None,
                mute: Some(program(2)),
            },
            Navigation {
                previous: Some(Trigger {
                    program: None,
                    controller: Some(32),
                }),
                next: None,
                mute: None,
            },
            Navigation {
                previous: Some(Trigger {
                    program: Some(1),
                    controller: Some(21),
                }),
                next: None,
                mute: None,
            },
        ] {
            assert!(matches!(
                store.replace(update(bad, vec![], &saved.revision)),
                Err(Error::Invalid(_))
            ));
        }
        // A scene binding on the Previous Program would run two actions: refused.
        let overlapping = vec![MidiMapEntry {
            entry: entry('a'),
            bindings: settings(2).bindings,
            branch_bindings: vec![],
            parameter_bindings: vec![],
        }];
        assert!(matches!(
            store.replace(update(nav, overlapping, &saved.revision)),
            Err(Error::Invalid(_))
        ));
        let press = |controller, value| Message::Control {
            channel: 1,
            controller,
            value,
        };
        assert_eq!(
            nav.action(Message::Program {
                channel: 1,
                program: 2
            }),
            Some(DeviceAction::Previous)
        );
        assert_eq!(nav.action(press(21, 127)), Some(DeviceAction::Next));
        assert_eq!(nav.action(press(22, 127)), Some(DeviceAction::MuteToggle));
        assert_eq!(nav.action(press(21, 0)), None, "release is not a press");
        let cleared = store
            .replace(update(Navigation::default(), vec![], &saved.revision))
            .unwrap();
        assert!(cleared.navigation.is_empty());
        assert_ne!(cleared.revision, saved.revision);
        // An empty navigation is not serialized, so maps saved before this
        // field existed keep their revision (value recorded from the prior build).
        assert_eq!(
            initial.revision,
            "38eb924807afdfc80f86e87b767cfecb01000b48928f176256ab153593285691"
        );
    }

    #[test]
    fn whole_map_replace_is_validated_and_revision_bound() {
        let root = root("replace");
        let store = MidiMapStore::new(root.clone());
        let initial = store.snapshot().unwrap();
        let updated = store
            .replace(MidiMapUpdate {
                navigation: Navigation::default(),
                expected_revision: initial.revision.clone(),
                input: Some("hw:Controller,0,0".into()),
                channel: 3,
                template: None,
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
            navigation: Navigation::default(),
            expected_revision: initial.revision,
            input: None,
            channel: 1,
            template: None,
            entries: vec![],
        });
        assert!(matches!(stale, Err(Error::Conflict(_))));

        let duplicate = store.replace(MidiMapUpdate {
            navigation: Navigation::default(),
            expected_revision: updated.revision,
            input: Some("hw:Controller,0,0".into()),
            channel: 1,
            template: None,
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
    fn scene_template_applies_and_new_presets_inherit_once() {
        let root = root("template");
        let store = MidiMapStore::new(root.clone());
        let initial = store.snapshot().unwrap();
        let configured = store
            .replace(MidiMapUpdate {
                navigation: Navigation::default(),
                expected_revision: initial.revision,
                input: Some("hw:Controller,0,0".into()),
                channel: 1,
                template: Some(MidiTemplate {
                    scene_buttons: 4,
                    first_controller: 40,
                }),
                entries: vec![],
            })
            .unwrap();
        let scenes = vec![
            "clean".into(),
            "crunch".into(),
            "lead".into(),
            "ambient".into(),
            "extra".into(),
        ];
        let first = entry('a');
        let applied = store
            .apply_template(&configured.revision, first.clone(), &scenes)
            .unwrap();
        assert_eq!(applied.entries[0].bindings.len(), 4);
        assert_eq!(applied.entries[0].bindings[0].controller, Some(40));
        assert_eq!(applied.entries[0].bindings[3].scene, "ambient");

        let second = entry('b');
        store
            .inherit_template(second.clone(), &scenes[..2])
            .unwrap();
        assert_eq!(
            store
                .settings(Some(&second))
                .unwrap()
                .unwrap()
                .bindings
                .len(),
            2
        );
        let manual = settings(9);
        store.configure(second.clone(), manual.clone()).unwrap();
        store.inherit_template(second.clone(), &scenes).unwrap();
        assert_eq!(
            store.settings(Some(&second)).unwrap().unwrap().bindings,
            manual.bindings
        );

        let bad = store.replace(MidiMapUpdate {
            navigation: Navigation::default(),
            expected_revision: store.snapshot().unwrap().revision,
            input: None,
            channel: 1,
            template: Some(MidiTemplate {
                scene_buttons: 8,
                first_controller: 28,
            }),
            entries: vec![],
        });
        assert!(matches!(bad, Err(Error::Invalid(_))));
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
