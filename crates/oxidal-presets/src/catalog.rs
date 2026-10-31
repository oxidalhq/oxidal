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
    fn key(self, id: &str) -> Result<String> {
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
    Rename { name: String },
    Visibility { archived: bool },
    Move { up: bool },
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
    /// Remove only the deleted entry's display preferences; no logical-ID fanout.
    pub fn forget(&mut self, kind: LibraryKind, id: &str) -> Result<()> {
        let key = kind.key(id)?;
        let mut candidate = self.preferences.clone();
        candidate.labels.remove(&key);
        candidate.archived.remove(&key);
        candidate.order.retain(|k| k != &key);
        self.persist(candidate)
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
            a.kind
                .cmp(&b.kind)
                .then_with(|| self.rank(a).cmp(&self.rank(b)))
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
                let mut order = catalog
                    .items
                    .iter()
                    .filter(|i| i.kind == request.entry_kind)
                    .map(|i| i.kind.key(&i.id))
                    .collect::<Result<Vec<_>>>()?;
                let from = order.iter().position(|k| k == &key).expect("entry checked");
                let to = if up {
                    from.saturating_sub(1)
                } else {
                    (from + 1).min(order.len() - 1)
                };
                order.swap(from, to);
                let moved = order.iter().cloned().collect::<BTreeSet<_>>();
                candidate.order.retain(|k| !moved.contains(k));
                candidate.order.extend(order);
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
    fn labels_visibility_order_and_stale_requests_survive_reopen() {
        let root = std::env::temp_dir().join(format!("oxidal-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rows = vec![
            LibraryItem {
                kind: LibraryKind::Original,
                id: "a".repeat(64),
                name: "A".into(),
                source_name: "A".into(),
                archived: false,
            },
            LibraryItem {
                kind: LibraryKind::Original,
                id: "b".repeat(64),
                name: "B".into(),
                source_name: "B".into(),
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
