//! Explicit five-minute debug mode. Execution never occurs inside the web/audio daemon.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_debug::{Command, State as DebugState};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
#[derive(Debug)]
struct Inner {
    state: DebugState,
    enabled_until: Option<Instant>,
    socket: Option<PathBuf>,
}
#[derive(Debug)]
pub(super) struct DebugBridge {
    inner: Arc<Mutex<Inner>>,
}
impl Inner {
    fn view(&self) -> DebugState {
        let mut state = self.state.clone();
        state.remaining_seconds = self
            .enabled_until
            .map(|t| t.saturating_duration_since(Instant::now()).as_secs())
            .unwrap_or(0);
        state.enabled = state.remaining_seconds > 0;
        state
    }
    async fn exchange(&mut self, command: Command) -> Result<(), String> {
        let path = self
            .socket
            .as_ref()
            .ok_or("Debug service is unavailable on this host")?;
        #[cfg(unix)]
        let reply = oxidal_debug::ipc::request(path, &command)
            .await
            .map_err(str::to_owned)?;
        #[cfg(not(unix))]
        let reply: oxidal_debug::Reply = return Err("Debug service requires Linux".into());
        match (reply.state, reply.error) {
            (Some(mut state), None) => {
                // Keep the final result in daemon memory while the isolated executor restarts.
                if state.job.is_none() {
                    state.job = self.state.job.clone().filter(|j| j.phase != "running");
                }
                self.state = state;
                Ok(())
            }
            (_, Some(error)) => Err(error),
            _ => Err("Invalid debug response".into()),
        }
    }
}
impl DebugBridge {
    pub fn new(socket: Option<PathBuf>) -> Self {
        let inner = Arc::new(Mutex::new(Inner {
            socket,
            enabled_until: None,
            state: DebugState {
                message: "Debug service is unavailable on this host".into(),
                ..Default::default()
            },
        }));
        let weak = Arc::downgrade(&inner);
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_millis(500));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                let Some(inner) = weak.upgrade() else { break };
                let mut inner = inner.lock().await;
                let running = inner
                    .state
                    .job
                    .as_ref()
                    .is_some_and(|j| j.phase == "running");
                if running && !inner.view().enabled {
                    let id = inner.state.job.as_ref().unwrap().id.clone();
                    let _ = inner.exchange(Command::Cancel { id }).await;
                }
                if (running || inner.view().enabled)
                    && let Err(error) = inner.exchange(Command::Status {}).await
                {
                    inner.state.message = error;
                }
            }
        });
        Self { inner }
    }
    async fn dispatch(&self, command: Command) -> Result<DebugState, String> {
        command.validate().map_err(str::to_owned)?;
        let mut inner = self.inner.lock().await;
        match command {
            Command::Status {} => {
                if inner.socket.is_some()
                    && let Err(error) = inner.exchange(Command::Status {}).await
                {
                    inner.state.message = error;
                }
            }
            Command::Enable {} => {
                inner.exchange(Command::Status {}).await?;
                inner.enabled_until = Some(Instant::now() + Duration::from_secs(300));
            }
            Command::Disable {} => {
                inner.enabled_until = None;
                if let Some(job) = &inner.state.job
                    && job.phase == "running"
                {
                    let id = job.id.clone();
                    inner.exchange(Command::Cancel { id }).await?;
                }
            }
            Command::Run { .. } => {
                if !inner.view().enabled {
                    return Err("Enable debug mode before running a command".into());
                }
                inner.exchange(command).await?;
            }
            Command::Cancel { .. } => {
                inner.exchange(command).await?;
            }
        }
        Ok(inner.view())
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    respond(shared.debug.dispatch(Command::Status {}).await)
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<Command>, JsonRejection>,
) -> Response {
    match body {
        Ok(Json(command)) => respond(shared.debug.dispatch(command).await),
        Err(_) => failure(StatusCode::BAD_REQUEST, "Invalid debug command"),
    }
}
fn respond(result: Result<DebugState, String>) -> Response {
    match result {
        Ok(state) => ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response(),
        Err(error) => failure(StatusCode::CONFLICT, &error),
    }
}
