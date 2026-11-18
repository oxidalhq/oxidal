//! Public SSID readback keyed by managed connection UUID, never by display label.
//! @see docs/device-service.md
use oxidal_device::Command;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Names = BTreeMap<String, String>;
type Reading = Result<Names, &'static str>;
const UNAVAILABLE: &str = "Saved Wi-Fi names could not be read";
const CACHE_AGE: Duration = Duration::from_secs(2);
const MAX_PROFILES: usize = 128;

#[derive(Debug, Default)]
pub(super) struct SavedNetworkNames {
    cache: Mutex<Option<(Vec<String>, Instant, Reading)>>,
}

impl SavedNetworkNames {
    pub(super) async fn current(&self, identifiers: &[String]) -> Reading {
        let identifiers = match normalize(identifiers) {
            Ok(value) => value,
            Err(error) => {
                *self.cache.lock().await = None;
                return Err(error);
            }
        };
        if identifiers.is_empty() {
            return self
                .cached(identifiers, || async { Ok(Names::new()) })
                .await;
        }
        self.cached(identifiers.clone(), || read_current(&identifiers))
            .await
    }

    async fn cached<F, R>(&self, identifiers: Vec<String>, read: F) -> Reading
    where
        F: FnOnce() -> R,
        R: Future<Output = Reading>,
    {
        let mut cache = self.cache.lock().await;
        if let Some((key, time, value)) = &*cache
            && key == &identifiers
            && time.elapsed() < CACHE_AGE
        {
            return value.clone();
        }
        let value = read().await;
        *cache = Some((identifiers, Instant::now(), value.clone()));
        value
    }
}

fn normalize(identifiers: &[String]) -> Result<Vec<String>, &'static str> {
    let mut unique = BTreeSet::new();
    for identifier in identifiers {
        Command::Forget {
            uuid: identifier.clone(),
        }
        .validate()
        .map_err(|_| UNAVAILABLE)?;
        unique.insert(identifier.clone());
        if unique.len() > MAX_PROFILES {
            return Err(UNAVAILABLE);
        }
    }
    Ok(unique.into_iter().collect())
}

#[cfg(target_os = "linux")]
async fn read_current(identifiers: &[String]) -> Reading {
    use std::process::Stdio;
    use tokio::{io::AsyncReadExt, process::Command};
    let mut command = Command::new("/usr/bin/nmcli");
    command.args([
        "--terse",
        "--escape",
        "yes",
        "--fields",
        "connection.uuid,802-11-wireless.ssid",
        "connection",
        "show",
    ]);
    for identifier in identifiers {
        command.arg("uuid").arg(identifier);
    }
    let mut child = command
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
        parse(
            &String::from_utf8(bytes).map_err(|_| UNAVAILABLE)?,
            identifiers,
        )
    })
    .await
    .map_err(|_| UNAVAILABLE)?
}

#[cfg(not(target_os = "linux"))]
async fn read_current(_: &[String]) -> Reading {
    Err(UNAVAILABLE)
}

#[cfg(any(target_os = "linux", all(test, unix)))]
fn parse(text: &str, expected: &[String]) -> Reading {
    if text.len() > 65536 || expected.len() > MAX_PROFILES {
        return Err(UNAVAILABLE);
    }
    let mut names = Names::new();
    let mut current: Option<String> = None;
    for line in text.lines().filter(|line| !line.is_empty()) {
        let fields = oxidal_device::network::fields(line);
        if fields.len() != 2 {
            return Err(UNAVAILABLE);
        }
        match fields[0].as_str() {
            "connection.uuid" => {
                if current.as_ref().is_some_and(|id| !names.contains_key(id)) {
                    return Err(UNAVAILABLE);
                }
                let id = &fields[1];
                if !expected.contains(id) || names.contains_key(id) {
                    return Err(UNAVAILABLE);
                }
                current = Some(id.clone());
            }
            "802-11-wireless.ssid" => {
                let id = current.as_ref().ok_or(UNAVAILABLE)?;
                let ssid = &fields[1];
                if names.contains_key(id)
                    || ssid.is_empty()
                    || ssid.len() > 32
                    || ssid.chars().any(char::is_control)
                {
                    return Err(UNAVAILABLE);
                }
                names.insert(id.clone(), ssid.clone());
            }
            _ => return Err(UNAVAILABLE),
        }
    }
    if names.len() != expected.len() {
        return Err(UNAVAILABLE);
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    const FIRST: &str = "11111111-1111-1111-1111-111111111111";
    const SECOND: &str = "22222222-2222-2222-2222-222222222222";

    #[cfg(unix)]
    #[test]
    fn matches_public_ssids_to_exact_requested_ids() {
        let text = format!(
            "connection.uuid:{SECOND}\n802-11-wireless.ssid:Stage\\: café\\\\room\n\nconnection.uuid:{FIRST}\n802-11-wireless.ssid:Studio\n"
        );
        let values = parse(&text, &[FIRST.into(), SECOND.into()]).unwrap();
        assert_eq!(values[FIRST], "Studio");
        assert_eq!(values[SECOND], "Stage: café\\room");
        for invalid in [
            String::new(),
            format!("connection.uuid:{FIRST}"),
            "802-11-wireless.ssid:Studio".into(),
            format!("connection.uuid:{SECOND}\n802-11-wireless.ssid:Wrong"),
            format!(
                "connection.uuid:{FIRST}\n802-11-wireless.ssid:Studio\n802-11-wireless.ssid:Other"
            ),
            format!(
                "connection.uuid:{FIRST}\n802-11-wireless.ssid:Studio\nconnection.uuid:{FIRST}\n802-11-wireless.ssid:Other"
            ),
            format!("connection.uuid:{FIRST}\n802-11-wireless.ssid:\n"),
            format!("connection.uuid:{FIRST}\n802-11-wireless.ssid:bad\tname"),
            format!(
                "connection.uuid:{FIRST}\n802-11-wireless.ssid:{}",
                "é".repeat(17)
            ),
            format!(
                "connection.uuid:{FIRST}\n802-11-wireless.ssid:Studio\n802-11-wireless-security.psk:secret"
            ),
            "x".repeat(65537),
        ] {
            assert!(parse(&invalid, &[FIRST.into()]).is_err());
        }
    }

    #[test]
    fn bounds_and_sorts_identifiers_before_building_arguments() {
        assert_eq!(
            normalize(&[SECOND.into(), FIRST.into(), FIRST.into()]).unwrap(),
            [FIRST, SECOND]
        );
        assert!(normalize(&["--show-secrets".into()]).is_err());
        let ids = (0..129)
            .map(|i| format!("{i:08x}-1111-1111-1111-111111111111"))
            .collect::<Vec<_>>();
        assert!(normalize(&ids).is_err());
    }

    #[tokio::test]
    async fn concurrent_viewers_share_only_the_exact_profile_set() {
        let reader = SavedNetworkNames::default();
        let calls = AtomicUsize::new(0);
        let read = || async {
            calls.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Ok(Names::from([(FIRST.into(), "Studio".into())]))
        };
        let ids = vec![FIRST.into()];
        let (first, second) = tokio::join!(
            reader.cached(ids.clone(), read),
            reader.cached(ids.clone(), read)
        );
        assert!(first.is_ok() && second.is_ok());
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert!(reader.current(&[]).await.unwrap().is_empty());
        reader.cached(ids.clone(), read).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        reader.cache.lock().await.as_mut().unwrap().1 = Instant::now() - CACHE_AGE;
        assert!(
            reader
                .cached(ids.clone(), || async { Err(UNAVAILABLE) })
                .await
                .is_err()
        );
        assert!(reader.cached(ids, read).await.is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        reader
            .cached(vec![SECOND.into()], || async {
                Ok(Names::from([(SECOND.into(), "Stage".into())]))
            })
            .await
            .unwrap();
        assert!(reader.current(&["invalid".into()]).await.is_err());
        assert!(reader.cache.lock().await.is_none());
    }
}
