//! Device-local descriptive metadata; immutable audio payloads are never rewritten.
//! @see docs/presets/format.md
use crate::{
    BundleStore, CatalogStore, Error, GraphStore, LibraryKind, LibraryReference, OwnedStore,
    Result, Store, inspect,
};
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CopyCredit {
    pub source: LibraryReference,
    pub name: String,
}
/// The fixed genre list for Oxidal sounds; 1–3 per preset.
pub const GENRES: [&str; 17] = [
    "Clean",
    "Edge of breakup",
    "Funk",
    "Blues",
    "Country",
    "Jazz",
    "Pop",
    "Classic rock",
    "Hard rock",
    "Modern metal",
    "Progressive",
    "Ambient",
    "Post-rock",
    "Synth",
    "Bass",
    "Lo-fi",
    "Experimental",
];
const ENGINES: [&str; 4] = ["lv2", "tone3000-a2-lite", "tone3000-a2-full", "hybrid"];
const COMPLEXITIES: [&str; 3] = ["simple", "layered", "complex"];
const ERAS: [&str; 4] = ["80s", "90s", "2000s", "Modern"];
/// Filterable sound metadata that travels with a built preset. Optional on
/// read: presets built before it existed carry none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RecipeMetadata {
    /// One to three entries from the fixed genre list.
    pub genres: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub techniques: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
    /// `lv2`, `tone3000-a2-lite`, `tone3000-a2-full` or `hybrid`.
    pub engine: String,
    /// `simple`, `layered` or `complex`.
    pub complexity: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub inspiration: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub performance: String,
    /// Derived: LV2 packs the sound needs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_packs: Vec<String>,
    /// Derived: TONE3000 tone ids the sound needs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_tones: Vec<u32>,
    /// Derived: processing blocks in the sound.
    #[serde(default)]
    pub block_count: u32,
    /// Derived: simultaneous NAM instances.
    #[serde(default)]
    pub nam_instances: u32,
}
fn text_ok(text: &str, limit: usize) -> bool {
    text.chars().count() <= limit
        && !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}
fn short_ok(text: &str) -> bool {
    !text.trim().is_empty()
        && text.chars().count() <= 48
        && !text.chars().any(char::is_control)
        && !text.contains(',')
}
fn clean_metadata(mut m: RecipeMetadata) -> Result<RecipeMetadata> {
    let mut seen = BTreeSet::new();
    m.genres.retain(|g| seen.insert(g.clone()));
    let mut seen = BTreeSet::new();
    m.techniques = m.techniques.into_iter().map(|t| t.trim().into()).collect();
    m.techniques
        .retain(|t: &String| seen.insert(t.to_lowercase()));
    m.inspiration = m.inspiration.replace("\r\n", "\n").trim().into();
    m.performance = m.performance.replace("\r\n", "\n").trim().into();
    if !(1..=3).contains(&m.genres.len())
        || m.genres.iter().any(|g| !GENRES.contains(&g.as_str()))
        || m.techniques.len() > 8
        || !m.techniques.iter().all(|t| short_ok(t))
        || m.era.as_deref().is_some_and(|e| !ERAS.contains(&e))
        || !ENGINES.contains(&m.engine.as_str())
        || !COMPLEXITIES.contains(&m.complexity.as_str())
        || !text_ok(&m.inspiration, 600)
        || !text_ok(&m.performance, 800)
        || m.required_packs.len() > 16
        || !m.required_packs.iter().all(|p| short_ok(p))
        || m.required_tones.len() > 64
        || m.block_count > 256
        || m.nam_instances > 64
        || (m.engine == "lv2") != (m.nam_instances == 0)
    {
        return Err(Error::Invalid(
            "Use 1–3 listed genres, a known engine and complexity, and valid sound metadata",
        ));
    }
    Ok(m)
}
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PresetDetails {
    pub description: String,
    pub categories: Vec<String>,
    pub copied_from: Option<CopyCredit>,
    /// Absent on presets built without sound metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<RecipeMetadata>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DetailsEntry {
    pub entry: LibraryReference,
    pub details: PresetDetails,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DetailsCatalog {
    pub revision: String,
    pub entries: Vec<DetailsEntry>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DetailsUpdate {
    pub expected_revision: String,
    pub entry_kind: LibraryKind,
    pub id: String,
    pub description: String,
    pub categories: Vec<String>,
    /// Omit to keep the sound metadata the preset already has.
    #[serde(default)]
    pub metadata: Option<RecipeMetadata>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    schema: u8,
    entries: BTreeMap<String, PresetDetails>,
}
impl Default for Book {
    fn default() -> Self {
        Self {
            schema: 1,
            entries: BTreeMap::new(),
        }
    }
}
fn identity(key: &str) -> Result<LibraryReference> {
    let (kind, id) = key
        .split_once(':')
        .ok_or(Error::Invalid("Invalid preset details identity"))?;
    let kind = match kind {
        "original" => LibraryKind::Original,
        "owned" => LibraryKind::Owned,
        "rig" => LibraryKind::Rig,
        "graph" => LibraryKind::Graph,
        _ => return Err(Error::Invalid("Invalid preset details kind")),
    };
    kind.key(id)?;
    Ok(LibraryReference {
        kind,
        id: id.into(),
    })
}
fn normalize(description: String, categories: Vec<String>) -> Result<PresetDetails> {
    if description.chars().count() > 4000
        || description
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        || categories.len() > 16
    {
        return Err(Error::Invalid(
            "Use a description up to 4,000 characters and at most 16 categories",
        ));
    }
    let mut seen = BTreeSet::new();
    let mut cleaned = Vec::new();
    for category in categories {
        let category = category.trim();
        if category.is_empty()
            || category.chars().count() > 48
            || category.chars().any(char::is_control)
            || category.contains(',')
        {
            return Err(Error::Invalid(
                "Use category names of 1–48 characters without commas or control characters",
            ));
        }
        if seen.insert(category.to_lowercase()) {
            cleaned.push(category.into());
        }
    }
    Ok(PresetDetails {
        description: description.replace("\r\n", "\n").trim().into(),
        categories: cleaned,
        copied_from: None,
        metadata: None,
    })
}
fn revision(book: &Book) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(book).map_err(|_| Error::Invalid("Invalid preset details"))?
        )
    ))
}
#[derive(Debug)]
pub struct DetailsStore {
    root: PathBuf,
}
impl DetailsStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn read(&self) -> Result<Book> {
        let path = self.root.join("preset-details.json");
        let metadata = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Book::default()),
            Err(e) => return Err(e.into()),
        };
        if !metadata.is_file() || metadata.len() > LIMIT {
            return Err(Error::Invalid("Invalid preset details file"));
        }
        let mut bytes = Vec::new();
        File::open(path)?.take(LIMIT + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > LIMIT {
            return Err(Error::Invalid("Preset details exceed storage limit"));
        }
        let book: Book = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Invalid("Preset details could not be read"))?;
        if book.schema != 1 || book.entries.len() > 4096 {
            return Err(Error::Invalid("Unsupported or oversized preset details"));
        }
        for (key, details) in &book.entries {
            identity(key)?;
            let normalized = normalize(details.description.clone(), details.categories.clone())?;
            if normalized.description != details.description
                || normalized.categories != details.categories
            {
                return Err(Error::Invalid("Invalid stored preset details"));
            }
            if let Some(metadata) = &details.metadata
                && clean_metadata(metadata.clone())? != *metadata
            {
                return Err(Error::Invalid("Invalid stored preset metadata"));
            }
            if let Some(credit) = &details.copied_from {
                credit.source.kind.key(&credit.source.id)?;
                if credit.name.is_empty()
                    || credit.name.chars().count() > 160
                    || credit.name.chars().any(char::is_control)
                {
                    return Err(Error::Invalid("Invalid copy credit"));
                }
            }
        }
        Ok(book)
    }
    fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(".preset-details.lock");
        match fs::symlink_metadata(&path) {
            Ok(m) if !m.is_file() => return Err(Error::Invalid("Invalid preset details lock")),
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => (),
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        // Native/audio/mixed copy workers are separate processes; an in-memory
        // mutex alone would lose concurrent edits to this shared metadata file.
        file.lock()?;
        Ok(file)
    }
    fn write(&self, book: &Book) -> Result<()> {
        if book.entries.len() > 4096 {
            return Err(Error::Invalid("Preset details entry limit reached"));
        }
        let bytes =
            serde_json::to_vec(book).map_err(|_| Error::Invalid("Invalid preset details"))?;
        if bytes.len() as u64 > LIMIT {
            return Err(Error::Invalid("Preset details exceed storage limit"));
        }
        let temporary = self.root.join(format!(
            ".preset-details-{}-{}.tmp",
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
            fs::rename(&temporary, self.root.join("preset-details.json"))?;
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
    fn catalog(book: Book) -> Result<DetailsCatalog> {
        let revision = revision(&book)?;
        let entries = book
            .entries
            .into_iter()
            .map(|(key, details)| {
                Ok(DetailsEntry {
                    entry: identity(&key)?,
                    details,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(DetailsCatalog { revision, entries })
    }
    pub fn snapshot(&self) -> Result<DetailsCatalog> {
        Self::catalog(self.read()?)
    }
    /// The caller verifies that the selected immutable library entry exists.
    pub fn update(&self, request: DetailsUpdate) -> Result<DetailsCatalog> {
        let key = request.entry_kind.key(&request.id)?;
        let mut details = normalize(request.description, request.categories)?;
        let _lock = self.lock()?;
        let mut book = self.read()?;
        if revision(&book)? != request.expected_revision {
            return Err(Error::Conflict(
                "Preset details changed; refresh before saving",
            ));
        }
        let existing = book.entries.get(&key);
        details.copied_from = existing.and_then(|d| d.copied_from.clone());
        details.metadata = match request.metadata {
            Some(m) => Some(clean_metadata(m)?),
            None => existing.and_then(|d| d.metadata.clone()),
        };
        let old = book.clone();
        if details == PresetDetails::default() {
            book.entries.remove(&key);
        } else {
            book.entries.insert(key, details);
        }
        if book != old {
            self.write(&book)?;
        }
        Self::catalog(book)
    }
    /// Copy metadata before publishing a new payload. An existing target's own
    /// details always win, including a retry after an interrupted publication.
    pub fn inherit(&self, target: LibraryReference, source: LibraryReference) -> Result<()> {
        let target_key = target.kind.key(&target.id)?;
        let source_key = source.kind.key(&source.id)?;
        if target_key == source_key {
            return Ok(());
        }
        // No metadata means no mutation or source lookup for legacy save paths.
        if !self.read()?.entries.contains_key(&source_key) {
            return Ok(());
        }
        let _lock = self.lock()?;
        let mut book = self.read()?;
        if book.entries.contains_key(&target_key) {
            return Ok(());
        }
        let Some(mut details) = book.entries.get(&source_key).cloned() else {
            return Ok(());
        };
        let name = match source.kind {
            LibraryKind::Original => {
                inspect(&Store::new(self.root.clone()).original(&source.id)?)?.name
            }
            LibraryKind::Owned => {
                OwnedStore::new(self.root.join("owned"))
                    .read(&source.id)?
                    .0
                    .preset
                    .name
            }
            LibraryKind::Rig => {
                BundleStore::new(self.root.join("bundles"))
                    .manifest(&source.id)?
                    .name
            }
            LibraryKind::Graph => {
                GraphStore::new(self.root.join("graphs"))
                    .read(&source.id)?
                    .preset
                    .name
            }
        };
        let catalog = CatalogStore::open(self.root.clone())?;
        let name = catalog
            .label(source.kind, &source.id, &name)?
            .chars()
            .filter(|c| !c.is_control())
            .take(160)
            .collect::<String>();
        details.copied_from = Some(CopyCredit {
            source,
            name: if name.is_empty() {
                "Preset".into()
            } else {
                name
            },
        });
        book.entries.insert(target_key, details);
        self.write(&book)
    }
    pub fn forget(&self, kind: LibraryKind, id: &str) -> Result<()> {
        let key = kind.key(id)?;
        if !self.read()?.entries.contains_key(&key) {
            return Ok(());
        }
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
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "oxidal-details-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn store(&self) -> DetailsStore {
            DetailsStore::new(self.0.clone())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn update(
        store: &DetailsStore,
        kind: LibraryKind,
        id: &str,
        description: &str,
        categories: &[&str],
    ) -> Result<DetailsCatalog> {
        store.update(DetailsUpdate {
            expected_revision: store.snapshot()?.revision,
            entry_kind: kind,
            id: id.into(),
            description: description.into(),
            categories: categories.iter().map(|s| (*s).into()).collect(),
            metadata: None,
        })
    }
    fn meta(genres: &[&str], engine: &str, nam: u32) -> RecipeMetadata {
        RecipeMetadata {
            genres: genres.iter().map(|s| (*s).into()).collect(),
            techniques: vec!["Serial chain".into()],
            era: Some("80s".into()),
            engine: engine.into(),
            complexity: "layered".into(),
            inspiration: "Late-1980s session lead".into(),
            performance: String::new(),
            required_packs: vec![],
            required_tones: vec![],
            block_count: 4,
            nam_instances: nam,
        }
    }
    fn with_meta(
        store: &DetailsStore,
        id: &str,
        m: Option<RecipeMetadata>,
    ) -> Result<DetailsCatalog> {
        store.update(DetailsUpdate {
            expected_revision: store.snapshot()?.revision,
            entry_kind: LibraryKind::Rig,
            id: id.into(),
            description: "d".into(),
            categories: vec![],
            metadata: m,
        })
    }
    #[test]
    fn sound_metadata_is_validated_kept_across_plain_edits_and_optional_on_read() {
        let f = Fixture::new();
        let store = f.store();
        let id = "a".repeat(64);
        for bad in [
            meta(&[], "lv2", 0),
            meta(&["Clean", "Funk", "Blues", "Jazz"], "lv2", 0),
            meta(&["Metalcore"], "lv2", 0),
            meta(&["Clean"], "tube", 0),
            meta(&["Clean"], "lv2", 1),
            meta(&["Clean"], "hybrid", 0),
        ] {
            assert!(with_meta(&store, &id, Some(bad)).is_err());
        }
        let good = meta(&["Clean", "Blues"], "hybrid", 2);
        let saved = with_meta(&store, &id, Some(good.clone())).unwrap();
        assert_eq!(saved.entries[0].details.metadata, Some(good.clone()));
        // A plain description edit keeps the metadata.
        let kept = with_meta(&store, &id, None).unwrap();
        assert_eq!(kept.entries[0].details.metadata, Some(good));
        // Stored details without the field still load.
        fs::write(
            f.0.join("preset-details.json"),
            format!(
                r#"{{"schema":1,"entries":{{"rig:{id}":{{"description":"old","categories":[],"copied_from":null}}}}}}"#
            ),
        )
        .unwrap();
        assert!(
            store.snapshot().unwrap().entries[0]
                .details
                .metadata
                .is_none()
        );
    }
    #[test]
    fn normalized_unicode_details_are_durable_and_stale_edits_do_not_overwrite() {
        let f = Fixture::new();
        let store = f.store();
        let initial = store.snapshot().unwrap();
        let id = "a".repeat(64);
        let saved = update(
            &store,
            LibraryKind::Original,
            &id,
            "  Warm\r\n音  ",
            &[" Clean ", "clean", "Lead"],
        )
        .unwrap();
        assert_eq!(saved.entries[0].details.description, "Warm\n音");
        assert_eq!(saved.entries[0].details.categories, ["Clean", "Lead"]);
        assert_eq!(f.store().snapshot().unwrap().revision, saved.revision);
        assert!(matches!(
            store.update(DetailsUpdate {
                expected_revision: initial.revision,
                entry_kind: LibraryKind::Original,
                id: id.clone(),
                description: "stale".into(),
                categories: vec![],
                metadata: None
            }),
            Err(Error::Conflict(_))
        ));
        assert_eq!(store.snapshot().unwrap().revision, saved.revision);
        // The same hash in a different namespace is a separate preset.
        update(&store, LibraryKind::Owned, &id, "My note", &[]).unwrap();
        store.forget(LibraryKind::Original, &id).unwrap();
        let remaining = store.snapshot().unwrap();
        assert_eq!(remaining.entries.len(), 1);
        assert_eq!(remaining.entries[0].entry.kind, LibraryKind::Owned);
        assert_eq!(remaining.entries[0].details.description, "My note");
    }
    #[test]
    fn invalid_input_and_failed_storage_preserve_existing_details() {
        let f = Fixture::new();
        let store = f.store();
        let id = "b".repeat(64);
        update(&store, LibraryKind::Original, &id, &"音".repeat(4000), &[]).unwrap();
        let before = fs::read(f.0.join("preset-details.json")).unwrap();
        assert!(update(&store, LibraryKind::Original, &id, &"音".repeat(4001), &[]).is_err());
        for cats in [vec!["bad,category"], vec!["bad\ncategory"], vec![""]] {
            assert!(update(&store, LibraryKind::Original, &id, "bad", &cats).is_err());
        }
        assert!(update(&store, LibraryKind::Original, "../escape", "bad", &[]).is_err());
        assert_eq!(fs::read(f.0.join("preset-details.json")).unwrap(), before);
        // An unusable lock fails before any publication, preserving prior data.
        fs::remove_file(f.0.join(".preset-details.lock")).unwrap();
        fs::create_dir(f.0.join(".preset-details.lock")).unwrap();
        assert!(update(&store, LibraryKind::Original, &id, "replacement", &[]).is_err());
        assert_eq!(fs::read(f.0.join("preset-details.json")).unwrap(), before);
    }
    #[test]
    fn copy_inherits_before_publication_and_retains_its_own_later_edits() {
        let f = Fixture::new();
        let store = f.store();
        let bytes = include_bytes!("../tests/fixtures/authored-current.t3kpreset");
        let original = Store::new(f.0.clone()).import(bytes).unwrap();
        update(
            &store,
            LibraryKind::Original,
            &original.sha256,
            "source note",
            &["Ambient"],
        )
        .unwrap();
        let target = LibraryReference {
            kind: LibraryKind::Owned,
            id: "c".repeat(64),
        };
        let source = LibraryReference {
            kind: LibraryKind::Original,
            id: original.sha256.clone(),
        };
        store.inherit(target.clone(), source.clone()).unwrap();
        let copy = store
            .snapshot()
            .unwrap()
            .entries
            .into_iter()
            .find(|e| e.entry == target)
            .unwrap()
            .details;
        assert_eq!(copy.description, "source note");
        assert_eq!(copy.categories, ["Ambient"]);
        assert_eq!(copy.copied_from.unwrap().source, source);
        assert!(!f.0.join("owned").exists());
        update(&store, target.kind, &target.id, "my note", &["Lead"]).unwrap();
        update(&store, source.kind, &source.id, "new source note", &[]).unwrap();
        store.inherit(target.clone(), source).unwrap();
        let copy = store
            .snapshot()
            .unwrap()
            .entries
            .into_iter()
            .find(|e| e.entry == target)
            .unwrap()
            .details;
        assert_eq!(copy.description, "my note");
        assert!(copy.copied_from.is_some());
    }
    #[test]
    fn independent_writers_detect_conflict_instead_of_losing_a_change() {
        let f = Fixture::new();
        let revision = f.store().snapshot().unwrap().revision;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = ['a', 'b']
            .into_iter()
            .map(|letter| {
                let root = f.0.clone();
                let revision = revision.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    DetailsStore::new(root).update(DetailsUpdate {
                        expected_revision: revision,
                        entry_kind: LibraryKind::Original,
                        id: letter.to_string().repeat(64),
                        description: letter.into(),
                        categories: vec![],
                        metadata: None,
                    })
                })
            })
            .collect();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(results.iter().any(|r| matches!(r, Err(Error::Conflict(_)))));
        assert_eq!(f.store().snapshot().unwrap().entries.len(), 1);
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_are_rejected_without_modifying_the_target() {
        let f = Fixture::new();
        let target = f.0.join("unrelated");
        fs::write(&target, "owner bytes").unwrap();
        std::os::unix::fs::symlink(&target, f.0.join("preset-details.json")).unwrap();
        assert!(f.store().snapshot().is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "owner bytes");
    }
}
