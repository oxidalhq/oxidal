//! Exercise scene controls on the maintained whole A2 and derived amp/cab fixtures.
use oxidal_engine::{
    Session,
    protocol::{AuthoringCommand, ControlCommand, SceneCommand, Snapshot, StartRig, Target},
    save_revision,
};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{SCENES_NATIVE_EXTENSION, SceneNativeControl},
};
use serde_json::json;
use std::{collections::BTreeMap, error::Error, path::Path};

const BLOCK: usize = 128;
const BUDGET: usize = 1024 * 1024;

fn current(s: &Snapshot, target: &SceneNativeControl) -> f64 {
    s.controls
        .iter()
        .find(|c| {
            matches!(&c.target, Target::Native { node, parameter }
            if *node == target.node && *parameter == target.parameter)
        })
        .unwrap()
        .value
}
fn matches(s: &Snapshot, targets: &[SceneNativeControl]) {
    for target in targets {
        assert_eq!(
            current(s, target),
            f64::from(target.value as f32),
            "{target:?}"
        );
    }
}
fn select(session: &mut Session, id: &str) -> Result<(), String> {
    let s = session.snapshot();
    session.select_scene(SceneCommand {
        session: s.session,
        expected_revision: s.revision,
        scene: id.into(),
        release_ms: None,
        native_bypass_preview: None,
    })
}
fn render(session: &mut Session, block: usize) -> Result<[f32; BLOCK], String> {
    let l = std::array::from_fn::<_, BLOCK, _>(|sample| {
        0.045 * ((block * BLOCK + sample) as f32 * 0.031).sin()
    });
    let (mut out, mut right) = ([0.0; BLOCK], [0.0; BLOCK]);
    session.pump()?;
    session.process(&[&l, &l], &mut [&mut out, &mut right])?;
    assert!(out.iter().chain(&right).all(|x| x.is_finite()));
    Ok(out)
}
fn peak_diff(left: &[f32; BLOCK], right: &[f32; BLOCK]) -> f32 {
    left.iter()
        .zip(right)
        .fold(0.0, |worst, (a, b)| worst.max((a - b).abs()))
}

pub(super) fn qualify(
    base: Bundle,
    world: &World,
    root: &Path,
    addresses: &[(&str, &str)],
    whole: bool,
) -> Result<(), Box<dyn Error>> {
    let defaults = Session::new(base.clone(), world, 48000.0, BLOCK, BUDGET)?
        .snapshot()
        .capture_defaults;
    let wet: Vec<_> = addresses
        .iter()
        .map(|(node, name)| {
            defaults
                .iter()
                .find(|entry| {
                    entry.node == *node
                        && entry
                            .parameter
                            .rsplit_once(':')
                            .is_some_and(|(_, parameter)| parameter == *name)
                })
                .cloned()
                .ok_or("Missing capture default")
        })
        .collect::<Result<_, _>>()?;
    let mut shifted = wet.clone();
    let changed_targets = if whole { 1 } else { shifted.len() };
    for target in shifted.iter_mut().take(changed_targets) {
        let delta = if target.value > 0.6 { -0.09 } else { 0.09 };
        target.value = f64::from((target.value + delta) as f32);
    }
    let resources = base
        .manifest()
        .resources
        .iter()
        .map(|r| (r.id.clone(), base.resource(&r.id).unwrap().to_vec()))
        .collect::<BTreeMap<_, _>>();
    let mut value = serde_json::to_value(base.manifest())?;
    value["extensions"] = json!({SCENES_NATIVE_EXTENSION: {
        "fade_ms": 5, "initial_scene": "shifted", "scenes": [
            {"id":"base","name":"Base","gains":[],"native_controls":wet},
            {"id":"shifted","name":"Shifted","gains":[],"native_controls":shifted}
        ]
    }});
    value["requiredExtensions"] = json!([SCENES_NATIVE_EXTENSION]);
    let bundle = Bundle::from_parts(serde_json::to_vec(&value)?, resources.clone())?;
    let mut invalid = value.clone();
    let wrong = if whole {
        "block:unknown:outputGain"
    } else {
        &wet[1].parameter
    };
    for i in 0..2 {
        invalid["extensions"][SCENES_NATIVE_EXTENSION]["scenes"][i]["native_controls"][0]["parameter"] =
            json!(wrong);
    }
    let invalid = Bundle::from_parts(serde_json::to_vec(&invalid)?, resources)?;
    assert!(
        Session::new(invalid, world, 48000.0, BLOCK, BUDGET)
            .unwrap_err()
            .contains("Invalid native scene control target")
    );
    let mut s = Session::new(bundle.clone(), world, 48000.0, BLOCK, BUDGET)?;
    let startup = s.snapshot();
    assert_eq!(startup.scene.as_deref(), Some("shifted"));
    assert_eq!(startup.capture_defaults, defaults);
    assert!(!startup.scene_transitioning && !startup.modified);
    matches(&startup, &shifted);
    select(&mut s, "base")?;
    let mut reference = Session::new(bundle.clone(), world, 48000.0, BLOCK, BUDGET)?;
    select(&mut reference, "base")?;
    for block in 0..48 {
        render(&mut s, block)?;
        render(&mut reference, block)?;
    }
    let stale = s.snapshot();
    select(&mut s, "shifted")?;
    let changed = s.snapshot();
    matches(&changed, &shifted);
    assert!(changed.scene_transitioning);
    assert!(
        s.select_scene(SceneCommand {
            session: stale.session,
            expected_revision: stale.revision,
            scene: "base".into(),
            release_ms: None,
            native_bypass_preview: None,
        })
        .is_err()
    );
    let first = peak_diff(&render(&mut s, 48)?, &render(&mut reference, 48)?);
    select(&mut s, "base")?;
    let reverse = peak_diff(&render(&mut s, 49)?, &render(&mut reference, 49)?);
    let mut retargeted = 0.0;
    for block in 50..76 {
        retargeted = peak_diff(&render(&mut s, block)?, &render(&mut reference, block)?);
    }
    assert!(
        retargeted < 2e-4,
        "retarget did not reach base: {retargeted}"
    );
    assert!(!s.snapshot().scene_transitioning);
    select(&mut s, "shifted")?;
    let mut endpoint = 0.0;
    for block in 76..102 {
        endpoint = peak_diff(&render(&mut s, block)?, &render(&mut reference, block)?);
    }
    assert!(
        endpoint > 1e-4 && first.max(reverse) < endpoint * 0.45,
        "unexpected capture gain transition: first={first}, reverse={reverse}, endpoint={endpoint}"
    );

    // Save while ramping to base. Base differs from the bundle's starting scene.
    select(&mut s, "base")?;
    let pending = s.snapshot();
    assert!(pending.scene_transitioning);
    let store = BundleStore::new(root.join(if whole {
        "capture-whole"
    } else {
        "capture-partition"
    }));
    let revision = store.save(&bundle)?;
    let saved = save_revision(
        &store,
        world,
        oxidal_engine::protocol::SaveRequest {
            settings: StartRig {
                midi: None,
                prepared: vec![],
                revision,
                stream: super::partition::stream(),
                recall: None,
            },
            recall: pending.recall(),
            name: "Saved capture scene".into(),
        },
    )?;
    let saved = store.read(&saved)?;
    assert_eq!(
        saved.manifest().scenes()?.unwrap().initial_scene.as_deref(),
        Some("base")
    );
    if !whole {
        for (old, new) in bundle
            .manifest()
            .tone3000
            .instances
            .iter()
            .zip(&saved.manifest().tone3000.instances)
        {
            assert_eq!(bundle.resource(&old.preset), saved.resource(&new.preset));
            assert_eq!(new.partition.as_ref().unwrap().version, 2);
        }
    }
    let reopened = Session::new(saved, world, 48000.0, BLOCK, BUDGET)?.snapshot();
    matches(&reopened, &wet);
    assert!(!reopened.scene_transitioning);
    super::worker::qualify_capture_scenes(
        &bundle,
        &root.join(if whole {
            "capture-whole-null"
        } else {
            "capture-partition-null"
        }),
    )?;
    if whole {
        qualify_working(s, bundle, world, root, &wet[0], &defaults)?;
    }
    println!(
        "native scene captures ({addresses:?}): exact target, rapid retarget, saved defaults, isolated Save/reopen passed; first={first:.6}, endpoint={endpoint:.6}"
    );
    Ok(())
}

fn qualify_working(
    mut s: Session,
    bundle: Bundle,
    world: &World,
    root: &Path,
    target: &SceneNativeControl,
    defaults: &[SceneNativeControl],
) -> Result<(), Box<dyn Error>> {
    use oxidal_audio::structure::{AuthoringAction, ChainLane, StructureEdit};
    let root = root.join("capture-working");
    std::fs::create_dir_all(&root)?;
    let (block, _) = target.capture_parameter().unwrap();
    let command = |s: &Session, action| {
        let cursor = s.snapshot();
        AuthoringCommand {
            session: cursor.session,
            expected_revision: cursor.revision,
            node: target.node.clone(),
            action,
        }
    };
    let before = s.snapshot();
    let remove = command(
        &s,
        AuthoringAction::Remove {
            block_id: block.into(),
        },
    );
    assert!(
        s.authoring_command(remove, &root)
            .unwrap_err()
            .contains("remove a capture scene control")
    );
    assert_eq!(s.snapshot().revision, before.revision);
    s.apply(ControlCommand {
        session: before.session,
        expected_revision: before.revision,
        target: Target::Native {
            node: target.node.clone(),
            parameter: target.parameter.clone(),
        },
        value: 0.77,
    })?;
    let duplicate = command(
        &s,
        AuthoringAction::Edit {
            edit: StructureEdit::Duplicate {
                block_id: block.into(),
                lane: ChainLane::Left,
                index: 1,
            },
        },
    );
    s.authoring_command(duplicate, &root)?;
    let confirmed = s.snapshot();
    let mut recovered = Session::new_with_working(
        bundle,
        world,
        48000.0,
        BLOCK,
        BUDGET,
        Some((&root, &confirmed.working)),
    )?;
    recovered.restore(&confirmed.recall())?;
    let fresh = recovered.snapshot();
    let normalize = |rows: &[SceneNativeControl]| {
        rows.iter()
            .map(|r| ((r.node.clone(), r.parameter.clone()), r.value))
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(normalize(&fresh.capture_defaults), normalize(defaults));
    assert_eq!(current(&fresh, target), f64::from(0.77_f32));
    assert!(fresh.controls.len() > before.controls.len()); // the working-only capture survived
    Ok(())
}
