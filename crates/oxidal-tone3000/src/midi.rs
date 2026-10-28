//! Hardware and qualification use the same actual native control dispatch.
use crate::Engine;
use oxidal_audio::midi::{ControlTarget, Message, Settings};
pub fn dispatch(
    engine: &mut Engine,
    settings: &Settings,
    message: Message,
    blocked: bool,
) -> Result<bool, String> {
    let Some((binding, raw)) = settings.parameter(message) else {
        return Ok(false);
    };
    if blocked {
        return Err("Finish the current native edit before MIDI control".into());
    }
    let ControlTarget::Native { node, parameter } = &binding.target else {
        return Err("Unavailable native MIDI target".into());
    };
    if node != "native" {
        return Err("Unavailable native MIDI node".into());
    }
    let controls = engine.live_controls().map_err(|e| e.to_string())?;
    let control = controls
        .iter()
        .find(|c| c.target == *parameter)
        .ok_or("MIDI parameter is unavailable")?;
    let Some(value) = control.midi_descriptor().midi_value(binding.mode, raw)? else {
        return Ok(true);
    };
    if value as f32 != control.value {
        engine
            .set_live_control(parameter, value as f32)
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}
