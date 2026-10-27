//! Experimental playback process. EOF stops PCM; the editor lives in a different process.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::{
        lifecycle::{LiveRequest, PlaybackEvent, PlaybackStart},
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
    let (command_send, commands) = std::sync::mpsc::sync_channel::<LiveRequest>(1);
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
    let preset = if settings.owned {
        oxidal_presets::OwnedStore::new(root.join("owned"))
            .read(&settings.preset_id)?
            .1
    } else {
        oxidal_presets::Store::new(root).original(&settings.preset_id)?
    };
    let preset_name = oxidal_presets::inspect(&preset)?.name;
    let mut engine = Engine::new(
        settings.stream.input.sample_rate.into(),
        settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
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
            let error = engine
                .set_live_control(&request.target, request.value)
                .err()
                .map(|e| e.to_string());
            meter_send.try_send(PlaybackEvent::Control {
                serial: request.serial,
                controls: engine.live_controls()?,
                error,
            })?;
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
    let (source, preset) = if request.settings.owned {
        let (info, bytes) = owned.read(&request.settings.preset_id)?;
        (info.source_sha256, bytes)
    } else {
        (
            request.settings.preset_id.clone(),
            oxidal_presets::Store::new(root).original(&request.settings.preset_id)?,
        )
    };
    let mut engine = oxidal_tone3000::Engine::new(
        request.settings.stream.input.sample_rate.into(),
        request.settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    engine.apply_live_snapshot(&request.controls)?;
    let bytes = engine.save_preset(&request.name)?;
    // A fresh engine prevents retained device/session values hiding a lossy export.
    drop(engine);
    let mut engine = oxidal_tone3000::Engine::new(
        request.settings.stream.input.sample_rate.into(),
        request.settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&bytes)?;
    engine.wait_ready()?;
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
    let saved = owned.save(&source, &bytes)?;
    println!("{}", saved.id);
    std::io::stdout().flush()?;
    Ok(())
}
