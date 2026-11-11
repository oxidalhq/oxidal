//! Session media store: one directory per asset under a root kept apart from
//! presets (`OXIDAL_MEDIA_DIR`, default `.local/media`). Assets appear only by
//! an atomic rename after their data and manifest are on disk; anything that
//! does not match its manifest at startup is moved to `quarantine/` with a
//! reason. Paths are built from generated IDs and fixed file names, never from
//! user-provided titles. All functions here do blocking file I/O: call them
//! from `spawn_blocking`.
//! @see docs/media.md
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(crate) const SCHEMA: u32 = 1;
const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Backing,
    Di,
    Reamp,
}

/// The file as uploaded, kept byte-exact for download and re-rendering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MediaSource {
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    pub container: String,
    pub codec: String,
    pub rate: u32,
    pub channels: u16,
    pub frames: u64,
    pub lossy: bool,
}

/// Raw interleaved little-endian float32 at one stream rate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MediaRender {
    pub file: String,
    pub rate: u32,
    pub channels: u16,
    pub frames: u64,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resampler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peak_dbfs: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loudness_lufs: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MediaPlayback {
    /// Per-track trim in dB (−24 to +6), set from loudness at import.
    pub trim_db: f64,
}

/// `manifest.json`, schema 1. Written last; its presence makes an asset real.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MediaManifest {
    pub schema: u32,
    pub id: String,
    pub kind: MediaKind,
    pub title: String,
    pub created_at: String,
    #[serde(default)]
    pub source: Option<MediaSource>,
    pub renders: Vec<MediaRender>,
    #[serde(default)]
    pub playback: MediaPlayback,
    /// Set for reamp results: which DI and preset produced them.
    #[serde(default)]
    pub provenance: Option<serde_json::Value>,
}

impl MediaManifest {
    /// Structural checks that need no file system.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != SCHEMA {
            return Err(format!("unsupported manifest schema {}", self.schema));
        }
        if !valid_id(&self.id) {
            return Err("invalid asset ID".into());
        }
        valid_title(&self.title)?;
        if !(-24.0..=6.0).contains(&self.playback.trim_db) {
            return Err("track trim must be −24 to +6 dB".into());
        }
        if self.renders.is_empty() {
            return Err("no play-ready render".into());
        }
        let mut names = Vec::new();
        if let Some(source) = &self.source {
            valid_file(&source.file)?;
            if !(1..=2).contains(&source.channels) || source.rate == 0 {
                return Err("source must be mono or stereo with a rate".into());
            }
            names.push(source.file.as_str());
        }
        for render in &self.renders {
            valid_file(&render.file)?;
            if !render.file.ends_with(".f32")
                || !(1..=2).contains(&render.channels)
                || render.rate == 0
                || render.frames == 0
            {
                return Err("a render must be mono or stereo float32 with frames".into());
            }
            if self
                .renders
                .iter()
                .filter(|r| r.rate == render.rate)
                .count()
                > 1
            {
                return Err("one render per stream rate".into());
            }
            names.push(render.file.as_str());
        }
        names.sort_unstable();
        if names.windows(2).any(|w| w[0] == w[1]) || names.contains(&"manifest.json") {
            return Err("asset file names must be distinct".into());
        }
        Ok(())
    }
    pub fn render(&self, rate: u32) -> Option<&MediaRender> {
        self.renders.iter().find(|r| r.rate == rate)
    }
    /// Bytes on disk according to the manifest.
    pub fn bytes(&self) -> u64 {
        self.source.as_ref().map_or(0, |s| s.bytes)
            + self.renders.iter().map(render_bytes).sum::<u64>()
    }
}

fn render_bytes(render: &MediaRender) -> u64 {
    render
        .frames
        .saturating_mul(u64::from(render.channels))
        .saturating_mul(4)
}

pub(crate) fn valid_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 120 || title.chars().any(char::is_control) {
        Err("title must be 1–120 characters without control characters".into())
    } else {
        Ok(())
    }
}

/// Asset files are fixed lowercase names chosen by Oxidal, never user text.
fn valid_file(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid asset file name {name:?}"))
    }
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A ULID: 48-bit millisecond time and 80 random bits, Crockford base32.
pub(crate) fn new_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
        & 0xFFFF_FFFF_FFFF;
    let mut random = [0u8; 10];
    if getrandom::getrandom(&mut random).is_err() {
        // Uniqueness, not secrecy: fall back to the hasher's per-process keys.
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(millis);
        random[..8].copy_from_slice(&h.finish().to_le_bytes());
    }
    let mut value = u128::from(millis) << 80;
    for (i, b) in random.iter().enumerate() {
        value |= u128::from(*b) << (8 * (9 - i));
    }
    (0..26)
        .rev()
        .map(|i| CROCKFORD[((value >> (5 * i)) & 31) as usize] as char)
        .collect()
}

pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 26 && id.as_bytes()[0] <= b'7' && id.bytes().all(|b| CROCKFORD.contains(&b))
}

/// UTC now as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub(crate) fn now_iso() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    iso(millis)
}

fn iso(millis: u64) -> String {
    let secs = millis / 1000;
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        millis % 1000
    )
}

/// `store.json`: schema version and an optional larger free-space reserve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StoreSettings {
    pub schema: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reserve_bytes: Option<u64>,
}

/// An asset that failed its startup check, kept for inspection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Quarantined {
    pub entry: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub reserve_bytes: u64,
}
impl Space {
    /// Bytes that may still be written while keeping the reserve free.
    pub fn usable(&self) -> u64 {
        self.available_bytes.saturating_sub(self.reserve_bytes)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MediaError {
    NotFound,
    /// In use by the player or a job.
    Leased,
    /// Writing would eat into the reserve.
    NoSpace(Space),
    Invalid(String),
    Io(String),
}
impl From<io::Error> for MediaError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug)]
pub struct Store {
    root: PathBuf,
    settings: StoreSettings,
    leases: Arc<Mutex<HashMap<String, usize>>>,
    quarantined: Vec<Quarantined>,
}

/// Holds an asset in use; delete is refused until every lease is dropped.
#[derive(Debug)]
pub struct Lease {
    id: String,
    leases: Arc<Mutex<HashMap<String, usize>>>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut leases = self.leases.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = leases.get_mut(&self.id) {
            *count -= 1;
            if *count == 0 {
                leases.remove(&self.id);
            }
        }
    }
}

/// A new asset being assembled in `incoming/<id>.d/`.
#[derive(Debug)]
pub struct Staging {
    pub id: String,
    dir: PathBuf,
}
impl Staging {
    /// Path for one of the asset's fixed file names.
    pub fn file(&self, name: &str) -> Result<PathBuf, MediaError> {
        valid_file(name).map_err(MediaError::Invalid)?;
        Ok(self.dir.join(name))
    }
}

fn create_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o750))?;
    }
    Ok(())
}

fn sync_dir(path: &Path) -> io::Result<()> {
    // Directory fsync makes renames durable on Linux; elsewhere it may be refused.
    match fs::File::open(path).and_then(|d| d.sync_all()) {
        Ok(()) => Ok(()),
        Err(e) if cfg!(target_os = "linux") => Err(e),
        Err(_) => Ok(()),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&tmp, path)?;
    sync_dir(path.parent().unwrap_or(Path::new(".")))
}

impl Store {
    /// Opens (creating if needed) the store and reconciles it: unfinished
    /// work in `incoming/` is deleted and invalid assets are quarantined.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, MediaError> {
        let root = root.into();
        for dir in ["", "assets", "incoming", "quarantine"] {
            create_private_dir(&root.join(dir))?;
        }
        let settings_path = root.join("store.json");
        let settings = match fs::read(&settings_path) {
            Ok(bytes) => {
                let settings: StoreSettings = serde_json::from_slice(&bytes)
                    .map_err(|e| MediaError::Invalid(format!("store.json: {e}")))?;
                if settings.schema != SCHEMA {
                    return Err(MediaError::Invalid(format!(
                        "store.json schema {} is newer than this Oxidal",
                        settings.schema
                    )));
                }
                settings
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let settings = StoreSettings {
                    schema: SCHEMA,
                    reserve_bytes: None,
                };
                write_atomic(
                    &settings_path,
                    &serde_json::to_vec_pretty(&settings).expect("settings serialize"),
                )?;
                settings
            }
            Err(e) => return Err(e.into()),
        };
        let mut store = Self {
            root,
            settings,
            leases: Arc::default(),
            quarantined: Vec::new(),
        };
        store.reconcile()?;
        Ok(store)
    }

    fn reconcile(&mut self) -> Result<(), MediaError> {
        for entry in fs::read_dir(self.root.join("incoming"))? {
            let path = entry?.path();
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }
        let mut found = Vec::new();
        for entry in fs::read_dir(self.root.join("assets"))? {
            let entry = entry?;
            found.push(entry.file_name().to_string_lossy().into_owned());
        }
        found.sort();
        for name in found {
            if let Err(reason) = self.check(&name) {
                self.quarantine(&name, &reason)?;
            }
        }
        for entry in fs::read_dir(self.root.join("quarantine"))? {
            let entry = entry?;
            let reason = fs::read_to_string(entry.path().join("REASON"))
                .unwrap_or_else(|_| "unknown".into());
            self.quarantined.push(Quarantined {
                entry: entry.file_name().to_string_lossy().into_owned(),
                reason: reason.trim().to_owned(),
            });
        }
        self.quarantined.sort_by(|a, b| a.entry.cmp(&b.entry));
        Ok(())
    }

    /// Manifest present and valid, and every file the size it says. Hashes
    /// are checked when a file is read for export, not on every start.
    fn check(&self, name: &str) -> Result<MediaManifest, String> {
        if !valid_id(name) {
            return Err("not an Oxidal asset".into());
        }
        let dir = self.root.join("assets").join(name);
        let bytes = fs::read(dir.join("manifest.json")).map_err(|_| "manifest missing")?;
        let manifest: MediaManifest =
            serde_json::from_slice(&bytes).map_err(|e| format!("manifest unreadable: {e}"))?;
        manifest.validate()?;
        if manifest.id != name {
            return Err("manifest ID does not match its directory".into());
        }
        let size = |file: &str| fs::metadata(dir.join(file)).map(|m| m.len()).ok();
        if let Some(source) = &manifest.source
            && size(&source.file) != Some(source.bytes)
        {
            return Err(format!("{} is missing or the wrong size", source.file));
        }
        for render in &manifest.renders {
            if size(&render.file) != Some(render_bytes(render)) {
                return Err(format!("{} is missing or the wrong size", render.file));
            }
        }
        Ok(manifest)
    }

    fn quarantine(&self, name: &str, reason: &str) -> Result<(), MediaError> {
        let from = self.root.join("assets").join(name);
        let mut to = self.root.join("quarantine").join(name);
        let mut n = 1;
        while to.exists() {
            to = self.root.join("quarantine").join(format!("{name}-{n}"));
            n += 1;
        }
        if from.is_dir() {
            fs::rename(&from, &to)?;
        } else {
            create_private_dir(&to)?;
            fs::rename(&from, to.join(name))?;
        }
        fs::write(to.join("REASON"), reason)?;
        sync_dir(&self.root.join("assets"))?;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn quarantined(&self) -> &[Quarantined] {
        &self.quarantined
    }

    /// Every valid asset, oldest first.
    pub fn list(&self) -> Result<Vec<MediaManifest>, MediaError> {
        let mut assets = Vec::new();
        for entry in fs::read_dir(self.root.join("assets"))? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if let Ok(manifest) = self.check(&name) {
                assets.push(manifest);
            }
        }
        assets.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(assets)
    }

    pub fn manifest(&self, id: &str) -> Result<MediaManifest, MediaError> {
        if !valid_id(id) {
            return Err(MediaError::NotFound);
        }
        let dir = self.root.join("assets").join(id);
        if !dir.is_dir() {
            return Err(MediaError::NotFound);
        }
        self.check(id).map_err(MediaError::Invalid)
    }

    /// Path of a file the manifest lists.
    pub fn file(&self, id: &str, name: &str) -> Result<PathBuf, MediaError> {
        let manifest = self.manifest(id)?;
        let listed = manifest.source.iter().any(|s| s.file == name)
            || manifest.renders.iter().any(|r| r.file == name);
        if !listed {
            return Err(MediaError::NotFound);
        }
        Ok(self.root.join("assets").join(id).join(name))
    }

    /// Where an upload in progress is received; removed at startup.
    pub fn upload_part(&self, id: &str) -> Result<PathBuf, MediaError> {
        if !valid_id(id) {
            return Err(MediaError::NotFound);
        }
        Ok(self.root.join("incoming").join(format!("{id}.part")))
    }
    /// Starts a new asset in `incoming/`.
    pub fn stage(&self) -> Result<Staging, MediaError> {
        let id = new_id();
        let dir = self.root.join("incoming").join(format!("{id}.d"));
        create_private_dir(&dir)?;
        Ok(Staging { id, dir })
    }

    /// Makes a staged asset real: checks its files against the manifest,
    /// syncs them, writes the manifest last, then renames the directory into
    /// `assets/`. A crash at any point leaves either nothing or the asset.
    pub fn finalize(&self, staging: Staging, manifest: &MediaManifest) -> Result<(), MediaError> {
        manifest.validate().map_err(MediaError::Invalid)?;
        if manifest.id != staging.id {
            return Err(MediaError::Invalid("manifest ID does not match".into()));
        }
        let mut files: Vec<(&str, u64)> = manifest
            .renders
            .iter()
            .map(|r| (r.file.as_str(), render_bytes(r)))
            .collect();
        if let Some(source) = &manifest.source {
            files.push((&source.file, source.bytes));
        }
        for (name, bytes) in files {
            let file = fs::File::open(staging.dir.join(name))
                .map_err(|_| MediaError::Invalid(format!("{name} was not written")))?;
            if file.metadata()?.len() != bytes {
                return Err(MediaError::Invalid(format!("{name} is not {bytes} bytes")));
            }
            file.sync_all()?;
        }
        write_atomic(
            &staging.dir.join("manifest.json"),
            &serde_json::to_vec_pretty(manifest).expect("manifest serialize"),
        )?;
        let target = self.root.join("assets").join(&staging.id);
        fs::rename(&staging.dir, &target)?;
        sync_dir(&self.root.join("assets"))?;
        sync_dir(&self.root.join("incoming"))?;
        Ok(())
    }

    /// Discards a staged asset that will not be finished.
    pub fn abandon(&self, staging: Staging) -> Result<(), MediaError> {
        fs::remove_dir_all(&staging.dir)?;
        Ok(())
    }

    /// Updates title or trim; files are never rewritten.
    pub fn update(
        &self,
        id: &str,
        change: impl FnOnce(&mut MediaManifest),
    ) -> Result<MediaManifest, MediaError> {
        let mut manifest = self.manifest(id)?;
        let before = (
            manifest.id.clone(),
            manifest.renders.clone(),
            manifest.source.clone(),
        );
        change(&mut manifest);
        if (
            manifest.id.clone(),
            manifest.renders.clone(),
            manifest.source.clone(),
        ) != before
        {
            return Err(MediaError::Invalid("asset files cannot change".into()));
        }
        manifest.validate().map_err(MediaError::Invalid)?;
        write_atomic(
            &self.root.join("assets").join(id).join("manifest.json"),
            &serde_json::to_vec_pretty(&manifest).expect("manifest serialize"),
        )?;
        Ok(manifest)
    }

    pub fn lease(&self, id: &str) -> Result<Lease, MediaError> {
        self.manifest(id)?;
        let mut leases = self.leases.lock().unwrap_or_else(|e| e.into_inner());
        *leases.entry(id.to_owned()).or_default() += 1;
        Ok(Lease {
            id: id.to_owned(),
            leases: Arc::clone(&self.leases),
        })
    }

    pub fn leased(&self, id: &str) -> bool {
        self.leases
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(id)
    }

    /// Deletes an asset unless it is in use. It disappears from `assets/` in
    /// one rename before its files are removed.
    pub fn delete(&self, id: &str) -> Result<(), MediaError> {
        self.manifest(id).or_else(|e| match e {
            // A damaged manifest may still be deleted.
            MediaError::Invalid(_) => Ok(placeholder(id)),
            other => Err(other),
        })?;
        // Hold the lease table while renaming so no lease starts in between.
        let leases = self.leases.lock().unwrap_or_else(|e| e.into_inner());
        if leases.contains_key(id) {
            return Err(MediaError::Leased);
        }
        let trash = self.root.join("incoming").join(format!("{id}.trash"));
        fs::rename(self.root.join("assets").join(id), &trash)?;
        drop(leases);
        sync_dir(&self.root.join("assets"))?;
        fs::remove_dir_all(trash)?;
        Ok(())
    }

    /// Free space on the store's filesystem and the reserve kept free: the
    /// larger of 1 GiB, 5 % of the filesystem and the configured reserve.
    pub fn space(&self) -> Result<Space, MediaError> {
        let (available_bytes, total_bytes) = filesystem_space(&self.root)?;
        let reserve_bytes = GIB
            .max(total_bytes / 20)
            .max(self.settings.reserve_bytes.unwrap_or(0));
        Ok(Space {
            available_bytes,
            total_bytes,
            reserve_bytes,
        })
    }

    /// Refuses a write of `bytes` that would leave less than the reserve.
    pub fn admit(&self, bytes: u64) -> Result<Space, MediaError> {
        let space = self.space()?;
        if bytes > space.usable() {
            Err(MediaError::NoSpace(space))
        } else {
            Ok(space)
        }
    }

    /// Bytes used by valid assets.
    pub fn used(&self) -> Result<u64, MediaError> {
        Ok(self.list()?.iter().map(MediaManifest::bytes).sum())
    }
}

fn placeholder(id: &str) -> MediaManifest {
    MediaManifest {
        schema: SCHEMA,
        id: id.to_owned(),
        kind: MediaKind::Backing,
        title: id.to_owned(),
        created_at: String::new(),
        source: None,
        renders: Vec::new(),
        playback: MediaPlayback::default(),
        provenance: None,
    }
}

#[cfg(unix)]
fn filesystem_space(path: &Path) -> io::Result<(u64, u64)> {
    let stat = nix::sys::statvfs::statvfs(path).map_err(io::Error::from)?;
    let block = stat.fragment_size() as u64;
    Ok((
        (stat.blocks_available() as u64).saturating_mul(block),
        (stat.blocks() as u64).saturating_mul(block),
    ))
}
#[cfg(not(unix))]
fn filesystem_space(_path: &Path) -> io::Result<(u64, u64)> {
    Err(io::Error::other("free space is only measured on Unix"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oxidal-media-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(store: &Store, frames: u64) -> (Staging, MediaManifest) {
        let staging = store.stage().unwrap();
        let render = vec![0u8; (frames * 2 * 4) as usize];
        fs::write(staging.file("play-48000.f32").unwrap(), &render).unwrap();
        fs::write(staging.file("original.wav").unwrap(), b"RIFF....WAVE").unwrap();
        let manifest = MediaManifest {
            schema: SCHEMA,
            id: staging.id.clone(),
            kind: MediaKind::Backing,
            title: "Rehearsal 01".into(),
            created_at: now_iso(),
            source: Some(MediaSource {
                file: "original.wav".into(),
                bytes: 12,
                sha256: "0".repeat(64),
                container: "wav".into(),
                codec: "pcm_s16le".into(),
                rate: 44100,
                channels: 2,
                frames: 3,
                lossy: false,
            }),
            renders: vec![MediaRender {
                file: "play-48000.f32".into(),
                rate: 48000,
                channels: 2,
                frames,
                sha256: "0".repeat(64),
                resampler: Some("rubato sinc v1".into()),
                peak_dbfs: Some(-0.4),
                loudness_lufs: Some(-11.8),
            }],
            playback: MediaPlayback { trim_db: -6.2 },
            provenance: None,
        };
        (staging, manifest)
    }

    #[test]
    fn ids_are_sortable_ulids_and_timestamps_are_iso_utc() {
        let a = new_id();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = new_id();
        assert!(valid_id(&a) && valid_id(&b) && a < b, "{a} {b}");
        assert!(!valid_id("../../etc/passwd"));
        assert!(!valid_id(&a.to_lowercase()));
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_794_356_821_123), "2026-11-11T00:27:01.123Z");
        assert_eq!(iso(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn a_finalized_asset_survives_reopen_and_unfinished_work_is_cleared() {
        let root = temp();
        let store = Store::open(&root).unwrap();
        let (staging, manifest) = sample(&store, 100);
        let id = manifest.id.clone();
        assert!(store.list().unwrap().is_empty(), "staged is not listed");
        store.finalize(staging, &manifest).unwrap();
        assert_eq!(store.list().unwrap(), vec![manifest.clone()]);
        assert_eq!(store.used().unwrap(), 12 + 800);
        // A crash mid-import leaves only incoming/ work, removed at startup.
        let (_left, _) = sample(&store, 10);
        fs::write(root.join("incoming").join("upload.part"), b"half").unwrap();
        drop(store);
        let store = Store::open(&root).unwrap();
        assert_eq!(fs::read_dir(root.join("incoming")).unwrap().count(), 0);
        assert_eq!(store.manifest(&id).unwrap(), manifest);
        assert!(store.quarantined().is_empty());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(root.join("assets"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o750);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finalize_refuses_files_that_disagree_with_the_manifest() {
        let root = temp();
        let store = Store::open(&root).unwrap();
        let (staging, mut manifest) = sample(&store, 100);
        manifest.renders[0].frames = 101;
        assert!(matches!(
            store.finalize(staging, &manifest),
            Err(MediaError::Invalid(_))
        ));
        let (staging, mut manifest) = sample(&store, 100);
        manifest.title = "\u{7}".into();
        assert!(store.finalize(staging, &manifest).is_err());
        assert!(store.list().unwrap().is_empty());
        let (staging, manifest) = sample(&store, 1);
        assert!(staging.file("../escape").is_err());
        store.abandon(staging).unwrap();
        assert!(store.manifest(&manifest.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn damaged_assets_are_quarantined_with_a_reason() {
        let root = temp();
        let store = Store::open(&root).unwrap();
        let (staging, good) = sample(&store, 50);
        store.finalize(staging, &good).unwrap();
        let (staging, truncated) = sample(&store, 50);
        store.finalize(staging, &truncated).unwrap();
        let (staging, broken) = sample(&store, 50);
        store.finalize(staging, &broken).unwrap();
        drop(store);
        let assets = root.join("assets");
        fs::write(assets.join(&truncated.id).join("play-48000.f32"), b"short").unwrap();
        fs::write(assets.join(&broken.id).join("manifest.json"), b"{").unwrap();
        fs::create_dir(assets.join("not-an-asset")).unwrap();
        let store = Store::open(&root).unwrap();
        assert_eq!(store.list().unwrap(), vec![good]);
        let reasons: HashMap<_, _> = store
            .quarantined()
            .iter()
            .map(|q| (q.entry.clone(), q.reason.clone()))
            .collect();
        assert!(reasons[&truncated.id].contains("wrong size"));
        assert!(reasons[&broken.id].contains("unreadable"));
        assert_eq!(reasons["not-an-asset"], "not an Oxidal asset");
        // Quarantine persists across restarts and is never re-listed.
        drop(store);
        let store = Store::open(&root).unwrap();
        assert_eq!(store.quarantined().len(), 3);
        assert_eq!(store.list().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_is_refused_while_leased_and_updates_keep_files() {
        let root = temp();
        let store = Store::open(&root).unwrap();
        let (staging, manifest) = sample(&store, 20);
        let id = manifest.id.clone();
        store.finalize(staging, &manifest).unwrap();
        let lease = store.lease(&id).unwrap();
        let second = store.lease(&id).unwrap();
        assert_eq!(store.delete(&id), Err(MediaError::Leased));
        drop(lease);
        assert_eq!(store.delete(&id), Err(MediaError::Leased));
        drop(second);
        let renamed = store
            .update(&id, |m| {
                m.title = "Song A".into();
                m.playback.trim_db = -3.0;
            })
            .unwrap();
        assert_eq!(renamed.title, "Song A");
        assert!(store.update(&id, |m| m.renders[0].frames = 1).is_err());
        assert!(store.update(&id, |m| m.playback.trim_db = 9.0).is_err());
        assert_eq!(store.manifest(&id).unwrap().title, "Song A");
        assert!(store.file(&id, "play-48000.f32").unwrap().is_file());
        assert_eq!(store.file(&id, "manifest.json"), Err(MediaError::NotFound));
        store.delete(&id).unwrap();
        assert_eq!(store.manifest(&id), Err(MediaError::NotFound));
        assert_eq!(store.delete(&id), Err(MediaError::NotFound));
        assert!(matches!(store.lease(&id), Err(MediaError::NotFound)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn admission_keeps_the_reserve_free() {
        let root = temp();
        let store = Store::open(&root).unwrap();
        let space = store.space().unwrap();
        assert!(space.reserve_bytes >= GIB);
        assert!(space.reserve_bytes >= space.total_bytes / 20);
        assert!(store.admit(0).is_ok() || space.available_bytes < space.reserve_bytes);
        assert!(matches!(
            store.admit(space.available_bytes),
            Err(MediaError::NoSpace(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_newer_store_is_refused_rather_than_rewritten() {
        let root = temp();
        fs::write(root.join("store.json"), br#"{"schema":2}"#).unwrap();
        assert!(matches!(Store::open(&root), Err(MediaError::Invalid(_))));
        assert_eq!(
            fs::read(root.join("store.json")).unwrap(),
            br#"{"schema":2}"#
        );
        fs::remove_dir_all(root).unwrap();
    }
}
