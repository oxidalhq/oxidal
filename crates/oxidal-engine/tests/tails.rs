#![cfg(feature = "qualification")]
//! Signal-level regression for retained returns, not just transport continuity.
use oxidal_engine::{
    ResidentSet, Session,
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
fn outgoing_echo_matches_unswitched_decay_after_preset_recall() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    for preserve in [false, true] {
        let root =
            std::env::temp_dir().join(format!("oxidal-tails-{}-{preserve}", std::process::id()));
        let store = BundleStore::new(root.clone());
        let a = store.save(&echo("Outgoing", preserve)).unwrap();
        let b = store.save(&echo("Incoming", true)).unwrap();
        let mut reference =
            Session::new(echo("Reference", true), &world, 48000.0, 64, 1 << 20).unwrap();
        let mut rig =
            ResidentSet::new(&store, &world, &settings(&[a, b.clone()]), 1 << 20).unwrap();
        for block in 0..40 {
            if block == 2 {
                switch(&mut rig, &b);
            }
            let mut input = [0.0; 64];
            if block == 0 {
                input[0] = 0.25;
            }
            let (mut l, mut r, mut expected, mut er) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
            reference
                .process(&[&input, &input], &mut [&mut expected, &mut er])
                .unwrap();
            rig.process(&[&input, &input], &mut [&mut l, &mut r])
                .unwrap();
            if preserve {
                for i in 0..64 {
                    assert!(
                        (l[i] - expected[i]).abs() < 1e-6,
                        "tail cut at block {block} sample {i}"
                    );
                    assert_eq!(l[i], r[i]);
                }
            } else if block > 4 {
                assert_eq!(l[0], 0.0);
                assert!(expected[0] > 0.0); // Negative control really distinguishes Cut.
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn rapid_a_b_c_and_return_to_a_do_not_duplicate_or_lose_tail_history() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-tails-rapid-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let revisions: Vec<_> = ["A", "B", "C"]
        .iter()
        .map(|name| store.save(&echo(name, true)).unwrap())
        .collect();
    let mut rig = ResidentSet::new(&store, &world, &settings(&revisions), 1 << 20).unwrap();
    // Equal linear echo paths must sum to exactly one uninterrupted reference,
    // including when a still-ringing resident is selected again.
    let mut reference =
        Session::new(echo("Reference", true), &world, 48000.0, 64, 1 << 20).unwrap();
    for block in 0..2001 {
        if block > 0 {
            switch(&mut rig, &revisions[block % 3]);
        }
        let input: Vec<_> = (0..64)
            .map(|i| 0.01 * ((block * 64 + i) as f32 * 0.019).sin())
            .collect();
        let (mut l, mut r, mut e, mut er) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
        rig.process(&[&input, &input], &mut [&mut l, &mut r])
            .unwrap();
        reference
            .process(&[&input, &input], &mut [&mut e, &mut er])
            .unwrap();
        for i in 0..64 {
            assert!(
                (l[i] - e[i]).abs() < 2e-6,
                "recall {block} sample {i}: {} vs {}",
                l[i],
                e[i]
            );
        }
        assert!(!rig.switching());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn returning_from_cut_preset_does_not_duck_an_already_ringing_target() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-tails-mixed-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let a = store.save(&echo("Preserve", true)).unwrap();
    let b = store.save(&echo("Cut", false)).unwrap();
    let mut rig =
        ResidentSet::new(&store, &world, &settings(&[a.clone(), b.clone()]), 1 << 20).unwrap();
    let mut reference =
        Session::new(echo("Reference", true), &world, 48000.0, 64, 1 << 20).unwrap();
    for block in 0..40 {
        if block == 2 {
            switch(&mut rig, &b);
        }
        if block == 4 {
            switch(&mut rig, &a);
        }
        let mut input = [0.0; 64];
        if block == 0 {
            input[0] = 0.25;
        }
        let (mut l, mut r, mut e, mut er) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
        rig.process(&[&input, &input], &mut [&mut l, &mut r])
            .unwrap();
        reference
            .process(&[&input, &input], &mut [&mut e, &mut er])
            .unwrap();
        for i in 0..64 {
            assert!(
                (l[i] - e[i]).abs() < 1e-6,
                "mixed policy return cut at {block}:{i}"
            );
        }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn inaudible_preserved_return_sleeps_but_remains_gapless_ready() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-tails-sleep-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let a = store.save(&echo("Outgoing", true)).unwrap();
    let b = store.save(&echo("Incoming", true)).unwrap();
    let mut rig = ResidentSet::new(&store, &world, &settings(&[a, b.clone()]), 1 << 20).unwrap();
    for block in 0..1700 {
        if block == 2 {
            switch(&mut rig, &b);
        }
        let mut input = [0.0; 64];
        if block == 0 {
            input[0] = 0.25;
        }
        let (mut left, mut right) = ([0.0; 64], [0.0; 64]);
        rig.process(&[&input, &input], &mut [&mut left, &mut right])
            .unwrap();
    }
    let state = rig.snapshot();
    assert_eq!(state.source_revision, b);
    assert_eq!(state.prepared.len(), 1);
    assert!(!state.prepared[0].rendering);
    assert!(!state.prepared[0].tail);
    std::fs::remove_dir_all(root).unwrap();
}
