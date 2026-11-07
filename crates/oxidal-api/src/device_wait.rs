//! Starts audio once its interface is connected: after startup playback found
//! no interface, or after a playing session lost it (for example an unplugged
//! or late-powered USB interface). Presence is checked by enumeration only, so
//! waiting never opens or claims a device. Any command from a player cancels
//! the wait; a device that is present but keeps failing gives up after a few
//! attempts instead of retrying forever.
//! @see docs/audio.md
use oxidal_audio::StreamConfig;
use std::time::{Duration, Instant};

const INTERVAL: Duration = Duration::from_secs(2);
const MAX_FAILURES: u8 = 5;

/// A pending automatic start of `T` (the engine's own start arguments).
pub(crate) struct Wait<T> {
    pub start: T,
    endpoint: String,
    next: Instant,
    failures: u8,
    /// True while the interface was missing at the last check.
    pub missing: bool,
}

/// Whether `endpoint` is listed by the audio backend now. Builds without
/// device discovery cannot tell, so they report it present and let the start
/// itself decide, as before.
pub(crate) fn present(endpoint: &str) -> bool {
    match oxidal_audio::devices() {
        Ok(found) if found.backend_available => found.endpoints.iter().any(|e| e.id == endpoint),
        _ => true,
    }
}

impl<T: Clone> Wait<T> {
    pub fn new(start: T, stream: &StreamConfig, missing: bool) -> Self {
        Self {
            start,
            endpoint: stream.output.endpoint.clone(),
            next: Instant::now() + INTERVAL,
            failures: 0,
            missing,
        }
    }
    /// The start arguments when an attempt is due and the interface is there.
    pub fn due(&mut self, now: Instant, present: impl Fn(&str) -> bool) -> Option<T> {
        if now < self.next {
            return None;
        }
        self.next = now + INTERVAL;
        self.missing = !present(&self.endpoint);
        (!self.missing).then(|| self.start.clone())
    }
    /// Records a failed attempt; false when the wait should end.
    pub fn failed(&mut self) -> bool {
        self.failures += 1;
        self.failures < MAX_FAILURES
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream() -> StreamConfig {
        serde_json::from_value(serde_json::json!({
            "input": {"endpoint":"hw:CARD=Audio,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3},
            "output": {"endpoint":"hw:CARD=Audio,DEV=0","direction":"playback","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3},
            "input_map": [0, 1],
            "output_map": [0, 1]
        }))
        .unwrap()
    }

    #[test]
    fn starts_only_when_the_interface_is_present_and_at_intervals() {
        let mut wait = Wait::new(7, &stream(), true);
        let start = Instant::now();
        assert_eq!(wait.due(start, |_| true), None, "not due before the interval");
        let later = start + INTERVAL * 2;
        assert_eq!(wait.due(later, |_| false), None);
        assert!(wait.missing);
        assert_eq!(wait.due(later, |_| true), None, "one check per interval");
        assert_eq!(
            wait.due(later + INTERVAL, |e| e == "hw:CARD=Audio,DEV=0"),
            Some(7)
        );
        assert!(!wait.missing);
    }

    #[test]
    fn gives_up_after_repeated_failures_with_the_device_present() {
        let mut wait = Wait::new((), &stream(), false);
        for _ in 1..MAX_FAILURES {
            assert!(wait.failed());
        }
        assert!(!wait.failed());
    }

    #[cfg(not(all(target_os = "linux", feature = "alsa")))]
    #[test]
    fn without_device_discovery_the_start_itself_decides() {
        assert!(present("hw:CARD=Audio,DEV=0"));
    }
}
