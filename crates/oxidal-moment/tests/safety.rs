//! Oxidal Moment stays silent, exact, bounded and independent of the block
//! size, at every setting.
//! @see docs/native-moment.md

mod common;

use common::*;
use oxidal_moment::controls::{self, CONTROLS};

/// No output sample may pass this with an input up to full scale: every
/// memory is limited to full scale, and the taps, the loop and the dry signal
/// add on top.
const BOUND: f32 = 8.0;

#[test]
fn silence_in_gives_silence_out_from_the_first_sample() {
    for loop_mode in 0..3 {
        for wet_mode in 0..3 {
            let mut rig = Rig::<2>::new();
            rig.set(controls::LOOP_MODE, loop_mode as f32)
                .set(controls::WET_MODE, wet_mode as f32)
                .set(controls::CATCH, 1.0)
                .set(controls::CLOCK, 50.0);
            for side in rig.run(&silence(0.5)) {
                assert_eq!(peak(&side), 0.0, "{loop_mode} {wet_mode}");
            }
        }
    }
}

#[test]
fn mix_zero_is_the_exact_dry_signal() {
    for clock in [100.0, 50.0, 0.0] {
        let mut rig = Rig::<2>::new();
        rig.set(controls::MIX, 0.0).set(controls::CLOCK, clock);
        let input = noise(3, 0.5, samples(0.5));
        for side in rig.run(&input) {
            assert_eq!(side, input, "Clock {clock}");
        }
    }
}

#[test]
fn the_tail_ends_after_the_input_does() {
    for wet_mode in 0..3 {
        let mut rig = Rig::<1>::new();
        rig.wet_only(wet_mode as f32)
            .set(controls::SHAPE, 50.0)
            .set(controls::TIME, 20.0);
        rig.run(&noise(9, 0.3, samples(0.3)));
        rig.listen(12.0);
        assert!(peak(&rig.listen(0.5)) < 1.0e-3, "mode {wet_mode}");
    }
}

#[test]
fn output_stays_bounded_at_every_extreme() {
    let input = noise(5, 1.0, samples(1.5));
    for loop_mode in 0..3 {
        for wet_mode in 0..3 {
            for clock in [100.0, 0.0] {
                let mut rig = Rig::<2>::new();
                rig.set(controls::LOOP_MODE, loop_mode as f32)
                    .set(controls::WET_MODE, wet_mode as f32)
                    .set(controls::CLOCK, clock)
                    .set(controls::SHAPE, 100.0)
                    .set(controls::TIME, 100.0)
                    .set(controls::WIDTH, 100.0)
                    .set(controls::DIRECT, 100.0)
                    .set(controls::TONE, 100.0)
                    .set(controls::LENGTH, 0.0);
                rig.run(&input);
                rig.set(controls::CATCH, 1.0)
                    .set(controls::OVERDUB, 1.0)
                    .set(controls::FREEZE, 1.0);
                for side in rig.run(&input) {
                    assert!(side.iter().all(|x| x.is_finite()));
                    assert!(peak(&side) < BOUND, "{loop_mode} {wet_mode} {clock}");
                }
            }
        }
    }
}

#[test]
fn wild_input_and_wild_controls_never_give_a_bad_sample() {
    let mut rig = Rig::<2>::new();
    let mut input = noise(7, 1.0, samples(0.3));
    for (index, x) in input.iter_mut().enumerate() {
        *x = match index % 97 {
            0 => f32::NAN,
            1 => f32::INFINITY,
            2 => f32::NEG_INFINITY,
            3 => 1.0e30,
            _ => *x,
        };
    }
    for wild in [f32::NAN, f32::INFINITY, -1.0e30, 1.0e30, 0.0] {
        rig.controls = [wild; CONTROLS.len()];
        for side in rig.run(&input) {
            assert!(side.iter().all(|x| x.is_finite()), "{wild}");
        }
    }
}

#[test]
fn moving_every_control_at_once_stays_bounded() {
    let mut rig = Rig::<2>::new();
    let input = noise(21, 0.5, samples(0.05));
    let mut values = noise(77, 1.0, CONTROLS.len() * 200).into_iter();
    for _ in 0..200 {
        for (index, control) in CONTROLS.iter().enumerate() {
            let share = 0.5 * (values.next().unwrap_or(0.0) + 1.0);
            rig.controls[index] = control.minimum + share * (control.maximum - control.minimum);
        }
        rig.controls[controls::MIX] = 50.0;
        for side in rig.run(&input) {
            assert!(side.iter().all(|x| x.is_finite()));
            assert!(peak(&side) < BOUND);
        }
    }
}

#[test]
fn the_block_size_does_not_change_the_sound() {
    let input = noise(13, 0.4, samples(1.0));
    let run = |block: usize| {
        let mut rig = Rig::<2>::new();
        rig.block = block;
        rig.set(controls::WET_MODE, 1.0)
            .set(controls::TIME, 20.0)
            .set(controls::SHAPE, 60.0)
            .set(controls::CLOCK, 50.0);
        rig.run(&input)
    };
    let reference = run(96);
    for block in [17, 48, 256, 1024] {
        assert_eq!(run(block), reference, "block {block}");
    }
}

#[test]
fn mono_and_stereo_plugins_sound_the_same_on_a_mono_signal() {
    let input = noise(31, 0.4, samples(0.5));
    let mut mono = Rig::<1>::new();
    let mut stereo = Rig::<2>::new();
    mono.set(controls::SHAPE, 30.0);
    stereo.set(controls::SHAPE, 30.0);
    let (a, b) = (mono.run(&input), stereo.run(&input));
    assert_eq!(a[0], b[0]);
    assert_eq!(b[0], b[1]);
}
