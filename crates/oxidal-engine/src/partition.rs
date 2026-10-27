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
    if recipe.controls.is_empty() {
        return Ok(());
    }
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
        .map_err(|e| e.to_string())
}
pub(crate) fn capture(instance: &mut NativeInstance, engine: &mut Engine) -> Result<(), String> {
    let recipe = instance
        .partition
        .as_mut()
        .ok_or("Missing partition recipe")?;
    recipe.controls = engine
        .live_controls()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| (c.target, f64::from(c.value)))
        .collect();
    Ok(())
}
