//! Bounded, unprivileged address readback. No network mutation or shell commands.
//! @see docs/device-service.md
use oxidal_device::NetworkState;
use std::{
    collections::BTreeMap,
    future::Future,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Addresses = BTreeMap<String, Vec<String>>;
type Reading = Result<Addresses, &'static str>;
const UNAVAILABLE: &str = "Current IP addresses could not be read";
const CACHE_AGE: Duration = Duration::from_secs(2);

#[derive(Debug, Default)]
pub(super) struct NetworkAddresses {
    cache: Mutex<Option<(Instant, Reading)>>,
}

impl NetworkAddresses {
    /// Share one bounded read across viewers; failures never expose stale values.
    pub(super) async fn enrich(&self, state: &mut NetworkState) {
        if !state.available {
            return;
        }
        let reading = self.cached(read_current).await;
        for interface in &mut state.interfaces {
            interface.addresses = reading
                .as_ref()
                .ok()
                .and_then(|addresses| addresses.get(&interface.name))
                .cloned()
                .unwrap_or_default();
        }
        state.address_message = reading.err().map(str::to_owned);
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
            "GENERAL.DEVICE,IP4.ADDRESS",
            "device",
            "show",
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
    let mut output = child.stdout.take().ok_or(UNAVAILABLE)?.take(65537);
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut bytes = Vec::new();
        output
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| UNAVAILABLE)?;
        if bytes.len() > 65536 || !child.wait().await.map_err(|_| UNAVAILABLE)?.success() {
            return Err(UNAVAILABLE);
        }
        let text = String::from_utf8(bytes).map_err(|_| UNAVAILABLE)?;
        parse(&text)
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
    use std::net::Ipv4Addr;
    let mut addresses = Addresses::new();
    let mut current = None;
    for line in text.lines().filter(|line| !line.is_empty()) {
        let fields = oxidal_device::network::fields(line);
        if fields.len() != 2 {
            return Err(UNAVAILABLE);
        }
        if fields[0] == "GENERAL.DEVICE" {
            let name = &fields[1];
            if name.is_empty() || name.len() > 64 || name.chars().any(char::is_control) {
                return Err(UNAVAILABLE);
            }
            if !addresses.contains_key(name) && addresses.len() >= 32 {
                return Err(UNAVAILABLE);
            }
            addresses.entry(name.clone()).or_default();
            current = Some(name.clone());
        } else if fields[0].starts_with("IP4.ADDRESS[") {
            let name = current.as_ref().ok_or(UNAVAILABLE)?;
            let (address, prefix) = fields[1].split_once('/').ok_or(UNAVAILABLE)?;
            if prefix.parse::<u8>().map_or(true, |prefix| prefix > 32) {
                return Err(UNAVAILABLE);
            }
            let address = address.parse::<Ipv4Addr>().map_err(|_| UNAVAILABLE)?;
            if address.is_unspecified()
                || address.is_loopback()
                || address.is_multicast()
                || address.is_broadcast()
            {
                continue;
            }
            let values = addresses.get_mut(name).ok_or(UNAVAILABLE)?;
            let address = address.to_string();
            if !values.contains(&address) {
                if values.len() >= 8 {
                    return Err(UNAVAILABLE);
                }
                values.push(address);
            }
        } else {
            return Err(UNAVAILABLE);
        }
    }
    if addresses.is_empty() {
        Err(UNAVAILABLE)
    } else {
        Ok(addresses)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[cfg(unix)]
    #[test]
    fn reads_actual_fields_without_guessing_interfaces_or_addresses() {
        let values = parse("GENERAL.DEVICE:wlan0\nIP4.ADDRESS[1]:10.42.0.1/24\nIP4.ADDRESS[2]:10.42.0.1/24\nGENERAL.DEVICE:lo\nIP4.ADDRESS[1]:127.0.0.1/8\nGENERAL.DEVICE:eth0\n").unwrap();
        assert_eq!(values["wlan0"], ["10.42.0.1"]);
        assert!(values["lo"].is_empty());
        assert!(values["eth0"].is_empty());
        assert_eq!(
            parse("GENERAL.DEVICE:eth\\:0\nIP4.ADDRESS[1]:192.0.2.5/24\n").unwrap()["eth:0"],
            ["192.0.2.5"]
        );
        for invalid in [
            "",
            "IP4.ADDRESS[1]:192.0.2.1/24",
            "GENERAL.DEVICE:wlan0\nIP4.ADDRESS[1]:not-an-address",
            "GENERAL.DEVICE:wlan0\nIP4.ADDRESS[1]:192.0.2.1/33",
            "unexpected output",
        ] {
            assert!(parse(invalid).is_err(), "{invalid}");
        }
        let too_many = (0..9)
            .map(|i| format!("IP4.ADDRESS[{i}]:192.0.2.{i}/24\n"))
            .collect::<String>();
        assert!(parse(&format!("GENERAL.DEVICE:eth0\n{too_many}")).is_err());
    }

    #[tokio::test]
    async fn shares_reads_and_caches_failures_without_stale_addresses() {
        let addresses = NetworkAddresses::default();
        let calls = AtomicUsize::new(0);
        for _ in 0..2 {
            let value = addresses
                .cached(|| async {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(Addresses::from([(
                        "wlan0".into(),
                        vec!["10.42.0.1".into()],
                    )]))
                })
                .await
                .unwrap();
            assert_eq!(value["wlan0"], ["10.42.0.1"]);
        }
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        addresses.cache.lock().await.as_mut().unwrap().0 = Instant::now() - CACHE_AGE;
        for _ in 0..2 {
            assert!(
                addresses
                    .cached(|| async {
                        calls.fetch_add(1, Ordering::Relaxed);
                        Err(UNAVAILABLE)
                    })
                    .await
                    .is_err()
            );
        }
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        let mut state = NetworkState {
            available: true,
            interfaces: vec![oxidal_device::Interface {
                name: "wlan0".into(),
                kind: "wifi".into(),
                state: "connected".into(),
                connection: "hotspot".into(),
                addresses: vec!["192.0.2.9".into()],
            }],
            ..Default::default()
        };
        addresses.enrich(&mut state).await;
        assert!(state.interfaces[0].addresses.is_empty());
        assert_eq!(state.address_message.as_deref(), Some(UNAVAILABLE));
    }
}
