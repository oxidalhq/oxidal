//! Saved guarded amp/cab derivation, with actual LV2 between stages and offline
//! independent recall. Extends native:check; no separate runner or factory copies.
use oxidal_engine::{Session, protocol::*, save_revision};
use oxidal_lv2::{Plugin, World};
use oxidal_presets::{Bundle, BundleStore, inspect};
use oxidal_tone3000::{Engine, InputMode};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error, path::Path};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
const AMP: &str = "http://plugin.org.uk/swh-plugins/amp";
fn edge(a: &str, ap: usize, b: &str, bp: usize) -> Value {
    json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}})
}
fn bundle(bytes: &[u8], amp: &str, cab: &str, input: &str, gain: f64) -> Result<Bundle> {
    let mut nodes = vec![
        json!({"id":"in","kind":"input","audioInputs":0,"audioOutputs":2}),
        json!({"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}),
    ];
    let mut instances = vec![];
    for role in ["amp", "cab"] {
        nodes.push(json!({"id":role,"kind":"tone3000","audioInputs":2,"audioOutputs":2,"instance":role,"bypassed":false}));
        instances.push(json!({"id":role,"preset":"source","profile":oxidal_engine::native_profile_id()?,"processingRole":role,
            "partition":{"version":1,"pair":"sourcePair","amp":amp,"cab":cab,"input":input,"controls":{}}}));
    }
    let mut lv2 = vec![];
    let mut edges = vec![];
    for (port, fx) in [(0, "fx_l"), (1, "fx_r")] {
        nodes.push(json!({"id":fx,"kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":fx,"bypassed":false}));
        lv2.push(json!({"id":fx,"pluginUri":AMP,"controls":{"gain":gain},"assets":[],"requiredFeatures":[]}));
        edges.extend([
            edge("in", port, "amp", port),
            edge("amp", port, fx, 0),
            edge(fx, 0, "cab", port),
            edge("cab", port, "out", port),
        ]);
    }
    let value = json!({"format":"oxidal.preset","formatVersion":1,"id":"225d0975-6b0c-43ab-89b0-c5edfdad9460","name":"Derived partition fixture",
        "tone3000":{"instances":instances},"oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":lv2,"recall":{"tails":"cut"}},
        "resources":[{"id":"source","path":"source.t3kpreset","kind":"tone3000-preset","bytes":bytes.len(),"sha256":inspect(bytes)?.sha256}],"extensions":{},"requiredExtensions":[]});
    Ok(Bundle::from_parts(
        serde_json::to_vec(&value)?,
        BTreeMap::from([("source".into(), bytes.to_vec())]),
    )?)
}
fn stream() -> oxidal_audio::StreamConfig {
    let input = oxidal_audio::AudioProbe {
        endpoint: "hw:CARD=Qualification,DEV=0".into(),
        direction: oxidal_audio::Direction::Capture,
        sample_rate: 48000,
        channels: 2,
        format: oxidal_audio::SampleFormat::S16,
        period_frames: 128,
        periods: 3,
    };
    let mut output = input.clone();
    output.direction = oxidal_audio::Direction::Playback;
    oxidal_audio::StreamConfig {
        levels: Default::default(),
        hear_yourself: true,
        input,
        output,
        input_map: [0, 1],
        output_map: [0, 1],
    }
}
fn change(s: &mut Session, node: &str, parameter: &str, value: f64) -> Result<()> {
    let state = s.snapshot();
    s.apply(ControlCommand {
        session: state.session,
        expected_revision: state.revision,
        target: Target::Native {
            node: node.into(),
            parameter: parameter.into(),
        },
        value,
    })?;
    Ok(())
}
pub fn qualify(world: &World, root: &Path) -> Result<()> {
    let bytes = std::fs::read(root.join("split-source.t3kpreset"))?;
    let mut whole = Engine::new(48000.0, 128)?;
    whole.load_preset(&bytes)?;
    whole.wait_ready()?;
    let chain = whole.chain()?;
    let tones: Vec<_> = chain["chain"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["kind"] == "tone")
        .collect();
    let amp = tones[0]["blockId"].as_str().unwrap();
    let cab = tones[1]["blockId"].as_str().unwrap();
    for input in ["left", "right"] {
        let candidate = bundle(&bytes, amp, cab, input, 0.0)?;
        for rate in [44100.0, 96000.0] {
            assert!(Session::new(candidate.clone(), world, rate, 128, BUFFER_BUDGET).is_err());
        }
        let mut s = Session::new(candidate.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
        whole.load_preset(&bytes)?;
        whole.set_input_mode(if input == "left" {
            InputMode::Left
        } else {
            InputMode::Right
        })?;
        whole.prepare_stream()?;
        let mut error = 0.0_f32;
        let mut peak = 0.0_f32;
        for block in 0..600 {
            s.pump()?;
            whole.pump()?;
            let left: Vec<_> = (0..128)
                .map(|i| {
                    if block < 400 {
                        0.0
                    } else {
                        0.02 + 0.04 * ((block * 128 + i) as f32 * 0.013).sin()
                    }
                })
                .collect();
            let right: Vec<_> = left.iter().map(|v| -v * 0.7).collect();
            let (mut a, mut b) = (left.clone(), right.clone());
            whole.process(&mut a, &mut b)?;
            let (mut x, mut y) = ([0.0; 128], [0.0; 128]);
            s.process(&[&left, &right], &mut [&mut x, &mut y])?;
            if block >= 400 {
                for (actual, expected) in x.iter().chain(&y).zip(a.iter().chain(&b)) {
                    error = error.max((actual - expected).abs());
                    peak = peak.max(actual.abs());
                }
            }
        }
        assert!(
            peak > 1e-4 && error < 1e-5,
            "Partition {input} persisted parity {error}, peak {peak}"
        );
        println!("persisted partition at 48 kHz, input={input}, whole reference max_error={error}");
    }
    let candidate = bundle(&bytes, amp, cab, "left", -6.0206)?;
    let mut graph = Session::new(candidate.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    // Extracted stages retain their exact model identity and cannot insert blocks.
    let before_models = graph.snapshot();
    assert!(
        graph
            .model_command(
                oxidal_engine::protocol::ModelCommand {
                    session: before_models.session.clone(),
                    expected_revision: before_models.revision,
                    node: "amp".into(),
                    operation: oxidal_audio::lifecycle::ModelOperation::Prepare {
                        assignment: oxidal_audio::lifecycle::ModelAssignment {
                            target: "missing-stage-target".into(),
                            asset: "a".repeat(64),
                            insertion: None,
                        },
                    },
                },
                root
            )
            .is_err()
    );
    assert_eq!(graph.snapshot().revision, before_models.revision);
    assert!(graph.healthy());
    whole.load_preset(&bytes)?;
    whole.set_input_mode(InputMode::Left)?;
    whole.wait_ready()?;
    let (mut reference_amp, mut reference_cab) = whole
        .split_amp_cab(amp, cab, true, false)?
        .prepare(48000.0, 128)?;
    reference_amp.prepare_stream()?;
    reference_cab.prepare_stream()?;
    let mut fx = Plugin::new_ports(world, AMP, 48000.0, 128)?;
    fx.set(0, -6.0206)?;
    change(&mut graph, "amp", "inputLevel", 0.54)?;
    change(&mut graph, "cab", "outputLevel", 0.46)?;
    reference_amp.set_live_control("inputLevel", 0.54)?;
    reference_cab.set_live_control("outputLevel", 0.46)?;
    assert!(change(&mut graph, "amp", "outputLevel", 0.7).is_err());
    assert!(change(&mut graph, "cab", "inputLevel", 0.7).is_err());
    assert!(graph.healthy());
    for (node, reference) in [("amp", &mut reference_amp), ("cab", &mut reference_cab)] {
        let state = graph.snapshot();
        let block = &state.eq.iter().find(|e| e.node == node).unwrap().blocks[0];
        let block_id = block.block_id.clone();
        let mut band = block.eq.bands[1].clone();
        band.gain_db = if node == "amp" { 2.3 } else { -1.7 };
        for edit in [
            oxidal_audio::eq::EqEdit::Enabled { value: true },
            oxidal_audio::eq::EqEdit::Band { index: 1, band },
        ] {
            let state = graph.snapshot();
            graph.apply_eq(EqCommand {
                session: state.session,
                expected_revision: state.revision,
                node: node.into(),
                block_id: block_id.clone(),
                edit: edit.clone(),
            })?;
            reference.set_eq(&block_id, &edit)?;
        }
    }
    let store = BundleStore::new(root.join("partition-rigs"));
    let revision = store.save(&candidate)?;
    let expected = graph.snapshot();
    let saved = save_revision(
        &store,
        world,
        SaveRequest {
            name: "Saved partition with effects".into(),
            settings: StartRig {
                midi: None,
                prepared: Vec::new(),
                revision,
                stream: stream(),
                recall: None,
            },
            recall: expected.recall(),
        },
    )?;
    let restored = store.read(&saved)?;
    assert_eq!(restored.resource("source").unwrap(), bytes);
    assert_eq!(restored.manifest().resources.len(), 1);
    let mut reopened = Session::new(restored.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    assert_eq!(reopened.snapshot().eq, expected.eq);
    // A second edited recovery starts from a v2 recipe and must not reuse tokens.
    let baseline = reopened.snapshot().recall();
    let mut changed = baseline.clone();
    changed.eq.as_mut().unwrap()[0].blocks[0].eq.pre =
        !changed.eq.as_ref().unwrap()[0].blocks[0].eq.pre;
    reopened.restore(&changed)?;
    assert_eq!(reopened.snapshot().eq, *changed.eq.as_ref().unwrap());
    reopened.restore(&baseline)?;
    assert_eq!(reopened.snapshot().eq, expected.eq);
    let mut legacy = reopened.snapshot().recall();
    legacy.eq = Some(vec![]);
    reopened.restore(&legacy)?;
    assert_eq!(reopened.snapshot().eq, expected.eq);
    let mut partial = baseline;
    partial.eq.as_mut().unwrap().pop();
    assert!(reopened.restore(&partial).is_err());
    for instance in &restored.manifest().tone3000.instances {
        let recipe = instance.partition.as_ref().unwrap();
        assert_eq!(recipe.version, 2);
        assert_eq!(recipe.eq.as_ref().unwrap().len(), 1);
    }
    let renamed = save_revision(
        &store,
        world,
        SaveRequest {
            name: "Renamed partition".into(),
            settings: StartRig {
                midi: None,
                prepared: Vec::new(),
                revision: saved.clone(),
                stream: stream(),
                recall: None,
            },
            recall: reopened.snapshot().recall(),
        },
    )?;
    let renamed = store.read(&renamed)?;
    assert_eq!(renamed.manifest().tone3000, restored.manifest().tone3000);
    assert_eq!(renamed.resource("source"), restored.resource("source"));
    for c in &expected.controls {
        assert!(
            reopened
                .snapshot()
                .controls
                .iter()
                .any(|v| v.target == c.target && (v.value - c.value).abs() < 1e-5)
        );
    }
    let mut error = 0.0_f32;
    let mut peer_error = 0.0_f32;
    let mut peak = 0.0_f32;
    for block in 0..600 {
        graph.pump()?;
        reopened.pump()?;
        reference_amp.pump()?;
        let input: Vec<_> = (0..128)
            .map(|i| {
                if block < 400 {
                    0.0
                } else {
                    0.02 + 0.04 * ((block * 128 + i) as f32 * 0.017).sin()
                }
            })
            .collect();
        let (mut a, mut b) = (input.clone(), input.clone());
        reference_amp.process(&mut a, &mut b)?;
        fx.process_mono(&mut a)?;
        b.copy_from_slice(&a);
        reference_cab.process(&mut a, &mut b)?;
        let (mut x, mut y, mut rx, mut ry) = ([0.0; 128], [0.0; 128], [0.0; 128], [0.0; 128]);
        graph.process(&[&input, &input], &mut [&mut x, &mut y])?;
        reopened.process(&[&input, &input], &mut [&mut rx, &mut ry])?;
        if block >= 400 {
            for ((expected, actual), peer) in a
                .iter()
                .chain(&b)
                .zip(x.iter().chain(&y))
                .zip(rx.iter().chain(&ry))
            {
                error = error.max((actual - expected).abs());
                peer_error = peer_error.max((peer - actual).abs());
                peak = peak.max(actual.abs());
            }
        }
    }
    assert!(
        peak > 1e-4 && error < 1e-5 && peer_error < 1e-5,
        "partition Save/recall audio {error}/{peer_error}"
    );
    for edit in [json!({"unknown":0.5}), json!({"inputLevel":0.5})] {
        let mut m = restored.manifest().clone();
        m.tone3000.instances[0].partition.as_mut().unwrap().controls =
            serde_json::from_value(edit)?;
        let invalid = Bundle::from_parts(
            m.encode()?,
            BTreeMap::from([("source".into(), bytes.clone())]),
        )?;
        assert!(Session::new(invalid, world, 48000.0, 128, BUFFER_BUDGET).is_err());
    }
    println!(
        "partition LV2 placement, allocated live controls, immutable source, isolated Save and fresh offline rendered recall pass: max_error={error}, reopened_error={peer_error}"
    );
    // A same-size forged catalog must not evade identity or exact-toggle checks.
    for toggle in [false, true] {
        let mut m = restored.manifest().clone();
        let controls = &mut m.tone3000.instances[0].partition.as_mut().unwrap().controls;
        if toggle {
            *controls.get_mut("gateEnabled").unwrap() = 0.999999999;
        } else {
            let value = controls.remove("inputLevel").unwrap();
            controls.insert("unknown".into(), value);
        }
        let invalid = Bundle::from_parts(
            m.encode()?,
            BTreeMap::from([("source".into(), bytes.clone())]),
        )?;
        assert!(Session::new(invalid, world, 48000.0, 128, BUFFER_BUDGET).is_err());
    }
    qualify_models(world, &candidate, root)?;
    std::fs::remove_file(root.join("split-source.t3kpreset"))?;
    super::worker::qualify_partition(&restored, root)?;
    // Reuse the verified authored fixture in the maintained browser gate only
    // after proving worker recall without the external source file.
    std::fs::write(root.join("partition-browser.t3kpreset"), bytes)?;
    Ok(())
}

fn model_edit(
    session: &mut Session,
    root: &Path,
    node: &str,
    target: &str,
    asset: &str,
    fail: bool,
) -> Result<()> {
    use oxidal_audio::lifecycle::{ModelAssignment, ModelOperation, ModelPhase};
    let before = session.snapshot();
    session.model_command(
        ModelCommand {
            session: before.session,
            expected_revision: before.revision,
            node: node.into(),
            operation: ModelOperation::Prepare {
                assignment: ModelAssignment {
                    target: target.into(),
                    asset: asset.into(),
                    insertion: None,
                },
            },
        },
        root,
    )?;
    let started = std::time::Instant::now();
    let zero = [0.0; 128];
    while session.model_pending() {
        session.pump()?;
        let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
        session.process(&[&zero, &zero], &mut [&mut l, &mut r])?;
        if started.elapsed() > std::time::Duration::from_secs(20) {
            return Err("Stage model timed out".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert!(session.healthy());
    assert_eq!(
        session.snapshot().model_change.unwrap().progress.phase,
        if fail {
            ModelPhase::Failed
        } else {
            ModelPhase::Applied
        }
    );
    Ok(())
}
fn qualify_models(world: &World, candidate: &Bundle, root: &Path) -> Result<()> {
    use oxidal_presets::ModelStore;
    let data = root.join("stage-model-case");
    std::fs::create_dir_all(&data)?;
    let fixtures = ModelStore::new(root.join("audition-models"));
    let cache = ModelStore::new(data.join("audition-models"));
    let mut assets = BTreeMap::new();
    for entry in std::fs::read_dir(root.join("audition-models"))? {
        let entry = entry?;
        if let Ok((asset, path)) = fixtures.read(&entry.file_name().to_string_lossy()) {
            assets.insert(
                asset.format.clone(),
                cache.stage(&asset, &std::fs::read(path)?)?,
            );
        }
    }
    let nam = assets.get("nam").ok_or("Stage NAM fixture missing")?;
    let ir = assets.get("ir").ok_or("Stage IR fixture missing")?;
    let mut live = Session::new(candidate.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    let original = live.snapshot();
    let amp = original.eq.iter().find(|e| e.node == "amp").unwrap().blocks[0]
        .block_id
        .clone();
    let cab = original.eq.iter().find(|e| e.node == "cab").unwrap().blocks[0]
        .block_id
        .clone();
    assert!(original.slots.iter().all(|s| s.slots.is_empty()));
    model_edit(&mut live, &data, "amp", &amp, ir, true)?;
    assert!(live.snapshot().models.is_empty());
    assert_eq!(live.snapshot().eq, original.eq);
    model_edit(&mut live, &data, "amp", &amp, nam, false)?;
    model_edit(&mut live, &data, "cab", &cab, ir, false)?;
    change(&mut live, "amp", "inputLevel", 0.53)?;
    change(&mut live, "cab", "outputLevel", 0.47)?;
    let expected = live.snapshot();
    assert_eq!(expected.models.len(), 2);
    let mut forged = expected.recall();
    forged.models[0].assignments[0].insertion =
        Some(oxidal_audio::lifecycle::SlotPosition { lane: 0, index: 0 });
    let mut isolated = Session::new(candidate.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    assert!(isolated.restore_with_models(&forged, &data).is_err());
    assert!(!isolated.snapshot().modified);
    let mut reference = Session::new(candidate.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    reference.restore_with_models(&expected.recall(), &data)?;
    let store = BundleStore::new(data.join("bundles"));
    let source = store.save(candidate)?;
    let saved = oxidal_engine::save_revision_with_models(
        &store,
        world,
        SaveRequest {
            name: "Model-edited stages".into(),
            settings: StartRig {
                midi: None,
                revision: source,
                stream: stream(),
                recall: None,
                prepared: vec![],
            },
            recall: expected.recall(),
        },
        &data,
    )?;
    let saved = store.read(&saved)?;
    for native in &saved.manifest().tone3000.instances {
        let origin = native
            .origin
            .as_ref()
            .ok_or("Partition provenance missing")?;
        assert_eq!(
            saved.resource(&origin.resource),
            candidate.resource("source")
        );
        assert_ne!(native.preset, "source");
    }
    std::fs::remove_dir_all(data.join("audition-models"))?;
    let mut fresh = Session::new(saved, world, 48000.0, 128, BUFFER_BUDGET)?;
    assert!(fresh.snapshot().models.is_empty());
    assert!(!fresh.snapshot().modified);
    assert_eq!(fresh.snapshot().eq, expected.eq);
    for control in &expected.controls {
        assert!(
            fresh
                .snapshot()
                .controls
                .iter()
                .any(|actual| actual.target == control.target
                    && (actual.value - control.value).abs() < 1e-5)
        );
    }
    let mut error = 0.0f32;
    for block in 0..80 {
        let input: Vec<_> = (0..128)
            .map(|i| ((block * 128 + i) as f32 * 0.03).sin() * 0.01)
            .collect();
        let (mut a, mut b, mut x, mut y) = ([0.0; 128], [0.0; 128], [0.0; 128], [0.0; 128]);
        reference.process(&[&input, &input], &mut [&mut a, &mut b])?;
        fresh.process(&[&input, &input], &mut [&mut x, &mut y])?;
        for (left, right) in a.iter().chain(&b).zip(x.iter().chain(&y)) {
            error = error.max((left - right).abs());
        }
    }
    assert!(error < 1e-5, "Stage model Save/recall PCM {error}");
    println!(
        "extracted amp/cab replacement, role rejection, forged insertion rejection, source provenance and cache-free Save/recall pass; PCM max_error={error}"
    );
    Ok(())
}
