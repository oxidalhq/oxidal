//! Off-device reference cases for the whole-native rate and topology matrix.
use super::*;
use oxidal_audio::structure::{ChainLane, StructureEdit};
use std::time::{Duration, Instant};

fn load(bytes: &[u8], rate: f64, factor: u32) -> Result<Engine> {
    let mut engine = Engine::new(rate, FRAMES)?;
    engine.load_preset(bytes)?;
    engine.wait_ready()?;
    engine.set_input_mode(InputMode::Left)?;
    for (id, value) in [
        ("gateEnabled", 0.0),
        ("toneEqEnabled", 0.0),
        ("inputLevel", 0.5),
        ("outputLevel", 0.5),
        (
            "osFactor",
            factor.trailing_zeros().saturating_sub(1) as f32 * 0.5,
        ),
        ("osEnabled", f32::from(u8::from(factor != 1))),
    ] {
        engine.set_normalized(id, value)?;
    }
    engine.prepare_stream()?;
    Ok(engine)
}

fn prepare(engine: &mut Engine, blocks: &[&str], byte_budget: usize) -> Result<usize> {
    let rows: Vec<_> = blocks
        .iter()
        .map(|&block| SceneEdit {
            block,
            parameter: SceneParameter::Enabled,
            value: 0.0,
        })
        .collect();
    Ok(Engine::scene_batch(
        [(engine, rows.as_slice())],
        Some(ScenePreparation {
            base_fade_frames: FADE,
            byte_budget,
        }),
    )?)
}

fn delta_ir(path: &Path, stereo: bool) -> Result<()> {
    let channels = if stereo { 2_u16 } else { 1 };
    let bytes = 16 * 2 * u32::from(channels);
    let mut wav = Vec::new();
    wav.extend(b"RIFF");
    wav.extend((36 + bytes).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16_u32.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(channels.to_le_bytes());
    wav.extend(48000_u32.to_le_bytes());
    wav.extend((96000 * u32::from(channels)).to_le_bytes());
    wav.extend((2 * channels).to_le_bytes());
    wav.extend(16_u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(bytes.to_le_bytes());
    for i in 0..16 {
        for ch in 0..channels {
            let sample = match (i, ch) {
                (0, 0) => 32767_i16,
                (0, 1) => -32767_i16,
                _ => 0_i16,
            };
            wav.extend(sample.to_le_bytes());
        }
    }
    std::fs::write(path, wav)?;
    Ok(())
}

fn replace(engine: &mut Engine, target: &str, path: &Path, format: &str, gear: &str) -> Result<()> {
    let tone = json!({"id":9413,"title":"Controlled local reference","format":format,"gear":gear,
        "models":[{"id":9414,"name":"Reference","model_url":"oxidal-model://reference"}]});
    engine.prepare_model(target, path, &tone)?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match engine.model_preparation(0)?["phase"].as_str() {
            Some("ready") => {
                engine.model_preparation(1)?;
            }
            Some("applying") => {
                engine.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
            }
            Some("applied") => break,
            Some("preparing") => {
                engine.pump()?;
                std::thread::sleep(Duration::from_millis(2));
            }
            other => {
                return Err(
                    format!("Unexpected local reference preparation phase {other:?}").into(),
                );
            }
        }
        assert!(
            Instant::now() < deadline,
            "Local reference preparation timed out"
        );
    }
    engine.prepare_stream()?;
    Ok(())
}

fn input(block: usize) -> [f32; FRAMES] {
    std::array::from_fn(|i| {
        let n = (block * FRAMES + i) as f32;
        (n * 0.071).sin() * 0.13 + (n * 0.779).sin() * 0.18 + (n * 1.876).cos() * 0.11
    })
}

fn render_engine(engine: &mut Engine, block: usize) -> Result<[[f32; FRAMES]; 2]> {
    let mut left = input(block);
    let mut right = left;
    engine.process(&mut left, &mut right)?;
    Ok([left, right])
}

fn peak_error(actual: &[[f32; FRAMES]; 2], expected: &[[f32; FRAMES]; 2], gain: f32) -> f32 {
    actual
        .iter()
        .flatten()
        .zip(expected.iter().flatten())
        .map(|(a, b)| (a - b * gain).abs())
        .fold(0.0, f32::max)
}

fn rates(world: &World, source: &[u8], amp: &str, cab: &str, root: &Path) -> Result<()> {
    let path = root.join("warm-mono-delta.wav");
    delta_ir(&path, false)?;
    let mut seed = load(source, 48000.0, 1)?;
    replace(&mut seed, cab, &path, "ir", "cab")?;
    seed.set_block(amp, "enabled", 0.0)?;
    seed.set_block(cab, "enabled", 0.0)?;
    seed.set_block(cab, "mix", 1.0)?;
    seed.set_block(cab, "inputGain", 0.5)?;
    seed.set_block(cab, "outputGain", 0.875)?; // compensate native cab pad
    let bytes = seed.save_preset("Warm mono delta reference")?;
    for rate in [48000.0, 44100.0, 96000.0] {
        for factor in [1_u32, 2, 4, 8] {
            let mut warm = load(&bytes, rate, factor)?;
            let mut unity_ir = load(&bytes, rate, factor)?;
            let mut wire = load(&bytes, rate, factor)?;
            unity_ir.set_block(cab, "enabled", 1.0)?;
            unity_ir.prepare_stream()?;
            assert_eq!(warm.latency_samples()?, unity_ir.latency_samples()?);
            let before = warm.chain()?;
            let error = prepare(&mut warm, &[cab], 1).unwrap_err();
            assert!(error.to_string().contains("owner buffer budget"));
            assert_eq!(warm.chain()?, before);
            let used = prepare(&mut warm, &[cab], BUFFER_BUDGET)?;
            assert!((used > 2000) == (factor > 1));
            // Prime the legacy reference's 50 ms output-gain glide on
            // silence so its startup does not excite a different DC state.
            let settle_blocks = ((rate * 0.060) as usize).div_ceil(FRAMES);
            for _ in 0..settle_blocks {
                for engine in [&mut warm, &mut unity_ir, &mut wire] {
                    engine.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
                }
            }
            let mut phase_error = 0.0_f32;
            let mut wire_error = 0.0_f32;
            let mut peak = 0.0_f32;
            for i in 0..45 {
                let a = render_engine(&mut warm, i)?;
                let b = render_engine(&mut unity_ir, i)?;
                let c = render_engine(&mut wire, i)?;
                if i > 20 {
                    phase_error = phase_error.max(peak_error(&a, &b, 32768.0 / 32767.0));
                    wire_error = wire_error.max(peak_error(&a, &c, 1.0));
                    peak = peak.max(b.iter().flatten().map(|s| s.abs()).fold(0.0_f32, f32::max));
                }
            }
            assert!(peak > 0.02);
            assert!(
                phase_error < 5e-5,
                "{rate}/{factor}: identity residual {phase_error}"
            );
            if factor == 1 {
                assert_eq!(wire_error, 0.0);
            } else {
                assert!(
                    wire_error > 0.002,
                    "{rate}/{factor}: dry island collapsed to wire"
                );
            }

            // Real IR input continues to feed both filter histories at the
            // dry endpoint. Reverse a live transition before reaching wet.
            direct(&mut warm, cab, 1.0, false)?;
            for i in 45..48 {
                assert!(warm.scene_transitioning()?);
                let _ = render_engine(&mut warm, i)?;
            }
            direct(&mut warm, cab, 0.0, false)?;
            let mut frames = 0;
            while warm.scene_transitioning()? {
                let _ = render_engine(&mut warm, 48 + frames / FRAMES)?;
                frames += FRAMES;
                assert!(frames <= 2560, "rate-domain fade never settled");
            }
            let expected = (rate * 0.025).round() as usize;
            assert!((expected.saturating_sub(FRAMES)..=expected + 2 * FRAMES).contains(&frames));
            println!(
                "Warm whole {rate} Hz ×{factor}: identity residual={phase_error}, wire difference={wire_error}, fade={frames} host frames, admitted={used} bytes"
            );
        }
    }

    let bundle = whole(&bytes)?;
    let mut manifest = serde_json::to_value(bundle.manifest())?;
    manifest["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"]["tone"]["parameters"]["osEnabled"] =
        json!(1);
    manifest["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"]["tone"]["parameters"]["osFactor"] =
        json!(1);
    let key = SCENES_INNER_BYPASS_EXTENSION;
    let scene = |id, value| {
        json!({"id":id,"name":id,"gains":[],
        "native_bypass":[{"node":"tone","block":cab,"value":value}]})
    };
    manifest["extensions"][key] = json!({"fade_ms":25,"initial_scene":"dry",
        "scenes":[scene("dry",true),scene("wet",false)]});
    manifest["requiredExtensions"]
        .as_array_mut()
        .unwrap()
        .push(json!(key));
    let bundle = Bundle::from_parts(
        serde_json::to_vec(&manifest)?,
        BTreeMap::from([("source".into(), bytes)]),
    )?;
    let mut session = Session::new(bundle, world, 44100.0, FRAMES, BUFFER_BUDGET)?;
    assert!(!session.snapshot().scene_transitioning);
    select(&mut session, "wet")?;
    for i in 0..20 {
        let _ = super::render(&mut session, i)?;
    }
    assert_eq!(session.snapshot().scene.as_deref(), Some("wet"));
    assert!(!session.snapshot().scene_transitioning);
    println!("Warm whole 44100 Hz ×8: confirmed session and chain-rate scene transition");
    Ok(())
}

fn stereo(source: &[u8], amp: &str, cab: &str, root: &Path) -> Result<()> {
    let path = root.join("warm-stereo-delta.wav");
    delta_ir(&path, true)?;
    let mut author = load(source, 48000.0, 1)?;
    replace(&mut author, cab, &path, "ir", "cab")?;
    author.set_block(amp, "enabled", 0.0)?;
    author.set_block(cab, "enabled", 1.0)?;
    author.set_block(cab, "mix", 1.0)?;
    let stereo_bytes = author.save_preset("Stereo IR after NAM")?;
    let mut warm_stereo = load(&stereo_bytes, 48000.0, 4)?;
    prepare(&mut warm_stereo, &[amp, cab], BUFFER_BUDGET)?;

    let mut order: Vec<_> = author
        .layout()?
        .left
        .into_iter()
        .map(|block| block.id)
        .collect();
    let from = order.iter().position(|id| id == cab).unwrap();
    let to = order.iter().position(|id| id == amp).unwrap();
    order.swap(from, to);
    author.edit_structure(&StructureEdit::Reorder {
        lane: ChainLane::Left,
        block_ids: order,
    })?;
    author.prepare_stream()?;
    let mono_bytes = author.save_preset("Stereo IR before loaded NAM")?;
    let mut warm_mono = load(&mono_bytes, 48000.0, 4)?;
    prepare(&mut warm_mono, &[amp, cab], BUFFER_BUDGET)?;
    let mut dynamic = load(&mono_bytes, 48000.0, 4)?;
    for i in 0..21 {
        let after = render_engine(&mut warm_stereo, i)?;
        let before = render_engine(&mut warm_mono, i)?;
        let legacy = render_engine(&mut dynamic, i)?;
        if i > 5 {
            assert!(
                before[0]
                    .iter()
                    .zip(before[1])
                    .all(|(l, r)| (l - r).abs() < 1e-6)
            );
            for signal in [after, legacy] {
                assert!(
                    signal[0]
                        .iter()
                        .zip(signal[1])
                        .any(|(l, r)| (l - r).abs() > 0.01)
                );
            }
        }
    }
    println!(
        "Warm stereo IR: fixed mono fallback before a bypassed loaded NAM, true stereo after it, legacy follows enabled"
    );
    Ok(())
}

fn calibrated(source: &[u8], amp: &str, cab: &str, root: &Path) -> Result<()> {
    let pinned = std::env::var("OXIDAL_TONE3000_TEST_MODEL")?;
    let mut model: Value = serde_json::from_slice(&std::fs::read(pinned)?)?;
    let levels = |meta: &mut Value| {
        meta["input_level_dbu"] = json!(0);
        meta["output_level_dbu"] = json!(6);
    };
    levels(&mut model["metadata"]);
    for row in model["config"]["submodels"].as_array_mut().unwrap() {
        levels(&mut row["model"]["metadata"]);
    }
    let path = root.join("warm-calibrated-a2.nam");
    std::fs::write(&path, serde_json::to_vec(&model)?)?;
    let mut author = load(source, 48000.0, 1)?;
    replace(&mut author, amp, &path, "nam", "amp")?;
    author.set_block(amp, "normalize", 0.0)?;
    let before = author.layout()?;
    author.edit_structure(&StructureEdit::Duplicate {
        block_id: amp.to_owned(),
        lane: ChainLane::Left,
        index: 1,
    })?;
    author.prepare_stream()?;
    let after = author.layout()?;
    let next = &after
        .left
        .iter()
        .find(|row| !row.insert && !before.left.iter().any(|old| old.id == row.id))
        .unwrap()
        .id;
    author.set_block(next, "enabled", 0.0)?;
    author.set_block(cab, "enabled", 0.0)?;
    author.set_block(amp, "enabled", 1.0)?;
    author.set_block(amp, "mix", 1.0)?;
    let bytes = author.save_preset("Calibrated two NAM blocks")?;
    let mut warm = load(&bytes, 48000.0, 1)?;
    let mut legacy = load(&bytes, 48000.0, 1)?;
    for engine in [&mut warm, &mut legacy] {
        engine.set_normalized("calibrateInput", 1.0)?;
        engine.set_normalized("inputCalibrationLevel", 0.5)?;
        engine.prepare_stream()?;
    }
    prepare(&mut warm, &[next], BUFFER_BUDGET)?;
    // The DC blocker also sees the NAM's idle bias while the calibrated
    // handoff settles. Let both independent filters reach steady state.
    for _ in 0..120 {
        for engine in [&mut warm, &mut legacy] {
            engine.process(&mut [0.0; FRAMES], &mut [0.0; FRAMES])?;
        }
    }
    let mut error = 0.0_f32;
    let mut peak = 0.0_f32;
    for i in 0..60 {
        let a = render_engine(&mut warm, i)?;
        let b = render_engine(&mut legacy, i)?;
        if i > 40 {
            error = error.max(peak_error(&a, &b, 10.0_f32.powf(6.0 / 20.0)));
            peak = peak.max(b[0].iter().map(|s| s.abs()).fold(0.0_f32, f32::max));
        }
    }
    assert!(
        peak > 0.002 && error < 5e-4,
        "calibration gain residual={error}, peak={peak}"
    );
    println!(
        "Warm calibrated two-NAM lane: measured +6 dB handoff stays active with downstream capture bypassed"
    );
    Ok(())
}

fn derived(world: &World, source: &[u8], amp: &str, cab: &str, root: &Path) -> Result<()> {
    let base = super::super::partition::bundle(source, amp, cab, "left", -4.0)?;
    assert!(Session::new(base.clone(), world, 44100.0, FRAMES, BUFFER_BUDGET).is_err());
    let legacy = serde_json::to_value(base.manifest())?;
    let mut manifest = legacy.clone();
    let key = SCENES_INNER_BYPASS_EXTENSION;
    let scene = |id, off| {
        json!({"id":id,"name":id,"gains":[],"native_bypass":[
        {"node":"amp","block":amp,"value":off},{"node":"cab","block":cab,"value":off}]})
    };
    manifest["extensions"][key] = json!({"fade_ms":25,"initial_scene":"dry",
        "scenes":[scene("dry",true),scene("wet",false)]});
    manifest["requiredExtensions"] = json!([key]);
    let encode = |value: &Value| -> Result<Bundle> {
        Ok(Bundle::from_parts(
            serde_json::to_vec(value)?,
            BTreeMap::from([("source".into(), source.to_vec())]),
        )?)
    };
    let mut illegal_legacy = legacy;
    illegal_legacy["tone3000"]["instances"][0]["partition"]["oversampling"] = json!(1);
    assert!(encode(&illegal_legacy).is_err());
    let mut illegal_pair = manifest.clone();
    illegal_pair["tone3000"]["instances"][0]["partition"]["oversampling"] = json!(4);
    assert!(encode(&illegal_pair).is_err());
    for n in illegal_pair["tone3000"]["instances"]
        .as_array_mut()
        .unwrap()
    {
        n["partition"]["oversampling"] = json!(3);
    }
    assert!(encode(&illegal_pair).is_err());

    let store = BundleStore::new(root.join("warm-derived-expanded"));
    for factor in [1, 2, 4, 8] {
        for n in manifest["tone3000"]["instances"].as_array_mut().unwrap() {
            n["partition"]["oversampling"] = json!(factor);
        }
        let bundle = encode(&manifest)?;
        for rate in [44100_u32, 48000, 96000] {
            let mut session = Session::new(
                bundle.clone(),
                world,
                f64::from(rate),
                FRAMES,
                BUFFER_BUDGET,
            )?;
            let before = session.snapshot();
            assert_eq!(before.native_bypass_armed.unwrap().len(), 2);
            let mut energy = 0.0_f32;
            for i in 0..12 {
                let output = super::render(&mut session, i)?;
                energy += output.iter().flatten().map(|x| x * x).sum::<f32>();
            }
            assert!(energy > 0.01 && energy.is_finite());
            select(&mut session, "wet")?;
            assert!(session.snapshot().scene_transitioning);
            for i in 12..45 {
                let _ = super::render(&mut session, i)?;
            }
            let state = session.snapshot();
            assert!(!state.scene_transitioning);
            assert_eq!(state.scene.as_deref(), Some("wet"));
            if factor == 8 && rate == 44100 {
                store.save(&bundle)?;
                let mut stream = super::super::partition::stream();
                stream.input.sample_rate = rate;
                stream.output.sample_rate = rate;
                let saved = save_revision(
                    &store,
                    world,
                    SaveRequest {
                        settings: StartRig {
                            revision: bundle.revision().into(),
                            prepared: vec![],
                            stream,
                            recall: None,
                            midi: None,
                        },
                        recall: state.recall(),
                        name: "Saved expanded partition".into(),
                    },
                )?;
                let saved = store.read(&saved)?;
                assert_eq!(
                    store.read(bundle.revision())?.resource("source"),
                    Some(source)
                );
                assert!(
                    saved.manifest().tone3000.instances.iter().all(|n| n
                        .partition
                        .as_ref()
                        .unwrap()
                        .oversampling
                        == Some(8))
                );
                let mut reopen =
                    Session::new(saved, world, f64::from(rate), FRAMES, BUFFER_BUDGET)?;
                assert_eq!(reopen.snapshot().scene.as_deref(), Some("wet"));
                let _ = super::render(&mut reopen, 0)?;
            }
            println!(
                "Warm derived {rate} Hz ×{factor}: independent boundaries around real LV2, confirmed dry/wet and preserved recipe"
            );
        }
    }
    Ok(())
}

pub(super) fn qualify(
    world: &World,
    source: &[u8],
    amp: &str,
    cab: &str,
    root: &Path,
) -> Result<()> {
    rates(world, source, amp, cab, root)?;
    stereo(source, amp, cab, root)?;
    calibrated(source, amp, cab, root)?;
    derived(world, source, amp, cab, root)?;
    Ok(())
}
