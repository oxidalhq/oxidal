//! Optional Linux LV2 hosting. Native plugin code is trusted, not sandboxed.
//! @see docs/lv2.md
#![deny(unsafe_code)]
#[cfg(feature = "native")]
#[allow(unsafe_code)]
mod host;
#[cfg(feature = "native")]
pub use host::{AtomEvent, ControlError, Plugin, PluginState, StatePath, StateProperty, World};
pub mod protocol;
pub use protocol::Binding;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Port {
    pub index: u32,
    pub symbol: String,
    pub audio: bool,
    pub control: bool,
    #[serde(default)]
    pub atom: bool,
    pub input: bool,
    pub output: bool,
    pub integer: bool,
    pub toggled: bool,
    pub logarithmic: bool,
    pub latency: bool,
    pub minimum: Option<f32>,
    pub maximum: Option<f32>,
    pub default: Option<f32>,
    /// Named values (`lv2:scalePoint`), sorted by value; empty when none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scale_points: Vec<ScalePoint>,
}
/// One named value of a control, such as a mode or note division, so the
/// interface can show "Ping-pong" rather than "2".
/// @see docs/lv2.md
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScalePoint {
    pub value: f32,
    pub label: String,
}
impl ScalePoint {
    /// Most points kept for one port; longer enumerations keep the first ones.
    pub const LIMIT: usize = 64;
    /// Keeps finite, in-range, nonempty points of at most 64 bytes, sorted by
    /// value; the first label wins when a plugin repeats a value.
    pub fn bounded(
        raw: Vec<(f32, String)>,
        minimum: Option<f32>,
        maximum: Option<f32>,
    ) -> Vec<Self> {
        let (Some(lo), Some(hi)) = (minimum, maximum) else {
            return Vec::new();
        };
        let mut points: Vec<Self> = Vec::new();
        for (value, label) in raw.into_iter().take(Self::LIMIT) {
            let label = label.trim();
            if !value.is_finite()
                || !(lo..=hi).contains(&value)
                || label.is_empty()
                || label.len() > 64
                || points.iter().any(|p| p.value == value)
            {
                continue;
            }
            points.push(Self {
                value,
                label: label.to_owned(),
            });
        }
        points.sort_by(|a, b| a.value.total_cmp(&b.value));
        points
    }
}
/// Curated plugins whose complete sound is represented by scalar controls.
/// Their Atom ports carry UI preset messages; no messages are sent in this mode.
/// Unknown plugins and changed port layouts still require portable state.
/// @see docs/lv2.md
pub fn scalar_state_complete(info: &PluginInfo) -> bool {
    #[derive(Deserialize)]
    struct Layout {
        controls: Vec<String>,
        atoms: Vec<String>,
    }
    static LAYOUTS: std::sync::OnceLock<std::collections::BTreeMap<String, Layout>> =
        std::sync::OnceLock::new();
    let layouts = LAYOUTS.get_or_init(|| {
        serde_json::from_str(include_str!("../scalar-state.json"))
            .expect("checked scalar state layouts")
    });
    let Some(layout) = layouts.get(&info.uri) else {
        return false;
    };
    let mut controls: Vec<_> = info
        .ports
        .iter()
        .filter(|p| p.control && p.input)
        .map(|p| p.symbol.clone())
        .collect();
    let mut atoms: Vec<_> = info
        .ports
        .iter()
        .filter(|p| p.atom)
        .map(|p| p.symbol.clone())
        .collect();
    controls.sort();
    atoms.sort();
    info.unsupported.is_none() && controls == layout.controls && atoms == layout.atoms
}

impl Port {
    /// The scale-point name for an exact native value, else three decimals.
    pub fn display(&self, value: f32) -> String {
        self.scale_points
            .iter()
            .find(|p| p.value == value)
            .map_or_else(|| format!("{value:.3}"), |p| p.label.clone())
    }
    pub fn normalize(&self, value: f32) -> Result<f32, String> {
        let (lo, hi) = self.range()?;
        if !value.is_finite() || !(lo..=hi).contains(&value) {
            return Err("Value outside native range".into());
        }
        Ok(if self.logarithmic {
            (value / lo).ln() / (hi / lo).ln()
        } else {
            (value - lo) / (hi - lo)
        })
    }
    pub fn denormalize(&self, value: f32) -> Result<f32, String> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err("Expected finite normalized value".into());
        }
        let (lo, hi) = self.range()?;
        let value = if self.logarithmic {
            lo * (hi / lo).powf(value)
        } else {
            lo + value * (hi - lo)
        };
        Ok(if self.toggled {
            if value >= (lo + hi) * 0.5 { hi } else { lo }
        } else if self.integer {
            value.round().clamp(lo, hi)
        } else {
            value.clamp(lo, hi)
        })
    }
    fn range(&self) -> Result<(f32, f32), String> {
        let (lo, hi) = (
            self.minimum.ok_or("Missing minimum")?,
            self.maximum.ok_or("Missing maximum")?,
        );
        if !self.input
            || !self.control
            || !lo.is_finite()
            || !hi.is_finite()
            || lo >= hi
            || (self.logarithmic && lo <= 0.0)
        {
            return Err("Unsupported control range".into());
        }
        Ok((lo, hi))
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PluginInfo {
    pub name: String,
    pub uri: String,
    /// The LV2 class label, such as "Delay" or "Reverb", when one is declared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// The declared author or maker, used to group effects by source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub ports: Vec<Port>,
    pub unsupported: Option<String>,
}

#[cfg(feature = "native")]
mod graph;
#[cfg(feature = "native")]
pub use graph::PreparedGraph;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn curated_scalar_state_requires_exact_plugin_and_port_layout() {
        let layouts: serde_json::Value =
            serde_json::from_str(include_str!("../scalar-state.json")).unwrap();
        let uri = "https://github.com/michaelwillis/dragonfly-reverb";
        let layout = &layouts[uri];
        let ports = ["controls", "atoms"]
            .into_iter()
            .flat_map(|kind| {
                layout[kind]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(move |name| Port {
                        index: 0,
                        symbol: name.as_str().unwrap().into(),
                        audio: false,
                        control: kind == "controls",
                        atom: kind == "atoms",
                        input: true,
                        output: false,
                        integer: false,
                        toggled: false,
                        logarithmic: false,
                        latency: false,
                        minimum: Some(0.0),
                        maximum: Some(1.0),
                        default: Some(0.0),
                        scale_points: Vec::new(),
                    })
            })
            .collect();
        let mut info = PluginInfo {
            uri: uri.into(),
            name: "Hall".into(),
            category: None,
            author: None,
            ports,
            unsupported: None,
        };
        assert!(scalar_state_complete(&info));
        info.ports[0].symbol.push_str("-changed");
        assert!(!scalar_state_complete(&info));
        info.ports[0].symbol = layout["controls"][0].as_str().unwrap().into();
        info.uri = "urn:dragonfly:room".into();
        assert!(!scalar_state_complete(&info));
        info.uri = uri.into();
        info.unsupported = Some("New unsupported feature".into());
        assert!(!scalar_state_complete(&info));
    }

    #[test]
    fn native_controls_preserve_logarithmic_and_discrete_ranges() {
        let mut p = Port {
            index: 0,
            symbol: "control".into(),
            audio: false,
            control: true,
            atom: false,
            input: true,
            output: false,
            integer: false,
            toggled: false,
            logarithmic: true,
            latency: false,
            minimum: Some(20.0),
            maximum: Some(20000.0),
            default: Some(1000.0),
            scale_points: Vec::new(),
        };
        let value = p.denormalize(0.5).unwrap();
        assert!((value - (20.0_f32 * 20000.0).sqrt()).abs() < 0.001);
        assert!((p.normalize(value).unwrap() - 0.5).abs() < 1e-6);
        assert!(p.denormalize(f32::NAN).is_err());
        assert!(p.normalize(0.0).is_err());
        p.logarithmic = false;
        p.minimum = Some(0.0);
        p.maximum = Some(4.0);
        p.integer = true;
        assert_eq!(p.denormalize(0.7).unwrap(), 3.0);
        p.integer = false;
        p.toggled = true;
        p.maximum = Some(1.0);
        assert_eq!(p.denormalize(0.49).unwrap(), 0.0);
        assert_eq!(p.denormalize(0.5).unwrap(), 1.0);
    }

    #[test]
    fn scale_points_name_exact_values_and_drop_unusable_entries() {
        let raw = vec![
            (2.0, "Ping-pong".to_owned()),
            (0.0, " Mono ".to_owned()),
            (1.0, "Stereo".to_owned()),
            (1.0, "Duplicate".to_owned()),
            (f32::NAN, "Nonfinite".to_owned()),
            (9.0, "Out of range".to_owned()),
            (3.0, String::new()),
            (3.0, "x".repeat(65)),
        ];
        let points = ScalePoint::bounded(raw, Some(0.0), Some(4.0));
        let labels: Vec<_> = points.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["Mono", "Stereo", "Ping-pong"]);
        assert!(ScalePoint::bounded(vec![(0.0, "A".into())], None, Some(1.0)).is_empty());
        let many = (0..100).map(|i| (i as f32, format!("{i}"))).collect();
        assert_eq!(
            ScalePoint::bounded(many, Some(0.0), Some(200.0)).len(),
            ScalePoint::LIMIT
        );
        let port = Port {
            index: 0,
            symbol: "mode".into(),
            audio: false,
            control: true,
            atom: false,
            input: true,
            output: false,
            integer: true,
            toggled: false,
            logarithmic: false,
            latency: false,
            minimum: Some(0.0),
            maximum: Some(4.0),
            default: Some(0.0),
            scale_points: points,
        };
        assert_eq!(port.display(2.0), "Ping-pong");
        assert_eq!(port.display(4.0), "4.000");
        // Serialized catalogs omit the field when a port has no points, and
        // older fixtures without it still parse.
        let mut json = serde_json::to_value(&port).unwrap();
        assert_eq!(json["scale_points"][0]["label"], "Mono");
        json.as_object_mut().unwrap().remove("scale_points");
        let old: Port = serde_json::from_value(json).unwrap();
        assert!(old.scale_points.is_empty());
        assert!(
            serde_json::to_value(&old)
                .unwrap()
                .get("scale_points")
                .is_none()
        );
    }
}

/// Fresh installed metadata, checked against the same admission rules as the host.
/// This is not an instantiation, state-restoration or real-time guarantee.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PluginCatalog {
    pub sample_rate: u32,
    pub plugins: Vec<PluginInfo>,
}
pub const CATALOG_LIMIT: usize = 4 * 1024 * 1024;
impl PluginCatalog {
    pub fn validate(&self) -> Result<(), String> {
        if !(8000..=192000).contains(&self.sample_rate) || self.plugins.len() > 4096 {
            return Err("Invalid LV2 catalog bounds".into());
        }
        let mut uris = std::collections::BTreeSet::new();
        for plugin in &self.plugins {
            if plugin.uri.is_empty()
                || plugin.uri.len() > 4096
                || plugin.name.is_empty()
                || plugin.name.len() > 4096
                || plugin.uri.contains(char::is_control)
                || plugin.name.contains(char::is_control)
                || [&plugin.category, &plugin.author].iter().any(|t| {
                    t.as_ref()
                        .is_some_and(|t| t.len() > 256 || t.contains(char::is_control))
                })
                || !uris.insert(&plugin.uri)
                || plugin.ports.len() > 128
                || plugin.unsupported.as_ref().is_some_and(|s| s.len() > 4096)
            {
                return Err("Invalid LV2 catalog metadata".into());
            }
            let mut symbols = std::collections::BTreeSet::new();
            for (index, port) in plugin.ports.iter().enumerate() {
                if port.index as usize != index
                    || port.symbol.is_empty()
                    || port.symbol.len() > 4096
                    || port.symbol.contains(char::is_control)
                    || !symbols.insert(&port.symbol)
                    || [port.minimum, port.maximum, port.default]
                        .into_iter()
                        .flatten()
                        .any(|v| !v.is_finite())
                {
                    return Err("Invalid LV2 port metadata".into());
                }
            }
        }
        Ok(())
    }
}

/// Shared authored ABI fixture for maintained engine qualification, never a user effect.
#[cfg(feature = "qualification")]
pub fn qualification_bundle() -> &'static std::path::Path {
    std::path::Path::new(env!("OXIDAL_LV2_FIXTURE"))
}
