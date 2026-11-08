//! Device-local controller map. Physical input is global; actions are keyed by preset identity.
use crate::Shared;
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::IntoResponse,
};
use std::sync::Arc;

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiTest {
    pub entry: oxidal_presets::LibraryReference,
    /// None tests global preset recall. A message tests the playing preset's map.
    pub message: Option<oxidal_audio::midi::Message>,
}

/// Start or end passive learning on the playing preset's controller input.
#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiLearn {
    pub on: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiTemplateApply {
    pub expected_revision: String,
    pub entry: oxidal_presets::LibraryReference,
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    match shared.midi_map.snapshot() {
        Ok(map) => ([(header::CACHE_CONTROL, "no-store")], Json(map)).into_response(),
        Err(error) => crate::failure(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            &error.to_string(),
        ),
    }
}

pub(super) async fn replace(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<oxidal_presets::MidiMapUpdate>, JsonRejection>,
) -> impl IntoResponse {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let update = match body {
        Ok(Json(update)) => update,
        Err(error) => return crate::failure(error.status(), "Invalid MIDI map").into_response(),
    };
    match shared.midi_map.replace(update) {
        Ok(map) => ([(header::CACHE_CONTROL, "no-store")], Json(map)).into_response(),
        Err(oxidal_presets::Error::Conflict(message)) => {
            crate::failure(StatusCode::CONFLICT, message).into_response()
        }
        Err(oxidal_presets::Error::Invalid(message)) => {
            crate::failure(StatusCode::UNPROCESSABLE_ENTITY, message).into_response()
        }
        Err(error) => {
            crate::failure(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()).into_response()
        }
    }
}

pub(super) async fn apply_template(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<MidiTemplateApply>, JsonRejection>,
) -> impl IntoResponse {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let request = match body {
        Ok(Json(request)) => request,
        Err(error) => {
            return crate::failure(error.status(), "Invalid MIDI template request").into_response();
        }
    };
    if request.entry.kind != oxidal_presets::LibraryKind::Rig {
        return crate::failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Scene templates apply to presets with scenes",
        )
        .into_response();
    }
    let manifest = match oxidal_presets::BundleStore::new(shared.config.preset_dir.join("bundles"))
        .manifest(&request.entry.id)
    {
        Ok(manifest) => manifest,
        Err(oxidal_presets::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return crate::failure(StatusCode::NOT_FOUND, "Preset is no longer available")
                .into_response();
        }
        Err(error) => {
            return crate::failure(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                .into_response();
        }
    };
    let scenes = match manifest.scenes() {
        Ok(Some(scenes)) => scenes
            .scenes
            .into_iter()
            .map(|scene| scene.id)
            .collect::<Vec<_>>(),
        Ok(None) => {
            return crate::failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                "This preset has no scenes to map",
            )
            .into_response();
        }
        Err(error) => {
            return crate::failure(StatusCode::UNPROCESSABLE_ENTITY, &error.to_string())
                .into_response();
        }
    };
    match shared
        .midi_map
        .apply_template(&request.expected_revision, request.entry, &scenes)
    {
        Ok(map) => ([(header::CACHE_CONTROL, "no-store")], Json(map)).into_response(),
        Err(oxidal_presets::Error::Conflict(message)) => {
            crate::failure(StatusCode::CONFLICT, message).into_response()
        }
        Err(oxidal_presets::Error::Invalid(message)) => {
            crate::failure(StatusCode::UNPROCESSABLE_ENTITY, message).into_response()
        }
        Err(error) => {
            crate::failure(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()).into_response()
        }
    }
}

/// While learning, input is recorded but never dispatched. Learning edits
/// configuration, so Protect refuses it; ending a learn window is always allowed.
pub(super) async fn learn(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<MidiLearn>, JsonRejection>,
) -> impl IntoResponse {
    let request = match body {
        Ok(Json(request)) => request,
        Err(error) => return crate::failure(error.status(), "Invalid MIDI learn").into_response(),
    };
    if request.on && shared.protect.on() {
        return crate::failure(
            StatusCode::CONFLICT,
            "Protect is on. Turn Protect off to learn a controller.",
        )
        .into_response();
    }
    let rig = shared.rig_playback.snapshot();
    let native = shared.playback.snapshot();
    let result = if rig.phase == oxidal_audio::lifecycle::AudioPhase::Running {
        shared
            .rig_playback
            .dispatch(oxidal_engine::protocol::RigAudioCommand {
                session: rig.session,
                expected_revision: rig.revision,
                action: oxidal_engine::protocol::RigAudioAction::MidiLearn { on: request.on },
            })
            .await
            .map(|_| ())
    } else if native.phase == oxidal_audio::lifecycle::AudioPhase::Running {
        shared
            .playback
            .dispatch(oxidal_audio::lifecycle::AudioCommand {
                session: native.session,
                expected_revision: native.revision,
                action: oxidal_audio::lifecycle::AudioAction::MidiLearn { on: request.on },
            })
            .await
            .map(|_| ())
    } else if request.on {
        Err("Play a preset before learning a controller".into())
    } else {
        Ok(())
    };
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => crate::failure(StatusCode::CONFLICT, &error).into_response(),
    }
}

pub(super) async fn test(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<MidiTest>, JsonRejection>,
) -> impl IntoResponse {
    let request = match body {
        Ok(Json(request)) => request,
        Err(error) => return crate::failure(error.status(), "Invalid MIDI test").into_response(),
    };
    let result = match request.message {
        None => crate::midi_recall::recall_entry(&shared, &request.entry).await,
        Some(message) => {
            let playing = match request.entry.kind {
                oxidal_presets::LibraryKind::Owned => {
                    shared
                        .playback
                        .snapshot()
                        .configured
                        .as_ref()
                        .and_then(crate::library_removal::native_reference)
                        .as_ref()
                        == Some(&request.entry)
                }
                oxidal_presets::LibraryKind::Rig => shared
                    .rig_playback
                    .snapshot()
                    .configured
                    .as_ref()
                    .is_some_and(|configured| configured.revision == request.entry.id),
                _ => false,
            };
            if !playing
                && let Err(error) = crate::midi_recall::recall_entry(&shared, &request.entry).await
            {
                return crate::failure(StatusCode::CONFLICT, &error).into_response();
            }
            match request.entry.kind {
                oxidal_presets::LibraryKind::Owned => {
                    let state = shared.playback.snapshot();
                    if state
                        .configured
                        .as_ref()
                        .and_then(crate::library_removal::native_reference)
                        .as_ref()
                        != Some(&request.entry)
                    {
                        Err("Play this preset before testing its scene or control mappings".into())
                    } else {
                        shared
                            .playback
                            .dispatch(oxidal_audio::lifecycle::AudioCommand {
                                session: state.session,
                                expected_revision: state.revision,
                                action: oxidal_audio::lifecycle::AudioAction::MidiTest { message },
                            })
                            .await
                            .map(|_| ())
                    }
                }
                oxidal_presets::LibraryKind::Rig => {
                    let state = shared.rig_playback.snapshot();
                    if state
                        .configured
                        .as_ref()
                        .is_none_or(|configured| configured.revision != request.entry.id)
                    {
                        Err("Play this preset before testing its scene or control mappings".into())
                    } else {
                        shared
                            .rig_playback
                            .dispatch(oxidal_engine::protocol::RigAudioCommand {
                                session: state.session,
                                expected_revision: state.revision,
                                action: oxidal_engine::protocol::RigAudioAction::MidiTest {
                                    message,
                                },
                            })
                            .await
                            .map(|_| ())
                    }
                }
                _ => Err("This library item cannot own a MIDI map".into()),
            }
        }
    };
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => crate::failure(StatusCode::CONFLICT, &error).into_response(),
    }
}
