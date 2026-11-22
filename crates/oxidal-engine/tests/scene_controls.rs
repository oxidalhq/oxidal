//! Scene control targets: host ramps for continuous plugin controls and
//! silent switching for stepped ones (no click on a scene change).
//! @see docs/lv2.md
#![cfg(feature = "qualification")]
use oxidal_engine::{
    Session,
    protocol::{ControlCommand, SceneCommand, Snapshot, StompGroupCommand, Target},
};
use oxidal_lv2::World;
use oxidal_presets::Bundle;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const FRAMES: usize = 64;
const RATE: f64 = 48000.0;

fn edge(a: &str, ap: u8, b: &str, bp: u8) -> Value {
    json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}})
}
fn preset(nodes: Value, edges: Value, lv2: Value, fade_ms: u32, scenes: Value) -> Bundle {
    let value = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a11","name":"Scene controls",
        "tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":["urn:oxidal:scenes:1"],
        "extensions":{"urn:oxidal:scenes:1":{"fade_ms":fade_ms,"scenes":scenes}},
        "oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":lv2,"recall":{"tails":"cut"}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}
fn scene(id: &str, gains: Value, controls: Value) -> Value {
    json!({"id":id,"name":id,"gains":gains,"controls":controls})
}
/// The ABI fixture (`out = in × gain`) on the shared output chain, after a
/// selector both scenes keep open. `uri` picks the continuous or the integer
/// (stepped) gain port.
fn shared_chain(uri: &str, values: [f64; 2], fade_ms: u32) -> Bundle {
    let gains =
        json!([{"node":"merge","port":0,"value":1.0},{"node":"merge","port":1,"value":0.0}]);
    let control = |v: f64| json!([{"node":"fx","symbol":"gain","value":v}]);
    preset(
        json!([
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"merge","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1.0,0.0]},
            {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}]),
        json!([
            edge("in", 0, "split", 0),
            edge("split", 0, "merge", 0),
            edge("split", 1, "merge", 1),
            edge("merge", 0, "fx", 0),
            edge("in", 1, "fx", 1),
            edge("fx", 0, "out", 0),
            edge("fx", 1, "out", 1)
        ]),
        json!([{"id":"fx","pluginUri":uri,"controls":{"gain":values[0],"feedback":0},"assets":[],"requiredFeatures":[]}]),
        fade_ms,
        json!([
            scene("a", gains.clone(), control(values[0])),
            scene("b", gains, control(values[1]))
        ]),
    )
}
fn select(session: &mut Session, scene: &str) -> Result<(), String> {
    let cursor = session.snapshot();
    session.select_scene(SceneCommand {
        session: cursor.session,
        expected_revision: cursor.revision,
        scene: scene.into(),
        release_ms: None,
        native_bypass_preview: None,
    })
}
fn render(session: &mut Session, input: impl Fn(usize) -> f32, clock: &mut usize) -> Vec<f32> {
    let mut left = [0.0; FRAMES];
    for (i, sample) in left.iter_mut().enumerate() {
        *sample = input(*clock + i);
    }
    *clock += FRAMES;
    let right = [0.0; FRAMES];
    let (mut l, mut r) = ([0.0; FRAMES], [0.0; FRAMES]);
    session
        .process(&[&left, &right], &mut [&mut l, &mut r])
        .unwrap();
    l.to_vec()
}
fn control(snapshot: &Snapshot, node: &str, symbol: &str) -> f64 {
    snapshot
        .controls
        .iter()
        .find(|c| {
            c.target
                == (Target::Lv2 {
                    node: node.into(),
                    symbol: symbol.into(),
                })
        })
        .unwrap()
        .value
}
fn largest_step(samples: &[f32]) -> f32 {
    samples
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0, f32::max)
}

fn bypass_only(feedback: f64, bypassed: bool) -> Bundle {
    use oxidal_presets::manifest::SCENES_BYPASS_EXTENSION;
    let edge = |a, b, port| edge(a, port, b, port);
    let value = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a11","name":"Scene bypass",
        "tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[SCENES_BYPASS_EXTENSION],
        "extensions":{SCENES_BYPASS_EXTENSION:{"fade_ms":4,"scenes":[
            {"id":"wet","name":"Wet","gains":[],"bypass":[{"node":"fx","value":false}]},
            {"id":"dry","name":"Dry","gains":[],"bypass":[{"node":"fx","value":true}]}
        ]}},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":bypassed},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}
        ],"edges":[edge("in","fx",0),edge("in","fx",1),edge("fx","out",0),edge("fx","out",1)]},
        "lv2":[{"id":"fx","pluginUri":"urn:oxidal:test:contract","controls":{"gain":0.5,"feedback":feedback},
            "assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}

fn bypass_readback(snapshot: &Snapshot) -> f64 {
    snapshot
        .controls
        .iter()
        .find(|c| matches!(&c.target, Target::Bypass { node } if node == "fx"))
        .unwrap()
        .value
}

fn stomp_bundle() -> Bundle {
    use oxidal_presets::manifest::{SCENES_BYPASS_EXTENSION, STOMP_GROUPS_EXTENSION};
    let scene = |id, values: [bool; 3]| {
        let bypass = ["echo", "bloom", "ts9"]
            .into_iter()
            .zip(values)
            .map(|(node, value)| json!({ "node": node, "value": value }))
            .collect::<Vec<_>>();
        json!({"id":id,"name":id,"gains":[],"bypass":bypass})
    };
    let edges: Vec<_> = ["in", "ts9", "echo", "bloom", "out"]
        .windows(2)
        .flat_map(|path| [edge(path[0], 0, path[1], 0), edge(path[0], 1, path[1], 1)])
        .collect();
    let value = json!({
        "format":"oxidal.preset","formatVersion":1,
        "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a11","name":"Selective Wet",
        "tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[SCENES_BYPASS_EXTENSION,STOMP_GROUPS_EXTENSION],
        "extensions":{
            SCENES_BYPASS_EXTENSION:{"fade_ms":4,"scenes":[
                scene("dirt",[true,true,false]), scene("clean",[false,true,true])
            ]},
            STOMP_GROUPS_EXTENSION:{"groups":[{"id":"wet","name":"Wet","nodes":["echo","bloom"]}]}
        },
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"ts9","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"ts9","bypassed":false},
            {"id":"echo","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"echo","bypassed":true},
            {"id":"bloom","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"bloom","bypassed":true},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}
        ],"edges":edges},
        "lv2":[
            {"id":"echo","pluginUri":"urn:oxidal:test:contract","controls":{"gain":0.5,"feedback":0},"assets":[],"requiredFeatures":[]},
            {"id":"bloom","pluginUri":"urn:oxidal:test:contract","controls":{"gain":0.25,"feedback":0},"assets":[],"requiredFeatures":[]},
            {"id":"ts9","pluginUri":"urn:oxidal:test:contract","controls":{"gain":0.5,"feedback":0},"assets":[],"requiredFeatures":[]}
        ],"recall":{"tails":"cut"}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}

#[test]
fn stomp_group_touch_and_midi_share_confirmed_bypass_without_touching_ts9() {
    use oxidal_audio::midi::{
        Binding, ControlMode, Decoder, ParameterBinding, Settings, dispatch_protected,
    };
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(stomp_bundle(), &world, RATE, FRAMES, 1 << 20).unwrap();
    let ts9 = |session: &mut Session, bypass| {
        let view = session.snapshot();
        session
            .apply(ControlCommand {
                session: view.session,
                expected_revision: view.revision,
                target: Target::Bypass { node: "ts9".into() },
                value: bypass,
            })
            .unwrap();
    };
    let state = |session: &Session, expected, named, enabled, partial| {
        let snapshot = session.snapshot();
        assert!(snapshot.valid_stomp_state());
        let bypass = ["echo", "bloom", "ts9"].map(|id| {
            snapshot
                .controls
                .iter()
                .find(|row| matches!(&row.target, Target::Bypass { node } if node == id))
                .unwrap()
                .value
        });
        assert_eq!(bypass, expected);
        assert_eq!(snapshot.stomp_scene.as_deref(), Some(named));
        assert_eq!(snapshot.stomp_groups[0].enabled, enabled);
        assert_eq!(snapshot.stomp_groups[0].partial, partial);
    };
    let end_sample = |session: &mut Session| {
        let mut clock = 0;
        (0..4)
            .map(|_| render(session, |_| 1.0, &mut clock)[FRAMES - 1])
            .last()
            .unwrap()
    };

    state(&session, [1.0, 1.0, 0.0], "dirt", false, false);
    ts9(&mut session, 1.0);
    let view = session.snapshot();
    let touch = StompGroupCommand {
        session: view.session,
        expected_revision: view.revision,
        group: "wet".into(),
    };
    assert!(
        session
            .stomp_group(StompGroupCommand {
                group: "missing".into(),
                ..touch.clone()
            })
            .is_err()
    );
    state(&session, [1.0, 1.0, 1.0], "dirt", false, false);
    session.stomp_group(touch.clone()).unwrap();
    assert_eq!(session.snapshot().revision, touch.expected_revision + 1);
    assert!(
        session.stomp_group(touch).is_err(),
        "the second viewer was stale"
    );
    state(&session, [0.0, 0.0, 1.0], "dirt", true, false);
    assert_eq!(end_sample(&mut session), 0.125);
    select(&mut session, "clean").unwrap();
    state(&session, [0.0, 1.0, 1.0], "clean", false, true);
    assert_eq!(end_sample(&mut session), 0.5);

    ts9(&mut session, 0.0);
    let settings = Settings {
        input: "hw:Fixture,0,0".into(),
        channel: 1,
        bindings: vec![Binding {
            scene: "dirt".into(),
            program: None,
            controller: Some(42),
        }],
        branch_bindings: vec![],
        parameter_bindings: vec![ParameterBinding {
            expression: None,
            target: Target::StompGroup {
                group: "wet".into(),
            },
            controller: 41,
            mode: ControlMode::Toggle,
        }],
        extra_inputs: vec![],
    };
    session.snapshot().validate_midi(&settings).unwrap();
    let mut missing_group = settings.clone();
    missing_group.parameter_bindings[0].target = Target::StompGroup {
        group: "unavailable".into(),
    };
    assert!(session.snapshot().validate_midi(&missing_group).is_err());
    session
        .snapshot()
        .validate_restored_midi(&missing_group)
        .unwrap();
    let mut decoder = Decoder::default();
    let mut midi = |session: &mut Session, bytes: &[u8]| {
        for message in bytes.iter().filter_map(|byte| decoder.push(*byte)) {
            assert!(
                dispatch_protected(&settings, message, true, |s, m| session.midi_message(s, m))
                    .unwrap()
            );
        }
    };
    midi(&mut session, &[0xb0, 41, 127, 41, 0]);
    state(&session, [0.0, 0.0, 0.0], "clean", true, false);
    assert_eq!(end_sample(&mut session), 0.0625);
    midi(&mut session, &[41, 127]);
    state(&session, [1.0, 1.0, 0.0], "clean", false, false);
    assert_eq!(session.snapshot().scene.as_deref(), Some("dirt"));
    select(&mut session, "dirt").unwrap();
    state(&session, [1.0, 1.0, 0.0], "dirt", false, false);
    assert_eq!(end_sample(&mut session), 0.5);

    select(&mut session, "clean").unwrap();
    ts9(&mut session, 0.0);
    midi(&mut session, &[41, 127, 41, 0, 41, 127]);
    state(&session, [1.0, 1.0, 0.0], "clean", false, false);
    assert_eq!(session.snapshot().scene.as_deref(), Some("dirt"));
    midi(&mut session, &[42, 127]);
    state(&session, [1.0, 1.0, 0.0], "dirt", false, false);
}

#[test]
fn bypass_ramps_both_channels_per_frame_retargets_and_keeps_the_processor_warm() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let fixture = bypass_only(0.0, false);
    let mut session = Session::new(fixture, &world, RATE, FRAMES, 1 << 20).unwrap();
    let render = |s: &mut Session, left, right| {
        let (mut l, mut r) = ([0.0; FRAMES], [0.0; FRAMES]);
        s.process(&[&[left; FRAMES], &[right; FRAMES]], &mut [&mut l, &mut r])
            .unwrap();
        (l, r)
    };
    assert_eq!(render(&mut session, 1.0, -0.5).0, [0.5; FRAMES]);
    select(&mut session, "dry").unwrap();
    let selected = session.snapshot();
    assert_eq!(selected.scene.as_deref(), Some("dry"));
    assert_eq!(bypass_readback(&selected), 1.0);
    assert!(selected.scene_transitioning);
    // 4 ms = 192 frames. Both channels share the same per-frame blend.
    let (left, right) = render(&mut session, 1.0, -0.5);
    for (frame, (l, r)) in left.into_iter().zip(right).enumerate() {
        let expected = 0.5 + 0.5 * (frame + 1) as f32 / 192.0;
        assert!((l - expected).abs() < 1e-6);
        assert_eq!(r, -0.5 * l);
    }
    select(&mut session, "wet").unwrap();
    let (reverse, _) = render(&mut session, 1.0, -0.5);
    let from = left[FRAMES - 1];
    assert!((reverse[0] - (from + (0.5 - from) / 192.0)).abs() < 1e-6);
    render(&mut session, 1.0, -0.5);
    assert_eq!(render(&mut session, 1.0, -0.5).0[FRAMES - 1], 0.5);
    assert!(!session.snapshot().scene_transitioning);
    let cursor = session.snapshot();
    session
        .apply(ControlCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            target: Target::Bypass { node: "fx".into() },
            value: 1.0,
        })
        .unwrap();
    assert!(session.snapshot().scene_transitioning);
    assert_eq!(bypass_readback(&session.snapshot()), 1.0);
    let (direct, _) = render(&mut session, 1.0, -0.5);
    assert!((direct[0] - (0.5 + 0.5 / 192.0)).abs() < 1e-6);

    let mut warm = Session::new(bypass_only(0.5, true), &world, RATE, FRAMES, 1 << 20).unwrap();
    assert_eq!(warm.snapshot().scene.as_deref(), Some("dry"));
    assert_eq!(
        render(&mut warm, 1.0, -0.5),
        ([1.0; FRAMES], [-0.5; FRAMES])
    );
    select(&mut warm, "wet").unwrap();
    // The fixture's prior block feeds into this silent input at 50% feedback.
    // A bypassed processor that stopped running would have no wet history.
    let (left, right) = render(&mut warm, 0.0, 0.0);
    assert!((left[0] - 0.25 / 192.0).abs() < 1e-7);
    assert_eq!(right[0], -0.5 * left[0]);
}

#[test]
fn a_continuous_scene_control_ramps_per_block_within_bound_and_lands_exactly() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    // 40 ms at 48 kHz is 1920 frames: 30 blocks of 64.
    let mut session = Session::new(
        shared_chain("urn:oxidal:test:contract", [0.5, 1.5], 40),
        &world,
        RATE,
        FRAMES,
        1 << 20,
    )
    .unwrap();
    assert_eq!(session.snapshot().scene.as_deref(), Some("a"));
    let mut clock = 0;
    let dc = |_| 1.0;
    let mut samples = render(&mut session, dc, &mut clock);
    select(&mut session, "b").unwrap();
    // The target is published at once; the ramp is still running.
    let selected = session.snapshot();
    assert_eq!(selected.scene.as_deref(), Some("b"));
    assert_eq!(control(&selected, "fx", "gain"), 1.5);
    assert!(selected.scene_transitioning);
    for _ in 0..34 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    // Output is the plugin gain: no block moves more than 1.0 / 30.
    assert!(
        largest_step(&samples) <= 1.0 / 30.0 + 1e-5,
        "{}",
        largest_step(&samples)
    );
    assert!(
        samples[FRAMES..FRAMES * 30]
            .iter()
            .any(|v| *v > 0.5 && *v < 1.5)
    );
    assert_eq!(*samples.last().unwrap(), 1.5);
    assert_eq!(
        samples[FRAMES * 30],
        1.5,
        "target reached on the 30th block"
    );
    assert!(!session.snapshot().scene_transitioning);
    session.pump().unwrap();
    assert_eq!(control(&session.snapshot(), "fx", "gain"), 1.5);

    // Back again mid-ramp: retargets from the value reached, still bounded.
    select(&mut session, "a").unwrap();
    let mut samples = Vec::new();
    for _ in 0..10 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    select(&mut session, "b").unwrap();
    for _ in 0..34 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    assert!(largest_step(&samples) <= 1.0 / 30.0 + 1e-5);
    assert_eq!(*samples.last().unwrap(), 1.5);

    // A live edit during a ramp wins and stops it.
    select(&mut session, "a").unwrap();
    render(&mut session, dc, &mut clock);
    let cursor = session.snapshot();
    session
        .apply(ControlCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            target: Target::Lv2 {
                node: "fx".into(),
                symbol: "gain".into(),
            },
            value: 2.0,
        })
        .unwrap();
    let mut samples = Vec::new();
    for _ in 0..34 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    assert!(samples.iter().all(|v| *v == 2.0));
    let edited = session.snapshot();
    assert_eq!(control(&edited, "fx", "gain"), 2.0);
    assert_eq!(
        edited.scene, None,
        "an edited control no longer matches a scene"
    );
    assert!(!edited.scene_transitioning);
}

#[test]
fn out_of_range_or_wrong_kind_targets_refuse_to_prepare_the_rig() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    for bundle in [
        // Above the port's maximum of 2.
        shared_chain("urn:oxidal:test:contract", [0.5, 2.5], 40),
        // Not a whole number on an integer port.
        shared_chain("urn:oxidal:test:quantized", [1.0, 2.5], 40),
    ] {
        let error = Session::new(bundle, &world, RATE, FRAMES, 1 << 20).unwrap_err();
        assert!(error.contains("scene control"), "{error}");
    }
    let mut value: Value = serde_json::from_slice(
        &shared_chain("urn:oxidal:test:contract", [0.5, 1.5], 40)
            .manifest()
            .encode()
            .unwrap(),
    )
    .unwrap();
    // An output or unknown port is not a scene control.
    for symbol in ["missing", "out_l"] {
        for scene in value["extensions"]["urn:oxidal:scenes:1"]["scenes"]
            .as_array_mut()
            .unwrap()
        {
            scene["controls"][0]["symbol"] = json!(symbol);
        }
        let bundle =
            Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap();
        assert!(Session::new(bundle, &world, RATE, FRAMES, 1 << 20).is_err());
    }
}

#[test]
fn a_stepped_control_on_the_shared_chain_switches_once_at_the_fade_midpoint() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(
        shared_chain("urn:oxidal:test:quantized", [1.0, 3.0], 40),
        &world,
        RATE,
        FRAMES,
        1 << 20,
    )
    .unwrap();
    let mut clock = 0;
    let dc = |_| 1.0;
    render(&mut session, dc, &mut clock);
    select(&mut session, "b").unwrap();
    assert_eq!(control(&session.snapshot(), "fx", "gain"), 3.0);
    let mut samples = Vec::new();
    for _ in 0..34 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    // One switch, at the first block at or after 960 frames (block 15).
    let first = samples.iter().position(|v| *v == 3.0).unwrap();
    assert_eq!(first, 15 * FRAMES);
    assert!(samples[..first].iter().all(|v| *v == 1.0));
    assert!(samples[first..].iter().all(|v| *v == 3.0));
    assert!(!session.snapshot().scene_transitioning);
}

/// The stepped fixture inside a branch: scene "fx" plays it, scene "dry"
/// plays the dry path. Its integer gain only changes while it is silent.
fn gated_branch() -> Bundle {
    let gains = |fx: f64, dry: f64| {
        json!([{"node":"merge","port":0,"value":fx},{"node":"merge","port":1,"value":fx},
               {"node":"merge","port":2,"value":dry}])
    };
    let control = |v: f64| json!([{"node":"fx","symbol":"gain","value":v}]);
    preset(
        json!([
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":3},
            {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":false},
            {"id":"merge","kind":"merge","audioInputs":3,"audioOutputs":1,"inputGains":[0.5,0.5,0.0]},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}]),
        json!([
            edge("in", 0, "split", 0),
            edge("split", 0, "fx", 0),
            edge("split", 1, "fx", 1),
            edge("fx", 0, "merge", 0),
            edge("fx", 1, "merge", 1),
            edge("split", 2, "merge", 2),
            edge("merge", 0, "out", 0),
            edge("in", 1, "out", 1)
        ]),
        json!([{"id":"fx","pluginUri":"urn:oxidal:test:quantized","controls":{"gain":1,"feedback":0},"assets":[],"requiredFeatures":[]}]),
        10,
        json!([
            scene("fx", gains(0.5, 0.0), control(1.0)),
            scene("dry", gains(0.0, 1.0), control(3.0))
        ]),
    )
}

#[test]
fn a_stepped_control_in_a_branch_switches_only_while_the_branch_is_silent() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(gated_branch(), &world, RATE, FRAMES, 1 << 20).unwrap();
    assert_eq!(session.snapshot().scene.as_deref(), Some("fx"));
    let mut clock = 0;
    let dc = |_| 1.0;
    let mut samples = render(&mut session, dc, &mut clock);
    // Both scenes give 1.0, so any audible gain step shows as a jump.
    assert_eq!(samples[0], 1.0);
    // 10 ms = 480 frames: the branch closes while the dry path opens.
    select(&mut session, "dry").unwrap();
    for _ in 0..12 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    select(&mut session, "fx").unwrap();
    for _ in 0..12 {
        samples.extend(render(&mut session, dc, &mut clock));
    }
    // Had the gain switched to 3 while audible, the output would leave 1.0.
    assert!(
        samples.iter().all(|v| (*v - 1.0).abs() < 1e-5),
        "largest deviation {}",
        samples.iter().map(|v| (v - 1.0).abs()).fold(0.0, f32::max)
    );
    assert!(!session.snapshot().scene_transitioning);
    assert_eq!(control(&session.snapshot(), "fx", "gain"), 1.0);
}

/// No click on a real effect: an interpolating delay on the shared chain whose
/// time differs between scenes. A sine shows any jump in the read position.
#[test]
fn switching_scenes_with_a_delay_time_difference_produces_no_discontinuity() {
    let root = std::env::var("OXIDAL_LV2_EXTERNAL_DIR")
        .expect("Run with installed swh-lv2 (OXIDAL_LV2_EXTERNAL_DIR)");
    let world = World::bundle(&std::path::Path::new(&root).join("delay-swh.lv2")).unwrap();
    let delay = |time: f64| json!([{"node":"delay","symbol":"delay_time","value":time}]);
    let gain = json!([{"node":"level","port":0,"value":1.0},{"node":"level","port":1,"value":0.0}]);
    let bundle = preset(
        json!([
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"level","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1.0,0.0]},
            {"id":"delay","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"delay","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}]),
        json!([
            edge("in", 0, "split", 0),
            edge("split", 0, "level", 0),
            edge("split", 1, "level", 1),
            edge("level", 0, "delay", 0),
            edge("delay", 0, "out", 0),
            edge("in", 1, "out", 1)
        ]),
        json!([{"id":"delay","pluginUri":"http://plugin.org.uk/swh-plugins/delay_c",
                "controls":{"max_delay":1.0,"delay_time":0.1},"assets":[],"requiredFeatures":[]}]),
        200,
        json!([
            scene("short", gain.clone(), delay(0.1)),
            scene("long", gain, delay(0.15))
        ]),
    );
    let sine = |n: usize| (n as f32 * 2.0 * std::f32::consts::PI * 220.0 / RATE as f32).sin() * 0.5;
    let mut session = Session::new(bundle, &world, RATE, FRAMES, 1 << 20).unwrap();
    let mut clock = 0;
    let mut steady = Vec::new();
    for _ in 0..150 {
        steady.extend(render(&mut session, sine, &mut clock));
    }
    let normal = largest_step(&steady[FRAMES * 100..]);
    select(&mut session, "long").unwrap();
    let mut ramped = Vec::new();
    for _ in 0..200 {
        ramped.extend(render(&mut session, sine, &mut clock));
    }
    assert_eq!(
        control(&session.snapshot(), "delay", "delay_time"),
        f64::from(0.15f32)
    );
    // The same change as an instant live edit, for comparison.
    let cursor = session.snapshot();
    session
        .apply(ControlCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            target: Target::Lv2 {
                node: "delay".into(),
                symbol: "delay_time".into(),
            },
            value: 0.1,
        })
        .unwrap();
    let mut stepped = Vec::new();
    for _ in 0..40 {
        stepped.extend(render(&mut session, sine, &mut clock));
    }
    let (ramp, step) = (largest_step(&ramped), largest_step(&stepped));
    println!("steady {normal:.4}, scene ramp {ramp:.4}, instant step {step:.4}");
    // A 50 ms change over the 200 ms fade reads the delay line 25 % slower:
    // the sine's slope grows by about that much (measured 1.31×), never a
    // jump. The instant edit sweeps the whole change within one block
    // (measured 37× the steady slope): that is the click this test forbids.
    assert!(ramp <= normal * 1.4, "steady {normal}, ramp {ramp}");
    assert!(
        step > ramp * 10.0,
        "the instant step is the audible click: {step}"
    );
}

#[test]
#[ignore = "requires the actual built stereo Moment LV2 bundle"]
fn moment_keeps_the_caught_phrase_through_bypassed_and_active_scenes() {
    use oxidal_presets::manifest::SCENES_BYPASS_EXTENSION;

    let bundle = std::env::var_os("OXIDAL_MOMENT_LV2_BUNDLE").expect("Moment test bundle");
    let world = World::bundle(std::path::Path::new(&bundle)).unwrap();
    let mut manifest: Value =
        serde_json::from_slice(&bypass_only(0.0, false).manifest().encode().unwrap()).unwrap();
    manifest["oxidal"]["lv2"][0]["pluginUri"] = json!("urn:oxidal:plugin:moment#stereo");
    let info = world
        .plugins(RATE)
        .unwrap()
        .into_iter()
        .find(|p| p.uri == "urn:oxidal:plugin:moment#stereo")
        .unwrap();
    let controls: BTreeMap<_, _> = info
        .ports
        .into_iter()
        .filter(|p| p.input && p.control)
        .map(|p| (p.symbol, p.default.unwrap()))
        .collect();
    let settings = &mut manifest["oxidal"]["lv2"][0]["controls"];
    *settings = json!(controls);
    settings["route"] = json!(2);
    settings["wet"] = json!(0);
    settings["mix"] = json!(100);
    let scene = |id, catch: i32, bypass| {
        json!({
            "id":id,"name":id,"gains":[],
            "controls":[{"node":"fx","symbol":"catch","value":catch}],
            "bypass":[{"node":"fx","value":bypass}]
        })
    };
    manifest["extensions"][SCENES_BYPASS_EXTENSION]["scenes"] = json!([
        scene("listen", 0, false),
        scene("caught", 1, false),
        scene("bypassed", 1, true)
    ]);
    let preset =
        Bundle::from_parts(serde_json::to_vec(&manifest).unwrap(), BTreeMap::new()).unwrap();
    let mut session = Session::new(preset, &world, RATE, FRAMES, 1 << 20).unwrap();
    let mut clock = 0;
    for _ in 0..3200 {
        render(&mut session, |i| (i as f32 * 0.031).sin() * 0.4, &mut clock);
    }
    // From this point the live input is silent. Only Moment's memory can supply a signal.
    for (id, bypass) in [("caught", false), ("bypassed", true), ("caught", false)] {
        select(&mut session, id).unwrap();
        for _ in 0..32 {
            render(&mut session, |_| 0.0, &mut clock);
        }
        let state = session.snapshot();
        assert_eq!(state.scene.as_deref(), Some(id));
        assert!(!state.scene_transitioning);
        assert_eq!(control(&state, "fx", "catch"), 1.0);
        let peak = (0..128)
            .flat_map(|_| render(&mut session, |_| 0.0, &mut clock))
            .map(f32::abs)
            .fold(0.0, f32::max);
        if bypass {
            assert_eq!(peak, 0.0);
        } else {
            assert!(peak > 0.05, "{id}: {peak}");
        }
    }
}

#[test]
#[ignore = "requires the actual built stereo Moment LV2 bundle"]
fn named_settings_change_the_running_moment_atomically() {
    use oxidal_lv2::protocol::PluginDefaultsCommand;
    let bundle = std::env::var_os("OXIDAL_MOMENT_LV2_BUNDLE").expect("Moment test bundle");
    let world = World::bundle(std::path::Path::new(&bundle)).unwrap();
    let uri = "urn:oxidal:plugin:moment#stereo";
    let mut manifest: Value =
        serde_json::from_slice(&bypass_only(0., false).manifest().encode().unwrap()).unwrap();
    manifest["oxidal"]["lv2"][0]["pluginUri"] = json!(uri);
    let plugin = world
        .plugins(RATE)
        .unwrap()
        .into_iter()
        .find(|p| p.uri == uri)
        .unwrap();
    let defaults: BTreeMap<_, _> = plugin
        .ports
        .iter()
        .filter(|p| p.control && p.input)
        .map(|p| (&p.symbol, p.default.unwrap()))
        .collect();
    manifest["oxidal"]["lv2"][0]["controls"] = json!(defaults);
    let preset =
        Bundle::from_parts(serde_json::to_vec(&manifest).unwrap(), BTreeMap::new()).unwrap();
    let mut rig = Session::new(preset, &world, RATE, FRAMES, 1 << 20).unwrap();
    let original = rig.snapshot();
    let command = PluginDefaultsCommand {
        session: original.session.clone(),
        expected_revision: original.revision,
        node: "fx".into(),
    };
    let previous: BTreeMap<_, _> = original
        .controls
        .iter()
        .filter_map(|c| match &c.target {
            Target::Lv2 { node, symbol } if node == "fx" => Some((symbol.clone(), c.value as f32)),
            _ => None,
        })
        .collect();
    assert_eq!(previous.len(), 24);
    let mut values = previous.clone();
    values.insert("mix".into(), 0.);
    values.insert("length".into(), 7.);
    let mut bad = values.clone();
    bad.insert("shape".into(), 101.);
    for (plugin, settings) in [(uri, &bad), ("urn:oxidal:plugin:echo#stereo", &values)] {
        assert!(
            rig.apply_plugin_settings(command.clone(), Some((plugin, settings)))
                .is_err()
        );
        let state = rig.snapshot();
        assert_eq!(state.revision, original.revision);
        assert_eq!(control(&state, "fx", "mix"), f64::from(previous["mix"]));
        assert_eq!(
            control(&state, "fx", "length"),
            f64::from(previous["length"])
        );
    }
    rig.apply_plugin_settings(command.clone(), Some((uri, &values)))
        .unwrap();
    let state = rig.snapshot();
    assert!(state.modified);
    assert_eq!(state.revision, original.revision + 1);
    assert_eq!(control(&state, "fx", "mix"), 0.);
    assert_eq!(control(&state, "fx", "length"), 7.);
    let mut clock = 0;
    for _ in 0..100 {
        render(&mut rig, |_| 0.25, &mut clock);
    }
    assert!(
        render(&mut rig, |_| 0.25, &mut clock)
            .iter()
            .all(|v| (*v - 0.25).abs() < 0.0001)
    );
    assert!(
        rig.apply_plugin_settings(command.clone(), Some((uri, &previous)))
            .is_err()
    );
    let undo = PluginDefaultsCommand {
        expected_revision: state.revision,
        ..command
    };
    rig.apply_plugin_settings(undo, Some((uri, &previous)))
        .unwrap();
    let restored = rig.snapshot();
    assert!(!restored.modified);
    assert_eq!(restored.revision, state.revision + 1);
}
