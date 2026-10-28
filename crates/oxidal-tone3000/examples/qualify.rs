//! Repeatable offline qualification, invoked by pnpm native:check on the main thread.
use oxidal_tone3000::Engine;
use serde_json::Value;
use std::{
    error::Error,
    time::{Duration, Instant},
};

fn wait_loaded(engine: &mut Engine) -> Result<(), Box<dyn Error>> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        engine.pump()?;
        let state = engine.runtime()?;
        let blocks = state["blocks"].as_array().ok_or("missing runtime blocks")?;
        if blocks.iter().any(|b| b["loadFailed"] == true) {
            return Err(format!("native load failed: {state}").into());
        }
        if !blocks.is_empty()
            && blocks
                .iter()
                .all(|b| b["loaded"] == true && b["modelLoading"] != true)
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("native readiness timeout: {state}").into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn settle(engine: &mut Engine) -> Result<(), Box<dyn Error>> {
    for _ in 0..400 {
        engine.pump()?;
        engine.process(&mut [0.0; 128], &mut [0.0; 128])?;
    }
    Ok(())
}
// The full processor has a documented first-order 5 Hz output DC blocker.
// Compare against that complete signal path rather than incorrectly expecting raw NAM output.
#[derive(Default)]
struct DcBlocker {
    z: f32,
}
impl DcBlocker {
    fn process(&mut self, samples: &mut [f32]) {
        let n = (std::f32::consts::PI * 5.0 / 48000.0).tan();
        let b0 = 1.0 / (n + 1.0);
        let a1 = (n - 1.0) / (n + 1.0);
        for sample in samples {
            let y = b0 * *sample + self.z;
            self.z = -b0 * *sample - a1 * y;
            *sample = y;
        }
    }
}
// Native reports algorithmic delay to its host; rate conversion and the
// pitch window must not disappear at the Rust boundary. No device-latency claim.
fn qualify_latency() -> Result<(), Box<dyn Error>> {
    for rate in [48000.0, 44100.0, 96000.0] {
        let mut engine = Engine::new(rate, 128)?;
        engine.set_normalized("pitchEnabled", 0.0)?;
        engine.pump()?;
        let baseline = engine.latency_samples()?;
        if rate == 48000.0 {
            assert_eq!(baseline, 0);
        } else {
            assert!(baseline > 0, "rate boundary must report its delay");
        }
        engine.set_normalized("pitchEnabled", 1.0)?;
        for (index, milliseconds) in [20u32, 30, 40, 60].into_iter().enumerate() {
            engine.set_normalized("pitchWindow", index as f32 / 3.0)?;
            engine.pump()?;
            let floor = (rate * 0.002).round() as u32;
            let window = (rate * f64::from(milliseconds) / 1000.0).round() as u32;
            assert_eq!(engine.latency_samples()?, baseline + (floor + window) / 2);
        }
        let retained = engine.capture()?;
        engine.set_normalized("pitchEnabled", 0.0)?;
        engine.pump()?;
        assert_eq!(engine.latency_samples()?, baseline);
        engine.restore(&retained)?;
        engine.pump()?;
        assert!(engine.latency_samples()? > baseline);
        let restored_delay = engine.latency_samples()?;
        engine.prepare_stream()?;
        assert_eq!(engine.latency_samples()?, restored_delay);
    }
    println!(
        "native latency: rate boundary, four pitch windows, disable and restored state passed"
    );
    Ok(())
}
fn stage_result(engine: &mut Engine, token: u64) -> Result<Value, Box<dyn Error>> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        engine.pump()?;
        if let Some(result) = engine.stage_read(token)? {
            return Ok(result);
        }
        if Instant::now() > deadline {
            return Err("stage response timeout".into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn qualify_stage(engine: &mut Engine) -> Result<(), Box<dyn Error>> {
    use oxidal_tone3000::protocol::{BlockEdit, EditPhase, EqBand, EqType, StageAction};
    let baseline = engine.capture()?;
    engine.prepare_stream()?;
    let mut baseline_audio = Vec::new();
    for block in 0..24 {
        let mut left: Vec<f32> = (0..128)
            .map(|i| ((block * 128 + i) as f32 * 0.13).sin() * 0.1)
            .collect();
        let mut right = left.clone();
        engine.process(&mut left, &mut right)?;
        baseline_audio.extend(left);
    }
    let chain = engine.chain()?;
    let block = chain["chain"]
        .as_array()
        .ok_or("missing chain")?
        .iter()
        .find(|b| b["kind"] == "tone")
        .ok_or("missing tone")?;
    let id = block["blockId"]
        .as_str()
        .ok_or("missing block id")?
        .to_owned();
    let before = block["params"]["eq"].clone();
    let enabled = before["enabled"].as_bool().ok_or("missing EQ enable")?;
    assert!(engine.stage_submit(0, &StageAction::Runtime).is_err());
    engine.stage_submit(1, &StageAction::Runtime)?;
    assert_eq!(stage_result(engine, 1)?["state"], "done");
    assert!(engine.stage_submit(1, &StageAction::Runtime).is_err());
    engine.stage_submit(
        2,
        &StageAction::BlockEdit {
            edit: BlockEdit::EqEnabled {
                phase: EditPhase::Preview,
                block_id: id.clone(),
                value: !enabled,
            },
        },
    )?;
    assert_eq!(stage_result(engine, 2)?["state"], "listening");
    assert_eq!(
        engine.chain()?["chain"][0]["params"]["eq"]["enabled"],
        !enabled
    );
    assert!(engine.stage_submit(3, &StageAction::Runtime).is_err());
    assert!(engine.stage_read(3).is_err());
    engine.stage_submit(2, &StageAction::Cancel)?;
    assert_eq!(stage_result(engine, 2)?["state"], "cancelled");
    assert_eq!(engine.chain()?["chain"][0]["params"]["eq"], before);
    engine.stage_submit(
        4,
        &StageAction::BlockEdit {
            edit: BlockEdit::EqBand {
                phase: EditPhase::Commit,
                block_id: id.clone(),
                index: 1,
                band: EqBand {
                    kind: EqType::Bell,
                    freq_hz: 1000.0,
                    gain_db: 6.0,
                    q: 0.7,
                },
            },
        },
    )?;
    assert_eq!(stage_result(engine, 4)?["state"], "done");
    engine.stage_submit(
        5,
        &StageAction::BlockEdit {
            edit: BlockEdit::EqEnabled {
                phase: EditPhase::Commit,
                block_id: id.clone(),
                value: true,
            },
        },
    )?;
    assert_eq!(stage_result(engine, 5)?["state"], "done");
    let edited = engine.chain()?["chain"][0]["params"]["eq"].clone();
    assert_eq!(edited["bands"][1]["gainDb"], 6.0);
    assert_eq!(edited["enabled"], true);
    // The playback worker calls the immediate setter, not a dispatcher wait.
    engine.set_eq(
        &id,
        &oxidal_audio::eq::EqEdit::Pre {
            value: !before["pre"].as_bool().unwrap(),
        },
    )?;
    let mut band = engine.eq_snapshot()?[0].eq.bands[1].clone();
    band.freq_hz = 700.0;
    band.gain_db = 0.1;
    engine.set_eq(
        &id,
        &oxidal_audio::eq::EqEdit::Band {
            index: 1,
            band: band.clone(),
        },
    )?;
    let eq = engine.eq_snapshot()?;
    assert_eq!(eq[0].eq.bands[1], band);
    assert!(
        engine
            .set_eq(
                "missing",
                &oxidal_audio::eq::EqEdit::Enabled { value: true }
            )
            .is_err()
    );
    assert_eq!(engine.eq_snapshot()?, eq);
    let edited = engine.chain()?["chain"][0]["params"]["eq"].clone();
    let mut replayed = Engine::new(48000.0, 128)?;
    replayed.restore(&baseline)?;
    wait_loaded(&mut replayed)?;
    let before_replay = replayed.eq_snapshot()?;
    let mut token = 100;
    let mut invalid = eq.clone();
    invalid[0].block_id = "missing-block".into();
    assert!(replayed.restore_eq(&invalid, &mut token).is_err());
    assert_eq!(replayed.eq_snapshot()?, before_replay);
    invalid = eq.clone();
    invalid[0].eq.bands[1].freq_hz = 0.0;
    assert!(replayed.restore_eq(&invalid, &mut token).is_err());
    assert_eq!(replayed.eq_snapshot()?, before_replay);
    assert_eq!(token, 100, "rejected replay must not consume a token");
    replayed.restore_eq(&eq, &mut token)?;
    assert_eq!(replayed.eq_snapshot()?, eq);
    replayed.prepare_stream()?;
    let saved = engine.save_preset("Stage EQ qualification")?;
    let mut recalled = Engine::new(48000.0, 128)?;
    recalled.load_preset(&saved)?;
    wait_loaded(&mut recalled)?;
    assert_eq!(recalled.chain()?["chain"][0]["params"]["eq"], edited);
    engine.prepare_stream()?;
    recalled.prepare_stream()?;
    let mut changed_audio = Vec::new();
    for block in 0..24 {
        let mut left: Vec<f32> = (0..128)
            .map(|i| ((block * 128 + i) as f32 * 0.13).sin() * 0.1)
            .collect();
        let mut right = left.clone();
        let mut restored_left = left.clone();
        let mut restored_right = left.clone();
        let mut replay_left = left.clone();
        let mut replay_right = right.clone();
        replayed.process(&mut replay_left, &mut replay_right)?;
        engine.process(&mut left, &mut right)?;
        recalled.process(&mut restored_left, &mut restored_right)?;
        changed_audio.extend_from_slice(&left);
        let error = left
            .iter()
            .chain(&right)
            .zip(restored_left.iter().chain(&restored_right))
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(error < 1e-5, "stage EQ saved render differs: {error}");
        let error = left
            .iter()
            .chain(&right)
            .zip(replay_left.iter().chain(&replay_right))
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(error < 1e-5, "stage EQ replay render differs: {error}");
    }
    assert!(
        baseline_audio
            .iter()
            .zip(&changed_audio)
            .any(|(a, b)| (a - b).abs() > 1e-4),
        "EQ edit did not affect rendered audio"
    );
    engine.restore(&baseline)?;
    wait_loaded(engine)?;
    settle(engine)?;
    println!(
        "native stage: stale/busy ownership, EQ preview/cancel/commit, embedded Save and fresh rendered recall passed"
    );
    Ok(())
}
// Use deterministic deck settings to distinguish actual stereo DSP from descriptor readback.
fn qualify_spread() -> Result<(), Box<dyn Error>> {
    fn render(engine: &mut Engine) -> Result<Vec<[f32; 2]>, Box<dyn Error>> {
        engine.prepare_stream()?;
        settle(engine)?;
        let mut result = Vec::new();
        for chunk in 0..100 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| {
                    let t = (chunk * 128 + i) as f32;
                    (t * 0.071).sin() * 0.05 + (t * 0.193).sin() * 0.02
                })
                .collect();
            let mut right = left.clone();
            engine.process(&mut left, &mut right)?;
            result.extend(left.into_iter().zip(right).map(|(l, r)| [l, r]));
        }
        Ok(result)
    }
    let mut engine = Engine::new(48000.0, 128)?;
    engine.set_live_control("gateEnabled", 0.0)?;
    engine.set_live_control("toneEqEnabled", 0.0)?;
    engine.set_live_control("spreadEnabled", 0.0)?;
    let dry = render(&mut engine)?;
    assert!(dry.iter().all(|s| (s[0] - s[1]).abs() < 1e-6));
    engine.set_live_control("spreadWobbleEnabled", 0.0)?;
    engine.set_live_control("spreadOffset", 0.75)?;
    engine.set_live_control("spreadEnabled", 1.0)?;
    let wet = render(&mut engine)?;
    let difference: f32 = wet.iter().map(|s| (s[0] - s[1]).abs()).sum();
    assert!(difference > 1.0, "Spread must change actual stereo PCM");
    let delay = engine.latency_samples()?;
    let preset = engine.save_preset("Stereo image qualification")?;
    let expected = engine.live_controls()?;
    let mut restored = Engine::new(48000.0, 128)?;
    restored.load_preset(&preset)?;
    restored.wait_ready()?;
    for c in expected
        .iter()
        .filter(|c| c.target.starts_with("spread") || c.target == "outputBalance")
    {
        let actual = restored
            .live_controls()?
            .into_iter()
            .find(|a| a.target == c.target)
            .unwrap();
        assert_eq!(c.value, actual.value);
        assert_eq!(c.display, actual.display);
    }
    let recalled = render(&mut restored)?;
    let error = wet
        .iter()
        .zip(&recalled)
        .flat_map(|(a, b)| [(a[0] - b[0]).abs(), (a[1] - b[1]).abs()])
        .fold(0.0_f32, f32::max);
    assert!(error < 1e-5, "Spread saved PCM differs: {error}");
    assert_eq!(restored.latency_samples()?, delay);
    restored.set_live_control("outputBalance", 0.75)?;
    let balanced = render(&mut restored)?;
    let energy = |frames: &[[f32; 2]], channel: usize| {
        frames.iter().map(|s| s[channel] * s[channel]).sum::<f32>()
    };
    assert!(energy(&balanced, 0) < energy(&recalled, 0));
    assert!(energy(&balanced, 1) > energy(&recalled, 1));
    assert_eq!(restored.latency_samples()?, delay);
    eprintln!(
        "qualify: stereo spread PCM, balance direction, native units and saved recall passed"
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.as_slice() == ["--local-files"] {
        return qualify_local_files();
    }
    if arguments.as_slice() == ["--gestures"] {
        return qualify_live_gestures();
    }
    if arguments.as_slice() == ["--defaults"] {
        return qualify_device_defaults();
    }
    if arguments.as_slice() == ["--utilities"] {
        return qualify_utilities();
    }
    if arguments.as_slice() == ["--stereo-controls"] {
        return qualify_image_authoring();
    }
    if arguments.first().is_some_and(|a| a == "--structure") {
        if arguments.len() != 2 {
            return Err("Usage: qualify --structure <embedded-preset>".into());
        }
        let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?);
        return qualify_editor_structure(&root, &std::fs::read(&arguments[1])?);
    }
    qualify_local_files()?;
    qualify_live_gestures()?;
    qualify_device_defaults()?;
    qualify_latency()?;
    qualify_spread()?;
    qualify_image_authoring()?;
    qualify_utilities()?;
    let expected: Value =
        serde_json::from_str(include_str!("../../../native/tone3000/parameters.json"))?;
    let mut engine = Engine::new(48000.0, 128)?;
    // Coexisting processors share the process owner, never their mutable DSP state.
    drop(Engine::new(48000.0, 128)?);
    assert!(
        std::thread::spawn(|| Engine::new(48000.0, 128).is_err())
            .join()
            .expect("foreign-owner probe"),
        "must reject a foreign owner thread"
    );
    let catalog = engine.catalog()?;
    let actual = catalog.as_array().ok_or("catalog must be array")?;
    assert_eq!(actual.len(), 43);
    assert_eq!(actual.iter().filter(|p| p["tone"] == true).count(), 36);
    assert_eq!(
        actual
            .iter()
            .filter(|p| p["machine_default"] == true)
            .count(),
        4
    );
    for row in expected.as_array().ok_or("expected catalog")? {
        let got = actual
            .iter()
            .find(|p| p["id"] == row["id"])
            .ok_or("missing native parameter")?;
        for (native, key) in [
            ("minimum", "min"),
            ("maximum", "max"),
            ("default", "default"),
        ] {
            let wanted = row[key]
                .as_f64()
                .unwrap_or(if row[key] == true { 1.0 } else { 0.0 });
            let value = got[native].as_f64().ok_or("native numeric descriptor")?;
            assert!(
                (value - wanted).abs() < 1e-5,
                "{} {native}: {value} != {wanted}",
                row["id"]
            );
        }
    }
    assert!(engine.set_normalized("missing", 0.5).is_err());
    assert!(engine.set_normalized("inputLevel", f32::NAN).is_err());
    assert!(engine.process(&mut [0.0; 1], &mut [0.0; 2]).is_err());
    engine.set_normalized("gateEnabled", 0.0)?;
    engine.set_normalized("toneEqEnabled", 0.0)?;
    settle(&mut engine)?;
    let input: Vec<f32> = (0..128).map(|i| (i as f32 * 0.03).sin() * 0.1).collect();
    let mut left = input.clone();
    let mut right = input.clone();
    engine.process(&mut left, &mut right)?;
    let mut dry_reference = input.clone();
    DcBlocker::default().process(&mut dry_reference);
    let dry_error = left
        .iter()
        .zip(&dry_reference)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f32::max);
    assert!(dry_error < 1e-5, "dry path differs: {dry_error}");
    let state = engine.capture()?;
    engine.set_normalized("inputCalibrationLevel", 0.8)?;
    engine.set_normalized("toneBass", 0.8)?;
    engine.restore(&state)?;
    settle(&mut engine)?;
    let restored = engine.catalog()?;
    for id in ["inputCalibrationLevel", "toneBass"] {
        let before = actual.iter().find(|p| p["id"] == id).unwrap();
        let after = restored
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap();
        assert_eq!(before["value"], after["value"], "state restore {id}");
    }
    // Preserve the native local-loader's A2-only policy rather than widening it for a test.
    let suite: Value =
        serde_json::from_str(include_str!("../../oxidal-nam/tests/fixtures/parity.json"))?;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?);
    let unsupported = root.join("authored-lstm.nam");
    std::fs::write(
        &unsupported,
        serde_json::to_vec(&suite["cases"][1]["model"])?,
    )?;
    let rejected = engine.load_local_model(&unsupported)?;
    assert_eq!(rejected["error"], "Only A2 NAM files are supported");
    let path = root.join("qualification-a2.nam");
    std::fs::copy(std::env::var("OXIDAL_TONE3000_TEST_MODEL")?, &path)?;
    let loaded = engine.load_local_model(&path)?;
    if !loaded["error"].is_null() {
        return Err(format!("load error: {loaded}").into());
    }
    wait_loaded(&mut engine)?;
    settle(&mut engine)?;
    qualify_stage(&mut engine)?;
    let model_state = engine.capture()?;
    let mut original = Vec::new();
    for block in 0..12 {
        let input: Vec<f32> = (0..128)
            .map(|i| (((block * 128 + i) as f32) * 0.01).sin() * 0.2)
            .collect();
        let mut left = input.clone();
        let mut right = input.clone();
        engine.process(&mut left, &mut right)?;
        assert!(left.iter().zip(&right).all(|(a, b)| (a - b).abs() < 1e-5));
        original.extend(left);
    }
    assert!(
        original.iter().any(|v| v.abs() > 0.001),
        "loaded model must produce audible nonzero output"
    );
    drop(engine);
    // Preserve the old stash separately and remove only our temporary input copy.
    // The next instance must rebuild from embedded state, not these disk paths.
    std::fs::remove_file(&path)?;
    let stash = root.join(if cfg!(target_os = "linux") {
        "user/.config/TONE3000/LocalModels"
    } else {
        "user/Library/Application Support/TONE3000/LocalModels"
    });
    std::fs::rename(&stash, root.join("stash-before-restore"))?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.restore(&model_state)?;
    wait_loaded(&mut engine)?;
    settle(&mut engine)?;
    let mut restored_audio = Vec::new();
    for block in 0..12 {
        let input: Vec<f32> = (0..128)
            .map(|i| (((block * 128 + i) as f32) * 0.01).sin() * 0.2)
            .collect();
        let mut left = input.clone();
        let mut right = input.clone();
        engine.process(&mut left, &mut right)?;
        restored_audio.extend(left);
    }
    let restore_error = original
        .iter()
        .zip(&restored_audio)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    assert!(
        restore_error < 1e-5,
        "restored native model differs: {restore_error}"
    );
    let live_before = engine.capture()?;
    for (target, value) in [
        ("osEnabled", 1.0),
        ("pitchWindow", 0.5),
        ("unknown", 0.5),
        ("outputLevel", f32::NAN),
        ("gateEnabled", 0.5),
    ] {
        assert!(engine.set_live_control(target, value).is_err());
    }
    assert_eq!(
        engine.capture()?,
        live_before,
        "Rejected live edit changed state"
    );
    for control in engine.live_controls()? {
        let value = if control.toggle {
            1.0 - control.value
        } else {
            0.23
        };
        engine.set_live_control(&control.target, value)?;
        let confirmed = engine
            .live_controls()?
            .into_iter()
            .find(|c| c.target == control.target)
            .unwrap();
        assert!(
            (confirmed.value - value).abs() < 0.001,
            "Live readback {}",
            control.target
        );
        engine.restore(&live_before)?;
        engine.wait_ready()?;
    }
    // Reconstruct a captured scalar session and compare actual rendered audio.
    engine.set_live_control("outputLevel", 0.27)?;
    let saved_controls = engine.live_controls()?;
    let changed_state = engine.capture()?;
    let legacy: Vec<_> = saved_controls
        .iter()
        .filter(|c| !c.target.starts_with("spread") && c.target != "outputBalance")
        .cloned()
        .collect();
    engine.apply_live_snapshot(&legacy)?;
    assert_eq!(
        engine.capture()?,
        changed_state,
        "legacy recovery retains source image state"
    );
    let mut partial_deck = saved_controls.clone();
    partial_deck.retain(|c| c.target != "spreadEnabled");
    assert!(engine.apply_live_snapshot(&partial_deck).is_err());
    assert_eq!(engine.capture()?, changed_state);
    let mut incomplete = saved_controls.clone();
    incomplete.pop();
    assert!(engine.apply_live_snapshot(&incomplete).is_err());
    assert_eq!(engine.capture()?, changed_state);
    let mut renders = vec![];
    for rebuild in [false, true] {
        engine.restore(if rebuild {
            &live_before
        } else {
            &changed_state
        })?;
        engine.wait_ready()?;
        if rebuild {
            engine.apply_live_snapshot(&saved_controls)?;
        }
        settle(&mut engine)?;
        let mut rendered = vec![];
        for chunk in 0..12 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| (((chunk * 128 + i) as f32) * 0.01).sin() * 0.02)
                .collect();
            let mut right = left.clone();
            engine.process(&mut left, &mut right)?;
            rendered.extend(left);
        }
        renders.push(rendered);
    }
    assert!(renders[0].iter().any(|s| s.abs() > 1e-8));
    let reconstruction_error = renders[0]
        .iter()
        .zip(&renders[1])
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    assert!(
        reconstruction_error < 1e-5,
        "live reconstruction audio differs: {reconstruction_error}"
    );
    println!("live_reconstruction_max_error: {reconstruction_error}");
    engine.restore(&live_before)?;
    engine.wait_ready()?;
    // Prove that a block gain mutation reaches DSP, not just its JSON readback.
    let block = engine
        .block_controls()?
        .into_iter()
        .find(|p| p.parameter == "outputGain")
        .unwrap();
    for (parameter, value) in [("mix", f32::NAN), ("enabled", 0.5), ("unknown", 0.5)] {
        assert!(engine.set_block(&block.block_id, parameter, value).is_err());
    }
    assert!(engine.set_block("missing", "mix", 0.5).is_err());
    assert!(engine.set_block("missing", "slimSize", 0.5).is_err());
    let mut energy = Vec::new();
    for gain in [0.3, 0.7] {
        engine.restore(&model_state)?;
        engine.wait_ready()?;
        engine.set_live_control(&block.id, gain)?;
        settle(&mut engine)?;
        let mut sum = 0.0_f64;
        for chunk in 0..12 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| (((chunk * 128 + i) as f32) * 0.01).sin() * 0.02)
                .collect();
            let mut right = left.clone();
            engine.process(&mut left, &mut right)?;
            sum += left.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>();
        }
        energy.push(sum);
    }
    assert!(
        energy[0] > 0.0 && energy[1] > energy[0] * 4.0,
        "block output gain must change rendered level: {energy:?}"
    );
    println!("block_gain_render_energy_ratio: {}", energy[1] / energy[0]);
    engine.restore(&model_state)?;
    engine.wait_ready()?;
    eprintln!("qualify: export tone");
    engine.set_normalized("toneEqEnabled", 1.0)?;
    engine.set_normalized("toneBass", 0.4)?;
    let preset = engine.save_preset("Authored A2 workflow")?;
    std::fs::write(root.join("a2-preset.t3kpreset"), &preset)?;
    // Tone loads preserve device/session calibration and oversampling.
    engine.set_normalized("inputCalibrationLevel", 0.7)?;
    engine.set_normalized("osEnabled", 1.0)?;
    engine.set_normalized("osFactor", 0.5)?;
    engine.wait_ready()?;
    eprintln!("qualify: staged device settings ready");
    let device_before = engine.catalog()?;
    engine.load_preset(&preset)?;
    engine.wait_ready()?;
    let device_after = engine.catalog()?;
    for id in ["inputCalibrationLevel", "osEnabled", "osFactor"] {
        let value = |catalog: &Value| {
            catalog
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == id)
                .unwrap()["value"]
                .clone()
        };
        assert_eq!(value(&device_before), value(&device_after), "preserve {id}");
    }
    // Each whole-tone save has a fresh owned identity, including same-name saves.
    let second = engine.save_preset("Authored A2 workflow")?;
    assert_ne!(
        oxidal_presets::inspect(&preset)?.source_id,
        oxidal_presets::inspect(&second)?.source_id
    );
    drop(engine);
    eprintln!("qualify: owned editor workflow");
    qualify_editor(&root, &preset)?;
    qualify_editor_scalars(&root, &preset)?;
    qualify_editor_structure(&root, &preset)?;
    qualify_factories()?;
    qualify_empty_creation(&root, &preset)?;
    qualify_model_preparation(&root, &preset)?;
    qualify_ir_preparation(&root)?;
    qualify_engine_isolation(&preset)?;
    println!(
        "{}",
        serde_json::json!({"parameters":43,"tone_parameters":36,"machine_defaults":4,"dry_max_error":dry_error,"restored_a2_max_error":restore_error,"state_bytes":model_state.byte_len(),"non_a2_local_load_rejected":true,"live_audio_qualified":false})
    );
    Ok(())
}

fn qualify_editor(root: &std::path::Path, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    use oxidal_tone3000::{
        editor::Editor,
        protocol::{EditorAction as A, EditorCommand, EditorSnapshot},
    };
    let store_root = root.join("editor-library");
    let mut originals = oxidal_presets::Store::new(store_root.clone());
    let original = originals.import(bytes)?;
    let mut editor = Editor::new(store_root.clone())?;
    let send = |editor: &mut Editor, action: A| -> Result<EditorSnapshot, Box<dyn Error>> {
        eprintln!("qualify editor: {action:?}");
        let s = editor.snapshot()?;
        Ok(editor.command(EditorCommand {
            session: s.session,
            expected_revision: s.revision,
            request_id: format!("request-{}", s.revision),
            action,
        })?)
    };
    let value =
        |s: &EditorSnapshot, id: &str| s.parameters.iter().find(|p| p.id == id).unwrap().normalized;
    let loaded = send(
        &mut editor,
        A::Load {
            id: original.sha256.clone(),
            owned: false,
        },
    )?;
    send(
        &mut editor,
        A::Begin {
            owner: "owner".into(),
            token: "cancel".into(),
            target: "toneBass".into(),
        },
    )?;
    let preview = send(
        &mut editor,
        A::Preview {
            owner: "owner".into(),
            token: "cancel".into(),
            sequence: 1,
            value: 0.8,
        },
    )?;
    assert!((value(&preview, "toneBass") - 0.8).abs() < 1e-5);
    assert_eq!(
        preview.state_captures, loaded.state_captures,
        "preview must not capture opaque state"
    );
    assert!(
        send(
            &mut editor,
            A::Commit {
                owner: "intruder".into(),
                token: "cancel".into(),
                sequence: 2,
                value: 0.9
            }
        )
        .is_err()
    );
    let cancelled = send(
        &mut editor,
        A::Cancel {
            owner: "owner".into(),
            token: "cancel".into(),
        },
    )?;
    assert!((value(&loaded, "toneBass") - value(&cancelled, "toneBass")).abs() < 1e-6);
    for (token, target, value) in [
        ("commit", "toneBass", 0.75),
        ("level", "outputLevel", 0.6),
        ("calibration", "inputCalibrationLevel", 0.65),
        ("os", "osEnabled", 1.0),
        ("factor", "osFactor", 0.5),
    ] {
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.into(),
                target: target.into(),
            },
        )?;
        if target == "osFactor" {
            assert!(
                send(
                    &mut editor,
                    A::Preview {
                        owner: "owner".into(),
                        token: token.into(),
                        sequence: 1,
                        value
                    }
                )
                .is_err()
            );
        }
        send(
            &mut editor,
            A::Commit {
                owner: "owner".into(),
                token: token.into(),
                sequence: 2,
                value,
            },
        )?;
    }
    let globals = editor.snapshot()?;
    assert_eq!(globals.state_captures, loaded.state_captures + 5);
    assert_eq!(
        globals.block_controls.len(),
        6,
        "one A2 block with five controls and requested model size"
    );
    assert!(
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: "missing".into(),
                target: "block:missing:mix".into()
            }
        )
        .is_err()
    );
    for (index, control) in globals.block_controls.iter().enumerate() {
        if control.staged {
            continue;
        }
        let token = format!("block-cancel-{index}");
        let baseline = editor.snapshot()?;
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.clone(),
                target: control.id.clone(),
            },
        )?;
        let changed = if control.step == 1.0 {
            1.0 - control.value as f32
        } else {
            0.23
        };
        if control.step == 1.0 {
            assert!(
                send(
                    &mut editor,
                    A::Preview {
                        owner: "owner".into(),
                        token: token.clone(),
                        sequence: 1,
                        value: 0.5
                    }
                )
                .is_err()
            );
        }
        let preview = send(
            &mut editor,
            A::Preview {
                owner: "owner".into(),
                token: token.clone(),
                sequence: 1,
                value: changed,
            },
        )?;
        assert!((preview.block_controls[index].value - f64::from(changed)).abs() < 1e-6);
        assert_eq!(preview.state_captures, baseline.state_captures);
        assert!(
            send(
                &mut editor,
                A::Commit {
                    owner: "intruder".into(),
                    token: token.clone(),
                    sequence: 2,
                    value: changed
                }
            )
            .is_err()
        );
        let cancelled = send(
            &mut editor,
            A::Cancel {
                owner: "owner".into(),
                token,
            },
        )?;
        for (a, b) in baseline
            .block_controls
            .iter()
            .zip(&cancelled.block_controls)
        {
            assert_eq!(a.value, b.value, "cancel restores every block parameter");
        }
        let token = format!("block-commit-{index}");
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.clone(),
                target: control.id.clone(),
            },
        )?;
        let committed = send(
            &mut editor,
            A::Commit {
                owner: "owner".into(),
                token,
                sequence: 1,
                value: changed,
            },
        )?;
        assert!(committed.dirty);
        assert_eq!(committed.state_captures, baseline.state_captures + 1);
        assert!((committed.block_controls[index].value - f64::from(changed)).abs() < 1e-6);
        for (a, b) in globals.parameters.iter().zip(&committed.parameters) {
            assert_eq!(
                a.value, b.value,
                "block edit must not change global/device settings"
            );
        }
    }
    let size = globals
        .block_controls
        .iter()
        .find(|p| p.parameter == "slimSize")
        .unwrap();
    assert!(size.staged);
    let before_size = editor.snapshot()?;
    send(
        &mut editor,
        A::Begin {
            owner: "owner".into(),
            token: "size-cancel".into(),
            target: size.id.clone(),
        },
    )?;
    assert!(
        send(
            &mut editor,
            A::Preview {
                owner: "owner".into(),
                token: "size-cancel".into(),
                sequence: 1,
                value: 0.75
            }
        )
        .is_err()
    );
    let after_rejection = editor.snapshot()?;
    assert_eq!(
        after_rejection.block_controls.last().unwrap().value,
        size.value
    );
    assert_eq!(after_rejection.state_captures, before_size.state_captures);
    send(
        &mut editor,
        A::Cancel {
            owner: "owner".into(),
            token: "size-cancel".into(),
        },
    )?;
    send(
        &mut editor,
        A::Begin {
            owner: "owner".into(),
            token: "size-commit".into(),
            target: size.id.clone(),
        },
    )?;
    let committed = send(
        &mut editor,
        A::Commit {
            owner: "owner".into(),
            token: "size-commit".into(),
            sequence: 1,
            value: 0.75,
        },
    )?;
    assert_eq!(committed.block_controls.last().unwrap().value, 0.75);
    assert!(committed.dirty);
    assert_eq!(committed.state_captures, loaded.state_captures + 11);
    // A real filesystem failure must not report success or change native working state.
    std::fs::write(store_root.join("owned"), b"not a directory")?;
    assert!(
        editor
            .command(EditorCommand {
                session: committed.session.clone(),
                expected_revision: committed.revision,
                request_id: "failed-save".into(),
                action: A::Save {
                    name: "Must fail".into()
                }
            })
            .is_err()
    );
    std::fs::remove_file(store_root.join("owned"))?;
    assert!((value(&editor.snapshot()?, "toneBass") - value(&committed, "toneBass")).abs() < 1e-6);
    let saved = send(
        &mut editor,
        A::Save {
            name: "Owned A2".into(),
        },
    )?;
    let owned = saved.owned.last().unwrap();
    assert_eq!(
        owned.source_sha256.as_deref(),
        Some(original.sha256.as_str())
    );
    assert_ne!(owned.preset.source_id, original.source_id);
    let id = owned.id.clone();
    assert_eq!(originals.original(&original.sha256)?, bytes);
    send(
        &mut editor,
        A::Load {
            id: original.sha256.clone(),
            owned: false,
        },
    )?;
    let reloaded = send(
        &mut editor,
        A::Load {
            id: id.clone(),
            owned: true,
        },
    )?;
    for id in [
        "toneBass",
        "outputLevel",
        "inputCalibrationLevel",
        "osEnabled",
        "osFactor",
    ] {
        assert!((value(&reloaded, id) - value(&committed, id)).abs() < 1e-6);
    }
    for (a, b) in committed
        .block_controls
        .iter()
        .zip(&reloaded.block_controls)
    {
        assert_eq!(a.parameter, b.parameter);
        assert_eq!(a.value, b.value, "owned block readback after reload");
    }
    // Persisted owned file survives both worker and engine destruction; original remains exact.
    drop(editor);
    let mut editor = Editor::new(store_root)?;
    let restarted = send(&mut editor, A::Load { id, owned: true })?;
    assert!((value(&restarted, "toneBass") - 0.75).abs() < 1e-5);
    assert!((value(&restarted, "outputLevel") - 0.6).abs() < 1e-5);
    assert_eq!(
        restarted.block_controls.len(),
        committed.block_controls.len()
    );
    for (a, b) in committed
        .block_controls
        .iter()
        .zip(&restarted.block_controls)
    {
        assert_eq!(a.value, b.value, "owned blocks survive process recreation");
    }
    assert_eq!(originals.original(&original.sha256)?, bytes);
    drop(editor);
    let (_, owned_bytes) = oxidal_presets::OwnedStore::new(root.join("editor-library/owned"))
        .read(&restarted.loaded.clone().unwrap())?;
    let render = |payload: &[u8]| -> Result<Vec<f32>, Box<dyn Error>> {
        let mut engine = Engine::new(48000.0, 128)?;
        engine.load_preset(payload)?;
        engine.wait_ready()?;
        settle(&mut engine)?;
        let mut rendered = vec![];
        for block in 0..12 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| (((block * 128 + i) as f32) * 0.01).sin() * 0.1)
                .collect();
            let mut right = left.clone();
            engine.process(&mut left, &mut right)?;
            rendered.extend(left);
            rendered.extend(right);
        }
        Ok(rendered)
    };
    let first = render(&owned_bytes)?;
    let second = render(&owned_bytes)?;
    let error = first
        .iter()
        .zip(second)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    assert!(first.iter().any(|x| x.abs() > 0.001));
    assert!(error < 1e-5, "owned preset recreated audio error {error}");
    println!("owned_preset_recreated_audio_max_error: {error}");
    println!(
        "native_editor: live preview/cancel, five global and five block commits, staged A2 size commit, exact toggles, staged rejection, device scope, owned save/reload/restart and immutable source pass"
    );
    Ok(())
}

fn qualify_factories() -> Result<(), Box<dyn Error>> {
    let Some(root) = std::env::var_os("OXIDAL_TONE3000_FACTORY_DIR") else {
        eprintln!("native factory workflow not run: source corpus not configured");
        return Ok(());
    };
    let files: Vec<_> = std::fs::read_dir(root)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|e| e.path().extension().is_some_and(|e| e == "t3kpreset"))
        .collect();
    assert_eq!(files.len(), 8, "pinned factory corpus");
    let mut split_count = 0;
    for file in files {
        let bytes = std::fs::read(file.path())?;
        let source = oxidal_presets::inspect(&bytes)?;
        let mut engine = Engine::new(48000.0, 128)?;
        engine.load_preset(&bytes)?;
        engine.wait_ready()?;
        let before = engine.catalog()?;
        let blocks = engine.block_controls()?;
        // Unsupported blocks must not gain size controls merely because their
        // metadata/title looks like a NAM. Only the loaded engine supplies support.
        for block in blocks.iter().filter(|p| p.parameter == "mix") {
            if !blocks
                .iter()
                .any(|p| p.block_id == block.block_id && p.parameter == "slimSize")
            {
                assert!(engine.set_block(&block.block_id, "slimSize", 0.75).is_err());
            }
        }
        let saved = engine.save_preset("Owned factory qualification")?;
        assert_ne!(oxidal_presets::inspect(&saved)?.source_id, source.source_id);
        engine.load_preset(&saved)?;
        engine.wait_ready()?;
        let after = engine.catalog()?;
        let restored_blocks = engine.block_controls()?;
        assert_eq!(blocks.len(), restored_blocks.len());
        for (a, b) in blocks.iter().zip(&restored_blocks) {
            assert_eq!(
                (&a.parameter, &a.lane, a.value),
                (&b.parameter, &b.lane, b.value)
            );
        }
        for row in before.as_array().unwrap() {
            let got = after
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == row["id"])
                .unwrap();
            assert!(
                (got["value"].as_f64().unwrap() - row["value"].as_f64().unwrap()).abs() < 1e-5,
                "factory parameter {}",
                row["id"]
            );
        }
        settle(&mut engine)?;
        engine.process(&mut [0.01; 128], &mut [0.01; 128])?;
        assert_eq!(std::fs::read(file.path())?, bytes);
        eprintln!("factory native load/save/reload: {}", source.name);
        let chain = engine.chain()?;
        let tones: Vec<_> = chain["chain"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|b| b["kind"] == "tone")
            .collect();
        if source.name == "Mesa Pitch Shift" {
            assert_eq!(tones.len(), 3);
            assert_eq!(tones[0]["tone"]["gear"], "amp");
            assert_eq!(tones[1]["tone"]["gear"], "cab");
            let original = engine.capture()?;
            assert!(
                engine
                    .split_amp_cab(
                        tones[0]["blockId"].as_str().unwrap(),
                        tones[1]["blockId"].as_str().unwrap(),
                        true,
                        false
                    )
                    .is_err()
            );
            assert_eq!(engine.capture()?, original);
            // Build an explicit owned mono amp/cab test rig; never silently drop extra effects in the split operation.
            engine.remove_block(tones[2]["blockId"].as_str().unwrap())?;
            assert!(engine.remove_block("missing").is_err());
            engine.set_input_mode(oxidal_tone3000::InputMode::Left)?;
            for id in [
                "osEnabled",
                "spreadEnabled",
                "alignEnabled",
                "chainSoloLeft",
                "chainSoloRight",
                "chainInvertLeft",
                "chainInvertRight",
                "pitchEnabled",
                "gateEnabled",
            ] {
                engine.set_normalized(id, 0.0)?;
            }
            engine.set_normalized("inputLevel", 0.5)?;
            engine.set_normalized("outputBalance", 0.5)?;
            engine.set_normalized("chainPanLeft", 0.0)?;
            engine.set_normalized("chainPanRight", 1.0)?;
            let amp = tones[0]["blockId"].as_str().unwrap();
            // The factory cab uses a WAV encoding outside the strict split contract.
            // Keep that rejection, then author a plain mono PCM impulse fixture.
            assert!(
                engine
                    .split_amp_cab(amp, tones[1]["blockId"].as_str().unwrap(), true, false)
                    .is_err()
            );
            engine.remove_block(tones[1]["blockId"].as_str().unwrap())?;
            let ir = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?)
                .join("split-impulse.wav");
            // A short multi-tap IR exercises convolution history as well as the
            // filter placement; this is not just a unity passthrough cabinet.
            let mut wav = impulse_wav();
            wav.truncate(44);
            let samples: [i16; 8] = [24000, -3000, 0, 1200, 0, 0, -700, 500];
            let size = (samples.len() * 2) as u32;
            wav[4..8].copy_from_slice(&(36 + size).to_le_bytes());
            wav[40..44].copy_from_slice(&size.to_le_bytes());
            for sample in samples {
                wav.extend(sample.to_le_bytes());
            }
            std::fs::write(&ir, wav)?;
            let loaded = engine.load_local_model(&ir)?;
            assert!(loaded["error"].is_null(), "IR fixture load: {loaded}");
            engine.wait_ready()?;
            let fixture_chain = engine.chain()?;
            let cab = fixture_chain["chain"]
                .as_array()
                .unwrap()
                .iter()
                .find(|b| b["kind"] == "tone" && b["blockId"] != amp)
                .unwrap()["blockId"]
                .as_str()
                .unwrap();
            qualify_split(&mut engine, amp, cab)?;
            qualify_split_rendered(&mut engine, amp, cab)?;
            // Persist the authored embedded source for the maintained mixed
            // qualifier. The fixture is private generated data, not bundled weights.
            let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?);
            std::fs::write(
                root.join("split-source.t3kpreset"),
                engine.save_preset("Partition source")?,
            )?;

            split_count += 1;
        }
    }
    assert!(
        split_count > 0,
        "At least one real factory amp/cab must qualify"
    );
    println!(
        "native_factory_workflows: 8 passed (state/readiness/finite render; not independent full audio parity)"
    );
    Ok(())
}

fn qualify_split(engine: &mut Engine, amp: &str, cab: &str) -> Result<(), Box<dyn Error>> {
    let source = engine.capture()?;
    assert!(engine.split_amp_cab(amp, cab, false, false).is_err());
    assert!(engine.split_amp_cab(cab, amp, true, false).is_err());
    assert!(engine.split_amp_cab(amp, amp, true, false).is_err());
    assert_eq!(engine.capture()?, source, "Rejected split mutated source");
    let source_parameters = engine.catalog()?;
    let split = engine.split_amp_cab(amp, cab, true, true)?;
    assert_eq!(engine.capture()?, source, "Successful split mutated source");
    assert_eq!(split.pitch["inputMode"], "left");
    assert_eq!(split.pitch["pitchEnabled"], 0.0);
    for (state, id) in [(&split.amp, amp), (&split.cab, cab)] {
        engine.restore(state)?;
        engine.wait_ready()?;
        let parameters = engine.catalog()?;
        for row in parameters.as_array().unwrap() {
            let name = row["id"].as_str().unwrap();
            let keep_input = name == "inputLevel"
                || name.starts_with("gate")
                || name.starts_with("pitch")
                || ["calibrateInput", "inputCalibrationLevel", "targetLoudness"].contains(&name);
            let keep_output = name.starts_with("tone") || name == "outputLevel";
            let forced_off = [
                "osEnabled",
                "osFactor",
                "spreadEnabled",
                "alignEnabled",
                "pitchEnabled",
            ]
            .contains(&name)
                || (id == amp && name == "toneEqEnabled")
                || (id == cab && ["gateEnabled", "calibrateInput"].contains(&name));
            let original = source_parameters
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == row["id"])
                .unwrap();
            let wanted = if forced_off {
                0.0
            } else if (id == amp && keep_input) || (id == cab && keep_output) {
                original["value"].as_f64().unwrap()
            } else {
                row["default"].as_f64().unwrap()
            };
            assert!(
                (row["value"].as_f64().unwrap() - wanted).abs() < 1e-5,
                "Derived control allocation: {id}/{name}"
            );
        }
        let controls = engine.block_controls()?;
        assert!(!controls.is_empty());
        assert!(controls.iter().all(|c| c.block_id == id));
        settle(engine)?;
        let mut left = [0.01; 128];
        let mut right = left;
        engine.process(&mut left, &mut right)?;
        assert!(left.iter().chain(&right).all(|s| s.is_finite()));
    }
    engine.restore(&source)?;
    engine.wait_ready()?;
    assert_eq!(engine.capture()?, source);
    engine.set_normalized("osEnabled", 1.0)?;
    let rejected_source = engine.capture()?;
    assert!(engine.split_amp_cab(amp, cab, true, false).is_err());
    assert_eq!(engine.capture()?, rejected_source);
    engine.restore(&source)?;
    engine.set_normalized("pitchEnabled", 1.0)?;
    let active_pitch = engine.split_amp_cab(amp, cab, true, true)?;
    assert_eq!(active_pitch.pitch["pitchEnabled"], 1.0);
    engine.set_normalized("gateEnabled", 1.0)?;
    assert!(engine.split_amp_cab(amp, cab, true, true).is_err());
    assert!(engine.split_amp_cab(amp, cab, true, false).is_ok());
    engine.restore(&source)?;
    eprintln!(
        "native split: source preservation, independent asset restore, 43-parameter allocation, pitch extraction and rejection guards passed"
    );
    Ok(())
}

// Exercise every advertised global editor capability through owned transactions,
// including serialization and a new engine. This is part of native:check.
fn qualify_editor_scalars(root: &std::path::Path, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    use oxidal_tone3000::{
        editor::Editor,
        protocol::{EditorAction as A, EditorCommand, EditorSnapshot},
    };
    let store_root = root.join("editor-scalars");
    let mut store = oxidal_presets::Store::new(store_root.clone());
    let original = store.import(bytes)?;
    let mut editor = Editor::new(store_root.clone())?;
    let send = |editor: &mut Editor, action: A| -> Result<EditorSnapshot, Box<dyn Error>> {
        let state = editor.snapshot()?;
        Ok(editor.command(EditorCommand {
            session: state.session,
            expected_revision: state.revision,
            request_id: format!("request-{}", state.revision),
            action,
        })?)
    };
    let initial = send(
        &mut editor,
        A::Load {
            id: original.sha256.clone(),
            owned: false,
        },
    )?;
    assert_eq!(
        initial
            .parameters
            .iter()
            .find(|p| p.id == "toneBass")
            .unwrap()
            .label,
        "Bass"
    );
    assert!(
        initial
            .parameters
            .iter()
            .find(|p| p.id == "outputLevel")
            .unwrap()
            .display
            .ends_with(" dB")
    );
    assert!(
        initial
            .parameters
            .iter()
            .find(|p| p.id == "gateHold")
            .unwrap()
            .display
            .ends_with(" ms")
    );
    let editable: Vec<_> = initial.parameters.iter().filter(|p| p.writable).collect();
    assert_eq!(editable.len(), 39);
    assert_eq!(
        initial.parameters.len(),
        43,
        "retain unsupported descriptors"
    );
    for parameter in initial.parameters.iter().filter(|p| !p.writable) {
        assert!(
            send(
                &mut editor,
                A::Begin {
                    owner: "owner".into(),
                    token: format!("unsupported-{}", parameter.id),
                    target: parameter.id.clone()
                }
            )
            .is_err()
        );
    }
    for (index, parameter) in editable.iter().enumerate() {
        let before = editor.snapshot()?;
        let token = format!("cancel-{index}");
        let changed = if parameter.toggle {
            1.0 - parameter.normalized as f32
        } else {
            0.25
        };
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.clone(),
                target: parameter.id.clone(),
            },
        )?;
        if parameter.toggle {
            assert!(
                send(
                    &mut editor,
                    A::Commit {
                        owner: "owner".into(),
                        token: token.clone(),
                        sequence: 1,
                        value: 0.5
                    }
                )
                .is_err()
            );
            let rejected = editor.snapshot()?;
            assert_eq!(rejected.state_captures, before.state_captures);
            assert_eq!(rejected.dirty, before.dirty);
        }
        let preview = send(
            &mut editor,
            A::Preview {
                owner: "owner".into(),
                token: token.clone(),
                sequence: 1,
                value: changed,
            },
        );
        assert_eq!(preview.is_err(), parameter.staged);
        let cancelled = send(
            &mut editor,
            A::Cancel {
                owner: "owner".into(),
                token,
            },
        )?;
        for (a, b) in before.parameters.iter().zip(&cancelled.parameters) {
            assert!(
                (a.value - b.value).abs() < 1e-5,
                "cancel {} must preserve {}",
                parameter.id,
                a.id
            );
        }
        let token = format!("commit-{index}");
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.clone(),
                target: parameter.id.clone(),
            },
        )?;
        let committed = send(
            &mut editor,
            A::Commit {
                owner: "owner".into(),
                token,
                sequence: 1,
                value: changed,
            },
        )?;
        assert_eq!(committed.dirty, before.dirty || parameter.tone);
        assert_eq!(committed.state_captures, before.state_captures + 1);
        // Save after each edit so the next parameter must set dirty independently.
        send(
            &mut editor,
            A::Save {
                name: format!("Scalar {index}"),
            },
        )?;
    }
    let confirmed = editor.snapshot()?;
    let owned = confirmed.loaded.clone().unwrap();
    drop(editor);
    let mut editor = Editor::new(store_root)?;
    let reopened = send(
        &mut editor,
        A::Load {
            id: owned,
            owned: true,
        },
    )?;
    for before in confirmed.parameters.iter().filter(|p| p.writable && p.tone) {
        let after = reopened
            .parameters
            .iter()
            .find(|p| p.id == before.id)
            .unwrap();
        assert!(
            (before.value - after.value).abs() < 1e-5,
            "save/reopen {}",
            before.id
        );
    }
    assert!(
        !reopened.can_undo && !reopened.can_redo,
        "restart starts a new history"
    );
    let block = reopened.block_controls[0].block_id.clone();
    // Structural edits reject stale IDs and active gestures without changing history.
    assert!(
        send(
            &mut editor,
            A::RemoveBlock {
                block_id: "missing".into()
            }
        )
        .is_err()
    );
    send(
        &mut editor,
        A::Begin {
            owner: "owner".into(),
            token: "busy-history".into(),
            target: "toneBass".into(),
        },
    )?;
    assert!(
        send(
            &mut editor,
            A::RemoveBlock {
                block_id: block.clone()
            }
        )
        .is_err()
    );
    assert!(send(&mut editor, A::Undo).is_err());
    send(
        &mut editor,
        A::Cancel {
            owner: "owner".into(),
            token: "busy-history".into(),
        },
    )?;
    let removed = send(
        &mut editor,
        A::RemoveBlock {
            block_id: block.clone(),
        },
    )?;
    assert!(removed.block_controls.is_empty());
    assert!(removed.dirty && removed.can_undo && !removed.can_redo);
    // An old scalar target cannot mutate the new structure.
    assert!(
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: "stale-block".into(),
                target: reopened.block_controls[0].id.clone()
            }
        )
        .is_err()
    );
    let undone = send(&mut editor, A::Undo)?;
    assert_eq!(undone.block_controls[0].block_id, block);
    assert!(!undone.dirty && !undone.can_undo && undone.can_redo);
    for (a, b) in reopened.parameters.iter().zip(&undone.parameters) {
        assert!((a.value - b.value).abs() < 1e-5, "undo preserves {}", a.id);
    }
    let redone = send(&mut editor, A::Redo)?;
    assert!(redone.block_controls.is_empty() && redone.dirty);
    send(&mut editor, A::Undo)?;
    // A new edit abandons the redo branch; history has a bounded retention window.
    for index in 0..10 {
        let token = format!("history-{index}");
        send(
            &mut editor,
            A::Begin {
                owner: "owner".into(),
                token: token.clone(),
                target: "toneMid".into(),
            },
        )?;
        let next = send(
            &mut editor,
            A::Commit {
                owner: "owner".into(),
                token,
                sequence: 1,
                value: index as f32 / 10.0,
            },
        )?;
        assert!(!next.can_redo);
    }
    for _ in 0..8 {
        send(&mut editor, A::Undo)?;
    }
    assert!(send(&mut editor, A::Undo).is_err());
    for _ in 0..8 {
        send(&mut editor, A::Redo)?;
    }
    assert!(send(&mut editor, A::Redo).is_err());
    let saved = send(
        &mut editor,
        A::Save {
            name: "History restored".into(),
        },
    )?;
    assert!(!saved.can_undo && !saved.can_redo && !saved.dirty);
    send(&mut editor, A::RemoveBlock { block_id: block })?;
    let reloaded = send(
        &mut editor,
        A::Load {
            id: saved.loaded.unwrap(),
            owned: true,
        },
    )?;
    assert!(!reloaded.can_undo && !reloaded.can_redo);
    assert!(!reloaded.block_controls.is_empty());
    assert_eq!(store.original(&original.sha256)?, bytes);
    eprintln!("qualify: 39 descriptor-driven globals preview/cancel/commit/save/reopen passed");
    Ok(())
}

fn qualify_model_preparation(root: &std::path::Path, preset: &[u8]) -> Result<(), Box<dyn Error>> {
    fn content(mut state: Value) -> Value {
        // Starting preparation settles a previously pending scalar revision. Only
        // that notification epoch may advance; every chain/settings field must match.
        state.as_object_mut().unwrap().remove("revision");
        state
    }
    let mut engine = Engine::new(48000.0, 128)?;
    engine.load_preset(preset)?;
    engine.wait_ready()?;
    let target = engine.runtime()?["blocks"][0]["blockId"]
        .as_str()
        .ok_or("missing model target")?
        .to_owned();
    let path = root.join("prepared-a2.nam");
    std::fs::copy(std::env::var("OXIDAL_TONE3000_TEST_MODEL")?, &path)?;
    let tone = serde_json::json!({"id":7,"title":"Audition fixture","format":"nam","gear":"amp",
        "models":[{"id":9,"name":"Prepared A2","model_url":"oxidal-model://fixture/model.nam"}]});
    // Reuse this verified fixture in the real browser/worker scenario; no test-only HTTP endpoint.
    let pins: Value = serde_json::from_str(include_str!("../../../native/tone3000/sources.json"))?;
    oxidal_presets::ModelStore::new(root.join("audition-models")).stage(
        &oxidal_presets::ModelAsset {
            schema: 1,
            tone_id: 7,
            model_id: 9,
            title: "Audition fixture".into(),
            name: "Prepared A2".into(),
            format: "nam".into(),
            sha256: pins["qualification_model"]["sha256"]
                .as_str()
                .unwrap()
                .into(),
            tone: tone.clone(),
        },
        &std::fs::read(&path)?,
    )?;
    let before = content(engine.chain()?);
    assert!(
        engine
            .prepare_model("missing-target", &path, &tone)
            .is_err()
    );
    assert_eq!(content(engine.chain()?), before);
    // Failed candidate parsing must not change metadata, loaded state or the selected block.
    let corrupt = root.join("corrupt-a2.nam");
    std::fs::write(&corrupt, b"not a NAM")?;
    engine.prepare_model(&target, &corrupt, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "failed");
    assert_eq!(content(engine.chain()?), before);
    assert_eq!(engine.runtime()?["blocks"][0]["loaded"], true);
    engine.prepare_model(&target, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    assert_eq!(
        content(engine.chain()?),
        before,
        "prepared is not yet audible/committed"
    );
    engine.model_preparation(2)?;
    assert_eq!(
        content(engine.chain()?),
        before,
        "cancel retains exact chain"
    );
    engine.prepare_model(&target, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    engine.set_block(&target, "mix", 0.7)?;
    let changed = content(engine.chain()?);
    assert_eq!(
        engine.model_preparation(0)?["phase"],
        "failed",
        "intervening control edit invalidates prepared snapshot"
    );
    assert_eq!(content(engine.chain()?), changed);
    engine.prepare_model(&target, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    engine.model_preparation(1)?;
    let applied = wait_preparation(&mut engine)?;
    assert_eq!(applied["phase"], "applied", "{applied}");
    assert_eq!(applied["block_id"], target);
    assert_eq!(engine.runtime()?["blocks"][0]["loaded"], true);
    let controls = engine.live_controls()?;
    assert!(controls.iter().any(|c| c.target.contains(&target)
        && c.target.ends_with("mix")
        && (c.value - 0.7).abs() < 1e-5));
    let committed_chain = content(engine.chain()?);
    engine.prepare_model(&target, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    engine.model_preparation(1)?;
    assert_eq!(engine.model_preparation(2)?["phase"], "cancelled");
    assert_eq!(
        content(engine.chain()?),
        committed_chain,
        "cancel during transition retains metadata"
    );
    let insert = committed_chain["chain"]
        .as_array()
        .ok_or("missing chain")?
        .iter()
        .find(|b| b["kind"] == "insert")
        .and_then(|b| b["blockId"].as_str())
        .ok_or("missing insert")?
        .to_owned();
    let count = engine.runtime()?["blocks"].as_array().unwrap().len();
    engine.prepare_model(&insert, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    assert_eq!(engine.runtime()?["blocks"].as_array().unwrap().len(), count);
    engine.model_preparation(1)?;
    let inserted = wait_preparation(&mut engine)?;
    assert_eq!(inserted["phase"], "applied");
    assert_eq!(
        inserted["block_id"], insert,
        "filling a slot retains logical identity"
    );
    assert_eq!(
        engine.runtime()?["blocks"].as_array().unwrap().len(),
        count + 1
    );
    let saved = engine.save_preset("Prepared offline recall")?;
    drop(engine);
    std::fs::remove_file(path)?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.load_preset(&saved)?;
    engine.wait_ready()?;
    assert_eq!(engine.runtime()?["blocks"][0]["blockId"], target);
    assert_eq!(engine.runtime()?["blocks"][0]["loaded"], true);
    assert!(
        engine.runtime()?["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["blockId"] == insert && b["loaded"] == true)
    );
    assert!(serde_json::to_string(&content(engine.chain()?))?.contains("Audition fixture"));
    eprintln!(
        "qualify: model prepare/failure/cancel/stale target/commit/offline embedded recall passed"
    );
    Ok(())
}
fn wait_preparation(engine: &mut Engine) -> Result<Value, Box<dyn Error>> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        engine.process(&mut [0.01; 128], &mut [0.01; 128])?;
        let status = engine.model_preparation(0)?;
        if !matches!(status["phase"].as_str(), Some("preparing" | "applying")) {
            return Ok(status);
        }
        if Instant::now() > deadline {
            return Err("model preparation timeout".into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn qualify_empty_creation(root: &std::path::Path, preset: &[u8]) -> Result<(), Box<dyn Error>> {
    let mut engine = Engine::new(48000.0, 128)?;
    engine.load_preset(preset)?;
    engine.wait_ready()?;
    engine.set_normalized("inputLevel", 0.75)?;
    engine.set_normalized("inputCalibrationLevel", 0.6)?;
    let before = engine.capture()?;
    engine.reset_empty()?;
    assert!(engine.runtime()?["blocks"].as_array().unwrap().is_empty());
    let catalog = engine.catalog()?;
    for row in catalog
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["tone"] == true)
    {
        assert!(
            (row["value"].as_f64().unwrap() - row["default"].as_f64().unwrap()).abs() < 1e-4,
            "preset default: {row}"
        );
    }
    let calibration = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "inputCalibrationLevel")
        .unwrap();
    assert!(
        (calibration["normalized"].as_f64().unwrap() - 0.6).abs() < 1e-5,
        "device calibration remains outside preset reset"
    );
    let chain = engine.chain()?;
    let slots: Vec<_> = chain["chain"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["kind"] == "insert")
        .map(|b| b["blockId"].clone())
        .collect();
    assert!(!slots.is_empty());
    let empty = engine.save_preset("New empty working rig")?;
    let owned = oxidal_presets::OwnedStore::new(root.join("created-library/owned"));
    let created = owned.save_created(&empty)?;
    assert!(
        created.source_sha256.is_none(),
        "new rigs have no imported original"
    );
    let (metadata, bytes) = owned.read(&created.id)?;
    assert!(metadata.source_sha256.is_none());
    assert_eq!(bytes, empty);
    engine.restore(&before)?;
    engine.wait_ready()?;
    assert!(
        !engine.runtime()?["blocks"].as_array().unwrap().is_empty(),
        "caller can restore its previous session"
    );
    drop(engine);
    let mut engine = Engine::new(48000.0, 128)?;
    engine.load_preset(&empty)?;
    engine.wait_ready()?;
    assert!(engine.runtime()?["blocks"].as_array().unwrap().is_empty());
    let recalled = engine.chain()?;
    let recalled_slots: Vec<_> = recalled["chain"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["kind"] == "insert")
        .map(|b| b["blockId"].clone())
        .collect();
    assert_eq!(
        slots, recalled_slots,
        "empty working base retains exact insertion targets across native save/reload"
    );
    drop(engine);
    let mut editor = oxidal_tone3000::editor::Editor::new(root.join("created-library"))?;
    for (index, action) in [
        oxidal_tone3000::protocol::EditorAction::Load {
            id: created.id,
            owned: true,
        },
        oxidal_tone3000::protocol::EditorAction::Save {
            name: "Created copy again".into(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let state = editor.snapshot()?;
        let next = editor.command(oxidal_tone3000::protocol::EditorCommand {
            session: state.session,
            expected_revision: state.revision,
            request_id: format!("created-{index}"),
            action,
        })?;
        assert!(next.source_sha256.is_none());
    }
    assert_eq!(owned.list()?.len(), 2);
    assert!(
        owned
            .list()?
            .iter()
            .all(|copy| copy.source_sha256.is_none())
    );
    eprintln!(
        "qualify: empty native creation, defaults/device scope, previous-state recovery, insert identity recall and created-copy provenance passed"
    );
    Ok(())
}

fn impulse_wav() -> Vec<u8> {
    let mut wav = Vec::from(&b"RIFF"[..]);
    wav.extend(38u32.to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(48000u32.to_le_bytes());
    wav.extend(96000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(2u32.to_le_bytes());
    wav.extend(32767i16.to_le_bytes());
    wav
}

fn qualify_ir_preparation(root: &std::path::Path) -> Result<(), Box<dyn Error>> {
    use sha2::{Digest, Sha256};
    let bytes = impulse_wav();
    let path = root.join("prepared-ir.wav");
    std::fs::write(&path, &bytes)?;
    let tone = serde_json::json!({"id":17,"title":"IR audition fixture","format":"ir","gear":"cab",
        "models":[{"id":19,"name":"Prepared IR","model_url":"oxidal-model://fixture/model.wav"}]});
    oxidal_presets::ModelStore::new(root.join("audition-models")).stage(
        &oxidal_presets::ModelAsset {
            schema: 1,
            tone_id: 17,
            model_id: 19,
            title: "IR audition fixture".into(),
            name: "Prepared IR".into(),
            format: "ir".into(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            tone: tone.clone(),
        },
        &bytes,
    )?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.reset_empty()?;
    let target = engine.slots()?[0].target.clone();
    engine.prepare_model(&target, &path, &tone)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "ready");
    assert_eq!(engine.runtime()?["blocks"].as_array().unwrap().len(), 0);
    engine.model_preparation(1)?;
    assert_eq!(wait_preparation(&mut engine)?["phase"], "applied");
    assert_eq!(engine.runtime()?["blocks"][0]["blockId"], target);
    assert_eq!(engine.runtime()?["blocks"][0]["loaded"], true);
    engine.set_normalized("gateEnabled", 0.0)?;
    let saved = engine.save_preset("IR embedded recall")?;
    fn render(engine: &mut Engine) -> Result<Vec<f32>, Box<dyn Error>> {
        settle(engine)?;
        let mut result = vec![];
        for block in 0..12 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| (((block * 128 + i) as f32) * 0.07).sin() * 0.05)
                .collect();
            let mut right = left.clone();
            engine.process(&mut left, &mut right)?;
            result.extend(left);
        }
        Ok(result)
    }
    let before = render(&mut engine)?;
    assert!(before.iter().any(|s| s.abs() > 0.001));
    drop(engine);
    std::fs::remove_file(path)?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.load_preset(&saved)?;
    engine.wait_ready()?;
    assert_eq!(engine.runtime()?["blocks"][0]["loaded"], true);
    let after = render(&mut engine)?;
    let error = before
        .iter()
        .zip(after)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    assert!(
        error < 1e-5,
        "IR embedded rendered restore differs: {error}"
    );
    eprintln!("qualify: IR preparation/insertion/rendered embedded recall passed");
    Ok(())
}

fn qualify_engine_isolation(preset: &[u8]) -> Result<(), Box<dyn Error>> {
    fn prepared(preset: &[u8], rate: f64) -> Result<Engine, Box<dyn Error>> {
        let mut engine = Engine::new(rate, 128)?;
        engine.load_preset(preset)?;
        engine.wait_ready()?;
        engine.set_normalized("gateEnabled", 0.0)?;
        engine.set_normalized("inputLevel", 0.5)?;
        engine.set_normalized("outputLevel", 0.5)?;
        settle(&mut engine)?;
        Ok(engine)
    }
    fn block(engine: &mut Engine, index: usize) -> Result<Vec<f32>, Box<dyn Error>> {
        let mut left: Vec<f32> = (0..128)
            .map(|i| ((index * 128 + i) as f32 * 0.031).sin() * 0.03)
            .collect();
        let mut right = left.clone();
        engine.process(&mut left, &mut right)?;
        left.extend(right);
        Ok(left)
    }
    let staging_root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?)
        .join("adapter-presets");
    let staging_count = || -> Result<usize, Box<dyn Error>> {
        Ok(std::fs::read_dir(&staging_root)?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .filter(|entry| entry.path().is_dir())
            .count())
    };
    let before_staging = staging_count()?;
    let mut reference = prepared(preset, 48000.0)?;
    let mut expected = Vec::new();
    for i in 0..16 {
        expected.extend(block(&mut reference, i)?);
    }
    drop(reference);
    assert_eq!(staging_count()?, before_staging);
    let mut first = prepared(preset, 48000.0)?;
    let baseline = serde_json::to_value(first.live_controls()?)?;
    let mut second = prepared(preset, 44100.0)?;
    assert_eq!(
        staging_count()?,
        before_staging + 2,
        "each engine needs its own preset staging root"
    );
    second.set_normalized("outputLevel", 0.2)?;
    settle(&mut second)?;
    assert_eq!(
        serde_json::to_value(first.live_controls()?)?,
        baseline,
        "second settings changed first controls"
    );
    let mut actual = Vec::new();
    let mut different = Vec::new();
    for i in 0..16 {
        actual.extend(block(&mut first, i)?);
        different.extend(block(&mut second, i)?);
    }
    let error = expected
        .iter()
        .zip(&actual)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    assert!(
        error < 1e-5,
        "coexisting instance changed rendered output: {error}"
    );
    assert!(
        actual
            .iter()
            .zip(&different)
            .any(|(a, b)| (a - b).abs() > 1e-4),
        "different instance output controls had no effect"
    );
    // Destroying either instance must leave its peer and a later instance usable.
    drop(first);
    assert_eq!(staging_count()?, before_staging + 1);
    let second_before = serde_json::to_value(second.live_controls()?)?;
    let mut third = prepared(preset, 48000.0)?;
    assert_eq!(
        serde_json::to_value(second.live_controls()?)?,
        second_before
    );
    drop(second);
    assert_eq!(staging_count()?, before_staging + 1);
    assert!(block(&mut third, 0)?.iter().all(|s| s.is_finite()));
    assert!(!third.runtime()?["blocks"].as_array().unwrap().is_empty());
    drop(third);
    assert_eq!(staging_count()?, before_staging);
    eprintln!("qualify: coexisting engine isolation, rendered parity and peer destruction passed");
    Ok(())
}

// Compare the complete native chain with the paired host roles. A deliberately
// naive pair is a negative control: the test must detect its extra DC blocker.
fn qualify_split_rendered(
    source: &mut Engine,
    amp_id: &str,
    cab_id: &str,
) -> Result<(), Box<dyn Error>> {
    let original = source.capture()?;
    for (rate, frames, alternate) in [(48000.0, 128, false), (48000.0, 64, true)] {
        source.restore(&original)?;
        source.wait_ready()?;
        if alternate {
            source.set_input_mode(oxidal_tone3000::InputMode::Right)?;
            source.set_normalized("inputLevel", 0.57)?;
            source.set_normalized("outputLevel", 0.43)?;
            source.set_normalized("toneEqEnabled", 1.0)?;
            source.set_normalized("toneBass", 0.65)?;
            source.set_normalized("toneMid", 0.35)?;
            source.set_normalized("toneTreble", 0.6)?;
        }
        let state = source.capture()?;
        let split = source.split_amp_cab(amp_id, cab_id, true, false)?;
        for unsupported in [44100.0, 96000.0] {
            assert!(
                split.prepare(unsupported, frames).is_err(),
                "reject duplicated resampling"
            );
        }
        let mut whole = Engine::new(rate, frames)?;
        whole.restore(&state)?;
        whole.wait_ready()?;
        let (mut amp, mut cab) = split.prepare(rate, frames)?;
        let mut naive_amp = Engine::new(rate, frames)?;
        naive_amp.restore(&split.amp)?;
        naive_amp.wait_ready()?;
        let mut naive_cab = Engine::new(rate, frames)?;
        naive_cab.restore(&split.cab)?;
        naive_cab.wait_ready()?;
        let mut max_error = 0.0_f32;
        let mut naive_error = 0.0_f32;
        let mut peak = 0.0_f32;
        for block in 0..700 {
            for e in [
                &mut whole,
                &mut amp,
                &mut cab,
                &mut naive_amp,
                &mut naive_cab,
            ] {
                e.pump()?;
            }
            let mut left: Vec<f32> = (0..frames)
                .map(|i| {
                    if block < 400 {
                        0.0
                    } else {
                        let t = ((block - 400) * frames + i) as f32 / rate as f32;
                        0.02 + 0.04 * (t * std::f32::consts::TAU * 73.0).sin()
                    }
                })
                .collect();
            let mut right: Vec<f32> = left.iter().map(|s| s * -0.7).collect();
            let (mut a, mut b) = (left.clone(), right.clone());
            let (mut n, mut m) = (left.clone(), right.clone());
            whole.process(&mut left, &mut right)?;
            amp.process(&mut a, &mut b)?;
            cab.process(&mut a, &mut b)?;
            naive_amp.process(&mut n, &mut m)?;
            naive_cab.process(&mut n, &mut m)?;
            if block >= 400 {
                for ((expected, actual), naive) in left
                    .iter()
                    .chain(&right)
                    .zip(a.iter().chain(&b))
                    .zip(n.iter().chain(&m))
                {
                    assert!(expected.is_finite() && actual.is_finite() && naive.is_finite());
                    max_error = max_error.max((expected - actual).abs());
                    naive_error = naive_error.max((expected - naive).abs());
                    peak = peak.max(expected.abs());
                }
            }
        }
        assert!(peak > 1e-4, "split parity must render audible test signal");
        assert!(
            max_error < 1e-5,
            "split rendered mismatch {rate}/{frames}: {max_error}"
        );
        assert!(
            naive_error > 1e-4,
            "negative control failed to detect duplicated DC filter: {naive_error}"
        );
        eprintln!(
            "native split rendered: rate={rate} frames={frames} max_error={max_error} naive_error={naive_error}"
        );
    }
    source.restore(&original)?;
    source.wait_ready()?;
    Ok(())
}

// Functional structural authoring coverage stays in the maintained native qualifier.
fn qualify_editor_structure(root: &std::path::Path, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    use oxidal_tone3000::{
        editor::Editor,
        protocol::{
            ChainLane as L, EditorAction as A, EditorCommand, EditorSnapshot, StructureEdit as S,
        },
    };
    let directory = root.join("editor-structure");
    let mut store = oxidal_presets::Store::new(directory.clone());
    let original = store.import(bytes)?;
    let mut editor = Editor::new(directory.clone())?;
    let send = |editor: &mut Editor, action: A| -> Result<EditorSnapshot, Box<dyn Error>> {
        let state = editor.snapshot()?;
        Ok(editor.command(EditorCommand {
            session: state.session,
            expected_revision: state.revision,
            request_id: format!("structure-{}", state.revision),
            action,
        })?)
    };
    let loaded = send(
        &mut editor,
        A::Load {
            id: original.sha256.clone(),
            owned: false,
        },
    )?;
    let source = loaded
        .layout
        .left
        .iter()
        .find(|b| !b.insert)
        .unwrap()
        .id
        .clone();
    // Missing, duplicated, incomplete and wrong-lane orders cannot mutate state/history.
    let mut repeated: Vec<_> = loaded.layout.left.iter().map(|b| b.id.clone()).collect();
    repeated[1] = repeated[0].clone();
    for edit in [
        S::Reorder {
            lane: L::Left,
            block_ids: vec!["missing".into()],
        },
        S::Reorder {
            lane: L::Left,
            block_ids: repeated,
        },
        S::Move {
            block_id: source.clone(),
            lane: L::Right,
            index: 0,
        },
        S::Duplicate {
            block_id: "missing".into(),
            lane: L::Left,
            index: 0,
        },
        S::Duplicate {
            block_id: source.clone(),
            lane: L::Left,
            index: usize::MAX,
        },
        S::Duplicate {
            block_id: loaded
                .layout
                .left
                .iter()
                .find(|b| b.insert)
                .unwrap()
                .id
                .clone(),
            lane: L::Left,
            index: 0,
        },
    ] {
        assert!(send(&mut editor, A::Structure { edit }).is_err());
        let unchanged = editor.snapshot()?;
        assert_eq!(unchanged.layout, loaded.layout);
        assert_eq!(unchanged.revision, loaded.revision);
        assert_eq!(unchanged.state_captures, loaded.state_captures);
        assert!(!unchanged.can_undo && !unchanged.dirty);
    }
    send(
        &mut editor,
        A::Begin {
            owner: "structure-owner".into(),
            token: "structure-busy".into(),
            target: "toneBass".into(),
        },
    )?;
    assert!(
        send(
            &mut editor,
            A::Structure {
                edit: S::Stereo { enabled: true }
            }
        )
        .is_err()
    );
    send(
        &mut editor,
        A::Cancel {
            owner: "structure-owner".into(),
            token: "structure-busy".into(),
        },
    )?;
    let before_duplicate = editor.snapshot()?;
    let duplicate_command = EditorCommand {
        session: before_duplicate.session,
        expected_revision: before_duplicate.revision,
        request_id: "duplicate-receipt".into(),
        action: A::Structure {
            edit: S::Duplicate {
                block_id: source.clone(),
                lane: L::Left,
                index: 0,
            },
        },
    };
    let duplicated = editor.command(duplicate_command.clone())?;
    let repeated_reply = editor.command(duplicate_command.clone())?;
    assert_eq!(
        repeated_reply.layout, duplicated.layout,
        "lost reply must not duplicate twice"
    );
    assert_eq!(repeated_reply.revision, duplicated.revision);
    assert_eq!(repeated_reply.state_captures, duplicated.state_captures);
    let mut stale = duplicate_command;
    stale.request_id = "stale-structure".into();
    assert!(editor.command(stale).is_err());
    assert_eq!(editor.snapshot()?.layout, duplicated.layout);
    assert!(duplicated.dirty && duplicated.can_undo);
    let clone = duplicated
        .layout
        .left
        .iter()
        .find(|b| !b.insert && b.id != source)
        .unwrap()
        .id
        .clone();
    for control in loaded
        .block_controls
        .iter()
        .filter(|c| c.block_id == source)
    {
        let copy = duplicated
            .block_controls
            .iter()
            .find(|c| c.block_id == clone && c.parameter == control.parameter)
            .unwrap();
        assert_eq!(
            control.value, copy.value,
            "duplicate preserves {}",
            control.parameter
        );
    }
    let order: Vec<_> = duplicated
        .layout
        .left
        .iter()
        .rev()
        .map(|b| b.id.clone())
        .collect();
    let reordered = send(
        &mut editor,
        A::Structure {
            edit: S::Reorder {
                lane: L::Left,
                block_ids: order.clone(),
            },
        },
    )?;
    assert_eq!(
        reordered
            .layout
            .left
            .iter()
            .map(|b| b.id.clone())
            .collect::<Vec<_>>(),
        order
    );
    let stereo = send(
        &mut editor,
        A::Structure {
            edit: S::Stereo { enabled: true },
        },
    )?;
    assert!(stereo.layout.stereo && !stereo.layout.right.is_empty());
    let moved = send(
        &mut editor,
        A::Structure {
            edit: S::Move {
                block_id: clone.clone(),
                lane: L::Right,
                index: 0,
            },
        },
    )?;
    assert!(!moved.layout.left.iter().any(|b| b.id == clone));
    assert_eq!(moved.layout.right[0].id, clone);
    assert_eq!(send(&mut editor, A::Undo)?.layout, stereo.layout);
    assert_eq!(send(&mut editor, A::Redo)?.layout, moved.layout);
    // Saved structural state must survive an independent owner without network/cache lookup.
    let saved = send(
        &mut editor,
        A::Save {
            name: "Structured native draft".into(),
        },
    )?;
    drop(editor);
    let saved_id = saved.loaded.clone().unwrap();
    let (_, saved_bytes) =
        oxidal_presets::OwnedStore::new(directory.join("owned")).read(&saved_id)?;
    let mut editor = Editor::new(directory)?;
    let reopened = send(
        &mut editor,
        A::Load {
            id: saved.loaded.unwrap(),
            owned: true,
        },
    )?;
    assert_eq!(reopened.layout, moved.layout);
    assert!(!reopened.dirty && !reopened.can_undo);
    for control in &moved.block_controls {
        let recalled = reopened
            .block_controls
            .iter()
            .find(|c| c.block_id == control.block_id && c.parameter == control.parameter)
            .unwrap();
        assert_eq!(control.value, recalled.value);
    }
    // Recalled parallel lanes must contain both loaded models and produce deterministic PCM.
    let mut renders = vec![];
    for _ in 0..2 {
        let mut engine = Engine::new(48000.0, 128)?;
        engine.load_preset(&saved_bytes)?;
        engine.wait_ready()?;
        let identities = oxidal_tone3000::model_preparation::identities(&mut engine)?;
        assert_eq!(identities.len(), 2);
        assert_eq!(identities[0]["tone"], identities[1]["tone"]);
        assert_eq!(identities[0]["model"], identities[1]["model"]);
        engine.prepare_stream()?;
        let mut samples = vec![];
        for _ in 0..32 {
            let mut left = [0.03; 128];
            let mut right = [0.02; 128];
            engine.process(&mut left, &mut right)?;
            samples.extend(left.into_iter().zip(right));
        }
        assert!(samples.iter().all(|(l, r)| l.is_finite() && r.is_finite()));
        assert!(
            samples
                .iter()
                .any(|(l, r)| l.abs() > 1e-7 || r.abs() > 1e-7)
        );
        renders.push(samples);
    }
    let error = renders[0]
        .iter()
        .zip(&renders[1])
        .flat_map(|((a, b), (c, d))| [(a - c).abs(), (b - d).abs()])
        .fold(0.0_f32, f32::max);
    assert!(error < 1e-5, "structural Save/reopen PCM error {error}");
    assert_eq!(store.original(&original.sha256)?, bytes);
    eprintln!(
        "qualify: native duplicate/reorder/stereo/lane move, rejection atomicity, undo/redo and independent Save/reopen passed"
    );
    Ok(())
}

fn qualify_image_authoring() -> Result<(), Box<dyn Error>> {
    fn render(engine: &mut Engine) -> Result<Vec<[f32; 2]>, Box<dyn Error>> {
        engine.prepare_stream()?;
        settle(engine)?;
        let mut result = vec![];
        for chunk in 0..64 {
            let mut left: Vec<f32> = (0..128)
                .map(|i| ((chunk * 128 + i) as f32 * 0.071).sin() * 0.03)
                .collect();
            let mut right: Vec<f32> = (0..128)
                .map(|i| ((chunk * 128 + i) as f32 * 0.113).sin() * 0.02)
                .collect();
            engine.process(&mut left, &mut right)?;
            result.extend(left.into_iter().zip(right).map(|(l, r)| [l, r]));
        }
        Ok(result)
    }
    let mut engine = Engine::new(48000.0, 128)?;
    engine.set_input_mode(oxidal_tone3000::InputMode::Stereo)?;
    engine.edit_structure(&oxidal_tone3000::protocol::StructureEdit::Stereo { enabled: true })?;
    engine.wait_ready()?;
    for id in [
        "gateEnabled",
        "toneEqEnabled",
        "spreadEnabled",
        "alignEnabled",
        "alignWobbleEnabled",
        "alignCrossoverEnabled",
        "alignDiffuseEnabled",
        "chainPanLinked",
        "chainInvertLeft",
        "chainInvertRight",
    ] {
        engine.set_normalized(id, 0.0)?;
    }
    engine.set_live_control("chainPanLeft", 0.0)?;
    engine.set_live_control("chainPanRight", 1.0)?;
    let baseline = render(&mut engine)?;
    let latency = engine.latency_samples()?;
    engine.set_live_control("chainPanLeft", 1.0)?;
    engine.set_live_control("chainPanRight", 0.0)?;
    let swapped = render(&mut engine)?;
    let error = baseline
        .iter()
        .zip(&swapped)
        .flat_map(|(a, b)| [(a[0] - b[1]).abs(), (a[1] - b[0]).abs()])
        .fold(0.0_f32, f32::max);
    assert!(error < 1e-5, "pan lane swap PCM error {error}");
    engine.set_live_control("chainPanLeft", 0.0)?;
    engine.set_live_control("chainPanRight", 1.0)?;
    engine.set_live_control("chainInvertLeft", 1.0)?;
    let inverted = render(&mut engine)?;
    let error = baseline
        .iter()
        .zip(&inverted)
        .flat_map(|(a, b)| [(a[0] + b[0]).abs(), (a[1] - b[1]).abs()])
        .fold(0.0_f32, f32::max);
    assert!(error < 1e-5, "polarity PCM error {error}");
    engine.set_live_control("chainInvertLeft", 0.0)?;
    engine.set_live_control("alignEnabled", 1.0)?;
    engine.set_live_control("alignOffset", 0.8)?;
    let aligned = render(&mut engine)?;
    assert!(
        baseline
            .iter()
            .zip(&aligned)
            .map(|(a, b)| (a[0] - b[0]).abs() + (a[1] - b[1]).abs())
            .sum::<f32>()
            > 1.0,
        "alignment must change actual PCM"
    );
    assert_eq!(engine.latency_samples()?, latency);
    engine.set_live_control("chainPanLinked", 1.0)?;
    engine.set_live_control("chainPanLeft", 0.2)?;
    let controls = engine.live_controls()?;
    assert!(
        (controls
            .iter()
            .find(|c| c.target == "chainPanRight")
            .unwrap()
            .value
            - 0.8)
            .abs()
            < 1e-5
    );
    let bytes = engine.save_preset("Live image authoring")?;
    let mut restored = Engine::new(48000.0, 128)?;
    restored.load_preset(&bytes)?;
    restored.wait_ready()?;
    for expected in controls
        .iter()
        .filter(|c| c.target.starts_with("align") || c.target.starts_with("chain"))
    {
        let actual = restored
            .live_controls()?
            .into_iter()
            .find(|c| c.target == expected.target)
            .unwrap();
        assert_eq!(actual.value, expected.value);
    }
    assert_eq!(restored.latency_samples()?, latency);
    eprintln!(
        "qualify: live stereo pans/linking/polarity/alignment PCM, stable latency and saved recall passed"
    );
    Ok(())
}

// Source-led utility behavior: actual native PCM, not simulated meter/tuner values.
fn qualify_utilities() -> Result<(), Box<dyn Error>> {
    use oxidal_audio::{
        structure::{AuthoringAction as A, StructureEdit as E},
        tools::{Command as C, Phase},
    };
    use oxidal_tone3000::working::Authoring;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?).join(format!(
        "utility-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir_all(&root)?;
    let read = |engine: &mut Engine, id: &str| -> Result<f64, Box<dyn Error>> {
        Ok(engine
            .catalog()?
            .as_array()
            .ok_or("Missing descriptors")?
            .iter()
            .find(|r| r["id"] == id)
            .ok_or("Missing descriptor")?["normalized"]
            .as_f64()
            .ok_or("Invalid scalar")?)
    };
    // Solo is temporary monitoring: actual PCM/readback, no tone edit/history,
    // exclusive lanes, and no persistence in a portable preset.
    {
        use oxidal_audio::tools::Solo;
        let mut engine = Engine::new(48000.0, 128)?;
        engine.reset_empty()?;
        let mut owner = Authoring::for_source(&root, "solo-monitoring".into(), None);
        assert!(
            owner
                .command(
                    &mut engine,
                    A::Utility {
                        command: C::Solo { side: Solo::Left }
                    }
                )
                .is_err()
        );
        owner.command(
            &mut engine,
            A::Edit {
                edit: E::Stereo { enabled: true },
            },
        )?;
        engine.set_input_mode(oxidal_tone3000::InputMode::Stereo)?;
        for (id, value) in [
            ("gateEnabled", 0.0),
            ("toneEqEnabled", 0.0),
            ("inputLevel", 0.5),
            ("outputLevel", 0.5),
            ("chainPanLinked", 0.0),
            ("chainPanLeft", 0.0),
            ("chainPanRight", 1.0),
            ("outputBalance", 0.5),
        ] {
            engine.set_normalized(id, value)?;
        }
        let before = owner.snapshot(&mut engine)?;
        for side in [Solo::Left, Solo::Right, Solo::None] {
            let status = owner.command(
                &mut engine,
                A::Utility {
                    command: C::Solo { side },
                },
            )?;
            assert_eq!(status.tools.solo, side);
            assert_eq!(status.working, before.working);
            assert_eq!(status.can_undo, before.can_undo);
            assert_eq!(status.can_redo, before.can_redo);
            assert_eq!(
                read(&mut engine, "chainSoloLeft")? > 0.5,
                side == Solo::Left
            );
            assert_eq!(
                read(&mut engine, "chainSoloRight")? > 0.5,
                side == Solo::Right
            );
            let (mut l, mut r) = ([0.17; 128], [-0.11; 128]);
            for block in 0..64 {
                for i in 0..128 {
                    let phase = std::f32::consts::TAU * 220.0 * (block * 128 + i) as f32 / 48000.0;
                    l[i] = phase.sin() * 0.17;
                    r[i] = phase.sin() * -0.11;
                }
                engine.process(&mut l, &mut r)?;
            }
            let energy = |samples: &[f32]| samples.iter().map(|x| x * x).sum::<f32>();
            assert_eq!(
                energy(&l) > 0.0001,
                side != Solo::Right,
                "left PCM {side:?}"
            );
            assert_eq!(
                energy(&r) > 0.0001,
                side != Solo::Left,
                "right PCM {side:?}"
            );
        }
        owner.command(
            &mut engine,
            A::Utility {
                command: C::Solo { side: Solo::Left },
            },
        )?;
        assert!(
            owner
                .command(
                    &mut engine,
                    A::Utility {
                        command: C::Balance
                    }
                )
                .is_err()
        );
        assert!(
            owner
                .command(&mut engine, A::Utility { command: C::Align })
                .is_err()
        );
        let saved = engine.save_preset("Monitoring excluded")?;
        let mut fresh = Engine::new(48000.0, 128)?;
        fresh.load_preset(&saved)?;
        fresh.wait_ready()?;
        assert_eq!(read(&mut fresh, "chainSoloLeft")?, 0.0);
        assert_eq!(read(&mut fresh, "chainSoloRight")?, 0.0);
        owner.command(&mut engine, A::Undo)?;
        assert!(!engine.layout()?.stereo);
        assert_eq!(owner.snapshot(&mut engine)?.tools.solo, Solo::None);
        owner.command(&mut engine, A::Redo)?;
        assert_eq!(owner.snapshot(&mut engine)?.tools.solo, Solo::None);
        eprintln!(
            "native solo: exclusive stereo PCM, readback, mono rejection, unchanged tone history, matching guards, portable Save exclusion and structural undo passed"
        );
    }
    for rate in [44100.0, 48000.0, 96000.0] {
        let mut engine = Engine::new(rate, 128)?;
        engine.reset_empty()?;
        engine.set_normalized("gateEnabled", 0.0)?;
        let source = format!("utilities:{rate}");
        let mut owner = Authoring::for_source(&root, source.clone(), None);
        let send = |owner: &mut Authoring, engine: &mut Engine, command: C| {
            owner.command(engine, A::Utility { command })
        };
        assert!(!owner.snapshot(&mut engine)?.tools.active());
        send(&mut owner, &mut engine, C::Tuner { enabled: true })?;
        // Detector reads pre-gain/pre-gate input even with input trim fully down.
        engine.set_normalized("inputLevel", 0.0)?;
        for chunk in 0..160 {
            let mut l = [0.0; 128];
            for (i, x) in l.iter_mut().enumerate() {
                *x = (std::f64::consts::TAU * 220.0 * (chunk * 128 + i) as f64 / rate).sin() as f32
                    * 0.1;
            }
            let mut r = l;
            engine.process(&mut l, &mut r)?;
        }
        let tuned = send(&mut owner, &mut engine, C::Poll)?;
        let reading = tuned.tools.tuner.unwrap();
        assert!(
            (reading.frequency - 220.0).abs() < 1.5 && reading.confidence > 0.7,
            "tuner at {rate}: {reading:?}"
        );
        assert!(
            tuned.working.is_none() && !tuned.can_undo,
            "Tuner must not dirty or capture a tone"
        );
        send(&mut owner, &mut engine, C::Tuner { enabled: false })?;
        assert!(owner.snapshot(&mut engine)?.tools.tuner.is_none());
        engine.set_normalized("inputLevel", 0.5)?;
        owner.command(
            &mut engine,
            A::Edit {
                edit: E::Stereo { enabled: true },
            },
        )?;
        engine.set_normalized("outputBalance", 0.5)?;
        send(&mut owner, &mut engine, C::Balance)?;
        assert!(
            owner
                .command(&mut engine, A::Edit { edit: E::Reset })
                .is_err()
        );
        let blocks = (rate * 2.2 / 128.0).ceil() as usize;
        for chunk in 0..blocks {
            let mut l = [0.0; 128];
            let mut r = l;
            for i in 0..128 {
                l[i] = (std::f64::consts::TAU * 220.0 * (chunk * 128 + i) as f64 / rate).sin()
                    as f32
                    * 0.1;
                r[i] = l[i] * 0.5;
            }
            engine.process(&mut l, &mut r)?;
        }
        let matched = send(&mut owner, &mut engine, C::Poll)?;
        assert_eq!(matched.tools.balance.state, Phase::Done);
        assert!(
            (matched.tools.balance.matched_db.unwrap().abs() - 6.0206).abs() < 0.08,
            "{matched:?}"
        );
        let balance = read(&mut engine, "outputBalance")?;
        assert!((balance - (0.5 + 6.0206 / 48.0)).abs() < 0.002);
        let receipt = matched.working.unwrap();
        let captured = oxidal_tone3000::working::read(&root, &receipt, &source)?;
        let mut recalled = Engine::new(rate, 128)?;
        recalled.restore(&captured)?;
        recalled.wait_ready()?;
        assert!((read(&mut recalled, "outputBalance")? - balance).abs() < 1e-6);
        let exported = engine.save_preset("Matched levels")?;
        let mut fresh = Engine::new(rate, 128)?;
        fresh.load_preset(&exported)?;
        fresh.wait_ready()?;
        assert!((read(&mut fresh, "outputBalance")? - balance).abs() < 1e-6);
        owner.command(&mut engine, A::Undo)?;
        assert!((read(&mut engine, "outputBalance")? - 0.5).abs() < 1e-6);
        assert_eq!(
            owner.snapshot(&mut engine)?.tools.balance.state,
            Phase::Idle
        );
        let working = owner.working_receipt().map(str::to_owned);
        send(&mut owner, &mut engine, C::Balance)?;
        send(&mut owner, &mut engine, C::Cancel)?;
        assert!(!owner.measurement_pending());
        assert_eq!(owner.working_receipt(), working.as_deref());
        send(&mut owner, &mut engine, C::Align)?;
        for _ in 0..(rate * 1.0 / 128.0).ceil() as usize {
            engine.process(&mut [0.0; 128], &mut [0.0; 128])?;
        }
        let aligned = send(&mut owner, &mut engine, C::Poll)?;
        assert_eq!(
            aligned.tools.alignment.state,
            Phase::Done,
            "alignment at {rate}: {aligned:?}"
        );
        assert!(
            aligned.tools.alignment.matched_ms.unwrap().abs() < 0.08,
            "{aligned:?}"
        );
        send(&mut owner, &mut engine, C::Align)?;
        send(&mut owner, &mut engine, C::Cancel)?;
        assert!(!owner.measurement_pending());
        send(&mut owner, &mut engine, C::Balance)?;
        for _ in 0..(rate * 15.2 / 128.0).ceil() as usize {
            engine.process(&mut [0.0; 128], &mut [0.0; 128])?;
        }
        assert_eq!(
            send(&mut owner, &mut engine, C::Poll)?.tools.balance.state,
            Phase::Timeout
        );
        eprintln!(
            "native utilities: {rate} Hz actual tuner, energy match, alignment, cancel/timeout, undo, working recall and independent preset Save passed"
        );
    }
    // The same alignment path must work with real nonlinear NAM processors, not only dry lanes.
    let preset = std::fs::read(
        std::path::Path::new(&std::env::var("OXIDAL_QUALIFICATION_DATA")?)
            .join("a2-preset.t3kpreset"),
    )?;
    let mut modelled = Engine::new(48000.0, 128)?;
    modelled.load_preset(&preset)?;
    modelled.wait_ready()?;
    modelled.set_normalized("gateEnabled", 0.0)?;
    let block = modelled
        .layout()?
        .left
        .iter()
        .find(|b| !b.insert)
        .unwrap()
        .id
        .clone();
    let mut paired = Authoring::for_source(&root, "a2-alignment".into(), None);
    paired.command(
        &mut modelled,
        A::Edit {
            edit: E::Stereo { enabled: true },
        },
    )?;
    paired.command(
        &mut modelled,
        A::Edit {
            edit: E::Duplicate {
                block_id: block,
                lane: oxidal_audio::structure::ChainLane::Right,
                index: 0,
            },
        },
    )?;
    let delay = modelled.latency_samples()?;
    paired.command(&mut modelled, A::Utility { command: C::Align })?;
    for _ in 0..1000 {
        modelled.process(&mut [0.0; 128], &mut [0.0; 128])?;
    }
    let aligned = paired.command(&mut modelled, A::Utility { command: C::Poll })?;
    assert_eq!(aligned.tools.alignment.state, Phase::Done, "{aligned:?}");
    assert!(
        aligned.tools.alignment.matched_ms.unwrap().abs() < 0.08,
        "{aligned:?}"
    );
    assert_eq!(modelled.latency_samples()?, delay);
    eprintln!(
        "native utilities: real paired A2 NAM alignment and constant reported latency passed"
    );
    // Failed durable capture must roll back an automatically applied scalar result.
    let bad = root.join("storage-failure");
    std::fs::create_dir_all(&bad)?;
    std::fs::write(bad.join("native-checkpoints"), b"blocked")?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.reset_empty()?;
    engine.set_normalized("gateEnabled", 0.0)?;
    engine.edit_structure(&E::Stereo { enabled: true })?;
    engine.wait_ready()?;
    let mut owner = Authoring::for_source(&bad, "failure".into(), None);
    owner.command(
        &mut engine,
        A::Utility {
            command: C::Balance,
        },
    )?;
    for chunk in 0..900 {
        let mut l = [0.0; 128];
        let mut r = l;
        for i in 0..128 {
            l[i] = ((chunk * 128 + i) as f32 * 0.071).sin() * 0.1;
            r[i] = l[i] * 0.5;
        }
        engine.process(&mut l, &mut r)?;
    }
    assert!(
        owner
            .command(&mut engine, A::Utility { command: C::Poll })
            .is_err()
    );
    assert!((read(&mut engine, "outputBalance")? - 0.5).abs() < 1e-6);
    assert!(!owner.failed() && !owner.measurement_pending() && owner.working_receipt().is_none());
    assert!(owner.snapshot(&mut engine)?.tools.error.is_some());
    eprintln!(
        "native utilities: automatic result storage failure rolls back while native owner remains healthy"
    );
    Ok(())
}

fn qualify_device_defaults() -> Result<(), Box<dyn Error>> {
    use oxidal_tone3000::preferences::Settings;
    let mut engine = Engine::new(48000.0, 128)?;
    let mut settings = Settings {
        nam_size: 0.75,
        multi_core: true,
        ..Default::default()
    };
    settings
        .parameters
        .insert("inputCalibrationLevel".into(), 0.65);
    settings.parameters.insert("calibrateInput".into(), 1.0);
    settings.parameters.insert("osEnabled".into(), 0.0);
    engine.apply_device_defaults(&settings)?;
    assert_eq!(engine.chain()?["namSlimSizeDefault"], 0.75);
    assert_eq!(engine.chain()?["multiCore"], true);
    let p = engine.catalog()?;
    assert!(
        (p.as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "inputCalibrationLevel")
            .unwrap()["normalized"]
            .as_f64()
            .unwrap()
            - 0.65)
            .abs()
            < 1e-5
    );
    let model = std::env::var("OXIDAL_TONE3000_TEST_MODEL")
        .or_else(|_| std::env::var("OXIDAL_NATIVE_TEST_MODEL"))?;
    engine.load_local_model(std::path::Path::new(&model))?;
    engine.wait_ready()?;
    let id = engine
        .block_controls()?
        .iter()
        .find(|p| p.parameter == "slimSize")
        .ok_or("missing model size")?
        .block_id
        .clone();
    let old_size = engine
        .block_controls()?
        .iter()
        .find(|p| p.block_id == id && p.parameter == "slimSize")
        .ok_or("missing size")?
        .value;
    assert!((old_size - 0.75).abs() < 1e-5);
    settings.nam_size = 0.25;
    settings.multi_core = false;
    engine.apply_device_defaults(&settings)?;
    assert!(
        (engine
            .block_controls()?
            .iter()
            .find(|p| p.block_id == id && p.parameter == "slimSize")
            .unwrap()
            .value
            - old_size)
            .abs()
            < 1e-5
    );
    let state = engine.capture()?;
    let mut recalled = Engine::new(48000.0, 128)?;
    recalled.restore(&state)?;
    recalled.wait_ready()?;
    assert!(
        (recalled
            .block_controls()?
            .iter()
            .find(|p| p.parameter == "slimSize")
            .unwrap()
            .value
            - 0.75)
            .abs()
            < 1e-5
    );
    println!(
        "native defaults: actual NAM default, existing model preservation, multi-core readback, calibration and state recall passed"
    );
    Ok(())
}

fn qualify_live_gestures() -> Result<(), Box<dyn Error>> {
    use oxidal_audio::structure::{AuthoringAction as A, LiveGesture as G};
    use oxidal_tone3000::working::Authoring;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?).join(format!(
        "gestures-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir_all(&root)?;
    let mut engine = Engine::new(48000.0, 128)?;
    engine.set_live_control("inputLevel", 0.5)?;
    {
        use oxidal_audio::midi::{
            ControlMode, ControlTarget, Decoder, Message, ParameterBinding, Settings,
        };
        let mut settings = Settings {
            input: "hw:Controller,0,0".into(),
            channel: 2,
            bindings: vec![],
            branch_bindings: vec![],
            parameter_bindings: vec![ParameterBinding {
                target: ControlTarget::Native {
                    node: "native".into(),
                    parameter: "inputLevel".into(),
                },
                controller: 21,
                mode: ControlMode::Absolute,
            }],
        };
        settings.validate_native(&engine.live_controls()?)?;
        let mut decoder = Decoder::default();
        for byte in [0xb1, 21, 64, 0xf8] {
            if let Some(message) = decoder.push(byte) {
                assert!(oxidal_tone3000::midi::dispatch(
                    &mut engine,
                    &settings,
                    message,
                    false
                )?);
            }
        }
        let value = |engine: &mut Engine| -> Result<f32, Box<dyn Error>> {
            Ok(engine
                .live_controls()?
                .iter()
                .find(|c| c.target == "inputLevel")
                .unwrap()
                .value)
        };
        assert!((f64::from(value(&mut engine)?) - 64.0 / 127.0).abs() < 0.00051);
        let prior = value(&mut engine)?;
        assert!(
            oxidal_tone3000::midi::dispatch(
                &mut engine,
                &settings,
                Message::Control {
                    channel: 2,
                    controller: 21,
                    value: 0
                },
                true
            )
            .is_err()
        );
        assert!(!oxidal_tone3000::midi::dispatch(
            &mut engine,
            &settings,
            Message::Control {
                channel: 1,
                controller: 21,
                value: 0
            },
            false
        )?);
        assert_eq!(value(&mut engine)?, prior);
        settings.parameter_bindings[0].mode = ControlMode::RelativeOffset64;
        assert!(oxidal_tone3000::midi::dispatch(
            &mut engine,
            &settings,
            Message::Control {
                channel: 2,
                controller: 21,
                value: 63
            },
            false
        )?);
        assert!(value(&mut engine)? < prior);
        settings.parameter_bindings[0].target = ControlTarget::Native {
            node: "native".into(),
            parameter: "missing".into(),
        };
        assert!(settings.validate_native(&engine.live_controls()?).is_err());
        assert!(
            oxidal_tone3000::midi::dispatch(
                &mut engine,
                &settings,
                Message::Control {
                    channel: 2,
                    controller: 21,
                    value: 64
                },
                false
            )
            .is_err()
        );
        engine.set_live_control("inputLevel", 0.5)?;
    }
    println!(
        "native MIDI: real decoder, normalized readback, encoder direction, channel/edit guards and unavailable target rejection passed"
    );
    let mut owner = Authoring::for_source(&root, "gesture-qualification".into(), None);
    let send = |owner: &mut Authoring, engine: &mut Engine, edit: G| {
        owner.command(engine, A::Gesture { edit })
    };
    let scalar = |e: &mut Engine| -> Result<f32, Box<dyn Error>> {
        Ok(e.live_controls()?
            .iter()
            .find(|c| c.target == "inputLevel")
            .unwrap()
            .value)
    };
    send(
        &mut owner,
        &mut engine,
        G::Begin {
            owner: "browser".into(),
            token: "first".into(),
            target: "inputLevel".into(),
        },
    )?;
    assert!(owner.gesture_pending());
    assert!(!owner.snapshot(&mut engine)?.can_undo);
    assert!(
        send(
            &mut owner,
            &mut engine,
            G::Begin {
                owner: "other".into(),
                token: "other".into(),
                target: "inputLevel".into()
            }
        )
        .is_err()
    );
    for sequence in 1..=20 {
        send(
            &mut owner,
            &mut engine,
            G::Preview {
                owner: "browser".into(),
                token: "first".into(),
                sequence,
                value: 0.4 + sequence as f32 * 0.01,
            },
        )?;
    }
    assert!((scalar(&mut engine)? - 0.6).abs() < 1e-5);
    assert!(!owner.snapshot(&mut engine)?.can_undo);
    assert!(
        send(
            &mut owner,
            &mut engine,
            G::Preview {
                owner: "browser".into(),
                token: "first".into(),
                sequence: 20,
                value: 0.9
            }
        )
        .is_err()
    );
    send(
        &mut owner,
        &mut engine,
        G::Commit {
            owner: "browser".into(),
            token: "first".into(),
            sequence: 21,
            value: 0.7,
        },
    )?;
    assert!(!owner.gesture_pending());
    assert!(owner.snapshot(&mut engine)?.can_undo);
    send(
        &mut owner,
        &mut engine,
        G::Cancel {
            owner: "browser".into(),
            token: "first".into(),
        },
    )?;
    assert!((scalar(&mut engine)? - 0.7).abs() < 1e-5);
    let receipt = owner
        .working_receipt()
        .ok_or("Missing scalar history receipt")?
        .to_owned();
    let mut rebuilt = Engine::new(48000.0, 128)?;
    rebuilt.restore(&oxidal_tone3000::working::read(
        &root,
        &receipt,
        "gesture-qualification",
    )?)?;
    rebuilt.wait_ready()?;
    engine = rebuilt;
    owner = Authoring::for_source(&root, "gesture-qualification".into(), Some(receipt));
    assert!(owner.snapshot(&mut engine)?.history_error.is_none());
    assert!(owner.snapshot(&mut engine)?.can_undo);
    owner.prepare_parameter(&mut engine, "osEnabled".into(), 1.0)?;
    let processing_latency = engine.latency_samples()?;
    owner.command(&mut engine, A::Undo)?;
    assert_eq!(
        owner
            .snapshot(&mut engine)?
            .settings
            .iter()
            .find(|p| p.target == "osEnabled")
            .unwrap()
            .value,
        1.0
    );
    assert_eq!(
        engine.latency_samples()?,
        processing_latency,
        "Undo retains current processing configuration"
    );
    assert!((scalar(&mut engine)? - 0.5).abs() < 1e-5);
    assert!(!owner.snapshot(&mut engine)?.can_undo);
    let receipt = owner.working_receipt().unwrap().to_owned();
    owner = Authoring::for_source(&root, "gesture-qualification".into(), Some(receipt));
    assert!(owner.snapshot(&mut engine)?.can_redo);
    owner.command(&mut engine, A::Redo)?;
    assert!((scalar(&mut engine)? - 0.7).abs() < 1e-5);
    engine.set_live_control("chainPanLinked", 1.0)?;
    let before = engine.live_controls()?;
    send(
        &mut owner,
        &mut engine,
        G::Begin {
            owner: "browser".into(),
            token: "cancel".into(),
            target: "chainPanLeft".into(),
        },
    )?;
    send(
        &mut owner,
        &mut engine,
        G::Preview {
            owner: "browser".into(),
            token: "cancel".into(),
            sequence: 1,
            value: 0.2,
        },
    )?;
    assert!(
        (engine
            .live_controls()?
            .iter()
            .find(|c| c.target == "chainPanRight")
            .unwrap()
            .value
            - 0.8)
            .abs()
            < 1e-5
    );
    send(
        &mut owner,
        &mut engine,
        G::Cancel {
            owner: "browser".into(),
            token: "cancel".into(),
        },
    )?;
    assert_eq!(
        serde_json::to_vec(&before)?,
        serde_json::to_vec(&engine.live_controls()?)?
    );
    owner.command(&mut engine, A::Undo)?;
    assert!((scalar(&mut engine)? - 0.5).abs() < 1e-5);
    let bad_root = root.join("unwritable");
    std::fs::create_dir_all(&bad_root)?;
    std::fs::write(bad_root.join("native-checkpoints"), "not a directory")?;
    let mut bad = Authoring::for_source(&bad_root, "failed-gesture".into(), None);
    send(
        &mut bad,
        &mut engine,
        G::Begin {
            owner: "browser".into(),
            token: "failed".into(),
            target: "inputLevel".into(),
        },
    )?;
    send(
        &mut bad,
        &mut engine,
        G::Preview {
            owner: "browser".into(),
            token: "failed".into(),
            sequence: 1,
            value: 0.8,
        },
    )?;
    assert!(
        send(
            &mut bad,
            &mut engine,
            G::Commit {
                owner: "browser".into(),
                token: "failed".into(),
                sequence: 2,
                value: 0.8
            }
        )
        .is_err()
    );
    assert!(!bad.failed() && !bad.gesture_pending());
    assert!((scalar(&mut engine)? - 0.5).abs() < 1e-5);
    engine.load_local_model(std::path::Path::new(&std::env::var(
        "OXIDAL_TONE3000_TEST_MODEL",
    )?))?;
    engine.wait_ready()?;
    let row = engine
        .eq_snapshot()?
        .into_iter()
        .next()
        .ok_or("Missing model EQ")?;
    assert_eq!(
        row.eq,
        oxidal_audio::eq::EqState::default(),
        "Rust/native reset defaults agree"
    );
    let mut eq_owner = Authoring::for_source(&root, "eq-gesture-qualification".into(), None);
    let target = format!("eq:{}:1:gainDb", row.block_id);
    send(
        &mut eq_owner,
        &mut engine,
        G::Begin {
            owner: "eq".into(),
            token: "gain".into(),
            target: target.clone(),
        },
    )?;
    for sequence in 1..=20 {
        send(
            &mut eq_owner,
            &mut engine,
            G::Preview {
                owner: "eq".into(),
                token: "gain".into(),
                sequence,
                value: sequence as f32 * 0.1,
            },
        )?;
    }
    send(
        &mut eq_owner,
        &mut engine,
        G::Commit {
            owner: "eq".into(),
            token: "gain".into(),
            sequence: 21,
            value: 3.0,
        },
    )?;
    assert_eq!(engine.eq_snapshot()?[0].eq.bands[1].gain_db as f32, 3.0);
    eq_owner.command(&mut engine, A::Undo)?;
    assert_eq!(engine.eq_snapshot()?[0].eq, row.eq);
    assert!(!eq_owner.snapshot(&mut engine)?.can_undo);
    eq_owner.command(&mut engine, A::Redo)?;
    let edited = engine.eq_snapshot()?;
    send(
        &mut eq_owner,
        &mut engine,
        G::Begin {
            owner: "eq".into(),
            token: "cancel-q".into(),
            target: format!("eq:{}:1:q", row.block_id),
        },
    )?;
    send(
        &mut eq_owner,
        &mut engine,
        G::Preview {
            owner: "eq".into(),
            token: "cancel-q".into(),
            sequence: 1,
            value: 2.5,
        },
    )?;
    send(
        &mut eq_owner,
        &mut engine,
        G::Cancel {
            owner: "eq".into(),
            token: "cancel-q".into(),
        },
    )?;
    assert_eq!(engine.eq_snapshot()?, edited);
    eq_owner.command(
        &mut engine,
        A::Eq {
            block_id: row.block_id.clone(),
            edit: oxidal_audio::eq::EqEdit::Reset,
        },
    )?;
    assert_eq!(
        engine.eq_snapshot()?[0].eq,
        oxidal_audio::eq::EqState::default()
    );
    eq_owner.command(&mut engine, A::Undo)?;
    assert_eq!(engine.eq_snapshot()?, edited);
    let receipt = eq_owner
        .working_receipt()
        .ok_or("Missing EQ history receipt")?
        .to_owned();
    let mut replacement = Engine::new(48000.0, 128)?;
    replacement.restore(&oxidal_tone3000::working::read(
        &root,
        &receipt,
        "eq-gesture-qualification",
    )?)?;
    replacement.wait_ready()?;
    engine = replacement;
    eq_owner = Authoring::for_source(&root, "eq-gesture-qualification".into(), Some(receipt));
    assert!(eq_owner.snapshot(&mut engine)?.can_redo);
    eq_owner.command(&mut engine, A::Redo)?;
    assert_eq!(
        engine.eq_snapshot()?[0].eq,
        oxidal_audio::eq::EqState::default()
    );
    eq_owner.command(&mut engine, A::Undo)?;
    assert_eq!(engine.eq_snapshot()?, edited);
    let bytes = engine.save_preset("EQ history Save")?;
    let mut fresh = Engine::new(48000.0, 128)?;
    fresh.load_preset(&bytes)?;
    fresh.wait_ready()?;
    assert_eq!(fresh.eq_snapshot()?[0].eq, edited[0].eq);
    let mut failed_eq = Authoring::for_source(&bad_root, "failed-eq-gesture".into(), None);
    send(
        &mut failed_eq,
        &mut engine,
        G::Begin {
            owner: "eq".into(),
            token: "disk-failure".into(),
            target,
        },
    )?;
    assert!(
        send(
            &mut failed_eq,
            &mut engine,
            G::Commit {
                owner: "eq".into(),
                token: "disk-failure".into(),
                sequence: 1,
                value: 8.0
            }
        )
        .is_err()
    );
    assert!(!failed_eq.failed() && !failed_eq.gesture_pending());
    assert_eq!(engine.eq_snapshot()?, edited);
    println!(
        "native EQ gestures: actual A2 EQ previews, grouped undo/redo, cancel, native reset defaults, reset undo, standalone Save/reopen and failed-storage rollback passed"
    );
    println!(
        "native gestures: audible previews, one-entry undo/redo, ownership/sequence rejection, coupled-control cancel, late terminal safety and storage rollback passed"
    );
    Ok(())
}

fn qualify_local_files() -> Result<(), Box<dyn Error>> {
    use oxidal_audio::lifecycle::ModelAssignment;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_QUALIFICATION_DATA")?).join(format!(
        "local-files-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir_all(&root)?;
    let store = oxidal_presets::ModelStore::new(root.join("audition-models"));
    let nam = std::fs::read(std::env::var("OXIDAL_TONE3000_TEST_MODEL")?)?;
    for (name, bytes) in [
        ("My offline amp.nam", nam),
        ("My offline cab.wav", impulse_wav()),
    ] {
        let (id, asset) = store.stage_local(name, &bytes)?;
        assert_eq!(asset.tone_id, 0);
        assert_eq!(asset.tone["local"], true);
        let mut engine = Engine::new(48000.0, 128)?;
        engine.reset_empty()?;
        let slot = engine
            .slots()?
            .into_iter()
            .find(|s| s.position.lane == 0)
            .ok_or("No initial slot")?;
        oxidal_tone3000::model_preparation::restore(
            &mut engine,
            &root,
            &[ModelAssignment {
                target: slot.target,
                asset: id,
                insertion: Some(slot.position),
            }],
            128,
        )?;
        engine.wait_ready()?;
        engine.set_normalized("gateEnabled", 0.0)?;
        engine.set_normalized("inputLevel", 0.5)?;
        engine.set_normalized("outputLevel", 0.5)?;
        assert!(engine.chain()?.to_string().contains("\"local\":true"));
        let saved = engine.save_preset("Local file offline recall")?;
        std::fs::rename(root.join("audition-models"), root.join("inert-cache"))?;
        let mut recalled = Engine::new(48000.0, 128)?;
        recalled.load_preset(&saved)?;
        recalled.wait_ready()?;
        engine.prepare_stream()?;
        recalled.prepare_stream()?;
        let mut peak = 0.0f32;
        let mut worst = 0.0f32;
        for block in 0..24 {
            let input: Vec<_> = (0..128)
                .map(|i| ((block * 128 + i) as f32 * 0.09).sin() * 0.05)
                .collect();
            let (mut l, mut r) = (input.clone(), input.clone());
            let (mut a, mut b) = (input.clone(), input);
            engine.process(&mut l, &mut r)?;
            recalled.process(&mut a, &mut b)?;
            for (x, y) in l.iter().chain(&r).zip(a.iter().chain(&b)) {
                assert!(x.is_finite() && y.is_finite());
                peak = peak.max(x.abs());
                worst = worst.max((x - y).abs());
            }
        }
        assert!(peak > 1e-6);
        assert!(worst < 1e-5, "local offline replay {name}: {worst}");
        std::fs::rename(root.join("inert-cache"), root.join("audition-models"))?;
    }
    println!(
        "local files: real A2 NAM and WAV IR insert, native local tone identity, no-account preparation, standalone Save and cache-independent matching PCM passed"
    );
    Ok(())
}
