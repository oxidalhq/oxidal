//! Redacted control-request history. Acceptance is not confirmation of DSP application.
use crate::Shared;
use axum::{
    Json,
    extract::{MatchedPath, Request, State},
    http::{Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

const CAPACITY: u64 = 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuditRecord {
    pub schema: u8,
    pub requested_at_ms: u64,
    pub completed_at_ms: u64,
    pub operation: Operation,
    pub outcome: Outcome,
    pub http_status: u16,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    NativeAudio,
    MixedAudio,
    EffectsAudio,
    EffectPacks,
    Storage,
    Network,
    Account,
    NativeEditor,
    NativeDefaults,
    PresetImport,
    PresetLibrary,
    RigSave,
    ModelImport,
    ModelCollection,
    ModelDownload,
    Controls,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Accepted,
    Rejected,
    Failed,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct AuditHistory {
    pub records: Vec<AuditRecord>,
    pub dropped_records: u64,
    pub skipped_records: u64,
    pub storage_error: bool,
    pub storage_limit_bytes: u64,
}
#[derive(Debug)]
pub(super) struct Audit {
    sender: tokio::sync::mpsc::Sender<AuditRecord>,
    store: Arc<Store>,
}
#[derive(Debug)]
struct Store {
    root: PathBuf,
    lock: std::sync::Mutex<()>,
    dropped: AtomicU64,
    failed: AtomicBool,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
impl Audit {
    pub fn new(root: PathBuf) -> Self {
        let store = Arc::new(Store {
            root,
            lock: std::sync::Mutex::new(()),
            dropped: AtomicU64::new(0),
            failed: AtomicBool::new(false),
        });
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<AuditRecord>(64);
        let writer = store.clone();
        tokio::spawn(async move {
            while let Some(record) = receiver.recv().await {
                let store = writer.clone();
                let failed = !matches!(
                    tokio::task::spawn_blocking(move || store.append(&record)).await,
                    Ok(Ok(()))
                );
                writer.failed.store(failed, Ordering::Relaxed);
                if failed {
                    writer.dropped.fetch_add(1, Ordering::Relaxed);
                }
            }
        });
        Self { sender, store }
    }
    fn record(&self, record: AuditRecord) {
        if self.sender.try_send(record).is_err() {
            self.store.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}
impl Store {
    fn file(&self, index: u8) -> PathBuf {
        self.root.join(format!("requests-{index}.jsonl"))
    }
    fn append(&self, record: &AuditRecord) -> io::Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| io::Error::other("audit lock"))?;
        std::fs::create_dir_all(&self.root)?;
        let bytes = serde_json::to_vec(record)?;
        let size = match std::fs::metadata(self.file(0)) {
            Ok(m) => m.len(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
            Err(e) => return Err(e),
        };
        if size + bytes.len() as u64 + 2 > CAPACITY {
            std::fs::rename(self.file(0), self.file(1))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.file(0))?;
        file.write_all(b"\n")?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.flush()
    }
    fn read(&self) -> io::Result<AuditHistory> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| io::Error::other("audit lock"))?;
        let mut records = Vec::new();
        let mut skipped_records = 0;
        for index in [1, 0] {
            let file = match std::fs::File::open(self.file(index)) {
                Ok(f) => f,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            for line in io::BufReader::new(file.take(CAPACITY)).split(b'\n') {
                let line = line?;
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_slice::<AuditRecord>(&line) {
                    Ok(record) if record.schema == 1 => records.push(record),
                    _ => skipped_records += 1,
                }
            }
        }
        records.reverse();
        Ok(AuditHistory {
            records,
            skipped_records,
            dropped_records: self.dropped.load(Ordering::Relaxed),
            storage_error: self.failed.load(Ordering::Relaxed),
            storage_limit_bytes: CAPACITY * 2,
        })
    }
}
// Exact route allowlist: never persist user paths, bodies, query strings or headers.
fn operation(path: &str) -> Option<Operation> {
    Some(match path.strip_prefix("/api/v1").unwrap_or(path) {
        "/audio" => Operation::NativeAudio,
        "/rig-audio" => Operation::MixedAudio,
        "/graph-audio" => Operation::EffectsAudio,
        "/packs/{id}/{action}" => Operation::EffectPacks,
        "/device/storage" => Operation::Storage,
        "/device/network" => Operation::Network,
        "/account/tone3000" => Operation::Account,
        "/native" => Operation::NativeEditor,
        "/native/defaults" => Operation::NativeDefaults,
        "/presets" => Operation::PresetImport,
        "/presets/catalog" => Operation::PresetLibrary,
        "/presets/rigs" => Operation::RigSave,
        "/models/local" => Operation::ModelImport,
        "/models/local/collection" => Operation::ModelCollection,
        "/tone3000/stage" => Operation::ModelDownload,
        "/commands" => Operation::Controls,
        _ => return None,
    })
}
pub(super) async fn capture(
    State(shared): State<Arc<Shared>>,
    request: Request,
    next: Next,
) -> Response {
    let operation = if request.method() == Method::POST {
        request
            .extensions()
            .get::<MatchedPath>()
            .and_then(|p| operation(p.as_str()))
    } else {
        None
    };
    let requested_at_ms = now();
    let response = next.run(request).await;
    if let Some(operation) = operation {
        let status = response.status();
        shared.audit.record(AuditRecord {
            schema: 1,
            requested_at_ms,
            completed_at_ms: now(),
            operation,
            outcome: if status.is_success() {
                Outcome::Accepted
            } else if status.is_server_error() {
                Outcome::Failed
            } else {
                Outcome::Rejected
            },
            http_status: status.as_u16(),
        });
    }
    response
}
pub(super) async fn history(State(shared): State<Arc<Shared>>) -> Response {
    read(shared, false).await
}
pub(super) async fn export(State(shared): State<Arc<Shared>>) -> Response {
    read(shared, true).await
}
async fn read(shared: Arc<Shared>, export: bool) -> Response {
    let store = shared.audit.store.clone();
    match tokio::task::spawn_blocking(move || store.read()).await {
        Ok(Ok(history)) => {
            let mut response =
                ([(header::CACHE_CONTROL, "no-store")], Json(history)).into_response();
            if export {
                response.headers_mut().insert(
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=control-audit.json".parse().unwrap(),
                );
            }
            response
        }
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(crate::ApiError {
                error: "Control audit is unavailable".into(),
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_recovers_and_bounds_retention() {
        let root =
            std::env::temp_dir().join(format!("oxidal-audit-{}-{}", std::process::id(), now()));
        let store = Store {
            root: root.clone(),
            lock: std::sync::Mutex::new(()),
            dropped: AtomicU64::new(0),
            failed: AtomicBool::new(false),
        };
        let record = AuditRecord {
            schema: 1,
            requested_at_ms: 1,
            completed_at_ms: 2,
            operation: Operation::Network,
            outcome: Outcome::Rejected,
            http_status: 400,
        };
        store.append(&record).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(store.file(0))
            .unwrap()
            .write_all(b"partial")
            .unwrap();
        store.append(&record).unwrap();
        assert_eq!(store.read().unwrap().records.len(), 2);
        assert_eq!(store.read().unwrap().skipped_records, 1);
        for _ in 0..3 {
            std::fs::OpenOptions::new()
                .write(true)
                .open(store.file(0))
                .unwrap()
                .set_len(CAPACITY)
                .unwrap();
            store.append(&record).unwrap();
        }
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        assert_eq!(store.read().unwrap().records[0].http_status, 400);
        assert!(operation("/terminal/admin").is_none());
        assert!(operation("/device/network?password=secret").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
