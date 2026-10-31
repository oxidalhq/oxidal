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
    sync::Mutex,
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
        let runtime = root.join("native-runtime");
        std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        let mut child = tokio::process::Command::new(path)
            .env("OXIDAL_PRESET_DIR", root)
            .env("OXIDAL_QUALIFICATION_DATA", runtime)
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
                .take((oxidal_audio::lifecycle::PLAYBACK_FRAME_BYTES + 1) as u64)
                .read_until(b'\n', &mut reply)
                .await
                .map_err(|e| e.to_string())?;
            if reply.is_empty()
                || reply.len() > oxidal_audio::lifecycle::PLAYBACK_FRAME_BYTES
                || reply.last() != Some(&b'\n')
            {
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
    let access = shared.library_access.clone().read_owned().await;
    exchange(shared.native.clone(), request, Some(access)).await
}
async fn exchange(
    worker: Arc<Mutex<Option<Worker>>>,
    request: WorkerRequest,
    access: Option<tokio::sync::OwnedRwLockReadGuard<()>>,
) -> Response {
    // Complete each written request/reply pair even when HTTP navigation/disconnect
    // cancels its caller. Otherwise the next request would consume the abandoned
    // reply, losing revision and command identity across the IPC stream.
    tokio::spawn(async move {
        let _access = access;
        dispatch_owned(worker, request).await
    })
    .await
    .unwrap_or_else(|_| {
        failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Native exchange interrupted",
        )
    })
}
async fn dispatch_owned(worker: Arc<Mutex<Option<Worker>>>, request: WorkerRequest) -> Response {
    // Allow an in-flight status read to finish before an edit. Revision/session checks
    // still reject stale mutations; bounded admission avoids an unbounded request queue.
    let Ok(mut worker) = tokio::time::timeout(Duration::from_secs(2), worker.lock()).await else {
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn abandoned_http_call_still_consumes_its_own_native_reply() {
        let mut child = tokio::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(r#"i=0; while IFS= read -r request; do i=$((i+1)); printf 'received\n' >&2; sleep 0.1; printf '{"kind":"error","error":"reply-%s"}\n' "$i"; done"#)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true).spawn().unwrap();
        let mut received = BufReader::new(child.stderr.take().unwrap());
        let worker = Arc::new(Mutex::new(Some(Worker {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        })));
        let library_access = Arc::new(tokio::sync::RwLock::new(()));
        let access = library_access.clone().read_owned().await;
        let first_worker = worker.clone();
        let first = tokio::spawn(async move {
            exchange(first_worker, WorkerRequest::State, Some(access)).await
        });
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(5), received.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        first.abort();
        let _ = first.await;
        // A cancelled HTTP task cannot release library protection while the
        // accepted worker operation can still read or publish preset files.
        assert!(library_access.try_write().is_err());
        let second = exchange(worker.clone(), WorkerRequest::State, None).await;
        let bytes = axum::body::to_bytes(second.into_body(), 1024)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "reply-2");
        assert!(library_access.try_write().is_ok());
        let mut guard = worker.lock().await;
        let active = guard.as_mut().unwrap();
        active.child.kill().await.unwrap();
        active.child.wait().await.unwrap();
    }
}
