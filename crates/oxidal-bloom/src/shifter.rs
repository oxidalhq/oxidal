//! Delay-line pitch shifter for the Shimmer mode.
//!
//! Two taps read one delay line while their delay slides at a constant rate,
//! which plays the signal back faster or slower; each tap fades out before
//! its delay wraps round and the other, half a sweep away, covers for it.
//!
//! # References
//!
//! - Zölzer, "DAFX: Digital Audio Effects, 2nd edition" (2011). <https://doi.org/10.1002/9781119991298>
//!
//! @see docs/native-bloom.md

use crate::parts::opaque_debug;
use oxidal_dsp::DelayLine;

/// Pitch shifter with two crossfaded taps.
pub struct Shifter {
    line: DelayLine,
    /// Delay of the first tap as a fraction of the sweep, 0 to 1.
    phase: f32,
}
opaque_debug!(Shifter);

/// Weight of a tap at `phase`: zero where the delay wraps, one in the middle,
/// and the weights of two taps half a sweep apart always sum to one.
#[inline]
fn window(phase: f32) -> f32 {
    let t = 1.0 - (2.0 * phase - 1.0).abs();
    t * t * (3.0 - 2.0 * t)
}

impl Shifter {
    /// Allocates for sweeps up to `max_sweep` samples. Not for the audio thread.
    pub fn new(max_sweep: usize) -> Self {
        Self {
            line: DelayLine::new(max_sweep + 8),
            phase: 0.0,
        }
    }
    pub fn clear(&mut self) {
        self.line.clear();
        self.phase = 0.0;
    }
    /// One sample in, one out, played back at `ratio` times the speed, with
    /// the delay sweeping over `sweep` samples. The output is a convex blend
    /// of delayed input samples, so it is never larger than the input peak.
    #[inline]
    pub fn process(&mut self, x: f32, ratio: f32, sweep: f32) -> f32 {
        self.line.write(x);
        let sweep = sweep.max(16.0);
        let mut phase = self.phase + (1.0 - ratio) / sweep;
        phase -= phase.floor();
        if !(0.0..1.0).contains(&phase) {
            phase = 0.0;
        }
        self.phase = phase;
        let other = if phase < 0.5 {
            phase + 0.5
        } else {
            phase - 0.5
        };
        let weight = window(phase);
        let a = self.line.read(phase * sweep);
        let b = self.line.read(other * sweep);
        b + (a - b) * weight
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Counts rising zero crossings to estimate a frequency.
    fn frequency(signal: &[f32], sample_rate: f32) -> f32 {
        let crossings = signal
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        crossings as f32 * sample_rate / signal.len() as f32
    }

    #[test]
    fn shifts_a_tone_by_the_ratio() {
        for (ratio, expected) in [(2.0, 880.0), (1.498_307, 659.26), (0.5, 220.0)] {
            let mut shifter = Shifter::new(4096);
            let sweep = 0.08 * 48_000.0 * (ratio - 1.0_f32).abs();
            let out: Vec<f32> = (0..48_000)
                .map(|i| {
                    let x = (core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0).sin();
                    shifter.process(x, ratio, sweep)
                })
                .collect();
            let measured = frequency(&out[9600..], 48_000.0);
            assert!(
                (measured / expected - 1.0).abs() < 0.03,
                "ratio {ratio}: {measured} Hz"
            );
            assert!(out.iter().all(|y| y.abs() <= 1.0001));
        }
    }

    #[test]
    fn windows_sum_to_one() {
        for step in 0..100 {
            let phase = step as f32 / 100.0;
            let other = if phase < 0.5 {
                phase + 0.5
            } else {
                phase - 0.5
            };
            assert!((window(phase) + window(other) - 1.0).abs() < 1e-6);
        }
    }
}
