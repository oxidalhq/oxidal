//! Real A2 and mono IR warm bypass with the pinned native adapter.
use oxidal_engine::{Session, protocol::*, save_revision};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{NATIVE_SETTINGS_EXTENSION, SCENES_INNER_BYPASS_EXTENSION, SCENES_NATIVE_EXTENSION},
};
use oxidal_tone3000::{Engine, InputMode, SceneEdit, SceneParameter, ScenePreparation};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error, path::Path};

#[path = "warm_scenes/rates.rs"]
mod rates;
#[path = "warm_scenes/rearm.rs"]
mod rearm;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const FRAMES: usize = 128;
const FADE: u32 = 1200;

fn edge(from: &str, port: u8, to: &str) -> Value {
    json!({"from":{"node":from,"port":port},"to":{"node":to,"port":port}})
}
fn whole(bytes: &[u8]) -> Result<Bundle> {
    let manifest = json!({
        "format":"oxidal.preset","formatVersion":1,"id":"808c5f5c-61c8-46df-9c8b-268505a30327","name":"Whole-warm-fixture",
        "tone3000":{"instances":[{"id":"tone","preset":"source","profile":oxidal_engine::native_profile_id()?}]},
        "resources":[{"id":"source","path":"source.t3kpreset","kind":"tone3000-preset","bytes":bytes.len(),
            "sha256":oxidal_presets::inspect(bytes)?.sha256}],
        "requiredExtensions":[NATIVE_SETTINGS_EXTENSION],
        "extensions":{NATIVE_SETTINGS_EXTENSION:{"instances":{"tone":{
            "input_mode":"left","parameters":{"osEnabled":0,"osFactor":0,"pitchEnabled":0,"pitchWindow":0,
                "inputCalibrationLevel":0.5,"calibrateInput":0,"targetLoudness":0.5}}}}},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"tone","kind":"tone3000","audioInputs":2,"audioOutputs":2,"instance":"tone","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"tone"),edge("in",1,"tone"),edge("tone",0,"out"),edge("tone",1,"out")]},
            "lv2":[],"recall":{"tails":"cut"}}
    });
    Ok(Bundle::from_parts(
        serde_json::to_vec(&manifest)?,
        BTreeMap::from([("source".into(), bytes.to_vec())]),
    )?)
}
fn select(session: &mut Session, scene: &str) -> Result<()> {
    let before = session.snapshot();
    session.select_scene(SceneCommand {
        session: before.session,
        expected_revision: before.revision,
        scene: scene.into(),
        release_ms: None,
    })?;
    Ok(())
}
fn render(session: &mut Session, offset: usize) -> Result<[[f32; FRAMES]; 2]> {
    let left =
        std::array::from_fn::<_, FRAMES, _>(|i| ((offset * FRAMES + i) as f32 * 0.071).sin() * 0.2);
    let right = left.map(|v| -v * 0.51);
    let (mut a, mut b) = ([0.0; FRAMES], [0.0; FRAMES]);
    session.pump()?;
    session.process(&[&left, &right], &mut [&mut a, &mut b])?;
    assert!(a.iter().chain(&b).all(|sample| sample.is_finite()));
    Ok([a, b])
}
fn direct(engine: &mut Engine, block: &str, value: f32, preparing: bool) -> Result<()> {
    let edit = [SceneEdit {
        block,
        parameter: SceneParameter::Enabled,
        value,
    }];
    Engine::scene_batch(
        [(engine, edit.as_slice())],
        preparing.then_some(ScenePreparation {
            base_fade_frames: FADE,
            byte_budget: BUFFER_BUDGET,
        }),
    )?;
    Ok(())
}

fn live_native_reference(source: &mut Engine, amp: &str, cab: &str) -> Result<()> {
    // Both A2 and IR receive input while their output is dry. Compare against
    // ordinary native disabled DSP, using the same 25 ms fade and inputs.
    let split = source.split_scene5(amp, cab)?;
    let (mut warm_amp, mut warm_cab) = split.prepare(48000.0, FRAMES)?;
    let (mut cold_amp, mut cold_cab) = split.prepare(48000.0, FRAMES)?;
    let (mut fault_amp, mut fault_cab) = split.prepare(48000.0, FRAMES)?;
    for (warm, cold, fault, block) in [
        (&mut warm_amp, &mut cold_amp, &mut fault_amp, amp),
        (&mut warm_cab, &mut cold_cab, &mut fault_cab, cab),
    ] {
        for p in [&mut *warm, &mut *cold] {
            p.set_block(block, "enabled", 0.0)?;
            p.set_block(block, "mix", 1.0)?;
            p.set_block(block, "outputGain", 0.5)?;
            p.prepare_stream()?;
        }
        direct(warm, block, 0., true)?;
        for frame in 0..36 {
            let mut left = std::array::from_fn::<_, FRAMES, _>(|i| {
                ((frame * FRAMES + i) as f32 * 0.033).sin() * 0.43
            });
            if frame == 35 {
                left[FRAMES - 1] = 0.8;
            }
            let mut right = left.map(|v| v * -0.5);
            let (mut ref_l, mut ref_r) = (left, right);
            warm.process(&mut left, &mut right)?;
            cold.process(&mut ref_l, &mut ref_r)?;
            assert_eq!(
                [left, right],
                [ref_l, ref_r],
                "dry audible endpoint differs"
            );
        }
        let old = warm
            .block_controls()?
            .into_iter()
            .find(|row| row.block_id == block && row.parameter == "enabled")
            .unwrap();
        assert_eq!(old.value, 0.0);
        let invalid = [
            SceneEdit {
                block,
                parameter: SceneParameter::Enabled,
                value: 1.0,
            },
            SceneEdit {
                block: "foreign",
                parameter: SceneParameter::Mix,
                value: 0.5,
            },
        ];
        assert!(Engine::scene_batch([(&mut *warm, invalid.as_slice())], None).is_err());
        assert!(!warm.scene_transitioning()?);
        direct(warm, block, 1., false)?;
        cold.set_block(block, "enabled", 1.0)?;
        assert!(warm.scene_transitioning()?);
        let (mut a, mut b, mut x, mut y) =
            ([0.0; FRAMES], [0.0; FRAMES], [0.0; FRAMES], [0.0; FRAMES]);
        warm.process(&mut a, &mut b)?;
        cold.process(&mut x, &mut y)?;
        let difference = a
            .iter()
            .chain(&b)
            .zip(x.iter().chain(&y))
            .map(|(actual, reference)| (actual - reference).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            difference > 1e-6,
            "no retained history for {block}: {difference}"
        );
        // Reverse from its partially audible blend and return to the dry endpoint.
        direct(warm, block, 0., false)?;
        assert!(warm.scene_transitioning()?);
        for _ in 0..10 {
            warm.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
        }
        assert!(!warm.scene_transitioning()?);
        println!("Warm native {block}: exact dry endpoint and retained wet history {difference}");
        // The armed block's hidden DSP glides for exactly 2400 frames even
        // while bypassed. A repeated assignment must leave its countdown alone.
        let mix = [SceneEdit {
            block,
            parameter: SceneParameter::Mix,
            value: 0.25,
        }];
        Engine::scene_batch([(&mut *warm, mix.as_slice())], None)?;
        for i in 0..19 {
            assert!(
                warm.scene_transitioning()?,
                "scalar glide ended before frame 2400"
            );
            if i == 9 {
                Engine::scene_batch([(&mut *warm, mix.as_slice())], None)?;
            }
            warm.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
        }
        assert!(!warm.scene_transitioning()?);
        Engine::scene_batch([(&mut *warm, mix.as_slice())], None)?;
        assert!(
            !warm.scene_transitioning()?,
            "settled no-op reported a new glide"
        );

        cold.set_block(block, "enabled", 0.0)?;
        for _ in 0..12 {
            cold.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
        }
        Engine::scene_batch([(&mut *cold, mix.as_slice())], None)?;
        assert!(
            !cold.scene_transitioning()?,
            "cold disabled scalar reported a glide"
        );
        assert!(
            cold.block_controls()?.iter().any(|row| {
                row.block_id == block && row.parameter == "mix" && row.value == 0.25
            })
        );

        // Invalidate real prepared DSP on this isolated adapter. Product
        // authoring refuses destructive edits around armed blocks.
        warm.reset_empty()?;
        assert!(
            warm.scene_transitioning()
                .unwrap_err()
                .to_string()
                .contains("armed native scene")
        );
        fault.set_block(block, "enabled", 0.0)?;
        fault.set_block(block, "mix", 0.0)?;
        fault.set_block(block, "outputGain", 1.0)?;
        fault.prepare_stream()?;
        direct(fault, block, 0.0, true)?;
        for _ in 0..19 {
            fault.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
        }
        // A finite dry input still overflows the bypassed block's internal
        // output stage. The adapter must reject even this silent wet failure.
        let huge = f32::MAX / 4.0;
        let mut left = [huge; FRAMES];
        let mut right = left;
        assert!(
            fault
                .process(&mut left, &mut right)
                .unwrap_err()
                .to_string()
                .contains("armed native scene block failed while rendering")
        );
        assert_eq!([left, right], [[huge; FRAMES]; 2]);
        assert!(fault.scene_transitioning().is_err());
        assert!(
            fault
                .process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])
                .is_err()
        );
        println!(
            "Warm native {block}: real scalar countdown, cold/no-op settling and latched DSP failure"
        );
    }
    Ok(())
}

fn pending_model_source_is_read_only(source: &mut Engine, amp: &str, cab: &str) -> Result<()> {
    let (mut stage, mut other) = source.split_scene5(amp, cab)?.prepare(48000.0, FRAMES)?;
    stage.prepare_stream()?;
    other.prepare_stream()?;
    direct(&mut other, cab, 0.0, true)?;
    let model = std::path::PathBuf::from(std::env::var("OXIDAL_TONE3000_TEST_MODEL")?);
    let tone = json!({"id":1781,"title":"Pending A2 fixture","format":"nam","gear":"pedal",
        "models":[{"id":1783,"name":"Pinned A2","model_url":"oxidal-model://fixture/pending.nam"}]});
    stage.prepare_model(amp, &model, &tone)?;
    let started = std::time::Instant::now();
    loop {
        match stage.model_preparation(0)?["phase"].as_str() {
            Some("ready") => break,
            Some("preparing") if started.elapsed() < std::time::Duration::from_secs(5) => {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            phase => return Err(format!("unexpected preparation phase {phase:?}").into()),
        }
    }
    assert_eq!(stage.model_preparation(1)?["phase"], "applying");
    // Finish the audio fade, but leave the explicit owner poll pending.
    for _ in 0..16 {
        stage.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
    }
    let before = stage.chain()?;
    let other_before = other.chain()?;
    let valid = [SceneEdit {
        block: cab,
        parameter: SceneParameter::Enabled,
        value: 1.0,
    }];
    let invalid = [SceneEdit {
        block: "missing-block",
        parameter: SceneParameter::Mix,
        value: 0.25,
    }];
    let error = Engine::scene_batch(
        [
            (&mut other, valid.as_slice()),
            (&mut stage, invalid.as_slice()),
        ],
        None,
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Finish native model preparation")
    );
    assert_eq!(stage.chain()?, before);
    assert_eq!(other.chain()?, other_before);
    assert_eq!(stage.model_preparation(0)?["phase"], "applied");
    assert_ne!(stage.chain()?["revision"], before["revision"]);
    println!(
        "Warm v5: pending model commit never changes targets, history or revision during scene preflight"
    );
    Ok(())
}

fn check_working_default(bundle: &Bundle, world: &World, root: &Path, block: &str) -> Result<()> {
    use oxidal_audio::{eq::EqEdit, structure::AuthoringAction};
    let root = root.join("warm-working");
    std::fs::create_dir_all(&root)?;
    let mut session = Session::new(bundle.clone(), world, 48000.0, FRAMES, BUFFER_BUDGET)?;
    let before = session.snapshot();
    let target = Target::Native {
        node: "tone".into(),
        parameter: format!("block:{block}:enabled"),
    };
    session.apply(ControlCommand {
        session: before.session,
        expected_revision: before.revision,
        target: target.clone(),
        value: 1.0,
    })?;
    let cursor = session.snapshot();
    session.authoring_command(
        AuthoringCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            node: "tone".into(),
            action: AuthoringAction::Eq {
                block_id: block.into(),
                edit: EqEdit::Enabled { value: true },
            },
        },
        &root,
    )?;
    let edited = session.snapshot();
    assert_eq!(edited.working.len(), 1);
    let mut reopened = Session::new_with_working(
        bundle.clone(),
        world,
        48000.0,
        FRAMES,
        BUFFER_BUDGET,
        Some((&root, &edited.working)),
    )?;
    reopened.restore(&edited.recall())?;
    let recovered = reopened.snapshot();
    assert_eq!(
        recovered.native_bypass_defaults,
        before.native_bypass_defaults
    );
    assert_eq!(
        recovered
            .controls
            .iter()
            .find(|c| c.target == target)
            .unwrap()
            .value,
        1.0
    );
    assert_eq!(recovered.working, edited.working);
    println!(
        "Warm v5: immutable disabled baseline survives working recovery while confirmed power is on"
    );
    Ok(())
}

fn pedal(source: &mut Engine, world: &World, root: &Path, block: &str) -> Result<()> {
    let path = std::env::var("OXIDAL_TONE3000_TEST_MODEL")?;
    let bytes = std::fs::read(path)?;
    let tone = json!({"id":1781,"title":"Local pedal-role fixture","format":"nam","gear":"pedal",
        "models":[{"id":1783,"name":"Pinned A2","model_url":"oxidal-model://fixture/pedal.nam"}]});
    let pins: Value =
        serde_json::from_str(include_str!("../../../../native/tone3000/sources.json"))?;
    let asset = oxidal_presets::ModelStore::new(root.join("audition-models")).stage(
        &oxidal_presets::ModelAsset {
            schema: 1,
            tone_id: 1781,
            model_id: 1783,
            title: "Local pedal-role fixture".into(),
            name: "Pinned A2".into(),
            format: "nam".into(),
            sha256: pins["qualification_model"]["sha256"]
                .as_str()
                .unwrap()
                .into(),
            tone,
        },
        &bytes,
    )?;
    oxidal_tone3000::model_preparation::restore(
        source,
        root,
        &[oxidal_audio::lifecycle::ModelAssignment {
            target: block.into(),
            asset,
            insertion: None,
        }],
        FRAMES,
    )?;
    source.prepare_stream()?;
    let layout = source.chain()?;
    assert!(
        layout["chain"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["blockId"] == block && row["tone"]["gear"] == "pedal")
    );
    let bytes = source.save_preset("Warm pedal-role fixture")?;
    let base = whole(&bytes)?;
    let mut manifest = serde_json::to_value(base.manifest())?;
    let key = SCENES_INNER_BYPASS_EXTENSION;
    let scene = |id, value| {
        json!({"id":id,"name":id,"gains":[],
        "native_bypass":[{"node":"tone","block":block,"value":value}]})
    };
    manifest["extensions"][key] =
        json!({"fade_ms":25,"initial_scene":"dry","scenes":[scene("dry",true),scene("wet",false)]});
    manifest["requiredExtensions"]
        .as_array_mut()
        .unwrap()
        .push(json!(key));
    let bundle = Bundle::from_parts(
        serde_json::to_vec(&manifest)?,
        BTreeMap::from([("source".into(), bytes)]),
    )?;
    let mut session = Session::new(bundle, world, 48000.0, FRAMES, BUFFER_BUDGET)?;
    select(&mut session, "wet")?;
    for i in 0..24 {
        let _ = render(&mut session, i)?;
    }
    assert_eq!(session.snapshot().scene.as_deref(), Some("wet"));
    println!(
        "Warm v5: NAM carrying pedal metadata prepares and switches as an independent inner block"
    );
    Ok(())
}

pub(super) fn qualify(world: &World, root: &Path) -> Result<()> {
    let bytes = std::fs::read(root.join("split-source.t3kpreset"))?;
    let mut source = Engine::new(48000.0, FRAMES)?;
    source.load_preset(&bytes)?;
    source.set_input_mode(InputMode::Left)?;
    source.set_normalized("osEnabled", 0.0)?;
    source.prepare_stream()?;
    let saved = source.scene_bypass_candidates()?;
    let amp = &saved[0].block;
    let cab = &saved[1].block;
    live_native_reference(&mut source, amp, cab)?;
    pending_model_source_is_read_only(&mut source, amp, cab)?;
    rates::qualify(world, &bytes, amp, cab, root)?;
    source.set_block(amp, "enabled", 0.0)?;
    source.set_block(cab, "enabled", 0.0)?;
    let disabled = source.save_preset("Saved-disabled warm fixture")?;
    assert!(source.split_amp_cab(amp, cab, true, false).is_err());
    for (base, amp_node, cab_node) in [
        (whole(&disabled)?, "tone", "tone"),
        (
            super::partition::bundle(&disabled, amp, cab, "left", 0.0)?,
            "amp",
            "cab",
        ),
    ] {
        let mut manifest = serde_json::to_value(base.manifest())?;
        let key = SCENES_INNER_BYPASS_EXTENSION;
        let scene = |id, amp_off, cab_off, mix| {
            json!({"id":id,"name":id,"gains":[],
            "native_bypass":[{"node":amp_node,"block":amp,"value":amp_off},{"node":cab_node,"block":cab,"value":cab_off}],
            "native_controls":[{"node":cab_node,"parameter":format!("block:{cab}:mix"),"value":mix}]})
        };
        manifest["extensions"][key] = json!({"fade_ms":25,"initial_scene":"dry","scenes":[
            scene("dry",true,true,0.8),scene("wet",false,false,0.8),scene("amp",false,true,0.8),
            scene("cab",true,false,0.9)
        ]});
        manifest["requiredExtensions"]
            .as_array_mut()
            .unwrap()
            .push(json!(key));
        let encode = |manifest: Value| {
            Bundle::from_parts(
                serde_json::to_vec(&manifest).unwrap(),
                BTreeMap::from([("source".into(), disabled.clone())]),
            )
        };
        let mut old = manifest.clone();
        let def = old["extensions"]
            .as_object_mut()
            .unwrap()
            .remove(key)
            .unwrap();
        old["extensions"][SCENES_NATIVE_EXTENSION] = def;
        for row in old["requiredExtensions"].as_array_mut().unwrap() {
            if row == key {
                *row = json!(SCENES_NATIVE_EXTENSION);
            }
        }
        assert!(encode(old).is_err());
        let mut foreign = manifest.clone();
        for row in foreign["extensions"][key]["scenes"].as_array_mut().unwrap() {
            row["native_bypass"][0]["block"] = json!("unloaded-foreign");
        }
        assert!(Session::new(encode(foreign)?, world, 48000.0, FRAMES, BUFFER_BUDGET).is_err());
        let bundle = encode(manifest)?;
        let mut session = Session::new(bundle.clone(), world, 48000.0, FRAMES, BUFFER_BUDGET)?;
        let before = session.snapshot();
        assert_eq!(before.scene.as_deref(), Some("dry"));
        assert!(!before.modified);
        assert!(!before.scene_transitioning);
        select(&mut session, "dry")?;
        let before = session.snapshot();
        assert!(
            !before.scene_transitioning,
            "same v5 scene reported a new scalar glide"
        );
        assert_eq!(before.native_bypass_armed.as_ref().unwrap().len(), 2);
        assert!(
            before
                .native_bypass_defaults
                .as_ref()
                .unwrap()
                .iter()
                .all(|row| row.value)
        );
        select(&mut session, "amp")?;
        let after = session.snapshot();
        assert_eq!(after.revision, before.revision + 1);
        assert!(after.scene_transitioning);
        let _ = render(&mut session, 0)?;
        select(&mut session, "cab")?;
        assert!(session.snapshot().scene_transitioning);
        for i in 1..=32 {
            let _ = render(&mut session, i)?;
        }
        let active = session.snapshot();
        assert_eq!(active.scene.as_deref(), Some("cab"));
        assert!(!active.scene_transitioning);
        assert_eq!(before.native_bypass_defaults, active.native_bypass_defaults);
        let command = SceneCommand {
            session: active.session.clone(),
            expected_revision: before.revision,
            scene: "wet".into(),
            release_ms: None,
        };
        assert!(session.select_scene(command).is_err());
        assert_eq!(session.snapshot().revision, active.revision);
        if amp_node == "tone" {
            check_working_default(&bundle, world, root, amp)?;
        }
        super::worker::qualify_warm_scenes(&bundle, &root.join(format!("warm-null-{amp_node}")))?;
        rearm::qualify(&bundle, world, root, amp_node, amp, cab)?;
        let store = BundleStore::new(root.join(format!("scene5-{amp_node}")));
        store.save(&bundle)?;
        let saved = save_revision(
            &store,
            world,
            SaveRequest {
                settings: StartRig {
                    revision: bundle.revision().into(),
                    prepared: vec![],
                    stream: super::partition::stream(),
                    recall: None,
                    midi: None,
                },
                recall: active.recall(),
                name: "Saved warm targets".into(),
            },
        )?;
        let saved = store.read(&saved)?;
        let reopened = Session::new(saved, world, 48000.0, FRAMES, BUFFER_BUDGET)?.snapshot();
        assert_eq!(reopened.scene.as_deref(), Some("cab"));
        assert!(!reopened.modified);
        assert_eq!(reopened.native_bypass_armed, active.native_bypass_armed);
        assert_eq!(
            store.read(bundle.revision())?.resource("source"),
            Some(disabled.as_slice())
        );
        println!(
            "Warm native {amp_node}/{cab_node}: saved-disabled source, independent targets, retarget, v5-only admission, original bytes and Save/reopen"
        );
    }
    pedal(&mut source, world, root, amp)?;
    Ok(())
}
