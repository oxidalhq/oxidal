//! Realtime handoff for hybrid rigs: one render thread processes the graph while
//! the worker's owner thread (JUCE's message thread) does everything else.
//! This module alone may use `unsafe`, to state that contract to the compiler.
//! @see docs/mixed-engine.md
use std::sync::atomic::{AtomicBool, Ordering};

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
pub struct SharedRig(std::sync::Mutex<crate::ResidentSet>);
// SAFETY: see the type documentation; access is serialized by the mutex and the
// render thread is restricted to `render`.
unsafe impl Sync for SharedRig {}
impl SharedRig {
    pub fn new(rig: crate::ResidentSet) -> Self {
        Self(std::sync::Mutex::new(rig))
    }
    /// Owner-thread access for requests, MIDI, pumping and switching.
    pub fn lock(&self) -> std::sync::MutexGuard<'_, crate::ResidentSet> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Render-thread access: processing only.
    pub fn render(&self, input: &[&[f32]], output: &mut [&mut [f32]]) -> Result<(), String> {
        self.lock().process(input, output)
    }
    pub fn into_inner(self) -> crate::ResidentSet {
        self.0.into_inner().unwrap_or_else(|e| e.into_inner())
    }
}
