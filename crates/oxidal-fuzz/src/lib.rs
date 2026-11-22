//! Oxidal Fuzz: a compact, original waveshaping fuzz for guitar and synth.
//!
//! Drive controls the amount of waveshaping, Tone is a post-fuzz one-pole
//! tilt, and Mix blends the processed signal with the untouched input.
//! @see docs/native-fuzz.md

use oxidal_lv2_plugin::Plugin;

pub const CONTROLS: [&str; 4] = ["drive", "tone", "mix", "level"];

fn value(controls: &[f32], index: usize, default: f32, min: f32, max: f32) -> f32 {
    controls
        .get(index)
        .copied()
        .filter(|value| value.is_finite())
        .unwrap_or(default)
        .clamp(min, max)
}

#[derive(Debug)]
pub struct Fuzz<const N: usize> {
    tone_state: [f32; 2],
}

impl<const N: usize> Plugin for Fuzz<N> {
    const CONTROLS: usize = CONTROLS.len();
    const CHANNELS: usize = N;

    fn new(_sample_rate: f32) -> Self {
        Self {
            tone_state: [0.0; 2],
        }
    }

    fn reset(&mut self) {
        self.tone_state = [0.0; 2];
    }

    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        let drive = value(controls, 0, 55.0, 0.0, 100.0) * 0.08;
        let tone = value(controls, 1, 55.0, 0.0, 100.0) * 0.01;
        let mix = value(controls, 2, 75.0, 0.0, 100.0) * 0.01;
        let level = 10.0_f32.powf(value(controls, 3, 0.0, -24.0, 6.0) / 20.0);
        for channel in 0..N {
            let input = inputs[channel];
            let output = &mut outputs[channel];
            for (out, sample) in output.iter_mut().zip(input) {
                let clean = if sample.is_finite() { *sample } else { 0.0 };
                let shaped = (clean * (1.0 + drive * 8.0)).tanh();
                let bright = shaped * (0.45 + tone * 0.55);
                let filtered =
                    self.tone_state[channel] + tone * (bright - self.tone_state[channel]);
                self.tone_state[channel] = filtered;
                *out = ((clean * (1.0 - mix) + filtered * mix) * level).clamp(-8.0, 8.0);
            }
        }
    }
}

oxidal_lv2_plugin::export!(
    Fuzz<1> => c"urn:oxidal:plugin:fuzz#mono",
    Fuzz<2> => c"urn:oxidal:plugin:fuzz#stereo",
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_mix_is_bit_exact_and_extremes_are_finite() {
        let input = [0.0, 0.25, -0.5, 1.0];
        let mut output = [0.0; 4];
        let mut plugin = Fuzz::<1>::new(48_000.0);
        plugin.process(&[100.0, 0.0, 0.0, 0.0], &[&input], &mut [&mut output]);
        assert_eq!(output, input);
        plugin.process(&[100.0, 100.0, 100.0, 6.0], &[&input], &mut [&mut output]);
        assert!(
            output
                .iter()
                .all(|value| value.is_finite() && value.abs() <= 8.0)
        );
    }
}
