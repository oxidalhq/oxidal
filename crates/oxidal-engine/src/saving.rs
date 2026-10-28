//! Isolated export only: reconstruct confirmed scalar state, never serialize the
//! playing native instance. No audio device is opened by this path.
use crate::{Processor, Session, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{Origin, Resource, ResourceKind},
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub fn save_revision(
    store: &BundleStore,
    world: &World,
    request: SaveRequest,
) -> Result<String, String> {
    save_with_assets(store, world, request, None)
}
pub fn save_revision_with_models(
    store: &BundleStore,
    world: &World,
    request: SaveRequest,
    root: &std::path::Path,
) -> Result<String, String> {
    save_with_assets(store, world, request, Some(root))
}
fn save_with_assets(
    store: &BundleStore,
    world: &World,
    request: SaveRequest,
    model_root: Option<&std::path::Path>,
) -> Result<String, String> {
    request.settings.validate()?;
    if !oxidal_audio::lifecycle::valid_preset_name(&request.name)
        || request.recall.source_revision != request.settings.revision
    {
        return Err("Invalid save identity or name".into());
    }
    let original = store
        .read(&request.settings.revision)
        .map_err(|e| e.to_string())?;
    let rate = f64::from(request.settings.stream.input.sample_rate);
    let frames = request.settings.stream.input.period_frames as usize;
    let mut session = Session::new(original.clone(), world, rate, frames, BUFFER_BUDGET)?;
    if request.recall.models.is_empty() {
        session.restore(&request.recall)?;
    } else {
        session.restore_with_models(
            &request.recall,
            model_root.ok_or("Model asset store is unavailable")?,
        )?;
    }
    let confirmed = session.snapshot();
    let mut manifest = original.manifest().clone();
    manifest.name = request.name.clone();
    if let Some(authoring) = manifest.extensions.get_mut("urn:oxidal:authoring") {
        authoring.remove("draft");
    }
    let mut resources: BTreeMap<String, Vec<u8>> = manifest
        .resources
        .iter()
        .map(|r| {
            Ok((
                r.id.clone(),
                original.resource(&r.id).ok_or("Missing resource")?.to_vec(),
            ))
        })
        .collect::<Result<_, String>>()?;
    let host = manifest.oxidal.as_mut().ok_or("Missing host graph")?;
    for control in &confirmed.controls {
        match &control.target {
            Target::Native { .. } => (),
            Target::Lv2 { node, symbol } => {
                let node = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| &n.id == node)
                    .ok_or("Missing node")?;
                let plugin = host
                    .lv2
                    .iter_mut()
                    .find(|p| Some(&p.id) == node.instance.as_ref())
                    .ok_or("Missing plugin")?;
                *plugin.controls.get_mut(symbol).ok_or("Missing port")? = control.value;
            }
            Target::Bypass { node } => {
                host.graph
                    .nodes
                    .iter_mut()
                    .find(|n| &n.id == node)
                    .ok_or("Missing node")?
                    .bypassed = Some(control.value == 1.0)
            }
            Target::Merge { node, port } => {
                *host
                    .graph
                    .nodes
                    .iter_mut()
                    .find(|n| &n.id == node)
                    .and_then(|n| n.input_gains.as_mut())
                    .and_then(|g| g.get_mut(*port))
                    .ok_or("Missing merge")? = control.value
            }
        }
    }
    for native in &mut manifest.tone3000.instances {
        let node = host
            .graph
            .nodes
            .iter()
            .find(|n| n.instance.as_ref() == Some(&native.id))
            .ok_or("Missing native node")?;
        let changed = confirmed.controls.iter().any(|c| {
            matches!(&c.target,Target::Native{node:id,..} if id==&node.id)
                && session
                    .initial
                    .iter()
                    .any(|old| old.target == c.target && old.value != c.value)
        });
        let models_changed = confirmed
            .models
            .iter()
            .any(|m| m.node == node.id && !m.assignments.is_empty());
        let eq_changed = confirmed.eq.iter().find(|e| e.node == node.id)
            != session.initial_eq.iter().find(|e| e.node == node.id);
        if !changed && !eq_changed && !models_changed {
            continue;
        } // Exact unchanged native bytes, including unknown fields.
        let Some(Processor::Native(engine)) = session.graph.processor_mut(&node.id) else {
            return Err("Missing native processor".into());
        };
        if native.partition.is_some() {
            // Preserve exact source bytes; standalone .t3kpreset serialization
            // would discard host roles and instance-only input/control allocation.
            crate::partition::capture(native, engine)?;
            continue;
        }
        let expected = engine.live_controls().map_err(|e| e.to_string())?;
        let expected_eq = engine.eq_snapshot().map_err(|e| e.to_string())?;
        let expected_models =
            oxidal_tone3000::model_preparation::identities(engine).map_err(|e| e.to_string())?;
        let bytes = engine
            .save_preset(&request.name)
            .map_err(|e| e.to_string())?;
        let mut verify = oxidal_tone3000::Engine::new(rate, frames).map_err(|e| e.to_string())?;
        verify.load_preset(&bytes).map_err(|e| e.to_string())?;
        verify
            .set_input_mode(oxidal_tone3000::InputMode::Stereo)
            .map_err(|e| e.to_string())?;
        verify.wait_ready().map_err(|e| e.to_string())?;
        let actual = verify.live_controls().map_err(|e| e.to_string())?;
        if oxidal_tone3000::model_preparation::identities(&mut verify).map_err(|e| e.to_string())?
            != expected_models
        {
            return Err("Saved model identities differ".into());
        }
        if verify.eq_snapshot().map_err(|e| e.to_string())? != expected_eq {
            return Err("Native EQ did not survive fresh recall".into());
        }
        if actual.len() != expected.len()
            || expected.iter().any(|c| {
                !actual
                    .iter()
                    .any(|a| a.target == c.target && (a.value - c.value).abs() < 1e-5)
            })
        {
            return Err("Native saved controls did not survive fresh recall".into());
        }
        if native.origin.is_none() {
            let source = resources
                .get(&native.preset)
                .ok_or("Missing source")?
                .clone();
            let resource = append(
                &mut manifest.resources,
                &mut resources,
                source,
                ResourceKind::Tone3000Source,
            )?;
            native.origin = Some(Origin {
                resource,
                source_preset_id: None,
            });
        }
        native.preset = append(
            &mut manifest.resources,
            &mut resources,
            bytes,
            ResourceKind::Tone3000Preset,
        )?;
    }
    let mut captured_states = BTreeMap::new();
    for plugin in &host.lv2 {
        let Some(state_id) = &plugin.state else {
            continue;
        };
        let node = host
            .graph
            .nodes
            .iter()
            .find(|n| n.instance.as_ref() == Some(&plugin.id))
            .ok_or("Missing LV2 state node")?;
        let state = session.graph.lv2_state(&node.id, &plugin.id)?;
        let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
        let resource = manifest
            .resources
            .iter_mut()
            .find(|r| &r.id == state_id)
            .ok_or("Missing state resource")?;
        resource.bytes = bytes.len() as u64;
        resource.sha256 = format!("{:x}", Sha256::digest(&bytes));
        resources.insert(state_id.clone(), bytes);
        captured_states.insert(plugin.id.clone(), (node.id.clone(), state));
    }
    let used: BTreeSet<_> = manifest
        .tone3000
        .instances
        .iter()
        .map(|n| n.preset.as_str())
        .collect();
    manifest
        .resources
        .retain(|r| r.kind != ResourceKind::Tone3000Preset || used.contains(r.id.as_str()));
    resources.retain(|id, _| manifest.resources.iter().any(|r| &r.id == id));
    let bundle = Bundle::from_parts(manifest.encode().map_err(|e| e.to_string())?, resources)
        .map_err(|e| e.to_string())?;
    // A saved partition must survive fresh derivation, not merely serialization.
    if bundle
        .manifest()
        .tone3000
        .instances
        .iter()
        .any(|n| n.partition.is_some())
    {
        let reopened = Session::new(bundle.clone(), world, rate, frames, BUFFER_BUDGET)?.snapshot();
        if reopened.eq != confirmed.eq
            || reopened.controls.len() != confirmed.controls.len()
            || confirmed.controls.iter().any(|c| {
                !reopened.controls.iter().any(|actual| {
                    actual.target == c.target && (actual.value - c.value).abs() < 1e-5
                })
            })
        {
            return Err("Saved partition controls did not survive fresh recall".into());
        }
    }
    if !captured_states.is_empty() {
        let mut reopened = Session::new(bundle.clone(), world, rate, frames, BUFFER_BUDGET)?;
        for (instance, (node, expected)) in captured_states {
            if reopened.graph.lv2_state(&node, &instance)? != expected {
                return Err("Saved LV2 state did not survive fresh recall".into());
            }
        }
    }
    store.save(&bundle).map_err(|e| e.to_string())
}
fn append(
    declarations: &mut Vec<Resource>,
    resources: &mut BTreeMap<String, Vec<u8>>,
    bytes: Vec<u8>,
    kind: ResourceKind,
) -> Result<String, String> {
    let hash = oxidal_presets::inspect(&bytes)
        .map_err(|e| e.to_string())?
        .sha256;
    // Allocate a fresh path rather than overwrite shared current/provenance assets.
    let (id, path) = (0usize..)
        .map(|i| (format!("saved_{i}"), format!("saved-{i}.t3kpreset")))
        .find(|(id, path)| {
            !resources.contains_key(id)
                && !declarations.iter().any(|r| {
                    r.path.eq_ignore_ascii_case(path)
                        || r.path.to_ascii_lowercase().starts_with(&format!("{path}/"))
                })
        })
        .ok_or("Resource names exhausted")?;
    declarations.push(Resource {
        id: id.clone(),
        path,
        kind,
        bytes: bytes.len() as u64,
        sha256: hash,
    });
    resources.insert(id.clone(), bytes);
    Ok(id)
}
