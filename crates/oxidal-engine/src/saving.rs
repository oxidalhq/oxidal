//! Isolated export only: reconstruct confirmed scalar state, never serialize the
//! playing native instance. No audio device is opened by this path.
use crate::{Processor, Session, protocol::*};
use oxidal_lv2::World;
use oxidal_presets::{
    Bundle, BundleStore,
    manifest::{Origin, Resource, ResourceKind},
};
use std::collections::{BTreeMap, BTreeSet};

pub fn save_revision(
    store: &BundleStore,
    world: &World,
    request: SaveRequest,
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
    session.restore(&request.recall)?;
    let confirmed = session.snapshot();
    let mut manifest = original.manifest().clone();
    manifest.name = request.name.clone();
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
        if !changed {
            continue;
        } // Exact unchanged native bytes, including unknown fields.
        let Some(Processor::Native(engine)) = session.graph.processor_mut(&node.id) else {
            return Err("Missing native processor".into());
        };
        let expected = engine.live_controls().map_err(|e| e.to_string())?;
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
