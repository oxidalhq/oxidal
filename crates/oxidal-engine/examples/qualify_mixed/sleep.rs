//! Software wake comparison with pinned A2/LSTM and a real shared LV2 process.
use oxidal_engine::{ResidentSet, Session, protocol::*, render::SharedRig};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{GAIN_EXTENSION, SCENES_EXTENSION, SLEEP_BRANCHES_EXTENSION},
};
use oxidal_tone3000::{Engine, InputMode};
use serde_json::json;
use std::{
    collections::BTreeMap,
    error::Error,
    path::Path,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const FRAMES: usize = 96;
const RATE: f64 = 48000.0;

fn lstm(original: &[u8], model: &Path) -> Result<Vec<u8>> {
    let mut engine = Engine::new(RATE, FRAMES)?;
    engine.load_preset(original)?;
    engine.set_input_mode(InputMode::Left)?;
    engine.set_normalized("osEnabled", 0.0)?;
    engine.prepare_stream()?;
    let block = engine
        .scene_bypass_candidates()?
        .into_iter()
        .next()
        .ok_or("Missing A2 block")?
        .block;
    let tone = json!({"id":4993,"title":"Pinned LSTM wake","format":"nam","gear":"amp",
        "models":[{"id":4994,"name":"Pinned LSTM example","model_url":"oxidal-model://qualification/lstm.nam"}]});
    engine.prepare_model(&block, model, &tone)?;
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        match engine.model_preparation(0)?["phase"].as_str() {
            Some("ready") => {
                engine.model_preparation(1)?;
            }
            Some("applying") => {
                engine.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
            }
            Some("preparing") => {
                engine.pump()?;
                std::thread::sleep(Duration::from_millis(2));
            }
            Some("applied") => break,
            phase => return Err(format!("Unexpected LSTM phase {phase:?}").into()),
        }
        assert!(Instant::now() < deadline);
    }
    engine.prepare_stream()?;
    Ok(engine.save_preset("LSTM wake qualification")?)
}

fn rig(a2: Vec<u8>, lstm: Vec<u8>) -> Result<Bundle> {
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let gains = |port: u8, value: u8| {
        [
            json!({"node":"sumL","port":port,"value":value}),
            json!({"node":"sumR","port":port,"value":value}),
        ]
    };
    let scene = |id, index| json!({"id":id,"name":id,"gains":([gains(0,u8::from(index == 0)),gains(1,u8::from(index == 1))].concat())});
    let mut nodes = vec![
        json!({"id":"in","kind":"input","audioInputs":0,"audioOutputs":2}),
        json!({"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}),
        json!({"id":"sumL","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1,0]}),
        json!({"id":"sumR","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1,0]}),
        json!({"id":"post","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"post","bypassed":false}),
    ];
    let mut edges = vec![
        edge("sumL", 0, "post", 0),
        edge("post", 0, "out", 0),
        edge("sumR", 0, "out", 1),
    ];
    let mut tone = Vec::new();
    let mut resources = Vec::new();
    let mut sleeps = Vec::new();
    let mut branches = Vec::new();
    for (port, (id, bytes)) in [("a2", &a2), ("lstm", &lstm)].into_iter().enumerate() {
        let port = port as u8;
        let sends = [format!("{id}SendL"), format!("{id}SendR")];
        let fan = format!("{id}Fan");
        nodes.push(json!({"id":fan,"kind":"split","audioInputs":1,"audioOutputs":2}));
        edges.push(edge("in", port, &fan, 0));
        for (channel, send) in sends.iter().enumerate() {
            nodes.push(
                json!({"id":send,"kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]}),
            );
            edges.extend([
                edge(&fan, channel as u8, send, 0),
                edge(send, 0, id, channel as u8),
            ]);
        }
        nodes.push(json!({"id":id,"kind":"tone3000","audioInputs":2,"audioOutputs":2,"instance":id,"bypassed":false}));
        edges.extend([edge(id, 0, "sumL", port), edge(id, 1, "sumR", port)]);
        tone.push(json!({"id":id,"preset":id,"profile":oxidal_engine::native_profile_id()?}));
        resources.push(
            json!({"id":id,"path":format!("{id}.t3kpreset"),"kind":"tone3000-preset",
            "bytes":bytes.len(),"sha256":oxidal_presets::inspect(bytes)?.sha256}),
        );
        sleeps.push(json!({"branch":id,"sends":sends}));
        branches.push(json!({"id":id,"name":id,"gains":gains(port,1)}));
    }
    let m = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"68448a6d-0168-4fc8-b337-c12959165271","name":"A2 LSTM sleeping branch proof",
        "tone3000":{"instances":tone},"resources":resources,
        "requiredExtensions":[GAIN_EXTENSION,SCENES_EXTENSION,SLEEP_BRANCHES_EXTENSION],
        "extensions":{
            GAIN_EXTENSION:{}, SCENES_EXTENSION:{"fade_ms":12,"scenes":[scene("a2",0),scene("lstm",1)],"branches":branches},
            SLEEP_BRANCHES_EXTENSION:{"branches":sleeps}
        },
        "oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":[{"id":"post","pluginUri":"http://plugin.org.uk/swh-plugins/amp",
            "controls":{"gain":-6},"assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}
    });
    Ok(Bundle::from_parts(
        serde_json::to_vec(&m)?,
        BTreeMap::from([("a2".into(), a2), ("lstm".into(), lstm)]),
    )?)
}

fn select(session: &mut Session, scene: &str) -> Result<()> {
    let cursor = session.snapshot();
    session.select_scene(SceneCommand {
        session: cursor.session,
        expected_revision: cursor.revision,
        scene: scene.into(),
        release_ms: Some(15),
        native_bypass_preview: None,
    })?;
    Ok(())
}

type Stereo = [[f32; FRAMES]; 2];
fn render(rig: &SharedRig, i: usize, mask: [bool; 2]) -> std::result::Result<Stereo, String> {
    let input = |channel: usize| {
        std::array::from_fn::<_, FRAMES, _>(|j| {
            if mask[channel] {
                ((i * FRAMES + j) as f32 * (0.013 + channel as f32 * 0.021)).sin() * 0.20
            } else {
                0.0
            }
        })
    };
    let mut l = [0.0; FRAMES];
    let mut r = l;
    rig.render(&[&input(0), &input(1)], &mut [&mut l, &mut r])?;
    Ok([l, r])
}

pub(super) fn qualify(world: &World, root: &Path) -> Result<()> {
    let a2 = std::fs::read(root.join("a2-preset.t3kpreset"))?;
    let lstm = lstm(
        &a2,
        std::path::Path::new(&std::env::var("OXIDAL_TONE3000_TEST_LSTM")?),
    )?;
    let bundle = rig(a2, lstm)?;
    oxidal_engine::render::enable_render_thread();
    let store = BundleStore::new(root.join("sleep-qualification-rigs"));
    let revision = store.save(&bundle)?;
    let mut stream = super::partition::stream();
    stream.input.period_frames = FRAMES as u32;
    stream.output.period_frames = FRAMES as u32;
    let settings = StartRig {
        revision,
        prepared: vec![],
        stream,
        recall: None,
        midi: None,
    };
    let sleeping = SharedRig::new(ResidentSet::new(&store, world, &settings, BUFFER_BUDGET)?);
    let always = SharedRig::new(ResidentSet::new(&store, world, &settings, BUFFER_BUDGET)?);
    {
        let mut owner = always.lock("reference setup");
        let cursor = owner.snapshot();
        owner.active_mut().set_branch_sleep(BranchSleepCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            enabled: false,
        })?;
    }
    std::thread::scope(|scope| {
        let (task, requests) = std::sync::mpsc::sync_channel(1);
        let (results, blocks) = std::sync::mpsc::sync_channel(1);
        let sleeping = &sleeping;
        let always = &always;
        let _render = scope.spawn(move || {
            while let Ok((i, mask)) = requests.recv() {
                let result =
                    render(sleeping, i, mask).and_then(|a| render(always, i, mask).map(|b| (a, b)));
                if results.send(result).is_err() {
                    break;
                }
            }
        });
        let pair = |i, mask| -> Result<(Stereo, Stereo)> {
            task.send((i, mask))?;
            let samples = blocks.recv()??;
            sleeping.lock("sleep upkeep").active_mut().pump()?;
            always.lock("reference upkeep").active_mut().pump()?;
            Ok(samples)
        };
        compare_wake(sleeping, always, pair)
    })
}

fn compare_wake(
    sleeping: &SharedRig,
    always: &SharedRig,
    render: impl Fn(usize, [bool; 2]) -> Result<(Stereo, Stereo)>,
) -> Result<()> {
    let mut block = 0;
    for (index, entering) in ["lstm", "a2"].into_iter().enumerate() {
        let mask = [index == 0, index != 0];
        let start = block;
        while block - start < 4000 {
            let _ = render(block, mask)?;
            block += 1;
            if sleeping
                .lock("drain readback")
                .snapshot()
                .branch_sleep
                .unwrap()
                .branches
                .iter()
                .any(|b| b.branch == entering && b.phase == BranchSleepPhase::Asleep)
            {
                break;
            }
        }
        let before = sleeping
            .lock("wake readback")
            .snapshot()
            .branch_sleep
            .unwrap();
        assert_eq!(before.running_processors, 2, "{before:?}");
        assert!(
            before
                .branches
                .iter()
                .any(|b| b.branch == entering && b.phase == BranchSleepPhase::Asleep)
        );
        select(sleeping.lock("wake request").active_mut(), entering)?;
        assert_eq!(
            sleeping
                .lock("pending readback")
                .snapshot()
                .branch_sleep
                .unwrap()
                .requested_scene
                .as_deref(),
            Some(entering)
        );
        let mut residual = 0.0_f32;
        let compare = |a: [[f32; FRAMES]; 2], b: [[f32; FRAMES]; 2]| {
            a.iter()
                .flatten()
                .zip(b.iter().flatten())
                .map(|(a, b)| (a - b).abs())
                .fold(0.0_f32, f32::max)
        };
        let wake_at = block;
        loop {
            let (a, b) = render(block, [true, true])?;
            residual = residual.max(compare(a, b));
            block += 1;
            let state = sleeping
                .lock("wake readback")
                .snapshot()
                .branch_sleep
                .unwrap();
            if state.active_scene.as_deref() == Some(entering) {
                break;
            }
            assert!(block - wake_at <= 16, "{state:?}");
        }
        select(always.lock("reference change").active_mut(), entering)?;
        let mut peak = 0.0_f32;
        for _ in 0..64 {
            let (a, b) = render(block, [true, true])?;
            residual = residual.max(compare(a, b));
            peak = peak.max(a.iter().flatten().map(|v| v.abs()).fold(0.0_f32, f32::max));
            block += 1;
        }
        assert!(
            peak > 0.001 && residual < 0.005,
            "{entering}: peak={peak} residual={residual}"
        );
        println!(
            "Sleep native {entering}: {} drain frames, {} primer frames, max waveform difference {residual}, peak {peak}, running slots fall from 3 to 2",
            (wake_at - start) * FRAMES,
            (block - wake_at - 64) * FRAMES
        );
    }
    Ok(())
}
