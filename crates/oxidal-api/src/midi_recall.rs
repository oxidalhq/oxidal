//! Global MIDI transport: Bank Select + Program Change recall the Mine set list.
//! A Program binding inside the sounding preset wins over global recall.
use crate::Shared;
use oxidal_audio::{
    lifecycle::{AudioAction, AudioCommand, AudioPhase, StartAudio},
    midi::Message,
};
use oxidal_engine::protocol::{RigAudioAction, RigAudioCommand, StartRig, SwitchCommand};
use oxidal_presets::{LibraryKind, LibraryOrigin};
use std::sync::{Arc, Weak};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Event {
    pub message: Message,
    pub local_program: bool,
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
            let Some((channel, slot)) = banks.apply(event) else {
                continue;
            };
            let Ok(map) = shared.midi_map.snapshot() else {
                continue;
            };
            if map.input.is_none() || (map.channel != 0 && map.channel != channel) {
                continue;
            }
            let _ = recall(&shared, slot).await;
        }
    });
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
