//! Oxidal Wah: an original, zero-latency resonant wah filter.
//! @see docs/native-wah.md

use oxidal_lv2_plugin::Plugin;

pub const CONTROLS: [&str; 4] = ["position", "resonance", "range", "mix"];

fn value(controls: &[f32], index: usize, default: f32, min: f32, max: f32) -> f32 {
    controls
        .get(index)
        .copied()
        .filter(|value| value.is_finite())
        .unwrap_or(default)
        .clamp(min, max)
}

#[derive(Debug)]
pub struct Wah<const N: usize> {
    low: [f32; 2],
    band: [f32; 2],
}

impl<const N: usize> Plugin for Wah<N> {
    const CONTROLS: usize = CONTROLS.len();
    const CHANNELS: usize = N;

    fn new(_sample_rate: f32) -> Self {
        Self {
            low: [0.0; 2],
            band: [0.0; 2],
        }
    }

    fn reset(&mut self) {
        self.low = [0.0; 2];
        self.band = [0.0; 2];
    }

    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
        let position = value(controls, 0, 50.0, 0.0, 100.0) * 0.01;
        let resonance = value(controls, 1, 45.0, 0.0, 100.0) * 0.01;
        let range = value(controls, 2, 75.0, 0.0, 100.0) * 0.01;
        let mix = value(controls, 3, 100.0, 0.0, 100.0) * 0.01;
        let frequency = 0.015 + position * (0.22 * (0.35 + range * 0.65));
        let feedback = resonance * 3.8;
        for channel in 0..N {
            for (out, sample) in outputs[channel].iter_mut().zip(inputs[channel]) {
                let clean = if sample.is_finite() { *sample } else { 0.0 };
                let high = clean - self.low[channel] - feedback * self.band[channel];
                self.band[channel] += frequency * high;
                self.low[channel] += frequency * self.band[channel];
                let filtered = self.band[channel] * (1.0 + resonance * 2.0);
                *out = (clean * (1.0 - mix) + filtered * mix).clamp(-8.0, 8.0);
            }
        }
    }
}

oxidal_lv2_plugin::export!(
    Wah<1> => c"urn:oxidal:plugin:wah#mono",
    Wah<2> => c"urn:oxidal:plugin:wah#stereo",
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_mix_is_bit_exact_and_filter_stays_bounded() {
        let input = [0.0, 0.25, -0.5, 1.0];
        let mut output = [0.0; 4];
        let mut plugin = Wah::<1>::new(48_000.0);
        plugin.process(&[50.0, 45.0, 75.0, 0.0], &[&input], &mut [&mut output]);
        assert_eq!(output, input);
        plugin.process(&[100.0, 100.0, 100.0, 100.0], &[&input], &mut [&mut output]);
        assert!(
            output
                .iter()
                .all(|value| value.is_finite() && value.abs() <= 8.0)
        );
    }
}
