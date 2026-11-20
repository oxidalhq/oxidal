//! Native scene edges are changed together under the render owner.
use super::*;
use oxidal_presets::manifest::{SceneNativeBypass, SceneNativeControl};
use oxidal_tone3000::{SceneEdit, SceneParameter};
use std::collections::BTreeMap;

pub(super) fn enabled_target(node: &str, block: &str) -> Target {
    Target::Native {
        node: node.into(),
        parameter: format!("block:{block}:enabled"),
    }
}

impl Session {
    pub(super) fn armed_edit(&self, target: &Target) -> Option<(&str, &str)> {
        let Target::Native { node, parameter } = target else {
            return None;
        };
        let block = parameter.strip_prefix("block:")?.strip_suffix(":enabled")?;
        self.state
            .native_bypass_armed
            .as_ref()?
            .iter()
            .find(|key| key.node == *node && key.block == block)
            .map(|key| (key.node.as_str(), key.block.as_str()))
    }

    pub(super) fn has_armed_native_node(&self, node: &str) -> bool {
        self.state
            .native_bypass_armed
            .as_ref()
            .is_some_and(|armed| armed.iter().any(|key| key.node == node))
    }

    pub(super) fn apply_native_scene(
        &mut self,
        bypass: &[SceneNativeBypass],
        continuous: &[SceneNativeControl],
    ) -> Result<(), String> {
        let armed = self
            .state
            .native_bypass_armed
            .as_ref()
            .ok_or("Not a warm native scene")?;
        if bypass.len() != armed.len()
            || bypass.iter().any(|row| {
                !armed
                    .iter()
                    .any(|key| key.node == row.node && key.block == row.block)
            })
        {
            return Err("Incomplete warm native scene targets".into());
        }
        let mut groups = BTreeMap::<&str, Vec<_>>::new();
        let mut confirmed = Vec::new();
        for row in bypass {
            let target = enabled_target(&row.node, &row.block);
            let value = if row.value { 0.0 } else { 1.0 };
            self.stage_native_scene(
                &row.node,
                SceneEdit {
                    block: &row.block,
                    parameter: SceneParameter::Enabled,
                    value,
                },
                &target,
                &mut groups,
                &mut confirmed,
            )?;
        }
        for row in continuous {
            let (block, symbol) = row.capture_parameter().ok_or("Invalid capture control")?;
            let parameter = match symbol {
                "inputGain" => SceneParameter::InputGain,
                "outputGain" => SceneParameter::OutputGain,
                "mix" => SceneParameter::Mix,
                _ => return Err("Invalid capture control".into()),
            };
            let target = Target::Native {
                node: row.node.clone(),
                parameter: row.parameter.clone(),
            };
            self.stage_native_scene(
                &row.node,
                SceneEdit {
                    block,
                    parameter,
                    value: row.value as f32,
                },
                &target,
                &mut groups,
                &mut confirmed,
            )?;
        }
        self.graph.native_scene_batch(&groups, None)?;
        for (index, parameter, value) in confirmed {
            self.publish_native_scene_value(index, parameter, value);
        }
        Ok(())
    }

    fn stage_native_scene<'a>(
        &self,
        node: &'a str,
        edit: SceneEdit<'a>,
        target: &Target,
        groups: &mut BTreeMap<&'a str, Vec<SceneEdit<'a>>>,
        confirmed: &mut Vec<(usize, SceneParameter, f32)>,
    ) -> Result<(), String> {
        let index = self
            .state
            .controls
            .iter()
            .position(|control| control.target == *target && control.accepts(f64::from(edit.value)))
            .ok_or("Missing native scene control")?;
        confirmed.push((index, edit.parameter, edit.value));
        groups.entry(node).or_default().push(edit);
        Ok(())
    }

    pub(super) fn set_native_bypass(
        &mut self,
        index: usize,
        node: &str,
        block: &str,
        value: f32,
    ) -> Result<(), String> {
        let edit = SceneEdit {
            block,
            parameter: SceneParameter::Enabled,
            value,
        };
        self.graph
            .native_scene_batch(&BTreeMap::from([(node, vec![edit])]), None)?;
        self.publish_native_scene_value(index, SceneParameter::Enabled, value);
        Ok(())
    }

    fn publish_native_scene_value(&mut self, index: usize, parameter: SceneParameter, value: f32) {
        let control = &mut self.state.controls[index];
        control.value = f64::from(value);
        control.display = parameter.display(value);
    }
}
