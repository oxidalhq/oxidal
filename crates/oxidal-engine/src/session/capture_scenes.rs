//! Capture control changes run on the native owner, before the next audio block.
use super::*;
use oxidal_presets::manifest::{MAX_SCENE_CONTROLS, SceneNativeControl};
use std::collections::BTreeMap;

// The pinned native capture input/output gain and mix smoothers use 50 ms.
// This duration is independent of the host merge and bypass fades.
const CAPTURE_FADE_MS: u32 = 50;

pub(super) fn saved_defaults(
    controls: &[Control],
    working: &[NodeWorking],
    saved_before_working: Option<Vec<SceneNativeControl>>,
) -> Vec<SceneNativeControl> {
    let Some(mut saved) = saved_before_working else {
        return Vec::new();
    };
    for c in controls {
        if let Target::Native { node, parameter } = &c.target
            && !working.iter().any(|w| &w.node == node)
        {
            let value = SceneNativeControl {
                node: node.clone(),
                parameter: parameter.clone(),
                value: c.value,
            };
            if value.capture_parameter().is_some() {
                saved.push(value);
                if saved.len() > MAX_CAPTURE_DEFAULTS {
                    return Vec::new();
                }
            }
        }
    }
    if serde_json::to_vec(&saved).is_ok_and(|bytes| bytes.len() <= MAX_CAPTURE_DEFAULT_BYTES) {
        saved
    } else {
        Vec::new()
    }
}

pub(super) fn matches_control(control: &Control, value: &SceneNativeControl) -> bool {
    matches!(&control.target, Target::Native { node, parameter }
        if *node == value.node && *parameter == value.parameter)
}

pub(super) fn check_targets(
    controls: &[Control],
    values: &[SceneNativeControl],
) -> Result<(), String> {
    if values.len() > MAX_SCENE_CONTROLS
        || values.iter().enumerate().any(|(i, target)| {
            target.capture_parameter().is_none()
                || values[..i]
                    .iter()
                    .any(|v| v.node == target.node && v.parameter == target.parameter)
                || !controls
                    .iter()
                    .any(|c| matches_control(c, target) && !c.toggle && c.accepts(target.value))
        })
    {
        return Err("Invalid native scene control target".into());
    }
    Ok(())
}

impl Session {
    pub(super) fn check_capture_scene(&self, values: &[SceneNativeControl]) -> Result<(), String> {
        check_targets(&self.state.controls, values)?;
        let prepared = &self
            .state
            .scenes
            .as_ref()
            .ok_or("Rig has no scenes")?
            .scenes[0]
            .native_controls;
        if values.len() != prepared.len()
            || values.iter().any(|v| {
                !prepared
                    .iter()
                    .any(|p| v.node == p.node && v.parameter == p.parameter)
            })
        {
            return Err("Incomplete native scene control targets".into());
        }
        Ok(())
    }

    pub(super) fn apply_capture_scene(
        &mut self,
        values: &[SceneNativeControl],
    ) -> Result<(), String> {
        let mut nodes: BTreeMap<&str, Vec<&SceneNativeControl>> = BTreeMap::new();
        for value in values {
            let current = self
                .state
                .controls
                .iter()
                .find(|c| matches_control(c, value))
                .ok_or("Missing native scene control")?;
            let target = f64::from(value.value as f32);
            if current.value != target {
                nodes.entry(&value.node).or_default().push(value);
            }
        }
        if nodes.is_empty() {
            return Ok(());
        }
        for (node, values) in nodes {
            let Some(Processor::Native(engine)) = self.graph.processor_mut(node) else {
                return Err("Missing native scene processor".into());
            };
            // The rig owner already holds its render lock. Write only the
            // exact capture parameters, then take one readback for this node.
            // The running native instance smooths from its current audio value.
            for value in &values {
                let (block, parameter) = value
                    .capture_parameter()
                    .ok_or("Invalid capture parameter")?;
                engine
                    .set_block(block, parameter, value.value as f32)
                    .map_err(|e| e.to_string())?;
            }
            let read = engine.live_controls().map_err(|e| e.to_string())?;
            for value in values {
                let actual = read
                    .iter()
                    .find(|c| c.target == value.parameter)
                    .filter(|c| c.value == value.value as f32)
                    .ok_or("Native scene control readback differs")?;
                let control = self
                    .state
                    .controls
                    .iter_mut()
                    .find(|c| matches_control(c, value))
                    .ok_or("Missing native scene control")?;
                control.value = f64::from(actual.value);
                control.display.clone_from(&actual.display);
            }
        }
        self.capture_fade_remaining = self.fade_frames(CAPTURE_FADE_MS) as usize;
        Ok(())
    }

    pub(super) fn protects_capture_target(&self, node: &str, block: Option<&str>) -> bool {
        self.state.scenes.as_ref().is_some_and(|scenes| {
            scenes.scenes[0].native_controls.iter().any(|target| {
                target.node == node
                    && block.is_none_or(|id| {
                        target
                            .capture_parameter()
                            .is_some_and(|(target, _)| target == id)
                    })
            })
        })
    }
}
