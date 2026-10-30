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

/// One native lane for a helper: its render port and its block in the graph's
/// sample buffer. Valid only between `LanePool::start` and `LanePool::finish`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LaneJob {
    port: *mut oxidal_tone3000::AudioPort,
    left: *mut f32,
    right: *mut f32,
    frames: usize,
}
impl LaneJob {
    /// A lane rendering the stereo block at `offset` of a graph buffer that
    /// starts at `samples`. The caller keeps `port` and that block alive and
    /// untouched by anyone else until the job has run.
    pub(crate) fn block(
        port: &mut oxidal_tone3000::AudioPort,
        samples: *mut f32,
        offset: usize,
        frames: usize,
    ) -> Self {
        Self {
            port,
            left: samples.wrapping_add(offset),
            right: samples.wrapping_add(offset + frames),
            frames,
        }
    }
    /// Renders the lane on the calling thread (see `block` for the contract).
    pub(crate) fn run(self) -> Result<(), String> {
        // SAFETY: per `block`, the port and the disjoint block are exclusively
        // this job's until it returns.
        let (port, left, right) = unsafe {
            (
                &mut *self.port,
                std::slice::from_raw_parts_mut(self.left, self.frames),
                std::slice::from_raw_parts_mut(self.right, self.frames),
            )
        };
        port.process(left, right).map_err(|e| e.to_string())
    }
}
const IDLE: u32 = 0;
const READY: u32 = 1;
const DONE: u32 = 2;
#[derive(Debug)]
struct Mailbox {
    state: std::sync::atomic::AtomicU32,
    quit: AtomicBool,
    failed: AtomicBool,
    /// Written by the render thread while IDLE, read by the helper while READY.
    jobs: std::cell::UnsafeCell<Vec<LaneJob>>,
}
// SAFETY: `jobs` has one writer at a time, handed over by the `state`
// release/acquire pair; the raw pointers inside are only dereferenced by the
// helper between READY and DONE, while the render thread waits.
unsafe impl Sync for Mailbox {}
unsafe impl Send for Mailbox {}
#[derive(Debug)]
struct Helper {
    mailbox: std::sync::Arc<Mailbox>,
    thread: Option<std::thread::JoinHandle<()>>,
}
/// Realtime helper threads that render independent native lanes of one graph
/// in parallel with the render thread. Each lane keeps the same thread for the
/// life of the graph, because a native engine binds to its first audio thread.
#[derive(Debug)]
pub(crate) struct LanePool {
    helpers: Vec<Helper>,
}
impl LanePool {
    /// Spawned on the owner thread while the graph is built, never in render.
    pub(crate) fn new(helpers: usize, jobs_each: usize) -> Result<Self, String> {
        let mut pool = Self {
            helpers: Vec::with_capacity(helpers),
        };
        for index in 0..helpers {
            let mailbox = std::sync::Arc::new(Mailbox {
                state: std::sync::atomic::AtomicU32::new(IDLE),
                quit: AtomicBool::new(false),
                failed: AtomicBool::new(false),
                jobs: std::cell::UnsafeCell::new(Vec::with_capacity(jobs_each)),
            });
            let worker = mailbox.clone();
            let thread = std::thread::Builder::new()
                .name(format!("oxidal-lane-{}", index + 1))
                .spawn(move || {
                    oxidal_audio::realtime::enter();
                    loop {
                        while worker.state.load(Ordering::Acquire) != READY {
                            if worker.quit.load(Ordering::Acquire) {
                                return;
                            }
                            std::thread::park();
                        }
                        // SAFETY: READY hands `jobs` and every job in it to this
                        // thread until it stores DONE (see LaneJob::block).
                        let jobs = unsafe { &*worker.jobs.get() };
                        for job in jobs {
                            if job.run().is_err() {
                                worker.failed.store(true, Ordering::Relaxed);
                            }
                        }
                        worker.state.store(DONE, Ordering::Release);
                    }
                })
                .map_err(|e| format!("Lane helper unavailable: {e}"))?;
            pool.helpers.push(Helper {
                mailbox,
                thread: Some(thread),
            });
        }
        Ok(pool)
    }
    pub(crate) fn helpers(&self) -> usize {
        self.helpers.len()
    }
    /// Queues a lane for helper `helper` (render thread, before `start`).
    pub(crate) fn queue(&self, helper: usize, job: LaneJob) {
        let mailbox = &self.helpers[helper].mailbox;
        debug_assert_eq!(mailbox.state.load(Ordering::Acquire), IDLE);
        // SAFETY: the helper does not read `jobs` while IDLE; capacity was
        // reserved for every lane it owns, so this never allocates.
        unsafe { (*mailbox.jobs.get()).push(job) };
    }
    /// Wakes every helper with queued lanes.
    pub(crate) fn start(&self) {
        for helper in &self.helpers {
            // SAFETY: still IDLE; only the render thread touches `jobs`.
            if unsafe { (*helper.mailbox.jobs.get()).is_empty() } {
                continue;
            }
            helper.mailbox.state.store(READY, Ordering::Release);
            if let Some(thread) = &helper.thread {
                thread.thread().unpark();
            }
        }
    }
    /// Waits for every started helper, then clears the queues. Must always be
    /// called after `start`, even when the caller's own lane failed.
    pub(crate) fn finish(&self) -> Result<(), String> {
        let mut failed = false;
        for helper in &self.helpers {
            let mailbox = &helper.mailbox;
            if mailbox.state.load(Ordering::Acquire) == IDLE {
                continue;
            }
            let mut spins = 0u32;
            while mailbox.state.load(Ordering::Acquire) != DONE {
                spins = spins.saturating_add(1);
                if spins < 20_000 {
                    std::hint::spin_loop();
                } else {
                    std::thread::yield_now();
                }
            }
            failed |= mailbox.failed.swap(false, Ordering::Relaxed);
            // SAFETY: DONE returns `jobs` to the render thread.
            unsafe { (*mailbox.jobs.get()).clear() };
            mailbox.state.store(IDLE, Ordering::Release);
        }
        if failed {
            Err("Native lane render failed".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for LanePool {
    fn drop(&mut self) {
        for helper in &mut self.helpers {
            helper.mailbox.quit.store(true, Ordering::Release);
            if let Some(thread) = helper.thread.take() {
                thread.thread().unpark();
                let _ = thread.join();
            }
        }
    }
}
