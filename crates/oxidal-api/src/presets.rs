//! Preset library HTTP boundary. Blocking parsing/storage never runs on async/audio threads.
//! @see docs/architecture.md
use crate::{Shared, failure};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, State, rejection::BytesRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_presets::{Error, Store};
use std::sync::Arc;

async fn job<F>(shared: Arc<Shared>, operation: F) -> Response
where
    F: FnOnce(&mut Store) -> Result<Response, Error> + Send + 'static,
{
    let store = shared.presets.clone();
    let access = shared.library_access.clone().read_owned().await;
    match tokio::task::spawn_blocking(move || {
        let _access = access;
        let mut store = store
            .lock()
            .map_err(|_| Error::Io(std::io::Error::other("store lock failed")))?;
        operation(&mut store)
    })
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let status = match &error {
                Error::Conflict(_) => StatusCode::CONFLICT,
                Error::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
                Error::Io(e) if e.kind() == std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                Error::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            failure(status, &error.to_string())
        }
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Preset operation failed"),
    }
}
pub(super) async fn list(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    job(shared, move |store| {
        let mut library = store.list()?;
        library.presets = visible_native(
            &root,
            oxidal_presets::LibraryKind::Original,
            library.presets,
        )?;
        Ok(Json(library).into_response())
    })
    .await
}
pub(super) async fn import(
    State(shared): State<Arc<Shared>>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let bytes = match body {
        Ok(bytes) => bytes,
        Err(error) => return failure(error.status(), "Preset upload exceeds the 32 MiB limit"),
    };
    job(shared, move |store| {
        Ok((StatusCode::CREATED, Json(store.import(&bytes)?)).into_response())
    })
    .await
}
pub(super) async fn original(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    job(shared, move |store| {
        let bytes = store.original(&id)?;
        Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"original-{id}.t3kpreset\""),
                ),
                (header::CACHE_CONTROL, "no-store".to_owned()),
            ],
            bytes,
        )
            .into_response())
    })
    .await
}

/// Download verified immutable saved bytes, not the currently edited working session.
pub(super) async fn owned_download(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Response {
    let root = shared.config.preset_dir.join("owned");
    job(shared, move |_| {
        let (_, bytes) = oxidal_presets::OwnedStore::new(root).read(&id)?;
        Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"saved-{id}.t3kpreset\""),
                ),
                (header::CACHE_CONTROL, "no-store".to_owned()),
            ],
            bytes,
        )
            .into_response())
    })
    .await
}

/// Graph documents are independent of native original/owned files. They contain
/// plugin URIs and scalar/MIDI state, never executable paths or device bindings.
pub(super) async fn graphs(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.join("graphs");
    let access = shared.library_access.clone().read_owned().await;
    match tokio::task::spawn_blocking(move || {
        let _access = access;
        let catalog = oxidal_presets::CatalogStore::open(
            root.parent()
                .ok_or(Error::Invalid("Invalid graph store"))?
                .into(),
        )?;
        let kind = oxidal_presets::LibraryKind::Graph;
        let mut result = Vec::new();
        for mut graph in oxidal_presets::GraphStore::new(root).list()? {
            if catalog.visible(kind, &graph.id)? {
                graph.preset.name = catalog.label(kind, &graph.id, &graph.preset.name)?.into();
                result.push(graph);
            }
        }
        result.sort_by(|a, b| {
            catalog
                .position(kind, &a.id)
                .unwrap_or(usize::MAX)
                .cmp(&catalog.position(kind, &b.id).unwrap_or(usize::MAX))
                .then_with(|| a.preset.name.cmp(&b.preset.name))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok::<_, Error>(result)
    })
    .await
    {
        Ok(Ok(presets)) => Json(presets).into_response(),
        Ok(Err(error)) => failure(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Graph library task failed",
        ),
    }
}

/// Library metadata is separate from immutable native/graph/bundle contents.
pub(super) fn catalog_items(
    root: &std::path::Path,
) -> Result<Vec<oxidal_presets::LibraryItem>, Error> {
    use oxidal_presets::{LibraryItem as Item, LibraryKind as Kind, LibraryOrigin as Origin};
    let mut items = Vec::new();
    let mut push = |kind, id, name: String, origin| {
        items.push(Item {
            kind,
            id,
            name: name.clone(),
            source_name: name,
            origin,
            archived: false,
            superseded: false,
            in_set_list: false,
        })
    };
    for p in Store::new(root.into()).list()?.presets {
        push(Kind::Original, p.sha256, p.name, Origin::Tone3000);
    }
    for p in oxidal_presets::OwnedStore::new(root.join("owned")).list()? {
        push(Kind::Owned, p.id, p.preset.name, Origin::Mine);
    }
    for p in oxidal_presets::GraphStore::new(root.join("graphs")).list()? {
        push(Kind::Graph, p.id, p.preset.name, Origin::Mine);
    }
    let bundles = oxidal_presets::BundleStore::new(root.join("bundles"));
    for id in bundles.list()? {
        let manifest = bundles.manifest(&id)?;
        if manifest
            .extensions
            .get("urn:oxidal:authoring")
            .and_then(|v| v.get("draft"))
            != Some(&serde_json::Value::Bool(true))
        {
            let origin = Origin::from_manifest(&manifest)?;
            push(Kind::Rig, id, manifest.name, origin);
        }
    }
    Ok(items)
}
pub(super) async fn catalog(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    job(shared, move |_| {
        Ok(Json(
            oxidal_presets::CatalogStore::open(root.clone())?.reconcile(catalog_items(&root)?)?,
        )
        .into_response())
    })
    .await
}
pub(super) async fn manage(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<oxidal_presets::LibraryUpdate>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let request = match body {
        Ok(Json(v)) => v,
        Err(e) => return failure(e.status(), "Invalid library edit"),
    };
    if matches!(request.action, oxidal_presets::LibraryAction::Duplicate) {
        return duplicate(shared, request).await;
    }
    let root = shared.config.preset_dir.clone();
    job(shared, move |_| {
        let items = catalog_items(&root)?;
        let mut catalog = oxidal_presets::CatalogStore::open(root)?;
        catalog.reconcile(items.clone())?;
        let result = catalog.update(items, request)?;
        Ok(Json(result).into_response())
    })
    .await
}

/// Duplicate: "Name copy" in Mine with the preset's scenes, MIDI assignments,
/// boosts and measured levels; not in the set list. Holds the bundle work
/// permit like any other publication.
async fn duplicate(shared: Arc<Shared>, request: oxidal_presets::LibraryUpdate) -> Response {
    use oxidal_presets::{LibraryKind, LibraryReference};
    if request.entry_kind != LibraryKind::Rig {
        return failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only presets with scenes or effects can be duplicated here",
        );
    }
    let Ok(permit) = shared.bundle_work.clone().try_acquire_owned() else {
        return failure(
            StatusCode::CONFLICT,
            "Preset library operation already in progress",
        );
    };
    let root = shared.config.preset_dir.clone();
    let (boosts, calibration) = (shared.boosts.clone(), shared.calibration.clone());
    job(shared, move |_| {
        let _permit = permit;
        let items = catalog_items(&root)?;
        let mut catalog = oxidal_presets::CatalogStore::open(root.clone())?;
        let view = catalog.reconcile(items)?;
        if request.expected_revision != view.revision {
            return Err(Error::Conflict("Library changed; refresh before editing"));
        }
        let source = view
            .items
            .iter()
            .find(|i| i.kind == LibraryKind::Rig && i.id == request.id && !i.superseded)
            .ok_or(Error::Invalid("Library entry is unavailable"))?;
        let name = copy_name(&source.name, &view.items);
        let made = crate::rig_library::duplicate(&root, &request.id, &name)?;
        let (from, to) = (
            LibraryReference {
                kind: LibraryKind::Rig,
                id: request.id.clone(),
            },
            LibraryReference {
                kind: LibraryKind::Rig,
                id: made.revision.clone(),
            },
        );
        oxidal_presets::DetailsStore::new(root.clone()).inherit(to.clone(), from.clone())?;
        let scenes = oxidal_presets::BundleStore::new(root.join("bundles"))
            .manifest(&made.revision)?
            .scenes()?
            .map(|s| {
                s.scenes
                    .into_iter()
                    .map(|scene| scene.id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let midi = oxidal_presets::MidiMapStore::new(root.clone());
        if !midi.follow(&from, &to, &scenes)? && !scenes.is_empty() {
            midi.inherit_template(to.clone(), &scenes)?;
        }
        // Levels are a convenience: the copy itself is already saved.
        let _ = boosts.copy_preset(&made.source_id, &made.id);
        let _ = calibration.copy_preset((&made.source_id, &request.id), (&made.id, &made.revision));
        let items = catalog_items(&root)?;
        catalog.reconcile(items.clone())?;
        catalog.leave_out_after(LibraryKind::Rig, &made.revision, &from)?;
        let mut result = catalog.view(items)?;
        result.created = Some(to);
        Ok(Json(result).into_response())
    })
    .await
}

/// "Name copy", or "Name copy 2" and so on when that name is taken; within
/// the 120-byte label limit.
fn copy_name(name: &str, items: &[oxidal_presets::LibraryItem]) -> String {
    let taken = |candidate: &str| items.iter().any(|i| !i.superseded && i.name == candidate);
    let fit = |suffix: &str| {
        let mut base = name.trim().to_owned();
        while base.len() + suffix.len() > 120 {
            base.pop();
        }
        format!("{}{suffix}", base.trim_end())
    };
    let mut candidate = fit(" copy");
    let mut n = 2;
    while taken(&candidate) && n < 1000 {
        candidate = fit(&format!(" copy {n}"));
        n += 1;
    }
    candidate
}

pub(super) fn visible_native(
    root: &std::path::Path,
    kind: oxidal_presets::LibraryKind,
    items: Vec<oxidal_presets::Inspection>,
) -> Result<Vec<oxidal_presets::Inspection>, Error> {
    let catalog = oxidal_presets::CatalogStore::open(root.into())?;
    let mut result = Vec::new();
    for mut item in items {
        if catalog.visible(kind, &item.sha256)? {
            item.name = catalog.label(kind, &item.sha256, &item.name)?.into();
            result.push(item);
        }
    }
    result.sort_by(|a, b| {
        catalog
            .position(kind, &a.sha256)
            .unwrap_or(usize::MAX)
            .cmp(&catalog.position(kind, &b.sha256).unwrap_or(usize::MAX))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.sha256.cmp(&b.sha256))
    });
    Ok(result)
}

/// Descriptions and categories have their own optimistic revision, independent
/// of names, archive visibility and performance order.
pub(super) async fn details(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    job(shared, move |_| {
        Ok(Json(oxidal_presets::DetailsStore::new(root).snapshot()?).into_response())
    })
    .await
}
pub(super) async fn edit_details(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<oxidal_presets::DetailsUpdate>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let request = match body {
        Ok(Json(v)) => v,
        Err(e) => return failure(e.status(), "Invalid preset details"),
    };
    let root = shared.config.preset_dir.clone();
    job(shared, move |_| {
        if !catalog_items(&root)?
            .iter()
            .any(|item| item.kind == request.entry_kind && item.id == request.id)
        {
            return Err(Error::Invalid(
                "Preset no longer exists; refresh the library",
            ));
        }
        Ok(Json(oxidal_presets::DetailsStore::new(root).update(request)?).into_response())
    })
    .await
}
