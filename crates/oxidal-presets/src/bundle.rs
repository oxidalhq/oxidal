//! Immutable expanded bundles in the application's private storage root.
//! Integrity/structural inspection is not native/LV2 playback qualification.
use crate::{
    Error, Result, inspect,
    manifest::{MAX_MANIFEST_BYTES, Manifest, ResourceKind},
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// An exact manifest and its checked payloads. Keeping fields private prevents a
/// previously verified revision from being paired with changed declarations.
#[derive(Debug, Clone)]
pub struct Bundle {
    manifest: Manifest,
    manifest_bytes: Vec<u8>,
    resources: BTreeMap<String, Vec<u8>>,
    revision: String,
}
impl Bundle {
    pub fn from_parts(
        manifest_bytes: Vec<u8>,
        resources: BTreeMap<String, Vec<u8>>,
    ) -> Result<Self> {
        let manifest = Manifest::parse(&manifest_bytes)?;
        if resources.len() != manifest.resources.len() {
            return Err(Error::Invalid("Missing or unlisted bundle resource"));
        }
        for resource in &manifest.resources {
            let bytes = resources
                .get(&resource.id)
                .ok_or(Error::Invalid("Missing bundle resource"))?;
            if bytes.len() as u64 != resource.bytes || digest(bytes) != resource.sha256 {
                return Err(Error::Invalid("Bundle resource integrity failed"));
            }
            if matches!(
                resource.kind,
                ResourceKind::Tone3000Preset | ResourceKind::Tone3000Source
            ) {
                inspect(bytes)?;
            }
        }
        let revision = digest(&manifest_bytes);
        Ok(Self {
            manifest,
            manifest_bytes,
            resources,
            revision,
        })
    }
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }
    pub fn manifest_bytes(&self) -> &[u8] {
        &self.manifest_bytes
    }
    pub fn resource(&self, id: &str) -> Option<&[u8]> {
        self.resources.get(id).map(Vec::as_slice)
    }
    /// Binds the exact manifest and its catalog of verified payload digests.
    /// Different metadata/roles/routing always invalidate an earlier revision.
    pub fn revision(&self) -> &str {
        &self.revision
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// The root is a trusted, application-owned directory, not an arbitrary folder
/// writable by an adversary. Snapshots are immutable after atomic publication.
/// ZIP extraction and plugin state restoration are deliberately separate layers.
#[derive(Debug)]
pub struct BundleStore {
    root: PathBuf,
}
impl BundleStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self, revision: &str) -> Result<PathBuf> {
        if revision.len() != 64
            || !revision
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err(Error::Invalid("Invalid bundle revision"));
        }
        Ok(self.root.join(revision))
    }
    /// Hash-verified declarations for library browsing. Payload verification still
    /// happens in `read` before preparation; this does not establish playability.
    pub fn manifest(&self, revision: &str) -> Result<Manifest> {
        directory(&self.root)?;
        let root = self.path(revision)?;
        directory(&root)?;
        let bytes = read_bounded(&root.join("manifest.json"), MAX_MANIFEST_BYTES as u64)?;
        if digest(&bytes) != revision {
            return Err(Error::Invalid("Bundle manifest integrity failed"));
        }
        Manifest::parse(&bytes)
    }
    pub fn read(&self, revision: &str) -> Result<Bundle> {
        directory(&self.root)?;
        let root = self.path(revision)?;
        directory(&root)?;
        let manifest_bytes = read_bounded(&root.join("manifest.json"), MAX_MANIFEST_BYTES as u64)?;
        if digest(&manifest_bytes) != revision {
            return Err(Error::Invalid("Bundle manifest integrity failed"));
        }
        let manifest = Manifest::parse(&manifest_bytes)?;
        let mut expected = BTreeMap::from([(PathBuf::from("manifest.json"), false)]);
        for resource in &manifest.resources {
            let path = PathBuf::from(&resource.path);
            for parent in path
                .ancestors()
                .skip(1)
                .filter(|p| !p.as_os_str().is_empty())
            {
                expected.insert(parent.to_owned(), true);
            }
            expected.insert(path, false);
        }
        // Enumerate before opening payloads. Reject extra files, symlinks and
        // special entries, including symlinked ancestor directories.
        let mut pending = vec![PathBuf::new()];
        let mut seen = BTreeSet::new();
        while let Some(relative) = pending.pop() {
            for entry in fs::read_dir(root.join(relative))? {
                let entry = entry?;
                let path = entry.path();
                let path = path
                    .strip_prefix(&root)
                    .map_err(|_| Error::Invalid("Invalid bundle path"))?
                    .to_owned();
                let is_directory = *expected
                    .get(&path)
                    .ok_or(Error::Invalid("Unlisted bundle entry"))?;
                let kind = entry.file_type()?;
                if (is_directory && !kind.is_dir()) || (!is_directory && !kind.is_file()) {
                    return Err(Error::Invalid("Bundle contains a symlink or special entry"));
                }
                if !seen.insert(path.clone()) {
                    return Err(Error::Invalid("Duplicate bundle entry"));
                }
                if is_directory {
                    pending.push(path);
                }
            }
        }
        if seen.len() != expected.len() {
            return Err(Error::Invalid("Missing bundle entry"));
        }
        let mut resources = BTreeMap::new();
        for resource in &manifest.resources {
            resources.insert(
                resource.id.clone(),
                read_bounded(&root.join(&resource.path), resource.bytes)?,
            );
        }
        Bundle::from_parts(manifest_bytes, resources)
    }
    /// Publish a complete new revision without replacing earlier revisions.
    /// The logical preset UUID stays in the manifest; Save As supplies a new UUID.
    pub fn save(&self, bundle: &Bundle) -> Result<String> {
        self.save_with(bundle, || Ok(()))
    }
    fn save_with(
        &self,
        bundle: &Bundle,
        before_publish: impl FnOnce() -> Result<()>,
    ) -> Result<String> {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let path = self.path(bundle.revision())?;
        fs::create_dir_all(&self.root)?;
        directory(&self.root)?;
        if path.try_exists()? {
            self.read(bundle.revision())?;
            return Ok(bundle.revision.clone());
        }
        let temporary = self.root.join(format!(
            ".save-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        private_directory(&temporary)?;
        let result = (|| {
            write_new(&temporary.join("manifest.json"), bundle.manifest_bytes())?;
            let mut directories = BTreeSet::new();
            for resource in &bundle.manifest.resources {
                let target = temporary.join(&resource.path);
                let parent = target
                    .parent()
                    .ok_or(Error::Invalid("Invalid bundle parent"))?;
                fs::create_dir_all(parent)?;
                for ancestor in parent.ancestors().take_while(|p| p.starts_with(&temporary)) {
                    directories.insert(ancestor.to_path_buf());
                }
                write_new(&target, &bundle.resources[&resource.id])?;
            }
            // Sync files, then their containing directories, then publish and sync
            // the root directory. Empty passthrough rigs still sync the manifest.
            for parent in directories.iter().rev() {
                fs::File::open(parent)?.sync_all()?;
            }
            fs::File::open(&temporary)?.sync_all()?;
            before_publish()?;
            fs::rename(&temporary, &path)?;
            fs::File::open(&self.root)?.sync_all()?;
            Ok(bundle.revision.clone())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }
    pub fn list(&self) -> Result<Vec<String>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.into()),
        };
        directory(&self.root)?;
        let mut revisions = Vec::new();
        for entry in entries {
            let entry = entry?;
            let revision = entry
                .file_name()
                .into_string()
                .map_err(|_| Error::Invalid("Invalid bundle entry name"))?;
            if revision.starts_with(".save-") {
                continue;
            }
            self.path(&revision)?;
            if !entry.file_type()?.is_dir() {
                return Err(Error::Invalid("Invalid bundle revision directory"));
            }
            revisions.push(revision);
        }
        revisions.sort();
        Ok(revisions)
    }
}
fn directory(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.is_dir() {
        return Err(Error::Invalid("Invalid bundle directory"));
    }
    Ok(())
}
fn private_directory(path: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    Ok(())
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(Error::Invalid("Invalid or oversized bundle file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(Error::Invalid("Bundle file exceeds byte limit"));
    }
    Ok(bytes)
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests;
