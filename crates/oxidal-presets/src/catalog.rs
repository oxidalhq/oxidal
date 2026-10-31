//! Device-local library labels/order/visibility; immutable tone payloads stay intact.
use crate::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum LibraryOrigin {
    Tone3000,
    OxidalExample,
    #[default]
    Mine,
}
impl LibraryOrigin {
    /// Portable rigs are Mine unless their authoring extension explicitly marks
    /// a read-only Oxidal example or a provider reference.
    pub fn from_manifest(manifest: &crate::manifest::Manifest) -> Result<Self> {
        let Some(value) = manifest
            .extensions
            .get("urn:oxidal:authoring")
            .and_then(|extension| extension.get("origin"))
        else {
            return Ok(Self::Mine);
        };
        match value.as_str() {
            Some("tone3000") => Ok(Self::Tone3000),
            Some("oxidal_example") => Ok(Self::OxidalExample),
            Some("mine") => Ok(Self::Mine),
            _ => Err(Error::Invalid("Invalid preset origin")),
        }
    }
}

fn default_group(kind: LibraryKind) -> u8 {
    match kind {
        LibraryKind::Rig => 0,
        LibraryKind::Owned => 1,
        LibraryKind::Original => 2,
        LibraryKind::Graph => 3,
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum LibraryKind {
    Original,
    Owned,
    Graph,
    Rig,
}
impl LibraryKind {
    pub(crate) fn key(self, id: &str) -> Result<String> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("Invalid library identifier"));
        }
        Ok(format!(
            "{}:{id}",
            match self {
                Self::Original => "original",
                Self::Owned => "owned",
                Self::Graph => "graph",
                Self::Rig => "rig",
            }
        ))
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryItem {
    pub kind: LibraryKind,
    pub id: String,
    pub name: String,
    pub source_name: String,
    #[serde(default)]
    pub origin: LibraryOrigin,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryCatalog {
    pub revision: String,
    pub items: Vec<LibraryItem>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum LibraryAction {
    Rename {
        name: String,
    },
    Visibility {
        archived: bool,
    },
    Move {
        up: bool,
    },
    Place {
        before: Option<crate::LibraryReference>,
    },
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryUpdate {
    pub expected_revision: String,
    pub entry_kind: LibraryKind,
    pub id: String,
    pub action: LibraryAction,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Clone)]
struct Preferences {
    labels: BTreeMap<String, String>,
    archived: BTreeSet<String>,
    order: Vec<String>,
}
#[derive(Debug)]
pub struct CatalogStore {
    root: PathBuf,
    preferences: Preferences,
    revision: String,
    positions: BTreeMap<String, usize>,
}
impl CatalogStore {
    /// Refresh the bounded inventory cache under the caller's store lock. Existing
    /// positions stay stable; newly published files join the end, oldest first.
    pub fn reconcile(&mut self, items: Vec<LibraryItem>) -> Result<LibraryCatalog> {
        let catalog = self.view(items.clone())?;
        let known = items
            .iter()
            .map(|i| i.kind.key(&i.id))
            .collect::<Result<BTreeSet<_>>>()?;
        let mut candidate = self.preferences.clone();
        candidate.order.retain(|key| known.contains(key));
        let mut unseen = catalog
            .items
            .iter()
            .filter(|i| {
                !self
                    .positions
                    .contains_key(&i.kind.key(&i.id).expect("validated key"))
            })
            .collect::<Vec<_>>();
        if !self.preferences.order.is_empty() {
            unseen.sort_by_key(|item| self.published(item));
        }
        for item in unseen {
            candidate.order.push(item.kind.key(&item.id)?);
        }
        if candidate.order != self.preferences.order {
            if candidate.order.len() > 4096 {
                return Err(Error::Invalid("Set list exceeds library capacity"));
            }
            self.persist(candidate)?;
        }
        self.view(items)
    }
    fn published(&self, item: &LibraryItem) -> std::time::SystemTime {
        let path = match item.kind {
            LibraryKind::Original => self.root.join(format!("{}.t3kpreset", item.id)),
            LibraryKind::Owned => self.root.join("owned").join(&item.id),
            LibraryKind::Rig => self.root.join("bundles").join(&item.id),
            LibraryKind::Graph => self.root.join("graphs").join(format!("{}.json", item.id)),
        };
        fs::symlink_metadata(path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH)
    }
    /// Remove only the deleted entry's display preferences; no logical-ID fanout.
    pub fn forget(&mut self, kind: LibraryKind, id: &str) -> Result<()> {
        let key = kind.key(id)?;
        let mut candidate = self.preferences.clone();
        candidate.labels.remove(&key);
        candidate.archived.remove(&key);
        candidate.order.retain(|k| k != &key);
        self.persist(candidate)?;
        crate::DetailsStore::new(self.root.clone()).forget(kind, id)
    }
    pub fn open(root: PathBuf) -> Result<Self> {
        let path = root.join("library.json");
        let preferences = match fs::symlink_metadata(&path) {
            Ok(m) => {
                if !m.file_type().is_file() || m.len() > 1024 * 1024 {
                    return Err(Error::Invalid("Invalid library preferences"));
                }
                serde_json::from_slice::<Preferences>(&fs::read(path)?)
                    .map_err(|_| Error::Invalid("Invalid library preferences"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(e) => return Err(e.into()),
        };
        if preferences.labels.len() > 4096
            || preferences.archived.len() > 4096
            || preferences.order.len() > 4096
        {
            return Err(Error::Invalid("Library preferences exceed limit"));
        }
        let valid_key = |key: &str| {
            key.split_once(':').is_some_and(|(kind, id)| {
                matches!(kind, "original" | "owned" | "graph" | "rig")
                    && id.len() == 64
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        };
        if preferences.labels.iter().any(|(k, v)| {
            !valid_key(k)
                || v.trim() != v
                || v.is_empty()
                || v.len() > 120
                || v.chars().any(char::is_control)
        }) || preferences
            .archived
            .iter()
            .chain(preferences.order.iter())
            .any(|k| !valid_key(k))
            || preferences.order.iter().collect::<BTreeSet<_>>().len() != preferences.order.len()
        {
            return Err(Error::Invalid("Invalid library preferences"));
        }
        let revision = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&preferences)
                    .map_err(|_| Error::Invalid("Invalid library preferences"))?
            )
        );
        let positions = preferences
            .order
            .iter()
            .cloned()
            .enumerate()
            .map(|(i, k)| (k, i))
            .collect();
        Ok(Self {
            root,
            preferences,
            revision,
            positions,
        })
    }
    pub fn visible(&self, kind: LibraryKind, id: &str) -> Result<bool> {
        Ok(!self.preferences.archived.contains(&kind.key(id)?))
    }
    pub fn label<'a>(&'a self, kind: LibraryKind, id: &str, original: &'a str) -> Result<&'a str> {
        Ok(self
            .preferences
            .labels
            .get(&kind.key(id)?)
            .map_or(original, String::as_str))
    }
    pub fn view(&self, mut items: Vec<LibraryItem>) -> Result<LibraryCatalog> {
        for item in &mut items {
            item.name = self.label(item.kind, &item.id, &item.source_name)?.into();
            item.archived = !self.visible(item.kind, &item.id)?;
        }
        items.sort_by(|a, b| {
            (a.kind == LibraryKind::Graph)
                .cmp(&(b.kind == LibraryKind::Graph))
                .then_with(|| self.rank(a).cmp(&self.rank(b)))
                .then_with(|| default_group(a.kind).cmp(&default_group(b.kind)))
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(LibraryCatalog {
            revision: self.revision.clone(),
            items,
        })
    }
    pub fn position(&self, kind: LibraryKind, id: &str) -> Result<usize> {
        let key = kind.key(id)?;
        Ok(self.positions.get(&key).copied().unwrap_or(usize::MAX))
    }
    fn rank(&self, item: &LibraryItem) -> usize {
        let key = item
            .kind
            .key(&item.id)
            .expect("validated library identifier");
        self.positions.get(&key).copied().unwrap_or(usize::MAX)
    }
    /// Caller serializes mutations through the device store lock, off audio/async threads.
    pub fn update(
        &mut self,
        items: Vec<LibraryItem>,
        request: LibraryUpdate,
    ) -> Result<LibraryCatalog> {
        if request.expected_revision != self.revision {
            return Err(Error::Conflict("Library changed; refresh before editing"));
        }
        let catalog = self.view(items)?;
        let mut candidate = self.preferences.clone();
        let key = request.entry_kind.key(&request.id)?;
        if !catalog
            .items
            .iter()
            .any(|i| i.kind == request.entry_kind && i.id == request.id)
        {
            return Err(Error::Invalid("Library entry is unavailable"));
        }
        match request.action {
            LibraryAction::Rename { name } => {
                let name = name.trim();
                if name.is_empty() || name.len() > 120 || name.chars().any(char::is_control) {
                    return Err(Error::Invalid(
                        "Use a name of 1–120 bytes without control characters",
                    ));
                }
                candidate.labels.insert(key, name.into());
            }
            LibraryAction::Visibility { archived } => {
                if archived {
                    candidate.archived.insert(key);
                } else {
                    candidate.archived.remove(&key);
                }
            }
            LibraryAction::Move { up } => {
                if !self.visible(request.entry_kind, &request.id)? {
                    return Err(Error::Invalid("Restore a preset before moving it"));
                }
                let moving = catalog
                    .items
                    .iter()
                    .find(|item| item.kind == request.entry_kind && item.id == request.id)
                    .expect("entry checked");
                if moving.origin != LibraryOrigin::Mine {
                    return Err(Error::Invalid(
                        "Only presets in Mine belong to the set list",
                    ));
                }
                let visible = catalog
                    .items
                    .iter()
                    .filter(|i| {
                        !i.archived
                            && i.origin == LibraryOrigin::Mine
                            && (i.kind == LibraryKind::Graph)
                                == (request.entry_kind == LibraryKind::Graph)
                    })
                    .map(|i| i.kind.key(&i.id))
                    .collect::<Result<Vec<_>>>()?;
                let from = visible
                    .iter()
                    .position(|k| k == &key)
                    .expect("entry checked");
                let to = if up {
                    from.saturating_sub(1)
                } else {
                    (from + 1).min(visible.len() - 1)
                };
                let mut order = catalog
                    .items
                    .iter()
                    .map(|i| i.kind.key(&i.id))
                    .collect::<Result<Vec<_>>>()?;
                if from != to {
                    order.retain(|k| k != &key);
                    let target = order
                        .iter()
                        .position(|k| k == &visible[to])
                        .expect("target checked");
                    order.insert(target + usize::from(!up), key);
                }
                candidate.order = order;
            }
            LibraryAction::Place { before } => {
                if !self.visible(request.entry_kind, &request.id)? {
                    return Err(Error::Invalid("Restore a preset before moving it"));
                }
                let moving = catalog
                    .items
                    .iter()
                    .find(|item| item.kind == request.entry_kind && item.id == request.id)
                    .expect("entry checked");
                if moving.origin != LibraryOrigin::Mine {
                    return Err(Error::Invalid(
                        "Only presets in Mine belong to the set list",
                    ));
                }
                let before = before
                    .map(|entry| {
                        if !catalog.items.iter().any(|i| {
                            i.kind == entry.kind
                                && i.id == entry.id
                                && !i.archived
                                && i.origin == LibraryOrigin::Mine
                        }) || (entry.kind == LibraryKind::Graph)
                            != (request.entry_kind == LibraryKind::Graph)
                        {
                            return Err(Error::Invalid("Drop target is unavailable"));
                        }
                        entry.kind.key(&entry.id)
                    })
                    .transpose()?;
                if before.as_ref() == Some(&key) {
                    return Ok(catalog);
                }
                let mut order = catalog
                    .items
                    .iter()
                    .map(|i| i.kind.key(&i.id))
                    .collect::<Result<Vec<_>>>()?;
                order.retain(|k| k != &key);
                let target = before
                    .as_ref()
                    .and_then(|b| order.iter().position(|k| k == b))
                    .unwrap_or_else(|| {
                        if request.entry_kind == LibraryKind::Graph {
                            order.len()
                        } else {
                            order
                                .iter()
                                .position(|k| k.starts_with("graph:"))
                                .unwrap_or(order.len())
                        }
                    });
                order.insert(target, key);
                candidate.order = order;
            }
        }
        if candidate.labels.len() > 4096
            || candidate.archived.len() > 4096
            || candidate.order.len() > 4096
        {
            return Err(Error::Invalid("Library preferences exceed limit"));
        }
        self.persist(candidate)?;
        self.view(catalog.items)
    }
    fn persist(&mut self, candidate: Preferences) -> Result<()> {
        let bytes = serde_json::to_vec(&candidate)
            .map_err(|_| Error::Invalid("Invalid library preferences"))?;
        fs::create_dir_all(&self.root)?;
        let temporary = self.root.join(format!(
            ".library-{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| Error::Invalid("Invalid system clock"))?
                .as_nanos()
        ));
        let result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, self.root.join("library.json"))?;
            fs::File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        self.positions = candidate
            .order
            .iter()
            .cloned()
            .enumerate()
            .map(|(i, k)| (k, i))
            .collect();
        self.preferences = candidate;
        self.revision = format!("{:x}", Sha256::digest(bytes));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_order_crosses_kinds_preserves_hidden_slots_and_appends_new_entries() {
        let root = std::env::temp_dir().join(format!("oxidal-global-order-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let item = |kind, id: &str, name: &str| LibraryItem {
            kind,
            id: id.repeat(64),
            name: name.into(),
            source_name: name.into(),
            origin: LibraryOrigin::Mine,
            archived: false,
        };
        let mut rows = vec![
            item(LibraryKind::Original, "a", "Original"),
            item(LibraryKind::Owned, "b", "Copy"),
            item(LibraryKind::Rig, "c", "Scenes"),
        ];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.reconcile(rows.clone()).unwrap();
        assert_eq!(
            initial.items.iter().map(|i| i.kind).collect::<Vec<_>>(),
            [LibraryKind::Rig, LibraryKind::Owned, LibraryKind::Original]
        );
        let moved = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: initial.revision,
                    entry_kind: LibraryKind::Original,
                    id: rows[0].id.clone(),
                    action: LibraryAction::Place {
                        before: Some(crate::LibraryReference {
                            kind: LibraryKind::Rig,
                            id: rows[2].id.clone(),
                        }),
                    },
                },
            )
            .unwrap();
        assert_eq!(moved.items[0].kind, LibraryKind::Original);
        let hidden = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: moved.revision.clone(),
                    entry_kind: LibraryKind::Rig,
                    id: rows[2].id.clone(),
                    action: LibraryAction::Visibility { archived: true },
                },
            )
            .unwrap();
        assert_eq!(hidden.items[1].kind, LibraryKind::Rig);
        assert!(hidden.items[1].archived);
        assert!(matches!(
            store.update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: moved.revision,
                    entry_kind: LibraryKind::Original,
                    id: rows[0].id.clone(),
                    action: LibraryAction::Move { up: false }
                }
            ),
            Err(Error::Conflict(_))
        ));
        rows.push(item(LibraryKind::Original, "d", "A new name sorts first"));
        let appended = store.reconcile(rows.clone()).unwrap();
        assert_eq!(appended.items.last().unwrap().id, rows[3].id);
        let restored = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: appended.revision,
                    entry_kind: LibraryKind::Rig,
                    id: rows[2].id.clone(),
                    action: LibraryAction::Visibility { archived: false },
                },
            )
            .unwrap();
        assert_eq!(restored.items[1].kind, LibraryKind::Rig);
        let swapped = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: restored.revision,
                    entry_kind: LibraryKind::Owned,
                    id: rows[1].id.clone(),
                    action: LibraryAction::Move { up: true },
                },
            )
            .unwrap();
        assert_eq!(
            swapped.items.iter().map(|i| i.kind).collect::<Vec<_>>(),
            [
                LibraryKind::Original,
                LibraryKind::Owned,
                LibraryKind::Rig,
                LibraryKind::Original
            ]
        );
        let reopened = CatalogStore::open(root.clone())
            .unwrap()
            .reconcile(rows)
            .unwrap();
        assert_eq!(reopened.revision, swapped.revision);
        assert_eq!(reopened.items[1].kind, LibraryKind::Owned);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_drop_targets_do_not_rewrite_order_or_cross_into_authoring_drafts() {
        let root = std::env::temp_dir().join(format!("oxidal-drop-order-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rows = vec![
            LibraryItem {
                kind: LibraryKind::Owned,
                id: "a".repeat(64),
                name: "Copy".into(),
                source_name: "Copy".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
            },
            LibraryItem {
                kind: LibraryKind::Graph,
                id: "b".repeat(64),
                name: "Draft".into(),
                source_name: "Draft".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
            },
        ];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.reconcile(rows.clone()).unwrap();
        for target in [
            crate::LibraryReference {
                kind: LibraryKind::Rig,
                id: "c".repeat(64),
            },
            crate::LibraryReference {
                kind: LibraryKind::Graph,
                id: rows[1].id.clone(),
            },
        ] {
            assert!(
                store
                    .update(
                        rows.clone(),
                        LibraryUpdate {
                            expected_revision: initial.revision.clone(),
                            entry_kind: LibraryKind::Owned,
                            id: rows[0].id.clone(),
                            action: LibraryAction::Place {
                                before: Some(target)
                            }
                        }
                    )
                    .is_err()
            );
            assert_eq!(store.view(rows.clone()).unwrap().revision, initial.revision);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn labels_visibility_order_and_stale_requests_survive_reopen() {
        let root = std::env::temp_dir().join(format!("oxidal-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rows = vec![
            LibraryItem {
                kind: LibraryKind::Original,
                id: "a".repeat(64),
                name: "A".into(),
                source_name: "A".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
            },
            LibraryItem {
                kind: LibraryKind::Original,
                id: "b".repeat(64),
                name: "B".into(),
                source_name: "B".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
            },
        ];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let first = store.view(rows.clone()).unwrap();
        let changed = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: first.revision.clone(),
                    entry_kind: LibraryKind::Original,
                    id: rows[1].id.clone(),
                    action: LibraryAction::Move { up: true },
                },
            )
            .unwrap();
        assert_eq!(changed.items[0].id, rows[1].id);
        assert!(matches!(
            store.update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: first.revision,
                    entry_kind: LibraryKind::Original,
                    id: rows[0].id.clone(),
                    action: LibraryAction::Rename {
                        name: "stale".into()
                    }
                }
            ),
            Err(Error::Conflict(_))
        ));
        let renamed = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: changed.revision,
                    entry_kind: LibraryKind::Original,
                    id: rows[1].id.clone(),
                    action: LibraryAction::Rename {
                        name: "  New label  ".into(),
                    },
                },
            )
            .unwrap();
        assert_eq!(renamed.items[0].name, "New label");
        assert_eq!(renamed.items[0].source_name, "B");
        let archived = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: renamed.revision,
                    entry_kind: LibraryKind::Original,
                    id: rows[1].id.clone(),
                    action: LibraryAction::Visibility { archived: true },
                },
            )
            .unwrap();
        assert!(archived.items[0].archived);
        let reopened = CatalogStore::open(root.clone())
            .unwrap()
            .view(rows)
            .unwrap();
        assert_eq!(reopened.revision, archived.revision);
        assert_eq!(reopened.items[0].name, "New label");
        assert!(reopened.items[0].archived);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn provider_and_example_entries_never_join_or_reorder_the_mine_set_list() {
        let root = std::env::temp_dir().join(format!("oxidal-origin-order-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let row = |id: &str, origin| LibraryItem {
            kind: LibraryKind::Rig,
            id: id.repeat(64),
            name: id.into(),
            source_name: id.into(),
            origin,
            archived: false,
        };
        let rows = vec![
            row("a", LibraryOrigin::Tone3000),
            row("b", LibraryOrigin::Mine),
            row("c", LibraryOrigin::OxidalExample),
            row("d", LibraryOrigin::Mine),
        ];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.view(rows.clone()).unwrap();
        for index in [0, 2] {
            let error = store
                .update(
                    rows.clone(),
                    LibraryUpdate {
                        expected_revision: initial.revision.clone(),
                        entry_kind: LibraryKind::Rig,
                        id: rows[index].id.clone(),
                        action: LibraryAction::Move { up: false },
                    },
                )
                .unwrap_err();
            assert!(error.to_string().contains("Only presets in Mine"));
        }
        let moved = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: initial.revision,
                    entry_kind: LibraryKind::Rig,
                    id: rows[3].id.clone(),
                    action: LibraryAction::Move { up: true },
                },
            )
            .unwrap();
        let mine = moved
            .items
            .iter()
            .filter(|item| item.origin == LibraryOrigin::Mine)
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(mine, [rows[3].id.as_str(), rows[1].id.as_str()]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejected_names_paths_and_failed_storage_do_not_publish() {
        let root =
            std::env::temp_dir().join(format!("oxidal-catalog-failure-{}", std::process::id()));
        let _ = fs::remove_file(&root);
        let _ = fs::remove_dir_all(&root);
        let rows = vec![LibraryItem {
            kind: LibraryKind::Owned,
            id: "a".repeat(64),
            name: "A".into(),
            source_name: "A".into(),
            origin: LibraryOrigin::Mine,
            archived: false,
        }];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let revision = store.view(rows.clone()).unwrap().revision;
        for name in ["", "new\nname"] {
            assert!(
                store
                    .update(
                        rows.clone(),
                        LibraryUpdate {
                            expected_revision: revision.clone(),
                            entry_kind: LibraryKind::Owned,
                            id: rows[0].id.clone(),
                            action: LibraryAction::Rename { name: name.into() }
                        }
                    )
                    .is_err()
            );
        }
        assert!(
            store
                .update(
                    rows.clone(),
                    LibraryUpdate {
                        expected_revision: revision.clone(),
                        entry_kind: LibraryKind::Owned,
                        id: "../../escape".into(),
                        action: LibraryAction::Visibility { archived: true }
                    }
                )
                .is_err()
        );
        fs::write(&root, b"block directory creation").unwrap();
        assert!(
            store
                .update(
                    rows.clone(),
                    LibraryUpdate {
                        expected_revision: revision.clone(),
                        entry_kind: LibraryKind::Owned,
                        id: rows[0].id.clone(),
                        action: LibraryAction::Rename {
                            name: "Unpublished".into()
                        }
                    }
                )
                .is_err()
        );
        let unchanged = store.view(rows).unwrap();
        assert_eq!(unchanged.revision, revision);
        assert_eq!(unchanged.items[0].name, "A");
        fs::remove_file(root).unwrap();
    }
}
