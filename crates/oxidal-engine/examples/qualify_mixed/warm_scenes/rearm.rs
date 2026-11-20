//! Prospective native edits must re-arm their exact targets before PCM handoff.
use super::*;
use oxidal_audio::{
    lifecycle::ModelAssignment,
    structure::{AuthoringAction, ChainLane, StructureEdit},
};
use oxidal_engine::{ResidentSet, prepare_native_edit, save_revision_with_models};

pub(super) fn qualify(
    bundle: &Bundle,
    world: &World,
    root: &Path,
    node: &str,
    amp: &str,
    cab: &str,
) -> Result<()> {
    let store = BundleStore::new(root.join(format!("warm-rearm-{node}")));
    store.save(bundle)?;
    let mut settings = StartRig {
        revision: bundle.revision().into(),
        prepared: Vec::new(),
        stream: super::super::partition::stream(),
        recall: None,
        midi: None,
    };
    let reopen = |settings: &StartRig| {
        ResidentSet::new_with_models(&store, world, settings, BUFFER_BUDGET, Some(root))
    };
    let before = reopen(&settings)?.snapshot();
    settings.recall = Some(before.recall());
    let prepare = |settings: &StartRig, operation| {
        prepare_native_edit(
            &store,
            world,
            PrepareNativeEdit {
                settings: settings.clone(),
                node: node.into(),
                operation,
            },
            root,
        )
    };
    if node == "tone" {
        let edit = |action| PreparedNativeEdit::Authoring { action };
        assert!(
            prepare(
                &settings,
                edit(AuthoringAction::Remove {
                    block_id: amp.into()
                })
            )
            .is_err()
        );
        assert!(settings.recall.as_ref().unwrap().working.is_empty());
        settings.recall = Some(prepare(
            &settings,
            edit(AuthoringAction::Parameter {
                parameter: "osEnabled".into(),
                value: 1.0,
            }),
        )?);
        let oversampled = reopen(&settings)?.snapshot();
        assert!(!oversampled.working.is_empty());
        assert_eq!(before.native_bypass_armed, oversampled.native_bypass_armed);
        assert_eq!(
            before.native_bypass_defaults,
            oversampled.native_bypass_defaults
        );
        assert!(
            oversampled.authoring[0]
                .status
                .settings
                .iter()
                .any(|p| p.target == "osEnabled" && p.value == 1.0)
        );
        settings.recall = Some(prepare(
            &settings,
            edit(AuthoringAction::Edit {
                edit: StructureEdit::Reorder {
                    lane: ChainLane::Left,
                    block_ids: {
                        let mut ids: Vec<_> = oversampled.authoring[0]
                            .status
                            .layout
                            .left
                            .iter()
                            .map(|b| b.id.clone())
                            .collect();
                        let amp_pos = ids.iter().position(|id| id == amp).unwrap();
                        let cab_pos = ids.iter().position(|id| id == cab).unwrap();
                        ids.swap(amp_pos, cab_pos);
                        ids
                    },
                },
            }),
        )?);
        let reordered = reopen(&settings)?.snapshot();
        assert_ne!(
            reordered.authoring[0].status.layout.left,
            oversampled.authoring[0].status.layout.left
        );
        settings.recall = Some(prepare(&settings, edit(AuthoringAction::Undo))?);
        let undone = reopen(&settings)?.snapshot();
        assert_eq!(
            undone.authoring[0].status.layout.left,
            oversampled.authoring[0].status.layout.left
        );
        assert_eq!(undone.native_bypass_armed, before.native_bypass_armed);
        println!(
            "Warm v5 staged whole edit: oversampling, reorder, Undo, stable IDs and orphan refusal"
        );
    }

    let bytes = std::fs::read(std::env::var("OXIDAL_TONE3000_TEST_MODEL")?)?;
    let pins: Value =
        serde_json::from_str(include_str!("../../../../../native/tone3000/sources.json"))?;
    let tone = json!({"id":4002,"title":"Staged A2 replacement","format":"nam","gear":"amp",
       "models":[{"id":4003,"name":"Pinned staged A2","model_url":"oxidal-model://fixture/staged.nam"}]});
    let asset = oxidal_presets::ModelStore::new(root.join("audition-models")).stage(
        &oxidal_presets::ModelAsset {
            schema: 1,
            tone_id: 4002,
            model_id: 4003,
            title: "Staged A2 replacement".into(),
            name: "Pinned staged A2".into(),
            format: "nam".into(),
            sha256: pins["qualification_model"]["sha256"]
                .as_str()
                .unwrap()
                .into(),
            tone,
        },
        &bytes,
    )?;
    let assignment = ModelAssignment {
        target: amp.into(),
        asset,
        insertion: None,
    };
    settings.recall = Some(prepare(
        &settings,
        PreparedNativeEdit::Model {
            assignment: assignment.clone(),
        },
    )?);
    let mut rig = reopen(&settings)?;
    let active = rig.snapshot();
    let format = if node == "tone" { "whole" } else { "derived" };
    assert_eq!(active.native_bypass_armed, before.native_bypass_armed);
    assert_eq!(active.native_bypass_defaults, before.native_bypass_defaults);
    if node == "tone" {
        assert!(active.models.is_empty());
        assert!(active.authoring[0].status.can_undo);
    } else {
        assert_eq!(active.models[0].assignments, [assignment]);
    }
    select(rig.active_mut(), "wet")?;
    for i in 0..28 {
        let _ = super::render(rig.active_mut(), i)?;
    }
    let saved = save_revision_with_models(
        &store,
        world,
        SaveRequest {
            settings: settings.clone(),
            recall: rig.snapshot().recall(),
            name: format!("Saved staged {format}"),
        },
        root,
    )?;
    let saved = store.read(&saved)?;
    assert_eq!(
        store.read(bundle.revision())?.resource("source"),
        bundle.resource("source")
    );
    let reopened = Session::new(saved, world, 48000.0, FRAMES, BUFFER_BUDGET)?;
    assert_eq!(
        reopened.snapshot().native_bypass_armed,
        before.native_bypass_armed
    );
    println!(
        "Warm v5 staged {format} model: protected stable IDs, real A2 prepare, scene recall, Save/reopen"
    );
    Ok(())
}
