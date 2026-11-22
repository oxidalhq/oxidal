//! A set-list slot has its own identity even when a preset appears twice.
use super::*;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EntrySettings {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub own_media: bool,
    pub version: Option<String>,
    pub scene: Option<String>,
    pub track: Option<String>,
    pub mix: Option<String>,
    pub sheet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SetOccurrence {
    pub id: String,
    pub preset: crate::LibraryReference,
    pub settings: EntrySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResolvedOccurrence {
    pub entry: SetOccurrence,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SetOrder {
    pub revision: String,
    pub entries: Vec<ResolvedOccurrence>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OccurrenceAction {
    Repeat { new_id: String },
    Change { settings: EntrySettings },
    Place { before: Option<String> },
    Remove,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceEdit {
    pub expected_revision: String,
    pub entry: String,
    pub action: OccurrenceAction,
}

fn safe_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
}

impl SetOccurrence {
    pub(super) fn valid(&self) -> bool {
        safe_id(&self.id)
            && self.preset.kind.key(&self.preset.id).is_ok()
            && matches!(self.preset.kind, LibraryKind::Rig | LibraryKind::Owned)
            && self
                .settings
                .version
                .as_deref()
                .is_none_or(|v| v == "main" || self.preset.kind.key(v).is_ok())
            && self.settings.scene.as_deref().is_none_or(safe_id)
            && [
                &self.settings.track,
                &self.settings.mix,
                &self.settings.sheet,
            ]
            .into_iter()
            .flatten()
            .all(|v| safe_id(v))
            && (self.settings.mix.is_none() || self.settings.track.is_some())
    }
}

impl CatalogStore {
    pub fn entry_settings(&self) -> impl Iterator<Item = &EntrySettings> {
        self.saved_occurrences().map(|row| &row.settings)
    }

    pub fn saved_occurrences(&self) -> impl Iterator<Item = &SetOccurrence> {
        self.preferences.occurrences.iter().flatten()
    }

    fn occurrence_rows(
        &self,
        catalog: &LibraryCatalog,
    ) -> Result<(Vec<SetOccurrence>, BTreeMap<String, LibraryItem>)> {
        let mut rows = self.preferences.occurrences.clone().unwrap_or_default();
        let mut known = rows
            .iter()
            .map(|row| row.preset.kind.key(&row.preset.id))
            .collect::<Result<BTreeSet<_>>>()?;
        let mut members = BTreeMap::new();
        for item in catalog.items.iter().filter(|item| item.in_set_list) {
            let first = self.logical_source(item.kind, &item.id)?;
            let key = item.kind.key(&first)?;
            if known.insert(key.clone()) {
                rows.push(SetOccurrence {
                    id: key.clone(),
                    preset: crate::LibraryReference {
                        kind: item.kind,
                        id: first,
                    },
                    settings: EntrySettings::default(),
                });
            }
            members.insert(key, item.clone());
        }
        Ok((rows, members))
    }

    /// Legacy clients identify presets, so they cannot select a repeated slot.
    pub(super) fn place_unique_occurrence(
        &self,
        catalog: &LibraryCatalog,
        candidate: &mut Preferences,
        kind: LibraryKind,
        content: &str,
        before: Option<&str>,
    ) -> Result<()> {
        if kind == LibraryKind::Graph || candidate.occurrences.is_none() {
            return Ok(());
        }
        let (mut rows, members) = self.occurrence_rows(catalog)?;
        let mut positions = BTreeMap::new();
        for (index, row) in rows.iter().enumerate() {
            if let Some(member) = members.get(&row.preset.kind.key(&row.preset.id)?) {
                let key = member.kind.key(&member.id)?;
                if positions.insert(key, index).is_some() {
                    return Err(Error::Conflict(
                        "Reorder repeated entries in the performance order",
                    ));
                }
            }
        }
        let from = *positions
            .get(&kind.key(content)?)
            .ok_or(Error::Invalid("Set entry is unavailable"))?;
        let to = before
            .and_then(|key| positions.get(key).copied())
            .unwrap_or(rows.len());
        let moving = rows.remove(from);
        rows.insert(to - usize::from(from < to), moving);
        candidate.occurrences = Some(rows);
        Ok(())
    }

    pub fn set_order(&self, items: Vec<LibraryItem>) -> Result<SetOrder> {
        let catalog = self.view(items)?;
        let (rows, members) = self.occurrence_rows(&catalog)?;
        let mut entries = Vec::new();
        for entry in rows {
            let Some(member) = members.get(&entry.preset.kind.key(&entry.preset.id)?) else {
                continue;
            };
            let family = self.family(entry.preset.kind, &entry.preset.id)?;
            let version = entry
                .settings
                .version
                .as_ref()
                .unwrap_or(&family.default_version);
            let content = family
                .versions
                .iter()
                .find(|v| &v.id == version)
                .ok_or(Error::Invalid("A set entry references a missing version"))?
                .content
                .clone();
            entries.push(ResolvedOccurrence {
                entry,
                name: member.name.clone(),
                content,
            });
        }
        Ok(SetOrder {
            revision: catalog.revision,
            entries,
        })
    }

    pub fn edit_occurrence(
        &mut self,
        items: Vec<LibraryItem>,
        edit: OccurrenceEdit,
    ) -> Result<SetOrder> {
        self.edit_occurrence_with_links(items, edit, None)
    }

    pub fn edit_occurrence_with_links(
        &mut self,
        items: Vec<LibraryItem>,
        edit: OccurrenceEdit,
        inherited: Option<EntrySettings>,
    ) -> Result<SetOrder> {
        if edit.expected_revision != self.revision {
            return Err(Error::Conflict(
                "Set list changed; reload it before editing",
            ));
        }
        let catalog = self.view(items.clone())?;
        let (mut rows, members) = self.occurrence_rows(&catalog)?;
        let source = rows
            .iter()
            .position(|row| row.id == edit.entry)
            .ok_or(Error::Invalid("Set entry is unavailable"))?;
        let reference = rows[source].preset.clone();
        let key = reference.kind.key(&reference.id)?;
        let member = members
            .get(&key)
            .ok_or(Error::Invalid("Set entry is unavailable"))?;
        let mut candidate = self.preferences.clone();
        match edit.action {
            OccurrenceAction::Repeat { new_id } => {
                if !safe_id(&new_id)
                    || new_id.contains(':')
                    || rows.iter().any(|r| r.id == new_id)
                    || rows.len() >= 4096
                {
                    return Err(Error::Invalid(
                        "Use a unique entry ID within the set-list capacity",
                    ));
                }
                let mut duplicate = rows[source].clone();
                duplicate.id = new_id;
                if let Some(mut resolved) = inherited {
                    resolved.own_media = true;
                    duplicate.settings = resolved;
                }
                rows.insert(source + 1, duplicate);
            }
            OccurrenceAction::Change { settings } => {
                rows[source].settings = settings;
                if !rows[source].valid() {
                    return Err(Error::Invalid("Invalid set entry settings"));
                }
                let family = self.family(reference.kind, &reference.id)?;
                if rows[source]
                    .settings
                    .version
                    .as_ref()
                    .is_some_and(|v| !family.versions.iter().any(|candidate| &candidate.id == v))
                {
                    return Err(Error::Invalid("Version is unavailable for this set entry"));
                }
            }
            OccurrenceAction::Place { before } => {
                if before.as_ref() == Some(&edit.entry) {
                    return self.set_order(items);
                }
                let moving = rows.remove(source);
                let position = match before {
                    Some(id) => rows
                        .iter()
                        .position(|r| r.id == id)
                        .ok_or(Error::Invalid("Set-list destination is unavailable"))?,
                    None => rows.len(),
                };
                rows.insert(position, moving);
            }
            OccurrenceAction::Remove => {
                rows.remove(source);
                if !rows.iter().any(|r| r.preset == reference) {
                    let current = member.kind.key(&member.id)?;
                    if member.origin == LibraryOrigin::Mine {
                        candidate.left_out.insert(current);
                    } else {
                        candidate.added.remove(&current);
                    }
                }
            }
        }
        candidate.occurrences = Some(rows);
        self.persist(candidate)?;
        self.set_order(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeating_a_preset_keeps_independent_slots_settings_and_order_after_restart() {
        let root =
            std::env::temp_dir().join(format!("oxidal-set-occurrences-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let item = |c: char| LibraryItem {
            kind: LibraryKind::Rig,
            id: c.to_string().repeat(64),
            name: c.to_string(),
            source_name: c.to_string(),
            origin: LibraryOrigin::Mine,
            archived: false,
            superseded: false,
            in_set_list: false,
        };
        let items = vec![item('a'), item('b')];
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let initial = store.set_order(items.clone()).unwrap();
        assert!(!root.exists());
        assert_eq!(initial.entries.len(), 2);
        let first = &initial.entries[0].entry.id;
        let edit = |revision: &str, entry: &str, action| OccurrenceEdit {
            expected_revision: revision.into(),
            entry: entry.into(),
            action,
        };
        let repeated = store
            .edit_occurrence(
                items.clone(),
                edit(
                    &initial.revision,
                    first,
                    OccurrenceAction::Repeat {
                        new_id: "chorus".into(),
                    },
                ),
            )
            .unwrap();
        let changed = store
            .edit_occurrence(
                items.clone(),
                edit(
                    &repeated.revision,
                    "chorus",
                    OccurrenceAction::Change {
                        settings: EntrySettings {
                            own_media: true,
                            version: Some("main".into()),
                            scene: Some("lead".into()),
                            track: Some("track2".into()),
                            mix: Some("mix2".into()),
                            sheet: Some("sheet2".into()),
                        },
                    },
                ),
            )
            .unwrap();
        assert!(changed.entries[0].entry.settings.scene.is_none());
        assert_eq!(changed.entries[1].content, changed.entries[0].content);
        let mut store = CatalogStore::open(root.clone()).unwrap();
        let moved = store
            .edit_occurrence(
                items.clone(),
                edit(
                    &changed.revision,
                    "chorus",
                    OccurrenceAction::Place { before: None },
                ),
            )
            .unwrap();
        assert_eq!(
            moved.entries[2].entry.settings.scene.as_deref(),
            Some("lead")
        );
        assert!(matches!(
            store.update(
                items.clone(),
                LibraryUpdate {
                    expected_revision: moved.revision.clone(),
                    entry_kind: LibraryKind::Rig,
                    id: items[0].id.clone(),
                    action: LibraryAction::SetList { member: false }
                }
            ),
            Err(Error::Conflict(_))
        ));
        let remaining = store
            .edit_occurrence(
                items.clone(),
                edit(&moved.revision, first, OccurrenceAction::Remove),
            )
            .unwrap();
        assert_eq!(remaining.entries.len(), 2);
        let last = store
            .edit_occurrence(
                items.clone(),
                edit(&remaining.revision, "chorus", OccurrenceAction::Remove),
            )
            .unwrap();
        assert_eq!(last.entries.len(), 1);
        assert_eq!(last.entries[0].content, items[1].id);
        fs::remove_dir_all(root).unwrap();
    }
}
