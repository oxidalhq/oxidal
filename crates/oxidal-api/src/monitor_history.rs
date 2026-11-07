//! Bounded appliance history. Filesystem work never runs in a worker or meter sampler.
use crate::{Shared, monitor::Monitoring};
use axum::{Json, extract::State, http::header, response::IntoResponse};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const FILE_BYTES: u64 = 2 * 1024 * 1024;
const FILE_COUNT: usize = 4;
const MAX_RECORD_BYTES: usize = 16 * 1024;
const PAGE_RECORDS: usize = 720;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub schema: u8,
    pub recorded_at_ms: u64,
    pub recorder_session: String,
    pub elapsed_ms: u64,
    pub audio_session: Option<String>,
    pub readings: Monitoring,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub records: Vec<Record>,
    pub interval_seconds: u64,
    pub storage_limit_bytes: u64,
    pub skipped_records: u64,
    pub dropped_samples: u64,
    pub storage_error: bool,
}
#[derive(Debug)]
pub(super) struct Journal {
    root: PathBuf,
    lock: Mutex<()>,
    dropped: AtomicU64,
    failed: std::sync::atomic::AtomicBool,
}
impl Journal {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
            dropped: AtomicU64::new(0),
            failed: false.into(),
        }
    }
    fn file(&self, index: usize) -> PathBuf {
        self.root.join(format!("monitor-{index}.jsonl"))
    }
    fn append(&self, record: &Record) -> io::Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| io::Error::other("history lock"))?;
        fs::create_dir_all(&self.root)?;
        let bytes = serde_json::to_vec(record)?;
        if bytes.len() >= MAX_RECORD_BYTES {
            return Err(io::Error::other("history record size"));
        }
        let size = match fs::metadata(self.file(0)) {
            Ok(m) => m.len(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
            Err(e) => return Err(e),
        };
        if size + bytes.len() as u64 + 2 > FILE_BYTES {
            for index in (1..FILE_COUNT).rev() {
                match fs::rename(self.file(index - 1), self.file(index)) {
                    Ok(()) => (),
                    Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e),
                }
            }
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.file(0))?;
        // Separate a previous interrupted append from this complete record.
        file.write_all(b"\n")?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.flush()
    }
    fn read(&self) -> io::Result<History> {
        self.read_limit(PAGE_RECORDS)
    }
    fn read_limit(&self, limit: usize) -> io::Result<History> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| io::Error::other("history lock"))?;
        let mut records = VecDeque::new();
        let mut skipped = 0;
        for index in (0..FILE_COUNT).rev() {
            let file = match fs::File::open(self.file(index)) {
                Ok(f) => f,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            // A modified/oversized file cannot force an unbounded read or allocation.
            let reader = BufReader::new(file.take(FILE_BYTES));
            for line in reader.split(b'\n') {
                let line = line?;
                if line.is_empty() {
                    continue;
                }
                if line.len() > MAX_RECORD_BYTES {
                    skipped += 1;
                    continue;
                }
                match serde_json::from_slice::<Record>(&line) {
                    Ok(record) if record.schema == 1 => {
                        if records.len() == limit {
                            records.pop_front();
                        }
                        records.push_back(record);
                    }
                    _ => skipped += 1,
                }
            }
        }
        Ok(History {
            records: records.into(),
            interval_seconds: 5,
            storage_limit_bytes: FILE_BYTES * FILE_COUNT as u64,
            skipped_records: skipped,
            dropped_samples: self.dropped.load(Ordering::Relaxed),
            storage_error: self.failed.load(Ordering::Relaxed),
        })
    }
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub(super) fn start(shared: std::sync::Weak<Shared>) {
    let Some(owner) = shared.upgrade() else {
        return;
    };
    let journal = owner.history.clone();
    drop(owner);
    let (sender, mut receiver) = tokio::sync::mpsc::channel::<Record>(2);
    let writer = journal.clone();
    tokio::spawn(async move {
        while let Some(record) = receiver.recv().await {
            let journal = writer.clone();
            let result = tokio::task::spawn_blocking(move || journal.append(&record)).await;
            let failed = !matches!(result, Ok(Ok(())));
            writer.failed.store(failed, Ordering::Relaxed);
            if failed {
                writer.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    });
    tokio::spawn(async move {
        let began = Instant::now();
        let session = format!("{}-{}", timestamp(), std::process::id());
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(owner) = shared.upgrade() else {
                break;
            };
            let mut readings = owner.monitor.borrow().clone();
            if readings.sequence == 0 {
                continue;
            }
            // Error messages may contain paths or provider data: persist metrics only.
            readings.error = None;
            let audio_session = match readings.source.as_deref() {
                Some("Saved preset") => Some(owner.playback.snapshot().session),
                Some("LV2 graph") => Some(owner.graph_playback.snapshot().session),
                Some("Mixed rig") => Some(owner.rig_playback.snapshot().session),
                _ => None,
            };
            let record = Record {
                schema: 1,
                recorded_at_ms: timestamp(),
                recorder_session: session.clone(),
                elapsed_ms: began.elapsed().as_millis() as u64,
                audio_session,
                readings,
            };
            if sender.try_send(record).is_err() {
                journal.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    });
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let journal = shared.history.clone();
    let result = tokio::task::spawn_blocking(move || journal.read()).await;
    match result {
        Ok(Ok(history)) => ([(header::CACHE_CONTROL, "no-store")], Json(history)).into_response(),
        _ => crate::failure(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Monitoring history is unavailable; live audio is unaffected",
        ),
    }
}

/// Download all retained, validated records; never expose corrupt raw lines or other files.
pub(super) async fn export(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let journal = shared.history.clone();
    let result = tokio::task::spawn_blocking(move || journal.read_limit(usize::MAX)).await;
    match result {
        Ok(Ok(history)) => (
            [
                (header::CACHE_CONTROL, "no-store"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=monitor-history.json",
                ),
            ],
            Json(history),
        )
            .into_response(),
        _ => crate::failure(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Monitoring history export is unavailable",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_survives_restart_skips_corruption_and_rotates() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-monitor-{}-{}",
            std::process::id(),
            timestamp()
        ));
        let journal = Journal::new(root.clone());
        let record = Record {
            schema: 1,
            recorded_at_ms: 1,
            recorder_session: "test".into(),
            elapsed_ms: 1,
            audio_session: Some("worker".into()),
            readings: Monitoring::default(),
        };
        journal.append(&record).unwrap();
        OpenOptions::new()
            .append(true)
            .open(journal.file(0))
            .unwrap()
            .write_all(b"broken\n")
            .unwrap();
        let reopened = Journal::new(root.clone());
        assert_eq!(reopened.read().unwrap().records.len(), 1);
        assert_eq!(reopened.read().unwrap().skipped_records, 1);
        for _ in 0..5 {
            OpenOptions::new()
                .write(true)
                .open(journal.file(0))
                .unwrap()
                .set_len(FILE_BYTES)
                .unwrap();
            journal.append(&record).unwrap();
        }
        assert!(!journal.file(FILE_COUNT).exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), FILE_COUNT);
        assert!(reopened.read().unwrap().records.len() <= PAGE_RECORDS);
        fs::remove_dir_all(root).unwrap();
    }
}
