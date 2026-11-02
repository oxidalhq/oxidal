//! Isolated, non-PCM creation of a one-model native preset from a staged model.
//! The model must already be in the verified audition store; nothing here touches
//! the network, an audio device or the sounding rig.
//! @see docs/factory-collection.md
use crate::{Engine, model_preparation};
use oxidal_audio::lifecycle::{ModelAssignment, valid_preset_name};
use oxidal_presets::OwnedStore;
use std::path::Path;

/// Create an owned native preset named `name` holding one staged model, and return
/// its owned id. A failed run leaves the owned library unchanged.
pub fn create(root: &Path, name: &str, asset: &str) -> Result<String, Box<dyn std::error::Error>> {
    let name = name.trim();
    if !valid_preset_name(name) {
        return Err("Invalid preset name".into());
    }
    let mut engine = Engine::new(48000.0, 128)?;
    engine.reset_empty()?;
    let target = engine
        .slots()?
        .into_iter()
        .next()
        .ok_or("The empty rig has no insertion slot")?
        .target;
    let assignment = ModelAssignment {
        target,
        asset: asset.to_owned(),
        insertion: None,
    };
    if !assignment.valid() {
        return Err("Invalid model reference".into());
    }
    model_preparation::restore(&mut engine, root, &[assignment], 128)?;
    let bytes = engine.save_preset(name)?;
    drop(engine);
    // A fresh engine proves the saved preset really carries the one model.
    let mut verify = Engine::new(48000.0, 128)?;
    verify.load_preset(&bytes)?;
    verify.wait_ready()?;
    let blocks = verify.runtime()?["blocks"].as_array().map_or(0, Vec::len);
    if blocks != 1 {
        return Err("The saved preset does not contain exactly one model".into());
    }
    drop(verify);
    let info = OwnedStore::new(root.join("owned")).save_created(&bytes)?;
    Ok(info.id)
}
