//! Revision-checked chord sheets and their local library links.
//! @see docs/media.md
mod store;

use crate::{
    ErrorCode, Shared,
    media::{self, MediaError, MediaKind, Store},
    media_api,
};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use oxidal_presets::{CatalogStore, LibraryReference};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, sync::Arc};
use store::{Registry, Save, SheetError};

const MAX_SOURCE: usize = 64 * 1024;
pub(super) const MAX_REGISTRY: usize = 4 * 1024 * 1024;
const MAX_SHEETS: usize = 128;
const MAX_LINKS: usize = 512;
const WRITE_BODY_LIMIT: usize = MAX_SOURCE * 6 + 4096;
const RESTORE_BODY_LIMIT: usize = MAX_REGISTRY + 4096;
pub(super) const FILE_NAME: &str = "chord-sheets.json";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SheetFormat {
    Chordpro,
    Markdown,
    Text,
}

impl SheetFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Chordpro => "cho",
            Self::Markdown => "md",
            Self::Text => "txt",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetSummary {
    pub id: String,
    pub revision: String,
    pub title: String,
    pub format: SheetFormat,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetDocument {
    pub id: String,
    pub revision: String,
    pub title: String,
    pub format: SheetFormat,
    pub source: String,
}

impl SheetDocument {
    fn summary(&self) -> SheetSummary {
        SheetSummary {
            id: self.id.clone(),
            revision: self.revision.clone(),
            title: self.title.clone(),
            format: self.format,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetPage {
    pub registry_revision: String,
    pub sheets: Vec<SheetSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetWrite {
    pub expected: String,
    pub title: String,
    pub format: SheetFormat,
    pub source: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetMutation {
    pub registry_revision: String,
    pub sheet: SheetDocument,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub durability_warning: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetDelete {
    pub expected: String,
    pub registry_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SheetTarget {
    Preset { preset: LibraryReference },
    Track { asset: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetLink {
    pub target: SheetTarget,
    pub sheet: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ResolvedSheetLink {
    pub target: SheetTarget,
    pub sheet: String,
    pub available: bool,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetReferences {
    pub registry_revision: String,
    pub sheet_revision: String,
    pub links: Vec<ResolvedSheetLink>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetLinks {
    pub registry_revision: String,
    pub links: Vec<ResolvedSheetLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub durability_warning: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetLinkUpdate {
    pub expected: String,
    pub target: SheetTarget,
    pub sheet: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetArchive {
    pub schema: u32,
    pub sheets: Vec<SheetDocument>,
    pub links: Vec<SheetLink>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SheetRestore {
    pub expected: Option<String>,
    pub damaged_sha256: Option<String>,
    pub archive: SheetArchive,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetRestored {
    pub registry_revision: String,
    pub restored: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub durability_warning: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SheetFailure {
    pub error: String,
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damaged_sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListQuery {
    after: Option<String>,
    limit: Option<usize>,
}

pub(super) fn routes() -> Router<Arc<Shared>> {
    Router::new()
        .route(
            "/media/sheets",
            get(list)
                .post(create)
                .layer(DefaultBodyLimit::max(WRITE_BODY_LIMIT)),
        )
        .route(
            "/media/sheets/links",
            get(links)
                .put(update_link)
                .layer(DefaultBodyLimit::max(4096)),
        )
        .route("/media/sheets/backup", get(backup))
        .route(
            "/media/sheets/restore",
            axum::routing::post(restore).layer(DefaultBodyLimit::max(RESTORE_BODY_LIMIT)),
        )
        .route(
            "/media/sheets/{id}",
            get(read)
                .patch(update)
                .delete(delete)
                .layer(DefaultBodyLimit::max(WRITE_BODY_LIMIT)),
        )
        .route("/media/sheets/{id}/references", get(references))
        .route("/media/sheets/{id}/export", get(export))
}

fn error_response(error: SheetError) -> Response {
    let (status, message, damaged_sha256) = error.description();
    media_api::no_store(
        status,
        SheetFailure {
            error: message.into(),
            code: ErrorCode::of(status, message),
            damaged_sha256,
        },
    )
}

fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, SheetError> {
    value.map(|Json(value)| value).map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            SheetError::TooLarge
        } else {
            SheetError::Invalid("Invalid chord sheet request")
        }
    })
}

async fn read_with(
    shared: Arc<Shared>,
    work: impl FnOnce(&Store, &Shared) -> Result<Response, SheetError> + Send + 'static,
) -> Response {
    let Ok(store) = &shared.media else {
        return error_response(SheetError::Unavailable);
    };
    let store = Arc::clone(store);
    match tokio::task::spawn_blocking(move || work(&store, &shared)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => error_response(error),
        Err(_) => error_response(SheetError::Unavailable),
    }
}

async fn write_with(
    shared: Arc<Shared>,
    work: impl FnOnce(&Store, &Shared) -> Result<Response, SheetError> + Send + 'static,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let gate = shared.library_access.clone().read_owned().await;
    read_with(shared, move |store, shared| {
        let _gate = gate;
        let _lock = shared
            .sheet_write
            .lock()
            .map_err(|_| SheetError::Unavailable)?;
        if let Some(reason) = shared.protect.refuse(false) {
            return Ok(crate::protect::locked(reason).into_response());
        }
        work(store, shared)
    })
    .await
}

fn response<T: Serialize>(value: T) -> Response {
    media_api::no_store(StatusCode::OK, value)
}

async fn list(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    let Ok(Query(ListQuery { after, limit })) = query else {
        return error_response(SheetError::Invalid("Invalid chord sheet page"));
    };
    let limit = limit.unwrap_or(20);
    if !(1..=50).contains(&limit) || after.as_deref().is_some_and(|id| !media::valid_id(id)) {
        return error_response(SheetError::Invalid("Invalid chord sheet page"));
    }
    read_with(shared, move |store, _| {
        let registry = Registry::load(store)?;
        let mut sheets: Vec<_> = registry
            .sheets
            .iter()
            .filter(|sheet| after.as_ref().is_none_or(|after| sheet.id > *after))
            .collect();
        sheets.sort_unstable_by_key(|sheet| &sheet.id);
        let next = (sheets.len() > limit).then(|| sheets[limit - 1].id.clone());
        Ok(response(SheetPage {
            registry_revision: registry.revision,
            sheets: sheets
                .into_iter()
                .take(limit)
                .map(SheetDocument::summary)
                .collect(),
            next,
        }))
    })
    .await
}

async fn read(State(shared): State<Arc<Shared>>, Path(id): Path<String>) -> Response {
    read_with(shared, move |store, _| {
        Ok(response(Registry::load(store)?.document(&id)?))
    })
    .await
}

fn mutation(registry: Registry, sheet: SheetDocument, save: Save, status: StatusCode) -> Response {
    media_api::no_store(
        status,
        SheetMutation {
            registry_revision: registry.revision,
            sheet,
            durability_warning: save.warning,
        },
    )
}

async fn create(
    State(shared): State<Arc<Shared>>,
    request: Result<Json<SheetWrite>, JsonRejection>,
) -> Response {
    let request = match body(request) {
        Ok(request) => request,
        Err(error) => return error_response(error),
    };
    write_with(shared, move |store, _| {
        let mut registry = Registry::load(store)?;
        let sheet = registry.create(request)?;
        let save = registry.save(store)?;
        Ok(mutation(registry, sheet, save, StatusCode::CREATED))
    })
    .await
}

async fn update(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    request: Result<Json<SheetWrite>, JsonRejection>,
) -> Response {
    let request = match body(request) {
        Ok(request) => request,
        Err(error) => return error_response(error),
    };
    write_with(shared, move |store, _| {
        let mut registry = Registry::load(store)?;
        let sheet = registry.update(&id, request)?;
        let save = registry.save(store)?;
        Ok(mutation(registry, sheet, save, StatusCode::OK))
    })
    .await
}

async fn delete(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    request: Result<Json<SheetDelete>, JsonRejection>,
) -> Response {
    let request = match body(request) {
        Ok(request) => request,
        Err(error) => return error_response(error),
    };
    write_with(shared, move |store, shared| {
        let catalog = oxidal_presets::CatalogStore::open(shared.config.preset_dir.clone())
            .map_err(|_| SheetError::Unavailable)?;
        if catalog
            .entry_settings()
            .any(|s| s.sheet.as_ref() == Some(&id))
        {
            return Err(SheetError::Conflict("A set entry uses this chord sheet"));
        }
        let mut registry = Registry::load(store)?;
        let sheet = registry.delete(&id, &request)?;
        let save = registry.save(store)?;
        Ok(mutation(registry, sheet, save, StatusCode::OK))
    })
    .await
}

async fn export(State(shared): State<Arc<Shared>>, Path(id): Path<String>) -> Response {
    read_with(shared, move |store, _| {
        let registry = Registry::load(store)?;
        let document = registry.document(&id)?;
        let filename = format!(
            "attachment; filename=\"{}.{}\"",
            document.id,
            document.format.extension()
        );
        Ok((
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/plain; charset=utf-8"),
                ),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
                (
                    header::X_CONTENT_TYPE_OPTIONS,
                    HeaderValue::from_static("nosniff"),
                ),
                (
                    header::CONTENT_DISPOSITION,
                    HeaderValue::from_str(&filename).map_err(|_| SheetError::Unavailable)?,
                ),
            ],
            document.source.clone(),
        )
            .into_response())
    })
    .await
}

fn resolve(
    store: &Store,
    shared: &Shared,
    links: impl IntoIterator<Item = SheetLink>,
) -> Result<Vec<ResolvedSheetLink>, SheetError> {
    let mut presets = None;
    links
        .into_iter()
        .map(|link| {
            let available = match &link.target {
                SheetTarget::Track { asset } => match store.manifest(asset) {
                    Ok(track) => track.kind == MediaKind::Backing,
                    Err(MediaError::NotFound | MediaError::Invalid(_)) => false,
                    Err(error) => return Err(error.into()),
                },
                SheetTarget::Preset { preset } => {
                    if presets.is_none() {
                        let root = &shared.config.preset_dir;
                        let catalog = crate::presets::catalog_items(root)
                            .and_then(|items| CatalogStore::open(root.clone())?.view(items))
                            .map_err(|_| SheetError::Unavailable)?;
                        presets = Some(
                            catalog
                                .items
                                .into_iter()
                                .filter(|item| !item.archived && !item.superseded)
                                .map(|item| (item.kind, item.id))
                                .collect::<BTreeSet<_>>(),
                        );
                    }
                    presets
                        .as_ref()
                        .is_some_and(|items| items.contains(&(preset.kind, preset.id.clone())))
                }
            };
            Ok(ResolvedSheetLink {
                target: link.target,
                sheet: link.sheet,
                available,
            })
        })
        .collect()
}

pub(crate) fn preset_links(
    store: &Store,
) -> Result<Vec<(LibraryReference, String)>, oxidal_presets::Error> {
    let registry = Registry::load(store)
        .map_err(|_| oxidal_presets::Error::Invalid("Chord sheet links are unavailable"))?;
    Ok(registry
        .links
        .into_iter()
        .filter_map(|link| match link.target {
            SheetTarget::Preset { preset } => Some((preset, link.sheet)),
            SheetTarget::Track { .. } => None,
        })
        .collect())
}

pub(crate) fn sheet_exists(store: &Store, id: &str) -> bool {
    Registry::load(store).is_ok_and(|registry| registry.document(id).is_ok())
}

async fn references(State(shared): State<Arc<Shared>>, Path(id): Path<String>) -> Response {
    read_with(shared, move |store, shared| {
        let registry = Registry::load(store)?;
        let sheet_revision = registry.document(&id)?.revision.clone();
        Ok(response(SheetReferences {
            registry_revision: registry.revision,
            sheet_revision,
            links: resolve(
                store,
                shared,
                registry.links.into_iter().filter(|link| link.sheet == id),
            )?,
        }))
    })
    .await
}

async fn links(State(shared): State<Arc<Shared>>) -> Response {
    read_with(shared, move |store, shared| {
        let registry = Registry::load(store)?;
        Ok(response(SheetLinks {
            registry_revision: registry.revision,
            links: resolve(store, shared, registry.links)?,
            durability_warning: None,
        }))
    })
    .await
}

async fn update_link(
    State(shared): State<Arc<Shared>>,
    request: Result<Json<SheetLinkUpdate>, JsonRejection>,
) -> Response {
    let request = match body(request) {
        Ok(request) => request,
        Err(error) => return error_response(error),
    };
    write_with(shared, move |store, shared| {
        let mut registry = Registry::load(store)?;
        let added = request.sheet.is_some();
        let changed = request.target.clone();
        registry.update_link(request)?;
        let links = resolve(store, shared, registry.links.iter().cloned())?;
        if added
            && !links
                .iter()
                .any(|link| link.target == changed && link.available)
        {
            return Err(SheetError::Invalid(
                "Choose an available saved preset or backing track",
            ));
        }
        let save = registry.save(store)?;
        Ok(response(SheetLinks {
            registry_revision: registry.revision,
            links,
            durability_warning: save.warning,
        }))
    })
    .await
}

fn archive_download(archive: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"oxidal-chord-sheets-v1.json\"",
            ),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        archive,
    )
        .into_response()
}

async fn backup(State(shared): State<Arc<Shared>>) -> Response {
    read_with(shared, move |store, _| {
        Ok(archive_download(Registry::load(store)?.archive_bytes()?))
    })
    .await
}

pub(super) fn backup_snapshot(store: &Store) -> Result<Option<Vec<u8>>, Box<Response>> {
    match Registry::snapshot(store) {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => Err(Box::new(error_response(error))),
    }
}

async fn restore(
    State(shared): State<Arc<Shared>>,
    request: Result<Json<SheetRestore>, JsonRejection>,
) -> Response {
    let request = match body(request) {
        Ok(request) => request,
        Err(error) => return error_response(error),
    };
    write_with(shared, move |store, _| {
        let (registry, save) = Registry::restore(store, request)?;
        Ok(response(SheetRestored {
            registry_revision: registry.revision,
            restored: registry.sheets.len(),
            durability_warning: save.warning,
        }))
    })
    .await
}
