//! The Clock: runs the whole effect at a lower working rate.
//!
//! The input is low-passed and one sample is kept per engine step; the steps
//! are joined again by a straight line and low-passed on the way out. Grit
//! takes both filters away, which leaves a held, stepped and aliased signal.
//! At the full rate nothing is filtered and nothing is delayed.
//! @see docs/native-moment.md

use oxidal_dsp::{Smoothed, StateVariable, lerp};

/// The two stages of a fourth-order Butterworth low-pass.
const STAGE_Q: [f32; 2] = [0.5412, 1.3066];
/// The filters' corner as a share of the working rate.
const CORNER: f32 = 0.45;
/// Seconds a Clock change takes to glide.
const GLIDE_MS: f32 = 30.0;

#[derive(Debug)]
pub struct Clock<const N: usize> {
    rate: f32,
    ratio: Smoothed,
    grit: Smoothed,
    /// Fraction of an engine step that has passed.
    phase: f32,
    /// How much of the filtered signal is heard, 0 to 1.
    clean: f32,
    /// The ratio the filters are tuned to.
    tuned: f32,
    down: [[StateVariable; 2]; N],
    up: [[StateVariable; 2]; N],
    previous: [f32; N],
    current: [f32; N],
}

impl<const N: usize> Clock<N> {
    pub fn new(rate: f32) -> Self {
        let mut clock = Self {
            rate,
            ratio: Smoothed::new(rate, GLIDE_MS, 1.0),
            grit: Smoothed::new(rate, GLIDE_MS, 0.0),
            phase: 0.0,
            clean: 0.0,
            tuned: 1.0,
            down: [[StateVariable::default(); 2]; N],
            up: [[StateVariable::default(); 2]; N],
            previous: [0.0; N],
            current: [0.0; N],
        };
        clock.tune(1.0);
        clock
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.previous = [0.0; N];
        self.current = [0.0; N];
        for stage in self.down.iter_mut().chain(self.up.iter_mut()).flatten() {
            stage.reset();
        }
    }

    pub fn set(&mut self, ratio: f32, grit: f32) {
        self.ratio.set(ratio);
        self.grit.set(grit);
    }

    /// Jumps to the targets, for the first block after a reset.
    pub fn snap(&mut self, ratio: f32, grit: f32) {
        self.ratio.snap(ratio);
        self.grit.snap(grit);
        self.tune(ratio);
    }

    fn tune(&mut self, ratio: f32) {
        self.tuned = ratio;
        let corner = CORNER * self.rate / ratio;
        for stages in self.down.iter_mut().chain(self.up.iter_mut()) {
            for (stage, q) in stages.iter_mut().zip(STAGE_Q) {
                stage.set(self.rate, corner, q);
            }
        }
    }

    /// Takes one host sample; returns the input of an engine step when one is
    /// due.
    #[inline]
    pub fn input(&mut self, x: [f32; N]) -> Option<[f32; N]> {
        let ratio = self.ratio.next().max(1.0);
        let grit = self.grit.next();
        self.clean = (1.0 - grit) * ((ratio - 1.0) * 4.0).clamp(0.0, 1.0);
        if (ratio / self.tuned - 1.0).abs() > 0.005 {
            self.tune(ratio);
        }
        let mut filtered = x;
        for (y, stages) in filtered.iter_mut().zip(self.down.iter_mut()) {
            let raw = *y;
            let mut low = raw;
            for stage in stages.iter_mut() {
                stage.process(low);
                low = stage.low();
            }
            *y = lerp(raw, low, self.clean);
        }
        self.phase += 1.0 / ratio;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            Some(filtered)
        } else {
            None
        }
    }

    /// Takes the output of the engine step that [`Self::input`] asked for, if
    /// any; returns one host sample.
    #[inline]
    pub fn output(&mut self, step: Option<[f32; N]>) -> [f32; N] {
        if let Some(out) = step {
            self.previous = self.current;
            self.current = out;
        }
        let t = self.phase.clamp(0.0, 1.0);
        let mut rebuilt = self.current;
        for (channel, y) in rebuilt.iter_mut().enumerate() {
            let held = *y;
            let mut low = lerp(self.previous[channel], held, t);
            for stage in self.up[channel].iter_mut() {
                stage.process(low);
                low = stage.low();
            }
            *y = lerp(held, low, self.clean);
        }
        rebuilt
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_full_rate_passes_every_sample_with_no_delay() {
        let mut clock = Clock::<1>::new(48_000.0);
        clock.snap(1.0, 0.0);
        for i in 0..1000 {
            let x = [(i as f32 * 0.37).sin()];
            let step = clock.input(x);
            assert_eq!(step, Some(x));
            assert_eq!(clock.output(step), x);
        }
    }

    #[test]
    fn a_ratio_of_four_runs_one_step_in_four() {
        let mut clock = Clock::<1>::new(48_000.0);
        clock.snap(4.0, 0.0);
        let steps = (0..4000).filter(|_| clock.input([0.0]).is_some()).count();
        assert_eq!(steps, 1000);
    }
}
