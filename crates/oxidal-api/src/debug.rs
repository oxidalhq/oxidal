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
use tokio::sync::{Mutex, watch};
#[derive(Debug)]
struct Inner {
    state: DebugState,
    enabled_until: Option<Instant>,
    socket: Option<PathBuf>,
    updates: watch::Sender<DebugState>,
}
#[derive(Debug)]
pub(super) struct DebugBridge {
    inner: Arc<Mutex<Inner>>,
    snapshot: watch::Receiver<DebugState>,
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
        let initial = DebugState {
            message: "Debug service is unavailable on this host".into(),
            ..Default::default()
        };
        let (updates, snapshot) = watch::channel(initial.clone());
        let inner = Arc::new(Mutex::new(Inner {
            socket,
            enabled_until: None,
            state: initial,
            updates,
        }));
        let weak = Arc::downgrade(&inner);
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_millis(500));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut idle_ticks = 0u8;
            loop {
                timer.tick().await;
                idle_ticks = (idle_ticks + 1) % 10;
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
                if inner.socket.is_some()
                    && (running
                        || inner.view().enabled
                        || !inner.state.available
                        || idle_ticks == 0)
                    && let Err(error) = inner.exchange(Command::Status {}).await
                {
                    inner.state.message = error;
                }
                inner.updates.send_replace(inner.view());
            }
        });
        Self { inner, snapshot }
    }
    fn state(&self) -> DebugState {
        self.snapshot.borrow().clone()
    }
    async fn dispatch(&self, command: Command) -> Result<DebugState, String> {
        command.validate().map_err(str::to_owned)?;
        if matches!(command, Command::Status {}) {
            return Ok(self.state());
        }
        let mut inner = self.inner.lock().await;
        match command {
            Command::Status {} => unreachable!("status uses the nonblocking snapshot"),
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
        let state = inner.view();
        inner.updates.send_replace(state.clone());
        Ok(state)
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    respond(Ok(shared.debug.state()))
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn status_returns_confirmed_snapshot_while_executor_owner_is_busy() {
        let bridge = DebugBridge::new(None);
        let mut owner = bridge.inner.lock().await;
        owner.state.identity = "confirmed worker".into();
        owner.updates.send_replace(owner.view());
        // A slow IPC exchange holds this same owner lock. Both status routes must
        // still answer without adding a second helper deadline to the caller.
        let view = tokio::time::timeout(
            Duration::from_millis(100),
            bridge.dispatch(Command::Status {}),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(view.identity, "confirmed worker");
        assert_eq!(bridge.state().identity, "confirmed worker");
        assert!(!view.enabled);
    }
}
