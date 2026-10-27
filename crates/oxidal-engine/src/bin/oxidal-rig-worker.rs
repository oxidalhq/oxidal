//! One main-thread native/LV2 owner; EOF terminates PCM. Export runs separately.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::stream::{Duplex, Step};
    use oxidal_engine::{Session, protocol::*};
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
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        if args != ["--save-revision"] {
            return Err("Unknown rig worker mode".into());
        }
        let request: SaveRequest = serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
        let revision = oxidal_engine::save_revision(&store, &World::discover()?, request)?;
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
    let mut session = Session::new(
        store.read(&settings.revision)?,
        &world,
        f64::from(settings.stream.input.sample_rate),
        settings.stream.input.period_frames as usize,
        BUFFER_BUDGET,
    )?;
    // ALSA transport currently maps two logical ports. Reject mono endpoints
    // instead of silently duplicating/folding an explicit portable declaration.
    if session.channels() != (2, 2) {
        return Err("Rig transport requires two logical input/output ports".into());
    }
    if let Some(recall) = settings.recall {
        session.restore(&recall)?;
    }
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    #[cfg(feature = "qualification")]
    let null = std::env::var("OXIDAL_RIG_QUALIFY_NULL").is_ok_and(|v| v == "1");
    #[cfg(not(feature = "qualification"))]
    let null = false;
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
                    control: session.snapshot(),
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
        // Control/pump work can allocate and runs outside the process closure;
        // this owner loop is experimental, not real-time qualified.
        if pump.elapsed() >= Duration::from_millis(10) {
            session.pump()?;
            pump = Instant::now();
        }
        if ready && let Ok(request) = received.try_recv() {
            let error = match request {
                WorkerRequest::Status => None,
                WorkerRequest::Control { command } => session.apply(command).err(),
            };
            if !session.healthy() {
                return Err(error.unwrap_or_else(|| "Rig failed".into()).into());
            }
            responses.try_send(WorkerReply {
                control: session.snapshot(),
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
