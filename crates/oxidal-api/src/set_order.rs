//! Set-list edits and offline reference checks share the durable Library catalog.
use crate::{Shared, failure, presets};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::{
    CatalogStore, EntrySettings, Error, LibraryKind, OccurrenceAction, OccurrenceEdit,
};
use std::{path::Path, sync::Arc};

pub(super) async fn read(State(shared): State<Arc<Shared>>) -> Response {
    let worker = shared.clone();
    presets::job(shared, move |_| Ok(Json(current(&worker)?).into_response())).await
}

pub(super) fn current(shared: &Shared) -> Result<oxidal_presets::SetOrder, Error> {
    let root = &shared.config.preset_dir;
    let store = CatalogStore::open(root.clone())?;
    let order = store.set_order(presets::catalog_items(root)?)?;
    with_links(shared, order)
}

fn with_links(
    shared: &Shared,
    mut order: oxidal_presets::SetOrder,
) -> Result<oxidal_presets::SetOrder, Error> {
    if let Ok(media) = &shared.media {
        let links = crate::song_links::set_defaults(media)
            .map_err(|_| Error::Invalid("Set-list backing links are unavailable"))?;
        let sheets = crate::sheets::preset_links(media)?;
        for row in &mut order.entries {
            let matches = |p: &oxidal_presets::LibraryReference| {
                p.kind == row.entry.preset.kind
                    && (p.id == row.entry.preset.id || p.id == row.content)
            };
            let settings = &mut row.entry.settings;
            if !settings.own_media {
                if settings.track.is_none()
                    && let Some((_, link)) = links.iter().find(|(p, _)| matches(p))
                {
                    settings.track = Some(link.source.clone());
                    settings.mix = Some(link.mix.clone());
                }
                if settings.sheet.is_none() {
                    settings.sheet = sheets
                        .iter()
                        .find(|(p, _)| matches(p))
                        .map(|(_, id)| id.clone());
                }
            }
        }
    }
    Ok(order)
}

pub(super) fn validate(
    shared: &Shared,
    root: &Path,
    kind: LibraryKind,
    content: &str,
    settings: &EntrySettings,
) -> Result<(), Error> {
    if let Some(scene) = &settings.scene
        && (kind != LibraryKind::Rig
            || !oxidal_presets::BundleStore::new(root.join("bundles"))
                .manifest(content)?
                .scenes()?
                .is_some_and(|s| s.scenes.iter().any(|v| v.id == *scene)))
    {
        return Err(Error::Invalid(
            "Starting scene is unavailable in this version",
        ));
    }
    if settings.track.is_none() && settings.sheet.is_none() && settings.mix.is_none() {
        return Ok(());
    }
    let media = shared
        .media
        .as_ref()
        .map_err(|_| Error::Invalid("Media storage is unavailable"))?;
    if let Some(track) = &settings.track {
        if !media
            .manifest(track)
            .is_ok_and(|m| m.kind == crate::media::MediaKind::Backing)
        {
            return Err(Error::Invalid("Choose an available backing track"));
        }
        if let Some(mix) = &settings.mix {
            let saved = crate::songs::read_mix(media, track, mix)
                .map_err(|_| Error::Invalid("Saved mix is unavailable for this track"))?;
            if !media
                .manifest(&saved.asset)
                .is_ok_and(|m| m.kind == crate::media::MediaKind::Backing)
            {
                return Err(Error::Invalid("Saved mix audio is unavailable"));
            }
        }
    } else if settings.mix.is_some() {
        return Err(Error::Invalid("Choose a backing track for this mix"));
    }
    if let Some(sheet) = &settings.sheet
        && !crate::sheets::sheet_exists(media, sheet)
    {
        return Err(Error::Invalid("Chord sheet is unavailable"));
    }
    Ok(())
}

pub(super) async fn edit(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<OccurrenceEdit>, JsonRejection>,
) -> Response {
    let Ok(Json(edit)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid set entry edit");
    };
    let root = shared.config.preset_dir.clone();
    let worker = shared.clone();
    presets::job(shared, move |_| {
        let _song = worker
            .song_write
            .try_acquire()
            .map_err(|_| Error::Conflict("A song edit is in progress"))?;
        let _sheets = worker
            .sheet_write
            .lock()
            .map_err(|_| Error::Invalid("Chord sheet storage is unavailable"))?;
        let mut store = CatalogStore::open(root.clone())?;
        let items = presets::catalog_items(&root)?;
        let inherited = if matches!(edit.action, OccurrenceAction::Repeat { .. }) {
            with_links(&worker, store.set_order(items.clone())?)?
                .entries
                .into_iter()
                .find(|row| row.entry.id == edit.entry)
                .map(|row| row.entry.settings)
        } else {
            None
        };
        if let OccurrenceAction::Change { settings } = &edit.action {
            let current = store.set_order(items.clone())?;
            if current.revision != edit.expected_revision {
                return Err(Error::Conflict("Set list changed; reload before editing"));
            }
            let entry = current
                .entries
                .iter()
                .find(|r| r.entry.id == edit.entry)
                .ok_or(Error::Invalid("Set entry is unavailable"))?;
            let preset = &entry.entry.preset;
            let family = store.versions(preset.kind, &preset.id)?.preset;
            let selected = settings.version.as_ref().unwrap_or(&family.default_version);
            let content = &family
                .versions
                .iter()
                .find(|v| v.id == *selected)
                .ok_or(Error::Invalid("Version is unavailable"))?
                .content;
            validate(&worker, &root, preset.kind, content, settings)?;
        }
        Ok(Json(with_links(
            &worker,
            store.edit_occurrence_with_links(items, edit, inherited)?,
        )?)
        .into_response())
    })
    .await
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Jump {
    expected_revision: String,
}
pub(super) async fn jump(
    State(shared): State<Arc<Shared>>,
    axum::extract::Path(id): axum::extract::Path<String>,
    body: Result<Json<Jump>, JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send the set-list revision");
    };
    if shared.captures.reamping() {
        return failure(StatusCode::CONFLICT, crate::capture::REAMP_LOCKED);
    }
    match crate::midi_recall::jump(&shared, &body.expected_revision, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(reason) => failure(StatusCode::CONFLICT, &reason),
    }
}
