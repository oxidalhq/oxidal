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
