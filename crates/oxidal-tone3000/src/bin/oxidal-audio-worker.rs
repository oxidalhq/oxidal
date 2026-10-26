//! Experimental playback process. EOF stops PCM; the editor lives in a different process.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::{
        lifecycle::StartAudio,
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
    let mut bytes = vec![];
    let mut input = std::io::stdin().lock();
    (&mut input).take(65537).read_until(b'\n', &mut bytes)?;
    if bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
        return Err("invalid startup frame".into());
    }
    let settings: StartAudio = serde_json::from_slice(&bytes)?;
    settings.validate()?;
    drop(input);
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    // Any further input or EOF is a stop request. No unbounded input queue or live reload.
    std::thread::spawn(move || {
        let _ = std::io::stdin().read(&mut [0u8; 1]);
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
    let mut engine = Engine::new(
        settings.stream.input.sample_rate.into(),
        settings.stream.input.period_frames as usize,
    )?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
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
    let mut blocks = 0;
    let mut last_block = Instant::now();
    while !stop.load(Ordering::Acquire) {
        if stream.step(|l, r| engine.process(l, r).map_err(|e| e.to_string()))? == Step::Processed {
            last_block = Instant::now();
            if blocks < settings.stream.output.periods - 1 {
                blocks += 1;
                if blocks == settings.stream.output.periods - 1 {
                    println!("{{\"running\":true}}");
                    std::io::stdout().flush()?;
                }
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
    }
    drop(stream); // PCM is released before native state destruction and process exit.
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("Audio worker requires Linux ALSA".into())
}
