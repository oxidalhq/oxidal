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
    let bytes = one_model(root, name, asset, false)?;
    // A fresh engine proves the saved preset really carries the one model.
    let mut verify = Engine::new(48000.0, 128)?;
    verify.load_preset(&bytes)?;
    verify
        .wait_ready()
        .map_err(|error| format!("Saved model did not become ready: {error}"))?;
    verify_single_model(&mut verify)?;
    let info = OwnedStore::new(root.join("owned")).save_created(&bytes)?;
    Ok(info.id)
}

fn verify_single_model(engine: &mut Engine) -> Result<(), Box<dyn std::error::Error>> {
    let runtime = engine.runtime()?;
    if !runtime["blocks"]
        .as_array()
        .is_some_and(|blocks| blocks.len() == 1 && blocks[0]["loaded"].as_bool() == Some(true))
    {
        return Err("The saved preset does not contain exactly one model".into());
    }
    Ok(())
}

/// Render a one-model native preset for isolated bundle preparation.
pub fn render(root: &Path, name: &str, asset: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    one_model(root, name, asset, true)
}

fn one_model(
    root: &Path,
    name: &str,
    asset: &str,
    for_bundle: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let name = name.trim();
    if !valid_preset_name(name) {
        return Err("Invalid preset name".into());
    }
    let mut engine = Engine::new(48000.0, 128)?;
    engine.reset_empty()?;
    if for_bundle {
        // Leave headroom for the full rig and keep the shared cabinet linear.
        engine.set_normalized("osEnabled", 0.0)?;
        engine.set_normalized("gateEnabled", 0.0)?;
        engine.pump()?;
    }
    let slot = engine
        .slots()?
        .into_iter()
        .find(|slot| slot.position.lane == 0)
        .ok_or("The empty rig has no insertion slot")?;
    let assignment = ModelAssignment {
        target: slot.target,
        asset: asset.to_owned(),
        insertion: Some(slot.position),
    };
    if !assignment.valid() {
        return Err("Invalid model reference".into());
    }
    model_preparation::restore(&mut engine, root, &[assignment], 128)?;
    engine
        .wait_ready()
        .map_err(|error| format!("Selected model did not become ready: {error}"))?;
    verify_single_model(&mut engine)?;
    Ok(engine.save_preset(name)?)
}
