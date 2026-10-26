//! Automatic hotspot selection. Visibility and connection state are distinct inputs.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Never,
    NoEthernet,
    NotAtHome,
    NoRemembered,
    Always,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub interface: String,
    pub mode: Mode,
    pub home_ssid: String,
}
impl Settings {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.interface.is_empty()
            || self.interface.len() > 15
            || !self
                .interface
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err("Invalid wireless interface");
        }
        if self.home_ssid.len() > 32
            || self.home_ssid.chars().any(char::is_control)
            || (self.mode == Mode::NotAtHome && self.home_ssid.is_empty())
        {
            return Err("Choose a home network for Not at home");
        }
        Ok(())
    }
    pub fn wants_hotspot(
        &self,
        ethernet: bool,
        home_visible: bool,
        remembered_visible: bool,
    ) -> bool {
        match self.mode {
            Mode::Never => false,
            Mode::Always => true,
            Mode::NoEthernet => !ethernet,
            Mode::NotAtHome => !home_visible,
            Mode::NoRemembered => !remembered_visible,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policies_follow_visibility_not_connection_or_internet() {
        for ethernet in [false, true] {
            for home in [false, true] {
                for remembered in [false, true] {
                    for (mode, expected) in [
                        (Mode::Never, false),
                        (Mode::Always, true),
                        (Mode::NoEthernet, !ethernet),
                        (Mode::NotAtHome, !home),
                        (Mode::NoRemembered, !remembered),
                    ] {
                        let s = Settings {
                            interface: "wlan0".into(),
                            mode,
                            home_ssid: "Home".into(),
                        };
                        assert_eq!(s.wants_hotspot(ethernet, home, remembered), expected);
                    }
                }
            }
        }
    }
}
