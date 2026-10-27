#![cfg(feature = "qualification")]
use oxidal_engine::{
    PreparedPorts, Session,
    protocol::{ControlCommand, SaveRequest, StartRig, Target},
};
use oxidal_lv2::World;
use oxidal_presets::{Bundle, BundleStore};
use serde_json::json;
use std::collections::BTreeMap;

fn bundle(delay: u32, mode: u32, legacy: bool) -> Bundle {
    let uri = if legacy {
        "urn:oxidal:test:latency-legacy"
    } else {
        "urn:oxidal:test:latency"
    };
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let value = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"68448a6d-0168-4fc8-b337-c12959165271","name":"Latency qualification",
        "tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"fx","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"fx","bypassed":false},
            {"id":"merge","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[0.25,0.75]},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"split",0),edge("split",0,"fx",0),edge("fx",0,"merge",0),edge("split",1,"merge",1),edge("merge",0,"out",0),edge("in",1,"out",1)]},
        "lv2":[{"id":"fx","pluginUri":uri,"controls":{"delay":delay,"mode":mode},"assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}
fn impulse(
    mut process: impl FnMut(&[&[f32]], &mut [&mut [f32]]) -> Result<(), String>,
    delay: usize,
) {
    let mut rendered = [Vec::new(), Vec::new()];
    for block in 0..8 {
        let mut input = [[0.0; 64]; 2];
        if block == 0 {
            input[0][0] = 0.75;
            input[1][0] = -0.25;
        }
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        process(&[&input[0], &input[1]], &mut [&mut l, &mut r]).unwrap();
        rendered[0].extend(l);
        rendered[1].extend(r);
    }
    for (samples, value) in rendered.iter().zip([0.75, -0.25]) {
        assert_eq!(samples.iter().filter(|v| **v != 0.0).count(), 1);
        assert_eq!(samples[delay], value);
    }
}
#[test]
fn portable_lv2_latency_aligns_parallel_paths_bypass_and_offline_recall() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    for legacy in [false, true] {
        let fixture = bundle(137, 0, legacy);
        let mut graph =
            PreparedPorts::from_bundle(&fixture, &world, 48000.0, 64, 1024 * 1024).unwrap();
        assert_eq!(graph.latency_frames(), 137);
        let needed = graph.buffer_bytes();
        assert!(PreparedPorts::from_bundle(&fixture, &world, 48000.0, 64, needed - 1).is_err());
        impulse(|input, output| graph.process(input, output), 137); // wet and dry converge exactly, including R passthrough
        let mut session =
            Session::new(bundle(137, 0, legacy), &world, 48000.0, 64, 1024 * 1024).unwrap();
        let before = session.snapshot();
        assert!(
            session
                .apply(ControlCommand {
                    session: before.session.clone(),
                    expected_revision: before.revision,
                    target: Target::Lv2 {
                        node: "fx".into(),
                        symbol: "delay".into()
                    },
                    value: 12.0
                })
                .is_err()
        );
        assert_eq!(session.snapshot().revision, before.revision);
        assert!(session.healthy());
        assert_eq!(
            serde_json::to_value(session.snapshot().controls).unwrap(),
            serde_json::to_value(before.controls).unwrap()
        );
        impulse(|input, output| session.process(input, output), 137);
        session
            .apply(ControlCommand {
                session: before.session.clone(),
                expected_revision: before.revision,
                target: Target::Bypass { node: "fx".into() },
                value: 1.0,
            })
            .unwrap();
        assert_eq!(session.snapshot().latency_frames, 137);
        // Live bypass retains the declared arrival time and prior healthy session.
        impulse(|input, output| session.process(input, output), 137);
        let root = std::env::temp_dir().join(format!(
            "oxidal-lv2-latency-{}-{legacy}",
            std::process::id()
        ));
        let store = BundleStore::new(root.clone());
        let revision = store.save(&fixture).unwrap();
        let input = oxidal_audio::AudioProbe {
            endpoint: "hw:CARD=Qualification,DEV=0".into(),
            direction: oxidal_audio::Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::S16,
            period_frames: 64,
            periods: 3,
        };
        let mut output = input.clone();
        output.direction = oxidal_audio::Direction::Playback;
        let saved_revision = oxidal_engine::save_revision(
            &store,
            &world,
            SaveRequest {
                settings: StartRig {
                    revision,
                    stream: oxidal_audio::StreamConfig {
                        input,
                        output,
                        input_map: [0, 1],
                        output_map: [0, 1],
                    },
                    recall: None,
                },
                recall: session.snapshot().recall(),
                name: "Saved latency session".into(),
            },
        )
        .unwrap();
        drop(fixture);
        drop(session);
        let saved = store.read(&saved_revision).unwrap();
        assert_eq!(saved.manifest().name, "Saved latency session");
        assert_eq!(
            saved
                .manifest()
                .oxidal
                .as_ref()
                .unwrap()
                .graph
                .nodes
                .iter()
                .find(|n| n.id == "fx")
                .unwrap()
                .bypassed,
            Some(true)
        );
        let mut restored =
            PreparedPorts::from_bundle(&saved, &world, 48000.0, 64, 1024 * 1024).unwrap();
        impulse(|input, output| restored.process(input, output), 137);
        std::fs::remove_dir_all(root).unwrap();
    }
}
#[test]
fn changed_or_invalid_latency_never_escapes_as_misaligned_audio() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    for mode in 1..=4 {
        assert!(
            PreparedPorts::from_bundle(&bundle(13, mode, false), &world, 48000.0, 64, 1024 * 1024)
                .is_err()
        );
    }
    let mut graph =
        PreparedPorts::from_bundle(&bundle(13, 5, false), &world, 48000.0, 64, 1024 * 1024)
            .unwrap();
    let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
    assert!(
        graph
            .process(&[&[0.75; 64], &[0.25; 64]], &mut [&mut l, &mut r])
            .is_err()
    );
    assert_eq!(l, [0.0; 64]);
    assert_eq!(r, [0.0; 64]);
    assert!(
        graph
            .process(&[&[0.0; 64], &[0.0; 64]], &mut [&mut l, &mut r])
            .is_err()
    );
    assert_eq!(l, [0.0; 64]);
    assert_eq!(r, [0.0; 64]);
}

#[test]
fn failed_latency_rollback_invalidates_the_session() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(bundle(13, 0, false), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let before = session.snapshot();
    let error = session
        .apply(ControlCommand {
            session: before.session,
            expected_revision: before.revision,
            target: Target::Lv2 {
                node: "fx".into(),
                symbol: "mode".into(),
            },
            value: 6.0,
        })
        .unwrap_err();
    assert!(error.contains("rollback failed"));
    assert!(!session.healthy());
    assert_eq!(session.snapshot().revision, before.revision);
    let (mut l, mut r) = ([1.0; 64], [1.0; 64]);
    assert!(
        session
            .process(&[&[1.0; 64], &[1.0; 64]], &mut [&mut l, &mut r])
            .is_err()
    );
    assert_eq!(l, [0.0; 64]);
    assert_eq!(r, [0.0; 64]);
}
