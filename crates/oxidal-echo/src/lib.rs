//! Oxidal Echo: Oxidal's own delay, as an LV2 effect.
//!
//! Eight kinds of echo behind one Mode control (Digital, Tape, Heads, Bucket,
//! Reverse, Duck, Filter, Ping) share one delay memory of 4 s per channel.
//! Original code written from the published descriptions listed in
//! `REFERENCES.md`; it uses the Rust standard library and Oxidal's shared DSP
//! blocks, nothing else.
//!
//! # References
//!
//! - Catmull and Rom, "A Class of Local Interpolating Splines" (1974). <https://doi.org/10.1016/B978-0-12-079050-0.50020-5>
//! - Chowdhury, "Real-Time Physical Modelling for Analog Tape Machines" (2019). <https://dafx.de/paper-archive/details/Z5Ow_E5YHVxvndTAyeEuzA>
//! - Arnardottir, Abel and Smith, a digital model of a tape delay unit, AES 125th Convention paper 7649 (2008).
//! - Raffel and Smith, "Practical Modeling of Bucket-Brigade Device Circuits" (2010). <https://dafx.de/paper-archive/details/JhVfAOFXD1lAtctkMTUODg>
//! - Holters and Parker, "A Combined Model for a Bucket Brigade Device and its Input and Output Filters" (2018). <https://dafx.de/paper-archive/details/KbFTgvcTMmHQ2bHZvOUekw>
//! - Giannoulis, Massberg and Reiss, "Digital Dynamic Range Compressor Design: A Tutorial and Analysis" (2012). <https://aes2.org/publications/elibrary-page/?id=16354>
//! - Haas, "The Influence of a Single Echo on the Audibility of Speech" (1972). <https://aes2.org/publications/elibrary-page/?id=2093>
//! - Dattorro, "Effect Design, Part 2: Delay-Line Modulation and Chorus" (1997). <https://ccrma.stanford.edu/~dattorro/EffectDesignPart2.pdf>
//! - Marsaglia, "Xorshift RNGs" (2003). <https://doi.org/10.18637/jss.v008.i14>
//! - Press et al., "Numerical Recipes: The Art of Scientific Computing" (n.d.). <https://numerical.recipes/>
//!
//! @see docs/native-echo.md

pub mod controls;
pub mod engine;
pub mod parts;
pub mod voice;

pub use controls::{CONTROLS, Control, Mode, Settings};
pub use engine::Engine;

use oxidal_lv2_plugin::Plugin;

/// The effect with `N` audio channels (1 = mono, 2 = stereo).
#[derive(Debug)]
pub struct Echo<const N: usize> {
    engine: Engine<N>,
}

impl<const N: usize> Plugin for Echo<N> {
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
    Echo<1> => c"urn:oxidal:plugin:echo#mono",
    Echo<2> => c"urn:oxidal:plugin:echo#stereo",
);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controls::{DIVISIONS, HEAD_PATTERNS};

    const TTL: &str = include_str!("../lv2/echo.ttl");

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
        let plugins: Vec<&str> = TTL.split("\n<urn:oxidal:plugin:echo#").skip(1).collect();
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
                assert_eq!(
                    number(&text, "lv2:minimum"),
                    control.minimum,
                    "{}",
                    control.symbol
                );
                assert_eq!(
                    number(&text, "lv2:maximum"),
                    control.maximum,
                    "{}",
                    control.symbol
                );
                assert_eq!(
                    number(&text, "lv2:default"),
                    control.default,
                    "{}",
                    control.symbol
                );
            }
            for (offset, symbol) in audio.iter().enumerate() {
                let text = port(plugin, CONTROLS.len() + offset);
                assert!(
                    text.contains(&format!("lv2:symbol \"{symbol}\"")),
                    "{symbol}"
                );
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
            let modes: Vec<String> = Mode::ALL.iter().map(|m| m.name().to_string()).collect();
            assert_eq!(labels(controls::MODE), modes);
            let divisions: Vec<String> = DIVISIONS.iter().map(|d| d.0.to_string()).collect();
            assert_eq!(labels(controls::DIVISION), divisions);
            let heads: Vec<String> = HEAD_PATTERNS.iter().map(|h| h.0.to_string()).collect();
            assert_eq!(labels(controls::HEADS), heads);
        }
    }

    #[test]
    fn both_plugins_are_exported() {
        assert!(!lv2_descriptor(0).is_null() && !lv2_descriptor(1).is_null());
        assert!(lv2_descriptor(2).is_null());
        assert_eq!(<Echo<1> as Plugin>::CONTROLS, 14);
        assert_eq!(<Echo<2> as Plugin>::CHANNELS, 2);
    }
}
