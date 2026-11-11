//! Scene control targets: host ramps for continuous plugin controls and
//! silent switching for stepped ones (S-18: no click on a scene change).
//! @see docs/lv2.md
#![cfg(feature = "qualification")]
use oxidal_engine::{
    Session,
    protocol::{ControlCommand, SceneCommand, Snapshot, Target},
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

/// S-18 on a real effect: an interpolating delay on the shared chain whose
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
    // (measured 37× the steady slope): that is the click S-18 forbids.
    assert!(ramp <= normal * 1.4, "steady {normal}, ramp {ramp}");
    assert!(
        step > ramp * 10.0,
        "the instant step is the audible click: {step}"
    );
}
