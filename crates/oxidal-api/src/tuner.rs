//! Oxidal's input tuner over HTTP. It listens to the raw input of whichever
//! audio owner is running, so it works under every preset. With nothing
//! playing it opens the interface itself: a silent pass-through session that
//! ends when the tuner closes or its view stops asking.
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
use oxidal_lv2::protocol::{GraphAudioAction, GraphAudioCommand, StartGraph};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// The tuner's own audio session, when it had to open the interface.
#[derive(Debug, Default)]
pub struct Standalone {
    /// Effects-host session id of the tuner's session, and the last time its
    /// view asked for a reading.
    session: Mutex<Option<(String, Instant)>>,
}
impl Standalone {
    fn id(&self) -> Option<String> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|(id, _)| id.clone())
    }
    fn touch(&self) {
        if let Some((_, seen)) = self.session.lock().unwrap().as_mut() {
            *seen = Instant::now();
        }
    }
    fn idle(&self) -> Option<Duration> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|(_, seen)| seen.elapsed())
    }
}
/// A view that vanished without closing must not hold the interface.
const ABANDONED: Duration = Duration::from_secs(15);

/// Whether the tuner's own session is the audio that is running.
fn standalone(shared: &Shared) -> bool {
    let graph = shared.graph_playback.snapshot();
    graph.phase == AudioPhase::Running && shared.tuner.id().is_some_and(|id| id == graph.session)
}

/// Opens the interface for the tuner alone: input straight to a muted output.
async fn start_standalone(shared: &Arc<Shared>) -> Result<(), String> {
    let stream = crate::midi_recall::stream(shared)
        .ok_or("Choose the input, output and buffer in Settings → Audio first")?;
    let graph = shared.graph_playback.snapshot();
    let node = |id: &str, kind| oxidal_graph::Node {
        id: id.into(),
        kind,
        level: 1.0,
    };
    let settings = StartGraph {
        library_id: None,
        name: Some("Tuner".into()),
        recall: None,
        stream,
        bindings: vec![],
        rig: oxidal_graph::Rig {
            nodes: vec![
                node("in", oxidal_graph::BlockKind::Input),
                node("out", oxidal_graph::BlockKind::Output),
            ],
            edges: vec![oxidal_graph::Edge {
                from: "in".into(),
                to: "out".into(),
            }],
        },
    };
    let started = shared
        .graph_playback
        .dispatch(GraphAudioCommand {
            session: graph.session,
            expected_revision: graph.revision,
            action: GraphAudioAction::Start {
                settings: Box::new(settings),
            },
        })
        .await?;
    *shared.tuner.session.lock().unwrap() = Some((started.session, Instant::now()));
    let watch = shared.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            match watch.tuner.idle() {
                None => return,
                Some(idle) if idle > ABANDONED => {
                    stop_standalone(&watch).await;
                    return;
                }
                Some(_) => {}
            }
        }
    });
    Ok(())
}

/// Ends the tuner's own session, unless a preset has taken the interface.
async fn stop_standalone(shared: &Shared) {
    let Some((id, _)) = shared.tuner.session.lock().unwrap().take() else {
        return;
    };
    let graph = shared.graph_playback.snapshot();
    if graph.session == id && graph.phase == AudioPhase::Running {
        let _ = shared
            .graph_playback
            .dispatch(GraphAudioCommand {
                session: graph.session,
                expected_revision: graph.revision,
                action: GraphAudioAction::Stop,
            })
            .await;
    }
}

/// What the tuner view shows.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TunerState {
    /// Audio is running, so there is an input to listen to.
    pub available: bool,
    /// The tuner opened the interface itself: nothing else is playing, so
    /// there is no sound to hear.
    #[serde(default)]
    pub standalone: bool,
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
        standalone: standalone(shared),
        enabled: host.is_some_and(|h| h.tuner_enabled),
        output_muted: host.is_some_and(|h| h.output_muted),
        reading: host.filter(|h| h.tuner_enabled).and_then(|h| h.tuner),
    }
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    shared.tuner.touch();
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
    if !update.enabled && standalone(&shared) {
        stop_standalone(&shared).await;
        return Json(current(&shared)).into_response();
    }
    let alone = if update.enabled && !running(&shared) {
        if let Err(error) = start_standalone(&shared).await {
            return failure(
                StatusCode::CONFLICT,
                &format!("The tuner could not open the audio interface: {error}"),
            );
        }
        true
    } else {
        standalone(&shared)
    };
    let refused = |(_, error): (StatusCode, String)| failure(StatusCode::CONFLICT, &error);
    // Its own session passes the guitar straight through, so it stays muted.
    let muted = if alone {
        Some(true)
    } else {
        update.output_muted
    };
    if let Some(enabled) = muted
        && let Err(error) =
            crate::player::send_utility(&shared, HostUtility::OutputMute { enabled }).await
    {
        return refused(error);
    }
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
    let mut state = current(&shared);
    // Telemetry is a moment behind the command just sent.
    state.available = true;
    state.enabled = update.enabled;
    if let Some(muted) = muted {
        state.output_muted = muted;
    }
    Json(state).into_response()
}
