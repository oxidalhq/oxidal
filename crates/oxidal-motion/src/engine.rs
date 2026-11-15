//! The modulation engine: the oscillators every mode shares, control
//! smoothing, the dry and effect blend, and the crossfade between two effect
//! slots when Mode or Shape changes.
//!
//! Slow values (oscillators, filter corners, gains) are worked out once per
//! control interval of 16 samples (32 above 50 kHz) and reached by a straight
//! ramp, sample by sample. The intervals are counted in samples from the
//! start, not from the host's block edges, so the output does not depend on
//! the block size.
//! @see docs/native-motion.md

use core::f32::consts::{PI, TAU};

use oxidal_dsp::{Smoothed, equal_power};

use crate::blocks::Ramp;
use crate::controls::{Mode, Settings};
use crate::voice::{ENSEMBLE_HZ, Frame, Program, Timing, Voice};

/// The longest control interval, in samples.
const INTERVAL_MAX: usize = 32;
/// Time constant of every continuous control.
const SMOOTHING_MS: f32 = 30.0;
/// Time constant of the oscillator rate, smoothed as a logarithm so a glide
/// passes evenly through the octaves.
const RATE_SMOOTHING_MS: f32 = 60.0;
/// A change of Mode or Shape fades the old effect out and the new one in over
/// this long.
pub const FADE_SECONDS: f32 = 0.04;
/// The input of a newly started effect fades in over this long.
const ONSET_SECONDS: f32 = 0.005;
/// A stopped rotor rests here, in turns: halfway between two microphones a
/// quarter turn apart.
const ROTOR_REST: f64 = 0.125;
/// The vibrato's drift oscillator turns at this fraction of the rate: two
/// minus the golden ratio, so the two never fall into a repeating pattern.
const WANDER_RATIO: f64 = 0.381_966;
/// With Fast on, the rotors aim at this many times their slow speed: three
/// octaves, which keeps a tempo-synced speed on the beat.
const ROTOR_FAST_RATIO: f32 = 8.0;
/// No rotor turns faster than this, in turns a second.
pub const ROTOR_LIMIT_HZ: f32 = 16.0;
/// The drum is heavier and turns a little slower than the horn.
pub const DRUM_RATIO: f32 = 0.86;
/// Seconds for the light horn to gain and to lose speed (time constants).
const HORN_SECONDS: (f32, f32) = (0.7, 1.1);
/// The same for the heavy drum.
const DRUM_SECONDS: (f32, f32) = (3.5, 4.5);
/// With Mix at zero, effect output below this level (-180 dB) for
/// [`QUIET_SECONDS`] counts as an ended tail: the engine then rests and copies
/// its input.
const QUIET: f32 = 1.0e-9;
const QUIET_SECONDS: f32 = 0.25;
/// What goes into an effect is held to 40 dB over full scale, so that no
/// input, however absurd, can overflow a filter. The dry path is not touched.
const INPUT_LIMIT: f32 = 100.0;
/// The Ring carrier spans 20 Hz to 2 kHz over the Rate control.
const RING_LOW_HZ: f32 = 20.0;
const RING_LOG_SPAN: f32 = 4.605_17;

/// Dry gain and send into the effect for a Mix of 0 to 1. A blended effect
/// crosses over the whole range at equal power; a whole-signal effect is
/// fully on from the middle up.
fn mix_gains(whole: bool, mix: f32) -> (f32, f32) {
    equal_power(if whole { 2.0 * mix } else { mix })
}

fn wrap(turns: f64) -> f64 {
    turns - turns.floor()
}

/// One effect with its memories and its place in the blend.
#[derive(Debug, Clone)]
struct Slot {
    program: Program,
    voices: Vec<Voice>,
    send: Ramp,
    dry: Ramp,
    level: Ramp,
    active: bool,
    fresh: bool,
    /// How far the input of a newly started effect has opened, 0 to 1.
    onset: f32,
}

impl Slot {
    fn new(sample_rate: f32, channels: usize) -> Self {
        Self {
            program: Program {
                mode: Mode::Chorus,
                shape: 0,
            },
            voices: (0..channels).map(|_| Voice::new(sample_rate)).collect(),
            send: Ramp::default(),
            dry: Ramp::default(),
            level: Ramp::default(),
            active: false,
            fresh: false,
            onset: 0.0,
        }
    }

    /// Starts `program` from empty memories at `level` of the blend.
    fn start(&mut self, program: Program, level: f32) {
        self.program = program;
        for voice in &mut self.voices {
            voice.clear();
        }
        self.level.snap(level);
        self.active = true;
        self.fresh = true;
    }

    /// Sets this interval's targets. `before` and `after` are the oscillator
    /// frames and Mix values at its start and end.
    fn aim(&mut self, before: (&Frame, f32), after: (&Frame, f32), level: f32, timing: &Timing) {
        let whole = self.program.whole();
        if self.fresh {
            let (dry, _) = mix_gains(whole, before.1);
            self.dry.snap(dry);
            self.send.snap(0.0);
            self.onset = 0.0;
            for (channel, voice) in self.voices.iter_mut().enumerate() {
                voice.aim(self.program, before.0, channel, timing, true);
            }
            self.fresh = false;
        }
        let (dry, send) = mix_gains(whole, after.1);
        self.dry.aim(dry, timing.inverse_interval);
        // The input of a new effect opens over a few milliseconds: its empty
        // memories never take in a step.
        self.onset = (self.onset + timing.interval_seconds / ONSET_SECONDS).min(1.0);
        let opening = if self.onset < 1.0 {
            0.5 - 0.5 * (PI * self.onset).cos()
        } else {
            1.0
        };
        self.send.aim(send * opening, timing.inverse_interval);
        self.level.aim(level, timing.inverse_interval);
        for (channel, voice) in self.voices.iter_mut().enumerate() {
            voice.aim(self.program, after.0, channel, timing, false);
        }
    }

    /// Adds this slot's share of the output to `mixed` and returns the peak
    /// of the effect alone.
    fn render(
        &mut self,
        dry: &[[f32; INTERVAL_MAX]; 2],
        carrier: &CarrierBlock,
        mixed: &mut [[f32; INTERVAL_MAX]; 2],
        frames: usize,
    ) -> f32 {
        let frames = frames.min(INTERVAL_MAX);
        let mut send = [0.0_f32; INTERVAL_MAX];
        let mut direct = [0.0_f32; INTERVAL_MAX];
        let mut level = [0.0_f32; INTERVAL_MAX];
        for ((send, direct), level) in send
            .iter_mut()
            .zip(&mut direct)
            .zip(&mut level)
            .take(frames)
        {
            *send = self.send.next();
            *direct = self.dry.next();
            *level = self.level.next();
        }
        // One cabinet stands in the room: both microphones hear the same sum.
        let summed = self.program.mode == Mode::Rotary && self.voices.len() == 2;
        let mut peak = 0.0_f32;
        let [left, right, half] = carrier;
        let doubled = self.program.mode == Mode::Ring && self.program.shape == 2;
        let carriers = [left, if doubled { half } else { right }];
        let sides = dry.iter().zip(carriers).zip(mixed.iter_mut());
        for (voice, ((own, carrier), mixed)) in self.voices.iter_mut().zip(sides) {
            let mut feed = [0.0_f32; INTERVAL_MAX];
            for (index, (feed, send)) in feed.iter_mut().zip(&send).enumerate().take(frames) {
                let source = if summed {
                    0.5 * (dry[0][index] + dry[1][index])
                } else {
                    own[index]
                };
                *feed = source.clamp(-INPUT_LIMIT, INPUT_LIMIT) * send;
            }
            let mut wet = [0.0_f32; INTERVAL_MAX];
            voice.run(
                self.program,
                &feed[..frames],
                &carrier[..frames],
                &mut wet[..frames],
            );
            let gains = direct.iter().zip(&level);
            for (((mixed, wet), own), (direct, level)) in
                mixed.iter_mut().zip(&wet).zip(own).zip(gains).take(frames)
            {
                peak = peak.max(wet.abs());
                *mixed += level * (direct * own + wet);
            }
        }
        peak
    }
}

/// The audio-rate oscillator of the Ring mode: a point turned round the unit
/// circle by a fixed angle every sample.
#[derive(Debug, Clone, Copy)]
struct Carrier {
    cosine: f32,
    sine: f32,
    step_cosine: f32,
    step_sine: f32,
    /// The right side's lead over the left, as the cosine and sine of the
    /// angle, then the same for half the angle.
    leads: [Ramp; 4],
}

/// The carrier for the left side, for the right side, and for the right side
/// at half the lead. Shape C doubles the carrier, so half the lead gives it
/// the same spread between the sides.
type CarrierBlock = [[f32; INTERVAL_MAX]; 3];

impl Carrier {
    fn new() -> Self {
        Self {
            cosine: 1.0,
            sine: 0.0,
            step_cosine: 1.0,
            step_sine: 0.0,
            leads: [Ramp::default(); 4],
        }
    }

    /// Sets the frequency for the next interval and pulls the point back onto
    /// the circle, which rounding slowly moves it off.
    fn aim(&mut self, turns_per_sample: f32, lead_turns: f32, inverse_interval: f32, snap: bool) {
        (self.step_sine, self.step_cosine) = (TAU * turns_per_sample).sin_cos();
        let correction = 1.5 - 0.5 * (self.cosine * self.cosine + self.sine * self.sine);
        self.cosine *= correction;
        self.sine *= correction;
        let (full_sine, full_cosine) = (TAU * lead_turns).sin_cos();
        let (half_sine, half_cosine) = (0.5 * TAU * lead_turns).sin_cos();
        let targets = [full_cosine, full_sine, half_cosine, half_sine];
        for (ramp, target) in self.leads.iter_mut().zip(targets) {
            if snap {
                ramp.snap(target);
            } else {
                ramp.aim(target, inverse_interval);
            }
        }
    }

    fn render(&mut self, out: &mut CarrierBlock, frames: usize) {
        let [left, right, half] = out;
        let [full_cosine, full_sine, half_cosine, half_sine] = &mut self.leads;
        let sides = left.iter_mut().zip(right.iter_mut()).zip(half.iter_mut());
        for ((left, right), half) in sides.take(frames) {
            let cosine = self.cosine * self.step_cosine - self.sine * self.step_sine;
            let sine = self.sine * self.step_cosine + self.cosine * self.step_sine;
            self.cosine = cosine;
            self.sine = sine;
            *left = sine;
            *right = sine * full_cosine.next() + cosine * full_sine.next();
            *half = sine * half_cosine.next() + cosine * half_sine.next();
        }
    }
}

/// Oxidal Motion for one or two channels.
#[derive(Debug, Clone)]
pub struct Engine {
    channels: usize,
    timing: Timing,
    interval: usize,
    left_in_interval: usize,
    settled: bool,
    log_rate: Smoothed,
    depth: Smoothed,
    feedback: Smoothed,
    tone: Smoothed,
    stereo: Smoothed,
    mix: Smoothed,
    ring: Smoothed,
    phase: f64,
    wander: f64,
    ensemble: f64,
    horn_angle: f64,
    drum_angle: f64,
    horn_speed: f32,
    drum_speed: f32,
    carrier: Carrier,
    slots: [Slot; 2],
    current: usize,
    fading: bool,
    fade: f32,
    before: Frame,
    now: Frame,
    resting: bool,
    quiet_frames: usize,
}

impl Engine {
    /// Builds the engine and allocates all it will ever need. `channels` is
    /// 1 or 2.
    pub fn new(sample_rate: f32, channels: usize) -> Self {
        let sample_rate = if sample_rate.is_finite() {
            sample_rate.clamp(8_000.0, 384_000.0)
        } else {
            48_000.0
        };
        let channels = channels.clamp(1, 2);
        let interval = if sample_rate > 50_000.0 { 32 } else { 16 };
        let control_rate = sample_rate / interval as f32;
        let smoothed = |value: f32| Smoothed::new(control_rate, SMOOTHING_MS, value);
        Self {
            channels,
            timing: Timing {
                sample_rate,
                inverse_interval: 1.0 / interval as f32,
                interval_seconds: interval as f32 / sample_rate,
            },
            interval,
            left_in_interval: 0,
            settled: false,
            log_rate: Smoothed::new(control_rate, RATE_SMOOTHING_MS, 0.0),
            depth: smoothed(0.0),
            feedback: smoothed(0.0),
            tone: smoothed(0.0),
            stereo: smoothed(0.0),
            mix: smoothed(0.0),
            ring: smoothed(0.0),
            phase: 0.0,
            wander: 0.0,
            ensemble: 0.0,
            horn_angle: 0.0,
            drum_angle: 0.0,
            horn_speed: 0.0,
            drum_speed: 0.0,
            carrier: Carrier::new(),
            slots: [
                Slot::new(sample_rate, channels),
                Slot::new(sample_rate, channels),
            ],
            current: 0,
            fading: false,
            fade: 0.0,
            before: Frame::default(),
            now: Frame::default(),
            resting: false,
            quiet_frames: 0,
        }
    }

    /// Forgets everything heard so far; the next block starts from silence
    /// with the oscillators at zero.
    pub fn reset(&mut self) {
        self.settled = false;
    }

    /// Turns of the horn and the drum per second, as they are now.
    pub fn rotor_speeds(&self) -> (f32, f32) {
        (self.horn_speed, self.drum_speed)
    }

    /// Processes one block. `inputs` and `outputs` hold one slice per
    /// channel; the shortest sets the block length.
    pub fn process(&mut self, settings: &Settings, inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        let frames = inputs
            .iter()
            .take(self.channels)
            .map(|input| input.len())
            .chain(
                outputs
                    .iter()
                    .take(self.channels)
                    .map(|output| output.len()),
            )
            .min()
            .unwrap_or(0);
        self.log_rate
            .set(settings.oscillator_hertz().clamp(0.01, 40.0).ln());
        self.depth.set(settings.depth);
        self.feedback.set(settings.feedback);
        self.tone.set(settings.tone);
        self.stereo.set(if self.channels == 2 {
            settings.stereo
        } else {
            0.0
        });
        self.mix.set(settings.mix);
        self.ring
            .set((settings.rate / 0.05).max(1.0).ln() / (12.0_f32 / 0.05).ln());
        if !self.settled {
            self.settle(settings);
        }
        let mut done = 0;
        while done < frames {
            if self.left_in_interval == 0 {
                self.control(settings);
                self.left_in_interval = self.interval;
            }
            let count = (frames - done).min(self.left_in_interval);
            self.render(inputs, outputs, done, count);
            done += count;
            self.left_in_interval -= count;
        }
    }

    /// The first block after a reset: every control starts where it is set.
    fn settle(&mut self, settings: &Settings) {
        for smoothed in [
            &mut self.log_rate,
            &mut self.depth,
            &mut self.feedback,
            &mut self.tone,
            &mut self.stereo,
            &mut self.mix,
            &mut self.ring,
        ] {
            let target = smoothed.target();
            smoothed.snap(target);
        }
        self.phase = 0.0;
        self.wander = 0.0;
        self.ensemble = 0.0;
        self.horn_angle = ROTOR_REST;
        self.drum_angle = ROTOR_REST;
        (self.horn_speed, self.drum_speed) =
            self.rotor_targets(settings, self.log_rate.current().exp());
        self.carrier = Carrier::new();
        self.carrier.aim(
            0.0,
            self.stereo.current(),
            self.timing.inverse_interval,
            true,
        );
        let program = Program {
            mode: settings.mode,
            shape: settings.shape,
        };
        let [first, second] = &mut self.slots;
        first.start(program, 1.0);
        second.active = false;
        self.current = 0;
        self.fading = false;
        self.fade = 0.0;
        self.now = self.frame();
        self.before = self.now;
        self.resting = false;
        self.quiet_frames = 0;
        self.left_in_interval = 0;
        self.settled = true;
    }

    /// The speeds the horn and the drum are heading for.
    fn rotor_targets(&self, settings: &Settings, rate: f32) -> (f32, f32) {
        let shape = if settings.mode == Mode::Rotary {
            settings.shape
        } else {
            0
        };
        let slow = rate.min(ROTOR_LIMIT_HZ);
        let horn = if settings.fast {
            (slow * ROTOR_FAST_RATIO).min(ROTOR_LIMIT_HZ)
        } else if shape == 2 {
            0.0
        } else {
            slow
        };
        let drum = if shape == 1 { 0.0 } else { horn * DRUM_RATIO };
        (horn, drum)
    }

    /// The oscillators and smoothed controls as they are now.
    fn frame(&self) -> Frame {
        let lead = f64::from(self.stereo.current());
        let sides = |turns: f64, lead: f64| [wrap(turns) as f32, wrap(turns + lead) as f32];
        Frame {
            phase: sides(self.phase, lead),
            wander: sides(self.wander, lead),
            ensemble: sides(self.ensemble, lead),
            horn: sides(self.horn_angle, -lead),
            drum: sides(self.drum_angle, -lead),
            rate: self.log_rate.current().exp(),
            depth: self.depth.current(),
            feedback: self.feedback.current(),
            tone: self.tone.current(),
        }
    }

    /// One control interval: moves the controls and oscillators on, handles a
    /// change of effect and sets every ramp's target.
    fn control(&mut self, settings: &Settings) {
        let seconds = self.timing.interval_seconds;
        let current = self.current & 1;
        if self.fading && self.fade >= 1.0 {
            self.fading = false;
            self.slots[current ^ 1].active = false;
        }
        let mix_before = self.mix.current();
        let rate = self.log_rate.next().exp();
        self.depth.next();
        self.feedback.next();
        self.tone.next();
        self.stereo.next();
        let mix = self.mix.next();
        let ring = self.ring.next();

        let turned = f64::from(rate * seconds);
        self.phase = wrap(self.phase + turned);
        self.wander = wrap(self.wander + turned * WANDER_RATIO);
        self.ensemble = wrap(self.ensemble + f64::from(ENSEMBLE_HZ * seconds));
        let (horn, drum) = self.rotor_targets(settings, rate);
        let lag = |time: f32| 1.0 - (-seconds / time).exp();
        let horn_time = if horn > self.horn_speed {
            HORN_SECONDS.0
        } else {
            HORN_SECONDS.1
        };
        let drum_time = if drum > self.drum_speed {
            DRUM_SECONDS.0
        } else {
            DRUM_SECONDS.1
        };
        self.horn_speed += (horn - self.horn_speed) * lag(horn_time);
        self.drum_speed += (drum - self.drum_speed) * lag(drum_time);
        self.horn_angle = wrap(self.horn_angle + f64::from(self.horn_speed * seconds));
        // The drum turns the other way.
        self.drum_angle = wrap(self.drum_angle - f64::from(self.drum_speed * seconds));
        self.before = self.now;
        self.now = self.frame();
        let carrier_hertz = RING_LOW_HZ * (RING_LOG_SPAN * ring).exp();
        self.carrier.aim(
            carrier_hertz / self.timing.sample_rate,
            self.stereo.current(),
            self.timing.inverse_interval,
            false,
        );

        let wanted = Program {
            mode: settings.mode,
            shape: settings.shape,
        };
        if self.resting {
            if settings.mix <= 0.0 {
                return;
            }
            self.resting = false;
            self.quiet_frames = 0;
            self.slots[current].start(wanted, 1.0);
        } else if settings.mix <= 0.0
            && mix_before == 0.0
            && mix == 0.0
            && !self.fading
            && self.quiet_frames as f32 >= QUIET_SECONDS * self.timing.sample_rate
        {
            self.resting = true;
            return;
        }

        let mut current = current;
        if !self.fading && wanted != self.slots[current].program {
            current ^= 1;
            self.current = current;
            self.slots[current].start(wanted, 0.0);
            self.fading = true;
            self.fade = 0.0;
        }
        let mut rise = 1.0;
        if self.fading {
            self.fade = (self.fade + seconds / FADE_SECONDS).min(1.0);
            if self.fade < 1.0 {
                rise = 0.5 - 0.5 * (PI * self.fade).cos();
            }
        }
        let (before, now, timing) = (self.before, self.now, self.timing);
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.active {
                let level = if index == current { rise } else { 1.0 - rise };
                slot.aim((&before, mix_before), (&now, mix), level, &timing);
            }
        }
    }

    /// Renders `count` frames, at most one control interval, from `start`.
    fn render(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        start: usize,
        count: usize,
    ) {
        let count = count.min(INTERVAL_MAX);
        let mut dry = [[0.0_f32; INTERVAL_MAX]; 2];
        for (dry, input) in dry.iter_mut().zip(inputs).take(self.channels) {
            if let Some(source) = input.get(start..start + count) {
                for (dry, sample) in dry.iter_mut().zip(source) {
                    // A sample that is not a number would poison every memory.
                    *dry = if sample.is_finite() { *sample } else { 0.0 };
                }
            }
        }
        let mut mixed = [[0.0_f32; INTERVAL_MAX]; 2];
        if self.resting {
            mixed = dry;
        } else {
            let mut carrier: CarrierBlock = [[0.0_f32; INTERVAL_MAX]; 3];
            if self
                .slots
                .iter()
                .any(|slot| slot.active && slot.program.mode == Mode::Ring)
            {
                self.carrier.render(&mut carrier, count);
            }
            let mut peak = 0.0_f32;
            for slot in self.slots.iter_mut().filter(|slot| slot.active) {
                peak = peak.max(slot.render(&dry, &carrier, &mut mixed, count));
            }
            self.quiet_frames = if peak < QUIET {
                self.quiet_frames.saturating_add(count)
            } else {
                0
            };
        }
        for (output, mixed) in outputs.iter_mut().zip(&mixed).take(self.channels) {
            if let Some(target) = output.get_mut(start..start + count) {
                for (target, sample) in target.iter_mut().zip(mixed) {
                    *target = *sample;
                }
            }
        }
    }
}
