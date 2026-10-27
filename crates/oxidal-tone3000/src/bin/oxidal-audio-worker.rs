//! Experimental playback process. EOF stops PCM; the editor lives in a different process.
#[cfg(target_os = "linux")]
#[path = "../playback_models.rs"]
mod models;
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::{
        lifecycle::{PlaybackEvent, PlaybackStart, WorkerRequest},
        stream::{Duplex, Step},
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
    if std::env::args().nth(1).as_deref() == Some("--save-copy") {
        return save_copy();
    }
    let mut bytes = vec![];
    let mut input = std::io::stdin().lock();
    (&mut input).take(65537).read_until(b'\n', &mut bytes)?;
    if bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
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
        let mut input = std::io::stdin().lock();
        loop {
            let mut bytes = vec![];
            let read = (&mut input).take(4097).read_until(b'\n', &mut bytes);
            if read.is_err() || bytes.len() > 4096 || bytes.last() != Some(&b'\n') {
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
    models::restore(
        &mut engine,
        &root,
        &startup.models,
        settings.stream.input.period_frames as usize,
    )?;
    let mut models = models::Models::default();
    if let Some(controls) = startup.controls {
        engine.apply_live_snapshot(&controls)?;
        engine.wait_ready()?;
    }
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    #[cfg(feature = "audio-qualification")]
    let null = std::env::var("OXIDAL_AUDIO_QUALIFY_NULL").is_ok_and(|v| v == "1");
    #[cfg(not(feature = "audio-qualification"))]
    let null = false;
    let mut stream = {
        #[cfg(feature = "audio-qualification")]
        if null {
            Duplex::qualification_null(settings.stream.clone())?
        } else {
            Duplex::open(settings.stream.clone())?
        }
        #[cfg(not(feature = "audio-qualification"))]
        Duplex::open(settings.stream.clone())?
    };
    let (meter_send, meter_recv) = std::sync::mpsc::sync_channel::<PlaybackEvent>(2);
    // A bounded writer isolates JSON/pipe backpressure from processing. Overflow drops
    // intermediate views; cumulative clipping counts survive the next delivered snapshot.
    std::thread::spawn(move || {
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
    let mut last_meter = Instant::now();
    let mut blocks = 0;
    let mut last_block = Instant::now();
    while !stop.load(Ordering::Acquire) {
        if stream.step(|l, r| engine.process(l, r).map_err(|e| e.to_string()))? == Step::Processed {
            last_block = Instant::now();
            if blocks < settings.stream.output.periods - 1 {
                blocks += 1;
                if blocks == settings.stream.output.periods - 1 {
                    meter_send.try_send(PlaybackEvent::Ready {
                        preset_name: preset_name.clone(),
                        controls: engine.live_controls()?,
                    })?;
                }
            }
            if blocks >= settings.stream.output.periods - 1
                && last_meter.elapsed() >= Duration::from_millis(200)
            {
                let _ = meter_send.try_send(PlaybackEvent::Meter {
                    snapshot: stream.telemetry(),
                });
                last_meter = Instant::now();
            }
            // ALSA null has no clock; pace only that explicit software fixture.
            if null {
                std::thread::sleep(Duration::from_secs_f64(
                    settings.stream.input.period_frames as f64
                        / settings.stream.input.sample_rate as f64,
                ));
            }
        } else if last_block.elapsed() > Duration::from_secs(2) {
            return Err("Audio device made no progress for two seconds".into());
        }
        if blocks >= settings.stream.output.periods - 1
            && let Ok(request) = commands.try_recv()
        {
            // Serialization, catalog readback and native control work can allocate.
            // Kept out of the DSP closure; physical deadline qualification remains required.
            let event = match request {
                WorkerRequest::Control(request) => {
                    let error = if models.pending() {
                        Some(
                            "Model preparation is pending; cancel before adjusting controls".into(),
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
                    let result =
                        models.operation(&mut engine, &root, request.model, request.serial);
                    let (progress, error) = match result {
                        Ok(p) => (p, None),
                        Err(e) => (None, Some(e)),
                    };
                    PlaybackEvent::Model {
                        serial: request.serial,
                        progress,
                        controls: engine.live_controls()?,
                        error,
                    }
                }
            };
            meter_send.try_send(event)?;
        }
    }
    drop(stream); // PCM is released before native state destruction and process exit.
    Ok(())
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
        .take(65537)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
        return Err("Invalid save request".into());
    }
    let request: SavePlayback = serde_json::from_slice(&bytes)?;
    request.settings.validate()?;
    if !valid_preset_name(&request.name) || !valid_controls(&request.controls) {
        return Err("Invalid save name or controls".into());
    }
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let owned = oxidal_presets::OwnedStore::new(root.join("owned"));
    let (source, preset) = if request.settings.owned || request.settings.draft {
        let store = oxidal_presets::OwnedStore::new(root.join(if request.settings.draft {
            "working-native"
        } else {
            "owned"
        }));
        let (info, bytes) = store.read(&request.settings.preset_id)?;
        (info.source_sha256, bytes)
    } else {
        (
            Some(request.settings.preset_id.clone()),
            oxidal_presets::Store::new(root.clone()).original(&request.settings.preset_id)?,
        )
    };
    let mut engine = oxidal_tone3000::Engine::new(
        request.settings.stream.input.sample_rate.into(),
        request.settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    models::restore(
        &mut engine,
        &root,
        &request.models,
        request.settings.stream.input.period_frames as usize,
    )?;
    engine.apply_live_snapshot(&request.controls)?;
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
