//! One main-thread native/LV2 owner; EOF terminates PCM. Export runs separately.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
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
        if args == ["--prepare-native-setting"] {
            let request: PrepareNativeSetting =
                serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
            let world = World::discover()?;
            let recall = oxidal_engine::prepare_native_setting(
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
        let request: SaveRequest = serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
        let world = World::discover()?;
        let revision = if let Some(root) = &model_root {
            oxidal_engine::save_revision_with_models(&store, &world, request, root)?
        } else {
            oxidal_engine::save_revision(&store, &world, request)?
        };
        serde_json::to_writer(std::io::stdout().lock(), &revision)?;
        std::io::stdout().flush()?;
        return Ok(());
    }
    let settings: StartRig = serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
    settings.validate()?;
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let (commands, received) = mpsc::sync_channel::<WorkerRequest>(1);
    std::thread::spawn(move || {
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
    let mut session = ResidentSet::new_with_models(
        &store,
        &world,
        &settings,
        BUFFER_BUDGET,
        model_root.as_deref(),
    )?;
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
    let mut left = vec![0.0; settings.stream.input.period_frames as usize];
    let mut right = left.clone();
    let mut frames = 0u64;
    let mut ready = false;
    let mut switch_reply = false;
    let mut progress = Instant::now();
    let mut pump = Instant::now();
    while !stop.load(Ordering::Acquire) {
        let step = stream.step(|l, r| {
            left.copy_from_slice(l);
            right.copy_from_slice(r);
            session.process(&[&left, &right], &mut [l, r])
        })?;
        if step == Step::Processed {
            frames += u64::from(settings.stream.input.period_frames);
            progress = Instant::now();
            if !ready
                && frames
                    >= u64::from(
                        settings.stream.input.period_frames * (settings.stream.output.periods - 1),
                    )
            {
                responses.try_send(WorkerReply {
                    control: snapshot(&session, &midi.status),
                    telemetry: stream.telemetry(),
                    processed_frames: frames,
                    error: None,
                })?;
                ready = true;
            }
            if null {
                std::thread::sleep(Duration::from_secs_f64(
                    f64::from(settings.stream.input.period_frames)
                        / f64::from(settings.stream.input.sample_rate),
                ));
            }
        } else if progress.elapsed() > Duration::from_secs(2) {
            return Err("Rig PCM made no progress for two seconds".into());
        }
        // Shared bounded, nonblocking reads outside PCM; failures stay in MIDI status.
        if ready && !session.switching() {
            midi.poll(|settings, message| session.active_mut().midi_message(settings, message));
        }
        if pump.elapsed() >= Duration::from_millis(10) {
            session.pump()?;
            pump = Instant::now();
        }
        if switch_reply && !session.switching() {
            let error = session.take_switch_error();
            responses.try_send(WorkerReply {
                control: snapshot(&session, &midi.status),
                telemetry: stream.telemetry(),
                processed_frames: frames,
                error,
            })?;
            switch_reply = false;
        }
        if ready
            && !switch_reply
            && let Ok(request) = received.try_recv()
        {
            let error = match request {
                WorkerRequest::Status => None,
                WorkerRequest::Authoring { command } => match model_root.as_deref() {
                    Some(root) => session.active_mut().authoring_command(command, root).err(),
                    None => Some("Native working store unavailable".into()),
                },
                WorkerRequest::Midi { settings } => match validate_midi(&settings, &session) {
                    Err(error) => Some(error),
                    Ok(()) => {
                        midi.configure(settings);
                        None
                    }
                },
                WorkerRequest::Control { command } => session.active_mut().apply(command).err(),
                WorkerRequest::Scene { command } => {
                    session.active_mut().select_scene(command).err()
                }
                WorkerRequest::Branch { command } => session.active_mut().set_branch(command).err(),
                WorkerRequest::Eq { command } => session.active_mut().apply_eq(command).err(),
                WorkerRequest::Model { command } => match model_root.as_deref() {
                    Some(root) => session.active_mut().model_command(command, root).err(),
                    None => Some("Model asset store is unavailable".into()),
                },
                WorkerRequest::Switch { command } => match session.switch(command) {
                    Ok(()) => {
                        midi.configure(None);
                        switch_reply = true;
                        continue;
                    }
                    Err(error) => Some(error),
                },
            };
            if !session.healthy() {
                return Err(error.unwrap_or_else(|| "Rig failed".into()).into());
            }
            responses.try_send(WorkerReply {
                control: snapshot(&session, &midi.status),
                telemetry: stream.telemetry(),
                processed_frames: frames,
                error,
            })?;
        }
    }
    drop(stream);
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("Rig playback requires Linux".into())
}
