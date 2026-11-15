//! The Spring mode: two springs, each a loop of a delay and a long chain of
//! stretched all-pass filters, after the structure of Välimäki, Parker and
//! Abel, "Parametric Spring Reverberation Effect" (J. Audio Eng. Soc., 2010).
//!
//! A helical spring is dispersive: below a transition frequency, higher
//! frequencies travel more slowly, so every echo arrives as a rising chirp
//! that stretches further on each round trip. A first-order all-pass whose
//! unit delay is stretched to `K` samples, `(a + z^-K) / (1 + a z^-K)`, has
//! exactly that rising group delay below `fs / 2K`; many of them in the loop
//! make the chirp. Only the band below the transition is modelled (the input
//! is low-passed there); the paper's weaker high-frequency chirps are left out.
//!
//! # References
//!
//! - Välimäki, Parker and Abel, "Parametric Spring Reverberation Effect" (2010). <https://aes2.org/publications/elibrary-page/?id=15511>
//! - Parker and Bilbao, "Spring Reverberation: A Physical Perspective" (2009). <https://dafx.de/paper-archive/details/MBjqiMDVjnAseoN9C-fzBw>
//!
//! @see docs/native-bloom.md

use crate::parts::{
    Engine, FadingTap, Glide, Lin, RING_OUT_SECONDS, Settings, TICK, absorb, absorb_corner,
    absorb_cut, decay_trim, follow, loop_gain, opaque_debug, tick_smoother,
};
use core::f32::consts::TAU;
use oxidal_dsp::{DelayLine, Smoothed, StateVariable, lerp};

/// All-pass stages in each spring's chain.
const STAGES: usize = 64;
/// The transition frequency aimed for; the stretch is the nearest whole
/// number of samples, so the real one is `fs / 2K`.
const TRANSITION_HERTZ: f32 = 4000.0;
/// All-pass coefficient of each spring: sets how sharply the delay rises
/// towards the transition. With 64 stages these spread one pass over about
/// 35 ms, a little less than the echo period.
const COEFFICIENT: [f32; 2] = [0.62, 0.66];
/// Echo period of each spring at Size 50%, in seconds: two unrelated times.
const PERIOD: [f32; 2] = [0.043, 0.061];
/// Size scales the periods by 2^(+-0.5).
const SIZE_OCTAVES: f32 = 1.0;
/// Deepest modulation of the loop delay, in seconds, at Mod 100%.
const DEPTH_SECONDS: f32 = 0.0002;
/// How much of the other spring each output hears.
const CROSS: f32 = 0.2;
/// The second spring's longer period lets it hold less energy at the same
/// decay time; this makes up the difference, the square root of the periods' ratio.
const SECOND_TRIM: f32 = 1.19;
/// Butterworth quality factors of a fourth-order low-pass, `1 / (2 cos)` of
/// the pole angles pi/8 and 3 pi/8.
const BUTTERWORTH: [f32; 2] = [0.541_196, 1.306_563];
/// Input trim, measured so a sustained note comes out near its own level.
const LEVEL: f32 = 0.42;

/// The spring engine.
pub struct Spring {
    sample_rate: f32,
    stereo: bool,
    /// Stretch of the all-pass unit delay, in samples (`K`).
    stretch: usize,
    /// `STAGES` rows of `stretch` samples for each spring.
    state: [Vec<f32>; 2],
    position: usize,
    lines: [DelayLine; 2],
    taps: [FadingTap; 2],
    damp: [f32; 2],
    gain: [f32; 2],
    cut: [f32; 2],
    /// What one all-pass stage loses, so the chirp decays as fast as the rest.
    stage: f32,
    corner: f32,
    lowpass: [StateVariable; 2],
    phases: [f32; 2],
    offsets: [Lin; 2],
    depth: Smoothed,
    modulated: bool,
    drive: Glide,
    hold: Smoothed,
    applied: f32,
    retunes: u32,
    last: (f32, f32, f32, u32),
}
opaque_debug!(Spring);

impl Spring {
    /// Allocates everything for `sample_rate`. Not for the audio thread.
    pub fn new(sample_rate: f32, stereo: bool) -> Self {
        let stretch = ((sample_rate / (2.0 * TRANSITION_HERTZ)).round() as usize).clamp(2, TICK);
        let transition = sample_rate / (2.0 * stretch as f32);
        let longest = PERIOD[1] * 2.0_f32.powf(0.5 * SIZE_OCTAVES) * sample_rate;
        let mut lowpass = [StateVariable::default(); 2];
        for (filter, q) in lowpass.iter_mut().zip(BUTTERWORTH) {
            filter.set(sample_rate, 0.9 * transition, q);
        }
        let mut spring = Self {
            sample_rate,
            stereo,
            stretch,
            state: core::array::from_fn(|_| vec![0.0; STAGES * stretch]),
            position: 0,
            lines: core::array::from_fn(|_| DelayLine::new(longest.ceil() as usize + 64)),
            taps: [FadingTap::new(sample_rate, 1); 2],
            damp: [0.0; 2],
            gain: [0.0; 2],
            cut: [0.0; 2],
            stage: 0.0,
            corner: 1.0,
            lowpass,
            phases: [0.0, 0.37],
            offsets: [Lin::default(); 2],
            depth: tick_smoother(sample_rate, 30.0, 0.0),
            modulated: false,
            drive: Glide::new(sample_rate, 15.0, 0.0),
            hold: tick_smoother(sample_rate, 25.0, 0.0),
            applied: -1.0,
            retunes: 0,
            last: (-1.0, -1.0, -1.0, 0),
        };
        spring.retune(0.5, true);
        spring
    }

    /// The transition frequency of this instance in hertz.
    pub fn transition(&self) -> f32 {
        self.sample_rate / (2.0 * self.stretch as f32)
    }

    /// Echo period of spring `index` in seconds at `size`.
    fn period(index: usize, size: f32) -> f32 {
        PERIOD.get(index).copied().unwrap_or(0.05) * 2.0_f32.powf((size - 0.5) * SIZE_OCTAVES)
    }

    /// Sets the loop delays so each spring's lowest frequencies come round
    /// once per period: the delay line makes up what the chain does not.
    fn retune(&mut self, size: f32, snap: bool) {
        let taps = self.taps.iter_mut().zip(&self.lines).zip(COEFFICIENT);
        for (index, ((tap, line), a)) in taps.enumerate() {
            let chain = (STAGES * self.stretch) as f32 * (1.0 - a) / (1.0 + a);
            let wanted = Self::period(index, size) * self.sample_rate - chain;
            let least = 2 * TICK + 16;
            let delay =
                (wanted as usize).clamp(least, line.capacity().saturating_sub(40).max(least));
            tap.drive(delay - 1, snap);
        }
        self.applied = size;
        self.retunes = self.retunes.wrapping_add(1);
    }
}

impl Engine for Spring {
    fn clear_step(&mut self, step: usize) -> bool {
        match step {
            0 | 1 => {
                if let Some(line) = self.lines.get_mut(step) {
                    line.clear();
                }
            }
            2 | 3 => {
                if let Some(state) = self.state.get_mut(step - 2) {
                    state.fill(0.0);
                }
            }
            _ => {
                self.damp = [0.0; 2];
                for filter in &mut self.lowpass {
                    filter.reset();
                }
                return true;
            }
        }
        false
    }

    fn tick(&mut self, settings: &Settings, active: bool, snap: bool) {
        let rate = self.sample_rate;
        let idle = self.taps.iter().all(FadingTap::idle);
        if snap || ((settings.size - self.applied).abs() > 0.004 && idle) {
            self.retune(settings.size, snap);
        }
        let hold = follow(
            &mut self.hold,
            if active { settings.freeze } else { 0.0 },
            snap,
        );
        let decay = if active {
            settings.decay
        } else {
            settings.decay.min(RING_OUT_SECONDS)
        };
        self.drive.drive(LEVEL * decay_trim(settings.decay), snap);

        let depth = DEPTH_SECONDS * rate * settings.modulation * (1.0 - hold);
        let depth = follow(&mut self.depth, depth, snap);
        let step = 0.7 * 4.0_f32.powf(settings.speed - 0.5) * TICK as f32 / rate;
        let mut modulated = false;
        let lfos = self.phases.iter_mut().zip(self.offsets.iter_mut());
        for ((phase, offset), multiple) in lfos.zip([1.0, 1.37]) {
            *phase += step * multiple;
            *phase -= phase.floor();
            offset.drive(depth * (TAU * *phase).sin(), snap);
            modulated |= !offset.rests_at(0.0);
        }
        self.modulated = modulated;

        let key = (decay, settings.tone, hold, self.retunes);
        if snap || key != self.last {
            self.last = key;
            let (coefficient, reach) = absorb_corner(rate, 800.0 * 4.0_f32.powf(settings.tone));
            self.corner = coefficient;
            let faster = 1.0 / lerp(0.25, 1.0, settings.tone) - 1.0;
            self.stage = loop_gain(self.stretch as f32 / rate, decay, hold);
            let gains = self
                .gain
                .iter_mut()
                .zip(self.cut.iter_mut())
                .zip(&self.taps);
            for (index, ((gain, cut), tap)) in gains.enumerate() {
                let period = Self::period(index, self.applied);
                *gain = loop_gain((tap.target() + 1) as f32 / rate, decay, hold);
                *cut = absorb_cut(loop_gain(period * faster, decay, hold), reach);
            }
        }
    }

    #[inline]
    fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) -> f32 {
        let mut peak = 0.0_f32;
        // The drive: both inputs summed and low-passed below the transition.
        let mut drive = [0.0_f32; TICK];
        let mut frames = 0;
        for (value, (&xl, &xr)) in drive.iter_mut().zip(in_l.iter().zip(in_r)) {
            let mut x = 0.5 * (xl + xr) * self.drive.next();
            peak = peak.max(x.abs());
            for filter in &mut self.lowpass {
                filter.process(x);
                x = filter.low();
            }
            *value = x;
            frames += 1;
        }
        let frames = frames.min(out_l.len()).min(out_r.len());

        // Every stage only couples samples `stretch` apart, so a run of up
        // to `stretch` samples can pass through a stage together.
        let stretch = self.stretch.max(1);
        let stage = self.stage;
        let mut done = 0;
        while done < frames {
            let run = (frames - done).min(stretch - self.position.min(stretch - 1));
            let mut sums = [[0.0_f32; TICK]; 2];
            let springs = self.lines.iter_mut().zip(self.taps.iter_mut());
            let losses = self.damp.iter_mut().zip(self.gain.iter().zip(&self.cut));
            let chains = self.state.iter_mut().zip(COEFFICIENT);
            let moves = self.offsets.iter_mut().zip(sums.iter_mut());
            for ((((line, tap), (damp, (&gain, &cut))), (state, a)), (offset, sum)) in
                springs.zip(losses).zip(chains).zip(moves)
            {
                let mut block = [0.0_f32; TICK];
                let inputs = drive.iter().skip(done).take(run);
                for (j, (value, &x)) in block.iter_mut().zip(inputs).enumerate() {
                    let back = if self.modulated {
                        tap.read_frac(line, offset.next() - j as f32)
                    } else {
                        tap.read_back(line, j)
                    };
                    peak = peak.max(back.abs());
                    *value = x + absorb(damp, back, self.corner, gain, cut);
                }
                for row in state.chunks_exact_mut(stretch) {
                    let cells = row.iter_mut().skip(self.position).take(run);
                    for (cell, value) in cells.zip(block.iter_mut()) {
                        let delayed = stage * *cell;
                        let inner = *value - a * delayed;
                        *value = a * inner + delayed;
                        *cell = inner;
                    }
                }
                for (&value, kept) in block.iter().take(run).zip(sum.iter_mut()) {
                    line.write(value);
                    *kept = value;
                }
            }
            let outs = out_l.iter_mut().zip(out_r.iter_mut()).skip(done).take(run);
            for (j, (left, right)) in outs.enumerate() {
                let a = sums[0].get(j).copied().unwrap_or(0.0);
                let b = SECOND_TRIM * sums[1].get(j).copied().unwrap_or(0.0);
                if self.stereo {
                    *left += a + CROSS * b;
                    *right += b + CROSS * a;
                } else {
                    *left += 0.74 * (a + b);
                }
            }
            self.position = (self.position + run) % stretch;
            done += run;
        }
        peak
    }
}
