//! Times one 96-frame block of Oxidal Echo in every mode: stereo plugin,
//! 48 kHz, 20 s of a guitar-like signal, at settings that keep every part of
//! the mode at work. Prints one line per mode.
//! @see docs/native-echo.md

use oxidal_echo::Echo;
use oxidal_echo::controls::{self, Mode};
use oxidal_lv2_plugin::Plugin;
use std::time::Instant;

const RATE: f32 = 48_000.0;
const BLOCK: usize = 96;
const SECONDS: usize = 20;

/// Decaying plucked harmonics, a new note every 0.4 s, plus a little noise.
fn guitar(frames: usize, hertz: f64) -> Vec<f32> {
    let mut state = 22_u32;
    (0..frames)
        .map(|i| {
            let t = (i as f64 / f64::from(RATE)) % 0.4;
            let mut x = 0.0;
            for harmonic in 1..=8 {
                let h = f64::from(harmonic);
                x += (core::f64::consts::TAU * hertz * h * t).sin() / h * (-t * (2.0 + h)).exp();
            }
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let hiss = (state >> 8) as f32 / 8_388_608.0 - 1.0;
            (0.4 * x) as f32 + 0.002 * hiss
        })
        .collect()
}

fn main() {
    let frames = SECONDS * RATE as usize;
    let (left, right) = (guitar(frames, 110.0), guitar(frames, 164.8));
    for (index, mode) in Mode::ALL.iter().enumerate() {
        let mut echo = Echo::<2>::new(RATE);
        echo.reset();
        let mut values = controls::defaults();
        values[controls::MODE] = index as f32;
        values[controls::FEEDBACK] = 70.0;
        values[controls::MOD] = 60.0;
        values[controls::AGE] = 60.0;
        values[controls::SPACING] = 50.0;
        values[controls::WIDTH] = 100.0;
        values[controls::MIX] = 50.0;
        let (mut out_left, mut out_right) = (vec![0.0_f32; BLOCK], vec![0.0_f32; BLOCK]);
        let mut times = Vec::with_capacity(frames / BLOCK);
        let mut sum = 0.0_f64;
        for (l, r) in left.chunks_exact(BLOCK).zip(right.chunks_exact(BLOCK)) {
            let start = Instant::now();
            echo.process(&values, &[l, r], &mut [&mut out_left, &mut out_right]);
            times.push(start.elapsed().as_secs_f64() * 1.0e6);
            sum += f64::from(out_left[0]) + f64::from(out_right[BLOCK - 1]);
        }
        times.sort_by(f64::total_cmp);
        let at = |fraction: f64| {
            let index = ((times.len() - 1) as f64 * fraction) as usize;
            times.get(index).copied().unwrap_or(0.0)
        };
        println!(
            "{} median_us {:.1} p99_us {:.1} max_us {:.1}",
            mode.name().to_lowercase(),
            at(0.5),
            at(0.99),
            at(1.0)
        );
        // Keeps the optimiser from dropping the work.
        assert!(sum.is_finite());
    }
}
