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

/// Native engine diagnostics only: fixed daemon-owned files, no shell or client paths.
fn native_logs(root: &std::path::Path) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let mut output = format!("Oxidal {} native diagnostics\n", env!("CARGO_PKG_VERSION"));
    let pins: serde_json::Value =
        serde_json::from_str(include_str!("../../../native/tone3000/sources.json"))
            .unwrap_or_default();
    output.push_str(&format!(
        "TONE3000 source pin: {}\n",
        pins["tone3000"]["revision"]
            .as_str()
            .unwrap_or("unavailable")
    ));
    let roots = [
        ("Editor", "native-runtime"),
        ("Native playback", "audio-runtime"),
        ("Hybrid playback", "rig-runtime/playback"),
    ];
    let mut found = false;
    for (label, relative) in roots {
        let mut path = root.to_owned();
        let mut safe = true;
        let relative = format!("{relative}/user/.config/TONE3000/TONE3000.log");
        for component in std::path::Path::new(&relative).components() {
            path.push(component);
            match std::fs::symlink_metadata(&path) {
                Ok(meta) if !meta.file_type().is_symlink() => (),
                _ => {
                    safe = false;
                    break;
                }
            }
        }
        if !safe || !std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_file()) {
            continue;
        }
        let result = (|| -> std::io::Result<Vec<u8>> {
            let mut file = std::fs::File::open(&path)?;
            let meta = file.metadata()?;
            if !meta.file_type().is_file() {
                return Err(std::io::ErrorKind::InvalidInput.into());
            }
            file.seek(SeekFrom::Start(meta.len().saturating_sub(64 * 1024)))?;
            let mut bytes = Vec::new();
            file.take(64 * 1024).read_to_end(&mut bytes)?;
            Ok(bytes)
        })();
        if let Ok(bytes) = result {
            found = true;
            output.push_str(&format!("\n--- {label}: recent log ---\n"));
            output.push_str(&String::from_utf8_lossy(&bytes));
            output.push('\n');
        }
    }
    if !found {
        output.push_str("\nNo native engine logs have been created on this device.\n");
    }
    output
}
pub(super) async fn logs(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    match tokio::task::spawn_blocking(move || native_logs(&root)).await {
        Ok(text) => (
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=oxidal-logs.txt",
                ),
            ],
            text,
        )
            .into_response(),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Native logs are temporarily unavailable",
        ),
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
