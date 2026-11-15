//! Device-side song and mix records on top of the session media store.
//! @see docs/media.md#song-preparation-and-practice-timing

use crate::media::{
    MediaError, MediaKind, MediaManifest, MediaPlayback, MediaRender, SCHEMA, Staging, Store,
    create_private_dir, new_id, now_iso, sync_dir, valid_id, valid_title, write_atomic,
};
use oxidal_splitter::{MixRecipe, SplitMode, StemRole};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, BufReader, BufWriter},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SongView {
    pub source: String,
    pub splits: Vec<Split>,
    pub mixes: Vec<SavedMix>,
}

/// Every song with stems, newest first, for Library's Stems tab.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SongList {
    pub songs: Vec<SongView>,
}

/// A separation worker publishes this manifest last. Each role has a fixed
/// filename and shares the rate, channel count and frame count.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Split {
    pub id: String,
    pub source_sha256: String,
    pub model_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_roles: Option<Vec<StemRole>>,
    pub mode: SplitMode,
    pub rate: u32,
    pub frames: u64,
}

impl Split {
    pub(crate) fn present_roles(&self) -> &[StemRole] {
        self.imported_roles.as_deref().unwrap_or(self.mode.roles())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedMix {
    pub id: String,
    pub revision: String,
    pub title: String,
    pub split: String,
    pub asset: String,
    pub recipe: MixRecipe,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveMix {
    pub title: String,
    pub split: String,
    pub recipe: MixRecipe,
    /// A new ID is returned when this field is absent (Save as).
    pub replace: Option<MixRevision>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MixRevision {
    pub id: String,
    pub revision: String,
}

#[derive(Debug)]
pub(crate) enum SongError {
    Media(MediaError),
    Stale,
    Interrupted,
}

impl From<MediaError> for SongError {
    fn from(value: MediaError) -> Self {
        Self::Media(value)
    }
}

impl From<io::Error> for SongError {
    fn from(value: io::Error) -> Self {
        MediaError::from(value).into()
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, MediaError> {
    let file = File::open(path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => MediaError::NotFound,
        _ => error.into(),
    })?;
    serde_json::from_reader(BufReader::new(file))
        .map_err(|error| MediaError::Invalid(format!("Damaged song metadata: {error}")))
}

fn children(path: &Path) -> Result<Vec<String>, MediaError> {
    match fs::read_dir(path) {
        Ok(entries) => {
            let mut names = Vec::new();
            for entry in entries {
                names.push(entry?.file_name().to_string_lossy().into_owned());
            }
            names.sort_unstable();
            Ok(names)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn song_dir(store: &Store, source: &str) -> Result<PathBuf, MediaError> {
    if !valid_id(source) {
        return Err(MediaError::NotFound);
    }
    Ok(store.root().join("songs").join(source))
}

pub(crate) fn split_source_sha(manifest: &MediaManifest) -> Result<&str, MediaError> {
    manifest
        .source
        .as_ref()
        .filter(|file| {
            manifest.kind == MediaKind::Backing
                && ["wav", "mp3"]
                    .iter()
                    .any(|format| file.container.eq_ignore_ascii_case(format))
        })
        .map(|file| file.sha256.as_str())
        .ok_or_else(|| MediaError::Invalid("Choose a WAV or MP3 backing track".into()))
}

pub(crate) fn imported_stems(manifest: &MediaManifest) -> bool {
    manifest.kind == MediaKind::Backing
        && manifest.source.is_none()
        && manifest
            .provenance
            .as_ref()
            .is_some_and(|value| value.get("importedStems").is_some())
}

fn source_sha(store: &Store, source: &str) -> Result<String, MediaError> {
    let manifest = store.manifest(source)?;
    if imported_stems(&manifest) {
        return Ok(manifest.renders[0].sha256.clone());
    }
    split_source_sha(&manifest).map(str::to_owned)
}

pub(crate) fn split_dir(
    store: &Store,
    source: &str,
    split_id: &str,
) -> Result<PathBuf, MediaError> {
    if !valid_id(split_id) {
        return Err(MediaError::NotFound);
    }
    Ok(song_dir(store, source)?.join("splits").join(split_id))
}

pub(crate) fn mixing_file(dir: &Path, role: StemRole) -> PathBuf {
    dir.join(format!("{}.f32", role.name()))
}

pub(crate) fn read_split(
    store: &Store,
    source: &str,
    split_id: &str,
) -> Result<(Split, PathBuf), MediaError> {
    let imported = source == split_id && imported_stems(&store.manifest(source)?);
    let dir = if imported {
        store.root().join("assets").join(source).join("stems")
    } else {
        split_dir(store, source, split_id)?
    };
    let split: Split = read_json(&dir.join("manifest.json"))?;
    let bytes = split.frames.checked_mul(8).filter(|&n| n != 0);
    if split_id != split.id
        || split.source_sha256 != source_sha(store, source)?
        || !(8_000..=192_000).contains(&split.rate)
        || if imported {
            split.model_sha256.is_some()
                || split.imported_roles.as_ref().is_none_or(|roles| {
                    roles.is_empty()
                        || roles.windows(2).any(|pair| pair[0] >= pair[1])
                        || roles.iter().any(|role| !split.mode.roles().contains(role))
                })
        } else {
            split.imported_roles.is_some()
                || split.model_sha256.as_ref().is_none_or(|hash| {
                    hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                })
        }
        || bytes.is_none()
    {
        return Err(MediaError::Invalid("Invalid split manifest".into()));
    }
    for &role in split.mode.roles() {
        let metadata = fs::symlink_metadata(mixing_file(&dir, role))?;
        if !metadata.is_file() || Some(metadata.len()) != bytes {
            return Err(MediaError::Invalid(format!(
                "The {} stem is incomplete",
                role.name()
            )));
        }
    }
    Ok((split, dir))
}

pub(crate) fn stem_file(
    store: &Store,
    source: &str,
    split_id: &str,
    role: StemRole,
) -> Result<(Split, PathBuf), MediaError> {
    let (split, dir) = read_split(store, source, split_id)?;
    if !split.present_roles().contains(&role) {
        return Err(MediaError::NotFound);
    }
    Ok((split, mixing_file(&dir, role)))
}

fn mix_path(store: &Store, source: &str, mix: &str) -> Result<PathBuf, MediaError> {
    if !valid_id(mix) {
        return Err(MediaError::NotFound);
    }
    Ok(song_dir(store, source)?
        .join("mixes")
        .join(format!("{mix}.json")))
}

pub(crate) fn read_mix(store: &Store, source: &str, mix: &str) -> Result<SavedMix, MediaError> {
    let record: SavedMix = read_json(&mix_path(store, source, mix)?)?;
    if record.id != mix
        || !valid_id(&record.revision)
        || !valid_id(&record.asset)
        || !valid_id(&record.split)
    {
        return Err(MediaError::Invalid("Invalid saved mix".into()));
    }
    Ok(record)
}

pub(crate) fn generated_mix(manifest: &MediaManifest) -> Option<(&str, &str)> {
    let generated = manifest.provenance.as_ref()?.get("splitMix")?;
    Some((
        generated.get("source")?.as_str()?,
        generated.get("mix")?.as_str()?,
    ))
}

pub(crate) fn visible_render(store: &Store, manifest: &MediaManifest) -> bool {
    generated_mix(manifest).is_none_or(|(source, mix)| {
        read_mix(store, source, mix).is_ok_and(|record| record.asset == manifest.id)
    })
}

pub(crate) fn obsolete_render(store: &Store, manifest: &MediaManifest) -> bool {
    generated_mix(manifest).is_some_and(|(source, mix)| match read_mix(store, source, mix) {
        Ok(record) => record.asset != manifest.id,
        Err(MediaError::NotFound) => true,
        Err(_) => false, // Keep recoverable audio if a mix record is damaged.
    })
}

pub(crate) fn owns_asset(store: &Store, manifest: &MediaManifest) -> bool {
    generated_mix(manifest).is_some()
        || song_dir(store, &manifest.id)
            .and_then(|dir| children(&dir.join("splits")))
            .is_ok_and(|names| names.iter().any(|name| valid_id(name)))
}

pub(crate) fn list(store: &Store) -> Result<SongList, MediaError> {
    let mut songs: Vec<SongView> = children(&store.root().join("songs"))?
        .into_iter()
        .filter(|id| valid_id(id))
        .filter_map(|id| view(store, &id).ok())
        .filter(|song| !song.splits.is_empty())
        .collect();
    // IDs sort by creation time.
    songs.reverse();
    Ok(SongList { songs })
}

pub(crate) fn view(store: &Store, source: &str) -> Result<SongView, MediaError> {
    source_sha(store, source)?;
    let dir = song_dir(store, source)?;
    let mut splits = children(&dir.join("splits"))?
        .into_iter()
        .filter(|id| valid_id(id))
        .map(|id| read_split(store, source, &id).map(|(split, _)| split))
        .collect::<Result<Vec<_>, _>>()?;
    if imported_stems(&store.manifest(source)?) {
        splits.push(read_split(store, source, source)?.0);
    }
    let names = children(&dir.join("mixes"))?;
    let mixes = names
        .iter()
        .filter_map(|name| name.strip_suffix(".json").filter(|id| valid_id(id)))
        .map(|id| read_mix(store, source, id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SongView {
        source: source.into(),
        splits,
        mixes,
    })
}

pub(crate) fn render_mix(
    staging: &Staging,
    split: &Split,
    directory: &Path,
    recipe: &MixRecipe,
    mut allowed: impl FnMut() -> bool,
) -> Result<MediaRender, SongError> {
    let mut stems = split
        .mode
        .roles()
        .iter()
        .map(|&role| {
            Ok::<_, io::Error>((
                role,
                BufReader::new(File::open(mixing_file(directory, role))?),
            ))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let file = format!("play-{}.f32", split.rate);
    let path = staging.file(&file)?;
    let result = recipe.render_pcm_checked(
        &mut stems,
        split.frames,
        BufWriter::new(File::create(&path)?),
        || {
            if allowed() {
                Ok(())
            } else {
                Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "Mix render interrupted",
                ))
            }
        },
    );
    if let Err(error) = result {
        return if error.kind() == io::ErrorKind::Interrupted {
            Err(SongError::Interrupted)
        } else {
            Err(error.into())
        };
    }
    Ok(MediaRender {
        file,
        rate: split.rate,
        channels: 2,
        frames: split.frames,
        sha256: crate::media_import::hash_file(&path)?,
        resampler: None,
        peak_dbfs: None,
        loudness_lufs: None,
    })
}

/// Run under the daemon's single song-write permit. The validated asset is
/// published before the record pointing to it, then any old asset is retired.
pub(crate) fn save(
    store: &Store,
    source: &str,
    request: SaveMix,
    mut allowed: impl FnMut() -> bool,
) -> Result<SavedMix, SongError> {
    let _source = store.lease(source)?;
    let title = request.title.trim().to_owned();
    valid_title(&title).map_err(MediaError::Invalid)?;
    let previous = if let Some(expected) = &request.replace {
        let old = read_mix(store, source, &expected.id)?;
        if old.revision != expected.revision {
            return Err(SongError::Stale);
        }
        Some(old)
    } else {
        None
    };
    let (split, split_dir) = read_split(store, source, &request.split)?;
    if split.mode != request.recipe.mode() {
        return Err(MediaError::Invalid("Mix controls do not match this split mode".into()).into());
    }
    let id = previous.as_ref().map_or_else(new_id, |old| old.id.clone());
    let record_path = mix_path(store, source, &id)?;
    if !allowed() {
        return Err(SongError::Interrupted);
    }
    store.admit(split.frames * 8)?;
    let staging = store.stage()?;
    let render = (|| {
        let render = render_mix(&staging, &split, &split_dir, &request.recipe, &mut allowed)?;
        Ok(MediaManifest {
            schema: SCHEMA,
            id: staging.id.clone(),
            kind: MediaKind::Backing,
            title: title.clone(),
            created_at: now_iso(),
            source: None,
            playback: MediaPlayback::default(),
            renders: vec![render],
            provenance: Some(serde_json::json!({ "splitMix": { "source": source, "mix": id } })),
        })
    })();
    let manifest = match render {
        Ok(manifest) if allowed() => manifest,
        result => {
            let _ = store.abandon(staging);
            return Err(result.err().unwrap_or(SongError::Interrupted));
        }
    };
    store.finalize(staging, &manifest)?;
    if !allowed() {
        let _ = store.delete(&manifest.id);
        return Err(SongError::Interrupted);
    }
    let record = SavedMix {
        id,
        revision: new_id(),
        title,
        split: split.id,
        asset: manifest.id,
        recipe: request.recipe,
    };
    create_private_dir(record_path.parent().expect("mix record directory"))?;
    let bytes = serde_json::to_vec(&record).expect("mix record serializes");
    // A failed directory fsync can follow a successful rename. Leave the asset
    // available so a published record always resolves on retry or recovery.
    write_atomic(&record_path, &bytes)?;
    if let Some(old) = previous {
        let _ = store.delete(&old.asset);
    }
    Ok(record)
}

pub(crate) fn remove_mix(
    store: &Store,
    source: &str,
    target: &MixRevision,
) -> Result<(), SongError> {
    let current = read_mix(store, source, &target.id)?;
    if current.revision != target.revision {
        return Err(SongError::Stale);
    }
    if crate::song_links::in_use(store, source, &current.id)? {
        return Err(MediaError::Invalid(
            "Unlink this mix from its rig or Set list entry first".into(),
        )
        .into());
    }
    let path = mix_path(store, source, &target.id)?;
    store.without_lease(&current.asset, || {
        fs::remove_file(&path)?;
        sync_dir(path.parent().expect("mix record directory"))?;
        Ok(())
    })?;
    let _ = store.delete(&current.asset);
    Ok(())
}

pub(crate) fn remove_split(store: &Store, source: &str, split: &str) -> Result<(), MediaError> {
    if source == split && imported_stems(&store.manifest(source)?) {
        return Err(MediaError::Invalid(
            "Delete the uploaded stem song from Backing tracks".into(),
        ));
    }
    let (_, path) = read_split(store, source, split)?;
    if view(store, source)?
        .mixes
        .iter()
        .any(|mix| mix.split == split)
    {
        return Err(MediaError::Invalid(
            "Delete the saved mixes using this split first".into(),
        ));
    }
    let retired = store
        .root()
        .join("incoming")
        .join(format!("{split}.split-trash"));
    store.without_lease(source, || {
        fs::rename(&path, &retired)?;
        sync_dir(path.parent().expect("split directory"))?;
        Ok(())
    })?;
    fs::remove_dir_all(retired)?;
    Ok(())
}
