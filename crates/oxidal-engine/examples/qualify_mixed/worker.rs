//! Actual mixed worker lifecycle and immutable revision export, maintained by native:check.
use oxidal_engine::{Session, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::{Bundle, BundleStore};
use std::{
    error::Error,
    io::{BufRead, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
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
        input,
        output,
        input_map: [0, 1],
        output_map: [0, 1],
    }
}
fn send<T: serde::Serialize>(child: &mut ChildGuard, value: &T) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    child
        .0
        .stdin
        .as_mut()
        .ok_or("missing stdin")?
        .write_all(&bytes)?;
    Ok(())
}
fn spawn(root: &Path, data: &Path, save: bool) -> Result<ChildGuard> {
    spawn_with_models(root, data, save, None)
}
fn spawn_with_models(
    root: &Path,
    data: &Path,
    save: bool,
    models: Option<&Path>,
) -> Result<ChildGuard> {
    std::fs::create_dir_all(data)?;
    let mut command = Command::new(std::env::var("OXIDAL_TEST_RIG_WORKER")?);
    if save {
        command.arg("--save-revision");
    }
    if let Some(models) = models {
        command.env("OXIDAL_PRESET_DIR", models);
    }
    Ok(ChildGuard(
        command
            .env("OXIDAL_BUNDLE_STORE", root)
            .env("OXIDAL_QUALIFICATION_DATA", data)
            .env("OXIDAL_RIG_QUALIFY_NULL", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?,
    ))
}
fn wait(child: &mut ChildGuard, seconds: u64) -> Result<()> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.0.try_wait()? {
            if !status.success() {
                return Err(format!("Rig child failed {status}").into());
            }
            return Ok(());
        }
        if start.elapsed() > Duration::from_secs(seconds) {
            return Err("Rig child timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn change(session: &mut Session, target: Target, value: f64) -> Result<()> {
    let s = session.snapshot();
    session.apply(ControlCommand {
        session: s.session,
        expected_revision: s.revision,
        target,
        value,
    })?;
    Ok(())
}
fn value(snapshot: &Snapshot, target: &Target) -> f64 {
    snapshot
        .controls
        .iter()
        .find(|c| &c.target == target)
        .unwrap()
        .value
}
fn compare(a: &Snapshot, b: &Snapshot) {
    assert_eq!(a.eq, b.eq);
    assert_eq!(a.controls.len(), b.controls.len());
    for c in &a.controls {
        assert!(
            (c.value - value(b, &c.target)).abs() < 1e-5,
            "control drift: {:?}",
            c.target
        );
    }
}
fn replies(
    child: &mut ChildGuard,
) -> Result<mpsc::Receiver<std::result::Result<WorkerReply, String>>> {
    let output = child.0.stdout.take().ok_or("missing stdout")?;
    let (send_reply, received) = mpsc::sync_channel(2);
    std::thread::spawn(move || {
        let mut output = std::io::BufReader::new(output);
        loop {
            let mut bytes = Vec::new();
            let result = (&mut output)
                .take((REPLY_LIMIT + 1) as u64)
                .read_until(b'\n', &mut bytes);
            if result.is_err() || bytes.is_empty() || bytes.len() > REPLY_LIMIT {
                break;
            }
            let parsed = serde_json::from_slice::<WorkerReply>(&bytes).map_err(|e| e.to_string());
            if send_reply.send(parsed).is_err() {
                break;
            }
        }
    });
    Ok(received)
}

pub fn qualify_partition(bundle: &Bundle, root: &Path) -> Result<()> {
    let path = root.join("partition-worker-rigs");
    let store = BundleStore::new(path.clone());
    let revision = store.save(bundle)?;
    let start = StartRig {
        midi: None,
        prepared: Vec::new(),
        revision: revision.clone(),
        stream: stream(),
        recall: None,
    };
    let mut child = spawn(&path, &root.join("partition-child"), false)?;
    let received = replies(&mut child)?;
    send(&mut child, &start)?;
    let state = received.recv_timeout(Duration::from_secs(30))??;
    assert!(state.error.is_none() && state.processed_frames > 0);
    send(
        &mut child,
        &WorkerRequest::Control {
            command: ControlCommand {
                session: state.control.session.clone(),
                expected_revision: state.control.revision,
                target: Target::Native {
                    node: "amp".into(),
                    parameter: "inputLevel".into(),
                },
                value: 0.56,
            },
        },
    )?;
    let changed = received.recv_timeout(Duration::from_secs(3))??;
    assert!(changed.error.is_none());
    let mut saver = spawn(&path, &root.join("partition-export"), true)?;
    send(
        &mut saver,
        &SaveRequest {
            settings: start,
            recall: changed.control.recall(),
            name: "Worker partition copy".into(),
        },
    )?;
    saver.0.stdin.take();
    wait(&mut saver, 60)?;
    let mut bytes = Vec::new();
    saver
        .0
        .stdout
        .take()
        .unwrap()
        .take(1024)
        .read_to_end(&mut bytes)?;
    let saved: String = serde_json::from_slice(&bytes)?;
    send(&mut child, &WorkerRequest::Status)?;
    let after = received.recv_timeout(Duration::from_secs(3))??;
    assert!(after.processed_frames > changed.processed_frames);
    compare(&changed.control, &after.control);
    child.0.stdin.take();
    wait(&mut child, 5)?;
    assert_eq!(
        store.read(&saved)?.resource("source"),
        bundle.resource("source")
    );
    assert_eq!(
        store.read(&revision)?.manifest_bytes(),
        bundle.manifest_bytes()
    );
    let mut recalled = spawn(&path, &root.join("partition-recall"), false)?;
    let received = replies(&mut recalled)?;
    send(
        &mut recalled,
        &StartRig {
            midi: None,
            prepared: Vec::new(),
            revision: saved,
            stream: stream(),
            recall: None,
        },
    )?;
    let state = received.recv_timeout(Duration::from_secs(30))??;
    assert!(state.error.is_none() && state.processed_frames > 0);
    compare(&changed.control, &state.control);
    recalled.0.stdin.take();
    wait(&mut recalled, 5)?;
    println!(
        "partition actual worker, continued PCM during isolated Save, immutable source and fresh child recall pass"
    );
    Ok(())
}

pub fn qualify(world: &World, bundle: &Bundle, root: &Path) -> Result<()> {
    let bypass = Target::Bypass {
        node: "tone".into(),
    };
    let gain = Target::Lv2 {
        node: "fx_l".into(),
        symbol: "gain".into(),
    };
    let native = Target::Native {
        node: "tone".into(),
        parameter: "outputLevel".into(),
    };
    let merge = Target::Merge {
        node: "merge_l".into(),
        port: 0,
    };
    let mut session = Session::new(bundle.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    assert!(!session.snapshot().modified);
    let current = session.snapshot();
    let mut legacy = current.recall();
    legacy.values.retain(|v| {
        !matches!(&v.target, Target::Native { parameter, .. }
        if parameter.starts_with("spread") || parameter == "outputBalance")
    });
    assert!(legacy.values.len() < current.controls.len());
    session.restore(&legacy)?;
    compare(&current, &session.snapshot());
    let mut incomplete = current.recall();
    incomplete.values.retain(|v| {
        !matches!(&v.target, Target::Native { parameter, .. }
        if parameter == "spreadEnabled")
    });
    let before = session.snapshot();
    assert!(session.restore(&incomplete).is_err());
    assert_eq!(session.snapshot().revision, before.revision);
    compare(&before, &session.snapshot());
    change(&mut session, bypass.clone(), 1.0)?;
    assert!(session.snapshot().modified);
    change(&mut session, bypass.clone(), 0.0)?;
    assert!(!session.snapshot().modified); // Cancel restores values, not merely revision zero.
    change(&mut session, bypass.clone(), 1.0)?;
    let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
    session.process(&[&[0.5; 128], &[0.25; 128]], &mut [&mut l, &mut r])?;
    assert!(l.iter().all(|v| (*v - 0.4375).abs() < 1e-5));
    assert_eq!(r, [0.25; 128]);
    change(&mut session, gain.clone(), 0.0)?;
    session.process(&[&[0.5; 128], &[0.25; 128]], &mut [&mut l, &mut r])?;
    assert_eq!(l, [0.5; 128]);
    change(&mut session, merge.clone(), 0.0)?;
    session.process(&[&[0.5; 128], &[0.25; 128]], &mut [&mut l, &mut r])?;
    assert_eq!(l, [0.375; 128]); // A live edit changes sound before Save.
    let before = session.snapshot();
    for (target, value) in [
        (gain.clone(), 9999.0),
        (bypass.clone(), 0.5),
        (merge.clone(), f64::NAN),
        (
            Target::Bypass {
                node: "missing".into(),
            },
            1.0,
        ),
    ] {
        assert!(change(&mut session, target, value).is_err());
        assert!(session.healthy());
        compare(&before, &session.snapshot());
    }
    let mut bad = before.recall();
    bad.values[1] = bad.values[0].clone();
    assert!(session.restore(&bad).is_err());
    compare(&before, &session.snapshot());
    let mut bad_eq = before.recall();
    bad_eq.eq.as_mut().unwrap()[0].blocks[0].eq.bands[1].freq_hz = 99999.0;
    assert!(session.restore(&bad_eq).is_err());
    assert_eq!(session.snapshot().revision, before.revision);
    compare(&before, &session.snapshot());
    let mut replay = before.recall();
    let eq = &mut replay.eq.as_mut().unwrap()[0].blocks[0].eq;
    eq.pre = !eq.pre;
    session.restore(&replay)?;
    assert_eq!(session.snapshot().eq, replay.eq.unwrap());
    session.restore(&before.recall())?;
    compare(&before, &session.snapshot());
    drop(session);

    let store_path = root.join("worker-rigs");
    let store = BundleStore::new(store_path.clone());
    let revision = store.save(bundle)?;
    std::fs::write(root.join("mixed-preset-revision"), &revision)?;
    let mut eq_only = Session::new(bundle.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    let initial = eq_only.snapshot();
    let row = &initial.eq[0];
    eq_only.apply_eq(EqCommand {
        session: initial.session.clone(),
        expected_revision: initial.revision,
        node: row.node.clone(),
        block_id: row.blocks[0].block_id.clone(),
        edit: oxidal_audio::eq::EqEdit::Pre {
            value: !row.blocks[0].eq.pre,
        },
    })?;
    assert!(eq_only.snapshot().modified);
    let eq_revision = oxidal_engine::save_revision(
        &store,
        world,
        SaveRequest {
            settings: StartRig {
                midi: None,
                prepared: Vec::new(),
                revision: revision.clone(),
                stream: stream(),
                recall: None,
            },
            recall: eq_only.snapshot().recall(),
            name: "EQ-only snapshot".into(),
        },
    )?;
    let eq_recalled = Session::new(
        store.read(&eq_revision)?,
        world,
        48000.0,
        128,
        BUFFER_BUDGET,
    )?;
    compare(&eq_only.snapshot(), &eq_recalled.snapshot());
    assert!(!eq_recalled.snapshot().modified);
    drop(eq_recalled);
    drop(eq_only);
    let start = StartRig {
        midi: None,
        prepared: Vec::new(),
        revision: revision.clone(),
        stream: stream(),
        recall: None,
    };
    let mut child = spawn(&store_path, &root.join("rig-child"), false)?;
    let received = replies(&mut child)?;
    send(&mut child, &start)?;
    let mut state = received.recv_timeout(Duration::from_secs(30))??;
    assert!(state.error.is_none() && state.processed_frames > 0);
    let stale = ControlCommand {
        session: state.control.session.clone(),
        expected_revision: state.control.revision,
        target: gain.clone(),
        value: 1.0,
    };
    for (target, value) in [
        (gain.clone(), -3.0),
        (native.clone(), 0.6),
        (bypass.clone(), 1.0),
        (merge.clone(), 0.5),
    ] {
        let command = ControlCommand {
            session: state.control.session.clone(),
            expected_revision: state.control.revision,
            target,
            value,
        };
        send(&mut child, &WorkerRequest::Control { command })?;
        state = received.recv_timeout(Duration::from_secs(3))??;
        assert!(state.error.is_none(), "{:?}", state.error);
    }
    let row = state.control.eq[0].clone();
    let mut band = row.blocks[0].eq.bands[1].clone();
    band.gain_db = 0.1;
    for edit in [
        oxidal_audio::eq::EqEdit::Enabled { value: true },
        oxidal_audio::eq::EqEdit::Band { index: 1, band },
    ] {
        send(
            &mut child,
            &WorkerRequest::Eq {
                command: EqCommand {
                    session: state.control.session.clone(),
                    expected_revision: state.control.revision,
                    node: row.node.clone(),
                    block_id: row.blocks[0].block_id.clone(),
                    edit,
                },
            },
        )?;
        state = received.recv_timeout(Duration::from_secs(3))??;
        assert!(state.error.is_none(), "{:?}", state.error);
    }
    let confirmed = state.control.clone();
    assert_ne!(confirmed.eq, vec![row.clone()]);
    send(
        &mut child,
        &WorkerRequest::Eq {
            command: EqCommand {
                session: confirmed.session.clone(),
                expected_revision: confirmed.revision,
                node: row.node,
                block_id: "missing".into(),
                edit: oxidal_audio::eq::EqEdit::Enabled { value: false },
            },
        },
    )?;
    state = received.recv_timeout(Duration::from_secs(3))??;
    assert!(state.error.is_some());
    assert_eq!(state.control.revision, confirmed.revision);
    compare(&confirmed, &state.control);
    send(&mut child, &WorkerRequest::Control { command: stale })?;
    state = received.recv_timeout(Duration::from_secs(3))??;
    assert!(state.error.is_some());
    assert_eq!(state.control.revision, confirmed.revision);
    compare(&confirmed, &state.control);
    // Export while the actual worker continues; request is the confirmed revision.
    let mut saver = spawn(&store_path, &root.join("rig-export"), true)?;
    send(
        &mut saver,
        &SaveRequest {
            settings: start.clone(),
            recall: confirmed.recall(),
            name: "Saved mixed controls".into(),
        },
    )?;
    saver.0.stdin.take();
    wait(&mut saver, 60)?;
    let mut bytes = Vec::new();
    saver
        .0
        .stdout
        .take()
        .unwrap()
        .take(1024)
        .read_to_end(&mut bytes)?;
    let saved: String = serde_json::from_slice(&bytes)?;
    send(&mut child, &WorkerRequest::Status)?;
    let after = received.recv_timeout(Duration::from_secs(3))??;
    assert!(after.processed_frames > state.processed_frames);
    compare(&confirmed, &after.control);
    child.0.stdin.take();
    wait(&mut child, 5)?;
    // Original bytes survive; standalone revised payload no longer needs source cache.
    let restored = store.read(&saved)?;
    assert_ne!(saved, revision);
    assert_eq!(
        store.read(&revision)?.manifest_bytes(),
        bundle.manifest_bytes()
    );
    let native_instance = &restored.manifest().tone3000.instances[0];
    assert_eq!(
        restored.resource(&native_instance.origin.as_ref().unwrap().resource),
        bundle.resource("current")
    );
    let recalled = Session::new(restored.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    compare(&confirmed, &recalled.snapshot());
    drop(recalled);
    let no_op = oxidal_engine::save_revision(
        &store,
        world,
        SaveRequest {
            settings: StartRig {
                midi: None,
                prepared: Vec::new(),
                revision: saved.clone(),
                stream: stream(),
                recall: None,
            },
            recall: Session::new(restored.clone(), world, 48000.0, 128, BUFFER_BUDGET)?
                .snapshot()
                .recall(),
            name: "Renamed metadata".into(),
        },
    )?;
    let renamed = store.read(&no_op)?;
    assert_eq!(
        renamed.resource(&native_instance.preset),
        restored.resource(&native_instance.preset)
    );
    // Restart from saved revision, no transient recall override.
    let mut child = spawn(&store_path, &root.join("rig-recall"), false)?;
    let output = child.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = std::io::BufReader::new(output)
            .take((REPLY_LIMIT + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .map(|_| bytes);
        let _ = tx.send(result);
    });
    send(
        &mut child,
        &StartRig {
            midi: None,
            prepared: Vec::new(),
            revision: saved,
            stream: stream(),
            recall: None,
        },
    )?;
    let bytes = rx.recv_timeout(Duration::from_secs(30))??;
    let recalled: WorkerReply = serde_json::from_slice(&bytes)?;
    compare(&confirmed, &recalled.control);
    child.0.stdin.take();
    wait(&mut child, 5)?;
    // Two native instances may reference the same immutable starting payload.
    // Saving one edited instance must not alter the other's resource reference.
    let mut shared = bundle.manifest().clone();
    let mut instance = shared.tone3000.instances[0].clone();
    instance.id = "shared_native".into();
    shared.tone3000.instances.push(instance);
    let host = shared.oxidal.as_mut().unwrap();
    let mut node = host
        .graph
        .nodes
        .iter()
        .find(|n| n.id == "tone")
        .unwrap()
        .clone();
    node.id = "shared_tone".into();
    node.instance = Some("shared_native".into());
    host.graph.nodes.push(node);
    for edge in &mut host.graph.edges {
        if edge.from.node == "in" {
            edge.to.node = "shared_tone".into();
        }
    }
    for port in 0..2 {
        host.graph.edges.push(oxidal_presets::manifest::Edge {
            from: oxidal_presets::manifest::Endpoint {
                node: "shared_tone".into(),
                port,
            },
            to: oxidal_presets::manifest::Endpoint {
                node: "tone".into(),
                port,
            },
        });
    }
    let shared = Bundle::from_parts(
        shared.encode()?,
        std::collections::BTreeMap::from([(
            "current".into(),
            bundle.resource("current").unwrap().to_vec(),
        )]),
    )?;
    let shared_revision = store.save(&shared)?;
    let mut session = Session::new(shared, world, 48000.0, 128, BUFFER_BUDGET)?;
    change(
        &mut session,
        Target::Native {
            node: "shared_tone".into(),
            parameter: "outputLevel".into(),
        },
        0.4,
    )?;
    let expected = session.snapshot();
    drop(session);
    let saved = oxidal_engine::save_revision(
        &store,
        world,
        SaveRequest {
            settings: StartRig {
                midi: None,
                prepared: Vec::new(),
                revision: shared_revision,
                stream: stream(),
                recall: None,
            },
            recall: expected.recall(),
            name: "Shared asset independent controls".into(),
        },
    )?;
    let saved = store.read(&saved)?;
    assert_eq!(saved.manifest().tone3000.instances[0].preset, "current");
    assert_ne!(saved.manifest().tone3000.instances[1].preset, "current");
    assert_eq!(saved.resource("current"), bundle.resource("current"));
    compare(
        &expected,
        &Session::new(saved, world, 48000.0, 128, BUFFER_BUDGET)?.snapshot(),
    );
    qualify_models(world, bundle, root)?;
    println!(
        "mixed worker: live native/LV2/bypass/merge control, audible scalar change, invalid/stale rejection, concurrent isolated export, exact provenance, shared native resource independence and unchanged native bytes, offline child recall and EOF teardown pass"
    );
    Ok(())
}

fn model_command(state: &Snapshot, node: &str, target: &str, asset: &str) -> ModelCommand {
    ModelCommand {
        session: state.session.clone(),
        expected_revision: state.revision,
        node: node.into(),
        operation: oxidal_audio::lifecycle::ModelOperation::Prepare {
            assignment: oxidal_audio::lifecycle::ModelAssignment {
                target: target.into(),
                asset: asset.into(),
                insertion: None,
            },
        },
    }
}
fn advance(session: &mut Session, failed: bool) -> Result<()> {
    use oxidal_audio::lifecycle::ModelPhase;
    let started = Instant::now();
    loop {
        session.pump()?;
        let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
        session.process(&[&[0.02; 128], &[0.01; 128]], &mut [&mut l, &mut r])?;
        let state = session.snapshot();
        if let Some(change) = state.model_change {
            match change.progress.phase {
                ModelPhase::Applied => {
                    assert!(!failed);
                    return Ok(());
                }
                ModelPhase::Failed => {
                    assert!(failed, "{:?}", change.progress.error);
                    return Ok(());
                }
                _ => (),
            }
        }
        if started.elapsed() > Duration::from_secs(20) {
            return Err("Mixed model preparation timed out".into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
pub fn qualify_models(world: &World, bundle: &Bundle, root: &Path) -> Result<()> {
    use oxidal_presets::{ModelAsset, ModelStore};
    use sha2::{Digest, Sha256};
    let data = root.join("mixed-model-case");
    std::fs::create_dir_all(&data)?;
    let assets = ModelStore::new(data.join("audition-models"));
    let bytes = std::fs::read(
        std::env::var_os("OXIDAL_TONE3000_TEST_MODEL").ok_or("Native model fixture required")?,
    )?;
    let asset = ModelAsset {
        schema: 1,
        tone_id: 1701,
        model_id: 1901,
        title: "Hybrid live NAM".into(),
        name: "NAM fixture".into(),
        format: "nam".into(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        tone: serde_json::json!({"id":1701,"title":"Hybrid live NAM","format":"nam","gear":"amp","models":[{"id":1901,"name":"NAM fixture","model_url":"oxidal-model://fixture/model.nam"}]}),
    };
    let nam = assets.stage(&asset, &bytes)?;
    let source = ModelStore::new(root.join("audition-models"));
    let (ir, ir_path) = std::fs::read_dir(root.join("audition-models"))?
        .filter_map(|p| p.ok())
        .filter_map(|p| source.read(&p.file_name().to_string_lossy()).ok())
        .find(|(a, _)| a.format == "ir")
        .ok_or("Native IR fixture required")?;
    let ir = assets.stage(&ir, &std::fs::read(ir_path)?)?;
    let store = BundleStore::new(data.join("bundles"));
    let revision = store.save(bundle)?;
    let mut session = Session::new(bundle.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
    let original = session.snapshot();
    let node = original.eq[0].node.clone();
    let target = original.eq[0].blocks[0].block_id.clone();
    assert!(
        session
            .model_command(model_command(&original, &node, "missing", &nam), &data)
            .is_err()
    );
    assert_eq!(session.snapshot().revision, original.revision);
    session.model_command(
        model_command(&original, &node, &target, &"0".repeat(64)),
        &data,
    )?;
    assert!(session.model_pending());
    advance(&mut session, true)?;
    assert!(session.healthy());
    compare(&original, &session.snapshot());
    session.model_command(
        model_command(&session.snapshot(), &node, &target, &nam),
        &data,
    )?;
    assert!(
        change(
            &mut session,
            Target::Native {
                node: node.clone(),
                parameter: "inputLevel".into()
            },
            0.4
        )
        .is_err()
    );
    advance(&mut session, false)?;
    let applied = session.snapshot();
    assert!(
        applied
            .authoring
            .iter()
            .find(|a| a.node == node)
            .unwrap()
            .status
            .can_undo
    );
    for (action, expected) in [
        (oxidal_audio::structure::AuthoringAction::Undo, &original),
        (oxidal_audio::structure::AuthoringAction::Redo, &applied),
    ] {
        let cursor = session.snapshot();
        session.authoring_command(
            AuthoringCommand {
                session: cursor.session,
                expected_revision: cursor.revision,
                node: node.clone(),
                action,
            },
            &data,
        )?;
        compare(expected, &session.snapshot());
    }
    session.model_command(
        model_command(&session.snapshot(), &node, &target, &nam),
        &data,
    )?;
    advance(&mut session, false)?;
    for asset in [&nam, &ir] {
        let state = session.snapshot();
        let slot = state
            .slots
            .iter()
            .find(|s| s.node == node)
            .unwrap()
            .slots
            .iter()
            .find(|s| s.position.lane == 0)
            .unwrap();
        session.model_command(model_command(&state, &node, &slot.target, asset), &data)?;
        advance(&mut session, false)?;
    }
    change(
        &mut session,
        Target::Native {
            node: node.clone(),
            parameter: "inputLevel".into(),
        },
        0.43,
    )?;
    let expected = session.snapshot();
    assert_eq!(expected.models[0].assignments.len(), 3);
    assert!(expected.valid_model_state());
    assert!(expected.modified);
    let mut restored = Session::new_with_working(
        bundle.clone(),
        world,
        48000.0,
        128,
        BUFFER_BUDGET,
        Some((&data, &expected.working)),
    )?;
    restored.restore_with_models(&expected.recall(), &data)?;
    compare(&expected, &restored.snapshot());
    assert_eq!(restored.snapshot().models, expected.models);
    let saved = oxidal_engine::save_revision_with_models(
        &store,
        world,
        SaveRequest {
            settings: StartRig {
                midi: None,
                revision: revision.clone(),
                stream: stream(),
                recall: None,
                prepared: vec![],
            },
            recall: expected.recall(),
            name: "Hybrid NAM and IR offline".into(),
        },
        &data,
    )?;
    assert_eq!(
        store.read(&revision)?.manifest_bytes(),
        bundle.manifest_bytes()
    );
    assert_eq!(
        store.read(&revision)?.resource("current"),
        bundle.resource("current")
    );
    let mut reopened = Session::new(store.read(&saved)?, world, 48000.0, 128, BUFFER_BUDGET)?;
    compare(&expected, &reopened.snapshot());
    assert!(reopened.snapshot().models.is_empty());
    assert!(!reopened.snapshot().modified);
    let mut error = 0.0_f32;
    let mut peak = 0.0_f32;
    for block in 0..550 {
        session.pump()?;
        reopened.pump()?;
        let input: Vec<_> = (0..128)
            .map(|i| {
                if block < 400 {
                    0.0
                } else {
                    0.02 + 0.03 * ((block * 128 + i) as f32 * 0.019).sin()
                }
            })
            .collect();
        let (mut a, mut b, mut x, mut y) = ([0.0; 128], [0.0; 128], [0.0; 128], [0.0; 128]);
        session.process(&[&input, &input], &mut [&mut a, &mut b])?;
        reopened.process(&[&input, &input], &mut [&mut x, &mut y])?;
        if block >= 400 {
            for (old, new) in a.iter().chain(&b).zip(x.iter().chain(&y)) {
                error = error.max((old - new).abs());
                peak = peak.max(new.abs());
            }
        }
    }
    assert!(
        peak > 1e-6 && error < 1e-5,
        "Mixed model Save PCM differs: {error}, peak={peak}"
    );
    // Exercise the actual IPC model command and asynchronous owner polling too.
    let mut child = spawn_with_models(
        &data.join("bundles"),
        &data.join("process"),
        false,
        Some(&data),
    )?;
    let received = replies(&mut child)?;
    let start = StartRig {
        midi: None,
        revision: revision.clone(),
        stream: stream(),
        recall: None,
        prepared: vec![],
    };
    send(&mut child, &start)?;
    let mut live = received.recv_timeout(Duration::from_secs(30))??;
    for (asset, insert) in [(&nam, false), (&nam, true), (&ir, true)] {
        let target = if insert {
            live.control
                .slots
                .iter()
                .find(|s| s.node == node)
                .unwrap()
                .slots
                .iter()
                .find(|s| s.position.lane == 0)
                .unwrap()
                .target
                .clone()
        } else {
            target.clone()
        };
        send(
            &mut child,
            &WorkerRequest::Model {
                command: model_command(&live.control, &node, &target, asset),
            },
        )?;
        live = received.recv_timeout(Duration::from_secs(3))??;
        assert!(live.error.is_none(), "{:?}", live.error);
        let started = Instant::now();
        loop {
            if live
                .control
                .model_change
                .as_ref()
                .is_some_and(|m| m.progress.phase == oxidal_audio::lifecycle::ModelPhase::Applied)
            {
                break;
            }
            assert!(live.control.model_change.as_ref().is_none_or(|m|m.progress.phase!=oxidal_audio::lifecycle::ModelPhase::Failed),"{:?}",live.control.model_change);
            assert!(started.elapsed() < Duration::from_secs(20));
            std::thread::sleep(Duration::from_millis(20));
            send(&mut child, &WorkerRequest::Status)?;
            live = received.recv_timeout(Duration::from_secs(3))??;
        }
    }
    assert_eq!(live.control.models[0].assignments.len(), 3);
    assert!(live.control.valid_model_state());
    let mut saver = spawn_with_models(
        &data.join("bundles"),
        &data.join("export"),
        true,
        Some(&data),
    )?;
    send(
        &mut saver,
        &SaveRequest {
            settings: start,
            recall: live.control.recall(),
            name: "Independent hybrid model export".into(),
        },
    )?;
    saver.0.stdin.take();
    wait(&mut saver, 60)?;
    let mut output = Vec::new();
    saver.0.stdout.take().unwrap().read_to_end(&mut output)?;
    let saved: String = serde_json::from_slice(&output)?;
    let before = live.processed_frames;
    send(&mut child, &WorkerRequest::Status)?;
    live = received.recv_timeout(Duration::from_secs(3))??;
    assert!(live.processed_frames > before);
    child.0.stdin.take();
    wait(&mut child, 5)?;
    std::fs::remove_dir_all(data.join("audition-models"))?;
    let fresh = Session::new(store.read(&saved)?, world, 48000.0, 128, BUFFER_BUDGET)?;
    compare(&live.control, &fresh.snapshot());
    assert!(fresh.snapshot().models.is_empty());
    println!(
        "mixed live NAM replacement/insertion + IR, failed candidate preservation, model-backed recovery, independent Save and cache-free recall passed; PCM max_error={error}"
    );
    Ok(())
}

pub fn qualify_scenes(bundle: &Bundle, root: &Path, world: &World) -> Result<()> {
    use oxidal_audio::midi::{ControlMode, Decoder, ParameterBinding};
    let native_target = {
        let mut session = Session::new(bundle.clone(), world, 48000.0, 128, BUFFER_BUDGET)?;
        let target = session
            .snapshot()
            .controls
            .iter()
            .find(|c| matches!(&c.target, Target::Native {parameter,..} if parameter == "toneBass"))
            .ok_or("Missing native MIDI qualification control")?
            .target
            .clone();
        let settings = oxidal_audio::midi::Settings {
            input: "hw:Unavailable,0,0".into(),
            channel: 1,
            bindings: vec![],
            branch_bindings: vec![],
            parameter_bindings: vec![ParameterBinding {
                target: target.clone(),
                controller: 21,
                mode: ControlMode::Absolute,
            }],
        };
        session.snapshot().validate_midi(&settings)?;
        let mut decoder = Decoder::default();
        for byte in [0xb0, 21, 32] {
            if let Some(message) = decoder.push(byte) {
                assert!(session.midi_message(&settings, message)?);
            }
        }
        let confirmed = session.snapshot();
        let control = confirmed
            .controls
            .iter()
            .find(|c| c.target == target)
            .unwrap();
        let expected = control.minimum + (control.maximum - control.minimum) * 32.0 / 127.0;
        assert!(
            (control.value - expected).abs() < 0.00051,
            "MIDI native readback: {} expected {expected}",
            control.value
        );
        assert!(confirmed.modified);
        target
    };
    let path = root.join("worker-rigs");
    let store = BundleStore::new(path.clone());
    let revision = store.save(bundle)?;
    let start = StartRig {
        midi: Some(oxidal_audio::midi::Settings {
            input: "hw:Unavailable,0,0".into(),
            channel: 1,
            bindings: vec![],
            branch_bindings: vec![],
            parameter_bindings: vec![ParameterBinding {
                target: Target::Native {
                    node: "removed-node".into(),
                    parameter: "deleted-control".into(),
                },
                controller: 23,
                mode: ControlMode::Absolute,
            }],
        }),
        prepared: vec![],
        revision,
        stream: stream(),
        recall: None,
    };
    let mut child = spawn(&path, &root.join("scene-child"), false)?;
    let received = replies(&mut child)?;
    send(&mut child, &start)?;
    let before = received.recv_timeout(Duration::from_secs(30))??;
    assert!(before.error.is_none());
    assert_eq!(before.control.scene.as_deref(), Some("clean"));
    let missing = oxidal_audio::midi::Settings {
        branch_bindings: vec![],
        parameter_bindings: vec![ParameterBinding {
            target: native_target,
            controller: 21,
            mode: ControlMode::Absolute,
        }],
        input: "hw:Unavailable,0,0".into(),
        channel: 1,
        bindings: vec![oxidal_audio::midi::Binding {
            scene: "lead".into(),
            program: Some(1),
            controller: None,
        }],
    };
    send(
        &mut child,
        &WorkerRequest::Midi {
            settings: Some(missing.clone()),
        },
    )?;
    let configured = received.recv_timeout(Duration::from_secs(3))??;
    assert!(configured.error.is_none());
    let mut disconnected = false;
    for _ in 0..100 {
        send(&mut child, &WorkerRequest::Status)?;
        let status = received.recv_timeout(Duration::from_secs(3))??;
        if status.control.midi.error.is_some() && status.processed_frames > before.processed_frames
        {
            assert!(!status.control.midi.connected);
            disconnected = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(
        disconnected,
        "Missing MIDI device must report failure while PCM advances"
    );
    let mut invalid = missing;
    invalid.bindings[0].scene = "unknown".into();
    send(
        &mut child,
        &WorkerRequest::Midi {
            settings: Some(invalid),
        },
    )?;
    assert!(
        received
            .recv_timeout(Duration::from_secs(3))??
            .error
            .is_some()
    );
    send(&mut child, &WorkerRequest::Midi { settings: None })?;
    let disabled = received.recv_timeout(Duration::from_secs(3))??;
    assert!(disabled.error.is_none() && disabled.control.midi.error.is_none());
    let command = SceneCommand {
        session: before.control.session.clone(),
        expected_revision: before.control.revision,
        scene: "lead".into(),
    };
    send(
        &mut child,
        &WorkerRequest::Scene {
            command: command.clone(),
        },
    )?;
    let mut selected = received.recv_timeout(Duration::from_secs(3))??;
    assert!(selected.error.is_none());
    assert_eq!(selected.control.scene.as_deref(), Some("lead"));
    assert!(selected.processed_frames >= before.processed_frames);
    send(&mut child, &WorkerRequest::Scene { command })?;
    let stale = received.recv_timeout(Duration::from_secs(3))??;
    assert!(stale.error.is_some());
    compare(&selected.control, &stale.control);
    let mut advanced = false;
    for _ in 0..100 {
        send(&mut child, &WorkerRequest::Status)?;
        let status = received.recv_timeout(Duration::from_secs(3))??;
        if status.processed_frames > before.processed_frames && !status.control.scene_transitioning
        {
            assert_eq!(status.control.scene.as_deref(), Some("lead"));
            advanced = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(advanced, "PCM did not finish the scene ramp");
    send(
        &mut child,
        &WorkerRequest::Branch {
            command: BranchCommand {
                session: selected.control.session.clone(),
                expected_revision: selected.control.revision,
                branch: "clean".into(),
                enabled: true,
            },
        },
    )?;
    selected = received.recv_timeout(Duration::from_secs(3))??;
    assert!(selected.error.is_none() && selected.control.scene.is_none());
    assert!(selected.control.branches.iter().all(|b| b.enabled));
    let mut saver = spawn(&path, &root.join("scene-export"), true)?;
    send(
        &mut saver,
        &SaveRequest {
            settings: start.clone(),
            recall: selected.control.recall(),
            name: "Offline scenes".into(),
        },
    )?;
    saver.0.stdin.take();
    wait(&mut saver, 60)?;
    let mut bytes = Vec::new();
    saver
        .0
        .stdout
        .take()
        .unwrap()
        .take(1024)
        .read_to_end(&mut bytes)?;
    let saved: String = serde_json::from_slice(&bytes)?;
    assert_eq!(
        store.read(&saved)?.manifest().scenes()?,
        bundle.manifest().scenes()?
    );
    child.0.stdin.take();
    wait(&mut child, 10)?;
    let mut restored = spawn(&path, &root.join("scene-restore"), false)?;
    let received = replies(&mut restored)?;
    send(
        &mut restored,
        &StartRig {
            revision: saved,
            ..start
        },
    )?;
    let recalled = received.recv_timeout(Duration::from_secs(30))??;
    assert!(recalled.error.is_none());
    assert!(recalled.control.scene.is_none());
    assert!(recalled.control.branches.iter().all(|b| b.enabled));
    compare(&selected.control, &recalled.control);
    restored.0.stdin.take();
    wait(&mut restored, 10)?;
    Ok(())
}
