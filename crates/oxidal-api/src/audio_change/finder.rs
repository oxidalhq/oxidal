//! Device-owned one-minute buffer screening. Readings never imply physical qualification.
use super::*;

const SIZES: [u32; 11] = [16, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048];
pub(super) const LISTEN: Duration = Duration::from_secs(60);
pub(super) const START: Duration = Duration::from_secs(15);
const STALE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BufferSetting {
    pub frames: u32,
    pub periods: u32,
}
impl BufferSetting {
    fn from_hardware(hardware: &AudioChangeHardware) -> Self {
        Self {
            frames: hardware.input.period_frames,
            periods: hardware.input.periods,
        }
    }
    fn hardware(self, original: &AudioChangeHardware) -> AudioChangeHardware {
        let mut next = original.clone();
        next.input.period_frames = self.frames;
        next.output.period_frames = self.frames;
        next.input.periods = self.periods;
        next.output.periods = self.periods;
        next
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BufferFinderPhase {
    Running,
    Cancelling,
    Done,
    Cancelled,
    Failed,
}
impl BufferFinderPhase {
    pub(super) fn active(self) -> bool {
        matches!(self, Self::Running | Self::Cancelling)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BufferTrialOutcome {
    Clean,
    Failed,
    Unavailable,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BufferTrial {
    pub frames: u32,
    pub periods: u32,
    pub outcome: BufferTrialOutcome,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xruns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_misses: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_samples: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
impl BufferTrial {
    pub(super) fn refused(hardware: &AudioChangeHardware, reason: &str) -> Self {
        let setting = BufferSetting::from_hardware(hardware);
        Self {
            frames: setting.frames,
            periods: setting.periods,
            outcome: BufferTrialOutcome::Unavailable,
            elapsed_ms: 0,
            xruns: None,
            deadline_misses: None,
            invalid_samples: None,
            reason: Some(reason.chars().take(512).collect()),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BufferFinderState {
    pub session: String,
    pub expected_revision: u64,
    pub state: BufferFinderPhase,
    pub trials: Vec<BufferTrial>,
    pub total: u32,
    pub candidate: BufferSetting,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended: Option<BufferSetting>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
impl BufferFinderState {
    pub(super) fn active(&self) -> bool {
        self.state.active()
    }
}

pub(super) struct Proof {
    began: Instant,
    advanced: Instant,
    baseline: meter::Snapshot,
    previous: meter::Snapshot,
}
impl Proof {
    pub(super) fn new(now: Instant, sample: Option<meter::Snapshot>) -> Result<Self, &'static str> {
        let sample = sample
            .filter(|s| s.frames > 0 && s.valid())
            .ok_or("Processed audio measurements are unavailable")?;
        if sample.xruns.is_none() || sample.deadline_misses.is_none() {
            return Err(
                "Xrun or deadline counters are unavailable; this setting cannot be marked clean",
            );
        }
        Ok(Self {
            began: now,
            advanced: now,
            baseline: sample,
            previous: sample,
        })
    }
    pub(super) fn deadline(&self) -> Instant {
        self.began + LISTEN + STALE
    }
    pub(super) fn observe(
        &mut self,
        now: Instant,
        sample: Option<meter::Snapshot>,
        hardware: &AudioChangeHardware,
    ) -> Option<BufferTrial> {
        let Some(sample) = sample.filter(|s| s.valid()) else {
            return Some(self.finish(
                now,
                hardware,
                BufferTrialOutcome::Unavailable,
                "Audio measurements became unavailable",
                None,
            ));
        };
        let Some((xruns, misses, old_xruns, old_misses)) = sample
            .xruns
            .zip(sample.deadline_misses)
            .zip(self.previous.xruns.zip(self.previous.deadline_misses))
            .map(|((a, b), (c, d))| (a, b, c, d))
        else {
            return Some(self.finish(
                now,
                hardware,
                BufferTrialOutcome::Unavailable,
                "Audio counters became unavailable",
                Some(sample),
            ));
        };
        if sample.frames < self.previous.frames
            || xruns < old_xruns
            || misses < old_misses
            || sample.invalid_samples < self.previous.invalid_samples
        {
            return Some(self.finish(
                now,
                hardware,
                BufferTrialOutcome::Failed,
                "The audio worker or its counters restarted",
                Some(sample),
            ));
        }
        if sample.frames > self.previous.frames {
            self.advanced = now;
        }
        self.previous = sample;
        if now.saturating_duration_since(self.advanced) >= STALE {
            return Some(self.finish(
                now,
                hardware,
                BufferTrialOutcome::Unavailable,
                "Processed frames stopped advancing",
                Some(sample),
            ));
        }
        if xruns != self.baseline.xruns.unwrap()
            || misses != self.baseline.deadline_misses.unwrap()
            || sample.invalid_samples != self.baseline.invalid_samples
        {
            return Some(self.finish(
                now,
                hardware,
                BufferTrialOutcome::Failed,
                "Audio dropouts, deadline misses or invalid samples increased",
                Some(sample),
            ));
        }
        if now.saturating_duration_since(self.began) < LISTEN {
            return None;
        }
        if sample.frames.saturating_sub(self.baseline.frames)
            < u64::from(hardware.input.sample_rate) * 60
        {
            return (now >= self.deadline()).then(|| {
                self.finish(
                    now,
                    hardware,
                    BufferTrialOutcome::Unavailable,
                    &format!(
                        "Only {} of {} frames were processed for a one-minute stream",
                        sample.frames.saturating_sub(self.baseline.frames),
                        u64::from(hardware.input.sample_rate) * 60
                    ),
                    Some(sample),
                )
            });
        }
        Some(self.finish(
            now,
            hardware,
            BufferTrialOutcome::Clean,
            "Clean for one minute; sustained playing qualification is still required",
            Some(sample),
        ))
    }

    pub(super) fn finish(
        &self,
        now: Instant,
        hardware: &AudioChangeHardware,
        outcome: BufferTrialOutcome,
        reason: &str,
        sample: Option<meter::Snapshot>,
    ) -> BufferTrial {
        let setting = BufferSetting::from_hardware(hardware);
        BufferTrial {
            frames: setting.frames,
            periods: setting.periods,
            outcome,
            elapsed_ms: now.saturating_duration_since(self.began).as_millis() as u64,
            xruns: sample.and_then(|s| s.xruns?.checked_sub(self.baseline.xruns?)),
            deadline_misses: sample.and_then(|s| {
                s.deadline_misses?
                    .checked_sub(self.baseline.deadline_misses?)
            }),
            invalid_samples: sample
                .and_then(|s| s.invalid_samples.checked_sub(self.baseline.invalid_samples)),
            reason: Some(reason.chars().take(512).collect()),
        }
    }
}

struct Plan {
    baseline: bool,
    frames: bool,
    best: Option<BufferSetting>,
}
impl Plan {
    fn next(&mut self, trial: &BufferTrial) -> Option<BufferSetting> {
        if self.baseline && trial.outcome != BufferTrialOutcome::Clean {
            return None;
        }
        self.baseline = false;
        if trial.outcome == BufferTrialOutcome::Clean {
            self.best = Some(BufferSetting {
                frames: trial.frames,
                periods: trial.periods,
            });
        }
        let best = self.best?;
        if self.frames
            && trial.outcome == BufferTrialOutcome::Clean
            && let Some(frames) = SIZES.iter().rev().find(|&&size| size < best.frames)
        {
            return Some(BufferSetting {
                frames: *frames,
                periods: best.periods,
            });
        }
        if self.frames {
            self.frames = false;
        } else if trial.outcome != BufferTrialOutcome::Clean {
            return None;
        }
        (best.periods > 2).then_some(BufferSetting {
            frames: best.frames,
            periods: best.periods.saturating_sub(1),
        })
    }
}

pub(super) async fn start(
    shared: Arc<Shared>,
    owner: AudioChangeOwner,
    session: String,
    revision: u64,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return protect::locked(reason);
    }
    if shared.captures.busy().await {
        return failure(
            StatusCode::CONFLICT,
            "Finish recording or reamping before buffer screening",
        );
    }
    let current = owner.state(&shared);
    if current.phase != AudioPhase::Running
        || current.session != session
        || current.revision != revision
    {
        return failure(
            StatusCode::CONFLICT,
            "The running audio session changed. Refresh before buffer screening",
        );
    }
    let Some(stream) = current.stream else {
        return failure(StatusCode::SERVICE_UNAVAILABLE, "No confirmed audio stream");
    };
    if let Err(error) = stream.validate() {
        return failure(StatusCode::BAD_REQUEST, &error);
    }
    if stream.input.periods != stream.output.periods {
        return failure(
            StatusCode::BAD_REQUEST,
            "Use matching input and output periods for automatic buffer screening",
        );
    }
    let original = AudioChangeHardware::from_stream(&stream);
    let setting = BufferSetting::from_hardware(&original);
    let id = match shared
        .audio_change
        .begin(owner, original.clone(), original.clone())
    {
        Ok(id) => id,
        Err(error) => return failure(StatusCode::CONFLICT, error),
    };
    {
        let mut inner = shared.audio_change.lock();
        inner.view.finder = Some(BufferFinderState {
            session: current.session.clone(),
            expected_revision: current.revision,
            state: BufferFinderPhase::Running,
            trials: Vec::new(),
            total: 1
                + SIZES.iter().filter(|&&size| size < setting.frames).count() as u32
                + setting.periods.saturating_sub(2),
            candidate: setting,
            recommended: None,
            message: Some("First measuring the original buffer for one minute".into()),
        });
    }
    let snapshot = shared.audio_change.snapshot(&shared);
    let (admitted, admission) = oneshot::channel();
    tokio::spawn(async move {
        if let Err((status, reason)) = external_admission(&shared).await {
            {
                let mut inner = shared.audio_change.lock();
                if let Some(finder) = &mut inner.view.finder {
                    finder.state = BufferFinderPhase::Failed;
                    finder.message = Some(reason.into());
                }
            }
            shared
                .audio_change
                .finish(AudioChangePhase::Failed, Some(reason.into()), None)
                .await;
            let _ = admitted.send(Err((status, reason)));
            return;
        }
        let _ = admitted.send(Ok(()));
        let mut shutdown = shared.config.shutdown.clone();
        tokio::select! {
            biased;
            _ = async {
                match shutdown.as_mut() {
                    Some(signal) => { if !*signal.borrow() { let _ = signal.changed().await; } }
                    None => std::future::pending::<()>().await,
                }
            } => (),
            _ = search(shared, owner, id, original) => (),
        }
    });
    match admission.await {
        Ok(Ok(())) => media_api::no_store(StatusCode::ACCEPTED, snapshot),
        Ok(Err((status, reason))) => failure(status, reason),
        Err(_) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Buffer screening controller stopped",
        ),
    }
}

async fn search(
    shared: Arc<Shared>,
    owner: AudioChangeOwner,
    id: String,
    original: AudioChangeHardware,
) {
    let mut plan = Plan {
        baseline: true,
        frames: true,
        best: None,
    };
    let mut candidate = original.clone();
    let mut observe = true;
    loop {
        let cancelled = {
            let inner = shared.audio_change.lock();
            inner.stopped
                || inner
                    .view
                    .finder
                    .as_ref()
                    .is_some_and(|f| f.state == BufferFinderPhase::Cancelling)
        };
        if cancelled {
            complete(
                &shared,
                owner,
                BufferFinderPhase::Cancelled,
                "Buffer screening cancelled. The original stream remains the resume target.",
            )
            .await;
            return;
        }
        if shared.protect.refuse(false).is_some() {
            complete(
                &shared,
                owner,
                BufferFinderPhase::Cancelled,
                "Protect cancelled buffer screening. Original settings were restored.",
            )
            .await;
            return;
        }
        let current = owner.state(&shared);
        let apply = if observe {
            Mode::Observe
        } else {
            Mode::Apply {
                session: current.session,
                revision: current.revision,
                hardware: candidate.clone(),
            }
        };
        let admitted = {
            let mut inner = shared.audio_change.lock();
            if inner.stopped
                || inner
                    .view
                    .finder
                    .as_ref()
                    .is_some_and(|f| f.state == BufferFinderPhase::Cancelling)
            {
                false
            } else {
                inner.view.phase = AudioChangePhase::Restarting;
                inner.view.candidate = Some(candidate.clone());
                inner.view.observed = None;
                inner.view.message = None;
                inner.deadline = None;
                inner.deciding = false;
                if let Some(finder) = &mut inner.view.finder {
                    finder.candidate = BufferSetting::from_hardware(&candidate);
                    finder.message = Some(
                        if observe {
                            "Measuring the original buffer"
                        } else {
                            "Trying a smaller buffer; original settings will be restored"
                        }
                        .into(),
                    );
                }
                true
            }
        };
        if !admitted {
            complete(
                &shared,
                owner,
                BufferFinderPhase::Cancelled,
                "Buffer screening was cancelled before the next trial",
            )
            .await;
            return;
        }
        let trial = run(
            shared.clone(),
            owner,
            id.clone(),
            original.clone(),
            candidate.clone(),
            apply,
            true,
        )
        .await
        .unwrap_or_else(|| {
            BufferTrial::refused(&candidate, "Buffer screening returned no measurement")
        });
        let clean = trial.outcome == BufferTrialOutcome::Clean;
        let next = plan.next(&trial);
        let (cancelled, failed) = {
            let mut inner = shared.audio_change.lock();
            if let Some(finder) = &mut inner.view.finder {
                finder.trials.push(trial);
                finder.recommended = plan.best;
            }
            (
                inner.stopped
                    || inner
                        .view
                        .finder
                        .as_ref()
                        .is_some_and(|f| f.state == BufferFinderPhase::Cancelling),
                inner.view.phase == AudioChangePhase::Failed,
            )
        };
        if cancelled {
            complete(
                &shared,
                owner,
                BufferFinderPhase::Cancelled,
                "Buffer screening cancelled. Original settings were restored or audio was stopped.",
            )
            .await;
            return;
        }
        if failed {
            complete(&shared, owner, BufferFinderPhase::Failed, "The original audio stream could not be confirmed. Review recovery before using any recommendation.").await;
            return;
        }
        if observe && !clean {
            complete(
                &shared,
                owner,
                BufferFinderPhase::Failed,
                "The original buffer did not pass one minute. No smaller setting was recommended.",
            )
            .await;
            return;
        }
        let Some(next) = next else {
            complete(
                &shared, owner,
                BufferFinderPhase::Done,
                "Screening finished and original settings restored. Use a measured setting through Apply and Keep, then qualify sustained playing.",
            ).await;
            return;
        };
        candidate = next.hardware(&original);
        observe = false;
    }
}
async fn complete(
    shared: &Shared,
    owner: AudioChangeOwner,
    phase: BufferFinderPhase,
    message: &str,
) {
    let (audio_phase, audio_message) = {
        let inner = shared.audio_change.lock();
        if inner.view.phase == AudioChangePhase::Failed {
            (AudioChangePhase::Failed, inner.view.message.clone())
        } else {
            (AudioChangePhase::Reverted, Some(message.into()))
        }
    };
    let audio = shared
        .audio_change
        .finish(audio_phase, audio_message, None)
        .await;
    let phase = if audio.phase == AudioChangePhase::Failed {
        BufferFinderPhase::Failed
    } else {
        phase
    };
    let cursor = owner.state(shared);
    let mut inner = shared.audio_change.lock();
    if let Some(finder) = &mut inner.view.finder {
        finder.session = cursor.session;
        finder.expected_revision = cursor.revision;
        finder.state = phase;
        finder.total = finder.trials.len() as u32;
        finder.message = Some(message.into());
        if phase == BufferFinderPhase::Failed {
            finder.recommended = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(frames: u64) -> meter::Snapshot {
        meter::Snapshot {
            frames,
            xruns: Some(7),
            deadline_misses: Some(2),
            ..Default::default()
        }
    }
    fn hardware() -> AudioChangeHardware {
        serde_json::from_value(serde_json::json!({
            "input": { "endpoint": "null", "direction": "capture", "sample_rate": 48000, "channels": 2, "period_frames": 128, "periods": 3, "format": "float" },
            "output": { "endpoint": "null", "direction": "playback", "sample_rate": 48000, "channels": 2, "period_frames": 128, "periods": 3, "format": "float" },
            "input_map": [0,1], "output_map": [0,1]
        })).unwrap()
    }
    #[test]
    fn a_full_minute_requires_known_continuously_advancing_unchanged_counters() {
        let start = Instant::now();
        assert!(
            Proof::new(
                start,
                Some(meter::Snapshot {
                    frames: 1,
                    ..Default::default()
                })
            )
            .is_err()
        );
        let mut proof = Proof::new(start, Some(sample(1))).unwrap();
        let hardware = hardware();
        for second in 1..60 {
            assert!(
                proof
                    .observe(
                        start + Duration::from_secs(second),
                        Some(sample(1 + second * 48000)),
                        &hardware
                    )
                    .is_none()
            );
        }
        let trial = proof
            .observe(start + LISTEN, Some(sample(1 + 60 * 48000)), &hardware)
            .unwrap();
        assert_eq!(trial.outcome, BufferTrialOutcome::Clean);
        assert_eq!(trial.elapsed_ms, 60000);
        assert_eq!(trial.xruns, Some(0));
    }
    #[test]
    fn missing_stale_reset_and_bad_samples_never_become_clean() {
        let start = Instant::now();
        let hardware = hardware();
        for (after, value, outcome) in [
            (2, Some(sample(1)), BufferTrialOutcome::Unavailable),
            (1, None, BufferTrialOutcome::Unavailable),
            (1, Some(sample(0)), BufferTrialOutcome::Failed),
            (
                1,
                Some(meter::Snapshot {
                    xruns: Some(8),
                    ..sample(48000)
                }),
                BufferTrialOutcome::Failed,
            ),
            (
                1,
                Some(meter::Snapshot {
                    deadline_misses: Some(3),
                    ..sample(48000)
                }),
                BufferTrialOutcome::Failed,
            ),
            (
                1,
                Some(meter::Snapshot {
                    deadline_misses: Some(1),
                    ..sample(48000)
                }),
                BufferTrialOutcome::Failed,
            ),
            (
                1,
                Some(meter::Snapshot {
                    invalid_samples: 1,
                    ..sample(48000)
                }),
                BufferTrialOutcome::Failed,
            ),
        ] {
            let mut proof = Proof::new(start, Some(sample(1))).unwrap();
            assert_eq!(
                proof
                    .observe(start + Duration::from_secs(after), value, &hardware)
                    .unwrap()
                    .outcome,
                outcome
            );
        }
    }
    #[test]
    fn a_few_fresh_frames_do_not_count_as_a_minute_of_audio() {
        let start = Instant::now();
        let hardware = hardware();
        let mut proof = Proof::new(start, Some(sample(1))).unwrap();
        for second in 1..62 {
            assert!(
                proof
                    .observe(
                        start + Duration::from_secs(second),
                        Some(sample(1 + second)),
                        &hardware
                    )
                    .is_none()
            );
        }
        assert_eq!(
            proof
                .observe(start + Duration::from_secs(62), Some(sample(63)), &hardware)
                .unwrap()
                .outcome,
            BufferTrialOutcome::Unavailable
        );
    }
    #[tokio::test]
    async fn stopped_trial_and_search_completion_share_one_confirmed_stop_receipt() {
        let change = Change::default();
        {
            let mut inner = change.lock();
            inner.stopped = true;
            inner.stop_requested = true;
            inner.stop_result = Some(Ok(()));
        }
        let first = change.finish(AudioChangePhase::Reverted, None, None).await;
        let second = tokio::time::timeout(
            Duration::from_millis(100),
            change.finish(
                AudioChangePhase::Failed,
                Some("Later completion".into()),
                None,
            ),
        )
        .await
        .unwrap();
        assert_eq!(first.phase, AudioChangePhase::Reverted);
        assert_eq!(second.phase, first.phase);
        assert_eq!(second.message, first.message);
    }
    #[test]
    fn original_is_the_only_recommendation_when_every_smaller_trial_fails() {
        let hardware = hardware();
        let mut plan = Plan {
            baseline: true,
            frames: true,
            best: None,
        };
        let mut trial = BufferTrial::refused(&hardware, "fixture");
        trial.outcome = BufferTrialOutcome::Clean;
        assert_eq!(
            plan.next(&trial),
            Some(BufferSetting {
                frames: 96,
                periods: 3
            })
        );
        trial.frames = 96;
        trial.outcome = BufferTrialOutcome::Failed;
        assert_eq!(
            plan.next(&trial),
            Some(BufferSetting {
                frames: 128,
                periods: 2
            })
        );
        trial.frames = 128;
        trial.periods = 2;
        assert!(plan.next(&trial).is_none());
        assert_eq!(
            plan.best,
            Some(BufferSetting {
                frames: 128,
                periods: 3
            })
        );
    }
    #[test]
    fn search_tests_baseline_then_descending_sizes_and_periods_and_is_bounded() {
        let hardware = hardware();
        let mut plan = Plan {
            baseline: true,
            frames: true,
            best: None,
        };
        let mut trial = BufferTrial::refused(&hardware, "test");
        assert!(plan.next(&trial).is_none());
        let mut plan = Plan {
            baseline: true,
            frames: true,
            best: None,
        };
        trial.outcome = BufferTrialOutcome::Clean;
        assert_eq!(
            plan.next(&trial),
            Some(BufferSetting {
                frames: 96,
                periods: 3
            })
        );
        trial.frames = 96;
        trial.outcome = BufferTrialOutcome::Failed;
        assert_eq!(
            plan.next(&trial),
            Some(BufferSetting {
                frames: 128,
                periods: 2
            })
        );
        trial.frames = 128;
        trial.periods = 2;
        trial.outcome = BufferTrialOutcome::Clean;
        assert!(plan.next(&trial).is_none());
        let mut plan = Plan {
            baseline: true,
            frames: true,
            best: None,
        };
        trial.frames = 2048;
        trial.periods = 8;
        let mut count = 1;
        while let Some(setting) = plan.next(&trial) {
            trial.frames = setting.frames;
            trial.periods = setting.periods;
            count += 1;
        }
        assert_eq!(count, 17);
    }
}
