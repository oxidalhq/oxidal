//! Narrow device administration protocol. Credentials are never part of readback.
//! @see docs/device-service.md
#[cfg(unix)]
pub mod ipc;
#[cfg(unix)]
pub mod network;
pub mod packs;
pub mod policy;
#[cfg(unix)]
pub mod power;
pub mod radio;
pub mod storage;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE: usize = 65536;
pub const SOCKET: &str = "/run/oxidal-device/control.sock";

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Power {
        action: PowerAction,
    },
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
        #[serde(default)]
        country: Option<String>,
        #[serde(default)]
        channel: Option<u8>,
    },
    Policy {
        settings: policy::Settings,
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
    Packs {},
    Pack {
        id: String,
        action: packs::PackAction,
    },
    StorageStatus {},
    Storage {
        mode: storage::StorageMode,
    },
}
impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Power { .. } => "Power",
            Self::Status {} => "Status",
            Self::Scan {} => "Scan",
            Self::Join { .. } => "Join [redacted]",
            Self::Hotspot { .. } => "Hotspot [redacted]",
            Self::Policy { .. } => "Policy",
            Self::Confirm { .. } => "Confirm",
            Self::Cancel { .. } => "Cancel",
            Self::Forget { .. } => "Forget",
            Self::Packs {} => "Packs",
            Self::Pack { .. } => "Pack",
            Self::StorageStatus {} => "StorageStatus",
            Self::Storage { .. } => "Storage",
        })
    }
}
impl Command {
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Self::Hotspot {
            country, channel, ..
        } = self
        {
            if country
                .as_ref()
                .is_some_and(|s| s.len() != 2 || !s.bytes().all(|b| b.is_ascii_uppercase()))
            {
                return Err("Use a two-letter country code");
            }
            if channel.is_some_and(|c| c > 13) {
                return Err("Use automatic or a supported 2.4 GHz channel");
            }
        }
        match self {
            Self::Policy { settings } => return settings.validate(),
            Self::Join {
                interface,
                ssid,
                password,
            }
            | Self::Hotspot {
                interface,
                ssid,
                password,
                ..
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
            Self::Pack { id, .. } if !packs::known(id) => {
                return Err("Unknown effect pack");
            }
            _ => {}
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Reboot,
    Shutdown,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Interface {
    pub name: String,
    pub kind: String,
    pub state: String,
    pub connection: String,
    /// Current canonical IPv4 addresses, enriched by the unprivileged API.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub addresses: Vec<String>,
}

/// Static public-certificate metadata served by the appliance HTTPS proxy.
/// @see docs/device-service.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PublicCertificate {
    pub schema_version: u8,
    pub fingerprint_sha256: String,
    pub file_name: String,
    pub https_download: String,
    pub hotspot_download: Option<String>,
    pub server_names: Vec<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssid: Option<String>,
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
/// Public managed-profile settings, not a measurement of the current RF channel.
/// @see docs/device-service.md
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Hotspot {
    pub ssid: String,
    /// Zero means automatic channel selection.
    pub channel: u32,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NetworkState {
    pub available: bool,
    pub wireless_enabled: bool,
    pub radio: Option<radio::Radio>,
    pub policy: Option<policy::Settings>,
    pub interfaces: Vec<Interface>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hotspot: Option<Hotspot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hotspot_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_message: Option<String>,
    pub networks: Vec<AccessPoint>,
    pub saved: Vec<SavedNetwork>,
    pub pending: Option<Pending>,
    pub message: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub state: Option<NetworkState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packs: Option<packs::PackState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage: Option<storage::StorageState>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn older_helper_state_defaults_address_readback_without_changing_commands() {
        let interface: Interface = serde_json::from_value(serde_json::json!({
            "name": "wlan0", "kind": "wifi", "state": "connected", "connection": "hotspot"
        }))
        .unwrap();
        assert!(interface.addresses.is_empty());
        assert!(
            serde_json::to_value(&interface)
                .unwrap()
                .get("addresses")
                .is_none()
        );
        let state = NetworkState {
            interfaces: vec![interface],
            ..Default::default()
        };
        let old = serde_json::to_value(state).unwrap();
        assert!(old.get("address_message").is_none());
        assert!(old.get("hotspot").is_none());
        assert!(old.get("hotspot_message").is_none());
        assert!(old.get("saved_message").is_none());
        let decoded: NetworkState = serde_json::from_value(old.clone()).unwrap();
        assert!(decoded.hotspot.is_none());
        assert!(decoded.hotspot_message.is_none());
        assert!(decoded.saved_message.is_none());
        let saved: SavedNetwork = serde_json::from_value(serde_json::json!({
            "uuid": "11111111-1111-1111-1111-111111111111",
            "name": "oxidal-wifi", "active": false, "managed": true
        }))
        .unwrap();
        assert!(saved.ssid.is_none());
        assert!(serde_json::to_value(saved).unwrap().get("ssid").is_none());
        assert!(
            serde_json::from_value::<NetworkState>(old)
                .unwrap()
                .address_message
                .is_none()
        );
    }
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
