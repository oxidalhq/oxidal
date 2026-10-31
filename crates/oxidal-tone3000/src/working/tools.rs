//! Utility measurements run on the same native control owner, outside PCM.
use super::*;
use oxidal_audio::tools::{Command, Measurement, Phase};
#[derive(Debug)]
pub(super) struct Baseline {
    state: State,
    latency: u32,
    alignment: bool,
}
impl Authoring {
    /// Tuner-only commands can update their existing status without rebuilding
    /// the full native catalog. Mixed rigs call this while holding the render
    /// lock, so keep the common live-tuner path to one bounded utility read.
    pub fn lightweight_tuner_command(
        &mut self,
        engine: &mut Engine,
        command: Command,
    ) -> Result<Option<oxidal_audio::tools::State>, String> {
        if self.measurement.is_some()
            || self.tools.spectrum.is_some()
            || self.gesture_pending()
            || !matches!(command, Command::Tuner { .. } | Command::Poll)
        {
            return Ok(None);
        }
        self.tools.error = None;
        match command {
            Command::Tuner { enabled } => {
                engine
                    .utility(if enabled { 1 } else { 2 })
                    .map_err(|e| e.to_string())?;
                self.tools.tuner_enabled = enabled;
                if !enabled {
                    self.tools.tuner = None;
                }
            }
            Command::Poll if self.tools.tuner_enabled => {
                self.tools.tuner = Some(
                    serde_json::from_value(engine.utility(0).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?,
                );
            }
            Command::Poll => {}
            _ => unreachable!(),
        }
        Ok(Some(self.tools.clone()))
    }
    pub fn measurement_pending(&self) -> bool {
        self.measurement.is_some()
    }
    /// True when a poll could only re-read unchanged state: no tuner or
    /// measurement running and no adjustment old enough to expire. Workers answer
    /// such polls from their last reply instead of querying the native engine.
    pub fn poll_is_quiet(&self) -> bool {
        !self.tools.active()
            && self.measurement.is_none()
            && self
                .gesture
                .as_ref()
                .is_none_or(|g| g.updated.elapsed() <= std::time::Duration::from_secs(110))
    }
    fn cancel_tools(&mut self, engine: &mut Engine) -> Result<(), String> {
        engine
            .utility(5)
            .and_then(|_| engine.utility(8))
            .map_err(|e| e.to_string())?;
        self.tools.balance = Default::default();
        self.tools.alignment = Default::default();
        self.measurement = None;
        Ok(())
    }
    pub(super) fn utility_command(
        &mut self,
        engine: &mut Engine,
        command: Command,
    ) -> Result<AuthoringStatus, String> {
        self.tools.error = None;
        match command {
            Command::Solo { side } => {
                if self.measurement_pending() {
                    return Err("Finish matching before solo monitoring".into());
                }
                engine.set_solo(side).map_err(|e| e.to_string())?;
            }
            Command::Tuner { enabled } => {
                engine
                    .utility(if enabled { 1 } else { 2 })
                    .map_err(|e| e.to_string())?;
                self.tools.tuner_enabled = enabled;
                if !enabled {
                    self.tools.tuner = None;
                }
            }
            Command::Cancel => self.cancel_tools(engine)?,
            Command::Balance | Command::Align => {
                if self.snapshot(engine)?.tools.solo != oxidal_audio::tools::Solo::None {
                    return Err("Clear solo before matching chains".into());
                }
                if self.measurement_pending() {
                    return Err("Cancel the active measurement first".into());
                }
                if !engine.layout().map_err(|e| e.to_string())?.stereo {
                    return Err("Two stereo chains are required for automatic matching".into());
                }
                let baseline = Baseline {
                    state: engine.capture().map_err(|e| e.to_string())?,
                    latency: engine.latency_samples().map_err(|e| e.to_string())?,
                    alignment: matches!(command, Command::Align),
                };
                engine
                    .utility(if baseline.alignment { 6 } else { 3 })
                    .map_err(|e| e.to_string())?;
                let measuring = Measurement {
                    state: Phase::Listening,
                    ..Default::default()
                };
                if baseline.alignment {
                    self.tools.alignment = measuring;
                } else {
                    self.tools.balance = measuring;
                }
                self.measurement = Some(baseline);
            }
            Command::Poll => {
                if let Some(spectrum) = &mut self.tools.spectrum {
                    match engine.spectrum(&spectrum.block_id, None) {
                        Ok(bins) => spectrum.bins = bins,
                        Err(_) => self.tools.spectrum = None,
                    }
                }
                if self.tools.tuner_enabled {
                    self.tools.tuner = Some(
                        serde_json::from_value(engine.utility(0).map_err(|e| e.to_string())?)
                            .map_err(|e| e.to_string())?,
                    );
                }
                if let Some(baseline) = &self.measurement {
                    let alignment = baseline.alignment;
                    let measured: Measurement = serde_json::from_value(
                        engine
                            .utility(if alignment { 7 } else { 4 })
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
                    let done = measured.state == Phase::Done;
                    let finished = measured.state != Phase::Listening;
                    if alignment {
                        self.tools.alignment = measured;
                    } else {
                        self.tools.balance = measured;
                    }
                    if finished {
                        let baseline = self.measurement.take().unwrap();
                        if done {
                            let result = (|| -> Result<(State, String), String> {
                                if engine.latency_samples().map_err(|e| e.to_string())?
                                    != baseline.latency
                                {
                                    return Err("Measurement changed reported latency".into());
                                }
                                engine.live_controls().map_err(|e| e.to_string())?;
                                if !self.tools.valid() {
                                    return Err("Invalid native utility readback".into());
                                }
                                let after = engine.capture().map_err(|e| e.to_string())?;
                                self.settle_writes();
                                let receipt = self.checkpoint(&after, &baseline.state, None)?;
                                Ok((after, receipt))
                            })();
                            match result {
                                Ok((after, receipt)) => {
                                    if after != baseline.state {
                                        self.undo.push_back(baseline.state);
                                        self.redo.clear();
                                        self.trim_history();
                                    }
                                    self.history_error = None;
                                    self.working = Some(receipt);
                                }
                                Err(error) => {
                                    self.cancel_tools(engine)?;
                                    if let Err(rollback) = engine
                                        .restore(&baseline.state)
                                        .and_then(|_| engine.wait_ready())
                                    {
                                        self.failed = true;
                                        return Err(format!(
                                            "Measurement rollback failed: {rollback}; {error}"
                                        ));
                                    }
                                    self.tools.error = Some(
                                        error
                                            .chars()
                                            .filter(|c| !c.is_control())
                                            .take(256)
                                            .collect(),
                                    );
                                    return Err(error);
                                }
                            }
                        }
                    }
                }
            }
        }
        self.snapshot(engine)
    }
}
