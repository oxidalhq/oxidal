//! Times one 96-frame block of Oxidal Moment in every pairing of loop mode and
//! wet mode: stereo plugin, 48 kHz, full Clock, with a caught loop overdubbing
//! and every part at work. Prints one line per pairing.
//! @see docs/native-moment.md

use oxidal_lv2_plugin::Plugin;
use oxidal_moment::Moment;
use oxidal_moment::controls::{self, LoopMode, WetMode};
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
    for (loop_index, loop_mode) in LoopMode::ALL.iter().enumerate() {
        for (wet_index, wet_mode) in WetMode::ALL.iter().enumerate() {
            let mut moment = Moment::<2>::new(RATE);
            moment.reset();
            let mut values = controls::defaults();
            values[controls::LOOP_MODE] = loop_index as f32;
            values[controls::WET_MODE] = wet_index as f32;
            values[controls::MOVE] = 62.0;
            values[controls::SHAPE] = 80.0;
            values[controls::WIDTH] = 100.0;
            values[controls::DIRECT] = 50.0;
            values[controls::FADE] = 85.0;
            let (mut out_left, mut out_right) = (vec![0.0_f32; BLOCK], vec![0.0_f32; BLOCK]);
            let mut times = Vec::with_capacity(frames / BLOCK);
            let mut sum = 0.0_f64;
            for (block, (l, r)) in left
                .chunks_exact(BLOCK)
                .zip(right.chunks_exact(BLOCK))
                .enumerate()
            {
                // Catch after two seconds, then overdub until the end.
                if block * BLOCK > 2 * RATE as usize {
                    values[controls::CATCH] = 1.0;
                    values[controls::OVERDUB] = 1.0;
                }
                let start = Instant::now();
                moment.process(&values, &[l, r], &mut [&mut out_left, &mut out_right]);
                times.push(start.elapsed().as_secs_f64() * 1.0e6);
                sum += f64::from(out_left[0]) + f64::from(out_right[BLOCK - 1]);
            }
            times.sort_by(f64::total_cmp);
            let at = |fraction: f64| {
                let index = ((times.len() - 1) as f64 * fraction) as usize;
                times.get(index).copied().unwrap_or(0.0)
            };
            println!(
                "{}+{} median_us {:.1} p99_us {:.1} max_us {:.1}",
                loop_mode.name().to_lowercase(),
                wet_mode.name().to_lowercase(),
                at(0.5),
                at(0.99),
                at(1.0)
            );
            // Keeps the optimiser from dropping the work.
            assert!(sum.is_finite());
        }
    }
}
