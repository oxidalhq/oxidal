//! The Nonlinear mode: a burst of echoes whose levels follow a drawn shape
//! instead of a natural decay. One long delay line is read at many
//! irregularly spaced taps; the shape (gate, reverse, swell) sets each tap's
//! gain from its position, and short all-passes blur the taps into a wash.
//! @see docs/native-bloom.md

use crate::parts::{
    Allpass, Engine, FadingTap, Glide, Lin, Settings, follow, opaque_debug, tick_smoother,
};
use oxidal_dsp::{DelayLine, Noise, OnePole, Smoothed, prime_at_or_above};

/// Taps per output.
const TAPS: usize = 32;
/// The shape lasts Decay seconds, within these limits.
pub const SHORTEST_SECONDS: f32 = 0.1;
pub const LONGEST_SECONDS: f32 = 1.2;
/// All-passes before the taps, in seconds, and one after them on each side.
const BLUR_SECONDS: [f32; 3] = [0.0047, 0.0071, 0.0113];
const SPREAD_SECONDS: [f32; 2] = [0.0037, 0.0043];
/// Input trim, measured so a sustained note comes out near its own level.
const LEVEL: f32 = 0.9;

/// Gain of a tap at `position` (0 start of the shape, 1 its end).
fn shape(kind: usize, position: f32) -> f32 {
    let t = position.clamp(0.0, 1.0);
    match kind {
        // Reverse: rises to the end, then stops dead.
        1 => 0.02 + 0.98 * t * t,
        // Swell: rises and falls, a raised cosine.
        2 => {
            let s = (core::f32::consts::PI * t).sin();
            s * s
        }
        // Gate: full level until it stops dead.
        _ => 1.0,
    }
}

/// The shaped multi-tap engine.
pub struct Nonlinear {
    sample_rate: f32,
    stereo: bool,
    line: DelayLine,
    /// Where each tap falls inside its slot of the shape, 0.1 to 0.9, and its sign.
    places: [[(f32, f32); TAPS]; 2],
    taps: [[FadingTap; TAPS]; 2],
    gains: [[Lin; TAPS]; 2],
    /// The tap one whole shape back, which Freeze feeds round.
    repeat: FadingTap,
    recirculate: Glide,
    blur: [Allpass; 3],
    blur_amount: Glide,
    spread: [Allpass; 2],
    tone: [OnePole; 2],
    tone_applied: f32,
    drive: Glide,
    hold: Smoothed,
    applied: f32,
}
opaque_debug!(Nonlinear);

impl Nonlinear {
    /// Allocates everything for `sample_rate`. Not for the audio thread.
    pub fn new(sample_rate: f32, stereo: bool) -> Self {
        let samples = |seconds: f32| (seconds * sample_rate).ceil() as usize;
        // The irregular spacing is drawn once from Oxidal's own noise source.
        let mut noise = Noise::new(0x0b10_0513);
        let places = core::array::from_fn(|_| {
            core::array::from_fn(|_| {
                let place = 0.5 + 0.4 * noise.next();
                let sign = if noise.next() < 0.0 { -1.0 } else { 1.0 };
                (place, sign)
            })
        });
        let pass = |seconds: f32| {
            let length = prime_at_or_above(samples(seconds));
            let mut pass = Allpass::new(sample_rate, length + 8);
            pass.snap(length);
            pass
        };
        let mut nonlinear = Self {
            sample_rate,
            stereo,
            line: DelayLine::new(samples(LONGEST_SECONDS) + 64),
            places,
            taps: [[FadingTap::new(sample_rate, 1); TAPS]; 2],
            gains: [[Lin::default(); TAPS]; 2],
            repeat: FadingTap::new(sample_rate, 1),
            recirculate: Glide::new(sample_rate, 25.0, 0.0),
            blur: BLUR_SECONDS.map(&pass),
            blur_amount: Glide::new(sample_rate, 15.0, 0.0),
            spread: SPREAD_SECONDS.map(&pass),
            tone: [OnePole::default(); 2],
            tone_applied: -1.0,
            drive: Glide::new(sample_rate, 15.0, 0.0),
            hold: tick_smoother(sample_rate, 25.0, 0.0),
            applied: -1.0,
        };
        nonlinear.retune(0.5, true);
        nonlinear
    }

    fn idle(&self) -> bool {
        self.repeat.idle() && self.taps.iter().flatten().all(FadingTap::idle)
    }

    /// Places the taps for a shape of `seconds`.
    fn retune(&mut self, seconds: f32, snap: bool) {
        let limit = self.line.capacity().saturating_sub(8).max(2);
        let length = ((seconds * self.sample_rate) as usize).clamp(2, limit);
        self.repeat.drive(length - 1, snap);
        for (taps, places) in self.taps.iter_mut().zip(&self.places) {
            for (slot, (tap, (place, _))) in taps.iter_mut().zip(places).enumerate() {
                let position = (slot as f32 + place) / TAPS as f32;
                tap.drive(((position * length as f32) as usize).min(length - 1), snap);
            }
        }
        self.applied = seconds;
    }
}

impl Engine for Nonlinear {
    fn clear_step(&mut self, step: usize) -> bool {
        match step {
            0 => self.line.clear(),
            1..=3 => {
                if let Some(pass) = self.blur.get_mut(step - 1) {
                    pass.clear();
                }
            }
            _ => {
                for pass in &mut self.spread {
                    pass.clear();
                }
                for filter in &mut self.tone {
                    filter.reset(0.0);
                }
                return true;
            }
        }
        false
    }

    fn tick(&mut self, settings: &Settings, active: bool, snap: bool) {
        let seconds = settings.decay.clamp(SHORTEST_SECONDS, LONGEST_SECONDS);
        if snap || ((seconds - self.applied).abs() > 0.001 && self.idle()) {
            self.retune(seconds, snap);
        }
        let hold = follow(
            &mut self.hold,
            if active { settings.freeze } else { 0.0 },
            snap,
        );
        self.recirculate.drive(hold, snap);
        self.drive.drive(LEVEL, snap);
        self.blur_amount.drive(0.7 * settings.size, snap);
        if snap || (settings.tone - self.tone_applied).abs() > 1.0e-4 {
            self.tone_applied = settings.tone;
            let hertz = 1500.0 * 12.0_f32.powf(settings.tone);
            for filter in &mut self.tone {
                filter.set_cutoff(self.sample_rate, hertz);
            }
        }

        // Tap gains follow the shape; each side is scaled to unit energy.
        for (gains, places) in self.gains.iter_mut().zip(&self.places) {
            let level = |slot: usize, place: f32| {
                shape(settings.shape, (slot as f32 + place) / TAPS as f32)
            };
            let mut energy = 0.0;
            for (slot, (place, _)) in places.iter().enumerate() {
                energy += level(slot, *place).powi(2);
            }
            let scale = 1.0 / energy.max(1.0e-6).sqrt();
            for (slot, (gain, (place, sign))) in gains.iter_mut().zip(places).enumerate() {
                let target = sign * scale * level(slot, *place);
                let next = gain.target() + 0.12 * (target - gain.target());
                gain.drive(if snap { target } else { next }, snap);
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
            let amount = self.blur_amount.next();
            for pass in &mut self.blur {
                x = pass.process(x, amount);
            }
            // Freeze feeds the line its own output one shape later, so the
            // last shape repeats; the copy has a gain of exactly one.
            let again = self.recirculate.next() * self.repeat.read(&self.line);
            peak = peak.max(x.abs()).max(again.abs());
            self.line.write(x + again);

            let sides = self.taps.iter_mut().zip(self.gains.iter_mut());
            let ends = self.spread.iter_mut().zip(self.tone.iter_mut());
            let outs = [&mut *out_l, &mut *out_r];
            for (side, (((taps, gains), (pass, tone)), out)) in
                sides.zip(ends).zip(outs).enumerate()
            {
                if side == 1 && !self.stereo {
                    break;
                }
                let mut sum = 0.0;
                for (tap, gain) in taps.iter_mut().zip(gains.iter_mut()) {
                    sum += gain.next() * tap.read(&self.line);
                }
                *out += tone.lowpass(pass.process(sum, 0.6 * amount));
            }
        }
        peak
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shapes_are_what_they_say() {
        assert_eq!(shape(0, 0.1), 1.0);
        assert_eq!(shape(0, 0.99), 1.0);
        assert!(shape(1, 0.1) < 0.1 && shape(1, 1.0) > 0.99);
        assert!(shape(2, 0.02) < 0.05 && shape(2, 0.5) > 0.99 && shape(2, 0.98) < 0.05);
    }
}
