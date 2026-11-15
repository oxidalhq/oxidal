//! Times one 96-frame block of every mode of the stereo plugin at 48 kHz on
//! a guitar-like signal, for 20 seconds each, and prints one line per mode:
//! `<mode> median_us <x> p99_us <y> max_us <z>`. Each mode runs at its
//! costliest Shape with full Depth and some Feedback.
//! @see docs/native-motion.md

use core::f32::consts::TAU;
use std::time::Instant;

use oxidal_dsp::Noise;
use oxidal_lv2_plugin::Plugin;
use oxidal_motion::{CONTROLS, Mode, Motion};

const RATE: f32 = 48_000.0;
const BLOCK: usize = 96;
const SECONDS: usize = 20;

/// A note plucked twice a second: eight decaying harmonics and a little noise.
fn plucked(frames: usize) -> Vec<f32> {
    let notes = [110.0_f32, 164.8, 220.0, 146.8, 196.0, 329.6];
    let period = (0.5 * RATE) as usize;
    let mut hiss = Noise::new(11);
    (0..frames)
        .map(|i| {
            let note = notes[(i / period) % notes.len()];
            let t = (i % period) as f32 / RATE;
            let mut sample = 0.0;
            for harmonic in 1..=8 {
                let h = harmonic as f32;
                sample +=
                    0.3 / h * (-t * (1.5 + 0.8 * h)).exp() * (TAU * (note * h * t).fract()).sin();
            }
            (t * 400.0).min(1.0) * sample + 0.002 * hiss.next()
        })
        .collect()
}

fn set(controls: &mut [f32], symbol: &str, value: f32) {
    if let Some(index) = CONTROLS.iter().position(|control| control.symbol == symbol) {
        controls[index] = value;
    }
}

fn main() {
    let frames = SECONDS * RATE as usize;
    let left = plucked(frames);
    let right: Vec<f32> = left.iter().map(|x| 0.9 * x).collect();
    let mut out_left = vec![0.0_f32; BLOCK];
    let mut out_right = vec![0.0_f32; BLOCK];
    for mode in Mode::ALL {
        // The costliest variant: three chorus voices, the through-zero
        // flanger, eight phaser stages.
        let shape = match mode {
            Mode::Chorus | Mode::Flanger | Mode::Phaser | Mode::Ring => 2.0,
            _ => 0.0,
        };
        let mut controls: Vec<f32> = CONTROLS.iter().map(|control| control.default).collect();
        set(&mut controls, "mode", mode as usize as f32);
        set(&mut controls, "shape", shape);
        set(&mut controls, "depth", 100.0);
        set(&mut controls, "feedback", 60.0);
        set(&mut controls, "fast", 1.0);
        let mut plugin = Motion::<2>::new(RATE);
        plugin.reset();
        let mut times: Vec<f32> = Vec::with_capacity(frames / BLOCK);
        let mut checksum = 0.0_f32;
        for (left, right) in left.chunks_exact(BLOCK).zip(right.chunks_exact(BLOCK)) {
            let started = Instant::now();
            plugin.process(
                &controls,
                &[left, right],
                &mut [out_left.as_mut_slice(), out_right.as_mut_slice()],
            );
            times.push(started.elapsed().as_secs_f32() * 1.0e6);
            checksum += out_left[0] + out_right[BLOCK - 1];
        }
        times.sort_by(f32::total_cmp);
        let at = |fraction: f32| times[((times.len() - 1) as f32 * fraction) as usize];
        println!(
            "{} median_us {:.2} p99_us {:.2} max_us {:.2}",
            mode.name().to_lowercase(),
            at(0.5),
            at(0.99),
            at(1.0)
        );
        assert!(checksum.is_finite());
    }
    // A change of Mode runs two effects for 40 ms: the costliest pair.
    let mut plugin = Motion::<2>::new(RATE);
    plugin.reset();
    let mut controls: Vec<f32> = CONTROLS.iter().map(|control| control.default).collect();
    set(&mut controls, "shape", 2.0);
    let mut times: Vec<f32> = Vec::with_capacity(frames / BLOCK);
    for (index, (left, right)) in left
        .chunks_exact(BLOCK)
        .zip(right.chunks_exact(BLOCK))
        .enumerate()
    {
        // Chorus and phaser take turns every 30 ms, so a crossfade is always running.
        set(
            &mut controls,
            "mode",
            if (index / 15) % 2 == 0 { 0.0 } else { 2.0 },
        );
        let started = Instant::now();
        plugin.process(
            &controls,
            &[left, right],
            &mut [out_left.as_mut_slice(), out_right.as_mut_slice()],
        );
        times.push(started.elapsed().as_secs_f32() * 1.0e6);
    }
    times.sort_by(f32::total_cmp);
    let at = |fraction: f32| times[((times.len() - 1) as f32 * fraction) as usize];
    println!(
        "switching median_us {:.2} p99_us {:.2} max_us {:.2}",
        at(0.5),
        at(0.99),
        at(1.0)
    );
}
