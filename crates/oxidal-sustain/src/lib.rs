//! Oxidal Sustain: Oxidal's own sustainer, as an LV2 effect.
//!
//! With On switched on, every single note keeps sounding at a steady level
//! for as long as it is not muted or replaced. The plugin is a thin shell:
//! it reads the controls, runs one [`engine::Engine`] on the mono sum of its
//! inputs and adds the sustained voice to every channel.
//!
//! # References
//!
//! - Giannoulis, Massberg and Reiss, "Digital Dynamic Range Compressor Design: A Tutorial and Analysis" (2012). <https://aes2.org/publications/elibrary-page/?id=16354>
//!
//! @see docs/native-sustain.md

pub mod chord;
pub mod driver;
pub mod engine;
pub mod pitch;

use engine::{Engine, Mode, Settings};
use oxidal_lv2_plugin::Plugin;

/// One control port: its LV2 symbol and range.
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

/// Port numbers of the controls.
pub mod port {
    pub const ON: usize = 0;
    pub const MODE: usize = 1;
    pub const HARMONIC: usize = 2;
    pub const DRIVE: usize = 3;
    pub const BLOOM: usize = 4;
    pub const SENSITIVITY: usize = 5;
    pub const TONE: usize = 6;
    pub const LEVEL: usize = 7;
    pub const DRY: usize = 8;
}

/// The control ports, in port order; `lv2/sustain.ttl` lists the same.
pub const CONTROLS: [Control; 9] = [
    control("on", 0.0, 1.0, 1.0),
    control("mode", 0.0, 2.0, 0.0),
    control("harmonic", 0.0, 2.0, 0.0),
    control("drive", 0.0, 100.0, 65.0),
    control("bloom", 100.0, 10_000.0, 2000.0),
    control("sensitivity", 0.0, 100.0, 50.0),
    control("tone", 0.0, 100.0, 60.0),
    control("level", -24.0, 6.0, 0.0),
    control("dry", 0.0, 1.0, 1.0),
];

/// The value of control `index`, limited to its range; a missing value or
/// one that is not a number gives the default.
fn value(controls: &[f32], index: usize) -> f32 {
    let Some(control) = CONTROLS.get(index) else {
        return 0.0;
    };
    match controls.get(index) {
        Some(value) if value.is_finite() => value.clamp(control.minimum, control.maximum),
        _ => control.default,
    }
}

/// Reads the control ports into the engine's settings.
pub fn settings(controls: &[f32]) -> Settings {
    Settings {
        on: value(controls, port::ON) >= 0.5,
        mode: match value(controls, port::MODE).round() as i32 {
            1 => Mode::Harmonic,
            2 => Mode::Mix,
            _ => Mode::Normal,
        },
        harmonic: (value(controls, port::HARMONIC).round() as usize).min(2),
        drive: 0.01 * value(controls, port::DRIVE),
        bloom_seconds: 0.001 * value(controls, port::BLOOM),
        sensitivity: 0.01 * value(controls, port::SENSITIVITY),
        tone: 0.01 * value(controls, port::TONE),
        level_db: value(controls, port::LEVEL),
        dry: value(controls, port::DRY) >= 0.5,
    }
}

/// The effect with `N` audio channels (1 = mono, 2 = stereo). The stereo
/// plugin listens to the sum of its inputs, keeps the dry signal in stereo
/// and adds the same sustained voice to both sides.
#[derive(Debug)]
pub struct Sustain<const N: usize> {
    engine: Engine,
}

impl<const N: usize> Sustain<N> {
    /// The engine, for tests and measurements.
    pub fn engine(&self) -> &Engine {
        &self.engine
    }
}

fn finite(x: f32) -> f32 {
    if x.is_finite() { x } else { 0.0 }
}

impl<const N: usize> Plugin for Sustain<N> {
    const CONTROLS: usize = CONTROLS.len();
    const CHANNELS: usize = N;

    fn new(sample_rate: f32) -> Self {
        Self {
            engine: Engine::new(sample_rate),
        }
    }

    fn reset(&mut self) {
        self.engine.reset();
    }

    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        self.engine.configure(settings(controls));
        let (Some(left_in), Some((left_out, more_out))) =
            (inputs.first(), outputs.split_first_mut())
        else {
            return;
        };
        let right_in = inputs.get(1).unwrap_or(left_in);
        let mut right_out = more_out.first_mut();
        for (i, (out, input)) in left_out.iter_mut().zip(left_in.iter()).enumerate() {
            let left = finite(*input);
            let right = right_in.get(i).copied().map_or(left, finite);
            if self.engine.bypassed() {
                *out = left;
                if let Some(slot) = right_out.as_mut().and_then(|side| side.get_mut(i)) {
                    *slot = right;
                }
                continue;
            }
            let (through, voice) = self.engine.step(0.5 * (left + right));
            // With nothing to add, the input passes exactly as it came.
            let untouched = through == 1.0 && voice == 0.0;
            *out = if untouched {
                left
            } else {
                left * through + voice
            };
            if let Some(slot) = right_out.as_mut().and_then(|side| side.get_mut(i)) {
                *slot = if untouched {
                    right
                } else {
                    right * through + voice
                };
            }
        }
    }
}

oxidal_lv2_plugin::export!(
    Sustain<1> => c"urn:oxidal:plugin:sustain#mono",
    Sustain<2> => c"urn:oxidal:plugin:sustain#stereo",
);
