//! Experimental single-owner graph process. EOF stops playback. IPC queues are bounded.
#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_audio::stream::{Duplex, Step};
    use oxidal_lv2::{PreparedGraph, World, protocol::*};
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
        let mut bytes = vec![];
        r.take((REQUEST_LIMIT + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > REQUEST_LIMIT || bytes.last() != Some(&b'\n') {
            return Err("Invalid worker request frame".into());
        }
        Ok(bytes)
    }
    fn reply(
        g: &PreparedGraph,
        frames: u64,
        telemetry: oxidal_audio::meter::Snapshot,
        error: Option<String>,
    ) -> Result<WorkerReply, String> {
        let control = g.snapshot();
        let native_values = control
            .parameters
            .iter()
            .map(|p| {
                g.native_value(&p.id).map(|value| NativeValue {
                    target: p.id.clone(),
                    value,
                })
            })
            .collect::<Result<_, _>>()?;
        Ok(WorkerReply {
            telemetry,
            control,
            native_values,
            processed_frames: frames,
            error,
        })
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        if args.len() != 2 || args[0] != "--catalog" {
            return Err("Expected --catalog <sample-rate>".into());
        }
        let sample_rate: u32 = args[1].parse()?;
        if !(8000..=192000).contains(&sample_rate) {
            return Err("Invalid catalog sample rate".into());
        }
        // Metadata only: no plugin instances or audio device are opened.
        let world = World::discover()?;
        let mut plugins = world.plugins(f64::from(sample_rate))?;
        plugins.sort_by(|a, b| a.name.cmp(&b.name).then(a.uri.cmp(&b.uri)));
        let catalog = oxidal_lv2::PluginCatalog {
            sample_rate,
            plugins,
        };
        catalog.validate()?;
        let bytes = serde_json::to_vec(&catalog)?;
        if bytes.len() > oxidal_lv2::CATALOG_LIMIT {
            return Err("LV2 catalog exceeds response limit".into());
        }
        std::io::stdout().lock().write_all(&bytes)?;
        return Ok(());
    }
    let settings: StartGraph = serde_json::from_slice(&frame(&mut std::io::stdin().lock())?)?;
    settings.validate()?;
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let (commands, received) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        while let Ok(bytes) = frame(&mut input) {
            let Ok(request) = serde_json::from_slice::<WorkerRequest>(&bytes) else {
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
                    return Err("Worker reply too large".into());
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
    let mut graph = PreparedGraph::new(
        &world,
        settings.rig,
        &settings.bindings,
        settings.stream.input.sample_rate.into(),
        settings.stream.input.period_frames as usize,
    )?;
    if let Some(recall) = &settings.recall {
        graph.restore(recall)?;
    }
    #[cfg(feature = "qualification")]
    let null = std::env::var("OXIDAL_GRAPH_QUALIFY_NULL").is_ok_and(|v| v == "1");
    #[cfg(not(feature = "qualification"))]
    let null = false;
    if stop.load(Ordering::Acquire) {
        return Ok(());
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
    let mut processed = 0u64;
    let mut ready = false;
    let mut last_block = Instant::now();
    let mut expiry = Instant::now();
    while !stop.load(Ordering::Acquire) {
        if stream.step(|l, r| graph.process(l, r))? == Step::Processed {
            processed += u64::from(settings.stream.input.period_frames);
            last_block = Instant::now();
            if !ready
                && processed
                    >= u64::from(
                        settings.stream.input.period_frames * (settings.stream.output.periods - 1),
                    )
            {
                responses.try_send(reply(&graph, processed, stream.telemetry(), None)?)?;
                ready = true;
            }
            if null {
                std::thread::sleep(Duration::from_secs_f64(
                    f64::from(settings.stream.input.period_frames)
                        / f64::from(settings.stream.input.sample_rate),
                ));
            }
        } else if last_block.elapsed() > Duration::from_secs(2) {
            return Err("Graph PCM made no progress for two seconds".into());
        }
        if ready {
            // Control work is serialized between transport steps, never inside the DSP callback.
            // It can allocate; this experimental owner loop is not real-time qualified.
            if expiry.elapsed() >= Duration::from_millis(100) {
                graph.expire_edit(Instant::now())?;
                expiry = Instant::now();
            }
            if let Ok(request) = received.try_recv() {
                let error = match request {
                    WorkerRequest::Status => None,
                    WorkerRequest::Control { command } => graph.apply(*command, true).err(),
                };
                responses.try_send(reply(&graph, processed, stream.telemetry(), error)?)?;
            }
        }
    }
    drop(stream);
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("Graph playback requires Linux".into())
}
