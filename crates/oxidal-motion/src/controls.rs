//! The control layout of Oxidal Motion and how raw port values become
//! settings. `lv2/motion.ttl` lists the same controls in the same order; a
//! test compares the two.
//! @see docs/native-motion.md

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

/// Port indexes, in the order of [`CONTROLS`].
pub const MODE: usize = 0;
pub const RATE: usize = 1;
pub const SYNC: usize = 2;
pub const BPM: usize = 3;
pub const DIVISION: usize = 4;
pub const DEPTH: usize = 5;
pub const FEEDBACK: usize = 6;
pub const TONE: usize = 7;
pub const SHAPE: usize = 8;
pub const STEREO: usize = 9;
pub const FAST: usize = 10;
pub const MIX: usize = 11;

/// Every control input, in port order.
pub const CONTROLS: [Control; 12] = [
    control("mode", 0.0, 8.0, 0.0),
    control("rate", 0.05, 12.0, 0.8),
    control("sync", 0.0, 1.0, 0.0),
    control("bpm", 40.0, 240.0, 120.0),
    control("division", 0.0, 11.0, 5.0),
    control("depth", 0.0, 100.0, 50.0),
    control("feedback", -100.0, 100.0, 0.0),
    control("tone", 0.0, 100.0, 50.0),
    control("shape", 0.0, 2.0, 0.0),
    control("stereo", 0.0, 180.0, 90.0),
    control("fast", 0.0, 1.0, 0.0),
    control("mix", 0.0, 100.0, 50.0),
];

/// The nine effects behind the Mode control, in the order of its values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Chorus,
    Flanger,
    Phaser,
    Vibe,
    Rotary,
    Tremolo,
    Harmonic,
    Vibrato,
    Ring,
}

impl Mode {
    pub const ALL: [Mode; 9] = [
        Mode::Chorus,
        Mode::Flanger,
        Mode::Phaser,
        Mode::Vibe,
        Mode::Rotary,
        Mode::Tremolo,
        Mode::Harmonic,
        Mode::Vibrato,
        Mode::Ring,
    ];

    /// The name shown for this mode, as in the TTL scale points.
    pub fn name(self) -> &'static str {
        match self {
            Mode::Chorus => "Chorus",
            Mode::Flanger => "Flanger",
            Mode::Phaser => "Phaser",
            Mode::Vibe => "Vibe",
            Mode::Rotary => "Rotary",
            Mode::Tremolo => "Tremolo",
            Mode::Harmonic => "Harmonic",
            Mode::Vibrato => "Vibrato",
            Mode::Ring => "Ring",
        }
    }
}

/// The note values of the Division control: its name and how many quarter
/// notes one sweep of the oscillator lasts (a bar is four of them).
pub const DIVISIONS: [(&str, f32); 12] = [
    ("4 bars", 16.0),
    ("2 bars", 8.0),
    ("1 bar", 4.0),
    ("1/2", 2.0),
    ("1/4 dotted", 1.5),
    ("1/4", 1.0),
    ("1/8 dotted", 0.75),
    ("1/4 triplet", 2.0 / 3.0),
    ("1/8", 0.5),
    ("1/8 triplet", 1.0 / 3.0),
    ("1/16", 0.25),
    ("1/16 triplet", 1.0 / 6.0),
];

/// The value of control `index` from the host's port values: clamped to its
/// range, and its default when missing or not a number.
fn value(controls: &[f32], index: usize) -> f32 {
    let Some(control) = CONTROLS.get(index) else {
        return 0.0;
    };
    match controls.get(index) {
        Some(raw) if raw.is_finite() => raw.clamp(control.minimum, control.maximum),
        _ => control.default,
    }
}

/// A whole-number control as an index below `count`.
fn choice(controls: &[f32], index: usize, count: usize) -> usize {
    (value(controls, index).round().max(0.0) as usize).min(count.saturating_sub(1))
}

/// The controls in the units the engine works in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Settings {
    pub mode: Mode,
    /// Hertz, 0.05 to 12.
    pub rate: f32,
    pub sync: bool,
    /// Quarter notes a minute, 40 to 240.
    pub bpm: f32,
    /// Index into [`DIVISIONS`].
    pub division: usize,
    /// 0 to 1.
    pub depth: f32,
    /// -1 to 1.
    pub feedback: f32,
    /// 0 to 1.
    pub tone: f32,
    /// 0, 1 or 2 (A, B, C).
    pub shape: usize,
    /// Oscillator offset of the right side in turns, 0 to 0.5.
    pub stereo: f32,
    pub fast: bool,
    /// 0 to 1.
    pub mix: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self::from_controls(&[])
    }
}

impl Settings {
    /// Reads the host's port values. Any float is accepted: values outside a
    /// range are clamped, and one that is missing or not a number takes the
    /// control's default.
    pub fn from_controls(controls: &[f32]) -> Self {
        let mode = Mode::ALL
            .get(choice(controls, MODE, Mode::ALL.len()))
            .copied()
            .unwrap_or(Mode::Chorus);
        Self {
            mode,
            rate: value(controls, RATE),
            sync: value(controls, SYNC) >= 0.5,
            bpm: value(controls, BPM),
            division: choice(controls, DIVISION, DIVISIONS.len()),
            depth: value(controls, DEPTH) * 0.01,
            feedback: value(controls, FEEDBACK) * 0.01,
            tone: value(controls, TONE) * 0.01,
            shape: choice(controls, SHAPE, 3),
            stereo: value(controls, STEREO) / 360.0,
            fast: value(controls, FAST) >= 0.5,
            mix: value(controls, MIX) * 0.01,
        }
    }

    /// The oscillator rate in hertz: Rate, or the Division of the BPM when
    /// Sync is on.
    pub fn oscillator_hertz(&self) -> f32 {
        if self.sync {
            let beats = DIVISIONS
                .get(self.division)
                .map_or(1.0, |(_, beats)| *beats);
            self.bpm / (60.0 * beats)
        } else {
            self.rate
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_come_from_the_table() {
        let settings = Settings::default();
        assert_eq!(settings.mode, Mode::Chorus);
        assert_eq!(settings.rate, 0.8);
        assert!(!settings.sync && !settings.fast);
        assert_eq!(settings.division, 5);
        assert_eq!(
            (settings.depth, settings.mix, settings.tone),
            (0.5, 0.5, 0.5)
        );
        assert_eq!(settings.stereo, 0.25);
    }

    #[test]
    fn any_float_becomes_a_legal_setting() {
        let mut raw = [f32::NAN; 12];
        assert_eq!(Settings::from_controls(&raw), Settings::default());
        raw = [1.0e30; 12];
        let high = Settings::from_controls(&raw);
        assert_eq!(high.mode, Mode::Ring);
        assert_eq!(
            (high.rate, high.bpm, high.division, high.shape),
            (12.0, 240.0, 11, 2)
        );
        assert_eq!(
            (high.depth, high.feedback, high.mix, high.stereo),
            (1.0, 1.0, 1.0, 0.5)
        );
        raw = [-1.0e30; 12];
        let low = Settings::from_controls(&raw);
        assert_eq!(low.mode, Mode::Chorus);
        assert_eq!((low.rate, low.feedback, low.mix), (0.05, -1.0, 0.0));
        raw = [f32::NEG_INFINITY; 12];
        assert_eq!(Settings::from_controls(&raw), Settings::default());
    }

    #[test]
    fn sync_follows_the_tempo() {
        let mut raw: Vec<f32> = CONTROLS.iter().map(|control| control.default).collect();
        raw[SYNC] = 1.0;
        for (index, (name, beats)) in DIVISIONS.iter().enumerate() {
            raw[DIVISION] = index as f32;
            let hertz = Settings::from_controls(&raw).oscillator_hertz();
            assert!((hertz - 2.0 / beats).abs() < 1e-5, "{name} at 120 BPM");
        }
    }
}
