//! Optional Linux LV2 hosting. Native plugin code is trusted, not sandboxed.
//! @see docs/lv2.md
#![deny(unsafe_code)]
#[cfg(feature = "native")]
#[allow(unsafe_code)]
mod host;
#[cfg(feature = "native")]
pub use host::{Plugin, World};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Port {
    pub index: u32,
    pub symbol: String,
    pub audio: bool,
    pub control: bool,
    pub input: bool,
    pub output: bool,
    pub integer: bool,
    pub toggled: bool,
    pub logarithmic: bool,
    pub latency: bool,
    pub minimum: Option<f32>,
    pub maximum: Option<f32>,
    pub default: Option<f32>,
}
impl Port {
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub uri: String,
    pub ports: Vec<Port>,
    pub unsupported: Option<String>,
}

#[cfg(feature = "native")]
mod graph;
#[cfg(feature = "native")]
pub use graph::{Binding, PreparedGraph};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_controls_preserve_logarithmic_and_discrete_ranges() {
        let mut p = Port {
            index: 0,
            symbol: "control".into(),
            audio: false,
            control: true,
            input: true,
            output: false,
            integer: false,
            toggled: false,
            logarithmic: true,
            latency: false,
            minimum: Some(20.0),
            maximum: Some(20000.0),
            default: Some(1000.0),
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
}
