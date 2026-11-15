//! The control ports of Oxidal Echo and what their values mean.
//!
//! One table describes every control; a unit test compares it with
//! `lv2/echo.ttl`, so the two cannot drift apart.
//! @see docs/native-echo.md

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

pub const MODE: usize = 0;
pub const TIME: usize = 1;
pub const SYNC: usize = 2;
pub const BPM: usize = 3;
pub const DIVISION: usize = 4;
pub const FEEDBACK: usize = 5;
pub const TONE: usize = 6;
pub const MOD: usize = 7;
pub const AGE: usize = 8;
pub const HEADS: usize = 9;
pub const SPACING: usize = 10;
pub const WIDTH: usize = 11;
pub const MIX: usize = 12;
pub const HOLD: usize = 13;

/// Every control, in port order (port index = position in this table).
pub const CONTROLS: [Control; 14] = [
    control("mode", 0.0, 7.0, 0.0),
    control("time", 20.0, 4000.0, 380.0),
    control("sync", 0.0, 1.0, 0.0),
    control("bpm", 40.0, 240.0, 120.0),
    control("division", 0.0, 12.0, 6.0),
    control("feedback", 0.0, 110.0, 35.0),
    control("tone", 0.0, 100.0, 50.0),
    control("mod", 0.0, 100.0, 20.0),
    control("age", 0.0, 100.0, 30.0),
    control("heads", 0.0, 14.0, 14.0),
    control("spacing", 0.0, 100.0, 0.0),
    control("width", 0.0, 100.0, 50.0),
    control("mix", 0.0, 100.0, 20.0),
    control("hold", 0.0, 1.0, 0.0),
];

/// The eight kinds of echo behind the Mode control, in scale-point order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Digital,
    Tape,
    Heads,
    Bucket,
    Reverse,
    Duck,
    Filter,
    Ping,
}

impl Mode {
    pub const ALL: [Mode; 8] = [
        Mode::Digital,
        Mode::Tape,
        Mode::Heads,
        Mode::Bucket,
        Mode::Reverse,
        Mode::Duck,
        Mode::Filter,
        Mode::Ping,
    ];

    /// The label of the scale point in the TTL file.
    pub fn name(self) -> &'static str {
        match self {
            Mode::Digital => "Digital",
            Mode::Tape => "Tape",
            Mode::Heads => "Heads",
            Mode::Bucket => "Bucket",
            Mode::Reverse => "Reverse",
            Mode::Duck => "Duck",
            Mode::Filter => "Filter",
            Mode::Ping => "Ping",
        }
    }

    /// The modes that read the memory through one sliding, pitch-gliding head.
    pub fn slides(self) -> bool {
        matches!(self, Mode::Tape | Mode::Heads | Mode::Bucket)
    }
}

/// Length of each Division scale point in beats (a quarter note is one beat),
/// with its label, in scale-point order: the list every Oxidal effect shares.
pub const DIVISIONS: [(&str, f32); 13] = oxidal_dsp::TEMPO_DIVISIONS;

/// Which of the four playback heads sound for each Heads scale point: bit 0
/// is head 1 (the shortest), bit 3 is head 4 (the longest, at Time).
pub const HEAD_PATTERNS: [(&str, u8); 15] = [
    ("1", 0b0001),
    ("2", 0b0010),
    ("3", 0b0100),
    ("4", 0b1000),
    ("1+2", 0b0011),
    ("1+3", 0b0101),
    ("1+4", 0b1001),
    ("2+3", 0b0110),
    ("2+4", 0b1010),
    ("3+4", 0b1100),
    ("1+2+3", 0b0111),
    ("1+2+4", 0b1011),
    ("1+3+4", 0b1101),
    ("2+3+4", 0b1110),
    ("All", 0b1111),
];

/// The longest delay, and the shortest, in seconds.
pub const MAX_SECONDS: f32 = 4.0;
pub const MIN_SECONDS: f32 = 0.02;

/// The controls of one block, clamped to their ranges and in natural units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Settings {
    pub mode: Mode,
    /// Delay time in seconds, from Time or from BPM and Division.
    pub seconds: f32,
    /// Feedback gain, 0 to 1.1.
    pub feedback: f32,
    /// Tone, Mod, Age, Spacing, Width and Mix as 0 to 1.
    pub tone: f32,
    pub modulation: f32,
    pub age: f32,
    pub spacing: f32,
    pub width: f32,
    pub mix: f32,
    /// Sounding heads, one bit each.
    pub heads: u8,
    pub hold: bool,
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
        let mode = Mode::ALL
            .get(choice(MODE, Mode::ALL.len()))
            .copied()
            .unwrap_or(Mode::Digital);
        let beats = DIVISIONS
            .get(choice(DIVISION, DIVISIONS.len()))
            .map_or(1.0, |division| division.1);
        let heads = HEAD_PATTERNS
            .get(choice(HEADS, HEAD_PATTERNS.len()))
            .map_or(0b1111, |pattern| pattern.1);
        let seconds = if value(SYNC) >= 0.5 {
            beats * 60.0 / value(BPM)
        } else {
            value(TIME) * 0.001
        };
        Self {
            mode,
            seconds: seconds.clamp(MIN_SECONDS, MAX_SECONDS),
            feedback: value(FEEDBACK) * 0.01,
            tone: value(TONE) * 0.01,
            modulation: value(MOD) * 0.01,
            age: value(AGE) * 0.01,
            spacing: value(SPACING) * 0.01,
            width: value(WIDTH) * 0.01,
            mix: value(MIX) * 0.01,
            heads,
            hold: value(HOLD) >= 0.5,
        }
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
    fn divisions_follow_the_tempo() {
        let mut controls = defaults();
        controls[SYNC] = 1.0;
        controls[BPM] = 120.0;
        // Quarter-note lengths at 120 BPM (0.5 s a beat), longest first.
        let expected: [f32; 13] = [
            8.0,
            4.0,
            2.0,
            1.5,
            1.0,
            0.75,
            0.5,
            0.375,
            1.0 / 3.0,
            0.25,
            1.0 / 6.0,
            0.125,
            1.0 / 12.0,
        ];
        for (index, seconds) in expected.iter().enumerate() {
            controls[DIVISION] = index as f32;
            let settings = Settings::from_controls(&controls);
            let seconds = seconds.min(MAX_SECONDS);
            assert!((settings.seconds - seconds).abs() < 1.0e-6, "{index}");
        }
        // A bar at 40 BPM is 6 s: longer than the memory, so it is 4 s.
        controls[DIVISION] = 2.0;
        controls[BPM] = 40.0;
        assert_eq!(Settings::from_controls(&controls).seconds, MAX_SECONDS);
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
            assert!((MIN_SECONDS..=MAX_SECONDS).contains(&settings.seconds));
            assert!((0.0..=1.1).contains(&settings.feedback));
            assert!((0.0..=1.0).contains(&settings.mix));
            assert!(settings.heads != 0 && settings.heads <= 0b1111);
        }
        assert_eq!(Settings::from_controls(&[]), Settings::default());
        assert_eq!(Settings::default().mode, Mode::Digital);
        assert_eq!(Settings::from_controls(&[7.4]).mode, Mode::Ping);
    }

    #[test]
    fn every_head_pattern_is_distinct_and_names_its_heads() {
        for (index, (label, mask)) in HEAD_PATTERNS.iter().enumerate() {
            assert!(*mask != 0 && *mask <= 0b1111);
            assert!(
                HEAD_PATTERNS
                    .iter()
                    .skip(index + 1)
                    .all(|other| other.1 != *mask)
            );
            if *label != "All" {
                let named = label
                    .split('+')
                    .fold(0u8, |bits, head| match head.parse::<u8>() {
                        Ok(n @ 1..=4) => bits | (1 << (n - 1)),
                        _ => bits,
                    });
                assert_eq!(named, *mask, "{label}");
            }
        }
    }
}
