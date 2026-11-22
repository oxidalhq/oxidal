//! Device-owned performance tempo. Overrides apply only while rendering.
use crate::{Shared, failure, player::PlayerState};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::{backing::Click, lifecycle::AudioPhase};
use oxidal_engine::protocol::Target;
use oxidal_lv2::TapNote;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Weak},
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, watch};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TempoSource {
    Tap,
    Song,
    #[default]
    Preset,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SelectTempoSource {
    Song,
    Preset,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TempoCommand {
    Tap,
    SetTapNote {
        tap_note: Option<TapNote>,
        expected_revision: u64,
    },
    Select {
        source: SelectTempoSource,
        expected_revision: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TempoState {
    pub revision: u64,
    pub source: TempoSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tap_note: Option<TapNote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    source: TempoSource,
    tap: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tap_note: Option<TapNote>,
}

fn unavailable(source: TempoSource) -> &'static str {
    match source {
        TempoSource::Tap => "Tap again to measure the tempo",
        TempoSource::Song => "No cued track with an available tempo from 40 to 240 BPM",
        TempoSource::Preset => "No single confirmed preset tempo",
    }
}

fn midi_received_at(now: Instant, device_ms: Option<u64>, received_ms: Option<u64>) -> Instant {
    let elapsed = device_ms
        .zip(received_ms)
        .and_then(|(device, received)| device.checked_sub(received));
    elapsed
        .and_then(|elapsed| now.checked_sub(Duration::from_millis(elapsed)))
        .unwrap_or(now)
}

fn valid(value: f32) -> bool {
    (40.0..=240.0).contains(&value)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Engine {
    Mixed(String),
    Effects(String),
}

impl Engine {
    fn active(shared: &Shared) -> Option<Self> {
        let mixed = shared.rig_playback.snapshot();
        if mixed.phase == AudioPhase::Running {
            return mixed.control.map(|state| Self::Mixed(state.session));
        }
        let effects = shared.graph_playback.snapshot();
        if effects.phase == AudioPhase::Running {
            return effects.control.map(|state| Self::Effects(state.session));
        }
        None
    }

    async fn apply(
        &self,
        shared: &Shared,
        bpm: Option<f32>,
        tap_note: Option<TapNote>,
    ) -> Result<(), String> {
        match self {
            Self::Mixed(session) => {
                shared
                    .rig_playback
                    .set_host_tempo(session.clone(), bpm, tap_note)
                    .await
            }
            Self::Effects(session) => {
                shared
                    .graph_playback
                    .set_host_tempo(session.clone(), bpm, tap_note)
                    .await
            }
        }
    }
}

#[derive(Debug, Default)]
struct Inner {
    saved: Saved,
    taps: VecDeque<Instant>,
    applied: Option<(Engine, Option<f32>, Option<TapNote>)>,
    preset: Option<(Engine, u64, Option<f32>)>,
    song: Option<(String, Instant, Option<f32>)>,
}

impl Inner {
    fn tap(&mut self, at: Instant) -> Saved {
        let mut saved = self.saved;
        if self.taps.back().is_some_and(|last| at < *last) {
            return saved;
        }
        if saved.source != TempoSource::Tap
            || self.taps.back().is_some_and(|previous| {
                !(Duration::from_millis(250)..=Duration::from_millis(1500))
                    .contains(&at.saturating_duration_since(*previous))
            })
        {
            self.taps.clear();
        }
        if self.taps.len() == 5 {
            self.taps.pop_front();
        }
        self.taps.push_back(at);
        if self.taps.len() >= 2 {
            let mut intervals = [0.0_f32; 4];
            for (slot, (a, b)) in intervals
                .iter_mut()
                .zip(self.taps.iter().zip(self.taps.iter().skip(1)))
            {
                *slot = b.saturating_duration_since(*a).as_secs_f32();
            }
            let values = &mut intervals[..self.taps.len() - 1];
            values.sort_by(f32::total_cmp);
            let middle = (values[(values.len() - 1) / 2] + values[values.len() / 2]) * 0.5;
            let bpm = (600.0 / middle).round() / 10.0;
            saved.tap = Some(bpm).filter(|&value| valid(value)).or(saved.tap);
        }
        saved.source = TempoSource::Tap;
        saved
    }
}

#[derive(Debug)]
pub(super) struct Tempo {
    path: PathBuf,
    inner: Mutex<Inner>,
    status: watch::Sender<TempoState>,
}

impl Tempo {
    pub(super) fn load(path: PathBuf) -> Self {
        use std::io::Read;
        let mut bytes = Vec::new();
        let saved = std::fs::File::open(&path)
            .ok()
            .and_then(|file| file.take(1025).read_to_end(&mut bytes).ok())
            .filter(|&size| size <= 1024)
            .and_then(|_| serde_json::from_slice::<Saved>(&bytes).ok())
            .map(|saved| Saved {
                tap: saved.tap.filter(|&value| valid(value)),
                ..saved
            })
            .unwrap_or_default();
        let bpm = if saved.source == TempoSource::Tap {
            saved.tap
        } else {
            None
        };
        let (status, _) = watch::channel(TempoState {
            revision: 0,
            source: saved.source,
            tap_note: saved.tap_note,
            bpm,
            reason: bpm.is_none().then(|| unavailable(saved.source).to_owned()),
        });
        Self {
            path,
            inner: Mutex::new(Inner {
                saved,
                ..Default::default()
            }),
            status,
        }
    }

    async fn persist(&self, saved: Saved) -> Result<(), String> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let bytes = serde_json::to_vec(&saved).map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            crate::media::write_atomic(&path, &bytes).map_err(|error| error.to_string())
        })
        .await
        .map_err(|_| "Could not save the tempo source")?
    }

    pub(super) fn snapshot(&self) -> TempoState {
        self.status.borrow().clone()
    }

    pub(super) async fn command(
        &self,
        shared: &Shared,
        command: TempoCommand,
    ) -> Result<TempoState, String> {
        self.command_at(shared, command, Instant::now(), None).await
    }

    pub(super) async fn midi_tap(
        &self,
        shared: &Shared,
        received_ms: Option<u64>,
    ) -> Result<TempoState, String> {
        let now = Instant::now();
        let at = midi_received_at(now, oxidal_audio::realtime::monotonic_millis(), received_ms);
        self.command_at(shared, TempoCommand::Tap, at, None).await
    }

    pub(super) async fn switch_tap(
        &self,
        shared: &Shared,
        entry: &oxidal_presets::LibraryReference,
        session: &str,
        note: oxidal_presets::switches::SwitchNote,
        received_ms: Option<u64>,
    ) -> Result<TempoState, String> {
        use oxidal_presets::switches::SwitchNote::*;
        let note = match note {
            Quarter => TapNote::Quarter,
            DottedEighth => TapNote::DottedEighth,
            Eighth => TapNote::Eighth,
            Triplet => TapNote::EighthTriplet,
        };
        let at = midi_received_at(
            Instant::now(),
            oxidal_audio::realtime::monotonic_millis(),
            received_ms,
        );
        self.command_at(shared, TempoCommand::Tap, at, Some((note, entry, session)))
            .await
    }

    async fn command_at(
        &self,
        shared: &Shared,
        command: TempoCommand,
        at: Instant,
        switch: Option<(TapNote, &oxidal_presets::LibraryReference, &str)>,
    ) -> Result<TempoState, String> {
        let mut inner = self.inner.lock().await;
        let engine = Engine::active(shared);
        if let Some((_, entry, session)) = switch
            && crate::switch_layout::session(shared, entry).as_deref() != Some(session)
        {
            return Err("The playing preset or session changed".into());
        }
        let before = inner.saved;
        let prior_taps = inner.taps.clone();
        let saved = match command {
            TempoCommand::Tap => {
                let mut saved = inner.tap(at);
                if let Some((note, _, _)) = switch {
                    saved.tap_note = Some(note);
                }
                saved
            }
            TempoCommand::SetTapNote {
                tap_note,
                expected_revision,
            } => {
                if self.status.borrow().revision != expected_revision {
                    return Err("Tempo changed; check the current note and try again".into());
                }
                Saved { tap_note, ..before }
            }
            TempoCommand::Select {
                expected_revision,
                source,
            } => {
                if self.status.borrow().revision != expected_revision {
                    return Err("Tempo changed; check the current source and try again".into());
                }
                inner.taps.clear();
                Saved {
                    source: match source {
                        SelectTempoSource::Song => TempoSource::Song,
                        SelectTempoSource::Preset => TempoSource::Preset,
                    },
                    ..before
                }
            }
        };
        if before != saved {
            if let Err(error) = self.persist(saved).await {
                inner.taps = prior_taps;
                return Err(error);
            }
            inner.saved = saved;
        }
        self.refresh_engine(shared, &mut inner, engine).await;
        Ok(self.snapshot())
    }

    pub(super) async fn backing_stopped(&self, shared: &Shared) {
        let mut inner = self.inner.lock().await;
        if inner.saved.source != TempoSource::Song {
            return;
        }
        inner.saved.source = TempoSource::Preset;
        if let Err(error) = self.persist(inner.saved).await {
            eprintln!("Cannot save the tempo source after stopping backing: {error}");
        }
        self.refresh(shared, &mut inner).await;
    }

    async fn refresh(&self, shared: &Shared, inner: &mut Inner) {
        self.refresh_engine(shared, inner, Engine::active(shared))
            .await;
    }
    async fn refresh_engine(&self, shared: &Shared, inner: &mut Inner, engine: Option<Engine>) {
        let source = inner.saved.source;
        let mut bpm = match source {
            TempoSource::Tap => inner.saved.tap,
            TempoSource::Song => song_tempo(shared, inner).await,
            TempoSource::Preset => preset_tempo(shared, inner, engine.as_ref()).await,
        };
        let mut reason = bpm.is_none().then(|| unavailable(source).to_owned());
        let overlay = if source == TempoSource::Preset {
            None
        } else {
            bpm
        };
        if let Some(engine) = engine {
            let note = if overlay.is_some() && source == TempoSource::Tap {
                inner.saved.tap_note
            } else {
                None
            };
            let next = (engine, overlay, note);
            // A fresh worker starts with no overlay. Avoid an unnecessary
            // transaction unless an override needs setting or clearing.
            let prior = inner
                .applied
                .as_ref()
                .filter(|old| old.0 == next.0)
                .map(|old| (old.1, old.2))
                .unwrap_or_default();
            if prior == (overlay, note) {
                inner.applied = Some(next);
            } else {
                match next.0.apply(shared, next.1, next.2).await {
                    Ok(()) => inner.applied = Some(next),
                    Err(error) => {
                        bpm = None;
                        reason = Some(error);
                    }
                }
            }
        } else {
            inner.applied = None;
        }
        self.status.send_if_modified(|state| {
            if state.source == source
                && state.tap_note == inner.saved.tap_note
                && state.bpm == bpm
                && state.reason == reason
            {
                return false;
            }
            *state = TempoState {
                revision: state.revision.saturating_add(1),
                source,
                tap_note: inner.saved.tap_note,
                bpm,
                reason,
            };
            true
        });
    }
}

async fn song_tempo(shared: &Shared, inner: &mut Inner) -> Option<f32> {
    let player = shared.player.subscribe().borrow().clone();
    let track = player
        .track
        .filter(|_| player.state != PlayerState::Unavailable)?;
    if let Some(Click::Manual { bpm_tenths, .. }) = player.click {
        let bpm = f32::from(bpm_tenths) / 10.0;
        return Some(bpm).filter(|&value| valid(value));
    }
    if let Some((asset, checked, bpm)) = &inner.song
        && asset == &track.id
        && checked.elapsed() < Duration::from_secs(2)
    {
        return *bpm;
    }
    let media = shared.media.as_ref().ok()?.clone();
    let id = track.id.clone();
    let bpm = tokio::task::spawn_blocking(move || crate::timing::load(&media, &id).ok().flatten())
        .await
        .ok()
        .flatten()
        .and_then(|timing| timing.bpm)
        .map(|bpm| bpm as f32)
        .filter(|&value| valid(value));
    inner.song = Some((track.id, Instant::now(), bpm));
    bpm
}

async fn preset_tempo(shared: &Shared, inner: &mut Inner, engine: Option<&Engine>) -> Option<f32> {
    let engine = engine?;
    let (revision, bpm) = match engine {
        Engine::Mixed(session) => {
            let control = shared
                .rig_playback
                .snapshot()
                .control
                .filter(|current| current.session == *session)?;
            if let Some((old, revision, bpm)) = &inner.preset
                && old == engine
                && *revision == control.revision
            {
                return *bpm;
            }
            let source = control.source_revision.clone();
            let path = shared.config.preset_dir.join("bundles");
            let manifest = tokio::task::spawn_blocking(move || {
                oxidal_presets::BundleStore::new(path).manifest(&source)
            })
            .await
            .ok()?
            .ok()?;
            let host = manifest.oxidal?;
            let tempo = host.graph.nodes.iter().filter_map(|node| {
                let plugin = host.lv2.iter().find(|plugin| Some(&plugin.id) == node.instance.as_ref())?;
                let (symbol, linked) = oxidal_lv2::tempo_link_control(&plugin.plugin_uri)?;
                let value = |symbol| control.controls.iter().find(|item| matches!(&item.target,
                    Target::Lv2 { node: target, symbol: port } if target == &node.id && port == symbol
                )).map(|row| row.value as f32);
                (value(symbol) == Some(linked)).then(|| value("bpm"))
            });
            (control.revision, agree(tempo))
        }
        Engine::Effects(session) => {
            let state = shared.graph_playback.snapshot();
            let control = state
                .control
                .filter(|current| current.session == *session)?;
            if let Some((old, revision, bpm)) = &inner.preset
                && old == engine
                && *revision == u64::from(control.revision)
            {
                return *bpm;
            }
            let settings = state.configured?;
            let tempo = settings.bindings.iter().filter_map(|binding| {
                let (symbol, linked) = oxidal_lv2::tempo_link_control(&binding.uri)?;
                let value = |symbol| {
                    let target = format!("{}.{symbol}", binding.node);
                    state
                        .native_values
                        .iter()
                        .find(|row| row.target == target)
                        .map(|row| row.value)
                };
                (value(symbol) == Some(linked)).then(|| value("bpm"))
            });
            (u64::from(control.revision), agree(tempo))
        }
    };
    inner.preset = Some((engine.clone(), revision, bpm));
    bpm
}

fn agree(mut values: impl Iterator<Item = Option<f32>>) -> Option<f32> {
    let first = values.next().flatten().filter(|&bpm| valid(bpm))?;
    values.all(|value| value == Some(first)).then_some(first)
}

pub(super) fn follow(shared: Weak<Shared>) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let mut inner = shared.tempo.inner.lock().await;
            shared.tempo.refresh(&shared, &mut inner).await;
        }
    });
}

pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(shared.tempo.snapshot()),
    )
        .into_response()
}

pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<TempoCommand>, JsonRejection>,
) -> Response {
    let Ok(Json(command)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid tempo command");
    };
    match shared.tempo.command(&shared, command).await {
        Ok(state) => Json(state).into_response(),
        Err(error) => failure(StatusCode::CONFLICT, &error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_midi_readback_keeps_two_distinct_tap_times() {
        let now = Instant::now();
        let message = oxidal_audio::midi::Message::Control {
            channel: 1,
            controller: 27,
            value: 127,
        };
        let map: oxidal_presets::Navigation = serde_json::from_value(serde_json::json!({
            "tap":{"controller":27}
        }))
        .unwrap();
        let status = oxidal_audio::midi::Status {
            events: 2,
            recent: [1000, 1500]
                .into_iter()
                .enumerate()
                .map(|(index, received_ms)| oxidal_audio::midi::Observed {
                    learned: false,
                    seq: index as u64 + 1,
                    message,
                    source: 0,
                    received_ms: Some(received_ms),
                })
                .collect(),
            ..Default::default()
        };
        let mut inner = Inner::default();
        for event in status.unseen(0) {
            assert_eq!(
                map.action(event.message),
                Some(oxidal_presets::DeviceAction::TapTempo)
            );
            let at = midi_received_at(now, Some(2200), event.received_ms);
            inner.saved = inner.tap(at);
        }
        assert_eq!(inner.saved.tap, Some(120.0));
        assert_eq!(midi_received_at(now, Some(2200), None), now);
        assert_eq!(midi_received_at(now, Some(2200), Some(2300)), now);
    }

    #[test]
    fn taps_are_device_intervals_and_a_long_pause_restarts_the_sequence() {
        let mut inner = Inner::default();
        let start = Instant::now();
        inner.saved = inner.tap(start);
        assert_eq!(inner.saved.source, TempoSource::Tap);
        assert!(inner.saved.tap.is_none());
        inner.saved = inner.tap(start + Duration::from_millis(500));
        assert_eq!(inner.saved.tap, Some(120.0));
        inner.saved = inner.tap(start + Duration::from_millis(1000));
        assert_eq!(inner.saved.tap, Some(120.0));
        inner.saved = inner.tap(start + Duration::from_secs(5));
        assert_eq!(inner.taps.len(), 1);
        assert_eq!(inner.saved.tap, Some(120.0));
        inner.saved = inner.tap(start + Duration::from_millis(6000));
        assert_eq!(inner.saved.tap, Some(60.0));
    }
}
