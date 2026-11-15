//! Local, revision-checked links between catalog presets and logical mixes.
use crate::{
    Shared, failure,
    media::{MediaError, Store, new_id, write_atomic},
    media_api::{blocking, no_store, store},
    song_api,
    songs::{self, SongError},
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use oxidal_presets::{CatalogStore, LibraryKind, LibraryReference};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf, sync::Arc};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Rig,
    SetList,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub scope: Scope,
    pub preset: LibraryReference,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MixLink {
    pub source: String,
    pub mix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    target: Target,
    mix: MixLink,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Records {
    revision: String,
    links: Vec<Entry>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Resolved {
    pub target: Target,
    pub mix: MixLink,
    pub asset: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Links {
    pub revision: String,
    pub links: Vec<Resolved>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Update {
    pub expected: String,
    pub target: Target,
    pub mix: Option<MixLink>,
}

fn path(store: &Store) -> PathBuf {
    store.root().join("song-links.json")
}

fn load(store: &Store) -> Result<Records, MediaError> {
    match fs::read(path(store)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| MediaError::Invalid(format!("Damaged song links: {error}"))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Records {
            revision: String::new(),
            links: vec![],
        }),
        Err(error) => Err(error.into()),
    }
}

fn resolve(store: &Store, record: Records) -> Links {
    Links {
        revision: record.revision,
        links: record
            .links
            .into_iter()
            .map(|entry| {
                let saved = songs::read_mix(store, &entry.mix.source, &entry.mix.mix)
                    .ok()
                    .filter(|record| store.manifest(&record.asset).is_ok());
                Resolved {
                    target: entry.target,
                    mix: entry.mix,
                    asset: saved.as_ref().map(|record| record.asset.clone()),
                    title: saved.map(|record| record.title),
                }
            })
            .collect(),
    }
}

pub(crate) fn in_use(store: &Store, source: &str, id: &str) -> Result<bool, MediaError> {
    Ok(load(store)?
        .links
        .iter()
        .any(|entry| entry.mix.source == source && entry.mix.mix == id))
}

pub(crate) async fn view(State(shared): State<Arc<Shared>>) -> Response {
    let store = match store(&shared) {
        Ok(store) => store,
        Err(response) => return *response,
    };
    match blocking(move || load(&store).map(|record| resolve(&store, record))).await {
        Ok(links) => no_store(StatusCode::OK, links),
        Err(response) => *response,
    }
}

pub(crate) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Update>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send a saved target and mix");
    };
    let guard = shared.library_access.clone().read_owned().await;
    song_api::change(shared, move |store, shared| {
        let _guard = guard;
        let mut record = load(store)?;
        if record.revision != request.expected {
            return Err(SongError::Stale);
        }
        if let Some(mix) = &request.mix {
            let root = &shared.config.preset_dir;
            let items = crate::presets::catalog_items(root)
                .and_then(|items| CatalogStore::open(root.clone())?.view(items))
                .map_err(|error| MediaError::Invalid(error.to_string()))?;
            if !items.items.iter().any(|item| {
                let target = &request.target.preset;
                item.kind == target.kind
                    && item.id == target.id
                    && !item.archived
                    && !item.superseded
                    && matches!(item.kind, LibraryKind::Owned | LibraryKind::Rig)
                    && (request.target.scope == Scope::Rig || item.in_set_list)
            }) {
                return Err(MediaError::Invalid(
                    "Choose an available saved rig or Set list entry".into(),
                )
                .into());
            }
            let saved = songs::read_mix(store, &mix.source, &mix.mix)?;
            store.manifest(&saved.asset)?;
        }
        record.links.retain(|entry| entry.target != request.target);
        if let Some(mix) = request.mix {
            record.links.push(Entry {
                target: request.target,
                mix,
            });
        }
        record.revision = new_id();
        write_atomic(
            &path(store),
            &serde_json::to_vec(&record).expect("links serialize"),
        )?;
        Ok(no_store(StatusCode::OK, resolve(store, record)))
    })
    .await
}
