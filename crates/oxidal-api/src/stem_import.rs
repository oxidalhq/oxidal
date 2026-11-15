//! Assemble one backing song from explicitly assigned WAV/MP3 uploads.
//! @see docs/media.md#importing-prepared-stems
use crate::{
    media::{self, MediaError, MediaKind, MediaManifest, MediaPlayback, SCHEMA, Staging, Store},
    media_api::{UploadFormat, UploadState},
    songs::{self, SongError, Split},
};
use oxidal_splitter::{MixRecipe, SplitMode, StemRole};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportStems {
    pub title: String,
    pub stems: Vec<StemUpload>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StemUpload {
    pub role: StemRole,
    pub upload: String,
}

pub(crate) fn import(
    store: &Store,
    uploads: &crate::media_api::Uploads,
    mut request: ImportStems,
    rate: u32,
    allowed: impl Fn() -> bool,
) -> Result<MediaManifest, SongError> {
    let title = request.title.trim().to_owned();
    media::valid_title(&title).map_err(MediaError::Invalid)?;
    if request.stems.is_empty() || request.stems.len() > 6 {
        return Err(MediaError::Invalid("Choose one to six stems".into()).into());
    }
    request.stems.sort_unstable_by_key(|stem| stem.role);
    let ids = request
        .stems
        .iter()
        .map(|stem| stem.upload.clone())
        .collect::<Vec<_>>();
    if request
        .stems
        .windows(2)
        .any(|pair| pair[0].role == pair[1].role)
        || ids.iter().any(|id| !media::valid_id(id))
        || ids
            .iter()
            .any(|id| ids.iter().filter(|other| *other == id).count() != 1)
    {
        return Err(MediaError::Invalid("Assign a different upload to each part".into()).into());
    }
    let id = ids.iter().min().expect("at least one stem");
    let import_details = serde_json::json!({ "importedStems": request.stems });
    // The oldest upload ID doubles as the asset ID. A retry after a lost
    // response can recover the same complete song even after the parts expire.
    match store.manifest(id) {
        Ok(existing) if existing.provenance.as_ref() == Some(&import_details) => {
            return Ok(existing);
        }
        Ok(_) => {
            return Err(MediaError::Invalid("These uploads have already been used".into()).into());
        }
        Err(MediaError::NotFound) => {}
        Err(error) => return Err(error.into()),
    }
    if !allowed() {
        return Err(SongError::Interrupted);
    }
    let claimed = uploads.claim_stems(&ids)?;
    let staging = store.stage_as(id)?;
    let result = (|| {
        let directory = staging.file("stems")?;
        media::create_private_dir(&directory)?;
        let mut split = prepare_stems(
            store,
            &staging,
            &directory,
            &request.stems,
            &claimed.states,
            rate,
            &allowed,
        )?;
        let recipe = match split.mode {
            SplitMode::Four => MixRecipe::Four {
                vocals: Default::default(),
                drums: Default::default(),
                bass: Default::default(),
                other: Default::default(),
            },
            SplitMode::Six => MixRecipe::Six {
                vocals: Default::default(),
                drums: Default::default(),
                bass: Default::default(),
                other: Default::default(),
                guitar: Default::default(),
                piano: Default::default(),
            },
        };
        store.admit(split.frames * 8)?;
        let render = songs::render_mix(&staging, &split, &directory, &recipe, &allowed)?;
        split.source_sha256.clone_from(&render.sha256);
        media::write_atomic(
            &directory.join("manifest.json"),
            &serde_json::to_vec(&split).expect("split serializes"),
        )?;
        Ok(MediaManifest {
            schema: SCHEMA,
            id: staging.id.clone(),
            kind: MediaKind::Backing,
            title,
            created_at: media::now_iso(),
            source: None,
            renders: vec![render],
            playback: MediaPlayback::default(),
            provenance: Some(import_details),
        })
    })();
    match result {
        Ok(manifest) if allowed() => {
            store.finalize(staging, &manifest)?;
            claimed.consume(store);
            Ok(manifest)
        }
        result => {
            let _ = store.abandon(staging);
            Err(result
                .err()
                .filter(|_| allowed())
                .unwrap_or(SongError::Interrupted))
        }
    }
}

fn prepare_stems(
    store: &Store,
    staging: &Staging,
    directory: &Path,
    stems: &[StemUpload],
    uploads: &[UploadState],
    rate: u32,
    allowed: &impl Fn() -> bool,
) -> Result<Split, SongError> {
    let mut frames = 0;
    let roles = stems.iter().map(|stem| stem.role).collect::<Vec<_>>();
    let mode = if roles
        .iter()
        .all(|role| SplitMode::Four.roles().contains(role))
    {
        SplitMode::Four
    } else {
        SplitMode::Six
    };
    for (stem, upload) in stems.iter().zip(uploads) {
        let target = songs::mixing_file(directory, stem.role);
        let (length, channels) = crate::media_import::render_stem(
            &store.upload_part(&upload.id)?,
            upload.format == UploadFormat::Wav,
            rate,
            &target,
            store,
            allowed,
        )
        .map_err(|error| match error {
            MediaError::Invalid(reason) => {
                MediaError::Invalid(format!("{}: {reason}", stem.role.name()))
            }
            error => error,
        })?;
        if channels == 1 {
            store.admit(length * 8)?;
            let mono = staging.file("mono.f32")?;
            fs::rename(&target, &mono)?;
            duplicate_mono(&mono, &target, length, allowed)?;
            fs::remove_file(mono)?;
        }
        frames = frames.max(length);
    }
    // Use a common zero point and extend shorter stems with silence at the tail.
    // Empty roles are sparse silence and are excluded from the editor and exports.
    for &role in mode.roles() {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(songs::mixing_file(directory, role))?;
        file.set_len(frames * 8)?;
        file.sync_all()?;
    }
    Ok(Split {
        id: staging.id.clone(),
        source_sha256: String::new(),
        model_sha256: None,
        imported_roles: Some(roles),
        mode,
        rate,
        frames,
    })
}

fn duplicate_mono(
    source: &Path,
    target: &Path,
    mut frames: u64,
    allowed: &impl Fn() -> bool,
) -> Result<(), SongError> {
    let mut input = BufReader::new(File::open(source)?);
    let mut output = BufWriter::new(File::create(target)?);
    let mut mono = [0; 16 * 1024];
    let mut stereo = [0; 32 * 1024];
    while frames > 0 {
        if !allowed() {
            return Err(SongError::Interrupted);
        }
        let count = frames.min((mono.len() / 4) as u64) as usize;
        input.read_exact(&mut mono[..count * 4])?;
        for (sample, frame) in mono[..count * 4]
            .chunks_exact(4)
            .zip(stereo.chunks_exact_mut(8))
        {
            frame[..4].copy_from_slice(sample);
            frame[4..].copy_from_slice(sample);
        }
        output.write_all(&stereo[..count * 8])?;
        frames -= count as u64;
    }
    output.flush()?;
    Ok(())
}
