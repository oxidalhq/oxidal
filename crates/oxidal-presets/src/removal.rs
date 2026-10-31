//! Preview-bound permanent removal of one immutable library entry.
//! Callers serialize publication/preparation and supply current audio references.
use crate::{
    BundleStore, CatalogStore, Error, GraphStore, LibraryItem, LibraryKind, ModelStore, OwnedStore,
    Result, Store, embedded_digests,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, Read},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LibraryReference {
    pub kind: LibraryKind,
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    const CURRENT: &[u8] = include_bytes!("../tests/fixtures/authored-current.t3kpreset");
    const LEGACY: &[u8] = include_bytes!("../tests/fixtures/authored-legacy.t3kpreset");

    struct Fixture {
        root: PathBuf,
        id: String,
        model: String,
    }
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "oxidal-removal-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            let id = Store::new(root.clone()).import(CURRENT).unwrap().sha256;
            let bytes = [0, 1, 127, 128, 255];
            let asset = crate::ModelAsset {
                schema: 1,
                tone_id: 1,
                model_id: 1,
                title: "Fixture model".into(),
                name: "Fixture model".into(),
                format: "nam".into(),
                sha256: digest(&bytes),
                tone: serde_json::json!({"id":1}),
            };
            let model = ModelStore::new(root.join("audition-models"))
                .stage(&asset, &bytes)
                .unwrap();
            Self { root, id, model }
        }
        fn store(&self) -> RemovalStore {
            RemovalStore::new(self.root.clone())
        }
        fn request(&self, cleanup: bool) -> RemovalRequest {
            RemovalRequest {
                entry_kind: LibraryKind::Original,
                id: self.id.clone(),
                expected_preview: self
                    .store()
                    .preview(
                        LibraryKind::Original,
                        &self.id,
                        &RemovalReferences::default(),
                    )
                    .unwrap()
                    .token,
                delete_models: cleanup,
            }
        }
        fn original(&self) -> PathBuf {
            self.root.join(format!("{}.t3kpreset", self.id))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn default_removal_keeps_independent_files_and_rollback_restores_preset() {
        let f = Fixture::new();
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &RemovalReferences::default())
            .unwrap();
        assert_eq!(preview.embedded_bytes, 5);
        assert_eq!(preview.models.len(), 1);
        assert!(preview.models[0].protected_by.is_empty());
        let pending = f
            .store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap();
        assert!(!f.original().exists());
        drop(pending);
        assert_eq!(fs::read(f.original()).unwrap(), CURRENT);
        let result = f
            .store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(!result.cleanup_pending);
        assert_eq!(result.model_files_deleted, 0);
        assert!(f.root.join("audition-models").join(&f.model).exists());
        assert!(!f.original().exists());
    }

    #[test]
    fn explicit_cleanup_removes_only_unshared_files() {
        let f = Fixture::new();
        let result = f
            .store()
            .begin(&f.request(true), &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert_eq!(result.model_files_deleted, 1);
        assert!(!f.root.join("audition-models").join(&f.model).exists());

        let f = Fixture::new();
        let other = Store::new(f.root.clone()).import(LEGACY).unwrap().sha256;
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &RemovalReferences::default())
            .unwrap();
        assert_eq!(preview.models[0].protected_by.len(), 1);
        assert!(
            f.store()
                .begin(&f.request(true), &RemovalReferences::default())
                .is_err()
        );
        f.store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(f.root.join(format!("{other}.t3kpreset")).exists());
        assert!(f.root.join("audition-models").join(&f.model).exists());
    }

    #[test]
    fn changed_library_or_audio_references_reject_old_confirmation() {
        let f = Fixture::new();
        let request = f.request(false);
        Store::new(f.root.clone()).import(LEGACY).unwrap();
        assert!(matches!(
            f.store().begin(&request, &RemovalReferences::default()),
            Err(Error::Conflict(_))
        ));
        let request = f.request(false);
        let references = RemovalReferences {
            active: vec![LibraryReference {
                kind: LibraryKind::Original,
                id: f.id.clone(),
            }],
            ..Default::default()
        };
        assert!(f.store().begin(&request, &references).is_err());
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &references)
            .unwrap();
        assert!(preview.blocked.is_some());
        let mut request = request;
        request.expected_preview = preview.token;
        assert!(f.store().begin(&request, &references).is_err());
        assert!(f.original().exists());
    }

    #[test]
    fn recovery_restores_precommit_and_finishes_committed_cleanup() {
        for committed in [false, true] {
            let f = Fixture::new();
            let mut pending = f
                .store()
                .begin(&f.request(true), &RemovalReferences::default())
                .unwrap();
            if committed {
                pending.marker(true).unwrap();
            }
            let directory = pending.directory.clone();
            std::mem::forget(pending); // Simulate a process exit: no RAII rollback.
            f.store().recover().unwrap();
            assert_eq!(f.original().exists(), !committed);
            assert_eq!(
                f.root.join("audition-models").join(&f.model).exists(),
                !committed
            );
            assert!(!directory.exists());
            f.store().recover().unwrap();
        }
    }

    #[test]
    fn recovery_refuses_collisions_and_untrusted_paths_without_losing_data() {
        let f = Fixture::new();
        let pending = f
            .store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap();
        let directory = pending.directory.clone();
        std::mem::forget(pending);
        fs::write(f.original(), b"new entry").unwrap();
        assert!(f.store().recover().is_err());
        assert_eq!(fs::read(directory.join("0")).unwrap(), CURRENT);
        assert_eq!(fs::read(f.original()).unwrap(), b"new entry");
        fs::remove_file(f.original()).unwrap();
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("intent.json")).unwrap()).unwrap();
        journal["paths"][0] = "../outside".into();
        fs::write(
            directory.join("intent.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        assert!(f.store().recover().is_err());
        assert_eq!(fs::read(directory.join("0")).unwrap(), CURRENT);
    }

    #[test]
    fn recovery_handles_a_partial_stage_and_an_unpublished_journal() {
        let f = Fixture::new();
        let pending = f
            .store()
            .begin(&f.request(true), &RemovalReferences::default())
            .unwrap();
        fs::rename(
            pending.directory.join("1"),
            f.root.join("audition-models").join(&f.model),
        )
        .unwrap();
        std::mem::forget(pending);
        let empty = f.root.join(".remove-unpublished");
        fs::create_dir(&empty).unwrap();
        fs::write(empty.join("intent.next"), b"partial JSON").unwrap();
        f.store().recover().unwrap();
        assert!(f.original().exists());
        assert!(f.root.join("audition-models").join(&f.model).exists());
        assert!(!empty.exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_storage_and_payloads_fail_closed() {
        let f = Fixture::new();
        let saved = f.root.join("saved-original");
        fs::rename(f.original(), &saved).unwrap();
        std::os::unix::fs::symlink(&saved, f.original()).unwrap();
        assert!(
            f.store()
                .preview(LibraryKind::Original, &f.id, &RemovalReferences::default())
                .is_err()
        );
        assert_eq!(fs::read(saved).unwrap(), CURRENT);
    }

    #[test]
    fn stopped_session_removal_is_scoped_and_other_session_assets_are_protected() {
        let f = Fixture::new();
        let ours = serde_json::json!({"settings":{"preset_id":f.id,"owned":false,"draft":false},"models":[{"asset":f.model}]});
        fs::create_dir(f.root.join("rig-sessions")).unwrap();
        let our_path = f
            .root
            .join("rig-sessions")
            .join(format!("false-false-{}.json", f.id));
        fs::write(&our_path, serde_json::to_vec(&ours).unwrap()).unwrap();
        let theirs = serde_json::json!({"settings":{"preset_id":"a".repeat(64),"owned":false},"models":[{"asset":f.model}]});
        let their_path = f.root.join("last-audio-session.json");
        fs::write(&their_path, serde_json::to_vec(&theirs).unwrap()).unwrap();
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &RemovalReferences::default())
            .unwrap();
        assert_eq!(preview.remembered_files, 1);
        assert!(
            preview.models[0]
                .protected_by
                .iter()
                .any(|v| v == "Another remembered preset")
        );
        f.store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(!our_path.exists());
        assert!(their_path.exists());
        assert!(f.root.join("audition-models").join(&f.model).exists());
    }

    #[test]
    fn collection_and_runtime_references_keep_member_files() {
        let f = Fixture::new();
        let store = ModelStore::new(f.root.join("audition-models"));
        let (mut asset, path) = store.read(&f.model).unwrap();
        asset.tone = serde_json::json!({"id":1,"oxidal_collection":[f.model]});
        asset.title = "Saved collection".into();
        let collection = store.stage(&asset, &fs::read(path).unwrap()).unwrap();
        let references = RemovalReferences {
            model_assets: [collection].into(),
            ..Default::default()
        };
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &references)
            .unwrap();
        assert_eq!(preview.models.len(), 2);
        assert!(preview.models.iter().all(|m| !m.protected_by.is_empty()));
    }

    #[test]
    fn committed_preference_failure_is_reported_and_retried_on_recovery() {
        let f = Fixture::new();
        let pending = f
            .store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap();
        let directory = pending.directory.clone();
        fs::create_dir(f.root.join("library.json")).unwrap(); // Fail preference publication.
        let result = pending.commit().unwrap();
        assert!(result.cleanup_pending);
        assert!(!f.original().exists());
        assert!(directory.exists());
        fs::remove_dir(f.root.join("library.json")).unwrap();
        f.store().recover().unwrap();
        assert!(!directory.exists());
        assert!(!f.original().exists());
    }

    #[test]
    fn owned_identity_does_not_delete_same_bytes_from_original_library() {
        let f = Fixture::new();
        OwnedStore::new(f.root.join("owned"))
            .save_created(CURRENT)
            .unwrap();
        let preview = f
            .store()
            .preview(LibraryKind::Owned, &f.id, &RemovalReferences::default())
            .unwrap();
        assert_eq!(preview.models[0].protected_by.len(), 1);
        let request = RemovalRequest {
            entry_kind: LibraryKind::Owned,
            id: f.id.clone(),
            expected_preview: preview.token,
            delete_models: false,
        };
        let pending = f
            .store()
            .begin(&request, &RemovalReferences::default())
            .unwrap();
        std::mem::forget(pending);
        f.store().recover().unwrap();
        assert!(f.root.join("owned").join(&f.id).exists());
        f.store()
            .begin(&request, &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(!f.root.join("owned").join(&f.id).exists());
        assert_eq!(fs::read(f.original()).unwrap(), CURRENT);
    }

    #[test]
    fn effects_graph_removal_keeps_native_library_and_ignores_unrelated_sessions() {
        let f = Fixture::new();
        let graph = GraphStore::new(f.root.join("graphs")).save(serde_json::from_value(serde_json::json!({
            "version":1,"name":"Fixture graph","sample_rate":48000,
            "rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},
            "bindings":[],"recall":{"values":[],"bypassed":false,"mappings":{"version":1,"mappings":[]}}
        })).unwrap()).unwrap();
        let preview = f
            .store()
            .preview(LibraryKind::Graph, &graph.id, &RemovalReferences::default())
            .unwrap();
        assert!(preview.models.is_empty());
        let request = RemovalRequest {
            entry_kind: LibraryKind::Graph,
            id: graph.id.clone(),
            expected_preview: preview.token,
            delete_models: false,
        };
        f.store()
            .begin(&request, &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(
            !f.root
                .join("graphs")
                .join(format!("{}.json", graph.id))
                .exists()
        );
        assert!(f.original().exists());
    }

    #[test]
    fn unverifiable_model_inventory_disables_cleanup_but_keeps_preset_deletion_available() {
        let f = Fixture::new();
        let metadata = f
            .root
            .join("audition-models")
            .join(&f.model)
            .join("metadata.json");
        fs::write(&metadata, b"invalid model metadata").unwrap();
        let preview = f
            .store()
            .preview(LibraryKind::Original, &f.id, &RemovalReferences::default())
            .unwrap();
        assert!(preview.model_cleanup_unavailable.is_some());
        assert!(preview.models.is_empty());
        assert!(
            f.store()
                .begin(&f.request(true), &RemovalReferences::default())
                .is_err()
        );
        f.store()
            .begin(&f.request(false), &RemovalReferences::default())
            .unwrap()
            .commit()
            .unwrap();
        assert!(!f.original().exists());
        assert_eq!(fs::read(metadata).unwrap(), b"invalid model metadata");
    }
}
#[derive(Debug, Default, Clone, Serialize)]
pub struct RemovalReferences {
    pub active: Vec<LibraryReference>,
    pub model_assets: BTreeSet<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ModelRemoval {
    pub id: String,
    pub name: String,
    pub format: String,
    pub bytes: u64,
    pub protected_by: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RemovalPreview {
    pub entry: LibraryItem,
    pub token: String,
    pub preset_bytes: u64,
    pub embedded_bytes: u64,
    pub remembered_files: usize,
    pub remembered_bytes: u64,
    pub models: Vec<ModelRemoval>,
    pub blocked: Option<String>,
    pub model_cleanup_unavailable: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RemovalRequest {
    pub entry_kind: LibraryKind,
    pub id: String,
    pub expected_preview: String,
    pub delete_models: bool,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RemovalResult {
    pub deleted: LibraryReference,
    pub model_files_deleted: usize,
    pub cleanup_pending: bool,
}

struct Entry {
    item: LibraryItem,
    path: PathBuf,
    digests: Option<BTreeSet<String>>,
    embedded: u64,
}
struct Session {
    path: PathBuf,
    source: Option<LibraryReference>,
    models: BTreeSet<String>,
    prepared: BTreeSet<String>,
    fingerprint: String,
}
struct Plan {
    preview: RemovalPreview,
    paths: Vec<PathBuf>,
    model_paths: Vec<PathBuf>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    schema: u8,
    committed: bool,
    paths: Vec<String>,
    deleted: LibraryReference,
}

fn canonical_path(root: &Path, path: &str) -> Result<PathBuf> {
    let parts: Vec<_> = path.split('/').collect();
    let allowed = match parts.as_slice() {
        [name] => {
            matches!(
                *name,
                "last-audio-session.json" | "last-rig-session.json" | "boot-audio.json"
            ) || name.strip_suffix(".t3kpreset").is_some_and(hash)
        }
        [
            "owned" | "bundles" | "audition-models" | "native-checkpoints",
            id,
        ] => hash(id),
        ["graphs", name] => name.strip_suffix(".json").is_some_and(hash),
        ["rig-sessions", name] => name.strip_suffix(".json").is_some_and(|stem| {
            // Only the native recovery writer's known identity shapes.
            ["false-false-", "true-false-", "false-true-", "true-true-"]
                .iter()
                .any(|prefix| stem.strip_prefix(prefix).is_some_and(hash))
        }),
        _ => false,
    };
    if !allowed {
        return Err(Error::Invalid("Invalid removal recovery path"));
    }
    if parts.len() == 2 {
        let metadata = fs::symlink_metadata(root.join(parts[0]))?;
        if !metadata.is_dir() {
            return Err(Error::Invalid("Invalid removal recovery parent"));
        }
    }
    Ok(root.join(path))
}

#[derive(Debug)]
pub struct PendingRemoval {
    root: PathBuf,
    directory: PathBuf,
    paths: Vec<PathBuf>,
    deleted: LibraryReference,
    model_files: usize,
    committed: bool,
}
impl PendingRemoval {
    fn marker(&mut self, committed: bool) -> Result<()> {
        use std::io::Write;
        let paths = self
            .paths
            .iter()
            .map(|p| {
                p.strip_prefix(&self.root)
                    .map(|p| p.to_string_lossy().into_owned())
            })
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| Error::Invalid("Invalid removal path"))?;
        let bytes = serde_json::to_vec(
            &serde_json::json!({"schema":1,"committed":committed,"paths":paths,"deleted":self.deleted}),
        )
        .map_err(|_| Error::Invalid("Invalid removal journal"))?;
        let mut file = fs::File::create(self.directory.join("intent.next"))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(
            self.directory.join("intent.next"),
            self.directory.join("intent.json"),
        )?;
        // Once the new intent is published, an fsync failure must not trigger a
        // partial rollback under a journal that says to finish deletion.
        self.committed = committed;
        fs::File::open(&self.directory)?.sync_all()?;
        Ok(())
    }
    fn rollback(&self) -> Result<()> {
        for (index, path) in self.paths.iter().enumerate().rev() {
            let staged = self.directory.join(index.to_string());
            if fs::symlink_metadata(&staged).is_ok() {
                if fs::symlink_metadata(path).is_ok() {
                    return Err(Error::Conflict("Removal recovery found an existing entry"));
                }
                fs::rename(staged, path)?;
                fs::File::open(
                    path.parent()
                        .ok_or(Error::Invalid("Invalid removal parent"))?,
                )?
                .sync_all()?;
            }
        }
        fs::remove_dir_all(&self.directory)?;
        fs::File::open(&self.root)?.sync_all()?;
        Ok(())
    }
    /// Canonical paths have all moved successfully. After this durable marker,
    /// interruption means cleanup is pending, never an implicit undelete.
    pub fn commit(mut self) -> Result<RemovalResult> {
        if let Err(error) = self.marker(true) {
            if !self.committed {
                return Err(error);
            }
            return Ok(RemovalResult {
                deleted: self.deleted.clone(),
                model_files_deleted: self.model_files,
                cleanup_pending: true,
            });
        }
        let preferences = CatalogStore::open(self.root.clone())
            .and_then(|mut c| c.forget(self.deleted.kind, &self.deleted.id));
        // Keep the committed journal until preferences are durable as well.
        let cleanup = if preferences.is_ok() {
            fs::remove_dir_all(&self.directory)
                .and_then(|()| fs::File::open(&self.root)?.sync_all())
        } else {
            Ok(())
        };
        Ok(RemovalResult {
            deleted: self.deleted.clone(),
            model_files_deleted: self.model_files,
            cleanup_pending: preferences.is_err() || cleanup.is_err(),
        })
    }
}
impl Drop for PendingRemoval {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.rollback();
        }
    }
}

#[derive(Debug)]
pub struct RemovalStore {
    root: PathBuf,
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn dependency_label(prefix: &str, name: &str) -> String {
    let mut characters = name.chars();
    let short: String = characters.by_ref().take(80).collect();
    format!(
        "{prefix}: {short}{}",
        if characters.next().is_some() {
            "…"
        } else {
            ""
        }
    )
}
fn protect(references: &mut BTreeSet<String>, label: String) {
    if references.len() < 8 {
        references.insert(label);
    } else {
        references.insert("Other library references".into());
    }
}
fn file(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let m = fs::symlink_metadata(path)?;
    if !m.is_file() || m.len() > limit {
        return Err(Error::Invalid("Invalid library dependency file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(Error::Invalid("Library dependency exceeds limit"));
    }
    Ok(bytes)
}
fn tree_bytes(path: &Path) -> Result<u64> {
    let mut pending = vec![path.to_owned()];
    let mut bytes = 0u64;
    let mut entries = 0usize;
    while let Some(p) = pending.pop() {
        entries += 1;
        if entries > 16384 {
            return Err(Error::Invalid("Preset contains too many files"));
        }
        let m = fs::symlink_metadata(&p)?;
        if m.is_file() {
            bytes = bytes
                .checked_add(m.len())
                .ok_or(Error::Invalid("Preset size overflow"))?;
        } else if m.is_dir() {
            for entry in fs::read_dir(p)? {
                pending.push(entry?.path());
            }
        } else {
            return Err(Error::Invalid(
                "Library entry contains a symlink or special file",
            ));
        }
    }
    Ok(bytes)
}
fn reference(value: &serde_json::Value) -> Option<LibraryReference> {
    let settings = value
        .get("settings")
        .or_else(|| value.get("choice")?.get("settings"))?;
    if let Some(id) = settings["preset_id"].as_str().filter(|id| hash(id)) {
        if settings["draft"].as_bool() == Some(true) {
            return None;
        }
        Some(LibraryReference {
            kind: if settings["owned"].as_bool() == Some(true) {
                LibraryKind::Owned
            } else {
                LibraryKind::Original
            },
            id: id.into(),
        })
    } else if let Some(id) = settings["library_id"].as_str().filter(|id| hash(id)) {
        Some(LibraryReference {
            kind: LibraryKind::Graph,
            id: id.into(),
        })
    } else {
        settings["revision"]
            .as_str()
            .filter(|id| hash(id))
            .map(|id| LibraryReference {
                kind: LibraryKind::Rig,
                id: id.into(),
            })
    }
}
fn assets(value: &serde_json::Value, result: &mut BTreeSet<String>, depth: usize) -> Result<()> {
    if depth > 64 {
        return Err(Error::Invalid(
            "Remembered model references exceed nesting limit",
        ));
    }
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                if key == "asset" {
                    if let Some(id) = value.as_str().filter(|id| hash(id)) {
                        result.insert(id.into());
                    }
                } else {
                    assets(value, result, depth + 1)?;
                }
            }
        }
        serde_json::Value::Array(values) => {
            for v in values {
                assets(v, result, depth + 1)?;
            }
        }
        _ => (),
    }
    Ok(())
}
impl RemovalStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    /// Run before constructing playback owners or accepting library writes.
    /// An ambiguous journal is left intact and prevents startup, preserving data.
    pub fn recover(&self) -> Result<()> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let mut directories = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with(".remove-"))
            {
                directories.push(path);
                if directories.len() > 128 {
                    return Err(Error::Invalid("Too many pending removal transactions"));
                }
            }
        }
        directories.sort();
        for directory in directories {
            if !fs::symlink_metadata(&directory)?.is_dir() {
                return Err(Error::Invalid("Invalid removal recovery directory"));
            }
            let intent = directory.join("intent.json");
            if !intent.try_exists()? {
                // No canonical move precedes publication of the first journal.
                for entry in fs::read_dir(&directory)? {
                    let path = entry?.path();
                    if path.file_name().and_then(|v| v.to_str()) != Some("intent.next")
                        || !fs::symlink_metadata(&path)?.is_file()
                    {
                        return Err(Error::Invalid("Unrecognized removal recovery data"));
                    }
                }
                fs::remove_dir_all(&directory)?;
                fs::File::open(&self.root)?.sync_all()?;
                continue;
            }
            let journal: Journal = serde_json::from_slice(&file(&intent, 4 * 1024 * 1024)?)
                .map_err(|_| Error::Invalid("Unreadable removal recovery journal"))?;
            if journal.schema != 1
                || journal.paths.is_empty()
                || journal.paths.len() > 22000
                || !hash(&journal.deleted.id)
            {
                return Err(Error::Invalid("Invalid removal recovery journal"));
            }
            let paths = journal
                .paths
                .iter()
                .map(|p| canonical_path(&self.root, p))
                .collect::<Result<Vec<_>>>()?;
            if paths.iter().collect::<BTreeSet<_>>().len() != paths.len() {
                return Err(Error::Invalid("Duplicate removal recovery paths"));
            }
            let expected = match journal.deleted.kind {
                LibraryKind::Original => {
                    self.root.join(format!("{}.t3kpreset", journal.deleted.id))
                }
                LibraryKind::Owned => self.root.join("owned").join(&journal.deleted.id),
                LibraryKind::Graph => self
                    .root
                    .join("graphs")
                    .join(format!("{}.json", journal.deleted.id)),
                LibraryKind::Rig => self.root.join("bundles").join(&journal.deleted.id),
            };
            if paths[0] != expected {
                return Err(Error::Invalid("Removal journal identity differs"));
            }
            for entry in fs::read_dir(&directory)? {
                let path = entry?.path();
                let name = path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .ok_or(Error::Invalid("Invalid removal recovery filename"))?;
                if matches!(name, "intent.json" | "intent.next") {
                    if !fs::symlink_metadata(&path)?.is_file() {
                        return Err(Error::Invalid("Invalid removal recovery marker"));
                    }
                } else if !name
                    .parse::<usize>()
                    .ok()
                    .is_some_and(|i| i < paths.len() && i.to_string() == name)
                {
                    return Err(Error::Invalid("Unrecognized removal recovery entry"));
                } else {
                    tree_bytes(&path)?;
                }
            }
            let mut pending = PendingRemoval {
                root: self.root.clone(),
                directory,
                paths,
                deleted: journal.deleted,
                model_files: 0,
                committed: true,
            };
            if journal.committed {
                CatalogStore::open(self.root.clone())?
                    .forget(pending.deleted.kind, &pending.deleted.id)?;
                fs::remove_dir_all(&pending.directory)?;
                fs::File::open(&self.root)?.sync_all()?;
            } else {
                // Validate all collisions before restoring any entry.
                for (index, path) in pending.paths.iter().enumerate() {
                    let staged = pending.directory.join(index.to_string());
                    match (fs::symlink_metadata(&staged), fs::symlink_metadata(path)) {
                        (Ok(_), Err(e)) if e.kind() == std::io::ErrorKind::NotFound => (),
                        (Err(e), Ok(_)) if e.kind() == std::io::ErrorKind::NotFound => {
                            tree_bytes(path)?;
                        }
                        _ => {
                            return Err(Error::Conflict(
                                "Removal recovery found missing or conflicting entries",
                            ));
                        }
                    }
                }
                pending.rollback()?;
            }
            // Prevent Drop from retrying a failed recovery on its own.
            pending.committed = true;
        }
        Ok(())
    }
    fn entries(&self) -> Result<Vec<Entry>> {
        let mut entries = Vec::new();
        let item = |kind, id: String, name: String| LibraryItem {
            kind,
            id,
            name: name.clone(),
            source_name: name,
            archived: false,
        };
        let originals = Store::new(self.root.clone());
        for p in originals.list()?.presets {
            let bytes = originals.original(&p.sha256)?;
            entries.push(Entry {
                path: self.root.join(format!("{}.t3kpreset", p.sha256)),
                digests: embedded_digests(&bytes).ok(),
                embedded: u64::from(p.embedded_bytes),
                item: item(LibraryKind::Original, p.sha256, p.name),
            });
        }
        let owned = OwnedStore::new(self.root.join("owned"));
        for p in owned.list()? {
            let (_, bytes) = owned.read(&p.id)?;
            entries.push(Entry {
                path: self.root.join("owned").join(&p.id),
                digests: embedded_digests(&bytes).ok(),
                embedded: u64::from(p.preset.embedded_bytes),
                item: item(LibraryKind::Owned, p.id, p.preset.name),
            });
        }
        for p in GraphStore::new(self.root.join("graphs")).list()? {
            entries.push(Entry {
                path: self.root.join("graphs").join(format!("{}.json", p.id)),
                digests: Some(BTreeSet::new()),
                embedded: 0,
                item: item(LibraryKind::Graph, p.id, p.preset.name),
            });
        }
        let bundles = BundleStore::new(self.root.join("bundles"));
        for id in bundles.list()? {
            let manifest = bundles.manifest(&id)?;
            if manifest
                .extensions
                .get("urn:oxidal:authoring")
                .and_then(|v| v.get("draft"))
                == Some(&serde_json::Value::Bool(true))
            {
                continue;
            }
            let mut digests = BTreeSet::new();
            let mut complete = true;
            let mut embedded = 0;
            for resource in &manifest.resources {
                digests.insert(resource.sha256.clone());
                if matches!(
                    resource.kind,
                    crate::manifest::ResourceKind::Tone3000Preset
                        | crate::manifest::ResourceKind::Tone3000Source
                ) {
                    let bytes = file(
                        &self.root.join("bundles").join(&id).join(&resource.path),
                        crate::MAX_FILE_BYTES as u64,
                    )?;
                    if digest(&bytes) != resource.sha256 {
                        return Err(Error::Invalid("Preset resource checksum differs"));
                    }
                    match embedded_digests(&bytes) {
                        Ok(found) => digests.extend(found),
                        Err(_) => complete = false,
                    }
                }
                embedded += resource.bytes;
            }
            entries.push(Entry {
                path: self.root.join("bundles").join(&id),
                digests: complete.then_some(digests),
                embedded,
                item: item(LibraryKind::Rig, id, manifest.name),
            });
        }
        let catalog = CatalogStore::open(self.root.clone())?
            .view(entries.iter().map(|e| e.item.clone()).collect())?;
        for entry in &mut entries {
            entry.item = catalog
                .items
                .iter()
                .find(|i| i.kind == entry.item.kind && i.id == entry.item.id)
                .unwrap()
                .clone();
        }
        Ok(entries)
    }
    fn sessions(&self) -> Result<Vec<Session>> {
        let mut paths = Vec::new();
        for name in [
            "last-audio-session.json",
            "last-rig-session.json",
            "boot-audio.json",
        ] {
            let path = self.root.join(name);
            if path.try_exists()? {
                paths.push(path);
            }
        }
        let dir = self.root.join("rig-sessions");
        if dir.try_exists()? {
            if !fs::symlink_metadata(&dir)?.is_dir() {
                return Err(Error::Invalid("Invalid remembered session directory"));
            }
            for entry in fs::read_dir(dir)? {
                let p = entry?.path();
                if p.extension().and_then(|s| s.to_str()) == Some("json") {
                    paths.push(p);
                }
                if paths.len() > 4096 {
                    return Err(Error::Invalid("Too many remembered sessions"));
                }
            }
        }
        let mut sessions = Vec::new();
        let mut session_bytes = 0;
        for path in paths {
            let bytes = file(&path, 1024 * 1024)?;
            session_bytes += bytes.len();
            if session_bytes > 16 * 1024 * 1024 {
                return Err(Error::Invalid(
                    "Remembered sessions exceed deletion review capacity",
                ));
            }
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|_| Error::Invalid("A remembered session could not be checked"))?;
            let source = reference(&value);
            let mut models = BTreeSet::new();
            assets(&value, &mut models, 0)?;
            let settings = value
                .get("settings")
                .or_else(|| value.get("choice").and_then(|v| v.get("settings")));
            let prepared = settings
                .and_then(|v| v.get("prepared"))
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| {
                    v["revision"]
                        .as_str()
                        .filter(|id| hash(id))
                        .map(str::to_owned)
                })
                .collect();
            sessions.push(Session {
                path,
                source,
                models,
                prepared,
                fingerprint: digest(&bytes),
            });
        }
        Ok(sessions)
    }
    pub fn preview(
        &self,
        kind: LibraryKind,
        id: &str,
        references: &RemovalReferences,
    ) -> Result<RemovalPreview> {
        Ok(self.plan(kind, id, references)?.preview)
    }
    fn plan(&self, kind: LibraryKind, id: &str, references: &RemovalReferences) -> Result<Plan> {
        if !hash(id) {
            return Err(Error::Invalid("Invalid library identifier"));
        }
        for dir in [
            "owned",
            "graphs",
            "bundles",
            "audition-models",
            "rig-sessions",
            "native-checkpoints",
        ] {
            match fs::symlink_metadata(self.root.join(dir)) {
                Ok(m) if !m.is_dir() => {
                    return Err(Error::Invalid(
                        "Library storage directory is a symlink or special file",
                    ));
                }
                Ok(_) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        let entries = self.entries()?;
        let selected = entries
            .iter()
            .find(|e| e.item.kind == kind && e.item.id == id)
            .ok_or(Error::Invalid("Library entry is unavailable"))?;
        let selected_ref = LibraryReference {
            kind,
            id: id.into(),
        };
        let sessions = self.sessions()?;
        let mut paths = vec![selected.path.clone()];
        let mut remembered_bytes = 0;
        let mut own_assets = BTreeSet::new();
        let mut model_references = BTreeMap::<String, BTreeSet<String>>::new();
        let mut fingerprints = Vec::new();
        let mut blocked = references
            .active
            .contains(&selected_ref)
            .then(|| "This preset is playing or being prepared. Stop it before deleting.".into());
        for session in &sessions {
            if session.source.as_ref() == Some(&selected_ref) {
                own_assets.extend(session.models.clone());
                remembered_bytes += tree_bytes(&session.path)?;
                paths.push(session.path.clone());
                fingerprints.push(session.fingerprint.clone());
            } else {
                for asset in &session.models {
                    model_references
                        .entry(asset.clone())
                        .or_default()
                        .insert("Another remembered preset".into());
                }
                if kind == LibraryKind::Rig && session.prepared.contains(id) {
                    blocked=Some("This preset is a prepared alternative in another remembered setup. Remove it from Keep ready first.".into());
                }
            }
        }
        // Native captures are source-bound; no other preset origin may load them.
        let checkpoints = self.root.join("native-checkpoints");
        if checkpoints.try_exists()? {
            if !fs::symlink_metadata(&checkpoints)?.is_dir() {
                return Err(Error::Invalid("Invalid checkpoint directory"));
            }
            let origin = match kind {
                LibraryKind::Original => format!("original:{id}"),
                LibraryKind::Owned => format!("owned:{id}"),
                LibraryKind::Rig => format!("mixed:{id}:"),
                LibraryKind::Graph => String::new(),
            };
            for (index, entry) in fs::read_dir(checkpoints)?.enumerate() {
                if index >= 16384 {
                    return Err(Error::Invalid("Too many native checkpoints to review"));
                }
                let path = entry?.path();
                if !path.file_name().and_then(|s| s.to_str()).is_some_and(hash) {
                    continue;
                }
                if !fs::symlink_metadata(&path)?.is_file() {
                    return Err(Error::Invalid("Invalid native checkpoint"));
                }
                let mut line = Vec::new();
                std::io::BufReader::new(fs::File::open(&path)?)
                    .take(4097)
                    .read_until(b'\n', &mut line)?;
                let value: serde_json::Value = serde_json::from_slice(&line)
                    .map_err(|_| Error::Invalid("Native checkpoint header could not be checked"))?;
                let source = value["origin"].as_str().unwrap_or("");
                if !origin.is_empty()
                    && if kind == LibraryKind::Rig {
                        source.starts_with(&origin)
                    } else {
                        source == origin
                    }
                {
                    remembered_bytes += tree_bytes(&path)?;
                    paths.push(path.clone());
                    fingerprints.push(path.file_name().unwrap().to_string_lossy().into_owned());
                }
            }
        }
        let store = ModelStore::new(self.root.join("audition-models"));
        let mut cursor = None;
        let mut models = BTreeMap::new();
        let mut metadata_bytes = 0;
        let mut inventory_unavailable = None;
        'inventory: loop {
            let (page, next) = match store.page(cursor.as_deref(), true) {
                Ok(page) => page,
                Err(_) => {
                    inventory_unavailable = Some(
                        "Separate model references could not be checked. Keep separate files."
                            .to_owned(),
                    );
                    models.clear();
                    break;
                }
            };
            for (id, asset) in page {
                metadata_bytes += serde_json::to_vec(&asset)
                    .map_err(|_| Error::Invalid("Invalid model metadata"))?
                    .len();
                if metadata_bytes > 32 * 1024 * 1024 {
                    inventory_unavailable = Some("Model metadata exceeds bounded cleanup review capacity. Keep separate files.".into());
                    models.clear();
                    break 'inventory;
                }
                models.insert(id, asset);
            }
            cursor = next;
            if cursor.is_none() {
                break;
            }
            if models.len() > 131072 {
                inventory_unavailable = Some(
                    "Model library exceeds bounded cleanup review capacity. Keep separate files."
                        .into(),
                );
                models.clear();
                break;
            }
        }
        let mut collection_references = 0;
        'collections: for (id, asset) in &models {
            if let Some(members) = asset.tone["oxidal_collection"].as_array() {
                for member in members {
                    collection_references += 1;
                    if collection_references > 65536 {
                        inventory_unavailable = Some("Collection references exceed bounded cleanup review capacity. Keep separate files.".into());
                        break 'collections;
                    }
                    if let Some(member) = member.as_str() {
                        protect(
                            model_references.entry(member.into()).or_default(),
                            dependency_label("Collection", &asset.title),
                        );
                    }
                }
            }
            if references.model_assets.contains(id) {
                model_references
                    .entry(id.clone())
                    .or_default()
                    .insert("Current audio session".into());
            }
        }
        if inventory_unavailable.is_some() {
            models.clear();
        }
        let mut candidates = Vec::new();
        let mut model_paths = Vec::new();
        let mut unavailable = inventory_unavailable.or_else(|| {
            entries.iter().any(|e| e.digests.is_none()).then(|| {
                "Some preset model references could not be verified. Keep separate files."
                    .to_owned()
            })
        });
        for (asset_id, asset) in &models {
            let embedded = selected
                .digests
                .as_ref()
                .is_some_and(|d| d.contains(&asset.sha256));
            let collection_matches = asset.tone["oxidal_collection"]
                .as_array()
                .is_none_or(|ids| {
                    ids.iter().all(|id| {
                        id.as_str().and_then(|s| models.get(s)).is_some_and(|m| {
                            selected
                                .digests
                                .as_ref()
                                .is_some_and(|d| d.contains(&m.sha256))
                        })
                    })
                });
            if !(own_assets.contains(asset_id) || embedded && collection_matches) {
                continue;
            }
            if candidates.len() >= 1024 {
                unavailable = Some(
                    "Too many associated files for bounded cleanup review. Keep separate files."
                        .into(),
                );
                candidates.clear();
                model_paths.clear();
                break;
            }
            let mut protection = model_references.get(asset_id).cloned().unwrap_or_default();
            for entry in &entries {
                if (entry.item.kind != kind || entry.item.id != id)
                    && entry
                        .digests
                        .as_ref()
                        .is_some_and(|d| d.contains(&asset.sha256))
                {
                    protect(
                        &mut protection,
                        dependency_label("Preset", &entry.item.name),
                    );
                }
            }
            let path = self.root.join("audition-models").join(asset_id);
            let bytes = tree_bytes(&path)?;
            if protection.is_empty() {
                model_paths.push(path);
            }
            candidates.push(ModelRemoval {
                id: asset_id.clone(),
                name: asset.name.clone(),
                format: asset.format.clone(),
                bytes,
                protected_by: protection.into_iter().collect(),
            });
        }
        candidates.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        let mut preview = RemovalPreview {
            entry: selected.item.clone(),
            token: String::new(),
            preset_bytes: tree_bytes(&selected.path)?,
            embedded_bytes: selected.embedded,
            remembered_files: paths.len() - 1,
            remembered_bytes,
            models: candidates,
            blocked,
            model_cleanup_unavailable: unavailable,
        };
        let catalog = CatalogStore::open(self.root.clone())?
            .view(entries.iter().map(|e| e.item.clone()).collect())?;
        preview.token = digest(
            &serde_json::to_vec(&(&preview, catalog, fingerprints, references))
                .map_err(|_| Error::Invalid("Could not encode deletion preview"))?,
        );
        Ok(Plan {
            preview,
            paths,
            model_paths,
        })
    }
    pub fn begin(
        &self,
        request: &RemovalRequest,
        references: &RemovalReferences,
    ) -> Result<PendingRemoval> {
        let plan = self.plan(request.entry_kind, &request.id, references)?;
        if plan.preview.token != request.expected_preview {
            return Err(Error::Conflict("Deletion preview changed; review it again"));
        }
        if plan.preview.blocked.is_some() {
            return Err(Error::Conflict(
                "This preset is in use; stop or unprepare it before deleting",
            ));
        }
        if request.delete_models
            && (plan.preview.model_cleanup_unavailable.is_some() || plan.model_paths.is_empty())
        {
            return Err(Error::Conflict(
                "Separate model files cannot be removed from this preview",
            ));
        }
        let model_files = if request.delete_models {
            plan.model_paths.len()
        } else {
            0
        };
        let mut paths = plan.paths;
        if request.delete_models {
            paths.extend(plan.model_paths);
        }
        for path in &paths {
            let relative = path
                .strip_prefix(&self.root)
                .map_err(|_| Error::Invalid("Invalid removal path"))?;
            canonical_path(
                &self.root,
                relative
                    .to_str()
                    .ok_or(Error::Invalid("Invalid removal path"))?,
            )?;
        }
        fs::create_dir_all(&self.root)?;
        let directory = self.root.join(format!(
            ".remove-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| Error::Invalid("Invalid system clock"))?
                .as_nanos()
        ));
        fs::create_dir(&directory)?;
        let mut pending = PendingRemoval {
            root: self.root.clone(),
            directory,
            paths,
            deleted: LibraryReference {
                kind: request.entry_kind,
                id: request.id.clone(),
            },
            model_files,
            committed: false,
        };
        pending.marker(false)?;
        fs::File::open(&self.root)?.sync_all()?;
        for (index, path) in pending.paths.iter().enumerate() {
            tree_bytes(path)?;
            fs::rename(path, pending.directory.join(index.to_string()))?;
            fs::File::open(&pending.directory)?.sync_all()?;
            fs::File::open(
                path.parent()
                    .ok_or(Error::Invalid("Invalid removal parent"))?,
            )?
            .sync_all()?;
        }
        fs::File::open(&pending.directory)?.sync_all()?;
        Ok(pending)
    }
}
