//! The Plate mode: a figure-of-eight tank of two all-passes and two delays
//! per half, after Dattorro, "Effect Design, Part 1: Reverberator and Other
//! Filters" (J. Audio Eng. Soc., 1997). Lengths, all-pass gains and output
//! tap positions are the paper's, scaled from its 29,761 Hz to the sample
//! rate. The paper's single decay gain is replaced by one gain per section,
//! set from the section's length and the decay time.
//!
//! # References
//!
//! - Dattorro, "Effect Design, Part 1: Reverberator and Other Filters" (1997). <https://aes2.org/publications/elibrary-page/?id=10160>
//!
//! @see docs/native-bloom.md

use crate::parts::{
    Allpass, Engine, FadingTap, Glide, Lin, RING_OUT_SECONDS, Settings, TICK, absorb,
    absorb_corner, absorb_cut, decay_trim, follow, loop_gain, opaque_debug, tick_smoother,
};
use core::f32::consts::TAU;
use oxidal_dsp::{DelayLine, Smoothed, lerp};

/// The sample rate the paper's lengths are given for.
const PAPER_RATE: f32 = 29_761.0;
/// Input diffusers: length and gain.
const INPUT: [(f32, f32); 4] = [(142.0, 0.75), (107.0, 0.75), (379.0, 0.625), (277.0, 0.625)];
/// Each half of the tank: modulated all-pass, delay, all-pass, delay.
const HALVES: [[f32; 4]; 2] = [
    [672.0, 4453.0, 1800.0, 3720.0],
    [908.0, 4217.0, 2656.0, 3163.0],
];
/// Gains of the two all-passes of a half.
const SWIRL_GAIN: f32 = -0.7;
const SETTLE_GAIN: f32 = 0.5;
/// How far the paper moves the modulated all-pass, in its samples.
const EXCURSION: f32 = 16.0;
/// Output taps: half of the tank, element (0 first delay, 1 second all-pass,
/// 2 second delay), position in the paper's samples, sign.
type Tap = (usize, usize, f32, f32);
const OUTPUT: [[Tap; 7]; 2] = [
    [
        (1, 0, 266.0, 1.0),
        (1, 0, 2974.0, 1.0),
        (1, 1, 1913.0, -1.0),
        (1, 2, 1996.0, 1.0),
        (0, 0, 1990.0, -1.0),
        (0, 1, 187.0, -1.0),
        (0, 2, 1066.0, -1.0),
    ],
    [
        (0, 0, 353.0, 1.0),
        (0, 0, 3627.0, 1.0),
        (0, 1, 1228.0, -1.0),
        (0, 2, 2673.0, 1.0),
        (1, 0, 2111.0, -1.0),
        (1, 1, 335.0, -1.0),
        (1, 2, 121.0, -1.0),
    ],
];
/// The paper's output gain.
const OUTPUT_GAIN: f32 = 0.6;
/// Size 0, 50 and 100% scale the tank by these factors.
const SCALES: (f32, f32, f32) = (0.6, 1.0, 1.12);
/// Input trim, measured so a sustained note comes out near its own level.
const LEVEL: f32 = 0.66;

#[derive(Debug)]
struct Half {
    swirl: Allpass,
    first: DelayLine,
    first_tap: FadingTap,
    settle: Allpass,
    second: DelayLine,
    second_tap: FadingTap,
    damp: f32,
    /// Gains of the two delays and, inside them, of the two all-passes: each
    /// loses what its own length calls for. Then the high cut of the half.
    gains: (f32, f32),
    inner: (f32, f32),
    cut: f32,
    phase: f32,
    offset: Lin,
}

impl Half {
    fn element(&self, element: usize) -> Option<&DelayLine> {
        match element {
            0 => Some(&self.first),
            1 => Some(self.settle.line()),
            2 => Some(&self.second),
            _ => None,
        }
    }
}

/// The plate tank engine.
pub struct Plate {
    sample_rate: f32,
    stereo: bool,
    applied: f32,
    retunes: u32,
    input: [Allpass; 4],
    halves: [Half; 2],
    taps: [[FadingTap; 7]; 2],
    corner: f32,
    depth: Smoothed,
    modulated: bool,
    drive: Glide,
    hold: Smoothed,
    last: (f32, f32, f32, u32),
}
opaque_debug!(Plate);

impl Plate {
    /// Allocates everything for `sample_rate`. Not for the audio thread.
    pub fn new(sample_rate: f32, stereo: bool) -> Self {
        let ratio = sample_rate / PAPER_RATE;
        let largest = |length: f32| (length * ratio * SCALES.2).ceil() as usize + 16;
        let swing = (2.0 * EXCURSION * ratio).ceil() as usize + 8;
        let halves = core::array::from_fn(|h| {
            let lengths = HALVES.get(h).copied().unwrap_or([8.0; 4]);
            Half {
                swirl: Allpass::new(sample_rate, largest(lengths[0]) + swing),
                first: DelayLine::new(largest(lengths[1])),
                first_tap: FadingTap::new(sample_rate, 1),
                settle: Allpass::new(sample_rate, largest(lengths[2])),
                second: DelayLine::new(largest(lengths[3])),
                second_tap: FadingTap::new(sample_rate, 1),
                damp: 0.0,
                gains: (0.0, 0.0),
                inner: (0.0, 0.0),
                cut: 0.0,
                phase: 0.25 * h as f32,
                offset: Lin::default(),
            }
        });
        let mut input: [Allpass; 4] = core::array::from_fn(|i| {
            let length = INPUT.get(i).map_or(8.0, |entry| entry.0);
            Allpass::new(sample_rate, (length * ratio).ceil() as usize + 8)
        });
        for (pass, (length, _)) in input.iter_mut().zip(INPUT) {
            pass.snap((length * ratio).round() as usize);
        }
        let mut plate = Self {
            sample_rate,
            stereo,
            applied: -1.0,
            retunes: 0,
            input,
            halves,
            taps: [[FadingTap::new(sample_rate, 1); 7]; 2],
            corner: 1.0,
            depth: tick_smoother(sample_rate, 30.0, 0.0),
            modulated: false,
            drive: Glide::new(sample_rate, 15.0, 0.0),
            hold: tick_smoother(sample_rate, 25.0, 0.0),
            last: (-1.0, -1.0, -1.0, 0),
        };
        plate.retune(0.5, true);
        plate
    }

    fn idle(&self) -> bool {
        self.taps.iter().flatten().all(FadingTap::idle)
            && self.halves.iter().all(|half| {
                half.swirl.idle()
                    && half.settle.idle()
                    && half.first_tap.idle()
                    && half.second_tap.idle()
            })
    }

    /// Sets every tank length and output tap for `size`.
    fn retune(&mut self, size: f32, snap: bool) {
        let scale = if size < 0.5 {
            lerp(SCALES.0, SCALES.1, 2.0 * size)
        } else {
            lerp(SCALES.1, SCALES.2, 2.0 * size - 1.0)
        };
        let ratio = self.sample_rate / PAPER_RATE * scale;
        let samples = |length: f32| ((length * ratio).round() as usize).max(4);
        for (half, lengths) in self.halves.iter_mut().zip(HALVES) {
            half.swirl.drive(samples(lengths[0]), snap);
            half.settle.drive(samples(lengths[2]), snap);
            let first = samples(lengths[1]).min(half.first.capacity().saturating_sub(4));
            let second = samples(lengths[3]).min(half.second.capacity().saturating_sub(4));
            half.first_tap.drive(first.saturating_sub(1), snap);
            half.second_tap.drive(second.saturating_sub(1), snap);
        }
        for (taps, side) in self.taps.iter_mut().zip(OUTPUT) {
            for (tap, (_, _, position, _)) in taps.iter_mut().zip(side) {
                tap.drive(samples(position), snap);
            }
        }
        self.applied = size;
        self.retunes = self.retunes.wrapping_add(1);
    }
}

impl Engine for Plate {
    fn clear_step(&mut self, step: usize) -> bool {
        match step {
            0..=3 => {
                if let Some(pass) = self.input.get_mut(step) {
                    pass.clear();
                }
            }
            4..=11 => {
                if let Some(half) = self.halves.get_mut((step - 4) / 4) {
                    match (step - 4) % 4 {
                        0 => half.swirl.clear(),
                        1 => half.first.clear(),
                        2 => half.settle.clear(),
                        _ => half.second.clear(),
                    }
                }
            }
            _ => {
                for half in &mut self.halves {
                    half.damp = 0.0;
                }
                return true;
            }
        }
        false
    }

    fn tick(&mut self, settings: &Settings, active: bool, snap: bool) {
        let rate = self.sample_rate;
        if snap || ((settings.size - self.applied).abs() > 0.004 && self.idle()) {
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

        // The paper's excursion at Mod 50%, at about one cycle a second.
        let depth = 2.0 * EXCURSION * rate / PAPER_RATE * settings.modulation * (1.0 - hold);
        let depth = follow(&mut self.depth, depth, snap);
        let step = 4.0_f32.powf(settings.speed - 0.5) * TICK as f32 / rate;
        let mut modulated = false;
        for (half, multiple) in self.halves.iter_mut().zip([1.0, 0.83]) {
            half.phase += step * multiple;
            half.phase -= half.phase.floor();
            half.offset.drive(depth * (TAU * half.phase).sin(), snap);
            modulated |= !half.offset.rests_at(0.0);
        }
        self.modulated = modulated;

        let key = (decay, settings.tone, hold, self.retunes);
        if snap || key != self.last {
            self.last = key;
            let (coefficient, reach) = absorb_corner(rate, 1500.0 * 6.0_f32.powf(settings.tone));
            self.corner = coefficient;
            let faster = 1.0 / lerp(0.15, 1.0, settings.tone) - 1.0;
            for half in &mut self.halves {
                let seconds = |samples: usize| samples as f32 / rate;
                let lines = (
                    seconds(half.first_tap.target() + 1),
                    seconds(half.second_tap.target() + 1),
                );
                let passes = (seconds(half.swirl.delay()), seconds(half.settle.delay()));
                half.gains = (
                    loop_gain(lines.0, decay, hold),
                    loop_gain(lines.1, decay, hold),
                );
                half.inner = (
                    loop_gain(passes.0, decay, hold),
                    loop_gain(passes.1, decay, hold),
                );
                let whole = lines.0 + lines.1 + passes.0 + passes.1;
                half.cut = absorb_cut(loop_gain(whole * faster, decay, hold), reach);
            }
        }
    }

    #[inline]
    fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) -> f32 {
        let mut peak = 0.0_f32;
        let frames = in_l
            .iter()
            .zip(in_r)
            .zip(out_l.iter_mut().zip(out_r.iter_mut()));
        for ((&xl, &xr), (out_l, out_r)) in frames {
            let mut x = 0.5 * (xl + xr) * self.drive.next();
            peak = peak.max(x.abs());
            for (pass, (_, gain)) in self.input.iter_mut().zip(INPUT) {
                x = pass.process(x, gain);
            }

            // The end of each half feeds the start of the other.
            let mut ends = [0.0_f32; 2];
            for (end, half) in ends.iter_mut().zip(&mut self.halves) {
                *end = half.gains.1 * half.second_tap.read(&half.second);
                peak = peak.max(end.abs());
            }
            for (half, feed) in self.halves.iter_mut().zip([x + ends[1], x + ends[0]]) {
                let swirled = if self.modulated {
                    half.swirl
                        .process_frac(feed, SWIRL_GAIN, half.inner.0, half.offset.next())
                } else {
                    half.swirl.process_lossy(feed, SWIRL_GAIN, half.inner.0)
                };
                let delayed = half.first_tap.read(&half.first);
                half.first.write(swirled);
                peak = peak.max(delayed.abs());
                let damped = absorb(&mut half.damp, delayed, self.corner, half.gains.0, half.cut);
                let settled = half.settle.process_lossy(damped, SETTLE_GAIN, half.inner.1);
                half.second.write(settled);
            }

            // Output: seven taps a side from across the tank.
            let sides = self
                .taps
                .iter_mut()
                .zip(OUTPUT)
                .zip([&mut *out_l, &mut *out_r]);
            for (side, ((taps, table), out)) in sides.enumerate() {
                if side == 1 && !self.stereo {
                    break;
                }
                let mut sum = 0.0;
                for (tap, (half, element, _, sign)) in taps.iter_mut().zip(table) {
                    let line = self.halves.get(half).and_then(|half| half.element(element));
                    if let Some(line) = line {
                        sum += sign * tap.read(line);
                    }
                }
                *out += OUTPUT_GAIN * sum;
            }
        }
        peak
    }
}
