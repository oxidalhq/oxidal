//! One bounded request per Unix connection; no arbitrary executable or path fields.
use crate::{Command, MAX_MESSAGE, Reply};
use std::{io, path::Path, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
};

pub async fn read(stream: &mut UnixStream) -> io::Result<Vec<u8>> {
    let length = stream.read_u32().await? as usize;
    if length > MAX_MESSAGE || length == 0 {
        return Err(io::Error::other("Invalid device message length"));
    }
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}
pub async fn write(stream: &mut UnixStream, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE {
        return Err(io::Error::other("Device message too large"));
    }
    stream.write_u32(bytes.len() as u32).await?;
    stream.write_all(bytes).await
}
pub async fn request(path: &Path, command: &Command) -> Result<Reply, &'static str> {
    command.validate()?;
    tokio::time::timeout(Duration::from_secs(25), async {
        let mut stream = UnixStream::connect(path)
            .await
            .map_err(|_| "Device service unavailable")?;
        // The privileged endpoint must actually be root, not an impersonating local process.
        if stream
            .peer_cred()
            .map_err(|_| "Device peer unavailable")?
            .uid()
            != 0
        {
            return Err("Device service peer is not root");
        }
        let bytes = serde_json::to_vec(command).map_err(|_| "Invalid device request")?;
        write(&mut stream, &bytes)
            .await
            .map_err(|_| "Device request failed")?;
        let response = read(&mut stream)
            .await
            .map_err(|_| "Device response failed")?;
        serde_json::from_slice(&response).map_err(|_| "Invalid device response")
    })
    .await
    .map_err(|_| "Device service timed out")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn framing_rejects_oversize_and_preserves_exact_payload() {
        let (mut a, mut b) = UnixStream::pair().unwrap();
        write(&mut a, br#"{"type":"status"}"#).await.unwrap();
        assert_eq!(read(&mut b).await.unwrap(), br#"{"type":"status"}"#);
        a.write_u32(MAX_MESSAGE as u32 + 1).await.unwrap();
        assert!(read(&mut b).await.is_err());
        assert!(write(&mut a, &[]).await.is_err());
    }
}
