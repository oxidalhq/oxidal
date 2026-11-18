//! Joins the two halves: the Clock around them, Route between them, and
//! Balance, Direct and Mix after them.
//! @see docs/native-moment.md

use crate::clock::Clock;
use crate::controls::{Link, Route, Settings};
use crate::looper::{LengthRule, LoopSettings, Looper};
use crate::wet::{self, Wet, WetSettings};
use oxidal_dsp::Smoothed;

/// Milliseconds the levels glide over.
const LEVEL_MS: f32 = 20.0;
/// The largest input the effect path takes, so that no setting or signal can
/// drive the filters to an unusable size. The dry path is not limited.
const INPUT_LIMIT: f32 = 8.0;

/// The levels that glide, in one place.
#[derive(Debug)]
struct Levels {
    send: Smoothed,
    dry: Smoothed,
    input_to_wet: Smoothed,
    loop_to_wet: Smoothed,
    wet_on: Smoothed,
    direct: Smoothed,
    loop_level: Smoothed,
    wet_level: Smoothed,
}

/// The targets of [`Levels`] for one block of settings.
#[derive(Debug, Clone, Copy)]
struct Targets {
    send: f32,
    dry: f32,
    input_to_wet: f32,
    loop_to_wet: f32,
    wet_on: f32,
    direct: f32,
    loop_level: f32,
    wet_level: f32,
}

impl Targets {
    fn of(s: &Settings) -> Self {
        Self {
            send: (2.0 * s.mix).min(1.0),
            dry: (2.0 * (1.0 - s.mix)).min(1.0),
            input_to_wet: if s.route == Route::Loop { 0.0 } else { 1.0 },
            loop_to_wet: if s.route == Route::Input { 0.0 } else { 1.0 },
            wet_on: if s.wet_on { 1.0 } else { 0.0 },
            direct: s.direct,
            loop_level: (2.0 * (1.0 - s.balance)).min(1.0),
            wet_level: (2.0 * s.balance).min(1.0),
        }
    }
}

impl Levels {
    fn new(rate: f32) -> Self {
        let level = |value| Smoothed::new(rate, LEVEL_MS, value);
        Self {
            send: level(0.0),
            dry: level(1.0),
            input_to_wet: level(1.0),
            loop_to_wet: level(1.0),
            wet_on: level(1.0),
            direct: level(0.0),
            loop_level: level(1.0),
            wet_level: level(1.0),
        }
    }

    fn each(&mut self, targets: Targets, apply: impl Fn(&mut Smoothed, f32)) {
        apply(&mut self.send, targets.send);
        apply(&mut self.dry, targets.dry);
        apply(&mut self.input_to_wet, targets.input_to_wet);
        apply(&mut self.loop_to_wet, targets.loop_to_wet);
        apply(&mut self.wet_on, targets.wet_on);
        apply(&mut self.direct, targets.direct);
        apply(&mut self.loop_level, targets.loop_level);
        apply(&mut self.wet_level, targets.wet_level);
    }
}

#[derive(Debug)]
pub struct Engine<const N: usize> {
    rate: f32,
    clock: Clock<N>,
    looper: Looper<N>,
    wet: Wet<N>,
    levels: Levels,
    started: bool,
}

impl<const N: usize> Engine<N> {
    pub fn new(rate: f32) -> Self {
        Self {
            rate,
            clock: Clock::new(rate),
            looper: Looper::new(rate),
            wet: Wet::new(rate),
            levels: Levels::new(rate),
            started: false,
        }
    }

    pub fn reset(&mut self) {
        self.clock.reset();
        self.looper.reset();
        self.wet.reset();
        self.started = false;
    }

    /// The loop half, for the tests.
    pub fn looper(&self) -> &Looper<N> {
        &self.looper
    }

    /// Takes one block's controls.
    pub fn set(&mut self, s: &Settings) {
        let targets = Targets::of(s);
        if self.started {
            self.clock.set(s.ratio, s.grit);
            self.levels.each(targets, Smoothed::set);
        } else {
            self.clock.snap(s.ratio, s.grit);
            self.levels.each(targets, Smoothed::snap);
            self.started = true;
        }

        // One bar of the tempo in engine steps, and Time as a share of a loop.
        let tempo_steps = s.beats * 60.0 / s.bpm * self.rate / s.ratio;
        let divider = s.link_divider();
        let rule = match s.link {
            Link::LoopFollowsTime => {
                LengthRule::Multiple(f64::from(wet::period(s.wet_mode, s.time, self.rate)))
            }
            Link::Tempo => LengthRule::Fixed(f64::from(tempo_steps)),
            Link::Off | Link::TimeFollowsLoop => LengthRule::Free,
        };
        let linked = match s.link {
            Link::TimeFollowsLoop if self.looper.caught() => {
                Some(self.looper.length() as f32 / divider)
            }
            Link::Tempo => Some(tempo_steps / divider),
            _ => None,
        };
        self.looper.set(LoopSettings {
            catch: s.catch,
            mode: s.loop_mode,
            length: s.length,
            movement: s.movement,
            tape_speed: s.tape_speed(),
            overdub: s.overdub,
            fade: s.fade,
            width: s.width,
            rule,
        });
        self.wet.set(WetSettings {
            on: s.wet_on,
            mode: s.wet_mode,
            time: s.time,
            shape: s.shape,
            tone: s.tone,
            chance: s.chance,
            freeze: s.freeze,
            width: s.width,
            linked,
        });
    }

    /// One host sample.
    #[inline]
    pub fn tick(&mut self, input: [f32; N]) -> [f32; N] {
        let send = self.levels.send.next();
        let dry = self.levels.dry.next();
        let into_wet = self.levels.input_to_wet.next();
        let loop_to_wet = self.levels.loop_to_wet.next();
        let wet_on = self.levels.wet_on.next();
        let direct = self.levels.direct.next();
        let loop_level = self.levels.loop_level.next();
        let wet_level = self.levels.wet_level.next();

        let sent = input.map(|x| (x * send).clamp(-INPUT_LIMIT, INPUT_LIMIT));
        let step = self.clock.input(sent).map(|x| {
            let looped = self.looper.play(x);
            let mut feed = [0.0; N];
            for channel in 0..N {
                feed[channel] = x[channel] * into_wet + looped[channel] * loop_to_wet;
            }
            let wet = self.wet.step(feed);
            let mut heard = [0.0; N];
            let mut record = [0.0; N];
            // A loop sent through the wet half is replaced by what comes back,
            // apart from the share that Direct keeps.
            let kept = 1.0 - loop_to_wet * wet_on * (1.0 - direct);
            for channel in 0..N {
                heard[channel] = looped[channel] * kept * loop_level + wet[channel] * wet_level;
                record[channel] = x[channel] + wet[channel];
            }
            self.looper.record(record);
            heard
        });
        let rebuilt = self.clock.output(step);
        let mut out = [0.0; N];
        for channel in 0..N {
            let y = input[channel] * dry + rebuilt[channel];
            out[channel] = if y.is_finite() { y } else { 0.0 };
        }
        out
    }
}
