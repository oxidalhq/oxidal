//! Narrow device administration protocol. Credentials are never part of readback.
//! @see docs/device-service.md
#[cfg(unix)]
pub mod ipc;
#[cfg(unix)]
pub mod network;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE: usize = 65536;
pub const SOCKET: &str = "/run/oxidal-device/control.sock";

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Status {},
    Scan {},
    Join {
        interface: String,
        ssid: String,
        password: String,
    },
    Hotspot {
        interface: String,
        ssid: String,
        password: String,
    },
    Confirm {
        transaction: String,
    },
    Cancel {
        transaction: String,
    },
    Forget {
        uuid: String,
    },
}
impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Status {} => "Status",
            Self::Scan {} => "Scan",
            Self::Join { .. } => "Join [redacted]",
            Self::Hotspot { .. } => "Hotspot [redacted]",
            Self::Confirm { .. } => "Confirm",
            Self::Cancel { .. } => "Cancel",
            Self::Forget { .. } => "Forget",
        })
    }
}
impl Command {
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Join {
                interface,
                ssid,
                password,
            }
            | Self::Hotspot {
                interface,
                ssid,
                password,
            } => {
                if interface.is_empty()
                    || interface.len() > 15
                    || !interface
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err("Invalid wireless interface");
                }
                if ssid.is_empty() || ssid.len() > 32 || ssid.chars().any(char::is_control) {
                    return Err("SSID must contain 1–32 bytes without control characters");
                }
                // Initial slice deliberately admits WPA2-Personal only, never silently opens an AP.
                if !(8..=63).contains(&password.len())
                    || !password.bytes().all(|b| (32..=126).contains(&b))
                {
                    return Err("Use an 8–63 character WPA2 password");
                }
            }
            Self::Confirm { transaction } | Self::Cancel { transaction }
                if (transaction.len() != 32
                    || !transaction.bytes().all(|b| b.is_ascii_hexdigit())) =>
            {
                return Err("Invalid network transaction");
            }
            Self::Forget { uuid }
                if (uuid.len() != 36
                    || !uuid.bytes().enumerate().all(|(i, b)| {
                        if [8, 13, 18, 23].contains(&i) {
                            b == b'-'
                        } else {
                            b.is_ascii_hexdigit()
                        }
                    })) =>
            {
                return Err("Invalid connection identifier");
            }
            _ => {}
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Interface {
    pub name: String,
    pub kind: String,
    pub state: String,
    pub connection: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AccessPoint {
    pub ssid: String,
    pub signal: u8,
    pub security: String,
    pub active: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SavedNetwork {
    pub uuid: String,
    pub name: String,
    pub active: bool,
    pub managed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Pending {
    pub transaction: String,
    pub seconds_remaining: u64,
    pub phase: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NetworkState {
    pub available: bool,
    pub wireless_enabled: bool,
    pub interfaces: Vec<Interface>,
    pub networks: Vec<AccessPoint>,
    pub saved: Vec<SavedNetwork>,
    pub pending: Option<Pending>,
    pub message: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub state: Option<NetworkState>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validate_and_redact_credentials() {
        let command = Command::Join {
            interface: "wlan0".into(),
            ssid: "Studio: Wi-Fi".into(),
            password: "never-log-this".into(),
        };
        assert!(command.validate().is_ok());
        assert!(!format!("{command:?}").contains("never-log-this"));
        let mut value = serde_json::to_value(command).unwrap();
        value["interface"] = "wlan0\nreboot".into();
        assert!(
            serde_json::from_value::<Command>(value)
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(serde_json::from_str::<Command>(r#"{"type":"status","shell":"reboot"}"#).is_err());
    }
}
