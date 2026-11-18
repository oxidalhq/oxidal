//! Systemd's normal shutdown transaction stops the daemon and reaps its workers.
//! No forced shutdown, shell interpolation or caller-selected unit is admitted.
use crate::PowerAction;
use std::{process::Stdio, time::Duration};

/// Serial helper admission, retained after systemd accepts a power request.
/// @see docs/device-service.md
#[derive(Debug, Default)]
pub struct PowerGuard {
    accepted: bool,
}
impl PowerGuard {
    pub fn admit(
        &self,
        network: &crate::NetworkState,
        packs_busy: bool,
        storage: Option<(crate::storage::StorageMode, &crate::storage::StorageState)>,
    ) -> Result<(), &'static str> {
        if self.accepted {
            return Err("A system power request is already accepted");
        }
        if !network.available || network.pending.is_some() {
            return Err("Finish network recovery before a system power request");
        }
        if packs_busy {
            return Err("Finish the effect-pack change before a system power request");
        }
        if let Some((expected, state)) = storage
            && (!state.available
                || state.current.is_none()
                || !state.reboot_required
                || state.next_boot != Some(expected)
                || state.current == Some(expected))
        {
            return Err("Storage mode changed; read current settings before restarting");
        }
        Ok(())
    }
    pub fn accepted(&self) -> bool {
        self.accepted
    }
    pub fn mark_accepted(&mut self) {
        self.accepted = true;
    }
    pub fn dispatch_failed(&mut self) {
        self.accepted = false;
    }
    pub fn blocks(&self, command: &crate::Command) -> bool {
        self.accepted
            && !matches!(
                command,
                crate::Command::Status {}
                    | crate::Command::NetworkCapabilities {}
                    | crate::Command::Packs {}
                    | crate::Command::StorageStatus {}
            )
    }
}

pub async fn request(action: PowerAction) -> Result<(), &'static str> {
    let verb = match action {
        PowerAction::Reboot => "reboot",
        PowerAction::Shutdown => "poweroff",
    };
    let status = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("/usr/bin/systemctl")
            .args(["--no-block", verb])
            .env_clear()
            .env("PATH", "/usr/bin:/usr/sbin")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await;
    match status {
        Ok(Ok(status)) if status.success() => Ok(()),
        _ => Err("System power request failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Command, NetworkState, Pending,
        storage::{StorageMode, StorageState},
    };
    fn network() -> NetworkState {
        NetworkState {
            available: true,
            ..Default::default()
        }
    }
    fn queued() -> StorageState {
        StorageState {
            available: true,
            current: Some(StorageMode::Unlocked),
            next_boot: Some(StorageMode::Locked),
            reboot_required: true,
            message: String::new(),
        }
    }
    #[test]
    fn refuses_pending_network_and_pack_work_without_requiring_storage_for_normal_power() {
        let guard = PowerGuard::default();
        assert!(guard.admit(&network(), false, None).is_ok());
        assert!(guard.admit(&NetworkState::default(), false, None).is_err());
        assert!(guard.admit(&network(), true, None).is_err());
        let mut pending = network();
        pending.pending = Some(Pending {
            transaction: "a".repeat(32),
            seconds_remaining: 80,
            phase: "connecting".into(),
        });
        assert!(guard.admit(&pending, false, None).is_err());
    }
    #[test]
    fn storage_restart_requires_the_exact_known_pending_mode() {
        let guard = PowerGuard::default();
        assert!(
            guard
                .admit(&network(), false, Some((StorageMode::Locked, &queued())))
                .is_ok()
        );
        for scenario in [
            "unavailable",
            "unknown-current",
            "unknown-next",
            "changed",
            "not-pending",
            "already-current",
        ] {
            let mut state = queued();
            match scenario {
                "unavailable" => state.available = false,
                "unknown-current" => state.current = None,
                "unknown-next" => state.next_boot = None,
                "changed" => state.next_boot = Some(StorageMode::Unlocked),
                "not-pending" => state.reboot_required = false,
                _ => state.current = Some(StorageMode::Locked),
            }
            assert!(
                guard
                    .admit(&network(), false, Some((StorageMode::Locked, &state)))
                    .is_err(),
                "{scenario}"
            );
        }
    }
    #[test]
    fn accepted_power_blocks_further_work_until_dispatch_explicitly_fails() {
        let mut guard = PowerGuard::default();
        let mutations = [
            Command::Power {
                action: PowerAction::Reboot,
            },
            Command::RestartStorage {
                expected_mode: StorageMode::Locked,
            },
            Command::Storage {
                mode: StorageMode::Unlocked,
            },
            Command::Scan {},
            Command::JoinOpen {
                interface: "wlan0".into(),
                ssid: "Guest".into(),
            },
            Command::Pack {
                id: "guitarix".into(),
                action: crate::packs::PackAction::Install,
            },
        ];
        assert!(!guard.accepted());
        guard.mark_accepted();
        assert!(guard.accepted());
        assert!(guard.admit(&network(), false, None).is_err());
        for command in &mutations {
            assert!(guard.blocks(command), "{command:?}");
        }
        for command in [
            Command::Status {},
            Command::NetworkCapabilities {},
            Command::Packs {},
            Command::StorageStatus {},
        ] {
            assert!(!guard.blocks(&command));
        }
        guard.dispatch_failed();
        assert!(!guard.accepted());
        assert!(guard.admit(&network(), false, None).is_ok());
        for command in &mutations {
            assert!(!guard.blocks(command));
        }
    }
}
