//! Exclusive permanent deletion, independent of HTTP cancellation and PCM ownership.
//! @see docs/presets/format.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{
        Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::{AudioPhase, StartAudio};
use oxidal_presets::{
    Error, LibraryKind, LibraryReference, RemovalReferences, RemovalRequest, RemovalStore,
};
use std::{collections::BTreeSet, sync::Arc};
use tokio::sync::oneshot;
pub(super) type Forget = (LibraryReference, oneshot::Sender<Result<(), String>>);

pub(super) fn native_reference(settings: &StartAudio) -> Option<LibraryReference> {
    (!settings.draft).then(|| LibraryReference {
        kind: if settings.owned {
            LibraryKind::Owned
        } else {
            LibraryKind::Original
        },
        id: settings.preset_id.clone(),
    })
}
fn active(phase: AudioPhase, device: bool) -> bool {
    device
        || matches!(
            phase,
            AudioPhase::Starting | AudioPhase::Running | AudioPhase::Stopping
        )
}
fn assets(value: &serde_json::Value, found: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                if key == "asset" {
                    if let Some(id) = value.as_str() {
                        found.insert(id.into());
                    }
                } else {
                    assets(value, found);
                }
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                assets(value, found);
            }
        }
        _ => (),
    }
}
fn references(
    shared: &Shared,
    selected: &LibraryReference,
) -> (RemovalReferences, Option<&'static str>) {
    let mut refs = RemovalReferences::default();
    let native = shared.playback.snapshot();
    let mixed = shared.rig_playback.snapshot();
    let graph = shared.graph_playback.snapshot();
    let mut reason = None;
    let mut inspect =
        |source: Option<LibraryReference>, running: bool, value: serde_json::Value| {
            if running && let Some(source) = source.clone() {
                refs.active.push(source);
            }
            if running || source.as_ref() != Some(selected) {
                assets(&value, &mut refs.model_assets);
            }
        };
    inspect(
        native.configured.as_ref().and_then(native_reference),
        active(native.phase, native.device_owned),
        serde_json::to_value(&native).expect("serializable playback snapshot"),
    );
    inspect(
        mixed.configured.as_ref().map(|s| LibraryReference {
            kind: LibraryKind::Rig,
            id: s.revision.clone(),
        }),
        active(mixed.phase, mixed.device_owned),
        serde_json::to_value(&mixed).expect("serializable playback snapshot"),
    );
    if let Some(settings) = &mixed.configured
        && (active(mixed.phase, mixed.device_owned)
            || selected.kind != LibraryKind::Rig
            || settings.revision != selected.id)
    {
        refs.active
            .extend(settings.prepared.iter().map(|p| LibraryReference {
                kind: LibraryKind::Rig,
                id: p.revision.clone(),
            }));
    }
    if active(native.phase, native.device_owned)
        && let Some(id) = native.saved_copy
    {
        refs.active.push(LibraryReference {
            kind: LibraryKind::Owned,
            id,
        });
    }
    if active(mixed.phase, mixed.device_owned)
        && let Some(id) = mixed.save.as_ref().and_then(|s| s.saved_revision.clone())
    {
        refs.active.push(LibraryReference {
            kind: LibraryKind::Rig,
            id,
        });
    }
    if active(graph.phase, graph.device_owned) {
        if let Some(id) = graph.configured.as_ref().and_then(|s| s.library_id.clone()) {
            refs.active.push(LibraryReference {
                kind: LibraryKind::Graph,
                id,
            });
        }
        if let Some(id) = graph.saved_copy {
            refs.active.push(LibraryReference {
                kind: LibraryKind::Graph,
                id,
            });
        }
    }
    if mixed.save.as_ref().is_some_and(|s| s.running) {
        reason =
            Some("A preset is being saved. Wait for it to finish, then review deletion again.");
    }
    if selected.kind == LibraryKind::Graph
        && graph
            .configured
            .as_ref()
            .is_some_and(|s| s.library_id.is_none())
    {
        reason = Some(
            "This effects session has no saved-source identity. Recall a saved effects preset before deleting library entries.",
        );
    }
    if selected.kind == LibraryKind::Graph
        && matches!(shared.boot.snapshot(), Ok(Some(crate::audio_boot::Choice::Effects { settings })) if settings.library_id.is_none())
    {
        reason = Some(
            "The boot effects session has no saved-source identity. Turn off Start on boot or recall and save its boot choice again before deleting effects presets.",
        );
    }
    if reason.is_some() {
        refs.active.push(selected.clone());
    }
    (refs, reason)
}
fn error(error: Error) -> Response {
    let status = match error {
        Error::Conflict(_) => StatusCode::CONFLICT,
        Error::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
        Error::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    failure(status, &error.to_string())
}
pub(super) async fn preview(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<LibraryReference>, QueryRejection>,
) -> Response {
    let Ok(Query(entry)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Choose a library entry");
    };
    // The owned task retains exclusive admission through cancellation and all file work.
    tokio::spawn(async move {
        let _access = shared.library_access.clone().write_owned().await;
        let (references, reason) = references(&shared, &entry);
        let root = shared.config.preset_dir.clone();
        match tokio::task::spawn_blocking(move || {
            RemovalStore::new(root).preview(entry.kind, &entry.id, &references)
        })
        .await
        {
            Ok(Ok(mut preview)) => {
                if let Some(reason) = reason {
                    preview.blocked = Some(reason.into());
                }
                Json(preview).into_response()
            }
            Ok(Err(e)) => error(e),
            Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Deletion preview failed"),
        }
    })
    .await
    .unwrap_or_else(|_| {
        failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Deletion preview interrupted",
        )
    })
}
pub(super) async fn remove(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<RemovalRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid deletion confirmation");
    };
    tokio::spawn(async move {
        let _access = shared.library_access.clone().write_owned().await;
        let entry = LibraryReference {
            kind: request.entry_kind,
            id: request.id.clone(),
        };
        let (references, _) = references(&shared, &entry);
        let root = shared.config.preset_dir.clone();
        let result = tokio::task::spawn_blocking(move || {
            RemovalStore::new(root)
                .begin(&request, &references)?
                .commit()
        })
        .await;
        match result {
            Ok(Ok(mut result)) => {
                // Commit first: an unsuccessful staging/commit leaves owner memory untouched.
                // The exclusive gate prevents Start/Resume until stale stopped state is cleared.
                result.cleanup_pending |= shared.playback.forget(entry.clone()).await.is_err();
                result.cleanup_pending |= shared.rig_playback.forget(entry.clone()).await.is_err();
                result.cleanup_pending |=
                    shared.graph_playback.forget(entry.clone()).await.is_err();
                result.cleanup_pending |= shared.midi_map.forget(entry.kind, &entry.id).is_err();
                result.cleanup_pending |= shared.boot.reload().is_err();
                Json(result).into_response()
            }
            Ok(Err(e)) => error(e),
            Err(_) => failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Deletion interrupted; refresh the library before retrying",
            ),
        }
    })
    .await
    .unwrap_or_else(|_| {
        failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Deletion interrupted; refresh the library before retrying",
        )
    })
}
