//! Experimental ALSA duplex transport. Processor runs on the caller's thread.
use crate::{StreamConfig, samples};
use alsa::PCM;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Waiting,
    Processed,
}

#[derive(Debug)]
pub struct Duplex {
    host: crate::tools::HostSignal,
    capture: PCM,
    playback: PCM,
    config: StreamConfig,
    input: Vec<u8>,
    output: Vec<u8>,
    left: Vec<f32>,
    right: Vec<f32>,
    captured: usize,
    written: usize,
    pending: bool,
    faulted: bool,
    recovered_xruns: u64,
    meter: crate::meter::Meter,
}

impl Duplex {
    /// Opens only freshly enumerated hardware endpoints. No default/fallback output.
    pub fn open(config: StreamConfig) -> Result<Self, String> {
        config.validate()?;
        let inventory = crate::devices()?;
        crate::require_endpoint(&config.input, &inventory)?;
        crate::require_endpoint(&config.output, &inventory)?;
        Self::open_pcm(config)
    }
    /// ALSA null is a software fixture, not hardware qualification. Unavailable in ordinary builds.
    #[cfg(feature = "qualification")]
    pub fn qualification_null(mut config: StreamConfig) -> Result<Self, String> {
        config.validate()?;
        if [&config.input, &config.output].iter().any(|side| {
            !matches!(
                side.endpoint.as_str(),
                "null" | "hw:CARD=Qualification,DEV=0"
            )
        }) {
            return Err("Unknown software qualification device".into());
        }
        config.input.endpoint = "null".into();
        config.output.endpoint = "null".into();
        config.validate()?;
        Self::open_pcm(config)
    }
    fn open_pcm(config: StreamConfig) -> Result<Self, String> {
        let capture = crate::linux::configured(&config.input).map_err(|e| e.to_string())?;
        let playback = crate::linux::configured(&config.output).map_err(|e| e.to_string())?;
        // Start playback only after a small queue is primed; do not start from one thin block.
        let sw = playback.sw_params_current().map_err(|e| e.to_string())?;
        sw.set_avail_min(config.output.period_frames.into())
            .map_err(|e| e.to_string())?;
        sw.set_start_threshold(i64::from(
            config.output.period_frames * (config.output.periods - 1),
        ))
        .map_err(|e| e.to_string())?;
        playback.sw_params(&sw).map_err(|e| e.to_string())?;
        drop(sw);
        let frames = config.input.period_frames as usize;
        Ok(Self {
            host: crate::tools::HostSignal::new(config.input.sample_rate, config.hear_yourself),
            input: vec![
                0;
                frames
                    * config.input.channels as usize
                    * samples::width(config.input.format)
            ],
            output: vec![
                0;
                frames
                    * config.output.channels as usize
                    * samples::width(config.output.format)
            ],
            left: vec![0.0; frames],
            right: vec![0.0; frames],
            meter: crate::meter::Meter::new(config.input.period_frames, config.input.sample_rate),
            capture,
            playback,
            config,
            captured: 0,
            written: 0,
            pending: false,
            faulted: false,
            recovered_xruns: 0,
        })
    }
    /// At most one prepared block per call. EAGAIN waits at most 5ms; EPIPE re-primes both PCM handles.
    /// Other device failures and processor errors fail closed.
    /// No allocations on successful transport steps; the processor has its own RT qualification boundary.
    pub fn step(
        &mut self,
        process: impl FnOnce(&mut [f32], &mut [f32]) -> Result<(), String>,
    ) -> Result<Step, String> {
        if self.faulted {
            return Err("Stream failed; close and reopen it before processing".into());
        }
        let result = self.step_inner(process);
        if result.is_err() {
            self.faulted = true;
            let _ = self.capture.drop();
            let _ = self.playback.drop();
        }
        result
    }
    fn step_inner(
        &mut self,
        process: impl FnOnce(&mut [f32], &mut [f32]) -> Result<(), String>,
    ) -> Result<Step, String> {
        if self.pending {
            return self.write_pending();
        }
        let in_stride =
            self.config.input.channels as usize * samples::width(self.config.input.format);
        let frames = self.left.len();
        let read = self
            .capture
            .io_bytes()
            .readi(&mut self.input[self.captured * in_stride..]);
        let received = match read {
            Ok(n) => n,
            Err(e) if e.errno() == 11 => {
                return match self.capture.wait(Some(5)) {
                    Ok(_) => Ok(Step::Waiting),
                    Err(error) => self.transport_error(error, "Capture wait"),
                };
            }
            Err(e) => return self.transport_error(e, "Capture"),
        };
        if received == 0 {
            return Err("Capture returned zero frames".into());
        }
        self.captured += received;
        if self.captured < frames {
            return Ok(Step::Waiting);
        }
        if self.captured != frames {
            return Err("Capture exceeded prepared buffer".into());
        }
        for i in 0..frames {
            for (channel, target) in [
                (self.config.input_map[0], &mut self.left[i]),
                (self.config.input_map[1], &mut self.right[i]),
            ] {
                let width = samples::width(self.config.input.format);
                let start = i * in_stride + channel as usize * width;
                *target =
                    samples::decode(&self.input[start..start + width], self.config.input.format)?;
            }
        }
        self.meter.input(&self.left, &self.right);
        let started = std::time::Instant::now();
        self.host.input(&mut self.left, &mut self.right);
        process(&mut self.left, &mut self.right)?;
        self.host.output(&mut self.left, &mut self.right);
        let process_us = started.elapsed().as_secs_f64() * 1_000_000.0;
        self.meter.output(&self.left, &self.right, process_us);
        self.output.fill(0);
        let width = samples::width(self.config.output.format);
        let out_stride = self.config.output.channels as usize * width;
        for i in 0..frames {
            if self.config.output_map[0] == self.config.output_map[1] {
                let start = i * out_stride + self.config.output_map[0] as usize * width;
                samples::encode(
                    self.left[i] * 0.5 + self.right[i] * 0.5,
                    self.config.output.format,
                    &mut self.output[start..start + width],
                )?;
            } else {
                for (channel, value) in [
                    (self.config.output_map[0], self.left[i]),
                    (self.config.output_map[1], self.right[i]),
                ] {
                    let start = i * out_stride + channel as usize * width;
                    samples::encode(
                        value,
                        self.config.output.format,
                        &mut self.output[start..start + width],
                    )?;
                }
            }
        }
        self.captured = 0;
        self.written = 0;
        self.pending = true;
        self.write_pending()
    }
    fn transport_error(&mut self, error: alsa::Error, direction: &str) -> Result<Step, String> {
        // EPIPE is ALSA's recoverable capture overrun / playback underrun. A USB
        // disconnect, bad descriptor or processor error must not be disguised as recovery.
        if error.errno() != 32 {
            return Err(format!("{direction} stopped (device error): {error}"));
        }
        // Restart both sides together. Replaying an old partial output block or
        // retaining captured frames would mix samples from opposite sides of the gap.
        self.capture
            .drop()
            .map_err(|e| format!("Capture recovery stop failed: {e}"))?;
        self.playback
            .drop()
            .map_err(|e| format!("Playback recovery stop failed: {e}"))?;
        self.capture
            .prepare()
            .map_err(|e| format!("Capture recovery prepare failed: {e}"))?;
        self.playback
            .prepare()
            .map_err(|e| format!("Playback recovery prepare failed: {e}"))?;
        self.captured = 0;
        self.written = 0;
        self.pending = false;
        self.input.fill(0);
        self.output.fill(0);
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.recovered_xruns = self.recovered_xruns.saturating_add(1);
        // Keep the installed meter protocol compatible. The worker journal exposes
        // recovery until a separately versioned UI/daemon counter update ships.
        eprintln!(
            "Recovered ALSA xrun {} ({direction}); duplex re-primed",
            self.recovered_xruns
        );
        // The existing playback start threshold re-primes its queue. DSP state,
        // controls and accumulated meters remain intact; this is not gapless audio.
        Ok(Step::Waiting)
    }
    pub fn telemetry(&mut self) -> crate::meter::Snapshot {
        let mut snapshot = self.meter.snapshot();
        snapshot.monitoring = Some(self.host.state());
        snapshot
    }
    pub fn host_utility(&mut self, command: crate::tools::HostUtility) {
        if let crate::tools::HostUtility::HearYourself { enabled } = command {
            self.config.hear_yourself = enabled;
        }
        self.host.command(command);
    }
    fn write_pending(&mut self) -> Result<Step, String> {
        let stride =
            self.config.output.channels as usize * samples::width(self.config.output.format);
        let write = self
            .playback
            .io_bytes()
            .writei(&self.output[self.written * stride..]);
        let written = match write {
            Ok(n) => n,
            Err(e) if e.errno() == 11 => {
                return match self.playback.wait(Some(5)) {
                    Ok(_) => Ok(Step::Waiting),
                    Err(error) => self.transport_error(error, "Playback wait"),
                };
            }
            Err(e) => return self.transport_error(e, "Playback"),
        };
        if written == 0 {
            return Err("Playback returned zero frames".into());
        }
        self.written += written;
        if self.written > self.left.len() {
            return Err("Playback exceeded prepared buffer".into());
        }
        if self.written == self.left.len() {
            self.pending = false;
            Ok(Step::Processed)
        } else {
            Ok(Step::Waiting)
        }
    }
}
impl Drop for Duplex {
    fn drop(&mut self) {
        let _ = self.capture.drop();
        let _ = self.playback.drop();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AudioProbe, Direction, SampleFormat};
    fn config(format: SampleFormat) -> StreamConfig {
        let input = AudioProbe {
            endpoint: "null".into(),
            direction: Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format,
            period_frames: 128,
            periods: 3,
        };
        let mut output = input.clone();
        output.direction = Direction::Playback;
        StreamConfig {
            hear_yourself: true,
            input,
            output,
            input_map: [0, 1],
            output_map: [0, 1],
        }
    }
    #[test]
    fn null_transport_measures_host_output_tone_and_retains_input_monitor_state() {
        let mut stream = Duplex::open_pcm(config(SampleFormat::Float)).unwrap();
        stream.host_utility(crate::tools::HostUtility::HearYourself { enabled: false });
        stream.host_utility(crate::tools::HostUtility::TestTone);
        for _ in 0..20 {
            stream
                .step(|l, r| {
                    assert!(l.iter().chain(r.iter()).all(|v| *v == 0.0));
                    Ok(())
                })
                .unwrap();
        }
        let sample = stream.telemetry();
        assert!(sample.valid());
        assert!(!sample.monitoring.unwrap().hear_yourself);
        assert!(sample.monitoring.unwrap().test_tone_active);
        assert!((-31.0..=-29.0).contains(&sample.output[0].peak_dbfs));
        assert_eq!(sample.output[0].peak_dbfs, sample.output[1].peak_dbfs);
        stream.host_utility(crate::tools::HostUtility::StopTestTone);
        for _ in 0..20 {
            stream.step(|_, _| Ok(())).unwrap();
        }
        let stopped = stream.telemetry();
        assert!(!stopped.monitoring.unwrap().test_tone_active);
        assert_eq!(stopped.output[0].peak_dbfs, -120.0);
    }
    #[test]
    fn real_null_duplex_processes_and_reopens_without_retained_handles() {
        for format in [
            SampleFormat::S16,
            SampleFormat::S24,
            SampleFormat::S24Packed,
            SampleFormat::S32,
            SampleFormat::Float,
        ] {
            for _ in 0..2 {
                let cfg = config(format);
                cfg.validate().unwrap();
                let mut stream = Duplex::open_pcm(cfg).unwrap();
                let mut calls = 0;
                for _ in 0..20 {
                    let outcome = stream
                        .step(|l, r| {
                            assert_eq!(l.len(), 128);
                            l.fill(0.25);
                            r.fill(-0.25);
                            calls += 1;
                            Ok(())
                        })
                        .unwrap();
                    assert_eq!(outcome, Step::Processed);
                }
                assert_eq!(calls, 20);
            }
        }
    }
    #[test]
    fn rejects_independent_clocks_and_invalid_mapping() {
        let mut cfg = config(SampleFormat::S16);
        cfg.output.endpoint = "other".into();
        assert!(cfg.validate().is_err());
        cfg.output.endpoint = "null".into();
        cfg.input_map = [0, 2];
        assert!(cfg.validate().is_err());
    }
    #[test]
    fn xrun_recovery_discards_partial_transport_and_preserves_processing() {
        let mut stream = Duplex::open_pcm(config(SampleFormat::S24Packed)).unwrap();
        let mut processed = 0;
        for direction in ["Capture", "Playback", "Capture wait", "Playback wait"] {
            stream
                .step(|l, r| {
                    processed += 1;
                    l.fill(0.2);
                    r.fill(0.3);
                    Ok(())
                })
                .unwrap();
            let frames = stream.telemetry().frames;
            stream.captured = 19;
            stream.written = 23;
            stream.pending = true;
            stream.output.fill(255);
            assert_eq!(
                stream
                    .transport_error(alsa::Error::new("injected xrun", 32), direction)
                    .unwrap(),
                Step::Waiting
            );
            assert_eq!(
                (stream.captured, stream.written, stream.pending),
                (0, 0, false)
            );
            assert!(stream.output.iter().all(|b| *b == 0));
            assert!(!stream.faulted);
            assert_eq!(stream.telemetry().frames, frames);
            assert_eq!(
                stream
                    .step(|l, r| {
                        processed += 1;
                        l.fill(0.4);
                        r.fill(0.5);
                        Ok(())
                    })
                    .unwrap(),
                Step::Processed
            );
            assert_eq!(stream.telemetry().frames, frames + 128);
        }
        assert_eq!(processed, 8);
        assert_eq!(stream.recovered_xruns, 4);
        // Missing devices / invalid handles are not recoverable buffer xruns.
        for errno in [19, 77, 5] {
            assert!(
                stream
                    .transport_error(
                        alsa::Error::new("injected device failure", errno),
                        "Capture"
                    )
                    .is_err()
            );
        }
        assert_eq!(stream.recovered_xruns, 4);
    }
    #[test]
    fn processor_failure_does_not_submit_output() {
        let mut stream = Duplex::open_pcm(config(SampleFormat::S16)).unwrap();
        assert!(stream.step(|_, _| Err("processor failed".into())).is_err());
        assert!(!stream.pending);
        assert!(stream.faulted);
        assert!(
            stream
                .step(|_, _| panic!("failed stream must never process again"))
                .is_err()
        );
    }
}
