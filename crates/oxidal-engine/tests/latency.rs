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
                    midi: None,
                    prepared: Vec::new(),
                    revision,
                    stream: oxidal_audio::StreamConfig {
                        levels: Default::default(),
                        hear_yourself: true,
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

fn state_bundle(world: &World, bad_alias: bool) -> Bundle {
    use oxidal_lv2::{Plugin, StatePath};
    use sha2::{Digest, Sha256};
    let path = std::env::temp_dir().join(format!(
        "oxidal-state-source-{}-{bad_alias}",
        std::process::id()
    ));
    let model = 0.375_f32.to_ne_bytes().to_vec();
    std::fs::write(&path, &model).unwrap();
    let mut plugin = Plugin::new_ports(world, "urn:oxidal:test:atoms", 48000.0, 64).unwrap();
    plugin.prepare_latency().unwrap();
    let absolute = std::ffi::CString::new(path.to_str().unwrap()).unwrap();
    plugin
        .queue_atom(
            2,
            0,
            "http://lv2plug.in/ns/ext/atom#Path",
            absolute.as_bytes_with_nul(),
        )
        .unwrap();
    plugin.process_mono(&mut [1.0; 64]).unwrap();
    let state = plugin
        .save_state(&[StatePath {
            absolute: path.clone(),
            alias: if bad_alias {
                "assets/missing.bin"
            } else {
                "assets/model.bin"
            }
            .into(),
        }])
        .unwrap();
    drop(plugin);
    std::fs::remove_file(path).unwrap(); // No source pathname is available to the engine.
    let state = serde_json::to_vec(&state).unwrap();
    let mut value = serde_json::to_value(bundle(0, 0, false).manifest()).unwrap();
    let host = &mut value["oxidal"];
    host["lv2"][0] = json!({"id":"fx","pluginUri":"urn:oxidal:test:atoms","controls":{"mode":0},"state":"state","assets":["asset"],"requiredFeatures":[]});
    value["resources"] = json!([
        {"id":"state","path":"state.json","kind":"lv2-state","bytes":state.len(),"sha256":format!("{:x}", Sha256::digest(&state))},
        {"id":"asset","path":"assets/model.bin","kind":"lv2-asset","bytes":model.len(),"sha256":format!("{:x}", Sha256::digest(&model))}
    ]);
    Bundle::from_parts(
        serde_json::to_vec(&value).unwrap(),
        BTreeMap::from([("state".into(), state), ("asset".into(), model)]),
    )
    .unwrap()
}

#[test]
fn portable_state_assets_survive_isolated_save_without_original_files() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let fixture = state_bundle(&world, false);
    let mut session = Session::new(fixture.clone(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let render = |session: &mut Session| {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        session
            .process(&[&[1.0; 64], &[0.5; 64]], &mut [&mut l, &mut r])
            .unwrap();
        assert_eq!(l, [0.84375; 64]); // 0.25 * restored model gain + 0.75 dry
        assert_eq!(r, [0.5; 64]);
    };
    render(&mut session);
    assert!(Session::new(state_bundle(&world, true), &world, 48000.0, 64, 1024 * 1024).is_err());
    render(&mut session); // A failed candidate cannot damage the existing owner.
    let root = std::env::temp_dir().join(format!(
        "oxidal-portable-state-store-{}",
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
    let request = SaveRequest {
        settings: StartRig {
            midi: None,
            prepared: Vec::new(),
            revision,
            stream: oxidal_audio::StreamConfig {
                levels: Default::default(),
                hear_yourself: true,
                input,
                output,
                input_map: [0, 1],
                output_map: [0, 1],
            },
            recall: None,
        },
        recall: session.snapshot().recall(),
        name: "Offline state".into(),
    };
    // Exercise the same separate export process used by the daemon. The child
    // discovers the fixture through the normal installed-plugin path.
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let fixture_path = oxidal_lv2::qualification_bundle();
    let mut child = Command::new(env!("CARGO_BIN_EXE_oxidal-rig-worker"))
        .arg("--save-revision")
        .env("OXIDAL_BUNDLE_STORE", &root)
        .env("LV2_PATH", fixture_path.parent().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    serde_json::to_writer(&mut input, &request).unwrap();
    input.write_all(b"\n").unwrap();
    drop(input);
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let saved: String = serde_json::from_slice(&result.stdout).unwrap();
    let direct = oxidal_engine::save_revision(&store, &world, request).unwrap();
    assert_eq!(saved, direct);
    drop(session);
    drop(fixture);
    let saved = store.read(&saved).unwrap();
    std::fs::remove_dir_all(root).unwrap(); // Playback owns materialized bundle assets.
    let mut restored = Session::new(saved, &world, 48000.0, 64, 1024 * 1024).unwrap();
    render(&mut restored);
}

#[test]
fn resident_switches_keep_continuous_aligned_pcm_and_owned_controls() {
    use oxidal_engine::{
        ResidentSet,
        protocol::{PreparedRecall, SwitchCommand},
    };
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-resident-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let a = store.save(&bundle(137, 0, false)).unwrap();
    let b = store.save(&bundle(29, 0, false)).unwrap();
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
    let settings = StartRig {
        midi: None,
        revision: a.clone(),
        recall: None,
        prepared: vec![PreparedRecall {
            revision: b.clone(),
            recall: None,
        }],
        stream: oxidal_audio::StreamConfig {
            levels: Default::default(),
            hear_yourself: true,
            input,
            output,
            input_map: [0, 1],
            output_map: [0, 1],
        },
    };
    let mut residents = ResidentSet::new(&store, &world, &settings, 1024 * 1024).unwrap();
    let needed = residents.snapshot().buffer_bytes;
    assert!(ResidentSet::new(&store, &world, &settings, needed - 1).is_err());
    let state = residents.snapshot();
    residents
        .active_mut()
        .apply(ControlCommand {
            session: state.session,
            expected_revision: state.revision,
            target: Target::Bypass { node: "fx".into() },
            value: 1.0,
        })
        .unwrap();
    let original = residents.snapshot();
    let command = |state: &oxidal_engine::protocol::Snapshot, revision: &str| SwitchCommand {
        session: state.session.clone(),
        expected_revision: state.revision,
        revision: revision.into(),
        fade_frames: 97,
    };
    let mut stale = command(&original, &b);
    stale.expected_revision += 1;
    assert!(residents.switch(stale).is_err());
    assert!(
        residents
            .switch(command(&original, &"0".repeat(64)))
            .is_err()
    );
    let signal = |sample: usize| 0.25 + 0.05 * (sample as f32 * 0.031).sin();
    for block in 0..100 {
        if block == 10 {
            residents
                .switch(command(&residents.snapshot(), &b))
                .unwrap();
            assert!(
                residents
                    .switch(command(&residents.snapshot(), &b))
                    .is_err()
            );
        }
        if block == 40 {
            residents
                .switch(command(&residents.snapshot(), &a))
                .unwrap();
        }
        let left: Vec<_> = (block * 64..(block + 1) * 64).map(signal).collect();
        let right: Vec<_> = left.iter().map(|s| -0.3 * s).collect();
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        residents
            .process(&[&left, &right], &mut [&mut l, &mut r])
            .unwrap();
        for i in 0..64 {
            let sample = block * 64 + i;
            let expected = if sample >= 137 {
                signal(sample - 137)
            } else {
                0.0
            };
            assert!(
                (l[i] - expected).abs() < 1e-6,
                "left discontinuity at {sample}: {} / {expected}",
                l[i]
            );
            assert!(
                (r[i] + 0.3 * expected).abs() < 1e-6,
                "right discontinuity at {sample}"
            );
        }
        if block == 20 {
            assert_eq!(residents.snapshot().source_revision, b);
            assert!(residents.snapshot().prepared[0].modified);
        }
    }
    assert!(!residents.switching());
    let after = residents.snapshot();
    assert_eq!(after.source_revision, a);
    assert_eq!(after.session, original.session);
    assert_eq!(after.revision, original.revision);
    assert_eq!(
        serde_json::to_value(after.controls).unwrap(),
        serde_json::to_value(original.controls).unwrap()
    );
    assert!(residents.take_switch_error().is_none());
    // A candidate which changes its latency when processing starts cannot take
    // down the existing stream or become the confirmed active revision.
    let failed = store.save(&bundle(13, 5, false)).unwrap();
    let mut failing = settings.clone();
    failing.prepared = vec![PreparedRecall {
        revision: failed.clone(),
        recall: None,
    }];
    let mut residents = ResidentSet::new(&store, &world, &failing, 1024 * 1024).unwrap();
    residents
        .switch(command(&residents.snapshot(), &failed))
        .unwrap();
    let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
    residents
        .process(&[&[0.25; 64], &[0.25; 64]], &mut [&mut l, &mut r])
        .unwrap();
    assert!(residents.healthy());
    assert!(!residents.switching());
    assert!(residents.take_switch_error().is_some());
    assert_eq!(residents.snapshot().source_revision, a);
    assert!(residents.snapshot().prepared[0].error.is_some());
    assert!(
        residents
            .switch(command(&residents.snapshot(), &failed))
            .is_err()
    );
    // Large reported delay must fail admission before a switch can outlive
    // the control deadline and accidentally stop the current healthy owner.
    let mut long: serde_json::Value =
        serde_json::from_slice(bundle(512, 0, false).manifest_bytes()).unwrap();
    let fx = long["oxidal"]["graph"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "fx")
        .unwrap()
        .clone();
    let plugin = long["oxidal"]["lv2"][0].clone();
    long["oxidal"]["graph"]["edges"][2]["from"]["node"] = json!("fx19");
    let mut previous = "fx".to_owned();
    for i in 1..20 {
        let id = format!("fx{i}");
        let mut node = fx.clone();
        node["id"] = json!(id);
        node["instance"] = json!(id);
        long["oxidal"]["graph"]["nodes"]
            .as_array_mut()
            .unwrap()
            .push(node);
        let mut effect = plugin.clone();
        effect["id"] = json!(id);
        long["oxidal"]["lv2"].as_array_mut().unwrap().push(effect);
        long["oxidal"]["graph"]["edges"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":{"node":previous,"port":0},"to":{"node":id,"port":0}}));
        previous = id;
    }
    let long = Bundle::from_parts(serde_json::to_vec(&long).unwrap(), BTreeMap::new()).unwrap();
    let long = store.save(&long).unwrap();
    let mut slow = settings.clone();
    slow.stream.input.sample_rate = 8000;
    slow.stream.output.sample_rate = 8000;
    slow.prepared = vec![PreparedRecall {
        revision: long,
        recall: None,
    }];
    assert!(
        ResidentSet::new(&store, &world, &slow, 1024 * 1024)
            .unwrap_err()
            .contains("live switch window")
    );
    assert!(residents.healthy());
    assert_eq!(residents.snapshot().source_revision, a);
    std::fs::remove_dir_all(root).unwrap();
}

// Two preloaded branches feed a selector, with one shared delayed processor
// downstream. Opposite DC signals make every transition sample observable.
fn scene_bundle() -> Bundle {
    let mut value: serde_json::Value = serde_json::from_slice(
        bundle(137, 0, false)
            .manifest()
            .encode()
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let merge = value["oxidal"]["graph"]["nodes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|n| n["id"] == "merge")
        .unwrap();
    merge["inputGains"] = json!([1.0, 0.0]);
    value["oxidal"]["graph"]["edges"] = json!([
        edge("in", 0, "merge", 0),
        edge("in", 1, "split", 0),
        edge("split", 0, "merge", 1),
        edge("merge", 0, "fx", 0),
        edge("fx", 0, "out", 0),
        edge("split", 1, "out", 1)
    ]);
    value["requiredExtensions"] = json!(["urn:oxidal:scenes:1"]);
    value["extensions"]["urn:oxidal:scenes:1"] = json!({"fade_ms":3,"scenes":[
        {"id":"clean","name":"Clean","gains":[{"node":"merge","port":0,"value":1.0},{"node":"merge","port":1,"value":0.0}]},
        {"id":"lead","name":"Lead","gains":[{"node":"merge","port":0,"value":0.0},{"node":"merge","port":1,"value":1.0}]}]});
    value["extensions"]["urn:oxidal:scenes:1"]["branches"] = serde_json::Value::Array(
        value["extensions"]["urn:oxidal:scenes:1"]["scenes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|scene| {
                let mut branch = scene.clone();
                branch["gains"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|g| g["value"].as_f64().unwrap() > 0.0);
                branch
            })
            .collect(),
    );
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}
#[test]
fn scenes_ramp_exact_samples_preserve_shared_history_and_reject_stale_commands() {
    use oxidal_engine::protocol::SceneCommand;
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    assert_eq!(session.snapshot().scene.as_deref(), Some("clean"));
    let input = [[1.0; 64], [-1.0; 64]];
    let render = |session: &mut Session| {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        session
            .process(&[&input[0], &input[1]], &mut [&mut l, &mut r])
            .unwrap();
        l
    };
    for _ in 0..4 {
        render(&mut session);
    }
    let before = session.snapshot();
    let command = SceneCommand {
        session: before.session,
        expected_revision: before.revision,
        scene: "lead".into(),
        release_ms: None,
    };
    session.select_scene(command.clone()).unwrap();
    assert!(session.select_scene(command).is_err());
    let selected = session.snapshot();
    assert!(selected.scene_transitioning);
    assert_eq!(selected.scene.as_deref(), Some("lead"));
    let mut samples = Vec::new();
    for _ in 0..6 {
        samples.extend(render(&mut session));
    }
    // The shared delay retains its entire pre-switch history, rather than
    // resetting, cutting it or replacing it with another effect instance.
    assert!(samples[..137].iter().all(|v| *v == 1.0));
    for frame in 0..144 {
        let expected = 1.0 - 2.0 * (frame + 1) as f32 / 144.0;
        assert!((samples[137 + frame] - expected).abs() < 0.00001);
    }
    assert!(samples[137 + 144..].iter().all(|v| *v == -1.0));
    assert!(!session.snapshot().scene_transitioning);
    let before = session.snapshot();
    let mut command = SceneCommand {
        session: before.session,
        expected_revision: before.revision,
        scene: "missing".into(),
        release_ms: None,
    };
    assert!(session.select_scene(command.clone()).is_err());
    assert_eq!(session.snapshot().revision, before.revision);
    command.scene = "clean".into();
    session.select_scene(command).unwrap();
    render(&mut session);
    let before = session.snapshot();
    session
        .select_scene(SceneCommand {
            session: before.session,
            expected_revision: before.revision,
            scene: "lead".into(),
            release_ms: None,
        })
        .unwrap();
    let mut samples = Vec::new();
    for _ in 0..7 {
        samples.extend(render(&mut session));
    }
    // Retarget from the audible gain, with no hard jump at the next block.
    assert!(
        samples
            .windows(2)
            .all(|w| (w[1] - w[0]).abs() <= 2.0 / 144.0 + 0.00001)
    );
    assert_eq!(samples.last(), Some(&-1.0));
}
#[test]
fn a_blend_fades_the_outgoing_scene_slowly_while_the_new_one_opens_at_once() {
    use oxidal_engine::protocol::SceneCommand;
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let input = [[1.0; 64], [-1.0; 64]];
    let render = |session: &mut Session| {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        session
            .process(&[&input[0], &input[1]], &mut [&mut l, &mut r])
            .unwrap();
        l
    };
    for _ in 0..4 {
        render(&mut session);
    }
    let before = session.snapshot();
    let blend = |release_ms| SceneCommand {
        session: before.session.clone(),
        expected_revision: before.revision,
        scene: "lead".into(),
        release_ms: Some(release_ms),
    };
    assert!(session.select_scene(blend(10_001)).is_err());
    // 30 ms: the outgoing scene (+1) closes over 1440 frames; the incoming
    // (−1) opens over the preset's own 3 ms (144 frames).
    session.select_scene(blend(30)).unwrap();
    let mut samples = Vec::new();
    for _ in 0..30 {
        samples.extend(render(&mut session));
    }
    let at = |frame: usize| samples[137 + frame];
    assert!((at(143) - (1.0 - 144.0 / 1440.0 - 1.0)).abs() < 0.0001);
    assert!((at(719) - (1.0 - 720.0 / 1440.0 - 1.0)).abs() < 0.0001);
    assert!((at(1439) + 1.0).abs() < 0.0001);
    assert!(samples[137 + 1440..].iter().all(|v| *v == -1.0));
    assert!(
        samples
            .windows(2)
            .all(|w| (w[1] - w[0]).abs() <= 1.0 / 144.0 + 1.0 / 1440.0 + 0.00001)
    );
}
#[test]
fn scene_definitions_reject_partial_duplicate_or_foreign_targets() {
    let source = scene_bundle();
    let value: serde_json::Value =
        serde_json::from_slice(source.manifest().encode().unwrap().as_slice()).unwrap();
    for (path, replacement) in [
        ("/requiredExtensions", json!([])),
        (
            "/extensions/urn:oxidal:scenes:1/branches/0/gains/0/value",
            json!(0),
        ),
        (
            "/extensions/urn:oxidal:scenes:1/branches/0/gains/0/port",
            json!(1),
        ),
        (
            "/extensions/urn:oxidal:scenes:1/branches/1/id",
            json!("clean"),
        ),
        ("/extensions/urn:oxidal:scenes:1/fade_ms", json!(0)),
        (
            "/extensions/urn:oxidal:scenes:1/scenes/1/id",
            json!("clean"),
        ),
        (
            "/extensions/urn:oxidal:scenes:1/scenes/1/gains/0/node",
            json!("fx"),
        ),
        (
            "/extensions/urn:oxidal:scenes:1/scenes/1/gains/1/port",
            json!(0),
        ),
        (
            "/extensions/urn:oxidal:scenes:1/scenes/1/gains/1/value",
            json!(-1),
        ),
    ] {
        let mut changed = value.clone();
        *changed.pointer_mut(path).unwrap() = replacement;
        assert!(
            Bundle::from_parts(serde_json::to_vec(&changed).unwrap(), BTreeMap::new()).is_err(),
            "Accepted {path}"
        );
    }
    let mut partial = value;
    partial["extensions"]["urn:oxidal:scenes:1"]["scenes"][1]["gains"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(Bundle::from_parts(serde_json::to_vec(&partial).unwrap(), BTreeMap::new()).is_err());
}

#[test]
fn independent_branches_mix_smoothly_without_changing_other_branch_gains() {
    use oxidal_engine::protocol::BranchCommand;
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let render = |session: &mut Session| {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        session
            .process(&[&[0.25; 64], &[0.5; 64]], &mut [&mut l, &mut r])
            .unwrap();
        l
    };
    for _ in 0..4 {
        render(&mut session);
    }
    let cursor = session.snapshot();
    let enable = BranchCommand {
        session: cursor.session,
        expected_revision: cursor.revision,
        branch: "lead".into(),
        enabled: true,
    };
    session.set_branch(enable.clone()).unwrap();
    assert!(session.set_branch(enable).is_err());
    let both = session.snapshot();
    assert!(both.branches.iter().all(|b| b.enabled && !b.partial));
    assert!(both.scene.is_none());
    let mut samples = Vec::new();
    for _ in 0..6 {
        samples.extend(render(&mut session));
    }
    assert!(samples[..137].iter().all(|v| *v == 0.25));
    for i in 0..144 {
        assert!((samples[137 + i] - (0.25 + 0.5 * (i + 1) as f32 / 144.0)).abs() < 0.00001);
    }
    assert!(samples[281..].iter().all(|v| *v == 0.75));
    let cursor = session.snapshot();
    session
        .set_branch(BranchCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            branch: "clean".into(),
            enabled: false,
        })
        .unwrap();
    for _ in 0..6 {
        render(&mut session);
    }
    let only = session.snapshot();
    assert_eq!(only.scene.as_deref(), Some("lead"));
    assert!(!only.branches[0].enabled && only.branches[1].enabled);
    let before = only.revision;
    assert!(
        session
            .set_branch(BranchCommand {
                session: only.session,
                expected_revision: before,
                branch: "foreign".into(),
                enabled: true
            })
            .is_err()
    );
    assert_eq!(session.snapshot().revision, before);
}

#[test]
fn decoded_midi_selects_scenes_and_toggles_or_gates_the_actual_branch_mix() {
    use oxidal_audio::midi::{Binding, BranchBinding, BranchMode, Decoder, Settings};
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session = Session::new(scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let mut settings = Settings {
        input: "hw:Controller,0,0".into(),
        channel: 1,
        bindings: vec![Binding {
            scene: "lead".into(),
            program: Some(1),
            controller: None,
        }],
        parameter_bindings: vec![],
        branch_bindings: vec![BranchBinding {
            branch: "lead".into(),
            controller: 64,
            mode: BranchMode::Toggle,
        }],
    };
    settings.validate().unwrap();
    let feed = |session: &mut Session, settings: &Settings, bytes: &[u8]| {
        let mut decoder = Decoder::default();
        for byte in bytes {
            if let Some(message) = decoder.push(*byte) {
                session.midi_message(settings, message).unwrap();
            }
        }
    };
    feed(&mut session, &settings, &[0xb0, 64, 127, 0xf8, 64, 0]);
    assert!(session.snapshot().branches.iter().all(|b| b.enabled));
    feed(&mut session, &settings, &[0xb0, 64, 127]);
    assert!(!session.snapshot().branches[1].enabled);
    feed(&mut session, &settings, &[0xc1, 1]); // wrong channel
    assert_eq!(session.snapshot().scene.as_deref(), Some("clean"));
    feed(&mut session, &settings, &[0xc0, 1]);
    assert_eq!(session.snapshot().scene.as_deref(), Some("lead"));
    settings.branch_bindings[0].mode = BranchMode::Gate;
    feed(&mut session, &settings, &[0xb0, 64, 0]);
    assert!(session.snapshot().branches.iter().all(|b| !b.enabled));
    feed(&mut session, &settings, &[0xb0, 64, 127]);
    assert_eq!(session.snapshot().scene.as_deref(), Some("lead"));
}

fn input_gate_scene_bundle() -> Bundle {
    let mut value = serde_json::to_value(bundle(337, 0, false).manifest()).unwrap();
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let nodes = value["oxidal"]["graph"]["nodes"].as_array_mut().unwrap();
    nodes.iter_mut().find(|n| n["id"] == "merge").unwrap()["inputGains"] = json!([1, 1]);
    nodes.push(
        json!({"id":"feed_a","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]}),
    );
    nodes.push(
        json!({"id":"feed_b","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[0]}),
    );
    value["oxidal"]["graph"]["edges"] = json!([
        edge("in", 0, "split", 0),
        edge("split", 0, "feed_a", 0),
        edge("split", 1, "feed_b", 0),
        edge("feed_a", 0, "fx", 0),
        edge("fx", 0, "merge", 0),
        edge("feed_b", 0, "merge", 1),
        edge("merge", 0, "out", 0),
        edge("in", 1, "out", 1)
    ]);
    value["extensions"]["urn:oxidal:gain:1"] = json!({});
    value["requiredExtensions"] = json!(["urn:oxidal:scenes:1", "urn:oxidal:gain:1"]);
    value["extensions"]["urn:oxidal:scenes:1"] = json!({"fade_ms":3,"scenes":[{"id":"clean","name":"Clean","gains":[{"node":"feed_a","port":0,"value":1},{"node":"feed_b","port":0,"value":0}]},{"id":"lead","name":"Lead","gains":[{"node":"feed_a","port":0,"value":0},{"node":"feed_b","port":0,"value":1}]}],"branches":[{"id":"clean","name":"Clean","gains":[{"node":"feed_a","port":0,"value":1}]},{"id":"lead","name":"Lead","gains":[{"node":"feed_b","port":0,"value":1}]}]});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}
#[test]
fn scene_input_gates_keep_outgoing_branch_audio_and_latency_aligned_crossfades() {
    use oxidal_engine::protocol::{BranchCommand, SceneCommand};
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session =
        Session::new(input_gate_scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    assert_eq!(session.snapshot().latency_frames, 337);
    let render = |s: &mut Session, input: &[f32; 64]| {
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        s.process(&[input, &[0.0; 64]], &mut [&mut l, &mut r])
            .unwrap();
        l
    };
    let mut input = [0.0; 64];
    input[63] = 0.75;
    let mut samples = render(&mut session, &input).to_vec();
    let cursor = session.snapshot();
    session
        .select_scene(SceneCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            scene: "lead".into(),
            release_ms: None,
        })
        .unwrap();
    for _ in 0..10 {
        samples.extend(render(&mut session, &[0.0; 64]));
    }
    // The old branch's queued impulse emerges after its input ramp has finished.
    assert_eq!(samples.iter().filter(|x| **x != 0.0).count(), 1);
    assert_eq!(samples[337 + 63], 0.75);
    assert!(!session.snapshot().scene_transitioning);
    let mut continuous =
        Session::new(input_gate_scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    for _ in 0..8 {
        render(&mut continuous, &[1.0; 64]);
    }
    let cursor = continuous.snapshot();
    continuous
        .select_scene(SceneCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            scene: "lead".into(),
            release_ms: None,
        })
        .unwrap();
    for _ in 0..12 {
        assert!(
            render(&mut continuous, &[1.0; 64])
                .iter()
                .all(|v| (*v - 1.0).abs() < 1e-5)
        );
    }
    // Removing the newly selected input drains the already prepared delay path;
    // no branch output gate cuts that history and no processor is reconstructed.
    let cursor = continuous.snapshot();
    continuous
        .set_branch(BranchCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            branch: "lead".into(),
            enabled: false,
        })
        .unwrap();
    let mut tail = Vec::new();
    for _ in 0..12 {
        tail.extend(render(&mut continuous, &[1.0; 64]));
    }
    assert!(tail[..337].iter().all(|v| *v == 1.0));
    assert!(tail[337 + 144..].iter().all(|v| *v == 0.0));
    let recall = continuous.snapshot().recall();
    let mut fresh =
        Session::new(input_gate_scene_bundle(), &world, 48000.0, 64, 1024 * 1024).unwrap();
    fresh.restore(&recall).unwrap();
    assert!(fresh.snapshot().branches.iter().all(|b| !b.enabled));
}

#[test]
fn decoded_parameter_cc_uses_confirmed_controls_and_rejects_latency_edits() {
    use oxidal_audio::midi::{ControlMode, Decoder, ParameterBinding, Settings};
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut session =
        Session::new(bundle(137, 0, false), &world, 48000.0, 64, 1024 * 1024).unwrap();
    let mut settings = Settings {
        input: "hw:Controller,0,0".into(),
        channel: 2,
        bindings: vec![],
        branch_bindings: vec![],
        parameter_bindings: vec![ParameterBinding {
            target: Target::Merge {
                node: "merge".into(),
                port: 0,
            },
            controller: 20,
            mode: ControlMode::Absolute,
        }],
    };
    session.snapshot().validate_midi(&settings).unwrap(); // no scenes required
    let feed = |session: &mut Session, settings: &Settings, bytes: &[u8]| -> Result<(), String> {
        let mut decoder = Decoder::default();
        for byte in bytes {
            if let Some(message) = decoder.push(*byte) {
                session.midi_message(settings, message)?;
            }
        }
        Ok(())
    };
    let initial = session.snapshot();
    feed(&mut session, &settings, &[0xb0, 20, 127]).unwrap();
    assert_eq!(session.snapshot().revision, initial.revision); // wrong channel
    feed(&mut session, &settings, &[0xb1, 20, 127]).unwrap();
    let control = |session: &Session, target: &Target| {
        session
            .snapshot()
            .controls
            .iter()
            .find(|c| &c.target == target)
            .unwrap()
            .clone()
    };
    let target = settings.parameter_bindings[0].target.clone();
    assert_eq!(
        control(&session, &target).value,
        control(&session, &target).maximum
    );
    let applied = session.snapshot().revision;
    feed(&mut session, &settings, &[0xb1, 20, 127]).unwrap();
    assert_eq!(session.snapshot().revision, applied); // repeated value is not a new edit
    settings.parameter_bindings[0].mode = ControlMode::RelativeTwosComplement;
    feed(&mut session, &settings, &[0xb1, 20, 127]).unwrap();
    assert!(control(&session, &target).value < control(&session, &target).maximum);
    settings.parameter_bindings[0] = ParameterBinding {
        target: Target::Bypass { node: "fx".into() },
        controller: 20,
        mode: ControlMode::Toggle,
    };
    feed(&mut session, &settings, &[0xb1, 20, 127, 0xf8, 20, 0]).unwrap();
    assert_eq!(
        control(&session, &settings.parameter_bindings[0].target).value,
        1.0
    );
    settings.parameter_bindings[0] = ParameterBinding {
        target: Target::Lv2 {
            node: "fx".into(),
            symbol: "delay".into(),
        },
        controller: 20,
        mode: ControlMode::Absolute,
    };
    let cursor = session.snapshot();
    session
        .apply(ControlCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            target: Target::Merge {
                node: "merge".into(),
                port: 0,
            },
            value: 0.25,
        })
        .unwrap();
    let before = session.snapshot();
    assert!(feed(&mut session, &settings, &[0xb1, 20, 0]).is_err()); // latency admission protects sound
    assert_eq!(session.snapshot().revision, before.revision);
    assert!(session.healthy());
    impulse(|input, output| session.process(input, output), 137);
    settings.parameter_bindings[0].target = Target::Lv2 {
        node: "missing".into(),
        symbol: "gain".into(),
    };
    assert!(session.snapshot().validate_midi(&settings).is_err());
    assert!(session.snapshot().validate_restored_midi(&settings).is_ok());
    assert!(feed(&mut session, &settings, &[0xb1, 20, 127]).is_err());
    assert!(session.healthy());
    settings
        .parameter_bindings
        .push(settings.parameter_bindings[0].clone());
    assert!(settings.validate().is_err());
}
