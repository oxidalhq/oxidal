//! Keep-ready membership moves in the same transaction as a rig's default content.
use super::{CatalogStore, Error, LibraryKind, Preferences, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct KeepReady {
    pub revisions: Vec<String>,
}

impl KeepReady {
    fn checked(self) -> Result<Self> {
        if self.revisions.len() > 4
            || self
                .revisions
                .iter()
                .any(|r| LibraryKind::Rig.key(r).is_err())
        {
            return Err(Error::Invalid(
                "Choose up to four saved presets to keep ready",
            ));
        }
        let mut revisions = Vec::new();
        for revision in self.revisions {
            if !revisions.contains(&revision) {
                revisions.push(revision);
            }
        }
        Ok(Self { revisions })
    }
}

impl CatalogStore {
    pub fn keep_ready(&self) -> Result<KeepReady> {
        if let Some(current) = &self.preferences.keep_ready {
            return current.clone().checked();
        }
        let path = self.root.join("keep-ready.json");
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && m.len() <= 4096 => {
                serde_json::from_slice::<KeepReady>(&fs::read(path)?)
                    .map_err(|_| Error::Invalid("Invalid saved Keep ready list"))?
                    .checked()
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(KeepReady::default()),
            Err(e) => Err(e.into()),
            _ => Err(Error::Invalid("Invalid saved Keep ready list")),
        }
    }
    pub fn set_keep_ready(&mut self, request: KeepReady) -> Result<KeepReady> {
        let next = request.checked()?;
        let mut candidate = self.preferences.clone();
        candidate.keep_ready = Some(next.clone());
        self.persist(candidate)?;
        Ok(next)
    }
    pub(super) fn move_keep_ready(
        &self,
        candidate: &mut Preferences,
        old: &str,
        new: &str,
    ) -> Result<()> {
        if let (Some(old), Some(new)) = (old.strip_prefix("rig:"), new.strip_prefix("rig:")) {
            let mut current = self.keep_ready()?;
            if current.revisions.iter().any(|r| r == old) {
                for revision in &mut current.revisions {
                    if revision == old {
                        new.clone_into(revision);
                    }
                }
                candidate.keep_ready = Some(current.checked()?);
            }
        }
        Ok(())
    }
}
