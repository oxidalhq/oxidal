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

pub(super) async fn job<F>(shared: Arc<Shared>, operation: F) -> Response
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
// Version browsing and metadata edits operate on the catalog without loading audio.
pub(super) async fn versions(
    State(shared): State<Arc<Shared>>,
    Path((kind, first)): Path<(oxidal_presets::LibraryKind, String)>,
) -> Response {
    version_operation(shared, kind, first, None).await
}

pub(super) async fn edit_version(
    State(shared): State<Arc<Shared>>,
    Path((kind, first)): Path<(oxidal_presets::LibraryKind, String)>,
    body: Result<Json<oxidal_presets::VersionEdit>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let edit = match body {
        Ok(Json(edit)) => edit,
        Err(error) => return failure(error.status(), "Invalid version edit"),
    };
    version_operation(shared, kind, first, Some(edit)).await
}

async fn version_operation(
    shared: Arc<Shared>,
    kind: oxidal_presets::LibraryKind,
    first: String,
    edit: Option<oxidal_presets::VersionEdit>,
) -> Response {
    let root = shared.config.preset_dir.clone();
    job(shared, move |_| {
        let mut store = oxidal_presets::CatalogStore::open(root.clone())?;
        let logical = store.logical_source(kind, &first)?;
        let view = store.versions(kind, &logical)?;
        let current = view
            .preset
            .versions
            .iter()
            .find(|v| v.id == view.preset.default_version)
            .ok_or(Error::Invalid("Default version is unavailable"))?;
        let items = catalog_items(&root)?;
        let item = items
            .iter()
            .find(|i| i.kind == kind && i.id == current.content)
            .ok_or(Error::Invalid("Preset is unavailable"))?;
        if let Some(edit) = edit {
            if matches!(edit.action, oxidal_presets::VersionAction::Publish { .. }) {
                return Err(Error::Invalid(
                    "Publish verified preset contents through Save",
                ));
            }
            if item.origin != oxidal_presets::LibraryOrigin::Mine {
                return Err(Error::Invalid(
                    "Save a copy in Mine before editing versions",
                ));
            }
            return Ok(Json(store.edit_version(kind, &logical, edit)?).into_response());
        }
        Ok(Json(view).into_response())
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
/// boosts and measured levels; not in the set list. A preset with scenes or
/// effects and a TONE3000 chain saved in Mine can be duplicated; a TONE3000
/// original is read-only and is copied with Save copy instead. Holds the
/// bundle work permit like any other publication.
async fn duplicate(shared: Arc<Shared>, request: oxidal_presets::LibraryUpdate) -> Response {
    use oxidal_presets::{LibraryKind, LibraryReference};
    if !matches!(request.entry_kind, LibraryKind::Rig | LibraryKind::Owned) {
        return failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only presets in Mine can be duplicated; open a TONE3000 original and use Save copy",
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
            .find(|i| i.kind == request.entry_kind && i.id == request.id && !i.superseded)
            .ok_or(Error::Invalid("Library entry is unavailable"))?;
        let name = copy_name(&source.name, &view.items);
        if request.entry_kind == LibraryKind::Owned {
            let made = duplicate_owned(&root, &request.id, &name)?;
            let (from, to) = (
                LibraryReference {
                    kind: LibraryKind::Owned,
                    id: request.id.clone(),
                },
                LibraryReference {
                    kind: LibraryKind::Owned,
                    id: made.clone(),
                },
            );
            oxidal_presets::DetailsStore::new(root.clone()).inherit(to.clone(), from.clone())?;
            // A TONE3000 chain has no scenes: its switch and control
            // assignments come along, nothing else applies.
            oxidal_presets::MidiMapStore::new(root.clone()).follow(&from, &to, &[])?;
            // The boost is a convenience; the measured level is keyed by the
            // copy's own content, so Even out measures the copy again.
            let _ = boosts.copy_owned(&request.id, &made);
            let items = catalog_items(&root)?;
            catalog.reconcile(items.clone())?;
            catalog.leave_out_after(LibraryKind::Owned, &made, &from)?;
            let mut result = catalog.view(items)?;
            result.created = Some(to);
            return Ok(Json(result).into_response());
        }
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

/// Saves "Name copy" of a TONE3000 chain saved in Mine and returns its id. An
/// owned chain is identified by its exact bytes, so the copy carries the new
/// name and a new native identity; every other byte, blocks, settings and
/// embedded models included, is the source's. The source is never changed.
fn duplicate_owned(root: &std::path::Path, id: &str, name: &str) -> Result<String, Error> {
    use sha2::{Digest, Sha256};
    let store = oxidal_presets::OwnedStore::new(root.join("owned"));
    let (info, bytes) = store.read(id)?;
    let hex = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "oxidal-duplicate:{id}:{}:{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| Error::Invalid("Invalid system clock"))?
                    .as_nanos()
            )
            .as_bytes()
        )
    );
    let copy = renamed_native(&bytes, name, &format!("oxidal-copy-{}", &hex[..32]))?;
    let saved = match &info.source_sha256 {
        Some(source) => store.save(source, &copy)?,
        None => store.save_created(&copy)?,
    };
    Ok(saved.id)
}

/// The native preset with its header and body `name` and `id` replaced. Only
/// those two root text properties change; every other byte is copied as is
/// and the result is inspected again, so a copy is never stored malformed.
fn renamed_native(bytes: &[u8], name: &str, id: &str) -> Result<Vec<u8>, Error> {
    if name.trim().is_empty() || name.contains('\0') || id.contains('\0') {
        return Err(Error::Invalid("Invalid preset identity"));
    }
    let mut copy = Vec::with_capacity(bytes.len() + name.len() + id.len());
    match bytes.get(..4) {
        Some(b"T3KB") => {
            copy.extend_from_slice(b"T3KB");
            copy.extend(renamed_root(&bytes[4..], name, id)?);
        }
        Some(b"T3KH") => {
            let length = bytes
                .get(4..8)
                .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize)
                .ok_or(Error::Invalid("Truncated preset header"))?;
            let end = 8usize
                .checked_add(length)
                .filter(|end| *end <= bytes.len())
                .ok_or(Error::Invalid("Truncated preset header"))?;
            let header = renamed_root(&bytes[8..end], name, id)?;
            copy.extend_from_slice(b"T3KH");
            copy.extend_from_slice(
                &u32::try_from(header.len())
                    .map_err(|_| Error::Invalid("Invalid preset header size"))?
                    .to_le_bytes(),
            );
            copy.extend(header);
            copy.extend(renamed_root(&bytes[end..], name, id)?);
        }
        _ => return Err(Error::Invalid("Not a TONE3000 preset")),
    }
    let checked = oxidal_presets::inspect(&copy)?;
    if checked.name != name || checked.source_id.as_deref() != Some(id) {
        return Err(Error::Invalid("Preset copy integrity failed"));
    }
    Ok(copy)
}

/// One serialized value tree with its root `name` and `id` text properties
/// replaced: type name, property count, then each property as a name and a
/// length-prefixed value; children follow unchanged.
fn renamed_root(tree: &[u8], name: &str, id: &str) -> Result<Vec<u8>, Error> {
    let truncated = || Error::Invalid("Truncated native preset");
    let text_end = |at: usize| {
        tree.get(at..)
            .and_then(|rest| rest.iter().position(|b| *b == 0))
            .map(|n| at + n + 1)
            .ok_or_else(truncated)
    };
    let count = |at: usize| -> Result<(usize, usize), Error> {
        let width = usize::from(*tree.get(at).ok_or_else(truncated)?);
        if width > 4 {
            return Err(Error::Invalid("Invalid native count"));
        }
        let mut value = [0; 4];
        value[..width].copy_from_slice(tree.get(at + 1..at + 1 + width).ok_or_else(truncated)?);
        Ok((u32::from_le_bytes(value) as usize, at + 1 + width))
    };
    let put_count = |out: &mut Vec<u8>, n: usize| -> Result<(), Error> {
        let value = u32::try_from(n)
            .map_err(|_| Error::Invalid("Invalid native length"))?
            .to_le_bytes();
        let width = 4 - value.iter().rev().take_while(|b| **b == 0).count();
        out.push(width as u8);
        out.extend_from_slice(&value[..width]);
        Ok(())
    };
    let mut at = text_end(0)?;
    let (properties, next) = count(at)?;
    let mut out = tree[..next].to_vec();
    at = next;
    for _ in 0..properties {
        let key_end = text_end(at)?;
        let key = &tree[at..key_end - 1];
        out.extend_from_slice(&tree[at..key_end]);
        let (length, start) = count(key_end)?;
        let end = start
            .checked_add(length)
            .filter(|end| *end <= tree.len())
            .ok_or_else(truncated)?;
        let text = match key {
            b"name" => Some(name),
            b"id" => Some(id),
            _ => None,
        };
        match text {
            // Text values are tag 5, the UTF-8 bytes and a terminating NUL.
            Some(text) if length > 0 && tree[start] == 5 => {
                put_count(&mut out, text.len() + 2)?;
                out.push(5);
                out.extend_from_slice(text.as_bytes());
                out.push(0);
            }
            _ => out.extend_from_slice(&tree[key_end..end]),
        }
        at = end;
    }
    out.extend_from_slice(&tree[at..]);
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::renamed_native;
    const CURRENT: &[u8] =
        include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
    const LEGACY: &[u8] =
        include_bytes!("../../oxidal-presets/tests/fixtures/authored-legacy.t3kpreset");

    #[test]
    fn a_renamed_native_copy_keeps_everything_but_its_name_and_identity() {
        for original in [CURRENT, LEGACY] {
            let before = oxidal_presets::inspect(original).unwrap();
            // Longer and shorter than the original, so lengths are re-encoded.
            for name in ["Fixture – Δ copy with a much longer name", "F"] {
                let copy = renamed_native(original, name, "oxidal-copy-1").unwrap();
                let after = oxidal_presets::inspect(&copy).unwrap();
                assert_eq!(after.name, name);
                assert_eq!(after.source_id.as_deref(), Some("oxidal-copy-1"));
                assert_eq!(after.framing, before.framing);
                assert_eq!(after.parameter_count, before.parameter_count);
                assert_eq!(after.block_count, before.block_count);
                assert_eq!(after.embedded_bytes, before.embedded_bytes);
                assert_eq!(
                    oxidal_presets::embedded_digests(&copy).unwrap(),
                    oxidal_presets::embedded_digests(original).unwrap()
                );
                assert_ne!(after.sha256, before.sha256);
            }
        }
    }

    #[test]
    fn a_renamed_native_copy_refuses_malformed_input_and_names() {
        assert!(renamed_native(b"nope", "Copy", "oxidal-copy").is_err());
        assert!(renamed_native(&CURRENT[..CURRENT.len() - 1], "Copy", "oxidal-copy").is_err());
        assert!(renamed_native(CURRENT, "Bad\0name", "oxidal-copy").is_err());
        assert!(renamed_native(CURRENT, "  ", "oxidal-copy").is_err());
        for length in 0..CURRENT.len() {
            let _ = renamed_native(&CURRENT[..length], "Copy", "oxidal-copy");
        }
    }
}
