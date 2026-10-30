//! Realtime scheduling for audio workers, matching PiPedal's proven setup:
//! SCHED_RR priority 90 for the audio thread and locked memory, so ordinary
//! processes and page faults cannot delay a block. Needs `LimitRTPRIO` and
//! `LimitMEMLOCK` on the service; without them audio still runs, just at
//! normal priority, and the reason is reported.
//! @see docs/audio.md

/// Audio thread priority, one above PipeWire's, as PiPedal uses.
pub const AUDIO_PRIORITY: i32 = 90;

/// Call first in a worker's `main`: threads started afterwards (including a
/// native engine's DSP threads) inherit realtime scheduling. Returns a short
/// description for the worker journal.
pub fn enter() -> String {
    imp::enter()
}

/// Call at the start of helper threads (pipes, JSON, logging) so they never
/// compete with audio at realtime priority.
pub fn leave() {
    imp::leave();
}

#[cfg(all(target_os = "linux", feature = "alsa"))]
mod imp {
    pub fn enter() -> String {
        // SAFETY: plain syscalls on the calling process/thread with valid arguments.
        let locked = unsafe { libc::mlockall(libc::MCL_CURRENT | libc::MCL_FUTURE) } == 0;
        let param = libc::sched_param {
            sched_priority: super::AUDIO_PRIORITY,
        };
        // SAFETY: valid policy and parameter for the current thread.
        let realtime =
            unsafe { libc::pthread_setschedparam(libc::pthread_self(), libc::SCHED_RR, &param) };
        format!(
            "realtime: {}; memory: {}",
            if realtime == 0 {
                format!("SCHED_RR {}", super::AUDIO_PRIORITY)
            } else {
                format!("normal priority (error {realtime}; service needs LimitRTPRIO)")
            },
            if locked {
                "locked"
            } else {
                "not locked (service needs LimitMEMLOCK=infinity)"
            }
        )
    }
    pub fn leave() {
        let param = libc::sched_param { sched_priority: 0 };
        // SAFETY: valid policy and parameter for the current thread.
        unsafe {
            libc::pthread_setschedparam(libc::pthread_self(), libc::SCHED_OTHER, &param);
        }
    }
}

#[cfg(not(all(target_os = "linux", feature = "alsa")))]
mod imp {
    pub fn enter() -> String {
        "realtime: unavailable on this platform".into()
    }
    pub fn leave() {}
}
