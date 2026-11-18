//! Negotiate privileged features without delaying an early network-change reply.
//! @see docs/device-service.md
use oxidal_device::{Command, NetworkCapabilities, Reply};
use std::{
    future::Future,
    path::Path,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Reading = Result<NetworkCapabilities, &'static str>;
const UNAVAILABLE: &str = "Device service capabilities could not be read";
const UPDATE: &str = "Update the device service to join saved Wi-Fi networks";
const SUCCESS_AGE: Duration = Duration::from_secs(30);
const FAILURE_AGE: Duration = Duration::from_secs(2);

#[derive(Debug, Default)]
pub(super) struct DeviceCapabilities {
    cache: Mutex<Option<(Instant, Reading)>>,
}
impl DeviceCapabilities {
    pub(super) async fn current(&self, path: &Path) -> Reading {
        self.cached(|| read_current(path)).await
    }
    /// Writes must not request another helper reply while activation owns it.
    pub(super) fn known(&self) -> Reading {
        let cache = self.cache.try_lock().map_err(|_| UNAVAILABLE)?;
        cache
            .as_ref()
            .filter(|(time, value)| fresh(*time, value))
            .map(|(_, value)| value.clone())
            .unwrap_or(Err(UNAVAILABLE))
    }
    async fn cached<F, R>(&self, read: F) -> Reading
    where
        F: FnOnce() -> R,
        R: Future<Output = Reading>,
    {
        let mut cache = self.cache.lock().await;
        if let Some((time, value)) = &*cache
            && fresh(*time, value)
        {
            return value.clone();
        }
        let value = read().await;
        *cache = Some((Instant::now(), value.clone()));
        value
    }
}
fn fresh(time: Instant, value: &Reading) -> bool {
    time.elapsed()
        < if value.is_ok() {
            SUCCESS_AGE
        } else {
            FAILURE_AGE
        }
}
#[cfg(unix)]
async fn read_current(path: &Path) -> Reading {
    let reply = tokio::time::timeout(
        Duration::from_secs(1),
        oxidal_device::ipc::request(path, &Command::NetworkCapabilities {}),
    )
    .await
    .map_err(|_| UNAVAILABLE)?
    .map_err(|_| UNAVAILABLE)?;
    decode(reply)
}
#[cfg(not(unix))]
async fn read_current(_: &Path) -> Reading {
    Err(UNAVAILABLE)
}
fn decode(reply: Reply) -> Reading {
    if reply.error.as_deref() == Some("Invalid device request") {
        return Err(UPDATE);
    }
    if reply.error.is_some() {
        return Err(UNAVAILABLE);
    }
    let state = reply.state.ok_or(UNAVAILABLE)?;
    match state.capabilities {
        Some(value) if value.schema_version == 1 => Ok(value),
        _ => Err(UPDATE),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn reply(capabilities: Option<NetworkCapabilities>, error: Option<&str>) -> Reply {
        Reply {
            state: Some(oxidal_device::NetworkState {
                capabilities,
                ..Default::default()
            }),
            packs: None,
            storage: None,
            error: error.map(str::to_owned),
        }
    }
    #[test]
    fn old_missing_or_future_helpers_do_not_claim_saved_connect() {
        assert_eq!(
            decode(reply(None, Some("Invalid device request"))).unwrap_err(),
            UPDATE
        );
        assert_eq!(decode(reply(None, None)).unwrap_err(), UPDATE);
        assert_eq!(
            decode(reply(
                Some(NetworkCapabilities {
                    schema_version: 2,
                    saved_connect: true
                }),
                None
            ))
            .unwrap_err(),
            UPDATE
        );
        assert_eq!(
            decode(reply(None, Some("Unavailable"))).unwrap_err(),
            UNAVAILABLE
        );
        assert!(
            decode(reply(
                Some(NetworkCapabilities {
                    schema_version: 1,
                    saved_connect: true
                }),
                None
            ))
            .unwrap()
            .saved_connect
        );
        assert!(
            !decode(reply(
                Some(NetworkCapabilities {
                    schema_version: 1,
                    saved_connect: false
                }),
                None
            ))
            .unwrap()
            .saved_connect
        );
    }
    #[tokio::test]
    async fn one_in_flight_probe_is_shared_but_known_never_starts_io() {
        let reader = DeviceCapabilities::default();
        assert!(reader.known().is_err());
        let calls = AtomicUsize::new(0);
        let read = || async {
            calls.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Ok(NetworkCapabilities {
                schema_version: 1,
                saved_connect: true,
            })
        };
        let (a, b) = tokio::join!(reader.cached(read), reader.cached(read));
        assert!(a.is_ok() && b.is_ok());
        assert!(reader.known().unwrap().saved_connect);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        let held = reader.cache.lock().await;
        assert!(
            reader.known().is_err(),
            "A write must not wait for an in-flight read probe"
        );
        drop(held);
        reader.cache.lock().await.as_mut().unwrap().0 = Instant::now() - SUCCESS_AGE;
        assert!(reader.known().is_err());
        reader.cached(|| async { Err(UPDATE) }).await.unwrap_err();
        assert_eq!(reader.cached(read).await.unwrap_err(), UPDATE);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        reader.cache.lock().await.as_mut().unwrap().0 = Instant::now() - FAILURE_AGE;
        assert!(reader.cached(read).await.unwrap().saved_connect);
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }
}
