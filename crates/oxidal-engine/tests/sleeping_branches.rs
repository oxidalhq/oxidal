#![cfg(feature = "qualification")]

use oxidal_engine::{Session, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{GAIN_EXTENSION, SCENES_EXTENSION, SLEEP_BRANCHES_EXTENSION},
};
use serde_json::{Value, json};

const FRAMES: usize = 64;
const RATE: f64 = 48000.0;
const BUDGET: usize = 1 << 20;

fn fixture() -> Value {
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let gains = |playing| {
        json!(
            (0..3)
                .map(|port| json!({"node":"mix","port":port,"value":u8::from(playing==port)}))
                .collect::<Vec<_>>()
        )
    };
    let branches = (0..3)
        .map(|port| {
            json!({"id":format!("b{port}"),"name":format!("Branch {port}"),
                "gains":[{"node":"mix","port":port,"value":1}]})
        })
        .collect::<Vec<_>>();
    let scenes = (0..3)
        .map(|port| json!({"id":format!("s{port}"),"name":format!("Scene {port}"),"gains":gains(port)}))
        .collect::<Vec<_>>();
    let mut nodes = vec![
        json!({"id":"in","kind":"input","audioInputs":0,"audioOutputs":2}),
        json!({"id":"fan","kind":"split","audioInputs":1,"audioOutputs":3}),
        json!({"id":"mix","kind":"merge","audioInputs":3,"audioOutputs":1,"inputGains":[1,0,0]}),
        json!({"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}),
    ];
    let mut edges = vec![
        edge("mix", 0, "out", 0),
        edge("in", 1, "out", 1),
        edge("in", 0, "fan", 0),
    ];
    let mut delay = Vec::new();
    let mut sleeps = Vec::new();
    for port in 0..3 {
        let send = format!("send{port}");
        let fx = format!("fx{port}");
        nodes.push(
            json!({"id":send,"kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]}),
        );
        nodes.push(json!({"id":fx,"kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":fx,"bypassed":false}));
        edges.extend([
            edge("fan", port, &send, 0),
            edge(&send, 0, &fx, 0),
            edge(&fx, 0, "mix", port),
        ]);
        delay.push(json!({"id":fx,"pluginUri":"urn:oxidal:test:latency",
             "controls":{"mode":0,"delay":if port == 1 {137} else {0}},
             "assets":[],"requiredFeatures":[]}));
        sleeps.push(json!({"branch":format!("b{port}"),"sends":[send]}));
    }
    json!({
        "format":"oxidal.preset","formatVersion":1,"id":"68448a6d-0168-4fc8-b337-c12959165271",
        "name":"Explicit sleep fixture","tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[GAIN_EXTENSION,SCENES_EXTENSION,SLEEP_BRANCHES_EXTENSION],
        "extensions":{
            GAIN_EXTENSION:{},
            SCENES_EXTENSION:{"fade_ms":4,"scenes":scenes,"branches":branches},
            SLEEP_BRANCHES_EXTENSION:{"branches":sleeps},
        },
        "oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":delay,"recall":{"tails":"cut"}}
    })
}

fn parse(value: Value) -> Result<Bundle, oxidal_presets::Error> {
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), Default::default())
}

fn graph() -> (Bundle, World, Session) {
    let bundle = parse(fixture()).unwrap();
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let session = Session::new(bundle.clone(), &world, RATE, FRAMES, BUDGET).unwrap();
    (bundle, world, session)
}

fn render(s: &mut Session, x: f32) -> [f32; FRAMES] {
    let mut l = [0.0; FRAMES];
    let mut r = l;
    s.process(&[&[x; FRAMES], &[0.0; FRAMES]], &mut [&mut l, &mut r])
        .unwrap();
    s.pump().unwrap();
    l
}

fn state(s: &Session) -> BranchSleepState {
    s.snapshot().branch_sleep.unwrap()
}

fn branch(s: &Session, id: &str) -> BranchSleepPhase {
    state(s)
        .branches
        .into_iter()
        .find(|b| b.branch == id)
        .unwrap()
        .phase
}

fn select(s: &mut Session, id: &str, release_ms: Option<u32>) -> Result<(), String> {
    let cursor = s.snapshot();
    s.select_scene(SceneCommand {
        session: cursor.session,
        expected_revision: cursor.revision,
        scene: id.into(),
        release_ms,
        native_bypass_preview: None,
    })
}

fn sleep_wait(s: &mut Session, id: &str, input: f32) {
    for _ in 0..1800 {
        if branch(s, id) == BranchSleepPhase::Asleep {
            return;
        }
        let _ = render(s, input);
    }
    panic!("branch did not sleep: {:?}", state(s));
}

#[test]
fn sleep_is_required_and_graph_must_be_confined() {
    let mut value = fixture();
    value["requiredExtensions"].as_array_mut().unwrap().pop();
    assert!(parse(value).is_err());
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut value = fixture();
    let edges = value["oxidal"]["graph"]["edges"].as_array_mut().unwrap();
    edges[1]["to"] = json!({"node":"mix","port":2});
    edges
        .iter_mut()
        .find(|edge| edge["from"]["node"] == "fx2")
        .unwrap()["to"] = json!({"node":"out","port":1});
    let bundle = parse(value).unwrap();
    assert!(
        Session::new(bundle, &world, RATE, FRAMES, BUDGET)
            .unwrap_err()
            .contains("Sleeping branch")
    );
    let mut value = fixture();
    value["extensions"][SLEEP_BRANCHES_EXTENSION]["branches"][2]["sends"] = json!(["send1"]);
    assert!(parse(value).is_err());
}

#[test]
fn old_authored_routes_prepare_exact_sends_and_preserve_active_pcm() {
    let mut value = fixture();
    value["extensions"]
        .as_object_mut()
        .unwrap()
        .remove(SLEEP_BRANCHES_EXTENSION);
    value["requiredExtensions"].as_array_mut().unwrap().pop();
    let legacy = parse(value).unwrap();
    let mut manifest = legacy.manifest().clone();
    let plan = manifest.preview_sleep_branches();
    assert_eq!(plan.inserted_sends.len(), 3);
    assert_eq!(plan.inserted_sends[0].from.node, "fan");
    assert_eq!(plan.inserted_sends[0].to.node, "send0");
    assert_eq!(plan.inserted_sends[0].from.port, 0);
    assert!(legacy.manifest().sleep_branches().unwrap().is_none());
    manifest.prepare_sleep_branches().unwrap();
    assert_eq!(manifest.sleep_branches().unwrap(), plan.plan);
    let derived = Bundle::from_parts(manifest.encode().unwrap(), Default::default()).unwrap();
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    let mut old = Session::new(legacy, &world, RATE, FRAMES, BUDGET).unwrap();
    let mut new = Session::new(derived, &world, RATE, FRAMES, BUDGET).unwrap();
    for i in 0..1700 {
        let sample = if i % 3 == 0 { 0.25 } else { -0.16 };
        assert_eq!(render(&mut old, sample), render(&mut new, sample));
    }
    assert_eq!(branch(&new, "b1"), BranchSleepPhase::Asleep);
    assert_eq!(branch(&new, "b2"), BranchSleepPhase::Asleep);
    assert_eq!(state(&new).running_processors, 1);
}

#[test]
fn wake_retains_active_return_and_rapid_retarget_has_an_admitted_bound() {
    let (_, _, mut s) = graph();
    sleep_wait(&mut s, "b2", 0.25);
    assert_eq!(state(&s).running_processors, 1);
    assert_eq!(state(&s).admitted_processors, 3);
    select(&mut s, "s1", None).unwrap();
    assert_eq!(state(&s).requested_scene.as_deref(), Some("s1"));
    assert_eq!(state(&s).active_scene.as_deref(), Some("s0"));
    assert_eq!(branch(&s, "b1"), BranchSleepPhase::Priming);
    let block = render(&mut s, 0.25);
    assert!(block.iter().all(|&x| x == 0.25));
    select(&mut s, "s2", Some(33)).unwrap();
    assert_eq!(state(&s).requested_scene.as_deref(), Some("s2"));
    assert_eq!(state(&s).running_processors, 3);
    assert_eq!(branch(&s, "b1"), BranchSleepPhase::Draining);
    for _ in 0..3 {
        assert_eq!(state(&s).active_scene.as_deref(), Some("s0"));
        assert!(render(&mut s, 0.25).iter().all(|&x| x == 0.25));
    }
    assert_eq!(state(&s).active_scene.as_deref(), Some("s0"));
    assert!(render(&mut s, 0.25).iter().all(|&x| x == 0.25));
    assert_eq!(state(&s).active_scene.as_deref(), Some("s2"));
    assert_eq!(state(&s).requested_scene, None);
    for _ in 0..40 {
        let rendered = render(&mut s, 0.25);
        assert!(rendered.iter().all(|x| (0.24..=0.51).contains(x)));
    }
    assert!(
        render(&mut s, 0.25)
            .iter()
            .all(|&x| (x - 0.25).abs() < 0.000001)
    );
    assert_eq!(branch(&s, "b0"), BranchSleepPhase::Draining);
    sleep_wait(&mut s, "b0", 0.25);
    assert_eq!(state(&s).running_processors, 1);
}

#[test]
fn failed_wake_preserves_active_audio_and_names_the_refusal() {
    let (_, _, mut s) = graph();
    sleep_wait(&mut s, "b1", 0.4);
    let current = s.snapshot();
    s.apply(ControlCommand {
        session: current.session,
        expected_revision: current.revision,
        target: Target::Lv2 {
            node: "fx1".into(),
            symbol: "mode".into(),
        },
        value: 5.0,
    })
    .unwrap();
    // The failing mode only changes latency when process() runs. Several
    // blocks with it armed prove Asleep has no plugin callback.
    for _ in 0..8 {
        assert!(render(&mut s, 0.4).iter().all(|&x| x == 0.4));
    }
    assert_eq!(branch(&s, "b1"), BranchSleepPhase::Asleep);
    select(&mut s, "s1", None).unwrap();
    for _ in 0..5 {
        assert!(render(&mut s, 0.4).iter().all(|&x| x == 0.4));
    }
    let sleep = state(&s);
    assert!(s.healthy());
    assert_eq!(sleep.active_scene.as_deref(), Some("s0"));
    assert_eq!(sleep.requested_scene, None);
    assert!(sleep.message.unwrap().contains("prepared again"));
    assert_eq!(branch(&s, "b1"), BranchSleepPhase::Failed);
    assert!(select(&mut s, "s1", None).is_err());
}

#[test]
fn sleep_toggle_and_selected_scene_survive_recovery_and_save() {
    let (bundle, world, mut s) = graph();
    let cursor = s.snapshot();
    s.set_branch_sleep(BranchSleepCommand {
        session: cursor.session,
        expected_revision: cursor.revision,
        enabled: false,
    })
    .unwrap();
    assert!(s.snapshot().modified);
    assert_eq!(state(&s).running_processors, 3);
    select(&mut s, "s1", None).unwrap();
    assert_eq!(state(&s).requested_scene, None);
    let recall = s.snapshot().recall();
    let mut resumed = Session::new(bundle.clone(), &world, RATE, FRAMES, BUDGET).unwrap();
    resumed.restore(&recall).unwrap();
    assert!(!state(&resumed).enabled);
    assert_eq!(state(&resumed).active_scene.as_deref(), Some("s1"));

    let root = std::env::temp_dir().join(format!("oxidal-sleep-save-{}", std::process::id()));
    let store = BundleStore::new(root);
    store.save(&bundle).unwrap();
    let input = oxidal_audio::AudioProbe {
        endpoint: "hw:CARD=Qualification,DEV=0".into(),
        direction: oxidal_audio::Direction::Capture,
        sample_rate: RATE as u32,
        channels: 2,
        format: oxidal_audio::SampleFormat::S16,
        period_frames: FRAMES as u32,
        periods: 3,
    };
    let mut output = input.clone();
    output.direction = oxidal_audio::Direction::Playback;
    let saved = oxidal_engine::save_revision(
        &store,
        &world,
        SaveRequest {
            settings: StartRig {
                revision: bundle.revision().to_owned(),
                prepared: Vec::new(),
                recall: None,
                midi: None,
                stream: oxidal_audio::StreamConfig {
                    levels: Default::default(),
                    input,
                    output,
                    input_map: [0, 1],
                    output_map: [0, 1],
                    venue: None,
                    hear_yourself: true,
                },
            },
            recall,
            name: "Saved sleep setting".into(),
        },
    )
    .unwrap();
    let saved = store.read(&saved).unwrap();
    assert!(!saved.manifest().sleep_branches().unwrap().unwrap().enabled);
    let reopened = Session::new(saved, &world, RATE, FRAMES, BUDGET).unwrap();
    assert!(!state(&reopened).enabled);
    assert_eq!(state(&reopened).active_scene.as_deref(), Some("s1"));
}

fn tailed_fixture(feedback: f32) -> Bundle {
    let mut value = fixture();
    value["oxidal"]["lv2"][0]["pluginUri"] = json!("urn:oxidal:test:sleep-tail");
    value["oxidal"]["lv2"][0]["controls"] = json!({"gain":1.0,"feedback":feedback});
    let nodes = value["oxidal"]["graph"]["nodes"].as_array_mut().unwrap();
    let branch = nodes.iter_mut().find(|node| node["id"] == "fx0").unwrap();
    branch["audioInputs"] = json!(2);
    branch["audioOutputs"] = json!(2);
    nodes.extend([
        json!({"id":"sendR","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]}),
        json!({"id":"returnR","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]}),
    ]);
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let edges = value["oxidal"]["graph"]["edges"].as_array_mut().unwrap();
    edges[1] = edge("returnR", 0, "out", 1);
    edges.extend([
        edge("in", 1, "sendR", 0),
        edge("sendR", 0, "fx0", 1),
        edge("fx0", 1, "returnR", 0),
    ]);
    let scene = &mut value["extensions"][SCENES_EXTENSION];
    let gain = |level| json!({"node":"returnR","port":0,"value":level});
    scene["branches"][0]["gains"]
        .as_array_mut()
        .unwrap()
        .push(gain(1));
    for (index, row) in scene["scenes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        row["gains"]
            .as_array_mut()
            .unwrap()
            .push(gain(u8::from(index == 0)));
    }
    value["extensions"][SLEEP_BRANCHES_EXTENSION]["branches"][0]["sends"] =
        json!(["send0", "sendR"]);
    parse(value).unwrap()
}

#[test]
fn trails_drain_finite_tails_and_keep_endless_tails_in_the_running_count() {
    let world = World::bundle(oxidal_lv2::qualification_bundle()).unwrap();
    for feedback in [0.5, 1.0] {
        let mut s = Session::new(tailed_fixture(feedback), &world, RATE, FRAMES, BUDGET).unwrap();
        sleep_wait(&mut s, "b2", 0.0);
        // Feed the outgoing branch once. After the transition both available
        // inputs are zero, so any sound is its retained output history.
        let _ = render(&mut s, 0.2);
        select(&mut s, "s2", None).unwrap();
        for _ in 0..4 {
            let _ = render(&mut s, 0.0);
        }
        assert_eq!(state(&s).active_scene.as_deref(), Some("s2"));
        assert_eq!(branch(&s, "b0"), BranchSleepPhase::Draining);
        assert!(render(&mut s, 0.0).iter().any(|x| x.abs() > 0.001));
        let mut rendered = [0.0; FRAMES];
        for _ in 0..1800 {
            rendered = render(&mut s, 0.0);
        }
        if feedback == 1.0 {
            assert_eq!(branch(&s, "b0"), BranchSleepPhase::Draining);
            assert_eq!(state(&s).running_processors, 2);
            assert!(rendered.iter().all(|&x| (x - 0.2).abs() < 0.0001));
        } else {
            assert_eq!(branch(&s, "b0"), BranchSleepPhase::Asleep);
            assert_eq!(state(&s).running_processors, 1);
            assert_eq!(rendered, [0.0; FRAMES]);
        }
    }
}

#[cfg(target_os = "linux")]
#[test]
fn null_worker_confirms_pending_active_and_protected_recall() {
    use std::{
        io::{BufRead, BufReader, Write},
        process::{Child, Command, Stdio},
        sync::mpsc,
        time::{Duration, Instant},
    };
    struct Worker(Child);
    impl Drop for Worker {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let root = std::env::temp_dir().join(format!("oxidal-sleep-worker-{}", std::process::id()));
    let store = BundleStore::new(root.join("rigs"));
    let revision = store.save(&parse(fixture()).unwrap()).unwrap();
    let sandbox = root.join("runtime");
    std::fs::create_dir_all(&sandbox).unwrap();
    let fixture = std::path::Path::new(oxidal_lv2::qualification_bundle());
    let mut child = Worker(
        Command::new(env!("CARGO_BIN_EXE_oxidal-rig-worker"))
            .env("OXIDAL_QUALIFICATION_DATA", &sandbox)
            .env("OXIDAL_BUNDLE_STORE", root.join("rigs"))
            .env("OXIDAL_RIG_QUALIFY_NULL", "1")
            .env("LV2_PATH", fixture.parent().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let (send, recv) = mpsc::channel();
    let stdout = child.0.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if send.send(decode_worker_reply(line.as_bytes())).is_err() {
                break;
            }
        }
    });
    let mut stdin = child.0.stdin.take().unwrap();
    let mut transmit = |value: Value| {
        writeln!(&mut stdin, "{value}").unwrap();
        recv.recv_timeout(Duration::from_secs(6)).unwrap().unwrap()
    };
    let ready = transmit(json!({"revision":revision,"stream":{
        "input":{"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture",
            "sample_rate":48000,"channels":2,"format":"s16","period_frames":64,"periods":3},
        "output":{"endpoint":"hw:CARD=Qualification,DEV=0","direction":"playback",
            "sample_rate":48000,"channels":2,"format":"s16","period_frames":64,"periods":3},
        "input_map":[0,1],"output_map":[0,1],"hear_yourself":true
    }}));
    assert_eq!(
        ready.control.branch_sleep.unwrap().active_scene.as_deref(),
        Some("s0")
    );
    let wait = Instant::now() + Duration::from_secs(8);
    let sleeping = loop {
        std::thread::sleep(Duration::from_millis(40));
        let reply = transmit(json!({"kind":"status"}));
        if reply
            .control
            .branch_sleep
            .as_ref()
            .unwrap()
            .running_processors
            == 1
        {
            break reply;
        }
        assert!(Instant::now() < wait, "{:?}", reply.control.branch_sleep);
    };
    let _ = transmit(json!({"kind":"protect","on":true}));
    let pending = transmit(json!({"kind":"scene","command":{
        "session":sleeping.control.session, "expected_revision":sleeping.control.revision, "scene":"s1"
    }}));
    let status = pending.control.branch_sleep.unwrap();
    assert_eq!(status.active_scene.as_deref(), Some("s0"));
    assert_eq!(status.requested_scene.as_deref(), Some("s1"));
    let wait = Instant::now() + Duration::from_secs(5);
    loop {
        let reply = transmit(json!({"kind":"status"}));
        if reply.control.branch_sleep.unwrap().active_scene.as_deref() == Some("s1") {
            assert!(reply.processed_frames > pending.processed_frames);
            break;
        }
        assert!(Instant::now() < wait);
        std::thread::sleep(Duration::from_millis(20));
    }
    drop(stdin);
    let wait = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(exit) = child.0.try_wait().unwrap() {
            assert!(exit.success());
            break;
        }
        assert!(Instant::now() < wait);
        std::thread::sleep(Duration::from_millis(20));
    }
    reader.join().unwrap();
}
