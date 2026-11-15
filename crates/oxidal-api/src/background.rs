//! Song preparation (stem splits, mix renders, stem imports and tempo
//! analysis) runs beside live audio. On Linux it uses the idle CPU policy and
//! the idle disk class, so the audio worker, the backing-track reader and the
//! API always run first. Protect, not playback, stops preparation.
//! @see docs/media.md#stem-mix-recipes

/// Runs `work` on its own thread at idle CPU and disk priority and waits for
/// it. A separate thread keeps the lowered priority out of the shared pool.
pub(crate) fn run<T: Send>(work: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                lower_current_thread();
                work()
            })
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
    })
}

/// Starts a detached thread at idle priority for work that outlives a request.
pub(crate) fn spawn(work: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .name("oxidal-prepare".into())
        .spawn(move || {
            lower_current_thread();
            work();
        })
        .expect("preparation thread starts");
}

/// Lowers the calling thread. Child processes it starts inherit the setting.
pub(crate) fn lower_current_thread() {
    oxidal_audio::realtime::idle();
}

#[cfg(test)]
mod tests {
    #[test]
    fn work_returns_its_value_from_the_lowered_thread() {
        assert_eq!(super::run(|| 6 * 7), 42);
    }
}
