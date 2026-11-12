//! Oxidal's input tuner over HTTP. It listens to the raw input of whichever
//! audio owner is running, so it works under every preset.
//! @see docs/audio.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::{
    lifecycle::AudioPhase,
    tools::{HostState, HostUtility, TunerReading},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// What the tuner view shows.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TunerState {
    /// Audio is running, so there is an input to listen to.
    pub available: bool,
    pub enabled: bool,
    /// The outputs are muted (the tuner mutes them by default).
    pub output_muted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<TunerReading>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TunerUpdate {
    pub enabled: bool,
    /// Also mute or unmute the outputs; omitted leaves them alone.
    #[serde(default)]
    pub output_muted: Option<bool>,
}

fn host(shared: &Shared) -> Option<HostState> {
    let native = shared.playback.snapshot();
    let telemetry = if native.phase == AudioPhase::Running {
        shared.playback.telemetry().map(|t| t.0)
    } else {
        let rig = shared.rig_playback.snapshot();
        if rig.phase == AudioPhase::Running {
            rig.telemetry
        } else {
            let graph = shared.graph_playback.snapshot();
            (graph.phase == AudioPhase::Running)
                .then_some(graph.telemetry)
                .flatten()
        }
    };
    telemetry?.monitoring
}

fn running(shared: &Shared) -> bool {
    [
        shared.playback.snapshot().phase,
        shared.rig_playback.snapshot().phase,
        shared.graph_playback.snapshot().phase,
    ]
    .contains(&AudioPhase::Running)
}

fn current(shared: &Shared) -> TunerState {
    let host = host(shared);
    TunerState {
        available: running(shared),
        enabled: host.is_some_and(|h| h.tuner_enabled),
        output_muted: host.is_some_and(|h| h.output_muted),
        reading: host.filter(|h| h.tuner_enabled).and_then(|h| h.tuner),
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(current(&shared)),
    )
        .into_response()
}

/// Starts or stops listening. Allowed under Protect: it changes nothing saved.
pub(super) async fn update(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<TunerUpdate>, JsonRejection>,
) -> Response {
    let Ok(Json(update)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid tuner request");
    };
    let refused = |_| {
        failure(
            StatusCode::CONFLICT,
            "Play a preset to use the tuner: it listens to the guitar input while audio runs.",
        )
    };
    if let Err(error) = crate::player::send_utility(
        &shared,
        HostUtility::Tuner {
            enabled: update.enabled,
        },
    )
    .await
    {
        return refused(error);
    }
    if let Some(enabled) = update.output_muted
        && let Err(error) =
            crate::player::send_utility(&shared, HostUtility::OutputMute { enabled }).await
    {
        return refused(error);
    }
    let mut state = current(&shared);
    // Telemetry is a moment behind the command just sent.
    state.enabled = update.enabled;
    if let Some(muted) = update.output_muted {
        state.output_muted = muted;
    }
    Json(state).into_response()
}
