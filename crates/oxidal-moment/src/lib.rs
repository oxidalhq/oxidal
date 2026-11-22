//! Oxidal Moment: a micro-looper and texture effect, as an LV2 effect.
//!
//! The loop half records all the time, so switching Catch on keeps what was
//! just played, as a loop that plays like tape, stretches into slow slices or
//! sticks on a slice while you play. The wet half is a smeared multi-tap, a
//! clean delay or a sliding pitch shift. The two feed each other, and one
//! Clock sets the working sample rate of both. Original code written from the
//! published descriptions listed in `REFERENCES.md`; it uses the Rust standard
//! library and Oxidal's shared DSP blocks, nothing else.
//!
//! # References
//!
//! - Smith, "Digital Audio Resampling Home Page". <https://ccrma.stanford.edu/~jos/resample/>
//! - Zölzer, "DAFX: Digital Audio Effects, 2nd edition" (2011). <https://doi.org/10.1002/9781119991298>
//! - Roads, "Microsound" (2001; paperback 2004). <https://mitpressbookstore.mit.edu/book/9780262681544>
//! - Smith, "Butterworth Lowpass Design". <https://ccrma.stanford.edu/~jos/filters/Butterworth_Lowpass_Design.html>
//! - Smith, "Overlap-Add (OLA) STFT Processing". <https://ccrma.stanford.edu/~jos/sasp/Overlap_Add_OLA_STFT_Processing.html>
//! - Smith, "Schroeder Allpass Sections". <https://ccrma.stanford.edu/~jos/pasp/Schroeder_Allpass_Sections.html>
//! - Catmull and Rom, "A Class of Local Interpolating Splines" (1974). <https://doi.org/10.1016/B978-0-12-079050-0.50020-5>
//! - Schroeder, "Natural Sounding Artificial Reverberation" (1962). <https://aes2.org/publications/elibrary-page/?id=849>
//! - Dattorro, "Effect Design, Part 1: Reverberator and Other Filters" (1997). <https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf>
//! - Dattorro, "Effect Design, Part 2: Delay-Line Modulation and Chorus" (1997). <https://ccrma.stanford.edu/~dattorro/EffectDesignPart2.pdf>
//! - Giannoulis, Massberg and Reiss, "Digital Dynamic Range Compressor Design: A Tutorial and Analysis" (2012). <https://aes2.org/publications/elibrary-page/?id=16354>
//! - Marsaglia, "Xorshift RNGs" (2003). <https://doi.org/10.18637/jss.v008.i14>
//!
//! @see docs/native-moment.md
// Channels index several arrays at once throughout this effect.
#![allow(clippy::needless_range_loop)]

pub mod clock;
pub mod controls;
pub mod engine;
pub mod looper;
pub mod memory;
pub mod wet;

pub use controls::{CONTROLS, Control, Settings};
pub use engine::Engine;

use oxidal_lv2_plugin::Plugin;

/// The effect with `N` audio channels (1 = mono, 2 = stereo).
#[derive(Debug)]
pub struct Moment<const N: usize> {
    engine: Engine<N>,
}

impl<const N: usize> Moment<N> {
    /// The engine, for the tests.
    pub fn engine(&self) -> &Engine<N> {
        &self.engine
    }
}

impl<const N: usize> Plugin for Moment<N> {
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
        self.engine.set(&Settings::from_controls(controls));
        let frames = inputs
            .iter()
            .map(|input| input.len())
            .chain(outputs.iter().map(|output| output.len()))
            .min()
            .unwrap_or(0);
        for i in 0..frames {
            let mut frame = [0.0_f32; N];
            for (x, input) in frame.iter_mut().zip(inputs) {
                // A sample that is not a number is treated as silence.
                *x = input
                    .get(i)
                    .copied()
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.0);
            }
            let result = self.engine.tick(frame);
            for (output, y) in outputs.iter_mut().zip(result) {
                if let Some(slot) = output.get_mut(i) {
                    *slot = y;
                }
            }
        }
    }
}

oxidal_lv2_plugin::export!(
    Moment<1> => c"urn:oxidal:plugin:moment#mono",
    Moment<2> => c"urn:oxidal:plugin:moment#stereo",
);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controls::{DIVISIONS, Link, LoopMode, Route, WetMode};

    const TTL: &str = include_str!("../lv2/moment.ttl");

    /// The text of the port with this index.
    fn port(plugin: &str, index: usize) -> String {
        let key = format!("lv2:index {index} ;");
        plugin
            .split("\n      [ ")
            .find(|port| port.contains(&key))
            .unwrap_or_else(|| panic!("port {index} is missing"))
            .to_string()
    }

    fn number(port: &str, key: &str) -> f32 {
        let start = port
            .find(key)
            .unwrap_or_else(|| panic!("{key} missing in {port}"))
            + key.len();
        let text: String = port[start..]
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect();
        text.parse()
            .unwrap_or_else(|_| panic!("{key} is not a number"))
    }

    #[test]
    fn the_control_table_matches_the_ttl_file() {
        let plugins: Vec<&str> = TTL.split("\n<urn:oxidal:plugin:moment#").skip(1).collect();
        assert_eq!(plugins.len(), 2);
        for (plugin, (name, audio)) in plugins.iter().zip([
            ("mono", vec!["in_l", "out_l"]),
            ("stereo", vec!["in_l", "in_r", "out_l", "out_r"]),
        ]) {
            assert!(plugin.starts_with(name));
            assert_eq!(
                plugin.matches("lv2:index ").count(),
                CONTROLS.len() + audio.len()
            );
            for (index, control) in CONTROLS.iter().enumerate() {
                let text = port(plugin, index);
                assert!(text.contains("lv2:InputPort, lv2:ControlPort"));
                assert!(
                    text.contains(&format!("lv2:symbol \"{}\"", control.symbol)),
                    "{name} port {index} is not {}",
                    control.symbol
                );
                let group = match index {
                    5..=11 => "loop",
                    12..=18 => "wet",
                    _ => "shared",
                };
                assert!(text.contains(&format!("pg:group moment:{group} ;")));
                assert_eq!(number(&text, "lv2:minimum"), control.minimum);
                assert_eq!(number(&text, "lv2:maximum"), control.maximum);
                assert_eq!(number(&text, "lv2:default"), control.default);
            }
            for (offset, symbol) in audio.iter().enumerate() {
                let text = port(plugin, CONTROLS.len() + offset);
                assert!(text.contains(&format!("lv2:symbol \"{symbol}\"")));
                let direction = if symbol.starts_with("in") {
                    "lv2:InputPort"
                } else {
                    "lv2:OutputPort"
                };
                assert!(text.contains(&format!("a {direction}, lv2:AudioPort")));
            }
            // Every choice has its scale point, in order.
            let labels = |index: usize| -> Vec<String> {
                port(plugin, index)
                    .split("rdfs:label \"")
                    .skip(1)
                    .filter_map(|part| part.split('"').next().map(str::to_string))
                    .collect()
            };
            let names =
                |list: Vec<&str>| -> Vec<String> { list.into_iter().map(str::to_string).collect() };
            assert_eq!(
                labels(controls::ROUTE),
                names(Route::ALL.iter().map(|m| m.name()).collect())
            );
            assert_eq!(
                labels(controls::LOOP_MODE),
                names(LoopMode::ALL.iter().map(|m| m.name()).collect())
            );
            assert_eq!(
                labels(controls::WET_MODE),
                names(WetMode::ALL.iter().map(|m| m.name()).collect())
            );
            assert_eq!(
                labels(controls::LINK),
                names(Link::ALL.iter().map(|m| m.name()).collect())
            );
            assert_eq!(
                labels(controls::DIVISION),
                names(DIVISIONS.iter().map(|d| d.0).collect())
            );
        }
    }

    #[test]
    fn both_plugins_are_exported() {
        assert!(!lv2_descriptor(0).is_null() && !lv2_descriptor(1).is_null());
        assert!(lv2_descriptor(2).is_null());
        assert_eq!(<Moment<1> as Plugin>::CONTROLS, 24);
        assert_eq!(<Moment<2> as Plugin>::CHANNELS, 2);
    }
}
