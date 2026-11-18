//! Read the managed hotspot's public configuration without requesting secrets.
//! @see docs/device-service.md
use oxidal_device::Hotspot;
use std::{
    future::Future,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Reading = Result<Hotspot, &'static str>;
const UNAVAILABLE: &str = "Hotspot name and configured channel could not be read";
const CACHE_AGE: Duration = Duration::from_secs(2);

#[derive(Debug, Default)]
pub(super) struct HotspotReadback {
    cache: Mutex<Option<(Instant, Reading)>>,
}

impl HotspotReadback {
    pub(super) async fn current(&self) -> Reading {
        self.cached(read_current).await
    }

    async fn cached<F, R>(&self, read: F) -> Reading
    where
        F: FnOnce() -> R,
        R: Future<Output = Reading>,
    {
        let mut cache = self.cache.lock().await;
        if let Some((time, value)) = &*cache
            && time.elapsed() < CACHE_AGE
        {
            return value.clone();
        }
        let value = read().await;
        *cache = Some((Instant::now(), value.clone()));
        value
    }
}

#[cfg(target_os = "linux")]
async fn read_current() -> Reading {
    use std::process::Stdio;
    use tokio::{io::AsyncReadExt, process::Command};
    let mut child = Command::new("/usr/bin/nmcli")
        .args([
            "--terse",
            "--escape",
            "yes",
            "--fields",
            "802-11-wireless.ssid,802-11-wireless.channel",
            "connection",
            "show",
            "id",
            "oxidal-hotspot",
        ])
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| UNAVAILABLE)?;
    let mut output = child.stdout.take().ok_or(UNAVAILABLE)?.take(4097);
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut bytes = Vec::new();
        output
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| UNAVAILABLE)?;
        if bytes.len() > 4096 || !child.wait().await.map_err(|_| UNAVAILABLE)?.success() {
            return Err(UNAVAILABLE);
        }
        parse(&String::from_utf8(bytes).map_err(|_| UNAVAILABLE)?)
    })
    .await
    .map_err(|_| UNAVAILABLE)?
}

#[cfg(not(target_os = "linux"))]
async fn read_current() -> Reading {
    Err(UNAVAILABLE)
}

#[cfg(any(target_os = "linux", all(test, unix)))]
fn parse(text: &str) -> Reading {
    if text.len() > 4096 {
        return Err(UNAVAILABLE);
    }
    let mut ssid = None;
    let mut channel = None;
    for line in text.lines().filter(|line| !line.is_empty()) {
        let fields = oxidal_device::network::fields(line);
        if fields.len() != 2 {
            return Err(UNAVAILABLE);
        }
        match fields[0].as_str() {
            "802-11-wireless.ssid" if ssid.is_none() => {
                let value = &fields[1];
                if value.is_empty() || value.len() > 32 || value.chars().any(char::is_control) {
                    return Err(UNAVAILABLE);
                }
                ssid = Some(value.clone());
            }
            "802-11-wireless.channel" if channel.is_none() => {
                let value = &fields[1];
                if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(UNAVAILABLE);
                }
                channel = Some(value.parse::<u32>().map_err(|_| UNAVAILABLE)?);
            }
            _ => return Err(UNAVAILABLE),
        }
    }
    Ok(Hotspot {
        ssid: ssid.ok_or(UNAVAILABLE)?,
        channel: channel.ok_or(UNAVAILABLE)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[cfg(unix)]
    #[test]
    fn reads_only_public_profile_fields_and_preserves_escaped_utf8_name() {
        let value =
            parse("802-11-wireless.channel:0\n802-11-wireless.ssid:Oxidal\\: café\\\\stage\n")
                .unwrap();
        assert_eq!(value.ssid, "Oxidal: café\\stage");
        assert_eq!(value.channel, 0);
        assert_eq!(
            parse("802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:6\n")
                .unwrap()
                .channel,
            6
        );
        for text in [
            "",
            "802-11-wireless.ssid:Oxidal",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:-1",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:+1",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:4294967296",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:0\n802-11-wireless.channel:6",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.ssid:Other\n802-11-wireless.channel:0",
            "802-11-wireless.ssid:Oxidal\n802-11-wireless.channel:0\n802-11-wireless-security.psk:secret",
            "802-11-wireless.ssid:\n802-11-wireless.channel:0",
            "802-11-wireless.ssid:bad\tname\n802-11-wireless.channel:0",
        ] {
            assert!(parse(text).is_err(), "{text}");
        }
        assert!(
            parse(&format!(
                "802-11-wireless.ssid:{}\n802-11-wireless.channel:0",
                "é".repeat(17)
            ))
            .is_err()
        );
        assert!(parse(&" ".repeat(4097)).is_err());
    }

    #[tokio::test]
    async fn concurrent_viewers_share_one_in_flight_read() {
        let reader = HotspotReadback::default();
        let calls = AtomicUsize::new(0);
        let read = || async {
            calls.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Ok(Hotspot {
                ssid: "Device".into(),
                channel: 0,
            })
        };
        let (first, second, third) = tokio::join!(
            reader.cached(read),
            reader.cached(read),
            reader.cached(read)
        );
        assert!(first.is_ok() && second.is_ok() && third.is_ok());
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn shares_successes_and_failures_without_retaining_old_summary() {
        let reader = HotspotReadback::default();
        let calls = AtomicUsize::new(0);
        for _ in 0..2 {
            let value = reader
                .cached(|| async {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(Hotspot {
                        ssid: "Current name".into(),
                        channel: 6,
                    })
                })
                .await
                .unwrap();
            assert_eq!(value.ssid, "Current name");
        }
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        reader.cache.lock().await.as_mut().unwrap().0 = Instant::now() - CACHE_AGE;
        for _ in 0..2 {
            assert!(
                reader
                    .cached(|| async {
                        calls.fetch_add(1, Ordering::Relaxed);
                        Err(UNAVAILABLE)
                    })
                    .await
                    .is_err()
            );
        }
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }
}
