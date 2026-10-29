//! Fixed-size, allocation-free audio measurements. JSON and rendering happen elsewhere.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Channel {
    pub peak_dbfs: f64,
    pub rms_dbfs: f64,
    /// Samples at or above full scale, cumulative for this worker lifetime.
    pub clips: u64,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monitoring: Option<crate::tools::HostState>,
    pub frames: u64,
    pub input: [Channel; 2],
    pub output: [Channel; 2],
    pub process_us_p50: f64,
    pub process_us_p95: f64,
    pub process_us_max: f64,
    pub deadline_us: f64,
    pub invalid_samples: u64,
}
impl Snapshot {
    pub fn valid(&self) -> bool {
        self.input
            .iter()
            .chain(self.output.iter())
            .all(|c| c.peak_dbfs.is_finite() && c.rms_dbfs.is_finite())
            && [
                self.process_us_p50,
                self.process_us_p95,
                self.process_us_max,
                self.deadline_us,
            ]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0)
    }
}
#[derive(Debug, Clone, Copy, Default)]
struct Accumulator {
    peak: f64,
    square: f64,
    count: u64,
    clips: u64,
    invalid: u64,
}
impl Accumulator {
    fn add(&mut self, samples: &[f32]) {
        for &sample in samples {
            if !sample.is_finite() {
                self.invalid = self.invalid.saturating_add(1);
                continue;
            }
            let v = f64::from(sample).abs();
            self.peak = self.peak.max(v);
            self.square += v * v;
            self.count = self.count.saturating_add(1);
            if v >= 1.0 {
                self.clips = self.clips.saturating_add(1);
            }
        }
    }
    fn snapshot(&mut self) -> Channel {
        let db = |v: f64| 20.0 * v.max(0.000001).log10();
        let result = Channel {
            peak_dbfs: db(self.peak),
            rms_dbfs: db((self.square / self.count.max(1) as f64).sqrt()),
            clips: self.clips,
        };
        self.peak = 0.0;
        self.square = 0.0;
        self.count = 0;
        result
    }
}
#[derive(Debug)]
pub struct Meter {
    input: [Accumulator; 2],
    output: [Accumulator; 2],
    frames: u64,
    durations: [f64; 128],
    count: usize,
    index: usize,
    deadline: f64,
}
impl Meter {
    pub fn new(frames: u32, rate: u32) -> Self {
        Self {
            input: [Accumulator::default(); 2],
            output: [Accumulator::default(); 2],
            frames: 0,
            durations: [0.0; 128],
            count: 0,
            index: 0,
            deadline: f64::from(frames) * 1_000_000.0 / f64::from(rate.max(1)),
        }
    }
    pub fn input(&mut self, left: &[f32], right: &[f32]) {
        self.input[0].add(left);
        self.input[1].add(right);
    }
    pub fn output(&mut self, left: &[f32], right: &[f32], process_us: f64) {
        self.output[0].add(left);
        self.output[1].add(right);
        self.frames = self.frames.saturating_add(left.len() as u64);
        self.durations[self.index] = if process_us.is_finite() {
            process_us.max(0.0)
        } else {
            0.0
        };
        self.index = (self.index + 1) % 128;
        self.count = (self.count + 1).min(128);
    }
    /// Resets only interval levels; counts remain cumulative so clients can reset their own view.
    pub fn snapshot(&mut self) -> Snapshot {
        let mut times = self.durations;
        times[..self.count].sort_unstable_by(f64::total_cmp);
        let q = |percent: usize| {
            if self.count == 0 {
                0.0
            } else {
                times[((self.count - 1) * percent) / 100]
            }
        };
        Snapshot {
            monitoring: None,
            frames: self.frames,
            input: [self.input[0].snapshot(), self.input[1].snapshot()],
            output: [self.output[0].snapshot(), self.output[1].snapshot()],
            process_us_p50: q(50),
            process_us_p95: q(95),
            process_us_max: q(100),
            deadline_us: self.deadline,
            invalid_samples: self
                .input
                .iter()
                .chain(self.output.iter())
                .map(|a| a.invalid)
                .sum(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "run with --release --ignored --nocapture to report local metering overhead"]
    fn metering_cost_report() {
        let mut meter = Meter::new(128, 48000);
        let samples = [0.25f32; 128];
        let started = std::time::Instant::now();
        for i in 0..100_000 {
            meter.input(
                std::hint::black_box(&samples),
                std::hint::black_box(&samples),
            );
            meter.output(
                std::hint::black_box(&samples),
                std::hint::black_box(&samples),
                10.0,
            );
            if i % 75 == 0 {
                std::hint::black_box(meter.snapshot());
            }
        }
        let us = started.elapsed().as_secs_f64() * 1_000_000.0 / 100_000.0;
        println!(
            "Meter accumulation and decimated snapshot: {us:.3} us/block, {:.3}% of 128-frame/48k period; host measurement, not Pi qualification",
            us / (128.0 / 48000.0 * 1_000_000.0) * 100.0
        );
        assert_eq!(meter.snapshot().frames, 12_800_000);
    }
    #[test]
    fn known_stereo_signals_and_reset_keep_clips_and_frames() {
        let mut meter = Meter::new(4, 48000);
        meter.input(&[0.5, -0.5, 0.5, -0.5], &[0.0; 4]);
        meter.output(&[1.0, -1.2, 0.0, 0.0], &[0.25; 4], 20.0);
        let s = meter.snapshot();
        assert!(s.valid());
        assert!((s.input[0].peak_dbfs + 6.0205999).abs() < 0.0001);
        assert!((s.input[0].rms_dbfs + 6.0205999).abs() < 0.0001);
        assert_eq!(s.input[1].peak_dbfs, -120.0);
        assert_eq!(s.output[0].clips, 2);
        assert_eq!(s.frames, 4);
        let reset = meter.snapshot();
        assert_eq!(reset.output[0].peak_dbfs, -120.0);
        assert_eq!(reset.output[0].clips, 2);
    }
    #[test]
    fn bounded_timing_window_and_nonfinite_samples_are_explicit() {
        let mut meter = Meter::new(128, 48000);
        for n in 0..256 {
            meter.input(&[f32::NAN], &[0.0]);
            meter.output(&[0.0], &[f32::INFINITY], n as f64);
        }
        let s = meter.snapshot();
        assert_eq!(s.process_us_max, 255.0);
        assert_eq!(s.process_us_p50, 191.0);
        assert_eq!(s.process_us_p95, 248.0);
        assert_eq!(s.invalid_samples, 512);
        assert!(s.valid());
    }
}
