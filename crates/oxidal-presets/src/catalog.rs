//! Device-local library labels/order/visibility; immutable tone payloads stay intact.
mod keep_ready;
pub use keep_ready::KeepReady;
mod occurrences;
pub use occurrences::{
    EntrySettings, OccurrenceAction, OccurrenceEdit, ResolvedOccurrence, SetOccurrence, SetOrder,
};
mod versions;
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
pub use versions::{PresetFamily, PresetVersion, VersionAction, VersionEdit, VersionView};

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
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum LibraryKind {
    Original,
    Owned,
    Graph,
    /// The default only fills the unused entry of a `starter` request.
    #[default]
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
    /// An earlier saved revision of a preset that was saved again. It is kept
    /// as history and hidden from Library and the Removed list.
    #[serde(default)]
    pub superseded: bool,
    /// In the Set list (MIDI program changes and Previous/Next follow it).
    /// Presets in Mine are members unless taken out; read-only Oxidal sounds
    /// are members only when added. Earlier revisions and archived entries
    /// never are.
    #[serde(default)]
    pub in_set_list: bool,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryCatalog {
    pub revision: String,
    pub items: Vec<LibraryItem>,
    /// Milliseconds since the Unix epoch when a preset first joined this device catalog.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub added_at: BTreeMap<String, u64>,
    /// The starter set list was added or declined on this unit; it is offered
    /// at most once automatically.
    #[serde(default)]
    pub starter_offered: bool,
    /// The preset a `duplicate` made, in Mine and not in the set list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<crate::LibraryReference>,
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
    /// Add the entry to the end of the set list, or take it out. Taking a
    /// preset out keeps it in Mine; read-only Oxidal sounds can be added by
    /// reference.
    SetList {
        member: bool,
    },
    /// Append these entries to the set list in order, after the existing
    /// entries; members keep their place and nothing is replaced. An empty
    /// list declines the offer. Either way the starter is no longer offered.
    /// The request's own `entry_kind` and `id` are not used.
    Starter {
        entries: Vec<crate::LibraryReference>,
    },
    /// Append saved presets in selection order without changing first-use setup.
    AppendSet {
        entries: Vec<crate::LibraryReference>,
    },
    /// Make "Name copy" in Mine with the preset's scenes, MIDI and levels.
    /// The copy is not in the set list; the reply names it in `created`.
    Duplicate,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryUpdate {
    pub expected_revision: String,
    #[serde(default)]
    pub entry_kind: LibraryKind,
    #[serde(default)]
    pub id: String,
    pub action: LibraryAction,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Clone)]
struct Preferences {
    /// Absent until the existing inventory has been observed once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    added_at: Option<BTreeMap<String, u64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    keep_ready: Option<KeepReady>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    occurrences: Option<Vec<SetOccurrence>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    families: BTreeMap<String, PresetFamily>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    version_receipts: Vec<versions::VersionReceipt>,
    labels: BTreeMap<String, String>,
    archived: BTreeSet<String>,
    order: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    superseded: BTreeSet<String>,
    /// Presets in Mine taken out of the set list. Absent in files written
    /// before explicit membership, so everything in Mine stays in the list.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    left_out: BTreeSet<String>,
    /// Read-only Oxidal sounds added to the set list by reference.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    added: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    starter_offered: bool,
}
impl Preferences {
    fn revision(&self) -> Result<String> {
        // A receipt contains the revision returned to its caller. Hash only the
        // state callers can edit, so that the receipt can be written atomically.
        let mut state = self.clone();
        state.version_receipts.clear();
        let bytes = serde_json::to_vec(&state)
            .map_err(|_| Error::Invalid("Invalid library preferences"))?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}
#[derive(Debug)]
pub struct CatalogStore {
    version_stages: BTreeSet<String>,
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
        let first_inventory = candidate.added_at.is_none() && self.preferences.order.is_empty();
        candidate.added_at.get_or_insert_with(BTreeMap::new);
        if first_inventory || candidate.order != self.preferences.order {
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
    /// Saving an owned preset again (7.2): the new revision takes the earlier
    /// one's set-list place, name and visibility. The earlier revision stays on
    /// the device as hidden history, so references to it keep working.
    pub fn supersede(&mut self, kind: LibraryKind, old: &str, new: &str) -> Result<()> {
        let first = self.logical_source(kind, old)?;
        let mut family = self.family(kind, &first)?;
        let selected = family
            .versions
            .iter_mut()
            .find(|v| v.id == family.default_version)
            .ok_or(Error::Invalid("Default version is missing"))?;
        if selected.content != old {
            return Err(Error::Conflict(
                "Preset version changed; reopen before saving",
            ));
        }
        selected.content = new.into();
        let (old, new) = (kind.key(old)?, kind.key(new)?);
        if old == new {
            return Ok(());
        }
        let mut candidate = self.preferences.clone();
        candidate.families.insert(family.logical_id.clone(), family);
        self.move_default_content(&mut candidate, old, new)?;
        self.persist(candidate)
    }
    fn move_default_content(
        &self,
        candidate: &mut Preferences,
        old: String,
        new: String,
    ) -> Result<()> {
        if old == new {
            return Ok(());
        }
        self.move_keep_ready(candidate, &old, &new)?;
        if let Some(dates) = candidate.added_at.as_mut() {
            if let Some(original) = dates.remove(&old) {
                dates.insert(new.clone(), original);
            } else {
                dates.remove(&new);
            }
        }
        candidate.order.retain(|key| key != &new);
        match candidate.order.iter().position(|key| key == &old) {
            Some(place) => candidate.order[place] = new.clone(),
            None => candidate.order.push(new.clone()),
        }
        if let Some(label) = candidate.labels.get(&old).cloned() {
            candidate.labels.insert(new.clone(), label);
        } else {
            candidate.labels.remove(&new);
        }
        if candidate.archived.contains(&old) {
            candidate.archived.insert(new.clone());
        } else {
            candidate.archived.remove(&new);
        }
        // Set-list membership follows the preset to its new revision.
        for set in [&mut candidate.left_out, &mut candidate.added] {
            if set.remove(&old) {
                set.insert(new.clone());
            } else {
                set.remove(&new);
            }
        }
        candidate.archived.insert(old.clone());
        candidate.superseded.insert(old);
        candidate.superseded.remove(&new);
        if candidate.order.len() > 4096 || candidate.superseded.len() > 65536 {
            return Err(Error::Invalid("Library preferences exceed limit"));
        }
        Ok(())
    }

    /// Whether a later save of the same preset has replaced this revision.
    pub fn is_superseded(&self, kind: LibraryKind, id: &str) -> Result<bool> {
        Ok(self.preferences.superseded.contains(&kind.key(id)?)
            || self.unpublished_version(kind, id)?)
    }
    /// Remove only the deleted entry's display preferences; no logical-ID fanout.
    pub fn forget(&mut self, kind: LibraryKind, id: &str) -> Result<()> {
        let key = kind.key(id)?;
        let mut candidate = self.preferences.clone();
        if self.version_uses_content(kind, id) {
            return Err(Error::Conflict(
                "A saved preset version uses these contents",
            ));
        }
        candidate.families.retain(|_, family| {
            !(family.kind == kind && family.versions.len() == 1 && family.versions[0].content == id)
        });
        candidate.labels.remove(&key);
        candidate.archived.remove(&key);
        candidate.order.retain(|k| k != &key);
        candidate.superseded.remove(&key);
        candidate.left_out.remove(&key);
        candidate.added.remove(&key);
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
        if preferences.occurrences.as_ref().is_some_and(|rows| {
            rows.len() > 4096
                || rows.iter().any(|r| !r.valid())
                || rows.iter().map(|r| &r.id).collect::<BTreeSet<_>>().len() != rows.len()
        }) || preferences.version_receipts.len() > 32
            || preferences.families.len() > 4096
            || !preferences
                .families
                .iter()
                .all(|(key, family)| family.valid(key))
            || preferences.labels.len() > 4096
            || preferences.superseded.len() > 65536
            || preferences.archived.len() > 65536 + 4096
            || preferences.order.len() > 4096
            || preferences.left_out.len() > 4096
            || preferences.added.len() > 4096
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
        if preferences
            .added_at
            .as_ref()
            .is_some_and(|dates| dates.len() > 4096 || dates.keys().any(|key| !valid_key(key)))
        {
            return Err(Error::Invalid("Invalid catalog publication dates"));
        }
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
            .chain(preferences.superseded.iter())
            .chain(preferences.left_out.iter())
            .chain(preferences.added.iter())
            .any(|k| !valid_key(k))
            || preferences.order.iter().collect::<BTreeSet<_>>().len() != preferences.order.len()
        {
            return Err(Error::Invalid("Invalid library preferences"));
        }
        let revision = preferences.revision()?;
        let positions = preferences
            .order
            .iter()
            .cloned()
            .enumerate()
            .map(|(i, k)| (k, i))
            .collect();
        let mut version_stages = BTreeSet::new();
        let stage = root.join("version-staging");
        match fs::symlink_metadata(&stage) {
            Ok(meta) if meta.is_dir() => {
                for entry in fs::read_dir(stage)? {
                    let entry = entry?;
                    let key = entry
                        .file_name()
                        .into_string()
                        .map_err(|_| Error::Invalid("Invalid version stage"))?;
                    if !valid_key(&key)
                        || !entry.file_type()?.is_file()
                        || version_stages.len() >= 65536
                    {
                        return Err(Error::Invalid("Invalid version stage"));
                    }
                    version_stages.insert(key);
                }
            }
            Ok(_) => return Err(Error::Invalid("Invalid version staging directory")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        Ok(Self {
            version_stages,
            root,
            preferences,
            revision,
            positions,
        })
    }
    pub fn visible(&self, kind: LibraryKind, id: &str) -> Result<bool> {
        Ok(!self.preferences.archived.contains(&kind.key(id)?)
            && !self.unpublished_version(kind, id)?)
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
            item.superseded = self.is_superseded(item.kind, &item.id)?;
            item.in_set_list = self.member(item)?;
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
            added_at: self.preferences.added_at.clone().unwrap_or_default(),
            starter_offered: self.preferences.starter_offered,
            created: None,
        })
    }
    /// Set-list membership of a labelled, visibility-resolved entry.
    fn member(&self, item: &LibraryItem) -> Result<bool> {
        let key = item.kind.key(&item.id)?;
        if item.archived || item.superseded || item.kind == LibraryKind::Graph {
            return Ok(false);
        }
        Ok(match item.origin {
            LibraryOrigin::Mine => !self.preferences.left_out.contains(&key),
            LibraryOrigin::OxidalExample => {
                item.kind == LibraryKind::Rig && self.preferences.added.contains(&key)
            }
            LibraryOrigin::Tone3000 => false,
        })
    }
    /// Take a preset that was just made (Duplicate) out of the set list and
    /// place it after its source, so it is in Mine but not in the list.
    pub fn leave_out_after(
        &mut self,
        kind: LibraryKind,
        id: &str,
        source: &crate::LibraryReference,
    ) -> Result<()> {
        let key = kind.key(id)?;
        let after = source.kind.key(&source.id)?;
        let mut candidate = self.preferences.clone();
        candidate.order.retain(|k| k != &key);
        let place = candidate
            .order
            .iter()
            .position(|k| k == &after)
            .map_or(candidate.order.len(), |i| i + 1);
        candidate.order.insert(place, key.clone());
        candidate.left_out.insert(key);
        if candidate.order.len() > 4096 || candidate.left_out.len() > 4096 {
            return Err(Error::Invalid("Library preferences exceed limit"));
        }
        self.persist(candidate)
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
        if let LibraryAction::Starter { entries } | LibraryAction::AppendSet { entries } =
            &request.action
        {
            let starter = matches!(request.action, LibraryAction::Starter { .. });
            if starter && entries.len() > 64 {
                return Err(Error::Invalid("A starter set list has at most 64 presets"));
            }
            if entries.len() > 4096 {
                return Err(Error::Invalid("A set list has at most 4096 presets"));
            }
            let mut order = catalog
                .items
                .iter()
                .map(|i| i.kind.key(&i.id))
                .collect::<Result<Vec<_>>>()?;
            for entry in entries {
                let item = catalog
                    .items
                    .iter()
                    .find(|i| i.kind == entry.kind && i.id == entry.id)
                    .ok_or(Error::Invalid(if starter {
                        "A starter preset is not on this unit"
                    } else {
                        "A selected preset is not on this unit"
                    }))?;
                if item.in_set_list
                    || candidate.added.contains(&item.kind.key(&item.id)?)
                    || (item.origin == LibraryOrigin::Mine
                        && !candidate.left_out.contains(&item.kind.key(&item.id)?))
                {
                    continue;
                }
                Self::join(&catalog, &mut candidate, &mut order, item)?;
            }
            candidate.order = order;
            candidate.starter_offered |= starter;
            return self.commit(candidate, catalog.items);
        }
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
                Self::movable(moving)?;
                let visible = catalog
                    .items
                    .iter()
                    .filter(|i| Self::same_list(i, request.entry_kind))
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
                    let before = visible.get(to + usize::from(!up)).map(String::as_str);
                    self.place_unique_occurrence(
                        &catalog,
                        &mut candidate,
                        request.entry_kind,
                        &request.id,
                        before,
                    )?;
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
                Self::movable(moving)?;
                let before = before
                    .map(|entry| {
                        if !catalog.items.iter().any(|i| {
                            i.kind == entry.kind
                                && i.id == entry.id
                                && Self::same_list(i, request.entry_kind)
                        }) {
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
                self.place_unique_occurrence(
                    &catalog,
                    &mut candidate,
                    request.entry_kind,
                    &request.id,
                    before.as_deref(),
                )?;
                order.insert(target, key);
                candidate.order = order;
            }
            LibraryAction::SetList { member } => {
                let item = catalog
                    .items
                    .iter()
                    .find(|item| item.kind == request.entry_kind && item.id == request.id)
                    .expect("entry checked");
                if !member && let Some(rows) = candidate.occurrences.as_mut() {
                    let first = self.logical_source(item.kind, &item.id)?;
                    let matches =
                        |r: &SetOccurrence| r.preset.kind == item.kind && r.preset.id == first;
                    if rows.iter().filter(|r| matches(r)).count() > 1 {
                        return Err(Error::Conflict("Choose which repeated set entry to remove"));
                    }
                    rows.retain(|r| !matches(r));
                }
                if member == item.in_set_list {
                    return Ok(catalog);
                }
                if member {
                    let mut order = catalog
                        .items
                        .iter()
                        .map(|i| i.kind.key(&i.id))
                        .collect::<Result<Vec<_>>>()?;
                    Self::join(&catalog, &mut candidate, &mut order, item)?;
                    candidate.order = order;
                } else if item.origin == LibraryOrigin::Mine {
                    candidate.left_out.insert(key);
                } else {
                    candidate.added.remove(&key);
                }
            }
            LibraryAction::Starter { .. } | LibraryAction::AppendSet { .. } => {
                unreachable!("handled above")
            }
            LibraryAction::Duplicate => {
                return Err(Error::Invalid("Duplicate needs the preset store"));
            }
        }
        self.commit(candidate, catalog.items)
    }
    fn commit(
        &mut self,
        candidate: Preferences,
        items: Vec<LibraryItem>,
    ) -> Result<LibraryCatalog> {
        if candidate.labels.len() > 4096
            || candidate.archived.len() > 4096
            || candidate.order.len() > 4096
            || candidate.left_out.len() > 4096
            || candidate.added.len() > 4096
        {
            return Err(Error::Invalid("Library preferences exceed limit"));
        }
        self.persist(candidate)?;
        self.view(items)
    }
    /// Only set-list members move in the set list; effects drafts keep their
    /// own order among the drafts in Mine.
    fn movable(item: &LibraryItem) -> Result<()> {
        if item.kind == LibraryKind::Graph && item.origin == LibraryOrigin::Mine {
            return Ok(());
        }
        if item.in_set_list {
            return Ok(());
        }
        Err(Error::Invalid(match item.origin {
            LibraryOrigin::Tone3000 => "Only presets in Mine belong to the set list",
            _ if item.kind == LibraryKind::Original || item.kind == LibraryKind::Graph => {
                "Only presets in Mine belong to the set list"
            }
            _ => "Add this preset to the set list before moving it",
        }))
    }
    /// The list an entry of `kind` moves within: the set list, or the effects
    /// drafts in Mine.
    fn same_list(item: &LibraryItem, kind: LibraryKind) -> bool {
        if kind == LibraryKind::Graph {
            item.kind == LibraryKind::Graph && !item.archived && item.origin == LibraryOrigin::Mine
        } else {
            item.in_set_list
        }
    }
    /// Make `item` a set-list member at the end of the list: after the last
    /// current member, before any effects drafts.
    fn join(
        catalog: &LibraryCatalog,
        candidate: &mut Preferences,
        order: &mut Vec<String>,
        item: &LibraryItem,
    ) -> Result<()> {
        if item.archived || item.superseded {
            return Err(Error::Invalid(
                "Restore a preset before adding it to the set list",
            ));
        }
        let key = item.kind.key(&item.id)?;
        match (item.origin, item.kind) {
            (LibraryOrigin::Mine, LibraryKind::Rig | LibraryKind::Owned) => {
                candidate.left_out.remove(&key);
            }
            (LibraryOrigin::OxidalExample, LibraryKind::Rig) => {
                candidate.added.insert(key.clone());
            }
            _ => {
                return Err(Error::Invalid(
                    "Only presets in Mine and Oxidal sounds belong to the set list",
                ));
            }
        }
        // Members as they now stand, so a batch keeps its own order.
        let member = |k: &String| {
            catalog.items.iter().any(|i| {
                i.kind.key(&i.id).is_ok_and(|ik| &ik == k)
                    && !i.archived
                    && !i.superseded
                    && i.kind != LibraryKind::Graph
                    && match i.origin {
                        LibraryOrigin::Mine => !candidate.left_out.contains(k),
                        LibraryOrigin::OxidalExample => candidate.added.contains(k),
                        LibraryOrigin::Tone3000 => false,
                    }
            })
        };
        order.retain(|k| k != &key);
        let place = order.iter().rposition(member).map_or_else(
            || {
                order
                    .iter()
                    .position(|k| k.starts_with("graph:"))
                    .unwrap_or(order.len())
            },
            |i| i + 1,
        );
        order.insert(place, key);
        Ok(())
    }
    fn persist(&mut self, mut candidate: Preferences) -> Result<()> {
        if self.preferences.added_at.is_some() || !self.preferences.order.is_empty() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok());
            let dates = candidate.added_at.get_or_insert_with(BTreeMap::new);
            let inventory: BTreeSet<_> = candidate.order.iter().collect();
            dates.retain(|key, _| inventory.contains(key));
            for key in &candidate.order {
                if self.positions.contains_key(key)
                    || candidate.superseded.contains(key)
                    || dates.contains_key(key)
                {
                    continue;
                }
                // Versions keep the original catalog date, including unknown legacy dates.
                if let Some(now) = now
                    && !candidate.families.values().any(|family| {
                        family
                            .versions
                            .iter()
                            .any(|v| family.kind.key(&v.content).is_ok_and(|id| id == *key))
                    })
                {
                    dates.insert(key.clone(), now);
                }
            }
        }
        let revision = candidate.revision()?;
        let bytes = serde_json::to_vec(&candidate)
            .map_err(|_| Error::Invalid("Invalid library preferences"))?;
        if bytes.len() > 1024 * 1024 {
            return Err(Error::Invalid("Library preferences exceed storage limit"));
        }
        fs::create_dir_all(&self.root)?;
        // Bundle publication and catalog editing can run in different workers.
        // Compare the durable revision under one lock before replacing its file.
        let path = self.root.join(".library.lock");
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(Error::Invalid("Invalid library lock"));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        lock.lock()?;
        if Self::open(self.root.clone())?.revision != self.revision {
            return Err(Error::Conflict("Library changed; refresh before editing"));
        }
        if self.preferences.families.is_empty() && !candidate.families.is_empty() {
            // Rename-based writes leave the backed-up inode immutable.
            let source = self.root.join("library.json");
            if source.try_exists()? {
                let backup = self.root.join("library-before-versions.json");
                match fs::hard_link(source, &backup) {
                    Ok(()) => fs::File::open(&self.root)?.sync_all()?,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        let metadata = fs::symlink_metadata(&backup)?;
                        if !metadata.is_file() || metadata.len() > 1024 * 1024 {
                            return Err(Error::Invalid("Invalid pre-version library backup"));
                        }
                        serde_json::from_slice::<Preferences>(&fs::read(backup)?)
                            .map_err(|_| Error::Invalid("Invalid pre-version library backup"))?;
                    }
                    Err(e) => return Err(e.into()),
                }
            }
        }
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
        self.revision = revision;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_addition_dates_survive_restart_reorder_and_version_saves() {
        let root =
            std::env::temp_dir().join(format!("oxidal-catalog-dates-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let row = |letter: &str| LibraryItem {
            kind: LibraryKind::Rig,
            id: letter.repeat(64),
            name: letter.into(),
            source_name: letter.into(),
            origin: LibraryOrigin::Mine,
            archived: false,
            superseded: false,
            in_set_list: false,
        };
        let legacy = row("a");
        let fresh = row("b");
        let saved = row("c");
        let legacy_saved = row("d");
        let key = |item: &LibraryItem| item.kind.key(&item.id).unwrap();
        let mut store = CatalogStore::open(root.clone()).unwrap();
        assert!(
            store
                .reconcile(vec![legacy.clone()])
                .unwrap()
                .added_at
                .is_empty()
        );
        let stale = store.revision.clone();
        let both = vec![legacy.clone(), fresh.clone()];
        let catalog = store.reconcile(both.clone()).unwrap();
        let added = catalog.added_at[&key(&fresh)];
        assert!(added > 0);
        assert!(!catalog.added_at.contains_key(&key(&legacy)));
        let move_up = |revision| LibraryUpdate {
            expected_revision: revision,
            entry_kind: fresh.kind,
            id: fresh.id.clone(),
            action: LibraryAction::Move { up: true },
        };
        assert!(store.update(both.clone(), move_up(stale)).is_err());
        assert_eq!(
            store
                .update(both, move_up(catalog.revision))
                .unwrap()
                .added_at[&key(&fresh)],
            added
        );
        store.supersede(fresh.kind, &fresh.id, &saved.id).unwrap();
        store
            .supersede(legacy.kind, &legacy.id, &legacy_saved.id)
            .unwrap();
        let mut reopened = CatalogStore::open(root.clone()).unwrap();
        let catalog = reopened
            .reconcile(vec![legacy, fresh, saved.clone(), legacy_saved.clone()])
            .unwrap();
        assert_eq!(catalog.added_at[&key(&saved)], added);
        assert!(!catalog.added_at.contains_key(&key(&legacy_saved)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saving_again_keeps_the_place_name_and_hides_the_earlier_revision() {
        let root = std::env::temp_dir().join(format!("oxidal-supersede-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rig = |id: &str| LibraryItem {
            kind: LibraryKind::Rig,
            id: id.repeat(64),
            name: format!("Rig {id}"),
            source_name: format!("Rig {id}"),
            origin: LibraryOrigin::Mine,
            archived: false,
            superseded: false,
            in_set_list: false,
        };
        let mut rows = vec![rig("a"), rig("b"), rig("c")];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let first = store.reconcile(rows.clone()).unwrap();
        let mut stale = CatalogStore::open(root.clone()).unwrap();
        let renamed = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: first.revision,
                    entry_kind: LibraryKind::Rig,
                    id: "a".repeat(64),
                    action: LibraryAction::Rename {
                        name: "Lead".into(),
                    },
                },
            )
            .unwrap();
        assert_eq!(renamed.items[0].name, "Lead");
        assert!(matches!(
            stale.supersede(LibraryKind::Rig, &"a".repeat(64), &"e".repeat(64)),
            Err(Error::Conflict(_))
        ));
        // "a" is saved again as "d": same place, same name, no new row at the end.
        rows.push(rig("d"));
        store
            .supersede(LibraryKind::Rig, &"a".repeat(64), &"d".repeat(64))
            .unwrap();
        let view = CatalogStore::open(root.clone())
            .unwrap()
            .reconcile(rows.clone())
            .unwrap();
        let visible: Vec<_> = view
            .items
            .iter()
            .filter(|i| !i.archived)
            .map(|i| (i.id.chars().next().unwrap(), i.name.as_str()))
            .collect();
        assert_eq!(visible, [('d', "Lead"), ('b', "Rig b"), ('c', "Rig c")]);
        let earlier = view.items.iter().find(|i| i.id == "a".repeat(64)).unwrap();
        assert!(earlier.archived && earlier.superseded);
        let mut current = CatalogStore::open(root.clone()).unwrap();
        assert!(
            current
                .is_superseded(LibraryKind::Rig, &"a".repeat(64))
                .unwrap()
        );
        assert!(
            !current
                .is_superseded(LibraryKind::Rig, &"d".repeat(64))
                .unwrap()
        );
        // Saving the original bytes again resurrects A in D's visible slot.
        current
            .supersede(LibraryKind::Rig, &"d".repeat(64), &"a".repeat(64))
            .unwrap();
        let view = CatalogStore::open(root.clone())
            .unwrap()
            .reconcile(rows.clone())
            .unwrap();
        let visible: Vec<_> = view
            .items
            .iter()
            .filter(|i| !i.archived)
            .map(|i| (i.id.chars().next().unwrap(), i.name.as_str()))
            .collect();
        assert_eq!(visible, [('a', "Lead"), ('b', "Rig b"), ('c', "Rig c")]);
        assert!(!view.items[0].superseded);
        // An intentionally archived current revision remains archived on return.
        let mut store = CatalogStore::open(root.clone()).unwrap();
        store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: view.revision,
                    entry_kind: LibraryKind::Rig,
                    id: "a".repeat(64),
                    action: LibraryAction::Visibility { archived: true },
                },
            )
            .unwrap();
        store
            .supersede(LibraryKind::Rig, &"a".repeat(64), &"d".repeat(64))
            .unwrap();
        let view = CatalogStore::open(root.clone())
            .unwrap()
            .reconcile(rows)
            .unwrap();
        let restored = view.items.iter().find(|i| i.id == "d".repeat(64)).unwrap();
        assert!(restored.archived && !restored.superseded);
        let _ = fs::remove_dir_all(root);
    }
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
            superseded: false,
            in_set_list: false,
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
                superseded: false,
                in_set_list: false,
            },
            LibraryItem {
                kind: LibraryKind::Graph,
                id: "b".repeat(64),
                name: "Draft".into(),
                source_name: "Draft".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
                superseded: false,
                in_set_list: false,
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
                superseded: false,
                in_set_list: false,
            },
            LibraryItem {
                kind: LibraryKind::Original,
                id: "b".repeat(64),
                name: "B".into(),
                source_name: "B".into(),
                origin: LibraryOrigin::Mine,
                archived: false,
                superseded: false,
                in_set_list: false,
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
            superseded: false,
            in_set_list: false,
        };
        let rows = vec![
            row("a", LibraryOrigin::Tone3000),
            row("b", LibraryOrigin::Mine),
            row("c", LibraryOrigin::OxidalExample),
            row("d", LibraryOrigin::Mine),
        ];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.view(rows.clone()).unwrap();
        for (index, reason) in [
            (0, "Only presets in Mine"),
            (2, "Add this preset to the set list"),
        ] {
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
            assert!(error.to_string().contains(reason), "{error}");
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
            superseded: false,
            in_set_list: false,
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

    fn rows(spec: &[(&str, LibraryOrigin)]) -> Vec<LibraryItem> {
        spec.iter()
            .map(|(id, origin)| LibraryItem {
                kind: LibraryKind::Rig,
                id: id.repeat(64),
                name: format!("Rig {id}"),
                source_name: format!("Rig {id}"),
                origin: *origin,
                archived: false,
                superseded: false,
                in_set_list: false,
            })
            .collect()
    }
    fn members(catalog: &LibraryCatalog) -> Vec<char> {
        catalog
            .items
            .iter()
            .filter(|i| i.in_set_list)
            .map(|i| i.id.chars().next().unwrap())
            .collect()
    }
    #[test]
    fn set_list_membership_migrates_with_nothing_lost() {
        let root = std::env::temp_dir().join(format!("oxidal-membership-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let rows = rows(&[
            ("a", LibraryOrigin::Mine),
            ("b", LibraryOrigin::Mine),
            ("c", LibraryOrigin::OxidalExample),
            ("d", LibraryOrigin::Mine),
            ("e", LibraryOrigin::Tone3000),
        ]);
        // A file written before explicit membership: order, a label, an archived entry.
        let key = |id: &str| format!("rig:{}", id.repeat(64));
        let old = serde_json::json!({
            "labels": { key("a"): "Lead" },
            "archived": [key("d")],
            "order": [key("b"), key("a"), key("c"), key("d"), key("e")],
        });
        let bytes = serde_json::to_vec(&old).unwrap();
        fs::write(root.join("library.json"), &bytes).unwrap();
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let view = store.reconcile(rows.clone()).unwrap();
        // Every visible preset in Mine is in the set list, in the old order;
        // the example, the provider original and the removed entry are not.
        assert_eq!(members(&view), ['b', 'a']);
        assert_eq!(
            view.items
                .iter()
                .find(|i| i.id == "a".repeat(64))
                .unwrap()
                .name,
            "Lead"
        );
        assert!(!view.starter_offered);
        // Reading does not rewrite the file or change its revision.
        assert_eq!(fs::read(root.join("library.json")).unwrap(), bytes);
        // Nothing new is written for a migrated file, so its revision is the
        // one older readers computed.
        let stored = String::from_utf8(serde_json::to_vec(&store.preferences).unwrap()).unwrap();
        assert!(
            !["left_out", "added", "starter_offered"]
                .iter()
                .any(|field| stored.contains(field))
        );
        assert_eq!(
            view.revision,
            format!("{:x}", Sha256::digest(stored.as_bytes()))
        );
        // Restoring the archived preset brings it back into the set list.
        let restored = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: view.revision,
                    entry_kind: LibraryKind::Rig,
                    id: "d".repeat(64),
                    action: LibraryAction::Visibility { archived: false },
                },
            )
            .unwrap();
        assert_eq!(members(&restored), ['b', 'a', 'd']);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn append_set_preserves_order_and_starter_offer_across_reopen() {
        let root = std::env::temp_dir().join(format!("oxidal-append-set-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rows = rows(&[
            ("a", LibraryOrigin::Mine),
            ("b", LibraryOrigin::OxidalExample),
            ("c", LibraryOrigin::OxidalExample),
            ("d", LibraryOrigin::Tone3000),
        ]);
        let reference = |id: &str| crate::LibraryReference {
            kind: LibraryKind::Rig,
            id: id.repeat(64),
        };
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.reconcile(rows.clone()).unwrap();
        let request = |revision: String, entries| LibraryUpdate {
            expected_revision: revision,
            entry_kind: LibraryKind::default(),
            id: String::new(),
            action: LibraryAction::AppendSet { entries },
        };

        // A rejected batch must not partially add earlier valid entries.
        assert!(
            store
                .update(
                    rows.clone(),
                    request(
                        initial.revision.clone(),
                        vec![reference("b"), reference("d")]
                    ),
                )
                .is_err()
        );
        let unchanged = store.view(rows.clone()).unwrap();
        assert_eq!(unchanged.revision, initial.revision);
        assert_eq!(members(&unchanged), ['a']);
        assert!(!unchanged.starter_offered);

        let saved = store
            .update(
                rows.clone(),
                request(
                    unchanged.revision,
                    vec![reference("c"), reference("b"), reference("c")],
                ),
            )
            .unwrap();
        assert_eq!(members(&saved), ['a', 'c', 'b']);
        assert!(!saved.starter_offered);
        let reopened = CatalogStore::open(root.clone())
            .unwrap()
            .view(rows)
            .unwrap();
        assert_eq!(reopened.revision, saved.revision);
        assert_eq!(members(&reopened), ['a', 'c', 'b']);
        assert!(!reopened.starter_offered);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn set_list_add_remove_starter_append_and_saved_again_keep_membership() {
        let root = std::env::temp_dir().join(format!("oxidal-set-list-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let mut rows = rows(&[
            ("a", LibraryOrigin::Mine),
            ("b", LibraryOrigin::Mine),
            ("c", LibraryOrigin::OxidalExample),
            ("d", LibraryOrigin::OxidalExample),
            ("e", LibraryOrigin::Tone3000),
        ]);
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let view = store.reconcile(rows.clone()).unwrap();
        assert_eq!(members(&view), ['a', 'b']);
        let update = |store: &mut CatalogStore,
                      rows: &Vec<LibraryItem>,
                      revision: String,
                      id: &str,
                      action| {
            store.update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: revision,
                    entry_kind: LibraryKind::Rig,
                    id: id.repeat(64),
                    action,
                },
            )
        };
        // Taking a preset out keeps it in Mine; adding it back appends it.
        let out = update(
            &mut store,
            &rows,
            view.revision,
            "a",
            LibraryAction::SetList { member: false },
        )
        .unwrap();
        assert_eq!(members(&out), ['b']);
        assert!(
            out.items
                .iter()
                .any(|i| i.id == "a".repeat(64) && !i.archived)
        );
        let error = update(
            &mut store,
            &rows,
            out.revision.clone(),
            "a",
            LibraryAction::Move { up: true },
        )
        .unwrap_err();
        assert!(error.to_string().contains("Add this preset"));
        let error = update(
            &mut store,
            &rows,
            out.revision.clone(),
            "e",
            LibraryAction::SetList { member: true },
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Only presets in Mine and Oxidal sounds")
        );
        // An Oxidal sound joins by reference at the end.
        let added = update(
            &mut store,
            &rows,
            out.revision,
            "d",
            LibraryAction::SetList { member: true },
        )
        .unwrap();
        assert_eq!(members(&added), ['b', 'd']);
        // the starter appends after the existing entries; members keep
        // their place and nothing is replaced.
        let reference = |id: &str| crate::LibraryReference {
            kind: LibraryKind::Rig,
            id: id.repeat(64),
        };
        let starter = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: added.revision,
                    entry_kind: LibraryKind::default(),
                    id: String::new(),
                    action: LibraryAction::Starter {
                        entries: vec![reference("c"), reference("d"), reference("a")],
                    },
                },
            )
            .unwrap();
        assert_eq!(members(&starter), ['b', 'd', 'c', 'a']);
        assert!(starter.starter_offered);
        // Moving works for a referenced Oxidal sound in the set list.
        let moved = update(
            &mut store,
            &rows,
            starter.revision,
            "c",
            LibraryAction::Move { up: true },
        )
        .unwrap();
        assert_eq!(members(&moved), ['b', 'c', 'd', 'a']);
        // Saving a left-out preset again keeps it out; a member stays a member.
        let out = update(
            &mut store,
            &rows,
            moved.revision,
            "b",
            LibraryAction::SetList { member: false },
        )
        .unwrap();
        assert_eq!(members(&out), ['c', 'd', 'a']);
        rows.extend(self::tests::rows(&[("f", LibraryOrigin::Mine)]));
        store
            .supersede(LibraryKind::Rig, &"b".repeat(64), &"f".repeat(64))
            .unwrap();
        let view = CatalogStore::open(root.clone())
            .unwrap()
            .reconcile(rows.clone())
            .unwrap();
        assert_eq!(members(&view), ['c', 'd', 'a']);
        // Duplicate's copy sits after its source and is not in the set list.
        rows.extend(self::tests::rows(&[("9", LibraryOrigin::Mine)]));
        let mut store = CatalogStore::open(root.clone()).unwrap();
        store.reconcile(rows.clone()).unwrap();
        store
            .leave_out_after(LibraryKind::Rig, &"9".repeat(64), &reference("c"))
            .unwrap();
        let view = store.view(rows.clone()).unwrap();
        assert_eq!(members(&view), ['c', 'd', 'a']);
        let order: Vec<char> = view
            .items
            .iter()
            .map(|i| i.id.chars().next().unwrap())
            .collect();
        let at = |c| order.iter().position(|o| *o == c).unwrap();
        assert_eq!(at('9'), at('c') + 1);
        // Starter with nothing declines the offer without changing the list.
        let declined = store
            .update(
                rows.clone(),
                LibraryUpdate {
                    expected_revision: view.revision,
                    entry_kind: LibraryKind::default(),
                    id: String::new(),
                    action: LibraryAction::Starter { entries: vec![] },
                },
            )
            .unwrap();
        assert_eq!(members(&declined), ['c', 'd', 'a']);
        fs::remove_dir_all(root).unwrap();
    }
}
