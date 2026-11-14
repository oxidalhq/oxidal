//! Real ALSA-null duplex with file-fed reamp input, a raw input tap drained to
//! a file and a venue EQ stage: the shared transport every worker uses.
//! Linux with the `qualification` feature only.
//! @see docs/media.md
#![cfg(all(target_os = "linux", feature = "qualification"))]
#![allow(unsafe_code)]

use oxidal_audio::session_media::{InputSource, ring};
use oxidal_audio::stream::{Duplex, Step};
use oxidal_audio::tools::HostLevels;
use oxidal_audio::venue::{VenueApplied, VenueSettings};
use oxidal_audio::{AudioProbe, Direction, SampleFormat, StreamConfig};
use std::cell::Cell;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}
struct CountingAllocator;
fn count_allocation() {
    if COUNTING.with(Cell::get) {
        ALLOCATIONS.with(|n| n.set(n.get() + 1));
    }
}
// SAFETY: all memory operations are forwarded unchanged to the system allocator.
unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: same allocation contract as the caller.
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        // SAFETY: unchanged pointer/layout provided by caller.
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        count_allocation();
        // SAFETY: unchanged system-owned pointer/layout and requested size.
        unsafe { std::alloc::System.realloc(ptr, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

const RATE: u32 = 48000;
const PERIOD: usize = 128;

fn config(levels: HostLevels) -> StreamConfig {
    let input = AudioProbe {
        endpoint: "null".into(),
        direction: Direction::Capture,
        sample_rate: RATE,
        channels: 1,
        format: SampleFormat::Float,
        period_frames: PERIOD as u32,
        periods: 3,
    };
    let mut output = input.clone();
    output.direction = Direction::Playback;
    output.channels = 2;
    StreamConfig {
        levels,
        hear_yourself: true,
        input,
        output,
        // Mono interface input duplicated to both sides, as the Jogg is saved.
        input_map: [0, 0],
        output_map: [0, 1],
        venue: None,
    }
}

fn scratch(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("oxidal-{name}-{}.f32", std::process::id()))
}

#[test]
fn a_streamed_di_file_replaces_the_input_while_the_raw_input_is_recorded() {
    // Three seconds of DI, longer than the 2 s ring, so the reader must stream.
    let frames = 3 * RATE as usize;
    let di: Vec<f32> = (0..frames)
        .map(|i| (std::f32::consts::TAU * 220.0 * i as f32 / RATE as f32).sin() * 0.5)
        .collect();
    let di_path = scratch("p07-di");
    let mut bytes = Vec::with_capacity(frames * 4);
    for s in &di {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(&di_path, &bytes).unwrap();

    // Reader thread: 64 KiB file reads into a 2 s ring.
    let (mut di_tx, di_rx) = ring(2 * RATE as usize);
    let reader_path = di_path.clone();
    let reader = std::thread::spawn(move || {
        let mut file = std::fs::File::open(reader_path).unwrap();
        let mut chunk = vec![0u8; 64 * 1024];
        let mut samples = Vec::with_capacity(chunk.len() / 4);
        loop {
            let n = file.read(&mut chunk).unwrap();
            if n == 0 {
                break;
            }
            samples.clear();
            samples.extend(
                chunk[..n]
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
            );
            let mut sent = 0;
            while sent < samples.len() {
                sent += di_tx.push(&samples[sent..]);
                if sent < samples.len() {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        }
    });
    // Start once 100 ms is buffered, as the player does before fading in.
    while di_rx.available() < RATE as usize / 10 {
        std::thread::yield_now();
    }

    // Writer thread: drains the raw tap into a file until told to stop.
    let tap_path = scratch("p07-tap");
    let (tap_tx, mut tap_rx) = ring(2 * RATE as usize);
    let stop = Arc::new(AtomicBool::new(false));
    let writer_stop = Arc::clone(&stop);
    let writer_path = tap_path.clone();
    let writer = std::thread::spawn(move || {
        let mut file = std::io::BufWriter::new(std::fs::File::create(writer_path).unwrap());
        let mut block = vec![0.0f32; 4096];
        loop {
            let n = tap_rx.pop(&mut block);
            for s in &block[..n] {
                file.write_all(&s.to_le_bytes()).unwrap();
            }
            if n == 0 {
                if writer_stop.load(Ordering::Acquire) && tap_rx.available() == 0 {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
        file.flush().unwrap();
    });

    let levels = HostLevels {
        input_trim_db: -6.0,
        ..HostLevels::default()
    };
    let trim = 10f32.powf(-6.0 / 20.0);
    let mut stream = Duplex::qualification_null(config(levels)).unwrap();
    assert!(stream.set_raw_tap(Some(tap_tx)).is_none());
    let previous = stream.set_input_source(InputSource::Reamp {
        frames: di_rx,
        trim_and_gate: true,
    });
    assert!(matches!(previous, InputSource::Live));

    // The processor stands in for a rig: it records what reached it.
    let mut heard = vec![0.0f32; frames];
    let mut position = 0usize;
    let mut allocations = 0usize;
    while position < frames {
        ALLOCATIONS.with(|n| n.set(0));
        COUNTING.with(|c| c.set(true));
        let step = stream
            .step(|l, r| {
                assert_eq!(l, r);
                heard[position..position + l.len()].copy_from_slice(l);
                position += l.len();
                Ok(())
            })
            .unwrap();
        COUNTING.with(|c| c.set(false));
        allocations += ALLOCATIONS.with(Cell::get);
        if step == Step::Processed {
            // The null device is unclocked; pace at about 4× real time so the
            // reader streams rather than racing an instant callback.
            std::thread::sleep(std::time::Duration::from_micros(650));
        }
    }
    assert_eq!(allocations, 0, "audio steps never allocate");
    let (underruns, dropped) = stream.media_faults();
    assert_eq!((underruns, dropped), (0, 0));
    for (i, (got, sent)) in heard.iter().zip(&di).enumerate() {
        assert_eq!(
            *got,
            sent * trim,
            "frame {i}: the rig hears the DI, trimmed"
        );
    }

    // Stop the tap, then let the writer finish.
    drop(stream.set_raw_tap(None));
    stop.store(true, Ordering::Release);
    writer.join().unwrap();
    reader.join().unwrap();
    let tap = std::fs::read(&tap_path).unwrap();
    assert_eq!(tap.len(), frames * 4, "every raw frame was recorded");
    // The null interface captures silence; R0 holds it, not the injected DI.
    assert!(
        tap.chunks_exact(4)
            .all(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]) == 0.0)
    );
    std::fs::remove_file(di_path).unwrap();
    std::fs::remove_file(tap_path).unwrap();
}

#[test]
fn the_venue_stage_shapes_the_device_output_and_bypasses_exactly() {
    let mut stream = Duplex::qualification_null(config(HostLevels::default())).unwrap();
    let tone = |i: usize| (std::f32::consts::TAU * 1000.0 * i as f32 / RATE as f32).sin() * 0.5;
    let run = |stream: &mut Duplex| {
        let mut frame = 0usize;
        let _ = stream.telemetry();
        let mut processed = 0;
        while processed < 400 {
            if stream
                .step(|l, r| {
                    for (i, (a, b)) in l.iter_mut().zip(r.iter_mut()).enumerate() {
                        *a = tone(frame + i);
                        *b = *a;
                    }
                    frame += l.len();
                    Ok(())
                })
                .unwrap()
                == Step::Processed
            {
                processed += 1;
                // Skip the filter settling time before measuring.
                if processed == 40 {
                    let _ = stream.telemetry();
                }
            }
        }
        stream.telemetry().output[0].peak_dbfs
    };
    let flat = run(&mut stream);
    assert!((flat + 6.02).abs() < 0.05, "{flat}");
    let mut settings = VenueSettings::default();
    settings.bands[3].gain_db = -6.0;
    stream.host_utility(oxidal_audio::tools::HostUtility::Venue {
        venue: Some(VenueApplied {
            settings,
            bypass: false,
        }),
        crossfade: true,
    });
    let corrected = run(&mut stream);
    assert!((corrected - flat + 6.0).abs() < 0.2, "{corrected}");
    stream.host_utility(oxidal_audio::tools::HostUtility::Venue {
        venue: Some(VenueApplied {
            settings,
            bypass: true,
        }),
        crossfade: true,
    });
    let bypassed = run(&mut stream);
    assert!((bypassed - flat).abs() < 0.05, "{bypassed}");
}

#[test]
fn a_backing_track_plays_to_its_end_without_audio_thread_allocation() {
    use oxidal_audio::backing::{BackingCommand, MediaId};
    use oxidal_audio::tools::HostUtility;
    const ID: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2T";
    let root = std::env::temp_dir().join(format!("oxidal-backing-null-{}", std::process::id()));
    let dir = root.join("assets").join(ID);
    std::fs::create_dir_all(&dir).unwrap();
    let frames = RATE as u64; // one second, stereo
    let mut bytes = Vec::new();
    for i in 0..frames {
        let v = (std::f32::consts::TAU * 440.0 * i as f32 / RATE as f32).sin() * 0.25;
        bytes.extend_from_slice(&v.to_le_bytes());
        bytes.extend_from_slice(&(-v).to_le_bytes());
    }
    std::fs::write(dir.join(format!("play-{RATE}.f32")), bytes).unwrap();
    // SAFETY: set before the stream (and its reader thread) starts; no other
    // test in this binary reads the variable.
    unsafe { std::env::set_var("OXIDAL_MEDIA_DIR", &root) };
    let mut stream = Duplex::qualification_null(config(HostLevels::default())).unwrap();
    stream.host_utility(HostUtility::Backing {
        command: BackingCommand::Play {
            asset: MediaId::parse(ID).unwrap(),
            channels: 2,
            frames,
            from: 0,
            seq: 1,
            repeat: false,
            gain_db: 0.0,
        },
    });
    let mut allocations = 0usize;
    let mut peak_left = -120.0f32;
    let mut opposite = true;
    for _ in 0..20_000 {
        ALLOCATIONS.with(|n| n.set(0));
        COUNTING.with(|c| c.set(true));
        let step = stream
            .step(|l, r| {
                l.fill(0.0);
                r.fill(0.0);
                Ok(())
            })
            .unwrap();
        COUNTING.with(|c| c.set(false));
        allocations += ALLOCATIONS.with(Cell::get);
        if step != Step::Processed {
            continue;
        }
        // One snapshot per block: taking one resets the meter.
        let t = stream.telemetry();
        peak_left = peak_left.max(t.output[0].peak_dbfs as f32);
        opposite &= (t.output[0].peak_dbfs - t.output[1].peak_dbfs).abs() < 0.01;
        let status = t.monitoring.unwrap().backing.unwrap();
        if status.ended {
            assert_eq!(status.frame, frames);
            assert_eq!(status.underruns, 0);
            break;
        }
        std::thread::sleep(std::time::Duration::from_micros(650));
    }
    let status = stream.telemetry().monitoring.unwrap().backing.unwrap();
    assert!(status.ended, "{status:?}");
    assert_eq!(allocations, 0, "audio steps never allocate");
    // The track reached the outputs at its own level (−12 dBFS), both sides.
    assert!((peak_left + 12.04).abs() < 0.3, "{peak_left}");
    assert!(opposite);
    std::fs::remove_dir_all(root).unwrap();
}
