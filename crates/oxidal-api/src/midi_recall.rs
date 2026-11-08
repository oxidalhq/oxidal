//! Global MIDI transport: Bank Select + Program Change recall the Mine set list.
//! A Program binding inside the sounding preset wins over global recall.
use crate::Shared;
use oxidal_audio::{
    lifecycle::{AudioAction, AudioCommand, AudioPhase, StartAudio},
    midi::Message,
};
use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand, StartRig, SwitchCommand};
use oxidal_presets::{DeviceAction, LibraryKind, LibraryOrigin};
use std::sync::{Arc, Weak};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Event {
    pub message: Message,
    pub local_program: bool,
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
    if let Ok(mut action) = shared.midi_action.lock() {
        action.seq += 1;
        action.ok = result.is_ok();
        action.message = match result {
            Ok(message) | Err(message) => message.clone(),
        };
    }
}

#[derive(Default)]
struct BankState([u16; 16]);

impl BankState {
    fn apply(&mut self, event: Event) -> Option<(u8, usize)> {
        match event.message {
            Message::Control {
                channel,
                controller: 0,
                value,
            } if (1..=16).contains(&channel) => {
                let bank = &mut self.0[usize::from(channel - 1)];
                *bank = (u16::from(value) << 7) | (*bank & 0x7f);
                None
            }
            Message::Control {
                channel,
                controller: 32,
                value,
            } if (1..=16).contains(&channel) => {
                let bank = &mut self.0[usize::from(channel - 1)];
                *bank = (*bank & 0x3f80) | u16::from(value);
                None
            }
            Message::Program { channel, program }
                if !event.local_program && (1..=16).contains(&channel) =>
            {
                Some((
                    channel,
                    usize::from(self.0[usize::from(channel - 1)]) * 128 + usize::from(program),
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
                && channel_of(event.message).is_some_and(|c| map.channel == 0 || map.channel == c)
            {
                match action {
                    DeviceAction::Previous => navigate_recorded(&shared, -1).await.ok(),
                    DeviceAction::Next => navigate_recorded(&shared, 1).await.ok(),
                    DeviceAction::MuteToggle => toggle_mute(&shared).await.ok(),
                };
                continue;
            }
            let Some((channel, slot)) = banks.apply(event) else {
                continue;
            };
            if map.input.is_none() || (map.channel != 0 && map.channel != channel) {
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

fn is_playing(shared: &Shared, item: &oxidal_presets::LibraryItem) -> bool {
    match item.kind {
        LibraryKind::Owned => shared
            .playback
            .snapshot()
            .configured
            .as_ref()
            .and_then(crate::library_removal::native_reference)
            .is_some_and(|reference| reference.kind == item.kind && reference.id == item.id),
        LibraryKind::Rig => shared
            .rig_playback
            .snapshot()
            .configured
            .is_some_and(|configured| configured.revision == item.id),
        _ => false,
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

/// Where the playing preset sits in the Mine set-list.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MidiPosition {
    /// Zero-based position of the playing preset; None when it is not in the list.
    pub index: Option<usize>,
    pub length: usize,
    pub previous: Option<Neighbor>,
    pub next: Option<Neighbor>,
}

fn neighbor(shared: &Shared, item: &oxidal_presets::LibraryItem) -> Neighbor {
    let protect = shared.protect.on();
    let prepared = item.kind == LibraryKind::Rig && {
        let state = shared.rig_playback.snapshot();
        state.phase == AudioPhase::Running
            && state.control.as_ref().is_some_and(|control| {
                control
                    .prepared
                    .iter()
                    .any(|p| p.revision == item.id && p.error.is_none())
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

pub(crate) async fn position(shared: &Arc<Shared>) -> Result<MidiPosition, String> {
    let items = set_list(shared).await?;
    let index = items.iter().position(|item| is_playing(shared, item));
    Ok(MidiPosition {
        index,
        length: items.len(),
        previous: index
            .and_then(|i| i.checked_sub(1))
            .map(|i| neighbor(shared, &items[i])),
        next: index
            .filter(|i| i + 1 < items.len())
            .map(|i| neighbor(shared, &items[i + 1])),
    })
}

/// Flips the output mute on whichever engine is playing and records the outcome.
/// The worker owns the state, so this never guesses what the screen shows.
pub(crate) async fn toggle_mute(shared: &Arc<Shared>) -> Result<String, String> {
    let command = oxidal_audio::tools::HostUtility::OutputMuteToggle;
    let rig = shared.rig_playback.snapshot();
    let native = shared.playback.snapshot();
    let result = if rig.phase == AudioPhase::Running {
        shared
            .rig_playback
            .dispatch(RigAudioCommand {
                session: rig.session,
                expected_revision: rig.revision,
                action: RigAudioAction::HostUtility { command },
            })
            .await
            .map(|_| "Output mute toggled".to_owned())
    } else if native.phase == AudioPhase::Running {
        shared
            .playback
            .dispatch(AudioCommand {
                session: native.session,
                expected_revision: native.revision,
                action: AudioAction::HostUtility { command },
            })
            .await
            .map(|_| "Output mute toggled".to_owned())
    } else {
        Err("Play a preset before using Mute".to_owned())
    };
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

/// Previous (-1) or Next (1) in the current Mine set-list. The ends stop with a
/// reason instead of wrapping, and a refused recall leaves the sound playing.
async fn navigate(shared: &Arc<Shared>, direction: i8) -> Result<String, String> {
    let items = set_list(shared).await?;
    let current = items
        .iter()
        .position(|item| is_playing(shared, item))
        .ok_or("Play a Set-list preset before using Previous or Next")?;
    let target = step(current, items.len(), direction)?;
    let item = items[target].clone();
    let name = item.name.clone();
    recall_target(shared, item).await?;
    Ok(format!("Recalled {name}"))
}

async fn set_list(shared: &Arc<Shared>) -> Result<Vec<oxidal_presets::LibraryItem>, String> {
    let root = shared.config.preset_dir.clone();
    let access = shared.library_access.clone().read_owned().await;
    tokio::task::spawn_blocking(move || {
        let _access = access;
        let items = crate::presets::catalog_items(&root).map_err(|error| error.to_string())?;
        let catalog = oxidal_presets::CatalogStore::open(root)
            .and_then(|mut store| store.reconcile(items))
            .map_err(|error| error.to_string())?;
        Ok(catalog
            .items
            .into_iter()
            .filter(|item| {
                !item.archived
                    && item.origin == LibraryOrigin::Mine
                    && matches!(item.kind, LibraryKind::Owned | LibraryKind::Rig)
            })
            .collect())
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

fn stream(shared: &Shared) -> Option<oxidal_audio::StreamConfig> {
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
    let target = set_list(shared)
        .await?
        .into_iter()
        .nth(slot)
        .ok_or("MIDI Program is outside the Mine set list")?;
    recall_target(shared, target).await
}

pub(crate) async fn recall_entry(
    shared: &Arc<Shared>,
    entry: &oxidal_presets::LibraryReference,
) -> Result<(), String> {
    let target = set_list(shared)
        .await?
        .into_iter()
        .find(|item| item.kind == entry.kind && item.id == entry.id)
        .ok_or("Preset is not in the active Mine set list")?;
    recall_target(shared, target).await
}

async fn recall_target(
    shared: &Arc<Shared>,
    target: oxidal_presets::LibraryItem,
) -> Result<(), String> {
    let stream = stream(shared).ok_or("Choose an audio interface before MIDI recall")?;
    const PROTECTED: &str = "Protect is on: MIDI can only switch to presets that are ready. Prepare it or turn Protect off.";
    match target.kind {
        LibraryKind::Owned => {
            if shared.protect.on() {
                return Err(PROTECTED.into());
            }
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
            if state
                .configured
                .as_ref()
                .is_some_and(|s| s.revision == target.id)
                && state.phase == AudioPhase::Running
            {
                return Ok(());
            }
            if let (AudioPhase::Running, Some(control), Some(configured)) = (
                state.phase,
                state.control.as_ref(),
                state.configured.as_ref(),
            ) && control
                .prepared
                .iter()
                .any(|prepared| prepared.revision == target.id && prepared.error.is_none())
            {
                shared
                    .rig_playback
                    .dispatch(RigAudioCommand {
                        session: state.session,
                        expected_revision: state.revision,
                        action: RigAudioAction::Switch {
                            command: SwitchCommand {
                                session: control.session.clone(),
                                expected_revision: control.revision,
                                revision: target.id,
                                fade_frames: (configured.stream.input.sample_rate / 100).max(2),
                            },
                        },
                    })
                    .await?;
                return Ok(());
            }
            if state
                .control
                .as_ref()
                .is_some_and(|control| control.modified)
            {
                return Err("Save or discard mixed-rig edits before MIDI preset recall".into());
            }
            if shared.protect.on() {
                return Err(PROTECTED.into());
            }
            stop_native(shared).await?;
            stop_graph(shared).await?;
            stop_mixed(shared).await?;
            let state = shared.rig_playback.snapshot();
            shared
                .rig_playback
                .dispatch(RigAudioCommand {
                    session: state.session,
                    expected_revision: state.revision,
                    action: RigAudioAction::Start {
                        settings: Box::new(StartRig {
                            revision: target.id,
                            stream,
                            recall: None,
                            prepared: vec![],
                            midi: None,
                        }),
                    },
                })
                .await?;
        }
        _ => return Err("MIDI set list contains an unsupported preset".into()),
    }
    crate::boosts::follow(shared).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(message: Message) -> Event {
        Event {
            message,
            local_program: false,
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
            }),
            None
        );
    }
}
