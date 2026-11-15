//! Oxidal Bloom: Oxidal's own reverb, as an LV2 effect.
//!
//! Eight modes behind one Mode control: Room, Hall, Plate, Spring, Cloud,
//! Bloom, Shimmer and Nonlinear. Four engines make them: a feedback delay
//! network (Room, Hall, Cloud, Bloom, Shimmer), a plate tank, a pair of
//! springs and a shaped multi-tap delay. This file holds the plugin: the
//! controls, the dry path, pre-delay and low cut, and the logic that sends
//! the input to the engine of the current mode, lets the others ring out and
//! puts silent engines to sleep.
//! @see docs/native-bloom.md

pub mod network;
pub mod nonlinear;
pub mod parts;
pub mod plate;
pub mod shifter;
pub mod spring;

use core::f32::consts::FRAC_PI_2;
use network::Network;
use nonlinear::Nonlinear;
use oxidal_dsp::{DelayLine, OnePole, Smoothed};
use oxidal_lv2_plugin::Plugin;
use parts::{Engine, FadingTap, Glide, Settings, TICK, follow, tick_smoother};
use plate::Plate;
use spring::Spring;

/// One control port: its LV2 symbol, range and default.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Control {
    pub symbol: &'static str,
    pub minimum: f32,
    pub maximum: f32,
    pub default: f32,
}

const fn control(symbol: &'static str, minimum: f32, maximum: f32, default: f32) -> Control {
    Control {
        symbol,
        minimum,
        maximum,
        default,
    }
}

/// The control ports in port order; `lv2/bloom.ttl` lists the same.
pub const CONTROLS: [Control; 14] = [
    control("mode", 0.0, 7.0, 1.0),
    control("decay", 0.1, 60.0, 2.5),
    control("predelay", 0.0, 250.0, 10.0),
    control("size", 0.0, 100.0, 50.0),
    control("tone", 0.0, 100.0, 60.0),
    control("lowcut", 20.0, 1000.0, 100.0),
    control("mod", 0.0, 100.0, 30.0),
    control("speed", 0.0, 100.0, 50.0),
    control("shimmer", 0.0, 100.0, 50.0),
    control("interval", 0.0, 2.0, 0.0),
    control("shape", 0.0, 2.0, 0.0),
    control("build", 0.1, 5.0, 1.0),
    control("mix", 0.0, 100.0, 30.0),
    control("freeze", 0.0, 1.0, 0.0),
];

/// Port numbers of the controls.
pub mod port {
    pub const MODE: usize = 0;
    pub const DECAY: usize = 1;
    pub const PREDELAY: usize = 2;
    pub const SIZE: usize = 3;
    pub const TONE: usize = 4;
    pub const LOWCUT: usize = 5;
    pub const MOD: usize = 6;
    pub const SPEED: usize = 7;
    pub const SHIMMER: usize = 8;
    pub const INTERVAL: usize = 9;
    pub const SHAPE: usize = 10;
    pub const BUILD: usize = 11;
    pub const MIX: usize = 12;
    pub const FREEZE: usize = 13;
}

/// The modes, in the order of the Mode control.
pub const MODES: [&str; 8] = [
    "Room",
    "Hall",
    "Plate",
    "Spring",
    "Cloud",
    "Bloom",
    "Shimmer",
    "Nonlinear",
];

/// The default value of every control, in port order.
pub fn defaults() -> [f32; CONTROLS.len()] {
    CONTROLS.map(|control| control.default)
}

/// Below this level an engine counts as silent (about -134 dB).
const SILENCE: f32 = 2.0e-7;
/// The wet signal can never exceed this, whatever the settings: it passes
/// through a smooth limiter that is all but linear below full scale.
const CEILING: f32 = 16.0;
/// The longest pre-delay, in seconds.
const PREDELAY_SECONDS: f32 = 0.25;

/// The value of control `index`: clamped to its range, or its default when
/// the host gave none or something that is not a number.
fn value(controls: &[f32], index: usize) -> f32 {
    let Some(control) = CONTROLS.get(index) else {
        return 0.0;
    };
    match controls.get(index) {
        Some(value) if value.is_finite() => value.clamp(control.minimum, control.maximum),
        _ => control.default,
    }
}

/// A whole-numbered choice from control `index`.
fn choice(controls: &[f32], index: usize) -> usize {
    value(controls, index).round().max(0.0) as usize
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum State {
    Awake,
    /// Clearing its memory, one buffer per tick.
    Clearing(usize),
    Asleep,
}

/// An engine with its input send and its sleep state.
#[derive(Debug)]
struct Slot<E> {
    engine: E,
    /// Fades the input in when the engine's mode is chosen and out when it is left.
    send: Glide,
    state: State,
    quiet: usize,
    /// Samples of silence after which the engine holds nothing audible.
    patience: usize,
    settings: Option<(Settings, bool)>,
}

impl<E: Engine> Slot<E> {
    fn new(engine: E, sample_rate: f32, patience_seconds: f32) -> Self {
        Self {
            engine,
            send: Glide::new(sample_rate, 12.0, 0.0),
            state: State::Asleep,
            quiet: 0,
            patience: (patience_seconds * sample_rate) as usize,
            settings: None,
        }
    }

    fn reset(&mut self) {
        self.engine.reset();
        self.state = State::Asleep;
        self.quiet = 0;
    }

    fn tick(&mut self, settings: &Settings, active: bool, snap: bool) {
        self.send.drive(if active { 1.0 } else { 0.0 }, snap);
        self.settings = Some((*settings, active));
        match self.state {
            State::Awake => self.engine.tick(settings, active, snap),
            State::Clearing(step) => {
                self.state = if self.engine.clear_step(step) {
                    State::Asleep
                } else {
                    State::Clearing(step + 1)
                };
            }
            State::Asleep => {}
        }
    }

    /// Runs one stretch of at most `TICK` samples of the shared input.
    fn run(&mut self, pre_l: &[f32], pre_r: &[f32], wet_l: &mut [f32], wet_r: &mut [f32]) {
        let (mut in_l, mut in_r) = ([0.0_f32; TICK], [0.0_f32; TICK]);
        let mut loudest = 0.0_f32;
        let mut frames = 0;
        let sends = in_l.iter_mut().zip(in_r.iter_mut());
        for ((left, right), (&l, &r)) in sends.zip(pre_l.iter().zip(pre_r)) {
            let send = self.send.next();
            *left = l * send;
            *right = r * send;
            loudest = loudest.max(left.abs()).max(right.abs());
            frames += 1;
        }
        if self.state != State::Awake {
            if loudest < SILENCE {
                return;
            }
            // Sound arrives: finish clearing if need be, then start from the
            // current settings with nothing to glide from.
            if let State::Clearing(mut step) = self.state {
                while !self.engine.clear_step(step) {
                    step += 1;
                }
            }
            if let Some((settings, active)) = self.settings {
                self.engine.tick(&settings, active, true);
            }
            self.state = State::Awake;
            self.quiet = 0;
        }
        let (Some(in_l), Some(in_r)) = (in_l.get(..frames), in_r.get(..frames)) else {
            return;
        };
        let level = self.engine.process(in_l, in_r, wet_l, wet_r);
        if level.max(loudest) < SILENCE {
            self.quiet = self.quiet.saturating_add(frames);
            if self.quiet > self.patience {
                self.state = State::Clearing(0);
            }
        } else if level.is_finite() {
            self.quiet = 0;
        } else {
            // Something went wrong inside: start again from silence.
            self.state = State::Clearing(0);
        }
    }

    fn fault(&mut self) {
        if self.state == State::Awake {
            self.state = State::Clearing(0);
        }
    }
}

/// Which engine plays a mode: 0 network, 1 plate, 2 spring, 3 nonlinear.
fn engine_of(mode: usize) -> usize {
    match mode {
        2 => 1,
        3 => 2,
        7 => 3,
        _ => 0,
    }
}

/// The effect with `N` audio channels (1 = mono, 2 = stereo).
pub struct Bloom<const N: usize> {
    sample_rate: f32,
    primed: bool,
    /// Samples into the current control tick.
    phase: usize,
    /// The newest control values, clamped.
    controls: [f32; CONTROLS.len()],
    decay: Smoothed,
    build: Smoothed,
    tone: Smoothed,
    modulation: Smoothed,
    speed: Smoothed,
    shimmer: Smoothed,
    low_cut: Smoothed,
    low_cut_applied: f32,
    high_pass: [OnePole; 2],
    dry: Glide,
    send: Glide,
    /// Closes the input while Freeze is on.
    gate: Glide,
    pre: [DelayLine; 2],
    pre_taps: [FadingTap; 2],
    network: Slot<Network>,
    plate: Slot<Plate>,
    spring: Slot<Spring>,
    nonlinear: Slot<Nonlinear>,
}

impl<const N: usize> core::fmt::Debug for Bloom<N> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Bloom")
            .field("channels", &N)
            .field("sample_rate", &self.sample_rate)
            .finish_non_exhaustive()
    }
}

impl<const N: usize> Bloom<N> {
    /// One control tick: smooths the controls and hands them to the engines.
    fn tick(&mut self, snap: bool) {
        let c = &self.controls;
        let get = |index: usize| c.get(index).copied().unwrap_or(0.0);
        let mode = choice(c, port::MODE).min(MODES.len() - 1);
        let freeze = if get(port::FREEZE) >= 0.5 { 1.0 } else { 0.0 };

        let mix = 0.01 * get(port::MIX);
        let dry = if mix >= 1.0 {
            0.0
        } else {
            (mix * FRAC_PI_2).cos()
        };
        self.dry.drive(dry, snap);
        self.send.drive((mix * FRAC_PI_2).sin(), snap);
        self.gate.drive(1.0 - freeze, snap);

        let low_cut = follow(&mut self.low_cut, get(port::LOWCUT).max(1.0).ln(), snap);
        if snap || low_cut != self.low_cut_applied {
            self.low_cut_applied = low_cut;
            for filter in &mut self.high_pass {
                filter.set_cutoff(self.sample_rate, low_cut.exp());
            }
        }

        let wanted = (0.001 * get(port::PREDELAY) * self.sample_rate) as usize;
        for (tap, line) in self.pre_taps.iter_mut().zip(&self.pre) {
            tap.drive(wanted.min(line.capacity().saturating_sub(4)), snap);
        }

        let settings = Settings {
            mode,
            decay: follow(&mut self.decay, get(port::DECAY).max(0.01).ln(), snap).exp(),
            size: 0.01 * get(port::SIZE),
            tone: follow(&mut self.tone, 0.01 * get(port::TONE), snap),
            modulation: follow(&mut self.modulation, 0.01 * get(port::MOD), snap),
            speed: follow(&mut self.speed, 0.01 * get(port::SPEED), snap),
            shimmer: follow(&mut self.shimmer, 0.01 * get(port::SHIMMER), snap),
            interval: choice(c, port::INTERVAL),
            shape: choice(c, port::SHAPE),
            build: follow(&mut self.build, get(port::BUILD).max(0.01).ln(), snap).exp(),
            freeze,
        };
        let engine = engine_of(mode);
        self.network.tick(&settings, engine == 0, snap);
        self.plate.tick(&settings, engine == 1, snap);
        self.spring.tick(&settings, engine == 2, snap);
        self.nonlinear.tick(&settings, engine == 3, snap);
    }
}

impl<const N: usize> Plugin for Bloom<N> {
    const CONTROLS: usize = CONTROLS.len();
    const CHANNELS: usize = N;

    fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate.is_finite() {
            sample_rate.clamp(8000.0, 192_000.0)
        } else {
            48_000.0
        };
        let stereo = N == 2;
        let pre = (PREDELAY_SECONDS * rate).ceil() as usize + 8;
        let smoother = |milliseconds: f32| tick_smoother(rate, milliseconds, 0.0);
        Self {
            sample_rate: rate,
            primed: false,
            phase: 0,
            controls: defaults(),
            decay: smoother(40.0),
            build: smoother(40.0),
            tone: smoother(30.0),
            modulation: smoother(30.0),
            speed: smoother(30.0),
            shimmer: smoother(30.0),
            low_cut: smoother(30.0),
            low_cut_applied: 0.0,
            high_pass: [OnePole::default(); 2],
            dry: Glide::new(rate, 15.0, 1.0),
            send: Glide::new(rate, 15.0, 0.0),
            gate: Glide::new(rate, 12.0, 1.0),
            pre: core::array::from_fn(|i| DelayLine::new(if i < N { pre } else { 8 })),
            pre_taps: [FadingTap::new(rate, 0); 2],
            network: Slot::new(Network::new(rate, stereo), rate, 0.75),
            plate: Slot::new(Plate::new(rate, stereo), rate, 0.75),
            spring: Slot::new(Spring::new(rate, stereo), rate, 0.75),
            nonlinear: Slot::new(
                Nonlinear::new(rate, stereo),
                rate,
                nonlinear::LONGEST_SECONDS + 0.5,
            ),
        }
    }

    fn reset(&mut self) {
        self.primed = false;
        self.phase = 0;
        for line in &mut self.pre {
            line.clear();
        }
        for filter in &mut self.high_pass {
            filter.reset(0.0);
        }
        self.network.reset();
        self.plate.reset();
        self.spring.reset();
        self.nonlinear.reset();
    }

    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        for (index, slot) in self.controls.iter_mut().enumerate() {
            *slot = value(controls, index);
        }
        let Some((out_l, rest)) = outputs.split_first_mut() else {
            return;
        };
        let Some(&in_l) = inputs.first() else {
            return;
        };
        let stereo = N == 2 && inputs.len() > 1 && !rest.is_empty();
        let in_r = inputs.get(1).copied().unwrap_or(in_l);
        let mut frames = in_l.len().min(out_l.len()).min(in_r.len());
        let mut no_right: [f32; 0] = [];
        let out_r: &mut [f32] = match rest.first_mut() {
            Some(right) if stereo => {
                frames = frames.min(right.len());
                right
            }
            _ => &mut no_right,
        };

        let mut done = 0;
        while done < frames {
            if self.phase == 0 {
                self.tick(!self.primed);
                self.primed = true;
            }
            let run = (frames - done).min(TICK - self.phase.min(TICK - 1));
            let range = done..done + run;
            let (Some(xl), Some(xr), Some(yl)) = (
                in_l.get(range.clone()),
                in_r.get(range.clone()),
                out_l.get_mut(range.clone()),
            ) else {
                return;
            };

            // The send: Mix, low cut, pre-delay, and the Freeze gate.
            let (mut pre_l, mut pre_r) = ([0.0_f32; TICK], [0.0_f32; TICK]);
            let (mut dry_l, mut dry_r) = ([0.0_f32; TICK], [0.0_f32; TICK]);
            for (j, (&left, &right)) in xl.iter().zip(xr).enumerate() {
                let left = if left.is_finite() { left } else { 0.0 };
                let right = if right.is_finite() { right } else { 0.0 };
                let (dry, send, gate) = (self.dry.next(), self.send.next(), self.gate.next());
                let sides = self
                    .high_pass
                    .iter_mut()
                    .zip(&mut self.pre)
                    .zip(&mut self.pre_taps);
                let mut sent = [0.0_f32; 2];
                for (((filter, line), tap), (x, kept)) in sides
                    .zip([left, right].into_iter().zip(sent.iter_mut()))
                    .take(N.max(1))
                {
                    line.write(filter.highpass(x * send));
                    *kept = gate * tap.read(line);
                }
                if !stereo {
                    sent[1] = sent[0];
                }
                let mut slots = pre_l
                    .iter_mut()
                    .zip(&mut pre_r)
                    .zip(dry_l.iter_mut().zip(&mut dry_r));
                if let Some(((pl, pr), (dl, dr))) = slots.nth(j) {
                    *pl = sent[0];
                    *pr = sent[1];
                    *dl = dry * left;
                    *dr = dry * right;
                }
            }

            // The engines add their wet signal.
            let (mut wet_l, mut wet_r) = ([0.0_f32; TICK], [0.0_f32; TICK]);
            if let (Some(pl), Some(pr), Some(wl), Some(wr)) = (
                pre_l.get(..run),
                pre_r.get(..run),
                wet_l.get_mut(..run),
                wet_r.get_mut(..run),
            ) {
                self.network.run(pl, pr, wl, wr);
                self.plate.run(pl, pr, wl, wr);
                self.spring.run(pl, pr, wl, wr);
                self.nonlinear.run(pl, pr, wl, wr);
            }

            // Dry plus wet. A wet sample that is not a number is dropped and
            // the engines start again from silence.
            let mut faulted = false;
            for ((y, &dry), wet) in yl.iter_mut().zip(&dry_l).zip(&mut wet_l) {
                if !wet.is_finite() {
                    *wet = 0.0;
                    faulted = true;
                }
                *y = dry + CEILING * oxidal_dsp::soft_clip(*wet * (1.0 / CEILING));
            }
            if let Some(yr) = out_r.get_mut(range) {
                for ((y, &dry), wet) in yr.iter_mut().zip(&dry_r).zip(&mut wet_r) {
                    if !wet.is_finite() {
                        *wet = 0.0;
                        faulted = true;
                    }
                    *y = dry + CEILING * oxidal_dsp::soft_clip(*wet * (1.0 / CEILING));
                }
            }
            if faulted {
                self.network.fault();
                self.plate.fault();
                self.spring.fault();
                self.nonlinear.fault();
            }

            self.phase = (self.phase + run) % TICK;
            done += run;
        }
    }
}

oxidal_lv2_plugin::export!(
    Bloom<1> => c"urn:oxidal:plugin:bloom#mono",
    Bloom<2> => c"urn:oxidal:plugin:bloom#stereo",
);
