//! Times one 96-frame block of every mode on a guitar-like signal.
//! Run with `cargo run --release -p oxidal-bloom --example bloom_bench`.
//! @see docs/native-bloom.md

use oxidal_bloom::{Bloom, MODES, defaults, port};
use oxidal_dsp::Noise;
use oxidal_lv2_plugin::Plugin;
use std::time::Instant;

const RATE: f32 = 48_000.0;
const BLOCK: usize = 96;
const SECONDS: usize = 20;

/// Decaying plucked harmonics, a new note every 1.5 s, plus a little noise.
fn guitar(noise: &mut Noise, frame: usize) -> f32 {
    let period = (1.5 * RATE) as usize;
    let note = [110.0, 146.83, 196.0, 164.81][(frame / period) % 4];
    let t = (frame % period) as f32 / RATE;
    let mut sum = 0.0;
    for harmonic in 1..=8 {
        let h = harmonic as f32;
        let decay = (-t * (1.5 + 0.9 * h)).exp();
        sum += decay / h * (core::f32::consts::TAU * note * h * t).sin();
    }
    0.3 * (t * 400.0).min(1.0) * sum + 0.001 * noise.next()
}

fn main() {
    let blocks = SECONDS * RATE as usize / BLOCK;
    let mut noise = Noise::new(5);
    let signal: Vec<f32> = (0..blocks * BLOCK).map(|i| guitar(&mut noise, i)).collect();
    for (mode, name) in MODES.iter().enumerate() {
        let mut plugin = Bloom::<2>::new(RATE);
        plugin.reset();
        let mut controls = defaults();
        controls[port::MODE] = mode as f32;
        controls[port::SHIMMER] = 100.0;
        controls[port::MOD] = 100.0;
        let (mut left, mut right) = ([0.0_f32; BLOCK], [0.0_f32; BLOCK]);
        let mut times: Vec<f64> = Vec::with_capacity(blocks);
        for block in signal.chunks_exact(BLOCK) {
            let start = Instant::now();
            {
                let mut outs: [&mut [f32]; 2] = [&mut left, &mut right];
                plugin.process(&controls, &[block, block], &mut outs);
            }
            times.push(start.elapsed().as_secs_f64() * 1.0e6);
            std::hint::black_box((&left, &right));
        }
        times.sort_by(f64::total_cmp);
        let at = |fraction: f64| times[((times.len() - 1) as f64 * fraction) as usize];
        println!(
            "{} median_us {:.1} p99_us {:.1} max_us {:.1}",
            name.to_lowercase(),
            at(0.5),
            at(0.99),
            at(1.0)
        );
    }
}
