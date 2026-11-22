//! Global MIDI transport: Bank Select + Program Change recall the Mine set list.
//! A Program binding inside the sounding preset wins over global recall.
use crate::Shared;
use oxidal_audio::{
    lifecycle::{AudioAction, AudioCommand, AudioPhase, StartAudio},
    midi::Message,
};
use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand, StartRig, SwitchCommand};
use oxidal_presets::{DeviceAction, LibraryKind, ResolvedOccurrence, SetOrder};
use std::sync::{Arc, Weak};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Event {
    pub message: Message,
    pub local_program: bool,
    /// Which controller sent it; bank state is kept per controller and channel.
    pub source: u8,
    pub received_ms: Option<u64>,
}

/// Outcome of the newest device-wide MIDI action. `seq` increases with each one
/// so a client can tell a new refusal from a repeat of the previous text.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiAction {
    pub seq: u64,
    pub ok: bool,
    pub message: String,
}

fn record(shared: &Shared, result: &Result<String, String>) {
    shared.midi_action.send_modify(|action| {
        action.seq += 1;
        action.ok = result.is_ok();
        action.message = match result {
            Ok(message) | Err(message) => message.clone(),
        };
    });
}

#[derive(Default)]
struct BankState([[u16; 16]; oxidal_audio::midi::MAX_INPUTS]);

/// The channel a controller listens on (0 accepts every channel), given the map.
fn listens_on(map: &oxidal_presets::MidiMap, source: u8, channel: u8) -> bool {
    let wanted = match usize::from(source).checked_sub(1) {
        None => map.channel,
        Some(index) => map
            .extra_inputs
            .get(index)
            .map_or(map.channel, |e| e.channel),
    };
    wanted == 0 || wanted == channel
}

impl BankState {
    /// A Program Change recall target, or None for Bank Select, a local scene
    /// Program or a source beyond the supported controllers. Each controller and
    /// channel has its own bank, so one controller's Bank Select never changes
    /// what another's Program Change means.
    fn apply(&mut self, event: Event) -> Option<(u8, usize)> {
        let source = usize::from(event.source);
        let banks = self.0.get_mut(source)?;
        match event.message {
            Message::Control {
                channel,
                controller: 0,
                value,
            } if (1..=16).contains(&channel) => {
                let bank = &mut banks[usize::from(channel - 1)];
                *bank = (u16::from(value) << 7) | (*bank & 0x7f);
                None
            }
            Message::Control {
                channel,
                controller: 32,
                value,
            } if (1..=16).contains(&channel) => {
                let bank = &mut banks[usize::from(channel - 1)];
                *bank = (*bank & 0x3f80) | u16::from(value);
                None
            }
            Message::Program { channel, program }
                if !event.local_program && (1..=16).contains(&channel) =>
            {
                Some((
                    channel,
                    usize::from(banks[usize::from(channel - 1)]) * 128 + usize::from(program),
                ))
            }
            _ => None,
        }
    }
}

pub(crate) fn start(shared: Weak<Shared>, mut events: mpsc::Receiver<Event>) {
    tokio::spawn(async move {
        let mut banks = BankState::default();
        while let Some(event) = events.recv().await {
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let Ok(map) = shared.midi_map.snapshot() else {
                continue;
            };
            // Previous/Next are matched first and never fall through to a
            // Program recall. Each event is handled to completion before the
            // next, so quick taps stay in order.
            if let Some(action) = map.navigation.action(event.message)
                && map.input.is_some()
                && channel_of(event.message).is_some_and(|c| listens_on(&map, event.source, c))
            {
                if matches!(action, DeviceAction::Previous | DeviceAction::Next)
                    && shared.captures.reamping()
                {
                    record(&shared, &Err(crate::capture::REAMP_LOCKED.to_owned()));
                    continue;
                }
                match action {
                    DeviceAction::Previous => navigate_recorded(&shared, -1).await.ok(),
                    DeviceAction::Next => navigate_recorded(&shared, 1).await.ok(),
                    DeviceAction::OutputLevel { value } => {
                        let result = crate::levels::midi_output(&shared, value).await;
                        if let Err(reason) = result {
                            record(&shared, &Err(reason));
                        }
                        None
                    }
                    DeviceAction::MuteToggle => toggle_mute(&shared).await.ok(),
                    DeviceAction::ProtectToggle => {
                        let result = crate::protect::change(&shared, None).await.map(|state| {
                            if state.on {
                                "Protect on"
                            } else {
                                "Protect off"
                            }
                            .to_owned()
                        });
                        record(&shared, &result);
                        result.ok()
                    }
                    DeviceAction::BoostToggle => toggle_boost(&shared).await.ok(),
                    DeviceAction::TunerOpen => {
                        let result = Ok("Tuner requested".to_owned());
                        record(&shared, &result);
                        result.ok()
                    }
                    DeviceAction::GuitarNext => {
                        let result = crate::guitars::select_next(&shared).await;
                        record(&shared, &result);
                        result.ok()
                    }
                    DeviceAction::TapTempo => {
                        let result = shared
                            .tempo
                            .midi_tap(&shared, event.received_ms)
                            .await
                            .map(|_| "Tempo tapped".to_owned());
                        record(&shared, &result);
                        result.ok()
                    }
                    backing => backing_action(&shared, backing).await.ok(),
                };
                continue;
            }
            let Some((channel, slot)) = banks.apply(event) else {
                continue;
            };
            if map.input.is_none() || !listens_on(&map, event.source, channel) {
                continue;
            }
            if shared.captures.reamping() {
                record(&shared, &Err(crate::capture::REAMP_LOCKED.to_owned()));
                continue;
            }
            record(
                &shared,
                &recall(&shared, slot)
                    .await
                    .map(|()| format!("Recalled Program {}", slot % 128 + 1)),
            );
        }
    });
}

fn channel_of(message: Message) -> Option<u8> {
    match message {
        Message::Program { channel, .. } | Message::Control { channel, .. } => Some(channel),
    }
}

/// Where Previous or Next goes: the neighbour of the playing preset, or the
/// list's first (Next) or last (Previous) preset when the playing one is not
/// in it.
fn target_index(current: Option<usize>, len: usize, direction: i8) -> Result<usize, &'static str> {
    match current {
        Some(current) => step(current, len, direction),
        None if len == 0 => Err("The Set list is empty. Add presets to it in Library"),
        None if direction < 0 => Ok(len - 1),
        None => Ok(0),
    }
}

/// The neighbouring set-list position; the ends stop instead of wrapping.
fn step(current: usize, len: usize, direction: i8) -> Result<usize, &'static str> {
    if direction < 0 {
        current
            .checked_sub(1)
            .ok_or("Already at the first preset in the Set list")
    } else if current + 1 < len {
        Ok(current + 1)
    } else {
        Err("Already at the last preset in the Set list")
    }
}

/// A neighbouring set-list preset and whether pressing Previous/Next would switch to it now.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Neighbor {
    pub name: String,
    pub ready: bool,
    /// Plain-language state: prepared, loads on recall, or why it will refuse.
    pub detail: String,
}

/// Where the playing preset sits in the Set list.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiPosition {
    /// Zero-based position of the playing preset; None when it is not in the list.
    pub index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<ResolvedOccurrence>,
    pub length: usize,
    pub previous: Option<Neighbor>,
    pub next: Option<Neighbor>,
}

fn neighbor(shared: &Shared, item: &ResolvedOccurrence) -> Neighbor {
    let protect = shared.protect.on();
    let prepared = item.entry.preset.kind == LibraryKind::Rig && {
        let state = shared.rig_playback.snapshot();
        state.phase == AudioPhase::Running
            && state.control.as_ref().is_some_and(|control| {
                control
                    .prepared
                    .iter()
                    .any(|p| p.revision == item.content && p.error.is_none())
            })
    };
    let (ready, detail) = if prepared {
        (true, "Ready")
    } else if protect {
        (false, "Not ready: Protect is on")
    } else {
        (true, "Loads when selected")
    };
    Neighbor {
        name: item.name.clone(),
        ready,
        detail: detail.into(),
    }
}

#[derive(Debug, Clone)]
pub(super) struct PlayingOccurrence {
    pub session: String,
    pub row: ResolvedOccurrence,
}

fn owner_session(shared: &Shared, kind: LibraryKind) -> String {
    if kind == LibraryKind::Rig {
        shared.rig_playback.snapshot().session
    } else {
        shared.playback.snapshot().session
    }
}

fn playing_index(shared: &Shared, items: &[ResolvedOccurrence]) -> Option<usize> {
    let native = shared.playback.snapshot();
    let (session, preset) = if native.phase == AudioPhase::Running {
        (
            native.session,
            crate::library_removal::native_reference(native.configured.as_ref()?)?,
        )
    } else {
        let rig = shared.rig_playback.snapshot();
        if rig.phase != AudioPhase::Running {
            return None;
        }
        let preset = oxidal_presets::LibraryReference {
            kind: LibraryKind::Rig,
            id: rig.configured?.revision,
        };
        (rig.session, preset)
    };
    let matches_sound =
        |row: &ResolvedOccurrence| row.entry.preset.kind == preset.kind && row.content == preset.id;
    let entries = || {
        items
            .iter()
            .enumerate()
            .filter(|(_, row)| matches_sound(row))
    };
    let last = shared.set_position.lock().ok()?.clone();
    last.filter(|position| position.session == session)
        .and_then(|position| entries().find(|(_, row)| row.entry.id == position.row.entry.id))
        .or_else(|| entries().next())
        .map(|(index, _)| index)
}

pub(crate) async fn position(shared: &Arc<Shared>) -> Result<MidiPosition, String> {
    let items = set_list(shared).await?.entries;
    let index = playing_index(shared, &items);
    let target = |direction| target_index(index, items.len(), direction).ok();
    Ok(MidiPosition {
        occurrence: index.map(|i| items[i].clone()),
        index,
        length: items.len(),
        previous: target(-1).map(|i| neighbor(shared, &items[i])),
        next: target(1).map(|i| neighbor(shared, &items[i])),
    })
}

/// Flips the output mute on whichever engine is playing and records the outcome.
/// The worker owns the state, so this never guesses what the screen shows.
pub(crate) async fn toggle_mute(shared: &Arc<Shared>) -> Result<String, String> {
    let command = oxidal_audio::tools::HostUtility::OutputMuteToggle;
    let result = crate::player::send_utility(shared, command)
        .await
        .map(|()| "Output mute toggled".to_owned())
        .map_err(|(_, reason)| reason);
    record(shared, &result);
    result
}

/// Toggle only the instrument lift. The running worker owns its state.
pub(crate) async fn toggle_boost(shared: &Shared) -> Result<String, String> {
    let result = crate::player::send_utility(shared, oxidal_audio::tools::HostUtility::BoostToggle)
        .await
        .map(|()| "Instrument boost toggled".to_owned())
        .map_err(|(_, reason)| reason);
    record(shared, &result);
    result
}

/// Runs a navigation and records its outcome; the footswitch and the Perform
/// buttons both come through here.
pub(crate) async fn navigate_recorded(
    shared: &Arc<Shared>,
    direction: i8,
) -> Result<String, String> {
    let result = navigate(shared, direction).await;
    record(shared, &result);
    result
}

/// Previous (-1) or Next (1) in the current Set list. The ends stop with a
/// reason instead of wrapping, and a refused recall leaves the sound playing.
/// From a preset outside the Set list, Next goes to its first preset and
/// Previous to its last, as a footswitch on a modeller would.
async fn navigate(shared: &Arc<Shared>, direction: i8) -> Result<String, String> {
    let _guard = shared.set_recall.lock().await;
    let order = set_list(shared).await?;
    let current = playing_index(shared, &order.entries);
    let index = target_index(current, order.entries.len(), direction)?;
    let name = order.entries[index].name.clone();
    recall_slot(shared, &order.revision, &order.entries[index]).await?;
    Ok(format!("Recalled {name}"))
}

async fn set_list(shared: &Arc<Shared>) -> Result<SetOrder, String> {
    let worker = shared.clone();
    let access = shared.library_access.clone().read_owned().await;
    tokio::task::spawn_blocking(move || {
        let _access = access;
        crate::set_order::current(&worker).map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "MIDI set-list task failed".to_owned())?
}

async fn stop_native(shared: &Shared) -> Result<(), String> {
    let state = shared.playback.snapshot();
    if state.phase == AudioPhase::Running {
        shared
            .playback
            .dispatch(AudioCommand {
                session: state.session,
                expected_revision: state.revision,
                action: AudioAction::Stop,
            })
            .await?;
    }
    Ok(())
}

async fn stop_mixed(shared: &Shared) -> Result<(), String> {
    let state = shared.rig_playback.snapshot();
    if state.phase == AudioPhase::Running {
        shared
            .rig_playback
            .dispatch(RigAudioCommand {
                session: state.session,
                expected_revision: state.revision,
                action: RigAudioAction::Stop,
            })
            .await?;
    }
    Ok(())
}

async fn stop_graph(shared: &Shared) -> Result<(), String> {
    let state = shared.graph_playback.snapshot();
    if state.phase == AudioPhase::Running {
        shared
            .graph_playback
            .dispatch(oxidal_lv2::protocol::GraphAudioCommand {
                session: state.session,
                expected_revision: state.revision,
                action: oxidal_lv2::protocol::GraphAudioAction::Stop,
            })
            .await?;
    }
    Ok(())
}

pub(crate) fn stream(shared: &Shared) -> Option<oxidal_audio::StreamConfig> {
    shared
        .playback
        .snapshot()
        .configured
        .map(|settings| settings.stream)
        .or_else(|| {
            shared
                .rig_playback
                .snapshot()
                .configured
                .map(|settings| settings.stream)
        })
        .or_else(|| {
            shared
                .graph_playback
                .snapshot()
                .configured
                .map(|settings| settings.stream)
        })
}

async fn recall(shared: &Arc<Shared>, slot: usize) -> Result<(), String> {
    let _guard = shared.set_recall.lock().await;
    let order = set_list(shared).await?;
    let entry = order
        .entries
        .get(slot)
        .ok_or("MIDI Program is outside the Mine set list")?;
    recall_slot(shared, &order.revision, entry).await
}

pub(crate) async fn recall_entry(
    shared: &Arc<Shared>,
    entry: &oxidal_presets::LibraryReference,
) -> Result<(), String> {
    let _guard = shared.set_recall.lock().await;
    let order = set_list(shared).await?;
    let mut matches = order
        .entries
        .iter()
        .filter(|r| r.entry.preset.kind == entry.kind && r.content == entry.id);
    let target = matches
        .next()
        .ok_or("Preset is not in the active Mine set list")?;
    if matches.next().is_some() {
        return Err("Choose the occurrence to recall from the set list".into());
    }
    recall_slot(shared, &order.revision, target).await
}

pub(super) async fn jump(shared: &Arc<Shared>, expected: &str, id: &str) -> Result<(), String> {
    let _guard = shared.set_recall.lock().await;
    let order = set_list(shared).await?;
    if order.revision != expected {
        return Err("Set list changed; reload before recall".into());
    }
    let row = order
        .entries
        .iter()
        .find(|r| r.entry.id == id)
        .ok_or("Set entry is unavailable")?;
    recall_slot(shared, expected, row).await
}

async fn recall_slot(
    shared: &Arc<Shared>,
    expected: &str,
    target: &ResolvedOccurrence,
) -> Result<(), String> {
    let worker = shared.clone();
    let row = target.clone();
    let admitted_revision = expected.to_owned();
    tokio::task::spawn_blocking(move || {
        let root = &worker.config.preset_dir;
        let catalog = oxidal_presets::CatalogStore::open(root.clone())?;
        let view = catalog.versions(row.entry.preset.kind, &row.entry.preset.id)?;
        if view.catalog_revision != admitted_revision {
            return Err(oxidal_presets::Error::Conflict(
                "Set list changed; reload before recall",
            ));
        }
        crate::set_order::validate(
            &worker,
            root,
            row.entry.preset.kind,
            &row.content,
            &row.entry.settings,
        )
    })
    .await
    .map_err(|_| "Could not check the set entry".to_owned())?
    .map_err(|e| e.to_string())?;
    recall_target(
        shared,
        oxidal_presets::LibraryReference {
            kind: target.entry.preset.kind,
            id: target.content.clone(),
        },
        target.entry.settings.scene.as_deref(),
        expected,
    )
    .await?;
    *shared
        .set_position
        .lock()
        .map_err(|_| "Set-list position is unavailable")? = Some(PlayingOccurrence {
        session: owner_session(shared, target.entry.preset.kind),
        row: target.clone(),
    });
    Ok(())
}

const PROTECTED: &str = "Protect is on: MIDI can only switch to presets that are ready. Prepare it or turn Protect off.";

pub(super) enum RecallPolicy {
    Current,
    Prepared,
    Loads,
}

/// The same read-only live admission used by recall and the rehearsal check.
pub(super) fn recall_policy(
    shared: &Shared,
    kind: LibraryKind,
    target: &str,
) -> Result<RecallPolicy, String> {
    use RecallPolicy::*;
    if shared.captures.reamping() {
        return Err(crate::capture::REAMP_LOCKED.to_owned());
    }
    if shared.audio_change.active() {
        return Err("Finish the audio settings trial before recall".into());
    }
    if kind == LibraryKind::Owned {
        if stream(shared).is_none() {
            return Err("Choose an audio interface before MIDI recall".into());
        }
        if shared.protect.on() {
            return Err(PROTECTED.into());
        }
        return Ok(Loads);
    }
    let state = shared.rig_playback.snapshot();
    if matches!(state.phase, AudioPhase::Starting | AudioPhase::Stopping) {
        return Err("Wait for the current mixed audio operation".into());
    }
    if state.phase == AudioPhase::Unavailable {
        return Err("Mixed worker unavailable".into());
    }
    if state.phase == AudioPhase::Running {
        if state
            .configured
            .as_ref()
            .is_some_and(|s| s.revision == target)
        {
            return Ok(Current);
        }
        if let Some(prepared) = state
            .control
            .as_ref()
            .and_then(|control| control.prepared.iter().find(|row| row.revision == target))
        {
            return match &prepared.error {
                Some(error) => Err(format!("Prepared alternative unavailable: {error}")),
                None => Ok(Prepared),
            };
        }
        if state
            .control
            .as_ref()
            .is_some_and(|control| control.modified)
        {
            return Err("Save or discard mixed-rig edits before MIDI preset recall".into());
        }
    }
    if shared.protect.on() {
        return Err(PROTECTED.into());
    }
    if stream(shared).is_none() {
        return Err("Choose an audio interface before MIDI recall".into());
    }
    Ok(Loads)
}

async fn recall_target(
    shared: &Arc<Shared>,
    target: oxidal_presets::LibraryReference,
    scene: Option<&str>,
    expected_order: &str,
) -> Result<(), String> {
    let audio_stream = || stream(shared).ok_or("Choose an audio interface before MIDI recall");
    match target.kind {
        LibraryKind::Owned => {
            recall_policy(shared, target.kind, &target.id)?;
            let stream = audio_stream()?;
            stop_mixed(shared).await?;
            stop_graph(shared).await?;
            let state = shared.playback.snapshot();
            let action = if state.configured.is_some() {
                AudioAction::LoadPreset {
                    preset_id: target.id,
                    owned: true,
                }
            } else {
                AudioAction::Start {
                    settings: StartAudio {
                        midi: None,
                        stream,
                        preset_id: target.id,
                        owned: true,
                        draft: false,
                        working: None,
                    },
                }
            };
            shared
                .playback
                .dispatch(AudioCommand {
                    session: state.session,
                    expected_revision: state.revision,
                    action,
                })
                .await?;
        }
        LibraryKind::Rig => {
            let state = shared.rig_playback.snapshot();
            match recall_policy(shared, target.kind, &target.id)? {
                RecallPolicy::Current => {
                    if let Some(scene) = scene {
                        let control = state.control.ok_or("Starting scene is unavailable")?;
                        // A new effect endpoint can accept its control write and
                        // fail during DSP. Check it in isolation before touching
                        // the already sounding copy of this same preset.
                        let changes_effect = control
                            .scenes
                            .as_ref()
                            .and_then(|scenes| scenes.scenes.iter().find(|row| row.id == scene))
                            .is_some_and(|row| {
                                row.controls.iter().any(|value| {
                                    control.controls.iter().any(|current| {
                                        matches!(&current.target,
                                    oxidal_engine::protocol::Target::Lv2 { node, symbol }
                                    if *node == value.node && *symbol == value.symbol)
                                            && current.value != f64::from(value.value as f32)
                                    })
                                })
                            });
                        if changes_effect {
                            let mut settings = state.configured.ok_or("Missing playing rig")?;
                            settings.prepared.clear();
                            shared
                                .rig_playback
                                .check_occurrence(&oxidal_engine::protocol::OccurrenceStart {
                                    settings,
                                    scene: scene.into(),
                                })
                                .await?;
                            if set_list(shared).await?.revision != expected_order {
                                return Err(
                                    "Set list changed during starting scene preparation".into()
                                );
                            }
                        }
                        let control_session = control.session.clone();
                        shared
                            .rig_playback
                            .dispatch(RigAudioCommand {
                                session: state.session,
                                expected_revision: state.revision,
                                action: RigAudioAction::Scene {
                                    command: oxidal_engine::protocol::SceneCommand {
                                        session: control.session,
                                        expected_revision: control.revision,
                                        scene: scene.into(),
                                        release_ms: None,
                                        native_bypass_preview: None,
                                    },
                                },
                            })
                            .await?;
                        shared
                            .rig_playback
                            .confirm_occurrence(&target.id, scene, Some(&control_session))
                            .await?;
                    }
                }
                RecallPolicy::Prepared => {
                    let control = state.control.ok_or("Prepared preset is unavailable")?;
                    let configured = state.configured.ok_or("Missing mixed configuration")?;
                    let action = RigAudioCommand {
                        session: state.session,
                        expected_revision: state.revision,
                        action: RigAudioAction::Switch {
                            command: SwitchCommand {
                                session: control.session,
                                expected_revision: control.revision,
                                revision: target.id,
                                fade_frames: (configured.stream.input.sample_rate / 100).max(2),
                            },
                        },
                    };
                    if let Some(scene) = scene {
                        shared
                            .rig_playback
                            .dispatch_occurrence(action, scene.into())
                            .await?;
                    } else {
                        shared.rig_playback.dispatch(action).await?;
                    }
                }
                RecallPolicy::Loads => {
                    let settings = StartRig {
                        revision: target.id.clone(),
                        stream: audio_stream()?,
                        recall: None,
                        prepared: vec![],
                        midi: None,
                    };
                    if let Some(scene) = scene {
                        // Establish the exact endpoint in a real isolated worker
                        // using the same saved resources and stream geometry.
                        shared
                            .rig_playback
                            .check_occurrence(&oxidal_engine::protocol::OccurrenceStart {
                                settings: settings.clone(),
                                scene: scene.into(),
                            })
                            .await?;
                    }
                    if scene.is_some() {
                        if set_list(shared).await?.revision != expected_order {
                            return Err("Set list changed during starting scene preparation".into());
                        }
                        if !matches!(
                            recall_policy(shared, target.kind, &target.id)?,
                            RecallPolicy::Loads
                        ) {
                            return Err(
                                "Playing rig changed during starting scene preparation".into()
                            );
                        }
                    }
                    stop_native(shared).await?;
                    stop_graph(shared).await?;
                    if scene.is_none() {
                        stop_mixed(shared).await?;
                    }
                    let state = if scene.is_some() {
                        state
                    } else {
                        shared.rig_playback.snapshot()
                    };
                    let action = RigAudioCommand {
                        session: state.session,
                        expected_revision: state.revision,
                        action: RigAudioAction::Start {
                            settings: Box::new(settings),
                        },
                    };
                    if let Some(scene) = scene {
                        shared
                            .rig_playback
                            .dispatch_occurrence(action, scene.into())
                            .await?;
                        shared
                            .rig_playback
                            .confirm_occurrence(&target.id, scene, None)
                            .await?;
                    } else {
                        shared.rig_playback.dispatch(action).await?;
                    }
                }
            }
        }
        _ => return Err("MIDI set list contains an unsupported preset".into()),
    }
    crate::boosts::follow(shared).await;
    Ok(())
}

/// Footswitches and the level knob drive the same player handler as the UI.
async fn backing_action(shared: &Shared, action: DeviceAction) -> Result<String, String> {
    use crate::player::{Origin, PlayerCommand, PlayerRequest};
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (command, done) = match action {
        DeviceAction::BackingRepeat => (PlayerCommand::ToggleRepeat, "Backing repeat toggled"),
        DeviceAction::BackingClick => (PlayerCommand::ToggleClick, "Backing click toggled"),
        DeviceAction::BackingPlayPause => (PlayerCommand::TogglePlay, "Backing track play/pause"),
        DeviceAction::BackingStop => (PlayerCommand::Stop, "Backing track stopped"),
        DeviceAction::BackingNext => (PlayerCommand::Next, "Next backing track"),
        DeviceAction::BackingPrevious => (PlayerCommand::Previous, "Previous backing track"),
        DeviceAction::BackingSkipBack => (
            PlayerCommand::SkipBy { seconds: -10 },
            "Backing track back 10 s",
        ),
        DeviceAction::BackingSkipForward => (
            PlayerCommand::SkipBy { seconds: 10 },
            "Backing track forward 10 s",
        ),
        DeviceAction::BackingLevel { value } => (
            PlayerCommand::SetLevel {
                db: oxidal_presets::backing_level_db(value),
            },
            "Backing track level",
        ),
        _ => return Err("Not a backing player action".into()),
    };
    let request = PlayerRequest {
        request_id: format!(
            "midi-{}",
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ),
        origin: Origin::Midi,
        expected_cue: None,
        command,
    };
    let result = crate::player::apply(shared, request)
        .await
        .map(|_| done.to_owned())
        .map_err(|(_, reason)| reason);
    // Level knob moves are frequent; record only refusals for them.
    if !matches!(action, DeviceAction::BackingLevel { .. }) || result.is_err() {
        record(shared, &result);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(message: Message) -> Event {
        Event {
            message,
            local_program: false,
            source: 0,
            received_ms: None,
        }
    }

    #[test]
    fn bank_select_is_14_bit_per_channel_and_program_is_zero_based() {
        let mut banks = BankState::default();
        assert_eq!(
            banks.apply(event(Message::Program {
                channel: 2,
                program: 7,
            })),
            Some((2, 7))
        );
        assert_eq!(
            banks.apply(event(Message::Control {
                channel: 2,
                controller: 0,
                value: 1,
            })),
            None
        );
        assert_eq!(
            banks.apply(event(Message::Control {
                channel: 2,
                controller: 32,
                value: 2,
            })),
            None
        );
        assert_eq!(
            banks.apply(event(Message::Program {
                channel: 2,
                program: 7,
            })),
            Some((2, (130 * 128) + 7))
        );
        assert_eq!(
            banks.apply(event(Message::Program {
                channel: 1,
                program: 7,
            })),
            Some((1, 7))
        );
    }

    #[test]
    fn previous_and_next_stop_at_the_ends_of_the_set_list() {
        assert_eq!(step(1, 3, -1), Ok(0));
        assert_eq!(step(1, 3, 1), Ok(2));
        assert!(step(0, 3, -1).unwrap_err().contains("first"));
        assert!(step(2, 3, 1).unwrap_err().contains("last"));
        assert!(step(0, 1, 1).unwrap_err().contains("last"));
        // Outside the Set list: Next enters at the first preset, Previous at the last.
        assert_eq!(target_index(None, 3, 1), Ok(0));
        assert_eq!(target_index(None, 3, -1), Ok(2));
        assert!(target_index(None, 0, 1).unwrap_err().contains("empty"));
        assert_eq!(target_index(Some(1), 3, 1), Ok(2));
    }

    #[test]
    fn bank_select_is_kept_separately_for_each_controller() {
        let mut banks = BankState::default();
        let from = |source: u8, message| Event {
            message,
            local_program: false,
            source,
            received_ms: None,
        };
        let bank = |value| Message::Control {
            channel: 1,
            controller: 0,
            value,
        };
        let program = Message::Program {
            channel: 1,
            program: 2,
        };
        // Controller 0 selects bank 1; controller 1 never did.
        assert_eq!(banks.apply(from(0, bank(1))), None);
        // MSB 1 is bank 128, as in the single-controller test above.
        assert_eq!(banks.apply(from(0, program)), Some((1, 128 * 128 + 2)));
        assert_eq!(banks.apply(from(1, program)), Some((1, 2)));
        // A source past the supported controllers is ignored, never panics.
        assert_eq!(banks.apply(from(9, program)), None);
    }

    #[test]
    fn each_controller_is_filtered_on_its_own_channel() {
        let map = oxidal_presets::MidiMap {
            revision: String::new(),
            input: Some("hw:A,0,0".into()),
            channel: 1,
            template: None,
            navigation: Default::default(),
            saved_layouts: vec![],
            extra_inputs: vec![oxidal_audio::midi::ExtraInput {
                input: "hw:B,0,0".into(),
                channel: 0,
            }],
            entries: vec![],
        };
        assert!(listens_on(&map, 0, 1));
        assert!(!listens_on(&map, 0, 2));
        assert!(listens_on(&map, 1, 2), "channel 0 accepts every channel");
        assert!(
            listens_on(&map, 5, 1),
            "unknown sources use the first filter"
        );
    }

    #[test]
    fn a_local_scene_program_suppresses_global_recall() {
        let mut banks = BankState::default();
        assert_eq!(
            banks.apply(Event {
                message: Message::Program {
                    channel: 1,
                    program: 4,
                },
                local_program: true,
                source: 0,
                received_ms: None,
            }),
            None
        );
    }
}
