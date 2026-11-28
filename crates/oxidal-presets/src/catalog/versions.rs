//! Named versions refer to immutable preset contents in the existing stores.
use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PresetVersion {
    pub id: String,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PresetFamily {
    pub logical_id: String,
    pub kind: LibraryKind,
    pub default_version: String,
    pub versions: Vec<PresetVersion>,
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VersionView {
    pub catalog_revision: String,
    pub preset: PresetFamily,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum VersionAction {
    Create {
        name: String,
    },
    Rename {
        name: String,
    },
    /// Only the publication endpoint accepts this action after verifying the stored bytes.
    Publish {
        content: String,
    },
    SetDefault,
    Delete,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VersionEdit {
    pub request_id: String,
    pub expected_revision: String,
    pub expected_content: String,
    pub version: String,
    pub action: VersionAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VersionReceipt {
    request_id: String,
    fingerprint: String,
    response: VersionView,
}

impl VersionView {
    pub fn content(&self, version: &str) -> Result<&str> {
        self.preset
            .versions
            .iter()
            .find(|v| v.id == version)
            .map(|v| v.content.as_str())
            .ok_or(Error::Invalid("Saved version is unavailable"))
    }
}
impl PresetFamily {
    pub(super) fn legacy(kind: LibraryKind, first: &str) -> Result<Self> {
        Ok(Self {
            logical_id: kind.key(first)?,
            kind,
            default_version: "main".into(),
            generation: 0,
            versions: vec![PresetVersion {
                id: "main".into(),
                name: "Main".into(),
                content: first.into(),
            }],
        })
    }

    pub(super) fn valid(&self, key: &str) -> bool {
        let Some((_, first)) = key.split_once(':') else {
            return false;
        };
        self.logical_id == key
            && self.kind.key(first).is_ok_and(|typed| typed == key)
            && (1..=64).contains(&self.versions.len())
            && self.versions.iter().any(|v| v.id == self.default_version)
            && self.versions.iter().all(|v| {
                (v.id == "main" || self.kind.key(&v.id).is_ok())
                    && valid_name(&v.name)
                    && self.kind.key(&v.content).is_ok()
            })
            && self
                .versions
                .iter()
                .map(|v| &v.id)
                .collect::<BTreeSet<_>>()
                .len()
                == self.versions.len()
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name.trim() == name
        && !name.chars().any(char::is_control)
}

impl CatalogStore {
    pub(super) fn family(&self, kind: LibraryKind, first: &str) -> Result<PresetFamily> {
        let key = kind.key(first)?;
        match self.preferences.families.get(&key) {
            Some(family) => Ok(family.clone()),
            None => PresetFamily::legacy(kind, first),
        }
    }

    /// A failed or interrupted version Save retains its bytes for a retry. The
    /// Library only displays a staged payload if a committed default names it.
    pub fn mark_version_payload(
        root: &std::path::Path,
        kind: LibraryKind,
        content: &str,
    ) -> Result<()> {
        let key = kind.key(content)?;
        let directory = root.join("version-staging");
        fs::create_dir_all(&directory)?;
        if !fs::symlink_metadata(&directory)?.is_dir() {
            return Err(Error::Invalid("Invalid version staging directory"));
        }
        let marker = directory.join(key);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
        {
            Ok(file) => file.sync_all()?,
            Err(e)
                if e.kind() == std::io::ErrorKind::AlreadyExists
                    && fs::symlink_metadata(marker)?.is_file() => {}
            Err(e) => return Err(e.into()),
        }
        fs::File::open(directory)?.sync_all()?;
        fs::File::open(root)?.sync_all()?;
        Ok(())
    }

    pub(super) fn unpublished_version(&self, kind: LibraryKind, id: &str) -> Result<bool> {
        let key = kind.key(id)?;
        if !self.version_stages.contains(&key) {
            return Ok(false);
        }
        Ok(!self.preferences.families.values().any(|family| {
            family.kind == kind
                && family
                    .versions
                    .iter()
                    .any(|v| v.id == family.default_version && v.content == id)
        }))
    }

    pub fn version_uses_content(&self, kind: LibraryKind, content: &str) -> bool {
        self.preferences.families.values().any(|family| {
            family.kind == kind
                && family.versions.len() > 1
                && family.versions.iter().any(|v| v.content == content)
        })
    }

    pub fn logical_source(&self, kind: LibraryKind, content: &str) -> Result<String> {
        let key = kind.key(content)?;
        if self.preferences.families.contains_key(&key) {
            return Ok(content.into());
        }
        let mut families = self.preferences.families.values().filter(|family| {
            family.kind == kind && family.versions.iter().any(|v| v.content == content)
        });
        let Some(family) = families.next() else {
            return Ok(content.into());
        };
        if families.next().is_some() {
            return Err(Error::Conflict(
                "Choose the logical preset before saving shared content",
            ));
        }
        Ok(family
            .logical_id
            .split_once(':')
            .ok_or(Error::Invalid("Invalid logical preset"))?
            .1
            .into())
    }

    /// The caller verifies that this logical preset belongs to the device.
    pub fn versions(&self, kind: LibraryKind, first: &str) -> Result<VersionView> {
        Ok(VersionView {
            catalog_revision: self.revision.clone(),
            preset: self.family(kind, first)?,
        })
    }

    pub fn edit_version(
        &mut self,
        kind: LibraryKind,
        first: &str,
        edit: VersionEdit,
    ) -> Result<VersionView> {
        self.edit_version_after(kind, first, edit, || Ok(()))
    }

    /// The verified content store stages new bytes before the pointer transaction.
    /// Publish a checked export into the selected version, preserving prior contents.
    pub fn publish_version(
        root: &std::path::Path,
        kind: LibraryKind,
        source: &str,
        target: oxidal_audio::lifecycle::VersionTarget,
        content: &str,
        publish: impl FnOnce() -> Result<()>,
    ) -> Result<VersionView> {
        Self::publish_export(root, kind, source, target, content, None, publish)
    }

    /// Reconstructing an export can produce fresh native file identifiers. Bind
    /// retries to the original verified input and return the first saved digest.
    pub fn publish_export(
        root: &std::path::Path,
        kind: LibraryKind,
        source: &str,
        target: oxidal_audio::lifecycle::VersionTarget,
        content: &str,
        input_hash: Option<&str>,
        publish: impl FnOnce() -> Result<()>,
    ) -> Result<VersionView> {
        let fingerprint = input_hash
            .map(|input| {
                let bytes = serde_json::to_vec(&("live-export", kind, &target, input))
                    .map_err(|_| Error::Invalid("Invalid version export input"))?;
                Ok::<_, Error>(format!("{:x}", Sha256::digest(bytes)))
            })
            .transpose()?;
        if source != target.expected_content {
            return Err(Error::Conflict(
                "The selected version has a different source",
            ));
        }
        let mut catalog = Self::open(root.to_owned())?;
        if catalog.logical_source(kind, &target.first)? != target.first {
            return Err(Error::Conflict(
                "Choose the logical preset for this version",
            ));
        }
        kind.key(content)?;
        let path = match kind {
            LibraryKind::Owned => root.join("owned").join(content),
            LibraryKind::Graph => root.join("graphs").join(format!("{content}.json")),
            LibraryKind::Rig => root.join("bundles").join(content),
            LibraryKind::Original => return Err(Error::Invalid("Save a copy in Mine first")),
        };
        let edit = VersionEdit {
            version: target.version,
            expected_content: target.expected_content,
            expected_revision: target.expected_revision,
            request_id: target.request_id,
            action: VersionAction::Publish {
                content: content.into(),
            },
        };
        catalog.edit_with_receipt(kind, &target.first, edit, fingerprint, || {
            if !path.try_exists()? {
                Self::mark_version_payload(root, kind, content)?;
            }
            publish()
        })
    }

    pub fn edit_version_after(
        &mut self,
        kind: LibraryKind,
        first: &str,
        edit: VersionEdit,
        publish: impl FnOnce() -> Result<()>,
    ) -> Result<VersionView> {
        self.edit_with_receipt(kind, first, edit, None, publish)
    }

    fn edit_with_receipt(
        &mut self,
        kind: LibraryKind,
        first: &str,
        edit: VersionEdit,
        fingerprint: Option<String>,
        publish: impl FnOnce() -> Result<()>,
    ) -> Result<VersionView> {
        if edit.request_id.len() > 96
            || edit.request_id.is_empty()
            || !edit
                .request_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(Error::Invalid("Invalid version request identifier"));
        }
        let fingerprint = match fingerprint {
            Some(value) => value,
            None => format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&(kind, first, &edit))
                        .map_err(|_| Error::Invalid("Invalid version edit"))?
                )
            ),
        };
        if let Some(previous) = self
            .preferences
            .version_receipts
            .iter()
            .find(|r| r.request_id == edit.request_id)
        {
            if previous.fingerprint != fingerprint {
                return Err(Error::Conflict("This request identifier was already used"));
            }
            return Ok(previous.response.clone());
        }
        if edit.expected_revision != self.revision {
            return Err(Error::Conflict("Library changed; refresh before editing"));
        }
        let mut family = self.family(kind, first)?;
        let index = family
            .versions
            .iter()
            .position(|v| v.id == edit.version)
            .ok_or(Error::Invalid("Preset version is unavailable"))?;
        if family.versions[index].content != edit.expected_content {
            return Err(Error::Conflict(
                "Preset version changed; reopen before editing",
            ));
        }
        family.generation = family
            .generation
            .checked_add(1)
            .ok_or(Error::Invalid("Version edit limit reached"))?;
        let mut candidate = self.preferences.clone();
        match edit.action {
            VersionAction::Create { name } => {
                if !valid_name(&name) || family.versions.len() >= 64 {
                    return Err(Error::Invalid(
                        "Use a valid version name and at most 64 versions",
                    ));
                }
                let seed =
                    serde_json::to_vec(&(&self.revision, &family.logical_id, &edit.version, &name))
                        .map_err(|_| Error::Invalid("Invalid version identifier"))?;
                let id = format!("{:x}", Sha256::digest(seed));
                family.versions.push(PresetVersion {
                    id,
                    name,
                    content: edit.expected_content,
                });
            }
            VersionAction::Rename { name } => {
                if !valid_name(&name) {
                    return Err(Error::Invalid(
                        "Use a version name of 1–120 bytes without control characters",
                    ));
                }
                family.versions[index].name = name;
            }
            VersionAction::Publish { content } => {
                let key = kind.key(&content)?;
                if family.default_version == edit.version {
                    self.move_default_content(
                        &mut candidate,
                        kind.key(&edit.expected_content)?,
                        key,
                    )?;
                }
                family.versions[index].content = content;
            }
            VersionAction::SetDefault => {
                let old = family
                    .versions
                    .iter()
                    .find(|v| v.id == family.default_version)
                    .ok_or(Error::Invalid("Default version is missing"))?;
                self.move_default_content(
                    &mut candidate,
                    kind.key(&old.content)?,
                    kind.key(&family.versions[index].content)?,
                )?;
                family.default_version = edit.version;
            }
            VersionAction::Delete => {
                if candidate.occurrences.iter().flatten().any(|entry| {
                    entry.preset.kind == kind
                        && entry.preset.id == first
                        && entry.settings.version.as_ref() == Some(&edit.version)
                }) {
                    return Err(Error::Conflict("A set entry uses this version"));
                }
                if family.default_version == edit.version || family.versions.len() == 1 {
                    return Err(Error::Conflict(
                        "Choose another default before removing this version",
                    ));
                }
                family.versions.remove(index);
            }
        }

        candidate
            .families
            .insert(family.logical_id.clone(), family.clone());
        let response = VersionView {
            catalog_revision: candidate.revision()?,
            preset: family,
        };
        if candidate.version_receipts.len() == 32 {
            candidate.version_receipts.remove(0);
        }
        candidate.version_receipts.push(VersionReceipt {
            request_id: edit.request_id,
            fingerprint,
            response: response.clone(),
        });
        publish()?;
        self.persist(candidate)?;
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_publication_and_no_space_leave_old_contents_visible_and_allow_retry() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-version-publication-fault-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let first = "c".repeat(64);
        let next = "d".repeat(64);
        let kind = LibraryKind::Rig;
        let view = CatalogStore::open(root.clone())
            .unwrap()
            .versions(kind, &first)
            .unwrap();
        let target = oxidal_audio::lifecycle::VersionTarget {
            first: first.clone(),
            version: "main".into(),
            expected_content: first.clone(),
            expected_revision: view.catalog_revision.clone(),
            request_id: "checked-save".into(),
        };
        let save = |target, publish: fn() -> Result<()>| {
            CatalogStore::publish_version(&root, kind, &first, target, &next, publish)
        };
        assert!(
            save(target.clone(), || Err(std::io::Error::from(
                std::io::ErrorKind::StorageFull
            )
            .into()))
            .is_err()
        );
        let recovered = CatalogStore::open(root.clone()).unwrap();
        assert!(!recovered.visible(kind, &next).unwrap());
        assert!(recovered.visible(kind, &first).unwrap());
        assert_eq!(
            recovered.versions(kind, &first).unwrap().catalog_revision,
            view.catalog_revision
        );
        let reply = save(target.clone(), || Ok(())).unwrap();
        assert_eq!(reply.preset.versions[0].content, next);
        assert_eq!(
            save(target, || panic!("replayed a completed write"))
                .unwrap()
                .catalog_revision,
            reply.catalog_revision
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_read_creates_no_files_and_edits_preserve_the_backup_and_identity() {
        let root = std::env::temp_dir().join(format!("oxidal-family-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let first = "c".repeat(64);
        let kind = LibraryKind::Rig;
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let before = store.versions(kind, &first).unwrap();
        assert!(!root.exists());
        assert_eq!(before.preset.default_version, "main");
        assert_eq!(before.preset.logical_id, format!("rig:{first}"));
        let item = LibraryItem {
            kind,
            id: first.clone(),
            name: "Rig".into(),
            source_name: "Rig".into(),
            origin: LibraryOrigin::Mine,
            archived: false,
            superseded: false,
            in_set_list: false,
            working_of: None,
        };
        let revision = store.reconcile(vec![item]).unwrap().revision;
        let bytes = fs::read(root.join("library.json")).unwrap();
        let sequence = std::cell::Cell::new(0);
        let edit = |revision: &str, version: &str, action| VersionEdit {
            request_id: {
                sequence.set(sequence.get() + 1);
                sequence.get().to_string()
            },
            expected_revision: revision.into(),
            expected_content: first.clone(),
            version: version.into(),
            action,
        };
        let created = store
            .edit_version(
                kind,
                &first,
                edit(
                    &revision,
                    "main",
                    VersionAction::Create {
                        name: "Quiet".into(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            fs::read(root.join("library-before-versions.json")).unwrap(),
            bytes
        );
        let id = &created.preset.versions[1].id;
        assert_eq!(created.preset.versions[1].content, first);
        let mut store = CatalogStore::open(root.clone()).unwrap();
        assert!(matches!(
            store.edit_version(kind, &first, edit(&revision, id, VersionAction::SetDefault)),
            Err(Error::Conflict(_))
        ));
        let renamed = store
            .edit_version(
                kind,
                &first,
                edit(
                    &created.catalog_revision,
                    id,
                    VersionAction::Rename {
                        name: "Rehearsal".into(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(&renamed.preset.versions[1].id, id);
        let switched = store
            .edit_version(
                kind,
                &first,
                edit(&renamed.catalog_revision, id, VersionAction::SetDefault),
            )
            .unwrap();
        assert_eq!(&switched.preset.default_version, id);
        assert!(matches!(
            store.edit_version(
                kind,
                &first,
                edit(&switched.catalog_revision, id, VersionAction::Delete)
            ),
            Err(Error::Conflict(_))
        ));
        let deleted = store
            .edit_version(
                kind,
                &first,
                edit(&switched.catalog_revision, "main", VersionAction::Delete),
            )
            .unwrap();
        assert_eq!(deleted.preset.versions.len(), 1);
        assert_eq!(
            fs::read(root.join("library-before-versions.json")).unwrap(),
            bytes
        );
        fs::remove_dir_all(root).unwrap();
    }
}
