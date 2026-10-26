//! Serialized process IPC keeps JUCE and all native file/loader work outside the HTTP runtime.
use crate::{Config, Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_tone3000::protocol::{EditorCommand, WorkerReply, WorkerRequest};
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
};

#[derive(Debug)]
pub(super) struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Worker {
    pub fn start(config: &Config) -> Result<Option<Self>, String> {
        let Some(path) = &config.native_worker else {
            return Ok(None);
        };
        if !path.is_absolute() || !path.is_file() {
            return Err("Native worker must be an existing absolute executable".into());
        }
        std::fs::create_dir_all(&config.preset_dir).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(&config.preset_dir).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(path)
            .env("OXIDAL_PRESET_DIR", root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(Some(Self {
            input: child.stdin.take().ok_or("worker stdin")?,
            output: BufReader::new(child.stdout.take().ok_or("worker stdout")?),
            child,
        }))
    }
    async fn call(&mut self, request: WorkerRequest) -> Result<WorkerReply, String> {
        let result = tokio::time::timeout(Duration::from_secs(25), async {
            let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
            if bytes.len() > 65535 {
                return Err("Native request too large".into());
            }
            bytes.push(b'\n');
            self.input
                .write_all(&bytes)
                .await
                .map_err(|e| e.to_string())?;
            self.input.flush().await.map_err(|e| e.to_string())?;
            let mut reply = vec![];
            (&mut self.output)
                .take(256 * 1024 + 1)
                .read_until(b'\n', &mut reply)
                .await
                .map_err(|e| e.to_string())?;
            if reply.is_empty() || reply.len() > 256 * 1024 || reply.last() != Some(&b'\n') {
                return Err("Invalid native response size".into());
            }
            serde_json::from_slice(&reply).map_err(|e| format!("Invalid native response: {e}"))
        })
        .await
        .map_err(|_| "Native request timed out; outcome unknown".to_owned())
        .and_then(|r| r);
        if result.is_err() {
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
        result
    }
}
async fn dispatch(shared: Arc<Shared>, request: WorkerRequest) -> Response {
    // Allow an in-flight status read to finish before an edit. Revision/session checks
    // still reject stale mutations; bounded admission avoids an unbounded request queue.
    let Ok(mut worker) = tokio::time::timeout(Duration::from_secs(2), shared.native.lock()).await
    else {
        return failure(StatusCode::CONFLICT, "native_busy");
    };
    let Some(active) = worker.as_mut() else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Native editor unavailable in this build or requires restart",
        );
    };
    match active.call(request).await {
        Ok(WorkerReply::State(state)) => Json(state).into_response(),
        Ok(WorkerReply::Error { error }) => failure(StatusCode::CONFLICT, &error),
        Err(_) => {
            *worker = None;
            failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Native worker stopped; outcome unknown. Restart and reload before editing; do not replay commands.",
            )
        }
    }
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    dispatch(shared, WorkerRequest::State).await
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<EditorCommand>, JsonRejection>,
) -> Response {
    match body {
        Ok(Json(command)) => dispatch(shared, WorkerRequest::Command { command }).await,
        Err(e) => failure(e.status(), "invalid_native_command"),
    }
}
