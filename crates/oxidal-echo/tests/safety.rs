//! Oxidal Echo stays silent, bounded, smooth and independent of the block
//! size, in every mode and at every setting.
//! @see docs/native-echo.md

mod common;

use common::*;
use oxidal_echo::controls::{self, CONTROLS, Mode};

/// No output sample may pass this, whatever the input (up to full scale) and
/// the settings: the memory is limited to twice full scale, four heads or a
/// cubic read can add to that, and the dry signal comes on top.
const BOUND: f32 = 6.0;

/// The largest step between two neighbouring output samples that a control
/// change may cause while a 110 Hz sine at half scale plays. The sine alone
/// steps by 0.0072; dry plus repeats at full feedback reach about 0.03. A
/// click from an unsmoothed control or an uncrossfaded mode is 0.1 or more.
const STEP: f32 = 0.05;

fn extreme<const N: usize>(rig: &mut Rig<N>) {
    rig.set(controls::FEEDBACK, 110.0)
        .set(controls::MOD, 100.0)
        .set(controls::AGE, 100.0)
        .set(controls::WIDTH, 100.0)
        .set(controls::SPACING, 100.0)
        .set(controls::MIX, 50.0)
        .set(controls::TIME, 150.0);
}

/// An impulse, then a full-scale tone, then silence.
fn hard_signal(rate: f32, frames: usize) -> Vec<f32> {
    let mut signal = sine(rate, 196.0, 1.0, frames);
    let start = (0.1 * rate) as usize;
    let stop = frames / 2;
    for (i, x) in signal.iter_mut().enumerate() {
        if i < start || i >= stop {
            *x = 0.0;
        }
    }
    signal[0] = 1.0;
    signal
}

#[test]
fn silence_in_gives_silence_out_once_the_tail_has_ended() {
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(48_000.0);
        rig.mode(mode)
            .set(controls::TIME, 30.0)
            .set(controls::FEEDBACK, 30.0)
            .set(controls::MIX, 50.0)
            .set(controls::AGE, 100.0)
            .set(controls::MOD, 100.0);
        // Nothing in, nothing out, from the first sample.
        let quiet = rig.run(&silence(4800));
        assert!(
            quiet.iter().all(|side| side.iter().all(|x| *x == 0.0)),
            "{mode:?}"
        );
        let played = rig.run(&pluck(48_000.0, 196.0, 0.25, 14_400));
        assert!(rms(&played[0]) > 0.01, "{mode:?}");
        let tail = rig.run(&silence(rig.samples(3.5)));
        let start = tail[0].len() - 9600;
        for side in &tail {
            // (Duck, at full depth, holds its short tail down until the
            // follower lets go; the other modes ring on audibly.)
            assert!(
                mode == Mode::Duck || rms(&side[..2400]) > 1.0e-5,
                "{mode:?} has no tail"
            );
            assert!(side[start..].iter().all(|x| *x == 0.0), "{mode:?}");
        }
    }
}

#[test]
fn mix_at_zero_is_exactly_dry_once_the_tail_has_ended() {
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(48_000.0);
        rig.mode(mode)
            .set(controls::TIME, 30.0)
            .set(controls::FEEDBACK, 30.0)
            .set(controls::MIX, 50.0);
        rig.run(&pluck(48_000.0, 196.0, 0.25, 14_400));
        // Mix goes to zero while the echo still rings: the tail carries on.
        rig.set(controls::MIX, 0.0);
        let left = pluck(48_000.0, 247.0, 0.3, rig.samples(3.5));
        let right = noise(5, 0.2, left.len());
        let out = rig.run_sides(&left, &right);
        let early: Vec<f32> = out[0][2400..7200]
            .iter()
            .zip(&left[2400..7200])
            .map(|(y, x)| y - x)
            .collect();
        assert!(rms(&early) > 1.0e-4, "{mode:?}: the tail was cut");
        let start = left.len() - 24_000;
        assert!(out[0][start..] == left[start..], "{mode:?} left");
        assert!(out[1][start..] == right[start..], "{mode:?} right");
    }
    // The mono plugin, with Mix at zero from the start.
    let mut rig = Rig::<1>::new(44_100.0);
    rig.set(controls::MIX, 0.0);
    let input = pluck(44_100.0, 110.0, 0.5, 44_100);
    assert!(rig.run(&input)[0] == input);
}

#[test]
fn every_mode_stays_bounded_at_the_extremes_for_ten_seconds() {
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(48_000.0);
        rig.mode(mode);
        extreme(&mut rig);
        let out = rig.run(&hard_signal(48_000.0, 480_000));
        assert!(all_finite_within(&out, BOUND), "{mode:?}");
        println!(
            "{mode:?}: peak {:.2}, last second rms {:.3}",
            peak(&out[0]),
            rms(&out[0][432_000..])
        );
    }
}

#[test]
fn tone_and_time_extremes_stay_bounded_in_mono() {
    for mode in Mode::ALL {
        for (tone, time) in [(0.0, 20.0), (100.0, 20.0), (0.0, 4000.0), (100.0, 1000.0)] {
            let mut rig = Rig::<1>::new(44_100.0);
            rig.mode(mode);
            extreme(&mut rig);
            rig.set(controls::TONE, tone).set(controls::TIME, time);
            let out = rig.run(&hard_signal(44_100.0, 132_300));
            assert!(all_finite_within(&out, BOUND), "{mode:?} {tone} {time}");
        }
    }
}

/// The full-length version of the test above; about a minute in a debug
/// build, so it runs on request: `cargo test --release -- --ignored`.
#[test]
#[ignore = "long: run with --release -- --ignored"]
fn feedback_at_maximum_stays_bounded_for_sixty_seconds() {
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(48_000.0);
        rig.mode(mode);
        extreme(&mut rig);
        let out = rig.run(&hard_signal(48_000.0, 60 * 48_000));
        assert!(all_finite_within(&out, BOUND), "{mode:?}");
        let last = &out[0][59 * 48_000..];
        println!(
            "{mode:?}: peak {:.2}, rms in the last second {:.3}",
            peak(&out[0]),
            rms(last)
        );
    }
}

#[test]
fn the_block_size_does_not_change_the_sound() {
    let left = pluck(48_000.0, 147.0, 0.3, 36_000);
    let right = pluck(48_000.0, 220.0, 0.4, 36_000);
    for mode in Mode::ALL {
        let mut reference: Option<Vec<Vec<f32>>> = None;
        for block in [96, 1, 32, 1024] {
            let mut rig = Rig::<2>::new(48_000.0);
            rig.block = block;
            rig.mode(mode)
                .set(controls::TIME, 61.0)
                .set(controls::FEEDBACK, 70.0)
                .set(controls::MOD, 60.0)
                .set(controls::AGE, 60.0)
                .set(controls::SPACING, 40.0)
                .set(controls::MIX, 50.0);
            let out = rig.run_sides(&left, &right);
            match &reference {
                None => reference = Some(out),
                Some(expected) => assert!(&out == expected, "{mode:?} at {block} frames"),
            }
        }
    }
}

/// Runs a 110 Hz sine while `change` moves the controls, and returns the
/// largest output step.
fn step_while<const N: usize>(
    rig: &mut Rig<N>,
    seconds: f32,
    change: impl FnMut(usize, &mut [f32; CONTROLS.len()]),
) -> f32 {
    let input = sine(rig.rate, 110.0, 0.5, rig.samples(seconds));
    let out = rig.run_with(&input, &input, change);
    assert!(all_finite_within(&out, BOUND));
    out.iter()
        .map(|side| largest_step(side))
        .fold(0.0, f32::max)
}

#[test]
fn every_continuous_control_can_jump_without_a_click() {
    let swept = [
        controls::TIME,
        controls::BPM,
        controls::FEEDBACK,
        controls::TONE,
        controls::MOD,
        controls::AGE,
        controls::SPACING,
        controls::WIDTH,
        controls::MIX,
    ];
    let mut worst = (0.0_f32, String::new());
    for mode in Mode::ALL {
        for index in swept {
            let mut rig = Rig::<2>::new(48_000.0);
            rig.mode(mode)
                .set(controls::FEEDBACK, 60.0)
                .set(controls::MIX, 50.0)
                .set(controls::TIME, 120.0);
            if index == controls::BPM {
                rig.set(controls::SYNC, 1.0);
            }
            let (low, high) = (CONTROLS[index].minimum, CONTROLS[index].maximum);
            // Bottom to top in one block, back again, then a sweep.
            let step = step_while(&mut rig, 1.6, |at, values| {
                values[index] = match at {
                    0..14_400 => low,
                    14_400..33_600 => high,
                    33_600..48_000 => low,
                    _ => low + (high - low) * (at - 48_000) as f32 / 28_800.0,
                };
            });
            if step > worst.0 {
                worst = (step, format!("{mode:?} {}", CONTROLS[index].symbol));
            }
            assert!(
                step < STEP,
                "{mode:?} {}: step {step}",
                CONTROLS[index].symbol
            );
        }
    }
    println!("largest step {} ({})", worst.0, worst.1);
}

#[test]
fn switching_mode_sync_heads_and_hold_mid_signal_makes_no_click() {
    // Every mode to every other mode, a quarter of a second each.
    let mut order = Vec::new();
    for from in 0..8 {
        for to in 0..8 {
            if from != to {
                order.push(from);
                order.push(to);
            }
        }
    }
    let mut rig = Rig::<2>::new(48_000.0);
    rig.set(controls::FEEDBACK, 70.0)
        .set(controls::MIX, 50.0)
        .set(controls::TIME, 90.0);
    let seconds = order.len() as f32 * 0.25;
    let step = step_while(&mut rig, seconds, |at, values| {
        values[controls::MODE] = order[(at / 12_000).min(order.len() - 1)] as f32;
    });
    println!("mode changes: largest step {step}");
    assert!(step < STEP, "mode change: step {step}");

    for mode in Mode::ALL {
        // Sync on and off (a jump in time), Division, Heads and Hold.
        let mut rig = Rig::<2>::new(48_000.0);
        rig.mode(mode)
            .set(controls::FEEDBACK, 70.0)
            .set(controls::MIX, 50.0);
        let step = step_while(&mut rig, 3.0, |at, values| {
            let phase = at / 9600;
            values[controls::SYNC] = (phase % 2) as f32;
            values[controls::DIVISION] = (phase % 10) as f32;
            values[controls::HEADS] = ((phase * 4) % 15) as f32;
            values[controls::HOLD] = ((phase / 3) % 2) as f32;
        });
        assert!(step < STEP, "{mode:?}: step {step}");
    }
}

#[test]
fn wild_control_values_and_inputs_never_break_it() {
    let wild = [
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        -1.0e30,
        1.0e30,
        -1.0,
        1.0e-30,
        1000.0,
    ];
    let input = noise(3, 1.0, 9600);
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(96_000.0);
        rig.mode(mode);
        let mut pick = 7_u32;
        let out = rig.run_with(&input, &input, |_, values| {
            for (index, value) in values.iter_mut().enumerate() {
                pick = pick.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                if index != controls::MODE || (pick >> 20).is_multiple_of(4) {
                    *value = wild[(pick >> 16) as usize % wild.len()];
                }
            }
        });
        assert!(all_finite_within(&out, BOUND), "{mode:?}");
    }
    // Input that is not a number counts as silence; odd buffers do no harm.
    let mut rig = Rig::<2>::new(48_000.0);
    let mut bad = noise(4, 0.5, 4800);
    bad[10] = f32::NAN;
    bad[11] = f32::INFINITY;
    assert!(all_finite_within(&rig.run(&bad), BOUND));
    use oxidal_lv2_plugin::Plugin;
    let (mut left, mut right) = (vec![0.0_f32; 64], vec![0.0_f32; 32]);
    rig.echo
        .process(&[], &[&bad[..64], &bad[..48]], &mut [&mut left, &mut right]);
    rig.echo.process(&[0.0; 3], &[&bad[..64]], &mut [&mut left]);
    rig.echo.process(&rig.controls, &[], &mut []);
    let (mut none_left, mut none_right): ([f32; 0], [f32; 0]) = ([], []);
    rig.echo.process(
        &rig.controls,
        &[&bad[..0], &bad[..0]],
        &mut [&mut none_left, &mut none_right],
    );
    assert!(left.iter().chain(&right).all(|x| x.is_finite()));
    // An absurd sample rate still builds and runs.
    for rate in [0.0, f32::NAN, 1.0e9] {
        let mut odd = Rig::<1>::new(rate);
        odd.rate = 48_000.0;
        assert!(all_finite_within(&odd.run(&noise(9, 0.5, 2048)), BOUND));
    }
}

#[test]
fn both_plugins_run_at_every_rate() {
    for rate in [44_100.0, 48_000.0, 88_200.0, 96_000.0] {
        for mode in Mode::ALL {
            let input = pluck(rate, 196.0, 0.4, (rate * 0.5) as usize);
            let mut mono = Rig::<1>::new(rate);
            let mut stereo = Rig::<2>::new(rate);
            mono.mode(mode);
            stereo.mode(mode);
            let (one, two) = (mono.run(&input), stereo.run(&input));
            assert_eq!((one.len(), two.len()), (1, 2));
            assert!(all_finite_within(&one, BOUND) && all_finite_within(&two, BOUND));
            assert!(
                rms(&one[0]) > 0.01 && rms(&two[1]) > 0.01,
                "{mode:?} at {rate}"
            );
        }
    }
}
