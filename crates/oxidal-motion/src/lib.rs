//! Oxidal Motion: Oxidal's own modulation effect, as an LV2 effect.
//!
//! Nine effects behind one Mode control: chorus, flanger, phaser, vibe,
//! rotary speaker, tremolo, harmonic tremolo, vibrato and ring modulation.
//! Original code written from the published descriptions listed in
//! `REFERENCES.md`; it uses the Rust standard library and Oxidal's shared
//! blocks only.
//!
//! # References
//!
//! - Dattorro, "Effect Design, Part 2: Delay-Line Modulation and Chorus" (1997). <https://ccrma.stanford.edu/~dattorro/EffectDesignPart2.pdf>
//! - Zölzer, "DAFX: Digital Audio Effects, 2nd edition" (2011). <https://doi.org/10.1002/9781119991298>
//! - Smith, "Physical Audio Signal Processing" (2010). <https://ccrma.stanford.edu/~jos/pasp/>
//! - Smith, Serafin, Abel and Berners, "Doppler Simulation and the Leslie" (2002). <https://ccrma.stanford.edu/~jos/doppler/dafx02.pdf>
//! - Darabundit, Wedelich and Bischoff, "Digital Grey Box Model of the Uni-Vibe Effects Pedal" (2019). <https://dafx.de/paper-archive/details/0S-hk54NkQyPwAQyruZITQ>
//! - Linkwitz, "Active Crossover Networks for Noncoincident Drivers" (1976). <https://aes2.org/publications/elibrary-page/?id=2649>
//!
//! @see docs/native-motion.md

pub mod blocks;
pub mod controls;
pub mod engine;
pub mod voice;

use oxidal_lv2_plugin::Plugin;

pub use controls::{CONTROLS, Control, DIVISIONS, Mode, Settings};
pub use engine::Engine;

/// The effect with `N` audio channels (1 = mono, 2 = stereo).
#[derive(Debug)]
pub struct Motion<const N: usize> {
    engine: Engine,
}

impl<const N: usize> Plugin for Motion<N> {
    const CONTROLS: usize = CONTROLS.len();
    const CHANNELS: usize = N;
    fn new(sample_rate: f32) -> Self {
        Self {
            engine: Engine::new(sample_rate, N),
        }
    }
    fn reset(&mut self) {
        self.engine.reset();
    }
    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        self.engine
            .process(&Settings::from_controls(controls), inputs, outputs);
    }
}

oxidal_lv2_plugin::export!(
    Motion<1> => c"urn:oxidal:plugin:motion#mono",
    Motion<2> => c"urn:oxidal:plugin:motion#stereo",
);
