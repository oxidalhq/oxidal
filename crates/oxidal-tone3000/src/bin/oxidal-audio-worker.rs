//! Experimental playback process. EOF stops PCM; the editor lives in a different process.
#[cfg(target_os = "linux")]
use oxidal_audio::lifecycle::PLAYBACK_FRAME_BYTES;
#[cfg(target_os = "linux")]
use oxidal_tone3000::model_preparation as models;
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // First, so the engine's own DSP threads started below inherit it.
    eprintln!("Saved preset audio {}", oxidal_audio::realtime::enter());
    use oxidal_audio::{
        lifecycle::{PlaybackEvent, PlaybackStart, WorkerRequest},
        structure::AuthoringAction,
    };
    use oxidal_tone3000::Engine;
    use std::{
        io::{BufRead, Read, Write},
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::{Duration, Instant},
    };
    if std::env::args().nth(1).as_deref() == Some("--create-draft") {
        return create_draft();
    }
    if std::env::args().nth(1).as_deref() == Some("--prepare-parameter") {
        return prepare_parameter();
    }
    if std::env::args().nth(1).as_deref() == Some("--save-copy") {
        return save_copy();
    }
    let mut bytes = vec![];
    let mut input = std::io::stdin().lock();
    (&mut input)
        .take((PLAYBACK_FRAME_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > PLAYBACK_FRAME_BYTES || bytes.last() != Some(&b'\n') {
        return Err("invalid startup frame".into());
    }
    let startup: PlaybackStart = serde_json::from_slice(&bytes)?;
    let settings = startup.settings;
    settings.validate()?;
    drop(input);
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let (command_send, commands) = std::sync::mpsc::sync_channel::<WorkerRequest>(1);
    std::thread::spawn(move || {
        oxidal_audio::realtime::leave();
        let mut input = std::io::stdin().lock();
        loop {
            let mut bytes = vec![];
            let read = (&mut input).take(65537).read_until(b'\n', &mut bytes);
            if read.is_err() || bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
                break;
            }
            let Ok(request) = serde_json::from_slice(&bytes) else {
                break;
            };
            if command_send.try_send(request).is_err() {
                break;
            }
        }
        reader_stop.store(true, Ordering::Release);
    });
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let preset = if settings.owned || settings.draft {
        oxidal_presets::OwnedStore::new(root.join(if settings.draft {
            "working-native"
        } else {
            "owned"
        }))
        .read(&settings.preset_id)?
        .1
    } else {
        oxidal_presets::Store::new(root.clone()).original(&settings.preset_id)?
    };
    let preset_name = oxidal_presets::inspect(&preset)?.name;
    let mut engine = Engine::new(
        settings.stream.input.sample_rate.into(),
        settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    if let Some(id) = &settings.working {
        engine.restore(&oxidal_tone3000::working::read(
            &root,
            id,
            &oxidal_tone3000::working::origin(&settings),
        )?)?;
        engine.wait_ready()?;
    }
    models::restore(
        &mut engine,
        &root,
        &startup.models,
        settings.stream.input.period_frames as usize,
    )?;
    if let Some(midi) = &settings.midi {
        midi.validate_native_restore(&engine.live_controls()?)?;
    }
    let mut midi = oxidal_audio::midi::Connection::new(settings.midi.clone());
    let mut midi_readback_events = 0;
    let mut models = models::Models::default();
    let mut authoring = oxidal_tone3000::working::Authoring::new(&root, &settings);
    if let Some(controls) = startup.controls {
        engine.apply_live_snapshot(&controls)?;
        engine.wait_ready()?;
    }
    if let Some(eq) = startup.eq {
        engine.restore_eq(&eq, &mut 0)?;
    }
    engine.set_solo(oxidal_audio::tools::Solo::None)?;
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    #[cfg(feature = "audio-qualification")]
    let null = std::env::var("OXIDAL_AUDIO_QUALIFY_NULL").is_ok_and(|v| v == "1");
    #[cfg(not(feature = "audio-qualification"))]
    let null = false;
    let (meter_send, meter_recv) = std::sync::mpsc::sync_channel::<PlaybackEvent>(2);
    // A bounded writer isolates JSON/pipe backpressure from processing. Overflow drops
    // intermediate views; cumulative clipping counts survive the next delivered snapshot.
    std::thread::spawn(move || {
        oxidal_audio::realtime::leave();
        while let Ok(snapshot) = meter_recv.recv() {
            let mut output = std::io::stdout().lock();
            let Ok(mut bytes) = serde_json::to_vec(&snapshot) else {
                break;
            };
            bytes.push(b'\n');
            if output
                .write_all(&bytes)
                .and_then(|()| output.flush())
                .is_err()
            {
                break;
            }
        }
    });
    // Request replies reuse the last readback unless the request can change it:
    // rebuilding the catalog, slots and EQ through the native engine is costly.
    let mut readback: Option<Readback> = None;
    let mut last_status: Option<oxidal_audio::structure::AuthoringStatus> = None;
    let period = Duration::from_secs_f64(
        f64::from(settings.stream.input.period_frames)
            / f64::from(settings.stream.input.sample_rate),
    );
    // Realtime handoff: a dedicated audio thread owns the ALSA stream and only
    // renders; this owner thread (JUCE's message thread) serves every request,
    // MIDI and readback, so control work can never delay a block.
    // SAFETY: the scope below joins the audio thread before `engine` is dropped,
    // and the owner releases the binding after that join.
    let port = unsafe { engine.audio_port() };
    let (host_send, host_recv) =
        std::sync::mpsc::sync_channel::<oxidal_audio::tools::HostUtility>(1);
    let (note_send, notes) = std::sync::mpsc::sync_channel::<AudioNote>(4);
    let stream_config = settings.stream.clone();
    let periods = settings.stream.output.periods;
    let audio_stop = stop.clone();
    let audio_meters = meter_send.clone();
    let result = std::thread::scope(|scope| -> Result<(), Box<dyn std::error::Error>> {
        let audio = scope.spawn(move || {
            let outcome = render(
                port,
                stream_config,
                null,
                periods,
                &audio_stop,
                &audio_meters,
                &host_recv,
                &note_send,
            );
            if let Err(error) = &outcome {
                let _ = note_send.try_send(AudioNote::Failed(error.clone()));
            }
            audio_stop.store(true, Ordering::Release);
            outcome
        });
        // Any early return below stops the audio thread before the scope joins it.
        let _stop_audio = StopOnDrop(stop.clone());
        oxidal_audio::realtime::leave();
        let mut primed = false;
        while !stop.load(Ordering::Acquire) {
            match notes.try_recv() {
                Ok(AudioNote::Primed) => {
                    meter_send.send(PlaybackEvent::Ready {
                        preset_name: preset_name.clone(),
                        authoring: Some(authoring.snapshot(&mut engine)?),
                        controls: engine.live_controls()?,
                        slots: engine.slots()?,
                        eq: engine.eq_snapshot()?,
                    })?;
                    primed = true;
                }
                Ok(AudioNote::Failed(error)) => return Err(error.into()),
                Ok(AudioNote::Host(_)) | Err(_) => {}
            }
            if !primed {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            {
                let blocked = models.pending()
                    || authoring.measurement_pending()
                    || authoring.gesture_pending();
                let mut moved = false;
                midi.poll(|settings, message| {
                    moved = true;
                    oxidal_tone3000::midi::dispatch(&mut engine, settings, message, blocked)
                });
                // A MIDI CC can move any control: the next reply reads them again.
                if moved {
                    readback = None;
                }
            }
            let request = match commands.recv_timeout(Duration::from_millis(2)) {
                Ok(request) => request,
                Err(_) => continue,
            };
            {
                let started = Instant::now();
                let kind = request_kind(&request);
                let event = match request {
                    WorkerRequest::HostUtility(request) => {
                        // The stream lives on the audio thread: it applies the change
                        // between blocks and answers with its telemetry.
                        host_send.send(request.host_utility)?;
                        let telemetry = loop {
                            match notes.recv_timeout(Duration::from_secs(1)) {
                                Ok(AudioNote::Host(telemetry)) => break telemetry,
                                Ok(AudioNote::Failed(error)) => return Err(error.into()),
                                Ok(AudioNote::Primed) => continue,
                                Err(_) => return Err("Audio thread did not answer".into()),
                            }
                        };
                        PlaybackEvent::HostUtility {
                            serial: request.serial,
                            telemetry,
                        }
                    }
                    WorkerRequest::Midi(request) => {
                        let configure = matches!(
                            &request.midi,
                            oxidal_audio::lifecycle::MidiOperation::Configure { .. }
                        );
                        let test = matches!(
                            &request.midi,
                            oxidal_audio::lifecycle::MidiOperation::Test { .. }
                        );
                        let error = match request.midi {
                            oxidal_audio::lifecycle::MidiOperation::Protect { on } => {
                                midi.protect(on);
                                None
                            }
                            oxidal_audio::lifecycle::MidiOperation::Poll => None,
                            oxidal_audio::lifecycle::MidiOperation::Test { message } => {
                                let blocked = models.pending()
                                    || authoring.measurement_pending()
                                    || authoring.gesture_pending();
                                midi.test(message, |settings, message| {
                                    oxidal_tone3000::midi::dispatch(
                                        &mut engine,
                                        settings,
                                        message,
                                        blocked,
                                    )
                                })
                                .and_then(|mapped| {
                                    mapped.then_some(()).ok_or_else(|| {
                                        "This message is not mapped in the playing preset".into()
                                    })
                                })
                                .err()
                            }
                            oxidal_audio::lifecycle::MidiOperation::Configure { settings } => {
                                let controls = engine.live_controls()?;
                                match settings
                                    .as_ref()
                                    .map(|s| s.validate_native(&controls))
                                    .transpose()
                                {
                                    Ok(_) => {
                                        midi.configure(settings);
                                        None
                                    }
                                    Err(error) => Some(error),
                                }
                            }
                        };
                        // Idle connection polls do not rebuild a potentially dense catalog.
                        let controls =
                            if configure || test || midi.status.events != midi_readback_events {
                                Some(engine.live_controls()?)
                            } else {
                                None
                            };
                        midi_readback_events = midi.status.events;
                        PlaybackEvent::Midi {
                            serial: request.serial,
                            status: midi.status.clone(),
                            controls,
                            error,
                        }
                    }
                    WorkerRequest::Authoring(request) => {
                        let mutating = request.authoring.changes_tone();
                        // A finishing measurement or an expiring gesture writes controls
                        // even during a poll, so only a quiet poll may reuse the readback.
                        let quiet = !authoring.measurement_pending();
                        let gesture_before = authoring.gesture_pending();
                        // Polls and inspections read; previews move only control values.
                        let reads_only = quiet
                            && matches!(
                                request.authoring,
                                AuthoringAction::Inspect
                                    | AuthoringAction::Utility {
                                        command: oxidal_audio::tools::Command::Poll
                                    }
                            );
                        // Adjustments move one control or EQ value, never the chain's slots.
                        let values_only =
                            matches!(request.authoring, AuthoringAction::Gesture { .. });
                        let quiet_poll = matches!(
                            request.authoring,
                            AuthoringAction::Utility {
                                command: oxidal_audio::tools::Command::Poll
                            }
                        ) && authoring.poll_is_quiet();
                        // Adopt background checkpoints first: their receipts are not this request's edit.
                        authoring.collect_receipts();
                        let before_working = authoring.working_receipt().map(str::to_owned);
                        let result = if quiet_poll && let Some(status) = last_status.clone() {
                            Ok(status)
                        } else if models.pending() {
                            Err("Finish model preparation before changing the chain".into())
                        } else {
                            authoring.command(&mut engine, request.authoring)
                        };
                        if authoring.failed() {
                            return Err("Native authoring rollback failed; worker stopped".into());
                        }
                        let (status, error) = match result {
                            Ok(status) => {
                                if mutating || status.working != before_working {
                                    models = models::Models::default();
                                }
                                (status, None)
                            }
                            Err(error) => (authoring.snapshot(&mut engine)?, Some(error)),
                        };
                        let current = match readback.take() {
                            Some(cached)
                                if (quiet_poll || reads_only)
                                    && !mutating
                                    && authoring.gesture_pending() == gesture_before =>
                            {
                                cached
                            }
                            Some(mut cached) if values_only => {
                                cached.controls = engine.live_controls()?;
                                cached.eq = engine.eq_snapshot()?;
                                cached
                            }
                            _ => Readback::read(&mut engine)?,
                        };
                        last_status = Some(status.clone());
                        let event = PlaybackEvent::Authored {
                            serial: request.serial,
                            authoring: status,
                            controls: current.controls.clone(),
                            slots: current.slots.clone(),
                            eq: current.eq.clone(),
                            error,
                        };
                        readback = Some(current);
                        event
                    }
                    WorkerRequest::Eq(request) => {
                        readback = None;
                        let error = if models.pending()
                            || authoring.measurement_pending()
                            || authoring.gesture_pending()
                        {
                            Some("Finish model preparation before adjusting EQ".into())
                        } else {
                            engine
                                .set_eq(&request.block_id, &request.eq)
                                .err()
                                .map(|e| e.to_string())
                        };
                        PlaybackEvent::Eq {
                            serial: request.serial,
                            eq: engine.eq_snapshot()?,
                            error,
                        }
                    }

                    WorkerRequest::Control(request) => {
                        readback = None;
                        let error = if models.pending()
                            || authoring.measurement_pending()
                            || authoring.gesture_pending()
                        {
                            Some(
                                "Model preparation is pending; cancel before adjusting controls"
                                    .into(),
                            )
                        } else {
                            engine
                                .set_live_control(&request.target, request.value)
                                .err()
                                .map(|e| e.to_string())
                        };
                        PlaybackEvent::Control {
                            serial: request.serial,
                            controls: engine.live_controls()?,
                            error,
                        }
                    }
                    WorkerRequest::Model(request) => {
                        readback = None;
                        let result =
                            if authoring.measurement_pending() || authoring.gesture_pending() {
                                Err("Cancel measurement before loading models".into())
                            } else {
                                models.operation(&mut engine, &root, request.model, request.serial)
                            };
                        let (mut progress, error) = match result {
                            Ok(p) => (p, None),
                            Err(e) => (None, Some(e)),
                        };
                        let status = if let Some(before) = models.take_applied_history() {
                            match authoring.record_external(&mut engine, before) {
                                Ok(status) => Some(status),
                                Err(error) => {
                                    if authoring.failed() {
                                        return Err(error.into());
                                    }
                                    progress = models.reject_history(error);
                                    None
                                }
                            }
                        } else {
                            None
                        };
                        PlaybackEvent::Model {
                            authoring: status,
                            serial: request.serial,
                            progress,
                            controls: engine.live_controls()?,
                            slots: engine.slots()?,
                            eq: engine.eq_snapshot()?,
                            error,
                        }
                    }
                };
                let took = started.elapsed();
                if took > period * 8 {
                    eprintln!(
                        "Slow {kind} request: {:.2} ms (audio renders on its own thread)",
                        took.as_secs_f64() * 1000.0
                    );
                }
                meter_send.send(event)?;
            }
        }
        stop.store(true, Ordering::Release);
        audio
            .join()
            .map_err(|_| "Audio thread panicked")?
            .map_err(Into::into)
    });
    // The audio thread has been joined and its PCM released.
    engine.release_audio_thread()?;
    result
}
#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("Audio worker requires Linux ALSA".into())
}

/// Export runs in a separate process and never opens PCM or changes the sounding engine.
#[cfg(target_os = "linux")]
fn save_copy() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::lifecycle::{SavePlayback, valid_controls, valid_preset_name};
    use std::io::{BufRead, Read, Write};
    let mut bytes = vec![];
    std::io::stdin()
        .lock()
        .take((PLAYBACK_FRAME_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > PLAYBACK_FRAME_BYTES || bytes.last() != Some(&b'\n') {
        return Err("Invalid save request".into());
    }
    let request: SavePlayback = serde_json::from_slice(&bytes)?;
    request.settings.validate()?;
    if !valid_preset_name(&request.name) || !valid_controls(&request.controls) {
        return Err("Invalid save name or controls".into());
    }
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let owned = oxidal_presets::OwnedStore::new(root.join("owned"));
    let source = if request.settings.owned || request.settings.draft {
        oxidal_presets::OwnedStore::new(root.join(if request.settings.draft {
            "working-native"
        } else {
            "owned"
        }))
        .read(&request.settings.preset_id)?
        .0
        .source_sha256
    } else {
        Some(request.settings.preset_id.clone())
    };
    let mut engine = oxidal_tone3000::working::reconstruct(&root, &request)?;
    let eq = engine.eq_snapshot()?;
    let model_identities = models::identities(&mut engine)?;
    let bytes = engine.save_preset(&request.name)?;
    // A fresh engine prevents retained device/session values hiding a lossy export.
    drop(engine);
    let mut engine = oxidal_tone3000::Engine::new(
        request.settings.stream.input.sample_rate.into(),
        request.settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&bytes)?;
    engine.wait_ready()?;
    if models::identities(&mut engine)? != model_identities {
        return Err("Saved model identity differs".into());
    }
    if engine.eq_snapshot()? != eq {
        return Err("Saved EQ readback differs".into());
    }
    let restored = engine.live_controls()?;
    if restored.len() != request.controls.len()
        || request.controls.iter().any(|c| {
            !restored
                .iter()
                .any(|a| a.target == c.target && (a.value - c.value).abs() < 1e-5)
        })
    {
        return Err("Saved control readback differs".into());
    }
    if !request.settings.draft {
        use oxidal_presets::{DetailsStore, LibraryKind, LibraryReference, inspect};
        DetailsStore::new(root).inherit(
            LibraryReference {
                kind: LibraryKind::Owned,
                id: inspect(&bytes)?.sha256,
            },
            LibraryReference {
                kind: if request.settings.owned {
                    LibraryKind::Owned
                } else {
                    LibraryKind::Original
                },
                id: request.settings.preset_id.clone(),
            },
        )?;
    }
    let saved = match source {
        Some(source) => owned.save(&source, &bytes)?,
        None => owned.save_created(&bytes)?,
    };
    println!("{}", saved.id);
    std::io::stdout().flush()?;
    Ok(())
}

/// Isolated, non-PCM factory. The working base is not a named library Save.
#[cfg(target_os = "linux")]
fn create_draft() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{BufRead, Read, Write};
    let mut bytes = vec![];
    std::io::stdin()
        .lock()
        .take(1025)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > 1024 || bytes.last() != Some(&b'\n') {
        return Err("Invalid new rig request".into());
    }
    let name: String = serde_json::from_slice(&bytes)?;
    if !oxidal_audio::lifecycle::valid_preset_name(&name) {
        return Err("Invalid new rig name".into());
    }
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let mut engine = oxidal_tone3000::Engine::new(48000.0, 128)?;
    engine.reset_empty()?;
    let bytes = engine.save_preset(name.trim())?;
    let slots = engine.chain()?;
    drop(engine);
    let mut verify = oxidal_tone3000::Engine::new(48000.0, 128)?;
    verify.load_preset(&bytes)?;
    verify.wait_ready()?;
    if !verify.runtime()?["blocks"]
        .as_array()
        .is_some_and(Vec::is_empty)
    {
        return Err("New rig contains unexpected models".into());
    }
    let recalled = verify.chain()?;
    for lane in ["chain", "chainRight"] {
        if slots[lane] != recalled[lane] {
            return Err("New rig slot identities changed".into());
        }
    }
    let info = oxidal_presets::OwnedStore::new(root.join("working-native")).save_created(&bytes)?;
    println!("{}", info.id);
    std::io::stdout().flush()?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn prepare_parameter() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Read;
    let mut bytes = vec![];
    std::io::stdin()
        .take((PLAYBACK_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > PLAYBACK_FRAME_BYTES {
        return Err("Native preparation request too large".into());
    }
    let request: oxidal_audio::structure::PrepareParameter = serde_json::from_slice(&bytes)?;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let mut engine = oxidal_tone3000::working::reconstruct(&root, &request.playback)?;
    let mut authoring = oxidal_tone3000::working::Authoring::new(&root, &request.playback.settings);
    let status = authoring.prepare_parameter(&mut engine, request.parameter, request.value)?;
    println!(
        "{}",
        status.working.ok_or("Missing prepared native receipt")?
    );
    Ok(())
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
struct Readback {
    controls: Vec<oxidal_audio::lifecycle::LiveControl>,
    slots: Vec<oxidal_audio::lifecycle::NativeSlot>,
    eq: Vec<oxidal_audio::eq::BlockEqState>,
}
#[cfg(target_os = "linux")]
impl Readback {
    fn read(engine: &mut oxidal_tone3000::Engine) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            controls: engine.live_controls()?,
            slots: engine.slots()?,
            eq: engine.eq_snapshot()?,
        })
    }
}
#[cfg(target_os = "linux")]
fn request_kind(request: &oxidal_audio::lifecycle::WorkerRequest) -> &'static str {
    use oxidal_audio::lifecycle::WorkerRequest;
    match request {
        WorkerRequest::HostUtility(_) => "host",
        WorkerRequest::Midi(_) => "MIDI",
        WorkerRequest::Authoring(_) => "authoring",
        WorkerRequest::Eq(_) => "EQ",
        WorkerRequest::Control(_) => "control",
        WorkerRequest::Model(_) => "model",
    }
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
enum AudioNote {
    /// The playback queue is full: the owner announces Ready.
    Primed,
    /// Telemetry after a host utility change.
    Host(oxidal_audio::meter::Snapshot),
    Failed(String),
}
#[cfg(target_os = "linux")]
#[derive(Debug)]
struct StopOnDrop(std::sync::Arc<std::sync::atomic::AtomicBool>);
#[cfg(target_os = "linux")]
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }
}
/// The realtime audio thread: owns the duplex stream and renders through the
/// bound port. Nothing here touches the engine's control or state API.
#[cfg(target_os = "linux")]
#[allow(clippy::too_many_arguments)]
fn render(
    mut port: oxidal_tone3000::AudioPort,
    config: oxidal_audio::StreamConfig,
    null: bool,
    periods: u32,
    stop: &std::sync::atomic::AtomicBool,
    meters: &std::sync::mpsc::SyncSender<oxidal_audio::lifecycle::PlaybackEvent>,
    host: &std::sync::mpsc::Receiver<oxidal_audio::tools::HostUtility>,
    notes: &std::sync::mpsc::SyncSender<AudioNote>,
) -> Result<(), String> {
    use oxidal_audio::stream::{Duplex, Step};
    use std::{
        sync::atomic::Ordering,
        time::{Duration, Instant},
    };
    port.bind().map_err(|e| e.to_string())?;
    let mut stream = {
        #[cfg(feature = "audio-qualification")]
        if null {
            Duplex::qualification_null(config.clone())?
        } else {
            Duplex::open(config.clone())?
        }
        #[cfg(not(feature = "audio-qualification"))]
        Duplex::open(config.clone())?
    };
    let mut blocks = 0;
    let mut last_meter = Instant::now();
    let mut last_block = Instant::now();
    while !stop.load(Ordering::Acquire) {
        if stream.step(|l, r| port.process(l, r).map_err(|e| e.to_string()))? == Step::Processed {
            last_block = Instant::now();
            if blocks < periods - 1 {
                blocks += 1;
                if blocks == periods - 1 {
                    notes
                        .send(AudioNote::Primed)
                        .map_err(|_| "Worker owner stopped".to_string())?;
                }
            }
            if blocks >= periods - 1 && last_meter.elapsed() >= Duration::from_millis(200) {
                let _ = meters.try_send(oxidal_audio::lifecycle::PlaybackEvent::Meter {
                    snapshot: stream.telemetry(),
                });
                last_meter = Instant::now();
            }
            // ALSA null has no clock; pace only that explicit software fixture.
            if null {
                std::thread::sleep(Duration::from_secs_f64(
                    f64::from(config.input.period_frames) / f64::from(config.input.sample_rate),
                ));
            }
        } else if last_block.elapsed() > Duration::from_secs(2) {
            return Err("Audio device made no progress for two seconds".into());
        }
        if let Ok(command) = host.try_recv() {
            stream.host_utility(command);
            let _ = notes.try_send(AudioNote::Host(stream.telemetry()));
        }
    }
    drop(stream); // PCM is released before the owner releases the engine.
    Ok(())
}
