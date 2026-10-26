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
fn main() -> Result<(), Box<dyn Error>> {
    let expected: Value =
        serde_json::from_str(include_str!("../../../native/tone3000/parameters.json"))?;
    let mut engine = Engine::new(48000.0, 128)?;
    assert!(
        Engine::new(48000.0, 128).is_err(),
        "must reject second live owner"
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
    let stash = root.join("user/Library/Application Support/TONE3000/LocalModels");
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
    println!(
        "{}",
        serde_json::json!({"parameters":43,"tone_parameters":36,"machine_defaults":4,"dry_max_error":dry_error,"restored_a2_max_error":restore_error,"state_bytes":model_state.byte_len(),"non_a2_local_load_rejected":true,"live_audio_qualified":false})
    );
    Ok(())
}
