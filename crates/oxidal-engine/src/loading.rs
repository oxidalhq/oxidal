//! Explicit bundle-to-backend preparation on the native owner, before streaming.
use crate::{PreparedPorts, Processor};
use oxidal_lv2::{Plugin, PluginInfo, World};
use oxidal_presets::{
    Bundle,
    manifest::{Lv2Instance, NodeKind, ProcessingRole, Tails},
};
use oxidal_tone3000::{Engine, InputMode};
use std::collections::BTreeMap;

use crate::native_profile_id;
impl PreparedPorts {
    /// Load exact verified payloads and installed plugins. Discovery/instantiation
    /// must not overlap a running DSP callback from the same plugin library.
    /// This is preparation, not a live graph-replacement or gapless operation.
    pub fn from_bundle(
        bundle: &Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        buffer_budget: usize,
    ) -> Result<Self, String> {
        let manifest = bundle.manifest();
        manifest.validate().map_err(|e| e.to_string())?;
        manifest
            .check_required_extensions()
            .map_err(|e| e.to_string())?;
        if !rate.is_finite()
            || !(8000.0..=192000.0).contains(&rate)
            || frames == 0
            || frames > 2048
            || !frames.is_power_of_two()
        {
            return Err("Invalid bundle audio configuration".into());
        }
        let host = manifest
            .oxidal
            .as_ref()
            .ok_or("Explicit host graph required")?;
        if host.recall.tails != Tails::Cut
            || host.lv2.iter().any(|p| {
                p.state.is_some() || !p.assets.is_empty() || !p.required_features.is_empty()
            })
        {
            return Err("Unsupported portable state, feature or tail policy".into());
        }
        let samples = host
            .graph
            .nodes
            .iter()
            .try_fold(0usize, |total, n| {
                usize::from(n.audio_inputs.max(n.audio_outputs))
                    .checked_mul(frames)
                    .and_then(|value| total.checked_add(value))
            })
            .ok_or("Port buffer size overflow")?;
        if samples
            .checked_mul(size_of::<f32>())
            .is_none_or(|bytes| bytes > buffer_budget)
        {
            return Err("Port graph exceeds its host buffer budget".into());
        }
        let profile = native_profile_id()?;
        for native in &manifest.tone3000.instances {
            if native.profile != profile {
                return Err("Unsupported native preset profile".into());
            }
            if native.role() != ProcessingRole::Whole {
                return Err("Extracted stages require paired state restoration".into());
            }
        }
        let catalog = world.plugins(rate)?;
        // Check every declaration before instantiating any processor. A missing
        // plugin/control/profile never partially replaces an existing graph.
        for node in &host.graph.nodes {
            match node.kind {
                NodeKind::Tone3000 if node.audio_inputs != 2 || node.audio_outputs != 2 => {
                    return Err("Native bundle loader requires stereo ABI ports".into());
                }
                NodeKind::Lv2 => {
                    let instance = host
                        .lv2
                        .iter()
                        .find(|p| Some(&p.id) == node.instance.as_ref())
                        .ok_or("Missing LV2 declaration")?;
                    let info = catalog
                        .iter()
                        .find(|p| p.uri == instance.plugin_uri)
                        .ok_or("Required LV2 plugin is not installed")?;
                    if let Some(reason) = &info.unsupported {
                        return Err(reason.clone());
                    }
                    if info.ports.iter().filter(|p| p.audio && p.input).count()
                        != usize::from(node.audio_inputs)
                        || info.ports.iter().filter(|p| p.audio && p.output).count()
                            != usize::from(node.audio_outputs)
                    {
                        return Err("Declared LV2 ports differ from installed plugin".into());
                    }
                    control_values(instance, info)?;
                }
                _ => {}
            }
        }
        let mut processors = BTreeMap::new();
        for native in &manifest.tone3000.instances {
            let mut engine = Engine::new(rate, frames).map_err(|e| e.to_string())?;
            engine
                .load_preset(
                    bundle
                        .resource(&native.preset)
                        .ok_or("Missing verified native payload")?,
                )
                .map_err(|e| e.to_string())?;
            // Hardware selection belongs to StreamConfig.input_map. Embedded
            // whole-native blocks receive both routed ports; native mono chains
            // perform their own documented fold, stereo chains retain two lanes.
            engine
                .set_input_mode(InputMode::Stereo)
                .map_err(|e| e.to_string())?;
            processors.insert(native.id.clone(), Processor::Native(engine));
        }
        for plugin in &host.lv2 {
            processors.insert(
                plugin.id.clone(),
                Processor::Lv2(Plugin::new_ports(world, &plugin.plugin_uri, rate, frames)?),
            );
        }
        Self::new(bundle, processors, rate, frames, buffer_budget)
    }
}

pub(crate) fn control_values(
    instance: &Lv2Instance,
    info: &PluginInfo,
) -> Result<Vec<(u32, f32)>, String> {
    let controls: Vec<_> = info.ports.iter().filter(|p| p.input && p.control).collect();
    if controls.len() != instance.controls.len() {
        return Err("Portable LV2 controls must be complete".into());
    }
    controls
        .into_iter()
        .map(|port| {
            let value = *instance
                .controls
                .get(&port.symbol)
                .ok_or("Missing LV2 control symbol")?;
            if !value.is_finite()
                || (port.integer && value.fract() != 0.0)
                || (port.toggled
                    && Some(value) != port.minimum.map(f64::from)
                    && Some(value) != port.maximum.map(f64::from))
            {
                return Err("Invalid discrete portable LV2 value".into());
            }
            let native = value as f32;
            port.normalize(native)?;
            Ok((port.index, native))
        })
        .collect()
}
