use crate::{Command, Reply};
use std::{path::Path, time::Duration};
use tokio::net::UnixStream;
pub async fn request(path: &Path, command: &Command) -> Result<Reply, &'static str> {
    command.validate()?;
    tokio::time::timeout(Duration::from_secs(3), async {
        let expected = tokio::process::Command::new("/usr/bin/id")
            .args(["-u", "oxidal-debug"])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|_| "Debug account unavailable")?;
        let uid = String::from_utf8_lossy(&expected.stdout)
            .trim()
            .parse::<u32>()
            .map_err(|_| "Debug account unavailable")?;
        if uid == 0 {
            return Err("Debug service must not run as root");
        }
        let mut stream = UnixStream::connect(path)
            .await
            .map_err(|_| "Debug service unavailable")?;
        if stream
            .peer_cred()
            .map_err(|_| "Debug peer unavailable")?
            .uid()
            != uid
        {
            return Err("Unexpected debug service identity");
        }
        oxidal_device::ipc::write(
            &mut stream,
            &serde_json::to_vec(command).map_err(|_| "Invalid debug request")?,
        )
        .await
        .map_err(|_| "Debug request failed")?;
        let bytes = oxidal_device::ipc::read(&mut stream)
            .await
            .map_err(|_| "Debug response failed")?;
        serde_json::from_slice(&bytes).map_err(|_| "Invalid debug response")
    })
    .await
    .map_err(|_| "Debug service timed out")?
}
