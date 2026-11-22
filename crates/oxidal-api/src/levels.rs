//! Unit-wide gain staging: guitar input trim and master output level.
//! Kept apart from presets so every rig, engine and restart uses the same levels.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::tools::HostLevels;
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, RwLock},
};

#[derive(Debug)]
pub(crate) struct Levels {
    path: PathBuf,
    value: RwLock<HostLevels>,
    /// The venue EQ the outputs use now (saved profile or live preview),
    /// attached to every stream start. Persisted by the venue store.
    venue: RwLock<Option<oxidal_audio::venue::VenueApplied>>,
}
impl Levels {
    /// A missing or unreadable file starts at unity; it never blocks audio.
    pub(crate) fn load(path: PathBuf) -> Self {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 4096)
            .and_then(|bytes| serde_json::from_slice::<HostLevels>(&bytes).ok())
            .filter(|levels| levels.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            value: RwLock::new(value),
            venue: RwLock::new(None),
        }
    }
    pub(crate) fn venue(&self) -> Option<oxidal_audio::venue::VenueApplied> {
        self.venue.read().map(|v| *v).unwrap_or_default()
    }
    pub(crate) fn set_venue(&self, venue: Option<oxidal_audio::venue::VenueApplied>) {
        if let Ok(mut current) = self.venue.write() {
            *current = venue;
        }
    }
    pub(crate) fn current(&self) -> HostLevels {
        self.value.read().map(|v| *v).unwrap_or_default()
    }
    /// A MIDI master move persists the worker's confirmed gain fields. Other
    /// level updates retain their existing full-state save behavior.
    pub(crate) fn confirm(
        &self,
        command: oxidal_audio::tools::HostUtility,
        confirmed: HostLevels,
    ) -> Result<Option<HostLevels>, String> {
        use oxidal_audio::tools::HostUtility;
        let levels = match command {
            HostUtility::Levels { levels } => levels,
            HostUtility::OutputLevel { value } => {
                if confirmed.output_level_db != HostLevels::midi_output_db(value) {
                    return Err("The audio worker did not confirm the master level".into());
                }
                confirmed
            }
            _ => return Ok(None),
        };
        self.save(levels)?;
        Ok(Some(levels))
    }

    pub(crate) fn save(&self, levels: HostLevels) -> Result<(), String> {
        levels.validate()?;
        let mut value = self.value.write().map_err(|_| "Levels store unavailable")?;
        if *value == levels {
            return Ok(());
        }
        let parent = self.path.parent().ok_or("Levels file has no directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(&levels).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *value = levels;
        Ok(())
    }
}

/// Apply the controller to the currently sounding master. An unchanged step
/// needs neither a worker command nor a write to the unit's level file.
pub(crate) async fn midi_output(shared: &Shared, value: u8) -> Result<(), String> {
    if let Some(reason) = shared.protect.refuse(false) {
        return Err(reason.to_owned());
    }
    if shared.levels.current().output_level_db == HostLevels::midi_output_db(value) {
        return Ok(());
    }
    crate::player::send_utility(
        shared,
        oxidal_audio::tools::HostUtility::OutputLevel { value },
    )
    .await
    .map_err(|(_, reason)| reason)
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.levels.current()),
    )
        .into_response()
}
/// Sends levels to whichever engine is playing. Each supervisor stores them
/// after its worker confirms; a stopped unit just stores them for the next start.
pub(crate) async fn apply_running(shared: &Shared, levels: HostLevels) -> Result<(), String> {
    let _operation = shared.audio_change.operation().map_err(str::to_owned)?;
    use oxidal_audio::lifecycle::AudioPhase::Running;
    let command = oxidal_audio::tools::HostUtility::Levels { levels };
    let native = shared.playback.snapshot();
    if native.phase == Running {
        shared
            .playback
            .dispatch(oxidal_audio::lifecycle::AudioCommand {
                session: native.session,
                expected_revision: native.revision,
                action: oxidal_audio::lifecycle::AudioAction::HostUtility { command },
            })
            .await?;
    }
    let mixed = shared.rig_playback.snapshot();
    if mixed.phase == Running {
        shared
            .rig_playback
            .dispatch(oxidal_engine::protocol::RigAudioCommand {
                session: mixed.session,
                expected_revision: mixed.revision,
                action: oxidal_engine::protocol::RigAudioAction::HostUtility { command },
            })
            .await?;
    }
    let effects = shared.graph_playback.snapshot();
    if effects.phase == Running {
        shared
            .graph_playback
            .dispatch(oxidal_lv2::protocol::GraphAudioCommand {
                session: effects.session,
                expected_revision: effects.revision,
                action: oxidal_lv2::protocol::GraphAudioAction::HostUtility { command },
            })
            .await?;
    }
    Ok(())
}

/// One entry point for every view: live engines apply the levels at once, and
/// the unit store keeps them for every later start.
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<HostLevels>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(levels)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid levels");
    };
    // Trim and gate belong to the guitar, boost to the playing preset.
    let levels = HostLevels {
        boost_db: shared.levels.current().boost_db,
        ..shared.guitars.current().own(levels)
    };
    if let Err(e) = levels.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &e);
    }
    if let Err(e) = apply_running(&shared, levels).await {
        return failure(StatusCode::CONFLICT, &e);
    }
    let store = shared.levels.clone();
    match tokio::task::spawn_blocking(move || store.save(levels).map(|()| store.current())).await {
        Ok(Ok(levels)) => ([(header::CACHE_CONTROL, "no-store")], Json(levels)).into_response(),
        Ok(Err(e)) => failure(StatusCode::CONFLICT, &e),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Levels task failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxidal_audio::tools::HostUtility;

    #[test]
    fn repeated_midi_master_readback_keeps_the_same_level_file() {
        use std::os::unix::fs::MetadataExt;
        let root = std::env::temp_dir().join(format!("oxidal-midi-level-{}", std::process::id()));
        let path = root.join("levels.json");
        let store = Levels::load(path.clone());
        let command = HostUtility::OutputLevel { value: 0 };
        let confirmed = HostLevels {
            output_level_db: -60.0,
            input_trim_db: 4.0,
            mono: true,
            ..Default::default()
        };
        assert!(store.confirm(command, HostLevels::default()).is_err());
        assert!(!path.exists());
        assert_eq!(store.confirm(command, confirmed).unwrap(), Some(confirmed));
        let saved = std::fs::metadata(&path).unwrap();
        store.confirm(command, confirmed).unwrap();
        assert_eq!(saved.ino(), std::fs::metadata(&path).unwrap().ino());
        assert_eq!(Levels::load(path).current(), confirmed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
