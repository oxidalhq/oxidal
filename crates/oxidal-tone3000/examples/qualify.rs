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
        engine.set_block(&block.block_id, "outputGain", gain)?;
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
    qualify_factories()?;
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
    assert_eq!(owned.source_sha256, original.sha256);
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
    }
    println!(
        "native_factory_workflows: 8 passed (state/readiness/finite render; not independent full audio parity)"
    );
    Ok(())
}
