//! The loop half: a memory that records all the time, and three ways of
//! playing back what it caught.
//!
//! Every position is a distance back from the end of the loop, so a shorter
//! loop keeps the most recent audio. All times are counted in engine steps,
//! so they stretch as the Clock falls.
//! @see docs/native-moment.md

use crate::controls::LoopMode;
use crate::memory::{Memory, knee};
use core::f32::consts::{PI, TAU};
use oxidal_dsp::{EnvelopeFollower, db_to_gain};

/// Seconds of audio kept at the full rate.
pub const MEMORY_SECONDS: f32 = 4.0;
/// The longest crossfade across the join of a loop, in steps.
const SEAM: f64 = 256.0;
/// The shortest loop, in steps.
const MIN_LOOP: f64 = 64.0;
/// Steps the loop takes to fade in and out.
const FADE_STEPS: f32 = 256.0;
/// Steps a change of loop mode takes.
const MODE_STEPS: f32 = 1024.0;
/// A Tape loop at Length 0 is this many octaves shorter than the whole loop.
const LENGTH_OCTAVES: f32 = 5.0;
/// Stretch and Touch slices run from 20 ms to 25 times that.
const SLICE_SECONDS: f32 = 0.02;
const SLICE_RANGE: f32 = 25.0;
/// Slices per cycle of the slow stereo pan.
const PAN_SLICES: f32 = 8.0;

/// How long a loop is caught.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LengthRule {
    /// As much as the memory holds.
    Free,
    /// The largest whole number of these steps that fits.
    Multiple(f64),
    /// Exactly these steps, if the memory holds them.
    Fixed(f64),
}

/// The controls of the loop half for one block.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoopSettings {
    pub catch: bool,
    pub mode: LoopMode,
    pub length: f32,
    pub movement: f32,
    pub tape_speed: f32,
    pub overdub: bool,
    pub fade: f32,
    pub width: f32,
    pub rule: LengthRule,
}

impl Default for LoopSettings {
    fn default() -> Self {
        Self {
            catch: false,
            mode: LoopMode::Tape,
            length: 1.0,
            movement: 0.71,
            tape_speed: 1.0,
            overdub: false,
            fade: 1.0,
            width: 0.0,
            rule: LengthRule::Free,
        }
    }
}

/// Moves `value` towards `target` by at most `step`.
#[inline]
fn approach(value: f32, target: f32, step: f32) -> f32 {
    value + (target - value).clamp(-step, step)
}

/// The crossfade across the join of a loop of this length.
#[inline]
fn seam_of(length: f64) -> f64 {
    (length * 0.25).min(SEAM)
}

/// A distance into the range above 0 and up to `length`.
#[inline]
fn wrap(distance: f64, length: f64) -> f64 {
    if distance > 0.0 && distance <= length {
        return distance;
    }
    let wrapped = distance.rem_euclid(length);
    if wrapped > 0.0 { wrapped } else { length }
}

/// A Tape read position that was overtaken by a shrinking loop, fading out.
#[derive(Debug, Clone, Copy, Default)]
struct Jump {
    from: f64,
    gain: f32,
}

#[derive(Debug)]
pub struct Looper<const N: usize> {
    memory: [Memory; N],
    settings: LoopSettings,
    rate: f32,
    /// Steps of audio a loop may hold.
    capacity: f64,
    /// Where the newest sample was written, and how much has been written.
    write: i64,
    filled: f64,
    caught: bool,
    /// The newest sample of the caught loop.
    end: i64,
    /// The whole caught loop, in steps, and the length playing now.
    base: f64,
    length: f64,
    /// Worked out once a block: the share of the loop Length keeps in Tape,
    /// the slice size and the level that holds a slice in Touch.
    tape_share: f64,
    slice_steps: f64,
    threshold: f32,
    /// Fade of the loop as a whole, and of each way of playing it.
    gain: f32,
    tape_gain: f32,
    grain_gain: f32,
    mode: LoopMode,
    /// Tape read position, and the one that runs the other way for stereo.
    tape: f64,
    mirror: f64,
    jumps: [Jump; 2],
    /// Stretch and Touch: where the slices start, and the two running slices.
    head: f64,
    phase: f64,
    starts: [f64; 2],
    ages: [f64; 2],
    directions: [f64; 2],
    /// Touch: the input level, and whether it is holding the slice.
    level: EnvelopeFollower,
    touching: bool,
    pan_phase: f32,
    pan_depth: f32,
    /// Width as it glides, for the turned-round side of a Tape loop.
    width: f32,
    /// Overdub: the walking write position, and the last place written.
    dub: f64,
    dub_last: i64,
}

impl<const N: usize> Looper<N> {
    pub fn new(rate: f32) -> Self {
        let capacity = f64::from(MEMORY_SECONDS * rate).ceil();
        // Room for the loop, the audio before its join and the cubic reads.
        let length = capacity as usize + 2 * SEAM as usize + 512 + 16;
        let mut level = EnvelopeFollower::default();
        level.set_times(rate, 2.0, 80.0);
        Self {
            memory: core::array::from_fn(|_| Memory::new(length)),
            settings: LoopSettings::default(),
            rate,
            capacity,
            write: 0,
            filled: 0.0,
            caught: false,
            end: 0,
            base: MIN_LOOP,
            length: MIN_LOOP,
            tape_share: 1.0,
            slice_steps: 1024.0,
            threshold: 1.0,
            gain: 0.0,
            tape_gain: 1.0,
            grain_gain: 0.0,
            mode: LoopMode::Tape,
            tape: MIN_LOOP,
            mirror: MIN_LOOP,
            jumps: [Jump::default(); 2],
            head: MIN_LOOP,
            phase: 0.0,
            starts: [MIN_LOOP; 2],
            ages: [0.0; 2],
            directions: [1.0; 2],
            level,
            touching: false,
            pan_phase: 0.0,
            pan_depth: 0.0,
            width: 0.0,
            dub: MIN_LOOP,
            dub_last: 0,
        }
    }

    pub fn reset(&mut self) {
        for memory in &mut self.memory {
            memory.clear();
        }
        self.write = 0;
        self.filled = 0.0;
        self.caught = false;
        self.gain = 0.0;
        self.touching = false;
        self.pan_phase = 0.0;
        self.pan_depth = 0.0;
        self.level.reset();
    }

    pub fn set(&mut self, settings: LoopSettings) {
        self.settings = settings;
        let octaves = LENGTH_OCTAVES * (1.0 - settings.length);
        self.tape_share = f64::from(2.0_f32.powf(-octaves));
        let seconds = SLICE_SECONDS * SLICE_RANGE.powf(settings.length);
        self.slice_steps = f64::from(seconds * self.rate);
        self.threshold = db_to_gain(-6.0 - 54.0 * settings.movement);
    }

    /// Whether a loop is held at the moment.
    pub fn caught(&self) -> bool {
        self.caught
    }

    /// The length of the loop playing now, in steps.
    pub fn length(&self) -> f64 {
        self.length
    }

    /// The Stretch and Touch position, as a distance back from the loop's end.
    pub fn head(&self) -> f64 {
        self.head
    }

    /// The length the controls ask for.
    fn wanted(&self) -> f64 {
        let length = match self.settings.mode {
            LoopMode::Tape => self.base * self.tape_share,
            LoopMode::Stretch | LoopMode::Touch => self.base,
        };
        length.max(MIN_LOOP)
    }

    fn slice(&self) -> f64 {
        self.slice_steps.min(self.length * 0.5).max(16.0)
    }

    /// Holds the most recent audio as the loop.
    fn catch(&mut self) {
        let room = (self.filled - SEAM).min(self.capacity).max(MIN_LOOP);
        let base = match self.settings.rule {
            LengthRule::Free => room,
            LengthRule::Multiple(period) if period >= 1.0 => {
                let count = (room / period).floor().max(1.0);
                (count * period).min(room)
            }
            LengthRule::Multiple(_) => room,
            LengthRule::Fixed(steps) => steps.min(room),
        };
        self.end = self.write;
        self.base = base.max(MIN_LOOP);
        self.length = self.wanted();
        self.tape = self.length;
        self.mirror = self.length;
        self.jumps = [Jump::default(); 2];
        self.dub = self.length;
        self.dub_last = self.length as i64;
        self.mode = self.settings.mode;
        let tape = self.mode == LoopMode::Tape;
        self.tape_gain = if tape { 1.0 } else { 0.0 };
        self.grain_gain = if tape { 0.0 } else { 1.0 };
        self.restart_slices(self.length);
        self.caught = true;
    }

    /// Starts the two slices so that both read `at` now.
    fn restart_slices(&mut self, at: f64) {
        let half = self.slice() * 0.5;
        self.head = at;
        self.phase = 0.0;
        self.starts = [at, at + half];
        self.ages = [0.0, half];
        self.directions = [1.0; 2];
    }

    /// Reads `distance` back from the end; near the end of the loop the audio
    /// from before its start is blended in, so the join does not click.
    #[inline]
    fn read(&self, channel: usize, distance: f64) -> f32 {
        let length = self.length;
        let d = wrap(distance, length);
        let end = self.end as f64;
        let near = self.memory[channel].read(end - d);
        let seam = seam_of(length);
        if d < seam {
            let far = self.memory[channel].read(end - d - length);
            near + (far - near) * (1.0 - d / seam) as f32
        } else {
            near
        }
    }

    /// Plays one engine step. `x` is the clean input.
    pub fn play(&mut self, x: [f32; N]) -> [f32; N] {
        if self.caught && !self.settings.catch {
            self.caught = false;
        }
        // A new catch waits for the old loop to finish fading.
        if !self.caught && self.settings.catch && self.gain <= 0.0 {
            self.catch();
        }
        let target = if self.caught { 1.0 } else { 0.0 };
        self.gain = approach(self.gain, target, 1.0 / FADE_STEPS);
        if !self.caught && self.gain <= 0.0 {
            return [0.0; N];
        }

        self.change_mode();
        self.apply_length();

        let mut sum = 0.0;
        for sample in x {
            sum += sample;
        }
        let level = self.level.process(sum / N as f32);
        if level > self.threshold {
            self.touching = true;
        } else if level < self.threshold * 0.5 {
            self.touching = false;
        }

        let mut out = [0.0; N];
        if self.tape_gain > 0.0 {
            self.play_tape(&mut out);
        }
        if self.grain_gain > 0.0 {
            self.play_slices(&mut out);
        }
        if self.caught && self.settings.overdub {
            self.overdub(x);
        }
        out.map(|y| y * self.gain)
    }

    fn change_mode(&mut self) {
        if self.mode != self.settings.mode {
            let was_tape = self.mode == LoopMode::Tape;
            let is_tape = self.settings.mode == LoopMode::Tape;
            if was_tape && !is_tape {
                self.restart_slices(self.tape);
            } else if is_tape && !was_tape {
                self.tape = self.head;
                self.mirror = self.head;
            }
            self.mode = self.settings.mode;
        }
        let tape = self.mode == LoopMode::Tape;
        let step = 1.0 / MODE_STEPS;
        self.tape_gain = approach(self.tape_gain, if tape { 1.0 } else { 0.0 }, step);
        self.grain_gain = approach(self.grain_gain, if tape { 0.0 } else { 1.0 }, step);
    }

    /// Moves a Tape read position and lets an overtaken old one fade.
    fn move_tape(&mut self, which: usize, position: f64, by: f64) -> f64 {
        let jump = &mut self.jumps[which];
        jump.from -= by;
        jump.gain = (jump.gain - 1.0 / FADE_STEPS).max(0.0);
        wrap(position - by, self.length)
    }

    /// Takes up a new loop length at a moment when it cannot be heard: outside
    /// the join, with no earlier change still fading. A read position the
    /// shorter loop leaves behind plays on and fades out under the new one.
    fn apply_length(&mut self) {
        let wanted = self.wanted();
        if wanted == self.length || self.jumps.iter().any(|jump| jump.gain > 0.0) {
            return;
        }
        // Slices still being heard would jump with a shorter loop.
        if self.grain_gain > 0.0 && wanted < self.length {
            return;
        }
        if self.tape_gain > 0.0 {
            let seam = seam_of(self.length).max(seam_of(wanted));
            if self.tape < seam || self.mirror < seam {
                return;
            }
        }
        for (position, jump) in [&mut self.tape, &mut self.mirror]
            .into_iter()
            .zip(self.jumps.iter_mut())
        {
            if *position > wanted {
                *jump = Jump {
                    from: *position,
                    gain: 1.0,
                };
                *position = wrap(*position, wanted);
            }
        }
        self.length = wanted;
    }

    /// Reads a Tape position, under the fading old one if it has just jumped.
    #[inline]
    fn read_tape(&self, channel: usize, position: f64, which: usize) -> f32 {
        let sample = self.read(channel, position);
        let jump = self.jumps[which];
        if jump.gain > 0.0 {
            let old = self.memory[channel].read(self.end as f64 - jump.from);
            sample + (old - sample) * jump.gain
        } else {
            sample
        }
    }

    fn play_tape(&mut self, out: &mut [f32; N]) {
        let speed = f64::from(self.settings.tape_speed);
        self.tape = self.move_tape(0, self.tape, speed);
        self.mirror = self.move_tape(1, self.mirror, -speed);
        self.width = approach(self.width, self.settings.width, 1.0 / FADE_STEPS);
        let width = self.width;
        for (channel, y) in out.iter_mut().enumerate() {
            let mut sample = self.read_tape(channel, self.tape, 0);
            // In stereo the left side turns round as Width rises.
            if N == 2 && channel == 0 && width > 0.0 {
                let mirrored = self.read_tape(channel, self.mirror, 1);
                sample += (mirrored - sample) * width;
            }
            *y += sample * self.tape_gain;
        }
    }

    fn play_slices(&mut self, out: &mut [f32; N]) {
        let velocity = match self.mode {
            LoopMode::Stretch => {
                let m = f64::from(2.0 * self.settings.movement - 1.0);
                m * m.abs()
            }
            LoopMode::Touch if self.touching => 0.0,
            LoopMode::Touch | LoopMode::Tape => 1.0,
        };
        let slice = self.slice();
        self.head = wrap(self.head - velocity, self.length);
        let before = self.phase;
        self.phase += 1.0 / slice;
        self.ages = [self.ages[0] + 1.0, self.ages[1] + 1.0];
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.begin_slice(0, velocity);
        } else if before < 0.5 && self.phase >= 0.5 {
            self.begin_slice(1, velocity);
        }

        let swing = (PI * self.phase as f32).sin();
        let first = swing * swing;
        let positions = [
            self.starts[0] - self.directions[0] * self.ages[0],
            self.starts[1] - self.directions[1] * self.ages[1],
        ];

        // Stereo: a slow pan; Touch pans only while a slice is held.
        let depth = match self.mode {
            LoopMode::Touch if !self.touching => 0.0,
            _ => self.settings.width,
        };
        self.pan_depth = approach(self.pan_depth, depth, 1.0 / FADE_STEPS);
        self.pan_phase += 1.0 / (PAN_SLICES * slice as f32);
        self.pan_phase -= self.pan_phase.floor();
        let pan = (TAU * self.pan_phase).sin() * self.pan_depth;

        for (channel, y) in out.iter_mut().enumerate() {
            let a = self.read(channel, positions[0]);
            let b = self.read(channel, positions[1]);
            let side = match (N, channel) {
                (2, 0) => 1.0 - pan.max(0.0),
                (2, _) => 1.0 + pan.min(0.0),
                _ => 1.0,
            };
            *y += (a * first + b * (1.0 - first)) * side * self.grain_gain;
        }
    }

    fn begin_slice(&mut self, index: usize, velocity: f64) {
        self.starts[index] = self.head;
        self.ages[index] = 0.0;
        self.directions[index] = if velocity < 0.0 { -1.0 } else { 1.0 };
    }

    /// Adds the clean input to the loop where it is being heard.
    fn overdub(&mut self, x: [f32; N]) {
        let distance = if self.mode == LoopMode::Tape {
            self.tape
        } else {
            self.dub = wrap(self.dub - 1.0, self.length);
            self.dub
        };
        let to = (distance.round() as i64).max(1);
        let moved = to - self.dub_last;
        match moved {
            0 => {}
            // A fast tape passes several samples in one step.
            -8..=8 => {
                let way = moved.signum();
                for k in 1..=moved.abs() {
                    self.dub_at(self.dub_last + way * k, x);
                }
            }
            _ => self.dub_at(to, x),
        }
        self.dub_last = to;
    }

    fn dub_at(&mut self, distance: i64, x: [f32; N]) {
        let index = self.end - distance;
        let length = self.length.round() as i64;
        let seam = seam_of(self.length) as i64;
        let fade = self.settings.fade;
        for (memory, sample) in self.memory.iter_mut().zip(x) {
            memory.put(index, knee(memory.get(index) * fade + sample));
            // The audio before the join is heard in the crossfade too.
            if distance < seam {
                let far = index - length;
                memory.put(far, knee(memory.get(far) * fade + sample));
            }
        }
    }

    /// Records one step, unless a loop is held.
    pub fn record(&mut self, x: [f32; N]) {
        if self.caught {
            return;
        }
        let Some(first) = self.memory.first() else {
            return;
        };
        let mask = first.len() as i64 - 1;
        self.write = (self.write + 1) & mask;
        for (memory, sample) in self.memory.iter_mut().zip(x) {
            memory.put(self.write, knee(sample));
        }
        self.filled = (self.filled + 1.0).min((mask + 1) as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_distance_wraps_into_the_loop() {
        assert_eq!(wrap(5.0, 10.0), 5.0);
        assert_eq!(wrap(10.0, 10.0), 10.0);
        assert_eq!(wrap(0.0, 10.0), 10.0);
        assert_eq!(wrap(-1.0, 10.0), 9.0);
        assert_eq!(wrap(12.0, 10.0), 2.0);
    }

    #[test]
    fn nothing_plays_until_a_loop_is_caught() {
        let mut looper = Looper::<1>::new(48_000.0);
        for _ in 0..1000 {
            assert_eq!(looper.play([0.5]), [0.0]);
            looper.record([0.5]);
        }
        assert!(!looper.caught());
    }
}
