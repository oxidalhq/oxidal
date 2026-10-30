//! Realtime handoff for hybrid rigs: one render thread processes the graph while
//! the worker's owner thread (JUCE's message thread) does everything else.
//! This module alone may use `unsafe`, to state that contract to the compiler.
//! @see docs/mixed-engine.md
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Set once by the rig worker before its render thread starts. Native graph
/// nodes then render through an `AudioPort` bound to that thread.
static REMOTE_RENDER: AtomicBool = AtomicBool::new(false);
pub fn enable_render_thread() {
    REMOTE_RENDER.store(true, Ordering::Release);
}
pub(crate) fn render_thread_enabled() -> bool {
    REMOTE_RENDER.load(Ordering::Acquire)
}

/// Render-only handle on a native engine owned by the same graph node.
pub(crate) fn audio_port(engine: &oxidal_tone3000::Engine) -> oxidal_tone3000::AudioPort {
    // SAFETY: the port is stored beside its engine in one graph node and dropped
    // with it; only the render thread uses it, under the rig lock.
    unsafe { engine.audio_port() }
}

/// Owner-thread dispatch handle; the caller drops it before any engine can drop.
pub(crate) fn pump_port(engine: &oxidal_tone3000::Engine) -> oxidal_tone3000::PumpPort {
    // SAFETY: returned to the owner thread only, used within one tick while the
    // owner (the only thread that drops engines) is not changing the rig.
    unsafe { engine.pump_port() }
}

/// A rig shared by its owner thread and one render thread under a mutex.
///
/// The rig holds native engines and LV2 instances, which are not `Send`. The
/// render thread only calls `ResidentSet::process`: native nodes go through
/// render ports the bridge admits from that thread, and LV2 `run` is an
/// audio-class call. Construction, control, state and destruction stay on the
/// owner thread, which created the rig.
#[derive(Debug)]
pub struct SharedRig {
    rig: std::sync::Mutex<crate::ResidentSet>,
    /// Longest render wait for the lock since the owner last reported it, µs.
    render_wait_us: AtomicU64,
}
// SAFETY: see the type documentation; access is serialized by the mutex and the
// render thread is restricted to `render`.
unsafe impl Sync for SharedRig {}
/// Owner holds longer than this are logged with what they were doing.
const SLOW_HOLD: Duration = Duration::from_millis(5);
impl SharedRig {
    pub fn new(rig: crate::ResidentSet) -> Self {
        Self {
            rig: std::sync::Mutex::new(rig),
            render_wait_us: AtomicU64::new(0),
        }
    }
    /// Owner-thread access for requests, MIDI, pumping and switching. `what`
    /// names the work in the log when the hold delays audio.
    pub fn lock(&self, what: &'static str) -> OwnerGuard<'_> {
        OwnerGuard {
            guard: self.rig.lock().unwrap_or_else(|e| e.into_inner()),
            what,
            since: Instant::now(),
        }
    }
    /// Render-thread access: processing only. Records how long it waited.
    pub fn render(&self, input: &[&[f32]], output: &mut [&mut [f32]]) -> Result<(), String> {
        let asked = Instant::now();
        let mut rig = self.rig.lock().unwrap_or_else(|e| e.into_inner());
        let waited = asked.elapsed().as_micros() as u64;
        self.render_wait_us.fetch_max(waited, Ordering::Relaxed);
        rig.process(input, output)
    }
    /// The longest render wait since the last call, then resets it (owner side).
    pub fn take_render_wait(&self) -> Duration {
        Duration::from_micros(self.render_wait_us.swap(0, Ordering::Relaxed))
    }
    pub fn into_inner(self) -> crate::ResidentSet {
        self.rig.into_inner().unwrap_or_else(|e| e.into_inner())
    }
}
/// An owner hold of the rig; a slow one is logged when it ends.
#[derive(Debug)]
pub struct OwnerGuard<'a> {
    guard: std::sync::MutexGuard<'a, crate::ResidentSet>,
    what: &'static str,
    since: Instant,
}
impl std::ops::Deref for OwnerGuard<'_> {
    type Target = crate::ResidentSet;
    fn deref(&self) -> &Self::Target {
        &self.guard
    }
}
impl std::ops::DerefMut for OwnerGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard
    }
}
impl Drop for OwnerGuard<'_> {
    fn drop(&mut self) {
        let held = self.since.elapsed();
        if held > SLOW_HOLD {
            eprintln!(
                "Rig lock held {:.1} ms by {}",
                held.as_secs_f64() * 1000.0,
                self.what
            );
        }
    }
}
