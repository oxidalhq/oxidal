//! Per-preset Stage switch assignments. Each physical binding names an independent CC.
use super::*;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum SwitchProfile {
    Four,
    Ten,
}
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum SwitchGesture {
    Tap,
    Hold,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SwitchNote {
    Quarter,
    DottedEighth,
    Eighth,
    Triplet,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FreezeMode {
    Toggle,
    Gate,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SwitchAction {
    TapTempo {
        note: SwitchNote,
    },
    Freeze {
        node: String,
        symbol: String,
        mode: FreezeMode,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchInput {
    pub port: String,
    pub channel: u8,
    pub controller: u8,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchAssignment {
    pub profile: SwitchProfile,
    pub position: u8,
    pub gesture: SwitchGesture,
    pub action: SwitchAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<SwitchInput>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchLayout {
    pub version: u8,
    pub switches: Vec<SwitchAssignment>,
}
impl Default for SwitchLayout {
    fn default() -> Self {
        Self {
            version: 1,
            switches: Vec::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchLayoutState {
    pub revision: String,
    pub layout: SwitchLayout,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchLayoutUpdate {
    pub expected_revision: String,
    pub layout: SwitchLayout,
}
impl SwitchLayout {
    fn validate(&self) -> Result<()> {
        let mut keys = BTreeSet::new();
        let mut bindings = BTreeSet::new();
        if self.version != 1 || self.switches.len() > 28 {
            return Err(Error::Invalid("Invalid switch layout version or size"));
        }
        for s in &self.switches {
            let max = match s.profile {
                SwitchProfile::Four => 4,
                SwitchProfile::Ten => 10,
            };
            if !(1..=max).contains(&s.position) || !keys.insert((s.profile, s.position, s.gesture))
            {
                return Err(Error::Invalid("Duplicate or invalid switch position"));
            }
            if let SwitchAction::Freeze { node, symbol, mode } = &s.action
                && (node.is_empty()
                    || node.len() > 128
                    || !matches!(symbol.as_str(), "freeze" | "hold")
                    || (*mode == FreezeMode::Gate && s.gesture != SwitchGesture::Hold))
            {
                return Err(Error::Invalid("Invalid Freeze target or gate gesture"));
            }
            if let Some(i) = &s.input
                && (i.port.trim().is_empty()
                    || i.port.len() > 256
                    || i.port.chars().any(char::is_control)
                    || !(1..=16).contains(&i.channel)
                    || i.controller > 127
                    || !bindings.insert(i))
            {
                return Err(Error::Invalid("Duplicate or invalid switch input"));
            }
        }
        Ok(())
    }
    fn state(self) -> Result<SwitchLayoutState> {
        let bytes =
            serde_json::to_vec(&self).map_err(|_| Error::Invalid("Invalid switch layout"))?;
        Ok(SwitchLayoutState {
            revision: format!("{:x}", Sha256::digest(bytes)),
            layout: self,
        })
    }
}
impl MidiMapStore {
    pub fn switch_layout(&self, entry: &LibraryReference) -> Result<SwitchLayoutState> {
        let key = entry.kind.key(&entry.id)?;
        self.read()?
            .switch_layouts
            .remove(&key)
            .unwrap_or_default()
            .state()
    }
    pub fn save_switch_layout(
        &self,
        entry: &LibraryReference,
        update: SwitchLayoutUpdate,
    ) -> Result<SwitchLayoutState> {
        update.layout.validate()?;
        let key = entry.kind.key(&entry.id)?;
        let _lock = self.lock()?;
        let mut book = self.read()?;
        let current = book
            .switch_layouts
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .state()?;
        if current.revision != update.expected_revision {
            return Err(Error::Conflict(
                "Switch layout changed; refresh before saving",
            ));
        }
        if current.layout == update.layout {
            return Ok(current);
        }
        book.switch_layouts.insert(key, update.layout.clone());
        self.write(&book)?;
        update.layout.state()
    }
}

impl Book {
    pub(super) fn validate_switch_inputs(&self) -> Result<()> {
        for (key, layout) in &self.switch_layouts {
            identity(key)?;
            layout.validate()?;
            let local = self.entries.get(key);
            for i in layout.switches.iter().filter_map(|a| a.input.as_ref()) {
                let cc = i.controller;
                let used = matches!(cc, 0 | 32)
                    || self.navigation.triggers().any(|t| t.controller == Some(cc))
                    || [
                        self.navigation.output_level,
                        self.navigation.backing.level,
                        self.navigation.sheet_speed,
                    ]
                    .contains(&Some(cc))
                    || local.is_some_and(|m| {
                        m.bindings.iter().any(|b| b.controller == Some(cc))
                            || m.branch_bindings.iter().any(|b| b.controller == cc)
                            || m.parameter_bindings.iter().any(|b| b.controller == cc)
                    });
                if used {
                    return Err(Error::Invalid("A switch CC already has another assignment"));
                }
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn map() -> MidiMapStore {
        MidiMapStore::new(std::env::temp_dir().join(format!(
            "oxidal-switches-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )))
    }
    fn entry(c: char) -> LibraryReference {
        LibraryReference {
            kind: LibraryKind::Rig,
            id: c.to_string().repeat(64),
        }
    }
    fn layout() -> SwitchLayout {
        SwitchLayout {
            version: 1,
            switches: vec![
                SwitchAssignment {
                    profile: SwitchProfile::Four,
                    position: 2,
                    gesture: SwitchGesture::Tap,
                    action: SwitchAction::TapTempo {
                        note: SwitchNote::DottedEighth,
                    },
                    input: Some(SwitchInput {
                        port: "hw:Test,0,0".into(),
                        channel: 2,
                        controller: 103,
                    }),
                },
                SwitchAssignment {
                    profile: SwitchProfile::Four,
                    position: 2,
                    gesture: SwitchGesture::Hold,
                    action: SwitchAction::Freeze {
                        node: "wash".into(),
                        symbol: "freeze".into(),
                        mode: FreezeMode::Gate,
                    },
                    input: Some(SwitchInput {
                        port: "hw:Test,0,0".into(),
                        channel: 2,
                        controller: 104,
                    }),
                },
            ],
        }
    }
    #[test]
    fn switch_pair_reopens_after_restart_and_follows_save_without_replacing_history() {
        let store = map();
        let original = entry('a');
        let next = entry('b');
        let empty = store.switch_layout(&original).unwrap();
        let update = SwitchLayoutUpdate {
            expected_revision: empty.revision,
            layout: layout(),
        };
        let saved = store.save_switch_layout(&original, update.clone()).unwrap();
        assert!(store.save_switch_layout(&original, update).is_err());
        assert_eq!(
            MidiMapStore::new(store.root.clone())
                .switch_layout(&original)
                .unwrap()
                .revision,
            saved.revision
        );
        store
            .follow_version(&original, &next, &[], &[], &[("wash".into(), 0)])
            .unwrap();
        assert_eq!(store.switch_layout(&original).unwrap().layout, layout());
        assert_eq!(store.switch_layout(&next).unwrap().layout, layout());
        store
            .save_switch_layout(
                &next,
                SwitchLayoutUpdate {
                    expected_revision: saved.revision,
                    layout: SwitchLayout::default(),
                },
            )
            .unwrap();
        store
            .follow_version(&original, &next, &[], &[], &[("wash".into(), 0)])
            .unwrap();
        assert!(
            store
                .switch_layout(&next)
                .unwrap()
                .layout
                .switches
                .is_empty()
        );
        assert_eq!(store.switch_layout(&original).unwrap().layout, layout());
    }
    #[test]
    fn switch_pair_rejects_aliasing_local_or_global_assignments_and_preserves_old_book() {
        let store = map();
        let preset = entry('a');
        let revision = store.switch_layout(&preset).unwrap().revision;
        let mut pair = layout();
        pair.switches[1].input = pair.switches[0].input.clone();
        assert!(
            store
                .save_switch_layout(
                    &preset,
                    SwitchLayoutUpdate {
                        expected_revision: revision.clone(),
                        layout: pair
                    }
                )
                .is_err()
        );
        let mut pair = layout();
        pair.switches[1].input.as_mut().unwrap().controller = 7;
        assert!(
            store
                .save_switch_layout(
                    &preset,
                    SwitchLayoutUpdate {
                        expected_revision: revision.clone(),
                        layout: pair
                    }
                )
                .is_err()
        );
        assert_eq!(revision, store.switch_layout(&preset).unwrap().revision);
    }
}
