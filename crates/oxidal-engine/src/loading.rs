//! Explicit bundle-to-backend preparation on the native owner, before streaming.
use crate::{PreparedPorts, Processor, ports::PreparationBudget};
use oxidal_lv2::{Plugin, PluginInfo, World};
use oxidal_presets::{
    Bundle,
    manifest::{Lv2Instance, NodeKind, ProcessingRole, SceneNativeControl},
};
use oxidal_tone3000::{Engine, InputMode};

use crate::native_profile_id;
use oxidal_presets::manifest::SceneNativeBypass;
type PreparedSource = (
    PreparedPorts,
    Option<Vec<SceneNativeControl>>,
    Option<Vec<SceneNativeBypass>>,
);
#[derive(Clone, Copy)]
pub(crate) struct NativeRecovery<'a> {
    pub(crate) working: Option<(&'a std::path::Path, &'a [crate::protocol::NodeWorking])>,
    pub(crate) models: &'a [crate::protocol::NodeModels],
}

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
        Self::from_bundle_working(bundle, world, rate, frames, buffer_budget, None)
    }
    pub fn from_bundle_working(
        bundle: &Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        buffer_budget: usize,
        working: Option<(&std::path::Path, &[crate::protocol::NodeWorking])>,
    ) -> Result<Self, String> {
        Self::load_bundle(
            bundle,
            world,
            rate,
            frames,
            PreparationBudget::standalone(bundle, buffer_budget),
            NativeRecovery {
                working,
                models: &[],
            },
            false,
        )
        .map(|(graph, _, _)| graph)
    }
    pub(crate) fn load_for_session(
        bundle: &Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: PreparationBudget,
        recovery: NativeRecovery<'_>,
    ) -> Result<PreparedSource, String> {
        Self::load_bundle(bundle, world, rate, frames, budget, recovery, true)
    }
    fn load_bundle(
        bundle: &Bundle,
        world: &World,
        rate: f64,
        frames: usize,
        budget: PreparationBudget,
        recovery: NativeRecovery<'_>,
        collect_defaults: bool,
    ) -> Result<PreparedSource, String> {
        let working = recovery.working;
        let manifest = bundle.manifest();
        manifest.validate().map_err(|e| e.to_string())?;
        manifest
            .check_required_extensions()
            .map_err(|e| e.to_string())?;
        if !rate.is_finite() || !(8000.0..=192000.0).contains(&rate) || frames == 0 || frames > 2048
        {
            return Err("Invalid bundle audio configuration".into());
        }
        let host = manifest
            .oxidal
            .as_ref()
            .ok_or("Explicit host graph required")?;
        if host.lv2.iter().any(|p| !p.required_features.is_empty()) {
            return Err("Unsupported declared feature or tail policy".into());
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
            .is_none_or(|bytes| bytes > budget.host)
        {
            return Err("Port graph exceeds its host buffer budget".into());
        }
        let profile = native_profile_id()?;
        for native in &manifest.tone3000.instances {
            if native.profile != profile {
                return Err("Unsupported native preset profile".into());
            }
            if native.role() != ProcessingRole::Whole && native.partition.is_none() {
                return Err("Extracted stages require paired state restoration".into());
            }
        }
        let native_settings = manifest
            .playback_native_settings()
            .map_err(|e| e.to_string())?;
        if let Some((root, rows)) = working
            && (!root.is_absolute()
                || rows.iter().enumerate().any(|(i, row)| {
                    !crate::protocol::valid_revision(&row.receipt)
                        || rows[..i].iter().any(|p| p.node == row.node)
                        || !host.graph.nodes.iter().any(|node| {
                            node.id == row.node
                                && node.kind == NodeKind::Tone3000
                                && manifest.tone3000.instances.iter().any(|n| {
                                    Some(&n.id) == node.instance.as_ref()
                                        && n.role() == ProcessingRole::Whole
                                })
                        })
                }))
        {
            return Err("Invalid native working catalog".into());
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
        let mut processors = crate::partition::prepare(bundle, rate, frames)?;
        let mut saved = collect_defaults.then(Vec::new);
        let mut bypass = collect_defaults.then(Vec::new);
        for node in &host.graph.nodes {
            if let Some(Processor::Native(engine)) =
                node.instance.as_ref().and_then(|id| processors.get_mut(id))
                && let Some(defaults) = bypass.take()
            {
                bypass = saved_bypass(engine, &node.id, defaults);
            }
        }
        for native in &manifest.tone3000.instances {
            if native.partition.is_some() {
                continue;
            }
            let mut engine = Engine::new(rate, frames).map_err(|e| e.to_string())?;
            let settings = native_settings
                .as_ref()
                .and_then(|settings| settings.instances.get(&native.id));
            if let Some(settings) = settings {
                // Fix the processing domain before loading embedded models,
                // so background preparation starts with the saved rate.
                for id in ["osFactor", "osEnabled"] {
                    engine
                        .set_normalized(id, settings.parameters[id])
                        .map_err(|e| e.to_string())?;
                }
                engine.pump().map_err(|e| e.to_string())?;
            }
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
            if let Some(settings) = settings {
                engine
                    .set_input_mode(settings.input_mode)
                    .map_err(|e| e.to_string())?;
                for (id, value) in &settings.parameters {
                    engine
                        .set_normalized(id, *value)
                        .map_err(|e| e.to_string())?;
                }
                engine
                    .wait_ready()
                    .map_err(|e| format!("Native instance {}: {e}", native.id))?;
                let catalog: Vec<oxidal_tone3000::protocol::Parameter> =
                    serde_json::from_value(engine.catalog().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                if settings.parameters.iter().any(|(id, value)| {
                    !catalog
                        .iter()
                        .any(|p| p.id == *id && (p.normalized - *value as f64).abs() < 1e-5)
                }) {
                    return Err("Native instance setting readback differs".into());
                }
            }
            if let Some(defaults) = bypass.take() {
                let node = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| n.instance.as_ref() == Some(&native.id))
                    .ok_or("Missing native node")?;
                engine
                    .wait_ready()
                    .map_err(|e| format!("Native instance {}: {e}", native.id))?;
                bypass = saved_bypass(&mut engine, &node.id, defaults);
            }
            if let Some((root, rows)) = working {
                let node = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| n.instance.as_ref() == Some(&native.id))
                    .ok_or("Missing native node")?;
                if let Some(row) = rows.iter().find(|r| r.node == node.id) {
                    if let Some(defaults) = saved.take() {
                        saved = saved_before_working(&mut engine, &node.id, defaults);
                    }
                    let state = oxidal_tone3000::working::read(
                        root,
                        &row.receipt,
                        &crate::session::authoring::origin(bundle.revision(), &node.id),
                    )?;
                    engine.restore(&state).map_err(|e| e.to_string())?;
                    engine.wait_ready().map_err(|e| e.to_string())?;
                }
            }
            processors.insert(native.id.clone(), Processor::Native(engine));
        }
        // Restore verified model assignments before computing the fixed
        // layout and arming inner slots. Their saved defaults came from the
        // original engines, before recovery changed any asset or added IDs.
        if !recovery.models.is_empty() {
            let (root, working_rows) = working.ok_or("Model asset store unavailable")?;
            for (index, row) in recovery.models.iter().enumerate() {
                let instance = host
                    .graph
                    .nodes
                    .iter()
                    .find(|n| n.id == row.node)
                    .and_then(|node| node.instance.as_deref())
                    .ok_or("Missing native model recovery node")?;
                let Some(Processor::Native(engine)) = processors.get_mut(instance) else {
                    return Err("Missing native model recovery processor".into());
                };
                if row.assignments.is_empty()
                    || !oxidal_audio::lifecycle::valid_models(&row.assignments)
                    || recovery.models[..index]
                        .iter()
                        .any(|old| old.node == row.node)
                {
                    return Err("Invalid native model recovery catalog".into());
                }
                for assignment in &row.assignments {
                    crate::session::models::validate_model_assignment(
                        bundle, &row.node, assignment,
                    )?;
                }
                if !working_rows.iter().any(|w| w.node == row.node)
                    && let Some(defaults) = saved.take()
                {
                    saved = saved_before_working(engine, &row.node, defaults);
                }
                oxidal_tone3000::model_preparation::restore(engine, root, &row.assignments, frames)
                    .map_err(|e| e.to_string())?;
            }
        }
        for plugin in &host.lv2 {
            processors.insert(
                plugin.id.clone(),
                Processor::Lv2(Plugin::new_ports(world, &plugin.plugin_uri, rate, frames)?),
            );
        }
        let graph = Self::new_with_budget(bundle, processors, rate, frames, budget)?;
        Ok((graph, saved, bypass))
    }
}

fn saved_bypass(
    engine: &mut Engine,
    node: &str,
    mut saved: Vec<SceneNativeBypass>,
) -> Option<Vec<SceneNativeBypass>> {
    for row in engine.scene_bypass_candidates().ok()? {
        if saved.len() >= crate::session::MAX_CAPTURE_DEFAULTS
            || !SceneNativeBypass::valid_block(&row.block)
            || saved
                .iter()
                .any(|old| old.node == node && old.block == row.block)
        {
            return None;
        }
        saved.push(SceneNativeBypass {
            node: node.into(),
            block: row.block,
            value: row.value,
        });
    }
    Some(saved)
}

fn saved_before_working(
    engine: &mut Engine,
    node: &str,
    mut saved: Vec<SceneNativeControl>,
) -> Option<Vec<SceneNativeControl>> {
    for row in engine.block_controls().ok()? {
        let value = SceneNativeControl {
            node: node.into(),
            parameter: row.id,
            value: f64::from(row.value as f32),
        };
        if !row.staged && value.capture_parameter().is_some() {
            saved.push(value);
            if saved.len() > crate::session::MAX_CAPTURE_DEFAULTS {
                return None;
            }
        }
    }
    Some(saved)
}

pub(crate) fn control_values(
    instance: &Lv2Instance,
    info: &PluginInfo,
) -> Result<Vec<(u32, f32)>, String> {
    if info.ports.iter().any(|p| p.atom)
        && instance.state.is_none()
        && !oxidal_lv2::scalar_state_complete(info)
    {
        return Err("Atom effects require an explicit portable state resource".into());
    }
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
