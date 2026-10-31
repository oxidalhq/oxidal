#![cfg(feature = "qualification")]
//! Serial/parallel signal equivalence over real LV2 histories and rapid recalls.
use oxidal_engine::{
    ResidentSet,
    protocol::{PreparedRecall, StartRig, SwitchCommand},
};
use oxidal_lv2::World;
use oxidal_presets::{Bundle, BundleStore};
use serde_json::json;
use std::collections::BTreeMap;

fn echo(name: &str, preserve: bool) -> Bundle {
    let edge = |a, ap, b, bp| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let value = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"68448a6d-0168-4fc8-b337-c12959165271","name":name,
        "tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"fx",0),edge("in",1,"fx",1),edge("fx",0,"out",0),edge("fx",1,"out",1)]},
        "lv2":[{"id":"fx","pluginUri":"urn:oxidal:test:contract","controls":{"gain":1,"feedback":0.9},"assets":[],"requiredFeatures":[]}],
        "recall":{"tails":if preserve {"preserve"} else {"cut"}}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}
fn settings(revisions: &[String]) -> StartRig {
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
    StartRig {
        midi: None,
        revision: revisions[0].clone(),
        recall: None,
        prepared: revisions[1..]
            .iter()
            .map(|revision| PreparedRecall {
                revision: revision.clone(),
                recall: None,
            })
            .collect(),
        stream: oxidal_audio::StreamConfig {
            levels: Default::default(),
            hear_yourself: true,
            input,
            output,
            input_map: [0, 1],
            output_map: [0, 1],
        },
    }
}
fn switch(rig: &mut ResidentSet, revision: &str) {
    let state = rig.snapshot();
    rig.switch(SwitchCommand {
        session: state.session,
        expected_revision: state.revision,
        revision: revision.into(),
        fade_frames: 17,
    })
    .unwrap();
}

#[test]
fn five_parallel_residents_match_serial_pcm_through_mixed_recalls() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-parallel-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let revisions: Vec<_> = (0..5)
        .map(|i| {
            store
                .save(&echo(&format!("Voice {i}"), i % 2 == 0))
                .unwrap()
        })
        .collect();
    // This integration binary contains only this test, so the serial graph is
    // constructed before the process-wide render-thread mode is enabled.
    let mut serial =
        ResidentSet::new(&store, &world, &settings(&revisions), 32 * 1024 * 1024).unwrap();
    oxidal_engine::render::enable_render_thread();
    let mut parallel =
        ResidentSet::new(&store, &world, &settings(&revisions), 32 * 1024 * 1024).unwrap();
    let mut cursor = 0;
    for block in 0..10_000 {
        if block % 3 == 2 {
            cursor = (cursor + 1) % revisions.len();
            switch(&mut serial, &revisions[cursor]);
            switch(&mut parallel, &revisions[cursor]);
        }
        let input: Vec<f32> = (0..64)
            .map(|i| {
                if block % 11 < 5 {
                    ((block * 64 + i) as f32 * 0.013).sin() * 0.1
                } else {
                    0.0
                }
            })
            .collect();
        let (mut sl, mut sr, mut pl, mut pr) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
        serial
            .process(&[&input, &input], &mut [&mut sl, &mut sr])
            .unwrap();
        parallel
            .process(&[&input, &input], &mut [&mut pl, &mut pr])
            .unwrap();
        assert_eq!(sl, pl, "left PCM differed at block {block}");
        assert_eq!(sr, pr, "right PCM differed at block {block}");
        assert_eq!(serial.switching(), parallel.switching());
    }
    drop((serial, parallel));
    std::fs::remove_dir_all(root).unwrap();
}
