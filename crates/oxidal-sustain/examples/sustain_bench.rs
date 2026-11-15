//! Times one 96-frame block of the stereo plugin at 48 kHz in every mode,
//! on a guitar-like signal: single plucked notes and a strummed chord every
//! two seconds, with a little noise.
//! @see docs/native-sustain.md

use oxidal_lv2_plugin::Plugin;
use oxidal_sustain::{CONTROLS, Sustain, port};
use std::time::Instant;

const RATE: f32 = 48_000.0;
const BLOCK: usize = 96;
const SECONDS: usize = 20;

/// One plucked string: eight decaying harmonics.
fn pluck(frequency: f32, since: f32) -> f32 {
    let mut x = 0.0;
    for k in 1..=8 {
        let k = k as f32;
        let fade = (-1.5 * (1.0 + 0.25 * (k - 1.0)) * since).exp();
        x += fade * (core::f32::consts::TAU * frequency * k * since + 0.7 * k).sin() / k.powf(1.1);
    }
    0.08 * x
}

fn signal() -> Vec<f32> {
    let notes = [110.0, 196.0, 329.63, 146.83, 82.41];
    let chord = [164.81, 207.65, 246.94];
    let mut noise = 0x9e37_79b9_u32;
    (0..SECONDS * RATE as usize)
        .map(|i| {
            let t = i as f32 / RATE;
            let turn = (t / 2.0) as usize;
            let since = t - 2.0 * turn as f32;
            let played = if turn % 3 == 2 {
                chord.iter().map(|note| pluck(*note, since)).sum::<f32>()
            } else {
                pluck(notes[turn % notes.len()], since)
            };
            noise ^= noise << 13;
            noise ^= noise >> 17;
            noise ^= noise << 5;
            played + (noise as i32) as f32 / 2_147_483_648.0 * 0.0005
        })
        .collect()
}

fn main() {
    let input = signal();
    for (mode, name) in ["normal", "harmonic", "mix"].iter().enumerate() {
        let mut plugin = Sustain::<2>::new(RATE);
        plugin.reset();
        let mut controls = CONTROLS.map(|control| control.default);
        controls[port::MODE] = mode as f32;
        let (mut left, mut right) = (vec![0.0_f32; BLOCK], vec![0.0_f32; BLOCK]);
        let mut times: Vec<f64> = Vec::with_capacity(input.len() / BLOCK);
        for block in input.chunks_exact(BLOCK) {
            let started = Instant::now();
            plugin.process(&controls, &[block, block], &mut [&mut left, &mut right]);
            times.push(started.elapsed().as_secs_f64() * 1.0e6);
            std::hint::black_box((&left, &right));
        }
        times.sort_by(f64::total_cmp);
        let at = |share: f64| times[((times.len() - 1) as f64 * share) as usize];
        println!(
            "{name} median_us {:.1} p99_us {:.1} max_us {:.1}",
            at(0.5),
            at(0.99),
            at(1.0)
        );
    }
}
