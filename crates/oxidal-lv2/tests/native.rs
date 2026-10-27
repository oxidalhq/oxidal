#![cfg(feature = "native")]
use oxidal_lv2::{Plugin, World};
use std::path::Path;
const URI: &str = "urn:oxidal:test:contract";
#[test]
fn contract_features_lifetime_bounds_readback_and_poison() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let catalog = world.plugins(48000.0).unwrap();
    assert_eq!(catalog.len(), 10);
    let info = catalog.iter().find(|p| p.uri == URI).unwrap();
    assert!(!info.name.is_empty());
    assert!(info.unsupported.is_none());
    assert_eq!(info.ports.len(), 6);
    assert!(Plugin::new(&world, "urn:oxidal:test:unsupported", 48000.0, 64).is_err());
    assert!(Plugin::new(&world, URI, 48000.0, 63).is_err());
    let mut plugin = Plugin::new(&world, URI, 48000.0, 64).unwrap();
    drop(world); // Instance keeps metadata/library owner alive.
    assert!(plugin.set(0, 1.0).is_err());
    assert!(plugin.set(1000, 1.0).is_err());
    assert!(plugin.set(4, f32::NAN).is_err());
    assert!(plugin.set(4, 3.0).is_err());
    assert_eq!(plugin.set(4, 0.5).unwrap(), 0.5);
    let mut left = [0.5; 64];
    let mut right = [-0.25; 64];
    plugin.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.25; 64]);
    assert_eq!(right, [-0.125; 64]);
    assert!(plugin.process(&mut [0.0; 32], &mut [0.0; 32]).is_err());
    plugin.set(4, 2.0).unwrap();
    assert!(plugin.process(&mut [f32::MAX; 64], &mut [0.0; 64]).is_err());
    assert!(plugin.process(&mut [0.0; 64], &mut [0.0; 64]).is_err());
    assert!(plugin.set(4, 1.0).is_err());
}
#[test]
fn independent_external_mono_amp_and_delay_preserve_stereo() {
    // Explicit qualification dependency: fail if the external corpus is absent.
    let root = std::env::var("OXIDAL_LV2_EXTERNAL_DIR")
        .expect("Use pnpm lv2:check with installed swh-lv2");
    let world = World::bundle(&Path::new(&root).join("amp-swh.lv2")).unwrap();
    let mut amp = Plugin::new(&world, "http://plugin.org.uk/swh-plugins/amp", 48000.0, 64).unwrap();
    amp.set(0, -6.0206).unwrap();
    let mut left = [0.5; 64];
    let mut right = [-0.25; 64];
    amp.process(&mut left, &mut right).unwrap();
    assert!(left.iter().all(|v| (*v - 0.25).abs() < 1e-5));
    assert!(right.iter().all(|v| (*v + 0.125).abs() < 1e-5));
    let world = World::bundle(&Path::new(&root).join("delay-swh.lv2")).unwrap();
    let mut delay = Plugin::new(
        &world,
        "http://plugin.org.uk/swh-plugins/delay_n",
        48000.0,
        64,
    )
    .unwrap();
    delay.set(3, 128.0 / 48000.0).unwrap();
    let mut left = [0.0; 64];
    let mut right = [0.0; 64];
    left[0] = 0.5;
    right[0] = -0.25;
    delay.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.0; 64]);
    assert_eq!(right, [0.0; 64]);
    delay.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.0; 64]);
    delay.process(&mut left, &mut right).unwrap();
    assert!((left[0] - 0.5).abs() < 1e-6);
    assert!((right[0] + 0.25).abs() < 1e-6);
    assert!(left[1..].iter().chain(&right[1..]).all(|v| *v == 0.0));
    // Asymmetric routing is explicitly unsupported, not silently downmixed.
    let world = World::bundle(&Path::new(&root).join("gverb-swh.lv2")).unwrap();
    assert!(
        Plugin::new(
            &world,
            "http://plugin.org.uk/swh-plugins/gverb",
            48000.0,
            64
        )
        .is_err()
    );
}

#[test]
fn declared_mono_ports_process_one_signal_and_reject_stereo_calls() {
    let root = std::env::var("OXIDAL_LV2_EXTERNAL_DIR").expect("Use pnpm lv2:check");
    let world = World::bundle(&Path::new(&root).join("amp-swh.lv2")).unwrap();
    let mut amp =
        Plugin::new_ports(&world, "http://plugin.org.uk/swh-plugins/amp", 48000.0, 64).unwrap();
    assert_eq!(amp.channels(), 1);
    assert_eq!(
        amp.info()
            .ports
            .iter()
            .filter(|p| p.audio && p.input)
            .count(),
        1
    );
    amp.set(0, -6.0206).unwrap();
    let mut signal = [0.5; 64];
    amp.process_mono(&mut signal).unwrap();
    assert!(signal.iter().all(|v| (*v - 0.25).abs() < 1e-5));
    assert!(amp.process(&mut [1.0; 64], &mut [1.0; 64]).is_err());
    let mut invalid = [f32::NAN; 64];
    assert!(amp.process_mono(&mut invalid).is_err());
    assert_eq!(invalid, [0.0; 64]);
    amp.process_mono(&mut signal).unwrap(); // invalid input did not poison DSP
    amp.set(0, 24.0).unwrap();
    let mut overflow = [f32::MAX; 64];
    assert!(amp.process_mono(&mut overflow).is_err());
    assert_eq!(overflow, [0.0; 64]);
    assert!(amp.process_mono(&mut signal).is_err());
    assert!(amp.set(0, 0.0).is_err());
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let mut stereo = Plugin::new_ports(&world, URI, 48000.0, 64).unwrap();
    assert_eq!(stereo.channels(), 2);
    assert!(stereo.process_mono(&mut [1.0; 64]).is_err());
    let (mut left, mut right) = ([0.4; 64], [-0.2; 64]);
    stereo.set(4, 0.5).unwrap();
    stereo.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.2; 64]);
    assert_eq!(right, [-0.1; 64]);
}

#[test]
fn reported_latency_prepares_without_audio_and_rejects_invalid_or_changing_values() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    for uri in ["urn:oxidal:test:latency", "urn:oxidal:test:latency-legacy"] {
        let info = world
            .plugins(48000.0)
            .unwrap()
            .into_iter()
            .find(|p| p.uri == uri)
            .unwrap();
        assert!(info.unsupported.is_none());
        assert_eq!(info.ports.iter().filter(|p| p.latency).count(), 1);
        assert!(
            Plugin::new(&world, uri, 48000.0, 64)
                .unwrap_err()
                .contains("mixed-chain")
        );
        let mut p = Plugin::new_ports(&world, uri, 48000.0, 64).unwrap();
        assert!(p.latency_frames().is_err()); // Unwritten NaN is not zero.
        p.set(3, 137.0).unwrap();
        assert_eq!(p.prepare_latency().unwrap(), 137);
        assert!(p.set(2, 1.0).is_err()); // latency is read-only
        assert!(p.set(3, 12.0).unwrap_err().contains("prepare a new graph"));
        assert_eq!(p.value(3).unwrap(), 137.0);
        assert_eq!(p.latency_frames().unwrap(), 137);
        let mut rendered = Vec::new();
        for b in 0..4 {
            if b == 1 {
                // Rejected edits must not erase the impulse still in flight.
                assert!(p.set(3, 12.0).is_err());
            }
            let mut samples = [0.0; 64];
            if b == 0 {
                samples[0] = 0.75;
            }
            p.process_mono(&mut samples).unwrap();
            rendered.extend(samples);
        }
        assert_eq!(rendered.iter().filter(|v| **v != 0.0).count(), 1);
        assert_eq!(rendered[137], 0.75);
        // Zero-frame queries restore an invalid proposed scalar without consuming PCM.
        for mode in 1..=4 {
            assert!(p.set(4, mode as f32).is_err());
            assert_eq!(p.value(4).unwrap(), 0.0);
            assert_eq!(p.latency_frames().unwrap(), 137);
        }
        p.set(4, 5.0).unwrap();
        let mut samples = [1.0; 64];
        assert!(p.process_mono(&mut samples).is_err()); // spontaneous run-time latency
        assert_eq!(samples, [0.0; 64]);
        assert!(p.set(4, 0.0).is_err()); // poisoned instance cannot resume silently
    }
    for uri in [
        "urn:oxidal:test:latency-input",
        "urn:oxidal:test:latency-duplicate",
    ] {
        assert!(
            world
                .plugins(48000.0)
                .unwrap()
                .iter()
                .find(|p| p.uri == uri)
                .unwrap()
                .unsupported
                .is_some()
        );
        assert!(Plugin::new_ports(&world, uri, 48000.0, 64).is_err());
    }
    for mode in 1..=4 {
        let mut p = Plugin::new_ports(&world, "urn:oxidal:test:latency", 48000.0, 64).unwrap();
        p.set(4, mode as f32).unwrap();
        assert!(p.prepare_latency().is_err());
    }
}

#[test]
fn stereo_latency_keeps_channels_separate_and_contains_runtime_change() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let mut p = Plugin::new_ports(&world, "urn:oxidal:test:latency-stereo", 48000.0, 64).unwrap();
    p.set(5, 137.0).unwrap();
    assert_eq!(p.prepare_latency().unwrap(), 137);
    let mut rendered = [Vec::new(), Vec::new()];
    for block in 0..4 {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        if block == 0 {
            l[0] = 0.75;
            r[0] = -0.25;
        }
        p.process(&mut l, &mut r).unwrap();
        rendered[0].extend(l);
        rendered[1].extend(r);
    }
    for (channel, amplitude) in rendered.iter().zip([0.75, -0.25]) {
        assert_eq!(channel.iter().filter(|v| **v != 0.0).count(), 1);
        assert_eq!(channel[137], amplitude);
    }
    p.set(6, 5.0).unwrap();
    let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
    assert!(p.process(&mut l, &mut r).is_err());
    assert_eq!(l, [0.0; 64]);
    assert_eq!(r, [0.0; 64]);
}

#[test]
fn worker_copies_messages_bounds_queues_and_drains_before_cleanup() {
    use std::time::{Duration, Instant};
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let mut p = Plugin::new_ports(&world, "urn:oxidal:test:worker", 48000.0, 64).unwrap();
    assert_eq!(p.prepare_latency().unwrap(), 0);
    assert_eq!(p.value(6).unwrap(), 1.0); // end_run even for run(0)
    p.set(2, 1.0).unwrap(); // schedules while worker is deliberately blocked
    p.process_mono(&mut [1.0; 64]).unwrap();
    assert_eq!(p.value(3).unwrap(), 16.0);
    assert_eq!(p.value(4).unwrap(), 48.0);
    assert_eq!(p.value(5).unwrap(), 0.0);
    p.set(2, 2.0).unwrap(); // release background work
    let deadline = Instant::now() + Duration::from_secs(3);
    while p.value(5).unwrap() < 16.0 {
        assert!(Instant::now() < deadline, "worker responses timed out");
        p.process_mono(&mut [1.0; 64]).unwrap();
        std::thread::sleep(Duration::from_millis(1));
    }
    let mut audio = [0.25; 64];
    p.process_mono(&mut audio).unwrap();
    assert_eq!(audio, [4.0; 64]);
    drop(p); // fixture asserts every accepted request/response completed on correct threads
    for _ in 0..8 {
        let mut p = Plugin::new_ports(&world, "urn:oxidal:test:worker", 48000.0, 64).unwrap();
        p.prepare_latency().unwrap();
        p.set(2, 3.0).unwrap();
        p.process_mono(&mut [1.0; 64]).unwrap();
        drop(p); // slow outstanding work must finish before plugin memory/library is freed
    }
    let mut p = Plugin::new_ports(&world, "urn:oxidal:test:worker", 48000.0, 64).unwrap();
    p.prepare_latency().unwrap();
    p.set(2, 4.0).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let mut audio = [1.0; 64];
        if p.process_mono(&mut audio).is_err() {
            assert_eq!(audio, [0.0; 64]);
            break;
        }
        assert!(Instant::now() < deadline, "worker failure not observed");
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(p.set(2, 0.0).is_err());
}

#[test]
fn worker_response_backpressure_and_missing_interface_are_explicit() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    assert!(
        Plugin::new_ports(&world, "urn:oxidal:test:missing-worker", 48000.0, 64)
            .unwrap_err()
            .contains("Missing LV2 worker callbacks")
    );
    let mut p = Plugin::new_ports(&world, "urn:oxidal:test:worker", 48000.0, 64).unwrap();
    p.prepare_latency().unwrap();
    p.set(2, 5.0).unwrap();
    // Fixture holds its run until the response burst completes; the host must
    // preserve exactly the accepted messages and report overflow to the plugin.
    assert_eq!(p.value(5).unwrap(), 16.0);
}
