use super::{
    FILE_NAME, MAX_LINKS, MAX_REGISTRY, MAX_SHEETS, MAX_SOURCE, SheetArchive, SheetDelete,
    SheetDocument, SheetLink, SheetLinkUpdate, SheetRestore, SheetTarget, SheetWrite,
};
use crate::media::{MediaError, Store, new_id, sync_dir, valid_id, valid_title};
use axum::http::StatusCode;
use oxidal_presets::LibraryKind;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const SCHEMA: u32 = 1;

#[derive(Debug)]
pub(super) enum SheetError {
    Invalid(&'static str),
    TooLarge,
    NotFound,
    Conflict(&'static str),
    Corrupt(Option<String>),
    NoSpace,
    Unavailable,
}

impl SheetError {
    pub(super) fn description(self) -> (StatusCode, &'static str, Option<String>) {
        let (status, message) = match self {
            Self::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            Self::TooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "Chord sheet storage limit exceeded",
            ),
            Self::NotFound => (StatusCode::NOT_FOUND, "Chord sheet no longer exists"),
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::Corrupt(digest) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Chord sheet registry is damaged or unreadable",
                    digest,
                );
            }
            Self::NoSpace => (
                StatusCode::INSUFFICIENT_STORAGE,
                "Insufficient space for chord sheets",
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Chord sheet storage is unavailable",
            ),
        };
        (status, message, None)
    }
}

impl From<io::Error> for SheetError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::StorageFull {
            Self::NoSpace
        } else {
            Self::Unavailable
        }
    }
}

impl From<MediaError> for SheetError {
    fn from(error: MediaError) -> Self {
        match error {
            MediaError::NoSpace(_) => Self::NoSpace,
            _ => Self::Unavailable,
        }
    }
}

fn stale() -> SheetError {
    SheetError::Conflict("Chord sheets changed. Refresh and review before trying again")
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Registry {
    schema: u32,
    pub revision: String,
    pub sheets: Vec<SheetDocument>,
    pub links: Vec<SheetLink>,
}

pub(super) struct Save {
    pub warning: Option<String>,
}

enum ReadState {
    Missing,
    Valid(Registry),
    Damaged(Vec<u8>),
}

enum BoundedFile {
    Missing,
    Invalid,
    Contents(Vec<u8>),
}

fn read_file(path: &Path) -> Result<BoundedFile, SheetError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(BoundedFile::Missing),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || metadata.len() > MAX_REGISTRY as u64 {
        return Ok(BoundedFile::Invalid);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Ok(BoundedFile::Invalid);
    }
    let mut bytes = Vec::new();
    file.take(MAX_REGISTRY as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_REGISTRY {
        return Ok(BoundedFile::Invalid);
    }
    Ok(BoundedFile::Contents(bytes))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn target_key(target: &SheetTarget) -> (Option<LibraryKind>, &str) {
    match target {
        SheetTarget::Preset { preset } => (Some(preset.kind), &preset.id),
        SheetTarget::Track { asset } => (None, asset),
    }
}

fn target_valid(target: &SheetTarget) -> bool {
    match target {
        SheetTarget::Preset { preset } => hex_digest(&preset.id),
        SheetTarget::Track { asset } => valid_id(asset),
    }
}

fn validate_text(title: &str, source: &str) -> Result<(), SheetError> {
    if title.chars().count() > 120 || valid_title(title).is_err() {
        return Err(SheetError::Invalid(
            "Chord sheet title must contain 1–120 characters",
        ));
    }
    if source.len() > MAX_SOURCE {
        return Err(SheetError::TooLarge);
    }
    if source.is_empty()
        || source
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r'))
    {
        return Err(SheetError::Invalid(
            "Use a nonempty UTF-8 chord sheet without binary controls",
        ));
    }
    Ok(())
}

fn validate_contents(
    schema: u32,
    sheets: &[SheetDocument],
    links: &[SheetLink],
) -> Result<(), SheetError> {
    if schema != SCHEMA {
        return Err(SheetError::Invalid("Unsupported chord sheet schema"));
    }
    if sheets.len() > MAX_SHEETS || links.len() > MAX_LINKS {
        return Err(SheetError::TooLarge);
    }
    let mut ids = HashSet::new();
    for sheet in sheets {
        validate_text(&sheet.title, &sheet.source)?;
        if !valid_id(&sheet.id) || !valid_id(&sheet.revision) || !ids.insert(sheet.id.as_str()) {
            return Err(SheetError::Invalid(
                "Invalid or duplicate chord sheet identity",
            ));
        }
    }
    let mut targets = BTreeSet::new();
    if links.iter().any(|link| {
        !target_valid(&link.target)
            || !ids.contains(link.sheet.as_str())
            || !targets.insert(target_key(&link.target))
    }) {
        return Err(SheetError::Invalid("Invalid or duplicate chord sheet link"));
    }
    Ok(())
}

impl Registry {
    fn empty() -> Self {
        Self {
            schema: SCHEMA,
            revision: String::new(),
            sheets: vec![],
            links: vec![],
        }
    }

    fn read_state(store: &Store) -> Result<ReadState, SheetError> {
        let bytes = match read_file(&store.root().join(FILE_NAME))? {
            BoundedFile::Missing => return Ok(ReadState::Missing),
            BoundedFile::Invalid => return Err(SheetError::Corrupt(None)),
            BoundedFile::Contents(bytes) => bytes,
        };
        match serde_json::from_slice::<Self>(&bytes) {
            Ok(registry)
                if valid_id(&registry.revision)
                    && validate_contents(registry.schema, &registry.sheets, &registry.links)
                        .is_ok() =>
            {
                Ok(ReadState::Valid(registry))
            }
            _ => Ok(ReadState::Damaged(bytes)),
        }
    }

    pub(super) fn load(store: &Store) -> Result<Self, SheetError> {
        match Self::read_state(store)? {
            ReadState::Missing => Ok(Self::empty()),
            ReadState::Valid(registry) => Ok(registry),
            ReadState::Damaged(bytes) => Err(SheetError::Corrupt(Some(digest(&bytes)))),
        }
    }

    pub(super) fn snapshot(store: &Store) -> Result<Option<Vec<u8>>, SheetError> {
        match Self::read_state(store)? {
            ReadState::Missing => Ok(None),
            ReadState::Valid(registry) => registry.archive_bytes().map(Some),
            ReadState::Damaged(bytes) => Err(SheetError::Corrupt(Some(digest(&bytes)))),
        }
    }

    pub(super) fn archive_bytes(&self) -> Result<Vec<u8>, SheetError> {
        #[derive(Serialize)]
        struct Archive<'a> {
            schema: u32,
            sheets: &'a [SheetDocument],
            links: &'a [SheetLink],
        }
        let archive = Archive {
            schema: self.schema,
            sheets: &self.sheets,
            links: &self.links,
        };
        let bytes = serde_json::to_vec(&archive).map_err(|_| SheetError::Unavailable)?;
        if bytes.len() > MAX_REGISTRY {
            return Err(SheetError::TooLarge);
        }
        Ok(bytes)
    }

    pub(super) fn document(&self, id: &str) -> Result<&SheetDocument, SheetError> {
        if !valid_id(id) {
            return Err(SheetError::NotFound);
        }
        self.sheets
            .iter()
            .find(|sheet| sheet.id == id)
            .ok_or(SheetError::NotFound)
    }

    pub(super) fn create(&mut self, request: SheetWrite) -> Result<SheetDocument, SheetError> {
        if self.revision != request.expected {
            return Err(stale());
        }
        if self.sheets.len() >= MAX_SHEETS {
            return Err(SheetError::TooLarge);
        }
        let title = request.title;
        validate_text(&title, &request.source)?;
        let sheet = SheetDocument {
            id: new_id(),
            revision: new_id(),
            title,
            format: request.format,
            source: request.source,
        };
        if self.sheets.iter().any(|existing| existing.id == sheet.id) {
            return Err(SheetError::Unavailable);
        }
        self.sheets.push(sheet.clone());
        self.revision = new_id();
        Ok(sheet)
    }

    pub(super) fn update(
        &mut self,
        id: &str,
        request: SheetWrite,
    ) -> Result<SheetDocument, SheetError> {
        let sheet = self
            .sheets
            .iter_mut()
            .find(|sheet| sheet.id == id)
            .ok_or(SheetError::NotFound)?;
        if sheet.revision != request.expected {
            return Err(stale());
        }
        let title = request.title;
        validate_text(&title, &request.source)?;
        sheet.title = title;
        sheet.format = request.format;
        sheet.source = request.source;
        sheet.revision = new_id();
        self.revision = new_id();
        Ok(sheet.clone())
    }

    pub(super) fn delete(
        &mut self,
        id: &str,
        request: &SheetDelete,
    ) -> Result<SheetDocument, SheetError> {
        if self.revision != request.registry_revision
            || self.document(id)?.revision != request.expected
        {
            return Err(stale());
        }
        if self.links.iter().any(|link| link.sheet == id) {
            return Err(SheetError::Conflict(
                "Unlink this chord sheet before deleting it",
            ));
        }
        let index = self
            .sheets
            .iter()
            .position(|sheet| sheet.id == id)
            .ok_or(SheetError::NotFound)?;
        self.revision = new_id();
        Ok(self.sheets.remove(index))
    }

    pub(super) fn update_link(&mut self, request: SheetLinkUpdate) -> Result<(), SheetError> {
        if self.revision != request.expected {
            return Err(stale());
        }
        if !target_valid(&request.target) {
            return Err(SheetError::Invalid("Invalid chord sheet link target"));
        }
        self.links.retain(|link| link.target != request.target);
        if let Some(sheet) = request.sheet {
            self.document(&sheet)?;
            if self.links.len() >= MAX_LINKS {
                return Err(SheetError::TooLarge);
            }
            self.links.push(SheetLink {
                target: request.target,
                sheet,
            });
        }
        self.revision = new_id();
        Ok(())
    }

    fn bytes(&self) -> Result<Vec<u8>, SheetError> {
        let bytes = serde_json::to_vec(self).map_err(|_| SheetError::Unavailable)?;
        if bytes.len() > MAX_REGISTRY {
            return Err(SheetError::TooLarge);
        }
        Ok(bytes)
    }

    pub(super) fn save(&self, store: &Store) -> Result<Save, SheetError> {
        let bytes = self.bytes()?;
        store.admit(bytes.len() as u64)?;
        self.commit(store, &bytes, |from, to| fs::rename(from, to), sync_dir)
    }

    fn commit(
        &self,
        store: &Store,
        bytes: &[u8],
        rename: impl FnOnce(&Path, &Path) -> io::Result<()>,
        sync: impl FnOnce(&Path) -> io::Result<()>,
    ) -> Result<Save, SheetError> {
        let root = store.root();
        let temp = root.join(format!(".chord-sheets-{}.tmp", new_id()));
        let mut file = new_file(&temp)?;
        let temporary = TemporaryFile(temp);
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename(&temporary.0, &root.join(FILE_NAME))?;

        let warning = match sync(root) {
            Ok(()) => None,
            Err(_) if Self::load(store).is_ok_and(|visible| visible.revision == self.revision) => {
                Some("Chord sheets are visible. A storage sync failed, so they may not survive a restart.".into())
            }
            Err(_) => return Err(SheetError::Unavailable),
        };
        Ok(Save { warning })
    }

    pub(super) fn restore(
        store: &Store,
        request: SheetRestore,
    ) -> Result<(Self, Save), SheetError> {
        let SheetArchive {
            schema,
            mut sheets,
            links,
        } = request.archive;
        validate_contents(schema, &sheets, &links)?;
        let damaged = match (
            request.expected.as_deref(),
            request.damaged_sha256.as_deref(),
            Self::read_state(store)?,
        ) {
            (Some(""), None, ReadState::Missing) => None,
            (Some(expected), None, ReadState::Valid(current))
                if current.revision == expected && current.sheets.is_empty() =>
            {
                None
            }
            (None, Some(expected), ReadState::Damaged(bytes))
                if hex_digest(expected) && digest(&bytes) == expected =>
            {
                Some((expected, bytes))
            }
            (Some(_), None, ReadState::Valid(current)) if !current.sheets.is_empty() => {
                return Err(SheetError::Conflict(
                    "Restore requires an empty chord sheet library",
                ));
            }
            (Some(_), None, _) | (None, Some(_), _) => return Err(stale()),
            _ => {
                return Err(SheetError::Invalid(
                    "Confirm the empty revision or the damaged registry digest",
                ));
            }
        };
        for sheet in &mut sheets {
            sheet.revision = new_id();
        }
        let registry = Self {
            schema: SCHEMA,
            revision: new_id(),
            sheets,
            links,
        };
        let bytes = registry.bytes()?;
        let quarantine_bytes = damaged.as_ref().map_or(0, |(_, bytes)| bytes.len());
        store.admit((bytes.len() + quarantine_bytes) as u64)?;
        if let Some((digest, original)) = damaged {
            quarantine(store.root(), digest, &original)?;
        }
        let save = registry.commit(store, &bytes, |from, to| fs::rename(from, to), sync_dir)?;
        Ok((registry, save))
    }
}

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn new_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn quarantine(root: &Path, digest: &str, bytes: &[u8]) -> Result<(), SheetError> {
    let path = root.join(format!("chord-sheets-damaged-{digest}.json"));
    match new_file(&path) {
        Ok(mut file) => {
            if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
                drop(file);
                let _ = fs::remove_file(path);
                return Err(error.into());
            }
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            // A previous restore can have archived the original before failing to publish.
            if !matches!(read_file(&path)?, BoundedFile::Contents(saved) if saved == bytes) {
                return Err(SheetError::Conflict(
                    "The damaged registry quarantine is occupied",
                ));
            }
        }
        Err(error) => return Err(error.into()),
    }
    sync_dir(root)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheets::SheetFormat;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("oxidal-sheets-{}", new_id())))
        }

        fn open(&self) -> Store {
            Store::open(&self.0).unwrap()
        }

        fn registry_path(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn initial(store: &Store) -> (Registry, String) {
        let mut registry = Registry::load(store).unwrap();
        let sheet = registry
            .create(SheetWrite {
                expected: registry.revision.clone(),
                title: "Original".into(),
                format: SheetFormat::Chordpro,
                source: "[Am]Song\r\n".into(),
            })
            .unwrap();
        registry.save(store).unwrap();
        (registry, sheet.id)
    }

    #[test]
    fn sheets_pre_rename_failure_cleans_temp_and_post_rename_failure_reports_visible_revision() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let (mut registry, id) = initial(&store);
        let old_bytes = fs::read(fixture.registry_path()).unwrap();
        let expected = registry.document(&id).unwrap().revision.clone();
        let change = registry
            .update(
                &id,
                SheetWrite {
                    expected,
                    title: "Updated".into(),
                    format: SheetFormat::Text,
                    source: "New".into(),
                },
            )
            .unwrap();
        let bytes = registry.bytes().unwrap();
        let denied = registry.commit(
            &store,
            &bytes,
            |_, _| Err(io::ErrorKind::StorageFull.into()),
            |_| unreachable!(),
        );
        assert!(matches!(denied, Err(SheetError::NoSpace)));
        assert_eq!(fs::read(fixture.registry_path()).unwrap(), old_bytes);
        assert!(fs::read_dir(store.root()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));

        let visible = registry
            .commit(
                &store,
                &bytes,
                |from, to| fs::rename(from, to),
                |_| Err(io::ErrorKind::PermissionDenied.into()),
            )
            .unwrap();
        assert!(visible.warning.is_some());
        let reopened = fixture.open();
        let read = Registry::load(&reopened).unwrap();
        assert_eq!(read.revision, registry.revision);
        assert_eq!(read.document(&id).unwrap().revision, change.revision);
        assert_eq!(read.document(&id).unwrap().source, "New");
    }

    #[test]
    fn sheets_storage_reserve_refuses_writes_and_restart_never_promotes_temp() {
        let fixture = Fixture::new();
        let store = fixture.open();
        let (mut registry, id) = initial(&store);
        let mut staged = fixture.0.join(".chord-sheets-interrupted");
        staged.set_extension("tmp");
        let original = fs::read(fixture.registry_path()).unwrap();
        fs::write(&staged, &original).unwrap();
        fs::write(
            fixture.0.join("store.json"),
            br#"{"schema":1,"reserve_bytes":18446744073709551615}"#,
        )
        .unwrap();

        let expected = registry.document(&id).unwrap().revision.clone();
        registry
            .update(
                &id,
                SheetWrite {
                    expected,
                    title: "Updated".into(),
                    format: SheetFormat::Text,
                    source: "No room".into(),
                },
            )
            .unwrap();
        let reopened = fixture.open();
        assert!(matches!(registry.save(&reopened), Err(SheetError::NoSpace)));
        assert_eq!(fs::read(fixture.registry_path()).unwrap(), original);
        assert_eq!(
            Registry::load(&reopened)
                .unwrap()
                .document(&id)
                .unwrap()
                .title,
            "Original"
        );
        fs::remove_file(fixture.registry_path()).unwrap();
        let reopened = fixture.open();
        assert!(Registry::load(&reopened).unwrap().sheets.is_empty());
    }
}
