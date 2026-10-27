//! Decimated monitoring outside worker/audio threads. Unsupported host values stay null.
use crate::Shared;
use axum::{Json, extract::State, http::header, response::IntoResponse};
use oxidal_audio::{StreamConfig, lifecycle::AudioPhase, meter::Snapshot};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::Read,
    sync::{Arc, Weak},
    time::{Duration, Instant},
};
use tokio::sync::watch;
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Host {
    pub cpu_percent: Option<f64>,
    pub memory_used_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub temperature_c: Option<f64>,
    pub temperature_sensor: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Monitoring {
    pub sequence: u64,
    pub host: Host,
    pub audio_phase: String,
    pub graph_phase: String,
    pub rig_phase: String,
    pub source: Option<String>,
    pub stream: Option<StreamConfig>,
    pub audio: Option<Snapshot>,
    pub audio_age_ms: Option<u64>,
    /// Transport currently fails closed on xruns; a cumulative recovery counter is not available.
    pub xruns: Option<u64>,
    pub error: Option<String>,
}
fn text(path: &str) -> Option<String> {
    let mut s = String::new();
    File::open(path)
        .ok()?
        .take(65536)
        .read_to_string(&mut s)
        .ok()?;
    Some(s)
}
fn cpu(text: &str) -> Option<(u64, u64)> {
    let mut parts = text.lines().next()?.split_whitespace();
    if parts.next() != Some("cpu") {
        return None;
    }
    // guest/guest_nice are already included in user/nice: do not count them twice.
    let values = parts
        .take(8)
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if values.len() < 4 {
        return None;
    }
    Some((
        values.iter().sum(),
        values[3] + values.get(4).copied().unwrap_or(0),
    ))
}
fn memory(text: &str) -> Option<(u64, u64)> {
    let value = |key: &str| {
        text.lines().find_map(|l| {
            let mut p = l.split_whitespace();
            if p.next()? != key {
                return None;
            }
            p.next()?.parse::<u64>().ok()?.checked_mul(1024)
        })
    };
    let total = value("MemTotal:")?;
    Some((total.saturating_sub(value("MemAvailable:")?), total))
}
fn sample(previous: Option<(u64, u64)>) -> (Host, Option<(u64, u64)>) {
    let current = text("/proc/stat").as_deref().and_then(cpu);
    let percent = match (previous, current) {
        (Some((a, b)), Some((c, d))) if c > a && d >= b => {
            Some(100.0 * (1.0 - ((d - b) as f64 / (c - a) as f64)).clamp(0.0, 1.0))
        }
        _ => None,
    };
    let mem = text("/proc/meminfo").as_deref().and_then(memory);
    let mut host = Host {
        cpu_percent: percent,
        memory_used_bytes: mem.map(|v| v.0),
        memory_total_bytes: mem.map(|v| v.1),
        ..Default::default()
    };
    for zone in 0..16 {
        let base = format!("/sys/class/thermal/thermal_zone{zone}");
        let kind = text(&format!("{base}/type"));
        if kind
            .as_deref()
            .is_some_and(|s| s.contains("cpu") || s.contains("x86_pkg"))
            && let Some(value) = text(&format!("{base}/temp"))
                .and_then(|s| s.trim().parse::<f64>().ok())
                .filter(|v| v.is_finite() && *v >= -40000.0 && *v <= 150000.0)
        {
            host.temperature_c = Some(value / 1000.0);
            host.temperature_sensor = kind.map(|s| s.trim().to_owned());
            break;
        }
    }
    (host, current)
}
fn phase(p: AudioPhase) -> String {
    match p {
        AudioPhase::Unavailable => "unavailable",
        AudioPhase::Stopped => "stopped",
        AudioPhase::Starting => "starting",
        AudioPhase::Running => "running",
        AudioPhase::Stopping => "stopping",
        AudioPhase::Failed => "failed",
    }
    .into()
}
pub(super) fn start(shared: Weak<Shared>, updates: watch::Sender<Monitoring>) {
    tokio::spawn(async move {
        let mut previous = None;
        let mut sequence = 0;
        let mut graph_frames = None;
        let mut graph_time = Instant::now();
        let mut timer = tokio::time::interval(Duration::from_secs(1));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let Ok((host, next)) = tokio::task::spawn_blocking(move || sample(previous)).await
            else {
                continue;
            };
            previous = next;
            sequence += 1;
            let native = shared.playback.snapshot();
            let graph = shared.graph_playback.snapshot();
            let rig = shared.rig_playback.snapshot();
            let (source, stream, audio, age) = if native.phase == AudioPhase::Running {
                let meter = shared.playback.telemetry();
                (
                    Some("Saved preset".into()),
                    native.configured.as_ref().map(|s| s.stream.clone()),
                    meter.map(|s| s.0),
                    meter.map(|s| s.1.elapsed().as_millis() as u64),
                )
            } else if graph.phase == AudioPhase::Running {
                let identity = (graph.session.clone(), graph.telemetry.map(|s| s.frames));
                if graph_frames.as_ref() != Some(&identity) {
                    graph_frames = Some(identity);
                    graph_time = Instant::now();
                }
                (
                    Some("LV2 graph".into()),
                    graph.configured.as_ref().map(|s| s.stream.clone()),
                    graph.telemetry,
                    Some(graph_time.elapsed().as_millis() as u64),
                )
            } else if rig.phase == AudioPhase::Running {
                let identity = (rig.session.clone(), rig.telemetry.map(|s| s.frames));
                if graph_frames.as_ref() != Some(&identity) {
                    graph_frames = Some(identity);
                    graph_time = Instant::now();
                }
                (
                    Some("Mixed rig".into()),
                    rig.configured.as_ref().map(|s| s.stream.clone()),
                    rig.telemetry,
                    Some(graph_time.elapsed().as_millis() as u64),
                )
            } else {
                graph_frames = None;
                (None, None, None, None)
            };
            updates.send_replace(Monitoring {
                sequence,
                host,
                audio_phase: phase(native.phase),
                graph_phase: phase(graph.phase),
                rig_phase: phase(rig.phase),
                source,
                stream,
                audio,
                audio_age_ms: age,
                xruns: None,
                error: if native.phase == AudioPhase::Running {
                    native.error
                } else if graph.phase == AudioPhase::Running {
                    graph.error
                } else if rig.phase == AudioPhase::Running {
                    rig.error
                } else {
                    rig.error.or(graph.error).or(native.error)
                },
            });
        }
    });
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.monitor.borrow().clone()),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn linux_counters_exclude_guest_and_handle_missing_metrics() {
        assert_eq!(cpu("cpu 10 20 30 40 5 6 7 8 100 200\n"), Some((126, 45)));
        assert_eq!(cpu("cpu broken"), None);
        assert_eq!(
            memory("MemTotal: 1000 kB\nMemAvailable: 400 kB\n"),
            Some((614400, 1024000))
        );
        assert_eq!(memory("MemTotal: 1000 kB\n"), None);
    }
}
