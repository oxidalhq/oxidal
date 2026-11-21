//! One main-thread native/LV2 owner; EOF terminates PCM. Export runs separately.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // First, so the engine's own DSP threads started below inherit it.
    if std::env::args().nth(1).as_deref() == Some("--check-built-rig") {
        oxidal_audio::realtime::background_owner();
    } else {
        eprintln!("Hybrid audio {}", oxidal_audio::realtime::enter());
    }
    use std::io::Write;
    let result = run();
    if let Err(error) = &result
        && std::env::args().len() == 1
    {
        // run() has dropped the response sender and all processor ownership.
        // The writer releases stdout before this terminal frame is emitted.
        // Preparation may fail before any valid control snapshot exists.
        let message: String = error
            .to_string()
            .chars()
            .filter(|c| !c.is_control())
            .take(1024)
            .collect();
        let failure = oxidal_engine::protocol::WorkerFailure {
            failure: if message.trim().is_empty() {
                "Mixed worker failed".into()
            } else {
                message
            },
        };
        let mut stdout = std::io::stdout().lock();
        serde_json::to_writer(&mut stdout, &failure)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    result
}
#[cfg(target_os = "linux")]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::stream::{Duplex, Step};
    use oxidal_engine::{ResidentSet, protocol::*};
    use oxidal_lv2::World;
    use oxidal_presets::BundleStore;
    use std::{
        io::{BufRead, Read, Write},
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        time::{Duration, Instant},
    };
    fn frame<R: BufRead>(r: &mut R) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        r.take((REQUEST_LIMIT + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > REQUEST_LIMIT || bytes.last() != Some(&b'\n') {
            return Err("Invalid rig request frame".into());
        }
        Ok(bytes)
    }
    let store = BundleStore::new(std::path::PathBuf::from(std::env::var(
        "OXIDAL_BUNDLE_STORE",
    )?));
    let model_root = std::env::var_os("OXIDAL_PRESET_DIR").map(std::path::PathBuf::from);
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        if args == ["--check-built-rig"] {
            let settings: StartRig = serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
            let result: Result<(), String> = (|| {
                let world = World::discover().map_err(|error| error.to_string())?;
                let mut resident = ResidentSet::new_with_models(
                    &store,
                    &world,
                    &settings,
                    BUFFER_BUDGET,
                    model_root.as_deref(),
                )?;
                let scenes = resident.snapshot().scenes.ok_or("No built scenes")?;
                if scenes.scenes.len() != 4 {
                    return Err("Expected four built scenes".into());
                }
                let n = settings.stream.input.period_frames as usize;
                let mut input = vec![0.0; n];
                input[0] = 0.125;
                let mut left = vec![0.0; n];
                let mut right = left.clone();
                for scene in scenes.scenes {
                    resident.active_mut().prepare_initial_scene(scene.id)?;
                    resident.process(&[&input, &input], &mut [&mut left, &mut right])?;
                    resident.pump()?;
                }
                Ok(())
            })();
            serde_json::to_writer(std::io::stdout().lock(), &result)?;
            std::io::stdout().flush()?;
            return Ok(());
        }
        if args == ["--check-occurrence"] {
            let request: OccurrenceStart =
                serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
            let result: Result<(), String> = (|| {
                let world = World::discover().map_err(|error| error.to_string())?;
                let mut resident = ResidentSet::new_with_models(
                    &store,
                    &world,
                    &request.settings,
                    BUFFER_BUDGET,
                    model_root.as_deref(),
                )?;
                resident.active_mut().prepare_initial_scene(request.scene)?;
                let n = request.settings.stream.input.period_frames as usize;
                let zeros = vec![0.0; n];
                resident.process(
                    &[&zeros, &zeros],
                    &mut [&mut vec![0.0; n], &mut vec![0.0; n]],
                )?;
                resident.pump()
            })();
            serde_json::to_writer(std::io::stdout().lock(), &result)?;
            std::io::stdout().flush()?;
            return Ok(());
        }
        if args == ["--prepare-native-edit"] {
            let request: PrepareNativeEdit =
                serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
            let world = World::discover()?;
            let recall = oxidal_engine::prepare_native_edit(
                &store,
                &world,
                request,
                model_root.as_deref().ok_or("Model store unavailable")?,
            )?;
            serde_json::to_writer(std::io::stdout().lock(), &recall)?;
            std::io::stdout().flush()?;
            return Ok(());
        }
        if args != ["--save-revision"] {
            return Err("Unknown rig worker mode".into());
        }
        let (request, target) = serde_json::from_slice::<
            oxidal_audio::lifecycle::SaveInput<SaveRequest>,
        >(&frame(&mut std::io::stdin().lock())?)?
        .into_parts();
        let world = World::discover()?;
        let revision = if let Some(target) = target {
            oxidal_engine::save_named_version(
                &store,
                &world,
                request,
                model_root.as_deref().ok_or("Missing version store")?,
                target,
            )?
        } else if let Some(root) = &model_root {
            oxidal_engine::save_revision_with_models(&store, &world, request, root)?
        } else {
            oxidal_engine::save_revision(&store, &world, request)?
        };
        serde_json::to_writer(std::io::stdout().lock(), &revision)?;
        std::io::stdout().flush()?;
        return Ok(());
    }
    let bytes = frame(&mut std::io::stdin().lock())?;
    let (settings, starting_scene) = match serde_json::from_slice::<OccurrenceStart>(&bytes) {
        Ok(request) => (request.settings, Some(request.scene)),
        Err(_) => (serde_json::from_slice::<StartRig>(&bytes)?, None),
    };
    settings.validate()?;
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let (commands, received) = mpsc::sync_channel::<WorkerRequest>(1);
    std::thread::spawn(move || {
        oxidal_audio::realtime::leave();
        let mut input = std::io::stdin().lock();
        while let Ok(bytes) = frame(&mut input) {
            let Ok(request) = serde_json::from_slice(&bytes) else {
                break;
            };
            if commands.try_send(request).is_err() {
                break;
            }
        }
        reader_stop.store(true, Ordering::Release);
    });
    let (responses, output) = mpsc::sync_channel::<WorkerReply>(1);
    let writer_stop = stop.clone();
    std::thread::spawn(move || {
        oxidal_audio::realtime::leave();
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let mut stdout = std::io::stdout().lock();
            while let Ok(response) = output.recv() {
                let mut bytes = serde_json::to_vec(&response)?;
                if bytes.len() >= REPLY_LIMIT {
                    return Err("Rig reply too large".into());
                }
                bytes.push(b'\n');
                stdout.write_all(&bytes)?;
                stdout.flush()?;
            }
            Ok(())
        })();
        if result.is_err() {
            writer_stop.store(true, Ordering::Release);
        }
    });
    let world = World::discover()?;
    // Before the rig is built, so its graphs create their lane helpers now on
    // this thread rather than later on the render thread.
    oxidal_engine::render::enable_render_thread();
    let mut session = ResidentSet::new_with_models(
        &store,
        &world,
        &settings,
        BUFFER_BUDGET,
        model_root.as_deref(),
    )?;
    if let Some(scene) = starting_scene {
        session.active_mut().prepare_initial_scene(scene)?;
    }
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    #[cfg(feature = "qualification")]
    let null = std::env::var("OXIDAL_RIG_QUALIFY_NULL").is_ok_and(|v| v == "1");
    #[cfg(not(feature = "qualification"))]
    let null = false;
    fn validate_midi(
        settings: &Option<oxidal_audio::midi::Settings>,
        session: &ResidentSet,
    ) -> Result<(), String> {
        if let Some(settings) = settings {
            session.snapshot().validate_midi(settings)?;
        }
        Ok(())
    }
    if let Some(settings) = &settings.midi {
        session.snapshot().validate_restored_midi(settings)?;
    }
    let mut midi = oxidal_audio::midi::Connection::new(settings.midi.clone());
    fn snapshot(session: &ResidentSet, midi: &oxidal_audio::midi::Status) -> Snapshot {
        let mut state = session.snapshot();
        state.midi = midi.clone();
        state
    }
    // Realtime handoff: a SCHED_RR render thread owns the duplex stream and only
    // processes the rig; this owner thread (JUCE's message thread, which built
    // the rig) does MIDI, JUCE pumping, switching and every request. They share
    // the rig under a short lock.
    let shared = oxidal_engine::render::SharedRig::new(session);
    let frames = std::sync::atomic::AtomicU64::new(0);
    let ready = AtomicBool::new(false);
    let failure = std::sync::Mutex::new(None::<String>);
    let telemetry = std::sync::Mutex::new(oxidal_audio::meter::Snapshot::default());
    let (host_send, host_recv) = mpsc::sync_channel::<oxidal_audio::tools::HostUtility>(1);
    let period_frames = u64::from(settings.stream.input.period_frames);
    let prime_frames =
        u64::from(settings.stream.input.period_frames * (settings.stream.output.periods - 1));
    let result = std::thread::scope(|scope| -> Result<(), Box<dyn std::error::Error>> {
        let render = scope.spawn(|| {
            // Moved in: only the render thread receives host utilities.
            let host_recv = host_recv;
            let outcome = (|| -> Result<(), String> {
                let mut left = vec![0.0; settings.stream.input.period_frames as usize];
                let mut right = left.clone();
                let zero = left.clone();
                // Bind and warm the active graph on its permanent render thread
                // before ALSA starts. Complex NAM/convolution graphs can spend
                // several audio periods binding ports and filling cold internal
                // schedules; doing that after capture has started turns a graph
                // that fits at steady state into an immediate xrun burst.
                for _ in 0..8 {
                    shared.render(&[&zero, &zero], &mut [&mut left, &mut right])?;
                }
                left.fill(0.0);
                right.fill(0.0);
                let mut stream = {
                    #[cfg(feature = "qualification")]
                    if null {
                        Duplex::qualification_null(settings.stream.clone())?
                    } else {
                        Duplex::open(settings.stream.clone())?
                    }
                    #[cfg(not(feature = "qualification"))]
                    Duplex::open(settings.stream.clone())?
                };
                let mut progress = Instant::now();
                let mut published = Instant::now();
                #[cfg(feature = "qualification")]
                let mut qualification_clock = oxidal_audio::stream::QualificationClock::new(
                    settings.stream.input.period_frames,
                    settings.stream.input.sample_rate,
                );
                while !stop.load(Ordering::Acquire) {
                    let step = stream.step(|l, r| {
                        left.copy_from_slice(l);
                        right.copy_from_slice(r);
                        shared.render(&[&left, &right], &mut [l, r])
                    })?;
                    if step == Step::Processed {
                        let total =
                            frames.fetch_add(period_frames, Ordering::AcqRel) + period_frames;
                        progress = Instant::now();
                        if total >= prime_frames {
                            ready.store(true, Ordering::Release);
                        }
                        if published.elapsed() >= Duration::from_millis(50) {
                            if let Ok(mut slot) = telemetry.try_lock() {
                                *slot = stream.telemetry();
                            }
                            published = Instant::now();
                        }
                        if null {
                            #[cfg(feature = "qualification")]
                            qualification_clock.wait();
                        }
                    } else if progress.elapsed() > Duration::from_secs(2) {
                        return Err("Rig PCM made no progress for two seconds".into());
                    }
                    if let Ok(command) = host_recv.try_recv() {
                        stream.host_utility(command);
                        if let Ok(mut slot) = telemetry.lock() {
                            *slot = stream.telemetry();
                        }
                    }
                }
                drop(stream);
                Ok(())
            })();
            if let Err(error) = &outcome {
                eprintln!("Hybrid render stopped: {error}");
                if let Ok(mut slot) = failure.lock() {
                    *slot = Some(error.clone());
                }
            }
            stop.store(true, Ordering::Release);
            outcome
        });
        // Any early return stops the render thread before the scope joins it.
        let _stop_render = StopOnDrop(stop.clone());
        oxidal_audio::realtime::leave();
        let latest = || telemetry.lock().map(|t| *t).unwrap_or_default();
        let mut announced = false;
        let mut switch_reply = false;
        let mut switch_midi = None;
        let mut pump = Instant::now();
        let mut reported = Instant::now();
        while !stop.load(Ordering::Acquire) {
            if reported.elapsed() >= Duration::from_secs(2) {
                // Evidence for dropouts: how long audio waited behind this thread.
                let waited = shared.take_render_wait();
                if waited > Duration::from_millis(1) {
                    eprintln!(
                        "Render waited up to {:.1} ms for the rig lock",
                        waited.as_secs_f64() * 1000.0
                    );
                }
                reported = Instant::now();
            }
            if let Ok(slot) = failure.lock()
                && let Some(error) = slot.clone()
            {
                return Err(error.into());
            }
            let primed = ready.load(Ordering::Acquire);
            if primed && !announced {
                let rig = shared.lock("announce");
                if !rig.healthy() {
                    return Err("Rig failed before confirming startup".into());
                }
                let control = snapshot(&rig, &midi.status);
                drop(rig);
                responses.send(WorkerReply {
                    control,
                    telemetry: latest(),
                    processed_frames: frames.load(Ordering::Acquire),
                    error: None,
                })?;
                announced = true;
            }
            // Shared bounded, nonblocking reads outside PCM; failures stay in MIDI status.
            if primed && !switch_reply && !shared.lock("midi state").switching() {
                // Device enumeration/open on a disconnected MIDI input can
                // take several audio periods. Only dispatching a received
                // message needs the rig; retries must never hold its lock.
                midi.poll(|settings, message| {
                    shared
                        .lock("midi message")
                        .active_mut()
                        .midi_message(settings, message)
                });
            }
            if pump.elapsed() >= Duration::from_millis(10) {
                // JUCE dispatch waits up to 1 ms: run it outside the rig lock so
                // the render thread never waits for it.
                let dispatcher = shared.lock("dispatcher").dispatcher();
                if let Some(dispatcher) = dispatcher {
                    dispatcher.pump().map_err(|e| e.to_string())?;
                }
                shared.lock("tick").tick()?;
                pump = Instant::now();
            }
            if switch_reply && !shared.lock("switch check").switching() {
                let mut rig = shared.lock("switch reply");
                if !rig.healthy() {
                    return Err("Rig failed before confirming the preset switch".into());
                }
                let error = rig.take_switch_error();
                if error.is_none() {
                    midi.configure(switch_midi.take());
                } else {
                    switch_midi = None;
                }
                let control = snapshot(&rig, &midi.status);
                drop(rig);
                responses.send(WorkerReply {
                    control,
                    telemetry: latest(),
                    processed_frames: frames.load(Ordering::Acquire),
                    error,
                })?;
                switch_reply = false;
            }
            if !announced || switch_reply {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            let Ok(request) = received.recv_timeout(Duration::from_millis(2)) else {
                continue;
            };
            let what = match &request {
                WorkerRequest::Protect { .. } => "protect",
                WorkerRequest::HostUtility { .. } => "host utility",
                WorkerRequest::Status => "status",
                WorkerRequest::Tempo { .. } => "tempo",
                WorkerRequest::SettleAuthoring => "settle authoring",
                WorkerRequest::Authoring { .. } => "authoring",
                WorkerRequest::Midi { .. } => "midi settings",
                WorkerRequest::MidiTest { .. } => "midi test",
                WorkerRequest::MidiLearn { .. } => "midi learn",
                WorkerRequest::Control { .. } => "control",
                WorkerRequest::RestorePluginDefaults { .. } => "restore plugin defaults",
                WorkerRequest::Scene { .. } => "scene",
                WorkerRequest::StompGroup { .. } => "stomp group",
                WorkerRequest::Branch { .. } => "branch",
                WorkerRequest::BranchSleep { .. } => "sleeping branches",
                WorkerRequest::Eq { .. } => "eq",
                WorkerRequest::Model { .. } => "model",
                WorkerRequest::Switch { .. } | WorkerRequest::RecallSwitch { .. } => "switch",
            };
            let mut rig = shared.lock(what);
            let error = match request {
                WorkerRequest::Protect { on } => {
                    midi.protect(on);
                    if on {
                        rig.active_mut().cancel_protected_scene_preview().err()
                    } else {
                        None
                    }
                }
                WorkerRequest::HostUtility { command } => {
                    drop(rig);
                    host_send.send(command)?;
                    // The render thread applies it between blocks.
                    std::thread::sleep(Duration::from_millis(5));
                    rig = shared.lock("host utility");
                    None
                }
                WorkerRequest::Status => None,
                WorkerRequest::Tempo { bpm } => {
                    rig.set_host_tempo(bpm);
                    None
                }
                WorkerRequest::SettleAuthoring => {
                    let deadline = Instant::now() + Duration::from_secs(2);
                    loop {
                        match rig.active_mut().settle_authoring() {
                            Ok(true) => break None,
                            Ok(false) if Instant::now() < deadline => {
                                drop(rig);
                                std::thread::sleep(Duration::from_millis(2));
                                rig = shared.lock("settle authoring");
                            }
                            Ok(false) => break Some("Mixed history is still being saved".into()),
                            Err(error) => break Some(error),
                        }
                    }
                }
                WorkerRequest::Authoring { command } => match model_root.as_deref() {
                    Some(root) => rig.active_mut().authoring_command(command, root).err(),
                    None => Some("Native working store unavailable".into()),
                },
                WorkerRequest::Midi { settings } => match validate_midi(&settings, &rig) {
                    Err(error) => Some(error),
                    Ok(()) => {
                        midi.configure(settings);
                        None
                    }
                },
                WorkerRequest::MidiLearn { on } => {
                    midi.learn(on);
                    None
                }
                WorkerRequest::MidiTest { message } => midi
                    .test(message, |settings, message| {
                        rig.active_mut().midi_message(settings, message)
                    })
                    .and_then(|mapped| {
                        mapped.then_some(()).ok_or_else(|| {
                            "This message is not mapped in the playing preset".into()
                        })
                    })
                    .err(),
                WorkerRequest::Control { command } => rig.active_mut().apply(command).err(),
                WorkerRequest::RestorePluginDefaults { command } => {
                    if rig.switching() {
                        Some("Wait for the prepared preset switch to finish".into())
                    } else {
                        rig.active_mut().restore_plugin_defaults(command).err()
                    }
                }

                WorkerRequest::Scene { command } => rig.active_mut().select_scene(command).err(),
                WorkerRequest::StompGroup { command } => {
                    if rig.switching() {
                        Some("Wait for the prepared preset switch to finish".into())
                    } else {
                        rig.active_mut().stomp_group(command).err()
                    }
                }
                WorkerRequest::Branch { command } => rig.active_mut().set_branch(command).err(),
                WorkerRequest::BranchSleep { command } => {
                    rig.active_mut().set_branch_sleep(command).err()
                }
                WorkerRequest::Eq { command } => rig.active_mut().apply_eq(command).err(),
                WorkerRequest::Model { command } => match model_root.as_deref() {
                    Some(root) => rig.active_mut().model_command(command, root).err(),
                    None => Some("Model asset store is unavailable".into()),
                },
                request @ (WorkerRequest::Switch { .. } | WorkerRequest::RecallSwitch { .. }) => {
                    let (command, scene, settings) = match request {
                        WorkerRequest::Switch { command } => (command, None, None),
                        WorkerRequest::RecallSwitch {
                            command,
                            scene,
                            midi,
                        } => (command, Some(scene), midi),
                        _ => unreachable!(),
                    };
                    match rig
                        .validate_switch_midi(&command.revision, settings.as_ref())
                        .and_then(|()| rig.switch_with_scene(command, scene))
                    {
                        Ok(()) => {
                            switch_midi = settings;
                            switch_reply = true;
                            continue;
                        }
                        Err(error) => Some(error),
                    }
                }
            };
            if !rig.healthy() {
                return Err(error.unwrap_or_else(|| "Rig failed".into()).into());
            }
            let control = snapshot(&rig, &midi.status);
            drop(rig);
            responses.send(WorkerReply {
                control,
                telemetry: latest(),
                processed_frames: frames.load(Ordering::Acquire),
                error,
            })?;
        }
        stop.store(true, Ordering::Release);
        render
            .join()
            .map_err(|_| "Render thread panicked")?
            .map_err(Into::into)
    });
    // A render failure explains any later owner error (a failed session), so report it first.
    let result = match failure.lock().ok().and_then(|slot| slot.clone()) {
        Some(error) if result.is_err() => Err(error.into()),
        _ => result,
    };
    // The render thread is joined; the owner drops the rig and its engines.
    drop(shared.into_inner());
    result
}
#[cfg(target_os = "linux")]
#[derive(Debug)]
struct StopOnDrop(std::sync::Arc<std::sync::atomic::AtomicBool>);
#[cfg(target_os = "linux")]
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.stop_flag();
    }
}
#[cfg(target_os = "linux")]
impl StopOnDrop {
    fn stop_flag(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }
}
#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("Rig playback requires Linux".into())
}
