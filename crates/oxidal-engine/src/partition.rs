//! Guarded derivation from verified preset bytes. No raw native state import.
use crate::Processor;
use oxidal_presets::{
    Bundle,
    manifest::{NativeInstance, NativePartition, PartitionInput, ProcessingRole},
};
use oxidal_tone3000::{Engine, InputMode};
use std::collections::BTreeMap;

pub(crate) fn prepare(
    bundle: &Bundle,
    rate: f64,
    frames: usize,
) -> Result<BTreeMap<String, Processor>, String> {
    let mut processors = BTreeMap::new();
    let mut pairs: BTreeMap<&str, Vec<&NativeInstance>> = BTreeMap::new();
    for instance in &bundle.manifest().tone3000.instances {
        if let Some(recipe) = &instance.partition {
            pairs.entry(&recipe.pair).or_default().push(instance);
        }
    }
    for pair in pairs.values() {
        let instance = |role| -> Result<&NativeInstance, String> {
            pair.iter()
                .copied()
                .find(|n| n.role() == role)
                .ok_or("Missing partition peer".into())
        };
        let (amp_instance, cab_instance) = (
            instance(ProcessingRole::Amp)?,
            instance(ProcessingRole::Cab)?,
        );
        let recipe = amp_instance
            .partition
            .as_ref()
            .ok_or("Missing partition recipe")?;
        if rate != 48000.0 {
            return Err("Extracted stages require 48000 Hz".into());
        }
        let mut source = Engine::new(rate, frames).map_err(|e| e.to_string())?;
        source
            .load_preset(
                bundle
                    .resource(&amp_instance.preset)
                    .ok_or("Missing partition source")?,
            )
            .map_err(|e| e.to_string())?;
        source
            .set_input_mode(match recipe.input {
                PartitionInput::Left => InputMode::Left,
                PartitionInput::Right => InputMode::Right,
            })
            .map_err(|e| e.to_string())?;
        source.wait_ready().map_err(|e| e.to_string())?;
        // The recipe is an explicit classified-amp confirmation. All source,
        // asset, routing and processing guards run again on every restoration.
        // Pitch stays in the amp; external pitch is a separate capability.
        let split = source
            .split_amp_cab(&recipe.amp, &recipe.cab, true, false)
            .map_err(|e| e.to_string())?;
        let (mut amp, mut cab) = split.prepare(rate, frames).map_err(|e| e.to_string())?;
        apply(&mut amp, recipe)?;
        apply(
            &mut cab,
            cab_instance
                .partition
                .as_ref()
                .ok_or("Missing partition recipe")?,
        )?;
        processors.insert(amp_instance.id.clone(), Processor::Native(amp));
        processors.insert(cab_instance.id.clone(), Processor::Native(cab));
    }
    Ok(processors)
}
fn apply(engine: &mut Engine, recipe: &NativePartition) -> Result<(), String> {
    if !recipe.controls.is_empty() {
        let mut controls = engine.live_controls().map_err(|e| e.to_string())?;
        if controls.len() != recipe.controls.len() {
            return Err("Incomplete partition control catalog".into());
        }
        for c in &mut controls {
            let value = *recipe
                .controls
                .get(&c.target)
                .ok_or("Unknown partition control")?;
            if c.toggle && value != 0.0 && value != 1.0 {
                return Err("Invalid partition toggle".into());
            }
            let value = value as f32;
            if !c.accepts(value) {
                return Err("Invalid partition control value".into());
            }
            c.value = value;
        }
        engine
            .apply_live_snapshot(&controls)
            .map_err(|e| e.to_string())?;
    }
    if let Some(eq) = &recipe.eq {
        // This candidate is isolated. Use immediate owner edits rather than
        // consuming stage tokens that its later Session replay also owns.
        let current = engine.eq_snapshot().map_err(|e| e.to_string())?;
        if current.len() != eq.len()
            || current
                .iter()
                .zip(eq)
                .any(|(a, b)| a.block_id != b.block_id)
        {
            return Err("Partition EQ targets differ".into());
        }
        for block in eq {
            use oxidal_audio::eq::EqEdit;
            for (index, band) in block.eq.bands.iter().enumerate() {
                engine
                    .set_eq(
                        &block.block_id,
                        &EqEdit::Band {
                            index: index as u8,
                            band: band.clone(),
                        },
                    )
                    .map_err(|e| e.to_string())?;
            }
            for edit in [
                EqEdit::Pre {
                    value: block.eq.pre,
                },
                EqEdit::Enabled {
                    value: block.eq.enabled,
                },
            ] {
                engine
                    .set_eq(&block.block_id, &edit)
                    .map_err(|e| e.to_string())?;
            }
        }
        if engine.eq_snapshot().map_err(|e| e.to_string())? != *eq {
            return Err("Partition EQ did not survive derivation".into());
        }
    }
    Ok(())
}
pub(crate) fn capture(instance: &mut NativeInstance, engine: &mut Engine) -> Result<(), String> {
    let recipe = instance
        .partition
        .as_mut()
        .ok_or("Missing partition recipe")?;
    recipe.eq = Some(engine.eq_snapshot().map_err(|e| e.to_string())?);
    recipe.version = 2;
    recipe.controls = engine
        .live_controls()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| (c.target, f64::from(c.value)))
        .collect();
    Ok(())
}

/// Rebuild model-edited pair sources for an isolated named Save. Source provenance
/// remains in the bundle; no host-role state is serialized as a native preset.
pub(crate) fn model_sources(
    bundle: &Bundle,
    confirmed: &crate::protocol::Snapshot,
    root: &std::path::Path,
    frames: usize,
    name: &str,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let manifest = bundle.manifest();
    let host = manifest.oxidal.as_ref().ok_or("Missing host graph")?;
    let mut pairs: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    for instance in &manifest.tone3000.instances {
        let Some(recipe) = &instance.partition else {
            continue;
        };
        let node = host
            .graph
            .nodes
            .iter()
            .find(|n| n.instance.as_ref() == Some(&instance.id))
            .ok_or("Missing partition node")?;
        if let Some(models) = confirmed.models.iter().find(|m| m.node == node.id) {
            let target = match instance.role() {
                ProcessingRole::Amp => &recipe.amp,
                ProcessingRole::Cab => &recipe.cab,
                ProcessingRole::Whole => return Err("Invalid partition model role".into()),
            };
            if models.assignments.len() != 1
                || models.assignments[0].target != *target
                || models.assignments[0].insertion.is_some()
            {
                return Err("Partition model assignment differs from its guarded role".into());
            }
            pairs
                .entry(&recipe.pair)
                .or_default()
                .push((instance, models));
        }
    }
    let mut result = BTreeMap::new();
    for (pair, edits) in pairs {
        let instance = edits[0].0;
        let recipe = instance.partition.as_ref().unwrap();
        let mut source = Engine::new(48000.0, frames).map_err(|e| e.to_string())?;
        source
            .load_preset(
                bundle
                    .resource(&instance.preset)
                    .ok_or("Missing partition model source")?,
            )
            .map_err(|e| e.to_string())?;
        source
            .set_input_mode(match recipe.input {
                PartitionInput::Left => InputMode::Left,
                PartitionInput::Right => InputMode::Right,
            })
            .map_err(|e| e.to_string())?;
        source.wait_ready().map_err(|e| e.to_string())?;
        for (_, models) in edits {
            oxidal_tone3000::model_preparation::restore(
                &mut source,
                root,
                &models.assignments,
                frames,
            )
            .map_err(|e| e.to_string())?;
        }
        // Re-run the full guarded partition before publishing this replacement
        // source. It must still be a supported amp + short mono IR pair.
        source
            .split_amp_cab(&recipe.amp, &recipe.cab, true, false)
            .map_err(|e| e.to_string())?;
        result.insert(
            pair.into(),
            source.save_preset(name).map_err(|e| e.to_string())?,
        );
    }
    Ok(result)
}
