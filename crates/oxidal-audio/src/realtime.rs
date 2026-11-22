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

/// Lowers the calling thread to the idle CPU policy and idle disk class, for
/// preparation work (stem splits, mix renders) that runs beside live audio.
/// Child processes started from the thread inherit both.
pub fn idle() {
    imp::idle();
}

/// Lowers an offline native owner and its future threads within the ordinary
/// CPU scheduler. JUCE loader threads cannot start from the idle CPU policy.
pub fn background_owner() {
    imp::background_owner();
}

/// Milliseconds from the Linux monotonic clock shared across worker processes.
pub fn monotonic_millis() -> Option<u64> {
    imp::monotonic_millis()
}

/// The logical CPU executing the calling render thread at the sampling instant.
#[cfg(all(target_os = "linux", feature = "alsa"))]
pub(crate) fn current_cpu() -> Option<u16> {
    // SAFETY: sched_getcpu takes no pointers and only reads the current CPU number.
    u16::try_from(unsafe { libc::sched_getcpu() }).ok()
}

#[cfg(all(target_os = "linux", feature = "alsa"))]
mod imp {
    pub fn monotonic_millis() -> Option<u64> {
        let mut value = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: this writable, exclusive timespec is valid for clock_gettime.
        if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &raw mut value) } != 0 {
            return None;
        }
        u64::try_from(value.tv_sec)
            .ok()?
            .checked_mul(1000)?
            .checked_add(u64::try_from(value.tv_nsec).ok()? / 1_000_000)
    }
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
    pub fn background_owner() {
        // SAFETY: a zero process ID names the caller. Lowering ordinary
        // scheduling priority needs no realtime or administrator privileges.
        unsafe { libc::setpriority(libc::PRIO_PROCESS, 0, 10) };
        idle_io();
    }
    pub fn idle() {
        let param = libc::sched_param { sched_priority: 0 };
        // SAFETY: valid policy and parameter for the current thread.
        unsafe {
            libc::pthread_setschedparam(libc::pthread_self(), libc::SCHED_IDLE, &param);
        }
        idle_io();
    }
    fn idle_io() {
        const IOPRIO_WHO_PROCESS: libc::c_long = 1;
        const IOPRIO_CLASS_IDLE: libc::c_long = 3;
        const IOPRIO_CLASS_SHIFT: libc::c_long = 13;
        // SAFETY: the ioprio call names the calling thread (0) with a valid class.
        unsafe {
            libc::syscall(
                libc::SYS_ioprio_set,
                IOPRIO_WHO_PROCESS,
                0 as libc::c_long,
                IOPRIO_CLASS_IDLE << IOPRIO_CLASS_SHIFT,
            );
        }
    }
}

#[cfg(not(all(target_os = "linux", feature = "alsa")))]
mod imp {
    pub fn enter() -> String {
        "realtime: unavailable on this platform".into()
    }
    pub fn leave() {}
    pub fn idle() {}
    pub fn background_owner() {}
    pub fn monotonic_millis() -> Option<u64> {
        None
    }
}
