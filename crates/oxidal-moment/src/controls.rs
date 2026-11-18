//! The control ports of Oxidal Moment and what their values mean.
//!
//! One table describes every control; a unit test compares it with
//! `lv2/moment.ttl`, so the two cannot drift apart.
//! @see docs/native-moment.md

/// One control input port.
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

pub const CLOCK: usize = 0;
pub const STEPS: usize = 1;
pub const GRIT: usize = 2;
pub const ROUTE: usize = 3;
pub const BALANCE: usize = 4;
pub const CATCH: usize = 5;
pub const LOOP_MODE: usize = 6;
pub const LENGTH: usize = 7;
pub const MOVE: usize = 8;
pub const OVERDUB: usize = 9;
pub const FADE: usize = 10;
pub const DIRECT: usize = 11;
pub const WET: usize = 12;
pub const WET_MODE: usize = 13;
pub const TIME: usize = 14;
pub const SHAPE: usize = 15;
pub const TONE: usize = 16;
pub const CHANCE: usize = 17;
pub const FREEZE: usize = 18;
pub const LINK: usize = 19;
pub const BPM: usize = 20;
pub const DIVISION: usize = 21;
pub const WIDTH: usize = 22;
pub const MIX: usize = 23;

/// Every control, in port order (port index = position in this table).
pub const CONTROLS: [Control; 24] = [
    control("clock", 0.0, 100.0, 100.0),
    control("steps", 0.0, 1.0, 1.0),
    control("grit", 0.0, 100.0, 0.0),
    control("route", 0.0, 2.0, 1.0),
    control("balance", 0.0, 100.0, 50.0),
    control("catch", 0.0, 1.0, 0.0),
    control("loopmode", 0.0, 2.0, 0.0),
    control("length", 0.0, 100.0, 100.0),
    control("move", 0.0, 100.0, 71.0),
    control("overdub", 0.0, 1.0, 0.0),
    control("fade", 0.0, 100.0, 100.0),
    control("direct", 0.0, 100.0, 0.0),
    control("wet", 0.0, 1.0, 1.0),
    control("wetmode", 0.0, 2.0, 0.0),
    control("time", 0.0, 100.0, 50.0),
    control("shape", 0.0, 100.0, 50.0),
    control("tone", 0.0, 100.0, 70.0),
    control("chance", 0.0, 100.0, 100.0),
    control("freeze", 0.0, 1.0, 0.0),
    control("link", 0.0, 3.0, 0.0),
    control("bpm", 40.0, 240.0, 120.0),
    control("division", 0.0, 12.0, 2.0),
    control("width", 0.0, 100.0, 0.0),
    control("mix", 0.0, 100.0, 50.0),
];

/// What the wet half processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Input,
    Both,
    Loop,
}

impl Route {
    pub const ALL: [Route; 3] = [Route::Input, Route::Both, Route::Loop];

    /// The label of the scale point in the TTL file.
    pub fn name(self) -> &'static str {
        match self {
            Route::Input => "Input",
            Route::Both => "Input and loop",
            Route::Loop => "Loop",
        }
    }
}

/// How a caught loop plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopMode {
    Tape,
    Stretch,
    Touch,
}

impl LoopMode {
    pub const ALL: [LoopMode; 3] = [LoopMode::Tape, LoopMode::Stretch, LoopMode::Touch];

    /// The label of the scale point in the TTL file.
    pub fn name(self) -> &'static str {
        match self {
            LoopMode::Tape => "Tape",
            LoopMode::Stretch => "Stretch",
            LoopMode::Touch => "Touch",
        }
    }
}

/// The live effect of the wet half.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WetMode {
    Smear,
    Delay,
    Slip,
}

impl WetMode {
    pub const ALL: [WetMode; 3] = [WetMode::Smear, WetMode::Delay, WetMode::Slip];

    /// The label of the scale point in the TTL file.
    pub fn name(self) -> &'static str {
        match self {
            WetMode::Smear => "Smear",
            WetMode::Delay => "Delay",
            WetMode::Slip => "Slip",
        }
    }
}

/// How the loop length and the wet Time relate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    Off,
    LoopFollowsTime,
    TimeFollowsLoop,
    Tempo,
}

impl Link {
    pub const ALL: [Link; 4] = [
        Link::Off,
        Link::LoopFollowsTime,
        Link::TimeFollowsLoop,
        Link::Tempo,
    ];

    /// The label of the scale point in the TTL file.
    pub fn name(self) -> &'static str {
        match self {
            Link::Off => "Off",
            Link::LoopFollowsTime => "Loop follows Time",
            Link::TimeFollowsLoop => "Time follows loop",
            Link::Tempo => "Tempo",
        }
    }
}

/// Length of each Division scale point in beats, with its label: the list
/// every Oxidal effect shares.
pub const DIVISIONS: [(&str, f32); 13] = oxidal_dsp::TEMPO_DIVISIONS;

/// With Steps on, how many host samples one engine step lasts: octaves and
/// fifths below the full rate, lowest rate first.
pub const CLOCK_RATIOS: [f32; 9] = [16.0, 12.0, 8.0, 6.0, 4.0, 3.0, 2.0, 1.5, 1.0];

/// The lowest working rate is the full rate divided by this.
pub const LOWEST_RATIO: f32 = 16.0;

/// Tape playback speeds behind the Move control, negative for backwards.
pub const TAPE_SPEEDS: [f32; 8] = [-4.0, -2.0, -1.0, -0.5, 0.5, 1.0, 2.0, 4.0];

/// The fractions of the loop length that Time can take when it follows the
/// loop, Time at its top being the whole loop.
pub const LINK_DIVIDERS: [f32; 6] = [1.0, 2.0, 3.0, 4.0, 6.0, 8.0];

/// The controls of one block, clamped to their ranges and in natural units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Settings {
    /// Host samples per engine step, 1 to [`LOWEST_RATIO`].
    pub ratio: f32,
    pub route: Route,
    pub catch: bool,
    pub loop_mode: LoopMode,
    pub overdub: bool,
    pub wet_on: bool,
    pub wet_mode: WetMode,
    pub freeze: bool,
    pub link: Link,
    pub bpm: f32,
    /// Division in quarter notes.
    pub beats: f32,
    /// Grit, Balance, Length, Move, Fade, Direct, Time, Shape, Tone, Chance,
    /// Width and Mix as 0 to 1.
    pub grit: f32,
    pub balance: f32,
    pub length: f32,
    pub movement: f32,
    pub fade: f32,
    pub direct: f32,
    pub time: f32,
    pub shape: f32,
    pub tone: f32,
    pub chance: f32,
    pub width: f32,
    pub mix: f32,
}

impl Settings {
    /// Reads a block's control values. Any float is accepted: a value outside
    /// its range is clamped, and a missing or non-finite one takes its default.
    pub fn from_controls(controls: &[f32]) -> Self {
        let value = |index: usize| -> f32 {
            let Some(control) = CONTROLS.get(index) else {
                return 0.0;
            };
            match controls.get(index) {
                Some(v) if v.is_finite() => v.clamp(control.minimum, control.maximum),
                _ => control.default,
            }
        };
        let choice = |index: usize, count: usize| -> usize {
            (value(index).round() as usize).min(count.saturating_sub(1))
        };
        let clock = value(CLOCK) * 0.01;
        let ratio = if value(STEPS) >= 0.5 {
            let last = CLOCK_RATIOS.len() - 1;
            let index = (clock * last as f32).round() as usize;
            CLOCK_RATIOS.get(index).copied().unwrap_or(1.0)
        } else {
            LOWEST_RATIO.powf(1.0 - clock)
        };
        Self {
            ratio,
            route: Route::ALL
                .get(choice(ROUTE, Route::ALL.len()))
                .copied()
                .unwrap_or(Route::Both),
            catch: value(CATCH) >= 0.5,
            loop_mode: LoopMode::ALL
                .get(choice(LOOP_MODE, LoopMode::ALL.len()))
                .copied()
                .unwrap_or(LoopMode::Tape),
            overdub: value(OVERDUB) >= 0.5,
            wet_on: value(WET) >= 0.5,
            wet_mode: WetMode::ALL
                .get(choice(WET_MODE, WetMode::ALL.len()))
                .copied()
                .unwrap_or(WetMode::Smear),
            freeze: value(FREEZE) >= 0.5,
            link: Link::ALL
                .get(choice(LINK, Link::ALL.len()))
                .copied()
                .unwrap_or(Link::Off),
            bpm: value(BPM),
            beats: DIVISIONS
                .get(choice(DIVISION, DIVISIONS.len()))
                .map_or(4.0, |division| division.1),
            grit: value(GRIT) * 0.01,
            balance: value(BALANCE) * 0.01,
            length: value(LENGTH) * 0.01,
            movement: value(MOVE) * 0.01,
            fade: value(FADE) * 0.01,
            direct: value(DIRECT) * 0.01,
            time: value(TIME) * 0.01,
            shape: value(SHAPE) * 0.01,
            tone: value(TONE) * 0.01,
            chance: value(CHANCE) * 0.01,
            width: value(WIDTH) * 0.01,
            mix: value(MIX) * 0.01,
        }
    }

    /// The Tape speed that Move selects.
    pub fn tape_speed(&self) -> f32 {
        let last = TAPE_SPEEDS.len() - 1;
        let index = (self.movement * last as f32).round() as usize;
        TAPE_SPEEDS.get(index).copied().unwrap_or(1.0)
    }

    /// The fraction of the loop that Time selects when it follows the loop.
    pub fn link_divider(&self) -> f32 {
        let last = LINK_DIVIDERS.len() - 1;
        let index = ((1.0 - self.time) * last as f32).round() as usize;
        LINK_DIVIDERS.get(index).copied().unwrap_or(1.0)
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self::from_controls(&[])
    }
}

/// The default value of every control, in port order.
pub fn defaults() -> [f32; CONTROLS.len()] {
    CONTROLS.map(|control| control.default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_steps_run_from_the_lowest_rate_to_the_full_rate() {
        let mut controls = defaults();
        controls[CLOCK] = 0.0;
        assert_eq!(Settings::from_controls(&controls).ratio, LOWEST_RATIO);
        controls[CLOCK] = 100.0;
        assert_eq!(Settings::from_controls(&controls).ratio, 1.0);
        // Steps off moves smoothly: halfway is two octaves down.
        controls[STEPS] = 0.0;
        controls[CLOCK] = 50.0;
        assert!((Settings::from_controls(&controls).ratio - 4.0).abs() < 1.0e-4);
    }

    #[test]
    fn the_default_move_is_tape_forwards_at_normal_speed() {
        assert_eq!(Settings::default().tape_speed(), 1.0);
        let mut controls = defaults();
        controls[MOVE] = 0.0;
        assert_eq!(Settings::from_controls(&controls).tape_speed(), -4.0);
        controls[MOVE] = 100.0;
        assert_eq!(Settings::from_controls(&controls).tape_speed(), 4.0);
    }

    #[test]
    fn any_float_is_a_valid_control_value() {
        for wild in [
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
            -1.0e30,
            1.0e30,
            -0.0,
        ] {
            let settings = Settings::from_controls(&[wild; CONTROLS.len()]);
            assert!((1.0..=LOWEST_RATIO).contains(&settings.ratio));
            assert!((0.0..=1.0).contains(&settings.mix));
            assert!((40.0..=240.0).contains(&settings.bpm));
        }
        assert_eq!(Settings::from_controls(&[]), Settings::default());
    }
}
