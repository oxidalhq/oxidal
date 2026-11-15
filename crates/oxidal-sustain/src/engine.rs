//! The sustainer's engine: one mono listener and voice.
//!
//! Four parts work on the same input. *Listening* finds each new note, reads
//! its pitch and tells a mute from a natural decay. The *Lift* is a slow gain
//! that holds the real string up while it still rings. The *Driver* is a pair
//! of string loops, one at the note and one at a harmonic, that carry on at a
//! steady level when the string is gone. The *chord hold* takes over when no
//! single pitch is found. The plugin adds the voice to each channel and
//! applies the Lift to the dry signal.
//! @see docs/native-sustain.md

use crate::chord::ChordHold;
use crate::driver::StringLoop;
use crate::pitch::{PitchGuard, PitchReader, Verdict};
use oxidal_dsp::{EnvelopeFollower, OnePole, Smoothed, StateVariable, db_to_gain, equal_power};

/// Samples between two control updates (level plan, loop gains, state).
const CONTROL_PERIOD: u32 = 16;
/// Share of the input added to the loops. With the loop held at the level of
/// the note, a string at that level refreshes the loop within four periods,
/// one 20 dB down within forty: the loop follows the string while it rings
/// and stops listening as it dies.
const INJECTION: f32 = 0.25;
/// Share of the note's loop fed to the harmonic loop, so the harmonic can
/// still grow after the string has gone. Off its resonances the harmonic
/// loop passes about half of what it is fed, so this share leaves the note
/// itself 40 dB down in Harmonic mode.
const HARMONIC_FEED: f32 = 0.02;
/// A harmonic loop above this frequency would hold almost nothing a guitar
/// produces, so a lower harmonic is used instead.
const HIGHEST_HARMONIC: f32 = 4200.0;
/// Fades, in seconds: the old voice when a new note is picked, when the
/// pitch moves to another note without a pick, when the string is muted, and
/// the new voice coming in.
const NOTE_FADE: f32 = 0.040;
const JUMP_FADE: f32 = 0.030;
const MUTE_FADE: f32 = 0.080;
const VOICE_RISE: f32 = 0.020;
/// Fade between modes, and of the harmonic loop when the harmonic changes.
const MODE_FADE: f32 = 0.040;
/// Fade of the whole effect when On or Dry is switched.
const SWITCH_FADE: f32 = 0.030;
/// Readings are ignored this long after a pick: until then the reader's
/// 50 ms frame is still mostly the previous sound.
const BLANK: f32 = 0.040;
/// Shortest gap between two picks, as in Oxidal Swell.
const HOLDOFF: f32 = 0.050;
/// A mute is not looked for this soon after a pick, while the pick's own
/// spike dies down.
const MUTE_HOLDOFF: f32 = 0.060;
/// With no single pitch this long after a pick plus the length of the
/// capture frame, the sound is held as a chord: the frame then holds none of
/// the pick itself.
const CHORD_WAIT: f32 = 0.030;
const CHORD_RETRY: f32 = 0.250;
/// A wrong first lock may be corrected quickly this long after a pick.
const FRESH: f32 = 0.250;
/// The Lift waits this long after a pick and then rises with this time
/// constant; it falls much faster, so a new pick is never lifted.
const LIFT_DELAY: f32 = 0.030;
const LIFT_RISE: f32 = 0.250;
const LIFT_FALL: f32 = 0.020;
/// The voice's share falls this fast when the string gets louder.
const WEIGHT_FALL: f32 = 0.010;
/// A pick that turns out to be nothing is forgotten after this long.
const GIVE_UP: f32 = 0.300;
/// Input level detector for the level plan (mean square).
const LEVEL_SECONDS: f32 = 0.020;
/// The pitch reader listens through its own automatic gain, which brings
/// the string to about -20 dBFS whatever is heard, up to +60 dB. It falls at
/// once when the input rises and recovers with a 100 ms time constant, so a
/// decaying string (at most 40 dB a second) stays near the reading level.
const READER_LEVEL: f32 = 0.1;
const READER_MOST_GAIN: f32 = 1000.0;
const READER_RECOVERY: f32 = 0.100;
/// Share of the last step the Driver runs ahead, and the largest step (as a
/// share of the period, 35 cents) that counts as smooth movement.
const PREDICT: f32 = 0.75;
const PREDICT_MOST: f32 = 0.02;
/// Only a very clear reading is run ahead of: a frame caught in a change of
/// sound reads a little less clearly, and its drift is not a bend.
const PREDICT_CONFIDENCE: f32 = 0.98;
/// Pitch movement per reading above which less of the string is fed into
/// the loop: from 4 cents (still) the share falls to `LEAST_SHARE` at 8.
const MOVING_CENTS: f32 = 4.0;
const LEAST_SHARE: f32 = 0.1;
/// Recovery of the share per reading (10 ms).
const SHARE_RECOVERY: f32 = 0.1;

/// What the sustained voice settles on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// The note's own pitch.
    Normal,
    /// A harmonic of the note.
    Harmonic,
    /// The note first, the harmonic after the Bloom time.
    Mix,
}

/// The control values, in the engine's own units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Settings {
    pub on: bool,
    pub mode: Mode,
    /// 0 octave, 1 octave and a fifth, 2 two octaves.
    pub harmonic: usize,
    /// 0..1
    pub drive: f32,
    pub bloom_seconds: f32,
    /// 0..1
    pub sensitivity: f32,
    /// 0..1
    pub tone: f32,
    pub level_db: f32,
    pub dry: bool,
}

/// What is making the sustained sound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Voice {
    None,
    /// The string loops, tuned to one note.
    Driver,
    /// The spectral hold of a chord.
    Chord,
}

/// Where the engine is in the life of a note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Nothing to sustain.
    Idle,
    /// A note has begun; its pitch is being worked out.
    Listening,
    /// A voice is sounding.
    Sustaining,
    /// The voice is fading out.
    Releasing,
}

fn seconds_to_step(seconds: f32, rate: f32) -> f32 {
    1.0 / (seconds * rate).max(1.0)
}

fn lag(seconds: f32, rate: f32) -> f32 {
    1.0 - (-1.0 / (seconds * rate).max(1.0)).exp()
}

/// A control value limited to 0..1; one that is not a number becomes
/// `fallback`.
fn unit(value: f32, fallback: f32) -> f32 {
    limited(value, 0.0, 1.0, fallback)
}

/// A value limited to a range; one that is not a number becomes `fallback`.
fn limited(value: f32, low: f32, high: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(low, high)
    } else {
        fallback
    }
}

/// Moves `value` toward `target` by at most `step`.
fn ramp(value: f32, target: f32, step: f32) -> f32 {
    value + (target - value).clamp(-step, step)
}

/// The harmonic number for a choice, lowered where the harmonic would be too
/// high to hold anything.
fn harmonic_number(choice: usize, period: f32, rate: f32) -> f32 {
    let fundamental = rate / period.max(1.0);
    let wanted = match choice {
        0 => 2.0,
        1 => 3.0,
        _ => 4.0,
    };
    if wanted * fundamental <= HIGHEST_HARMONIC {
        wanted
    } else if 2.0 * fundamental <= HIGHEST_HARMONIC {
        2.0
    } else {
        1.0
    }
}

/// The whole sustainer for one (mono) signal.
#[derive(Debug, Clone)]
pub struct Engine {
    rate: f32,
    clock: u32,
    settings: Option<Settings>,
    on: bool,
    mode: Mode,
    harmonic_choice: usize,
    bloom_seconds: f32,
    // Switches.
    engage: f32,
    dry: f32,
    dry_target: f32,
    switch_step: f32,
    cleared: bool,
    // Listening.
    input_highpass: OnePole,
    fast: EnvelopeFollower,
    slow: EnvelopeFollower,
    power: f32,
    power_step: f32,
    threshold: f32,
    floor: f32,
    jump: f32,
    rearm: f32,
    drop: f32,
    armed: bool,
    holdoff: u32,
    since_onset: u32,
    note_live: bool,
    muted: bool,
    reader: PitchReader,
    guard: PitchGuard,
    period: f32,
    /// Where `period` is heading, and its step per control update, so the
    /// Driver moves smoothly between two readings instead of in steps.
    period_goal: f32,
    /// The tracked period at the last reading, for the prediction.
    last_reading: f32,
    last_moved: f32,
    inject_share: f32,
    period_step: f32,
    /// Control updates in one reading hop.
    hop_updates: f32,
    reader_gain: f32,
    reader_recovery: f32,
    // Times, in samples.
    holdoff_samples: u32,
    blank: u32,
    mute_holdoff: u32,
    chord_wait: u32,
    chord_retry: u32,
    since_chord: u32,
    fresh: u32,
    lift_delay: u32,
    give_up: u32,
    // The level plan.
    target: f32,
    aim: f32,
    aliveness: f32,
    plateau: f32,
    lift_ceiling: f32,
    lift: f32,
    lift_target: f32,
    lift_rise: f32,
    lift_fall: f32,
    weight: f32,
    weight_target: f32,
    weight_rise: f32,
    weight_fall: f32,
    grow_seconds: f32,
    // The voice.
    phase: Phase,
    voice: Voice,
    pending: bool,
    gate: f32,
    gate_rise: f32,
    gate_fall: f32,
    fundamental: StringLoop,
    harmonic: StringLoop,
    inject: f32,
    inject_target: f32,
    fast_lag: f32,
    number: f32,
    harmonic_gate: f32,
    harmonic_open: bool,
    mode_step: f32,
    bloom: f32,
    blend: f32,
    gains: (f32, f32),
    gain_targets: (f32, f32),
    chord: ChordHold,
    chord_gain: f32,
    chord_lag: f32,
    slice: u32,
    slice_period: u32,
    tone: StateVariable,
    tone_value: Smoothed,
    tone_set: f32,
    voice_highpass: OnePole,
    level: Smoothed,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        // A rate that is not a number must not reach any coefficient.
        let rate = if sample_rate.is_finite() {
            sample_rate.clamp(8000.0, 384_000.0)
        } else {
            48_000.0
        };
        let samples = |seconds: f32| (seconds * rate) as u32;
        let reader = PitchReader::new(rate);
        let guard = PitchGuard::new(reader.hop_seconds(rate));
        let mut input_highpass = OnePole::default();
        input_highpass.set_cutoff(rate, 30.0);
        let mut voice_highpass = OnePole::default();
        voice_highpass.set_cutoff(rate, 20.0);
        let mut fast = EnvelopeFollower::default();
        fast.set_times(rate, 1.0, 15.0);
        let control_rate = rate / CONTROL_PERIOD as f32;
        let mut engine = Self {
            rate,
            clock: 0,
            settings: None,
            on: false,
            mode: Mode::Normal,
            harmonic_choice: 0,
            bloom_seconds: 2.0,
            engage: 0.0,
            dry: 1.0,
            dry_target: 1.0,
            switch_step: seconds_to_step(SWITCH_FADE, rate),
            cleared: true,
            input_highpass,
            fast,
            slow: EnvelopeFollower::default(),
            power: 0.0,
            power_step: seconds_to_step(LEVEL_SECONDS, rate),
            threshold: 1.0,
            floor: 0.5,
            jump: 2.0,
            rearm: 1.4,
            drop: 0.25,
            armed: true,
            holdoff: 0,
            since_onset: u32::MAX,
            note_live: false,
            muted: false,
            reader,
            guard,
            period: 100.0,
            period_goal: 100.0,
            last_reading: 0.0,
            last_moved: 0.0,
            inject_share: 1.0,
            period_step: 0.0,
            hop_updates: 1.0,
            reader_gain: 1.0,
            reader_recovery: lag(READER_RECOVERY, rate / CONTROL_PERIOD as f32),
            holdoff_samples: samples(HOLDOFF),
            blank: samples(BLANK),
            mute_holdoff: samples(MUTE_HOLDOFF),
            chord_wait: 0,
            chord_retry: samples(CHORD_RETRY),
            since_chord: u32::MAX,
            fresh: samples(FRESH),
            lift_delay: samples(LIFT_DELAY),
            give_up: samples(GIVE_UP),
            target: 0.0,
            aim: 0.0,
            aliveness: 0.0,
            plateau: 1.0,
            lift_ceiling: 1.0,
            lift: 1.0,
            lift_target: 1.0,
            lift_rise: lag(LIFT_RISE, rate),
            lift_fall: lag(LIFT_FALL, rate),
            weight: 0.0,
            weight_target: 0.0,
            weight_rise: 1.0,
            weight_fall: lag(WEIGHT_FALL, rate),
            grow_seconds: 0.1,
            phase: Phase::Idle,
            voice: Voice::None,
            pending: false,
            gate: 0.0,
            gate_rise: seconds_to_step(VOICE_RISE, rate),
            gate_fall: seconds_to_step(NOTE_FADE, rate),
            fundamental: StringLoop::new(rate),
            harmonic: StringLoop::new(rate),
            inject: 0.0,
            inject_target: 0.0,
            fast_lag: lag(0.002, rate),
            number: 2.0,
            harmonic_gate: 1.0,
            harmonic_open: true,
            mode_step: seconds_to_step(MODE_FADE, rate),
            bloom: 0.0,
            blend: 0.0,
            gains: (1.0, 0.0),
            gain_targets: (1.0, 0.0),
            chord: ChordHold::new(rate),
            chord_gain: 0.0,
            chord_lag: lag(0.030, rate),
            slice: 0,
            slice_period: if rate <= 50_000.0 { 64 } else { 128 },
            tone: StateVariable::default(),
            tone_value: Smoothed::new(control_rate, 30.0, 0.6),
            tone_set: -1.0,
            voice_highpass,
            level: Smoothed::new(rate, 20.0, 1.0),
        };
        engine.hop_updates =
            (engine.reader.hop_seconds(rate) * rate / CONTROL_PERIOD as f32).max(1.0);
        engine.chord_wait = samples(CHORD_WAIT + engine.chord.frame_seconds());
        engine.reset();
        engine
    }

    /// Back to the state of a new engine; the next settings apply at once.
    pub fn reset(&mut self) {
        self.settings = None;
        self.clock = 0;
        self.engage = 0.0;
        self.input_highpass.reset(0.0);
        self.voice_highpass.reset(0.0);
        self.tone.reset();
        self.clear();
    }

    /// Forgets every note: used at reset and once the effect has faded out.
    fn clear(&mut self) {
        self.fast.reset();
        self.slow.reset();
        self.power = 0.0;
        self.armed = true;
        self.holdoff = 0;
        self.since_onset = u32::MAX;
        self.since_chord = u32::MAX;
        self.note_live = false;
        self.muted = false;
        self.reader.reset();
        self.reader_gain = 1.0;
        self.guard.reset();
        self.target = 0.0;
        self.aim = 0.0;
        self.aliveness = 0.0;
        self.lift = 1.0;
        self.lift_target = 1.0;
        self.weight = 0.0;
        self.weight_target = 0.0;
        self.phase = Phase::Idle;
        self.voice = Voice::None;
        self.pending = false;
        self.gate = 0.0;
        self.fundamental.clear();
        self.harmonic.clear();
        self.inject = 0.0;
        self.inject_target = 0.0;
        self.harmonic_gate = 1.0;
        self.harmonic_open = true;
        self.bloom = 0.0;
        self.chord.reset();
        self.chord_gain = 0.0;
        self.slice = 0;
        self.cleared = true;
    }

    /// Takes the control values for the next block.
    pub fn configure(&mut self, settings: Settings) {
        if self.settings == Some(settings) {
            return;
        }
        let first = self.settings.is_none();
        self.settings = Some(settings);
        self.on = settings.on;
        self.mode = settings.mode;
        self.harmonic_choice = settings.harmonic.min(2);
        self.bloom_seconds = limited(settings.bloom_seconds, 0.05, 60.0, 2.0);
        self.dry_target = if settings.dry { 1.0 } else { 0.0 };
        // Sensitivity: how quiet a pick may be, how small a jump in level is
        // a new pick, and how slow a fall still counts as a mute.
        let sensitivity = unit(settings.sensitivity, 0.5);
        self.threshold = db_to_gain(-30.0 - 30.0 * sensitivity);
        self.floor = 0.5 * self.threshold;
        self.jump = db_to_gain(12.0 - 9.0 * sensitivity);
        self.rearm = self.jump.sqrt();
        self.drop = db_to_gain(10.0 * sensitivity - 18.0);
        self.slow
            .set_times(self.rate, 30.0, 60.0 + 140.0 * sensitivity);
        // Drive: the level the note is held at, below its picked level; how
        // far the Lift may raise the string before the Driver has to take
        // over; and how fast the Driver comes in.
        let drive = unit(settings.drive, 0.65);
        self.plateau = db_to_gain(-9.0 * (1.0 - drive));
        self.lift_ceiling = db_to_gain(12.0 - 9.0 * drive);
        self.weight_rise = lag(0.8 * (0.05_f32 / 0.8).powf(drive), self.rate);
        self.grow_seconds = 0.4 * (0.06_f32 / 0.4).powf(drive);
        self.level
            .set(db_to_gain(limited(settings.level_db, -60.0, 12.0, 0.0)));
        self.tone_value.set(unit(settings.tone, 0.6));
        if first {
            self.engage = if self.on { 1.0 } else { 0.0 };
            self.dry = self.dry_target;
            self.level.snap(self.level.target());
            self.tone_value.snap(self.tone_value.target());
        }
    }

    /// True when the effect is off and has faded out: the caller passes the
    /// input through untouched and need not call [`Self::step`].
    pub fn bypassed(&self) -> bool {
        !self.on && self.engage <= 0.0
    }

    pub fn voice(&self) -> Voice {
        self.voice
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// The period the Driver is tuned to, in samples.
    pub fn period(&self) -> f32 {
        self.period
    }

    /// The level the current note is held at (root mean square).
    pub fn aim(&self) -> f32 {
        self.aim
    }

    /// One sample. Returns `(through, voice)`: each channel's output is its
    /// input times `through`, plus `voice`.
    pub fn step(&mut self, input: f32) -> (f32, f32) {
        if self.clock & (CONTROL_PERIOD - 1) == 0 {
            self.control();
        }
        self.clock = self.clock.wrapping_add(1);
        self.cleared = false;
        self.engage = ramp(
            self.engage,
            if self.on { 1.0 } else { 0.0 },
            self.switch_step,
        );
        self.dry = ramp(self.dry, self.dry_target, self.switch_step);

        // Listening.
        let input = if input.is_finite() { input } else { 0.0 };
        let x = self.input_highpass.highpass(input);
        let fast = self.fast.process(x);
        let slow = self.slow.process(x);
        self.power += (x * x - self.power) * self.power_step;
        self.since_onset = self.since_onset.saturating_add(1);
        self.since_chord = self.since_chord.saturating_add(1);
        self.detect(fast, slow);
        if self.reader.push(x * self.reader_gain) {
            self.read();
        }
        self.chord.push(x);
        if self.chord.busy() {
            self.slice += 1;
            if self.slice >= self.slice_period {
                self.slice = 0;
                self.chord.work();
            }
        }

        // The voice.
        let mut voice = 0.0;
        if self.voice == Voice::Driver {
            self.inject += (self.inject_target - self.inject) * self.fast_lag;
            let excitation = x * self.inject;
            let own = self.fundamental.process(excitation);
            let above = self.harmonic.process(excitation + HARMONIC_FEED * own);
            self.gains.0 += (self.gain_targets.0 - self.gains.0) * self.fast_lag;
            self.gains.1 += (self.gain_targets.1 - self.gains.1) * self.fast_lag;
            let open = if self.harmonic_open { 1.0 } else { 0.0 };
            self.harmonic_gate = ramp(self.harmonic_gate, open, self.mode_step);
            voice = own * self.gains.0 + above * self.gains.1 * self.harmonic_gate;
        } else if self.chord.ready() {
            self.chord_gain += (self.aim - self.chord_gain) * self.chord_lag;
            let held = self.chord.next();
            if self.voice == Voice::Chord {
                voice = held * self.chord_gain;
            }
        }
        self.tone.process(voice);
        let voice = self.voice_highpass.highpass(self.tone.low());

        // Gains.
        match self.phase {
            Phase::Releasing => {
                self.gate -= self.gate_fall;
                if self.gate <= 0.0 {
                    self.finish_release();
                }
            }
            Phase::Sustaining => self.gate = (self.gate + self.gate_rise).min(1.0),
            Phase::Idle | Phase::Listening => {}
        }
        if self.phase != Phase::Releasing {
            let rate = if self.weight_target > self.weight {
                self.weight_rise
            } else {
                self.weight_fall
            };
            self.weight += (self.weight_target - self.weight) * rate;
        }
        let rate = if self.lift_target > self.lift {
            self.lift_rise
        } else {
            self.lift_fall
        };
        self.lift += (self.lift_target - self.lift) * rate;
        if (self.lift_target - self.lift).abs() < 1.0e-5 {
            self.lift = self.lift_target;
        }
        let wet = self.engage * self.level.next();
        let through = 1.0 - self.engage * (1.0 - self.dry) + (self.lift - 1.0) * wet;
        if self.engage <= 0.0 && !self.on && !self.cleared {
            self.clear();
        }
        (through, voice * self.gate * self.weight * wet)
    }

    /// Finds picks and mutes from two level followers: a fast one and a slow
    /// one that stands for the level the note had a moment ago.
    fn detect(&mut self, fast: f32, slow: f32) {
        self.holdoff = self.holdoff.saturating_sub(1);
        if self.armed {
            if self.holdoff == 0 && fast > self.threshold && fast > slow * self.jump {
                self.armed = false;
                self.holdoff = self.holdoff_samples;
                self.onset();
            }
        } else if fast < slow * self.rearm {
            self.armed = true;
        }
        if self.note_live && self.since_onset > self.mute_holdoff {
            if slow < self.floor {
                // It faded away by itself: nothing left to mute.
                self.note_live = false;
            } else if fast < slow * self.drop {
                self.mute();
            }
        }
    }

    /// A new note has been picked.
    fn onset(&mut self) {
        self.since_onset = 0;
        self.since_chord = self.chord_retry;
        self.target = 0.0;
        self.note_live = true;
        self.muted = false;
        self.guard.reset();
        self.chord.cancel();
        self.release(NOTE_FADE, true);
    }

    /// The string has been stopped.
    fn mute(&mut self) {
        self.note_live = false;
        self.muted = true;
        self.chord.cancel();
        self.release(MUTE_FADE, false);
    }

    /// Fades the voice out; `pending` says a new note is waiting behind it.
    fn release(&mut self, seconds: f32, pending: bool) {
        self.pending = pending;
        self.inject_target = 0.0;
        if self.voice == Voice::None {
            self.phase = if pending {
                Phase::Listening
            } else {
                Phase::Idle
            };
            return;
        }
        if self.phase != Phase::Releasing {
            self.gate_fall = seconds_to_step(seconds, self.rate);
        }
        self.phase = Phase::Releasing;
    }

    fn finish_release(&mut self) {
        self.gate = 0.0;
        self.weight = 0.0;
        self.weight_target = 0.0;
        self.fundamental.clear();
        self.harmonic.clear();
        self.inject = 0.0;
        if self.voice == Voice::Chord {
            self.chord.stop();
        }
        self.voice = Voice::None;
        self.phase = if self.pending {
            Phase::Listening
        } else {
            Phase::Idle
        };
    }

    /// Takes a new pitch reading.
    fn read(&mut self) {
        // A new note is only begun from a string loud enough to count as a
        // pick; once one is sounding it is followed for as long as readings
        // are clear, however faint the string has become, because the
        // reader listens through its own gain.
        let audible = self.aliveness >= 1.0;
        if self.phase == Phase::Idle
            || self.since_onset < self.blank
            || (self.phase == Phase::Listening && !audible)
        {
            return;
        }
        let fresh = self.since_onset < self.fresh;
        match self.guard.accept(self.reader.reading(), fresh, audible) {
            Verdict::Hold => {}
            Verdict::Start | Verdict::Follow => {
                // A reading is about 20 ms old when it arrives. While the
                // pitch moves smoothly (a bend, vibrato) the Driver aims one
                // hop ahead along that movement, so it is not a further hop
                // behind; the aim is limited to the step just seen, and it is used only
                // when two steps in a row went the same way.
                let now = self.guard.period();
                let moved = now - self.last_reading;
                let smooth = self.last_reading > 0.0
                    && (moved / now).abs() < PREDICT_MOST
                    && self.guard.in_step()
                    && moved * self.last_moved > 0.0
                    && self.reader.reading().confidence >= PREDICT_CONFIDENCE;
                self.last_moved = if self.last_reading > 0.0 { moved } else { 0.0 };
                // While the pitch moves, less of the string goes into the
                // loop: it leads the loop, and the two together would sound
                // at a pitch between them.
                let cents = 1731.234 * (moved / now).abs(); // 1200 / ln 2
                // It drops at once and recovers over about 100 ms, so a
                // vibrato's turning points do not pulse the feed.
                let share = if self.last_reading > 0.0 {
                    (1.0 - (cents - MOVING_CENTS) / MOVING_CENTS).clamp(LEAST_SHARE, 1.0)
                } else {
                    1.0
                };
                self.inject_share = share.min(self.inject_share + SHARE_RECOVERY);
                self.last_reading = now;
                self.period_goal = if smooth { now + PREDICT * moved } else { now };
                self.period_step = (self.period_goal - self.period) / self.hop_updates;
            }
            Verdict::Jump => {
                // Another note without a pick (a hammer-on, a slide): the
                // loops are faded out and started again at the new pitch.
                self.period = self.guard.period();
                self.period_goal = self.period;
                self.period_step = 0.0;
                if self.phase == Phase::Sustaining && self.voice == Voice::Driver {
                    self.release(JUMP_FADE, true);
                }
            }
        }
    }

    /// The control update: level plan, state changes and loop gains.
    fn control(&mut self) {
        let level = self.power.max(0.0).sqrt();
        self.aliveness = ((level - self.floor) / self.floor.max(1.0e-9)).clamp(0.0, 1.0);
        let tone = self.tone_value.next();
        let wanted = (READER_LEVEL / level.max(1.0e-12)).min(READER_MOST_GAIN);
        self.reader_gain = if wanted < self.reader_gain {
            wanted
        } else {
            self.reader_gain + (wanted - self.reader_gain) * self.reader_recovery
        };
        // The Driver's period moves to the newest reading over one hop.
        let left = self.period_goal - self.period;
        self.period = if left.abs() <= self.period_step.abs() || left * self.period_step <= 0.0 {
            self.period_goal
        } else {
            self.period + self.period_step
        };
        if (tone - self.tone_set).abs() > 1.0e-4 {
            self.tone_set = tone;
            self.tone.set(self.rate, 400.0 * 20.0_f32.powf(tone), 0.707);
        }
        match self.phase {
            Phase::Idle => {
                // A note already ringing when the effect is switched on.
                if self.on && self.aliveness >= 1.0 && !self.muted {
                    self.phase = Phase::Listening;
                    self.note_live = true;
                    self.target = level;
                    self.guard.reset();
                    self.since_chord = self.chord_retry;
                }
            }
            Phase::Listening => {
                self.target = self.target.max(level);
                self.listen();
            }
            Phase::Sustaining => self.target = self.target.max(level),
            Phase::Releasing => {}
        }
        if self.phase == Phase::Sustaining {
            self.sustain(level);
        } else {
            self.lift_target = 1.0;
            if self.phase != Phase::Releasing {
                self.weight_target = 0.0;
            }
        }
    }

    /// Decides what will sustain the note that has just begun.
    fn listen(&mut self) {
        if self.guard.tracking() {
            self.chord.cancel();
            self.period = self.guard.period();
            self.last_reading = 0.0;
            self.inject_share = 1.0;
            self.period_goal = self.period;
            self.period_step = 0.0;
            self.number = harmonic_number(self.harmonic_choice, self.period, self.rate);
            self.fundamental.clear();
            self.harmonic.clear();
            self.fundamental.tune(self.period, true);
            self.harmonic.tune(self.period / self.number, true);
            self.harmonic_gate = 1.0;
            self.harmonic_open = true;
            self.bloom = 0.0;
            self.voice = Voice::Driver;
            self.phase = Phase::Sustaining;
            return;
        }
        if self.chord.ready() {
            if self.chord.held() > 0 {
                self.chord_gain = 0.0;
                self.voice = Voice::Chord;
                self.phase = Phase::Sustaining;
                return;
            }
            self.chord.stop();
        }
        if self.aliveness <= 0.0 && self.since_onset > self.give_up {
            self.chord.cancel();
            self.phase = Phase::Idle;
            return;
        }
        if !self.chord.busy()
            && self.since_onset >= self.chord_wait
            && self.since_chord >= self.chord_retry
            && self.aliveness >= 1.0
            && self.guard.unclear() >= 3
        {
            self.chord.begin();
            self.slice = 0;
            self.since_chord = 0;
        }
    }

    /// The level plan while a voice sounds: the note is held at `aim`; the
    /// real string, raised by the Lift, covers as much of that as it can, and
    /// the voice fills the rest.
    fn sustain(&mut self, level: f32) {
        self.aim = (self.target * self.plateau).max(1.0e-6);
        let blend = if self.voice == Voice::Driver {
            self.blend
        } else {
            0.0
        };
        let string = (self.lift * level * self.dry / self.aim).min(1.0);
        // At the note's own pitch the voice is in step with the string and
        // amplitudes add; a harmonic is a separate sound and powers add.
        let in_step = 1.0 - string;
        let separate = (1.0 - string * string).max(0.0).sqrt();
        self.weight_target = in_step + (separate - in_step) * blend;
        let wanted = (self.aim / level.max(1.0e-9)).clamp(1.0, self.lift_ceiling.max(1.0));
        self.lift_target = if self.since_onset >= self.lift_delay {
            1.0 + (wanted - 1.0) * self.aliveness * self.dry * (1.0 - blend)
        } else {
            1.0
        };
        if self.voice != Voice::Driver {
            return;
        }
        // Tuning: follow the tracked pitch; a change of harmonic fades the
        // harmonic loop out, retunes it empty and lets it fill again.
        let number = harmonic_number(self.harmonic_choice, self.period, self.rate);
        if number == self.number {
            self.harmonic_open = true;
        } else if self.harmonic_gate <= 0.0 {
            self.number = number;
            self.harmonic.clear();
            self.harmonic.tune(self.period / self.number, true);
            self.harmonic_open = true;
        } else {
            self.harmonic_open = false;
        }
        self.fundamental.tune(self.period, false);
        self.harmonic.tune(self.period / self.number, false);
        let power = self.aim * self.aim;
        self.fundamental.control(power, self.grow_seconds);
        self.harmonic.control(power, self.grow_seconds);
        self.inject_target = INJECTION * self.aliveness * self.inject_share;
        // Mode: how much of the voice is the harmonic loop.
        let step = CONTROL_PERIOD as f32 / self.rate;
        self.bloom = (self.bloom + step / self.bloom_seconds).min(1.0);
        let wanted = match self.mode {
            Mode::Normal => 0.0,
            Mode::Harmonic => 1.0,
            Mode::Mix => self.bloom * self.bloom * (3.0 - 2.0 * self.bloom),
        };
        self.blend = ramp(self.blend, wanted, step / MODE_FADE);
        self.gain_targets = equal_power(self.blend);
    }
}
