//! Reusable parameter settings for the offline editor. The Library backup
//! includes this file. Recalling settings never runs or publishes a rig.
use crate::{Shared, failure, media, rig_library};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use oxidal_presets::Error;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{ErrorKind, Read},
    path::Path,
    sync::Arc,
};

const FILE: &str = "block-settings-v1.json";
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BlockSettingsLibrary {
    revision: u32,
    entries: Vec<NamedBlockSettings>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NamedBlockSettings {
    id: String,
    name: String,
    plugin: String,
    controls: BTreeMap<String, f32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BlockSettingsCommand {
    Create {
        revision: u32,
        entry: NamedBlockSettings,
    },
    Replace {
        revision: u32,
        entry: NamedBlockSettings,
    },
    Delete {
        revision: u32,
        id: String,
    },
}

fn validate(entry: &NamedBlockSettings) -> Result<(), Error> {
    let plugin = entry
        .plugin
        .strip_prefix("urn:oxidal:plugin:")
        .and_then(|s| s.split_once('#'));
    if !matches!(
        plugin,
        Some((
            "bloom" | "echo" | "motion" | "sustain" | "moment",
            "mono" | "stereo"
        ))
    ) {
        return Err(Error::Invalid("Choose a bundled Oxidal effect"));
    }
    if entry.id.len() != 32
        || !entry
            .id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || media::valid_title(&entry.name).is_err()
        || entry.name.trim() != entry.name
        || entry.controls.is_empty()
        || entry.controls.len() > 128
        || entry.controls.iter().any(|(symbol, value)| {
            symbol.is_empty()
                || symbol.len() > 128
                || !symbol
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_')
                || !value.is_finite()
        })
    {
        return Err(Error::Invalid("Invalid named block settings"));
    }
    Ok(())
}

fn read(root: &Path) -> Result<BlockSettingsLibrary, Error> {
    let file = match std::fs::File::open(root.join(FILE)) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Default::default()),
        Err(e) => return Err(e.into()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BYTES {
        return Err(Error::Invalid("Block settings file is too large"));
    }
    let saved: BlockSettingsLibrary = serde_json::from_slice(&bytes)
        .map_err(|_| Error::Invalid("Cannot read saved block settings"))?;
    let mut ids = BTreeSet::new();
    if saved.entries.len() > 256
        || saved
            .entries
            .iter()
            .any(|entry| validate(entry).is_err() || !ids.insert(&entry.id))
    {
        return Err(Error::Invalid("Invalid saved block settings library"));
    }
    Ok(saved)
}

fn update(root: &Path, command: BlockSettingsCommand) -> Result<BlockSettingsLibrary, Error> {
    let mut library = read(root)?;
    let expected = match &command {
        BlockSettingsCommand::Create { revision, .. }
        | BlockSettingsCommand::Replace { revision, .. }
        | BlockSettingsCommand::Delete { revision, .. } => *revision,
    };
    if library.revision != expected {
        return Err(Error::Conflict(
            "Block settings changed. Refresh before changing them again.",
        ));
    }
    match command {
        BlockSettingsCommand::Create { entry, .. } => {
            if library.entries.len() >= 256 {
                return Err(Error::Invalid("The library already has 256 block settings"));
            }
            if library.entries.iter().any(|e| e.id == entry.id) {
                return Err(Error::Conflict("Block settings ID already exists"));
            }
            library.entries.push(entry);
        }
        BlockSettingsCommand::Replace { entry, .. } => {
            let current = library
                .entries
                .iter_mut()
                .find(|e| e.id == entry.id)
                .ok_or(Error::Conflict("Block settings were removed"))?;
            if current.plugin != entry.plugin {
                return Err(Error::Invalid("Choose settings for the same effect"));
            }
            *current = entry;
        }
        BlockSettingsCommand::Delete { id, .. } => {
            let pos = library
                .entries
                .iter()
                .position(|e| e.id == id)
                .ok_or(Error::Conflict("Block settings were removed"))?;
            library.entries.remove(pos);
        }
    }
    library.revision = library
        .revision
        .checked_add(1)
        .ok_or(Error::Invalid("Block settings revision exhausted"))?;
    let bytes =
        serde_json::to_vec(&library).map_err(|_| Error::Invalid("Cannot write block settings"))?;
    if bytes.len() > MAX_BYTES {
        return Err(Error::Invalid("Block settings file is full"));
    }
    std::fs::create_dir_all(root)?;
    media::write_atomic(&root.join(FILE), &bytes)?;
    Ok(library)
}

pub async fn list(State(shared): State<Arc<Shared>>) -> Response {
    rig_library::job(shared, true, |root| read(&root)).await
}

pub async fn change(
    State(shared): State<Arc<Shared>>,
    command: Result<Json<BlockSettingsCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(command)) = command else {
        return failure(StatusCode::BAD_REQUEST, "Invalid block settings command");
    };
    if let BlockSettingsCommand::Create { entry, .. }
    | BlockSettingsCommand::Replace { entry, .. } = &command
    {
        if let Err(e) = validate(entry) {
            return failure(StatusCode::UNPROCESSABLE_ENTITY, &e.to_string());
        }
        let catalog = match crate::plugins::installed(&shared, 48000).await {
            Ok(catalog) => catalog,
            Err((status, reason)) => return failure(status, &reason),
        };
        let Some(plugin) = catalog
            .plugins
            .iter()
            .find(|p| p.uri == entry.plugin && p.unsupported.is_none())
        else {
            return failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                "These settings need an installed compatible effect",
            );
        };
        let ports = plugin.ports.iter().filter(|p| p.input && p.control);
        if ports.clone().count() != entry.controls.len()
            || !ports.into_iter().all(|p| {
                entry
                    .controls
                    .get(&p.symbol)
                    .is_some_and(|v| p.validate_value(*v, true).is_ok())
            })
        {
            return failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                "The settings do not match this effect's installed controls",
            );
        }
    }
    rig_library::job(shared, false, |root| update(&root, command)).await
}
