//! Systemd's normal shutdown transaction stops the daemon and reaps its workers.
//! No forced shutdown, shell interpolation or caller-selected unit is admitted.
use crate::PowerAction;
use std::{process::Stdio, time::Duration};
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
