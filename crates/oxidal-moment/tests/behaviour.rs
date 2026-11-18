//! What each control of Oxidal Moment does to the sound.
//! @see docs/native-moment.md

mod common;

use common::*;
use oxidal_moment::controls::{self, TAPE_SPEEDS};
use oxidal_moment::wet;

const TAPE: f32 = 0.0;
const STRETCH: f32 = 1.0;
const TOUCH: f32 = 2.0;
const SMEAR: f32 = 0.0;
const DELAY: f32 = 1.0;
const SLIP: f32 = 2.0;

/// The largest step a control change may cause while a 440 Hz sine at quarter
/// scale plays. The sine alone steps by 0.0144; a click is 0.1 or more.
const STEP: f32 = 0.05;

#[test]
fn catch_keeps_the_most_recent_audio() {
    let mut rig = Rig::<1>::new();
    rig.loop_only().set(controls::LENGTH, 50.0);
    let mut played = sine(220.0, 0.25, 0.3);
    played.extend(sine(880.0, 0.25, 0.3));
    rig.catch(&played);
    let out = rig.listen(0.5);
    assert!(near(frequency(&out), 880.0, 0.03), "{}", frequency(&out));
    assert!(
        near(rms(&out), 0.25 / 2.0_f64.sqrt(), 0.15),
        "{}",
        rms(&out)
    );
}

#[test]
fn letting_go_of_the_loop_goes_back_to_listening() {
    let mut rig = Rig::<1>::new();
    rig.loop_only();
    rig.catch(&sine(440.0, 0.25, 0.3));
    assert!(rms(&rig.listen(0.2)) > 0.1);
    rig.set(controls::CATCH, 0.0);
    rig.listen(0.1);
    assert_eq!(peak(&rig.listen(0.1)), 0.0);
}

#[test]
fn the_join_of_a_loop_does_not_click() {
    let mut rig = Rig::<1>::new();
    rig.loop_only();
    // A length that holds no whole number of cycles.
    rig.catch(&sine(441.3, 0.25, 0.2137));
    assert!(largest_step(&rig.listen(1.0)) < STEP);
}

#[test]
fn tape_plays_at_every_speed_in_both_directions() {
    for (index, speed) in TAPE_SPEEDS.iter().enumerate() {
        let mut rig = Rig::<1>::new();
        rig.loop_only()
            .set(controls::MOVE, index as f32 * 100.0 / 7.0);
        rig.catch(&sine(440.0, 0.25, 0.4));
        let found = frequency(&rig.listen(0.5));
        let expected = 440.0 * f64::from(speed.abs());
        assert!(near(found, expected, 0.03), "{speed}: {found}");
    }
}

#[test]
fn a_lower_clock_plays_a_caught_loop_slower_and_lower() {
    for (clock, ratio) in [(75.0, 2.0), (50.0, 4.0), (25.0, 8.0)] {
        let mut rig = Rig::<1>::new();
        rig.loop_only();
        rig.catch(&sine(440.0, 0.25, 0.4));
        rig.set(controls::CLOCK, clock);
        rig.listen(0.2);
        let found = frequency(&rig.listen(0.5));
        assert!(near(found, 440.0 / ratio, 0.03), "{clock}: {found}");
    }
}

#[test]
fn moving_the_clock_while_a_loop_plays_does_not_click() {
    let mut rig = Rig::<1>::new();
    rig.loop_only();
    rig.catch(&sine(440.0, 0.25, 0.4));
    for clock in [75.0, 50.0, 100.0, 25.0, 87.5, 100.0] {
        rig.set(controls::CLOCK, clock);
        assert!(largest_step(&rig.listen(0.15)) < STEP, "{clock}");
    }
}

#[test]
fn grit_lets_aliases_through_and_clean_clock_keeps_them_out() {
    let run = |grit: f32| {
        let mut rig = Rig::<1>::new();
        rig.wet_only(DELAY)
            .set(controls::SHAPE, 0.0)
            .set(controls::TIME, 0.0)
            .set(controls::CLOCK, 25.0)
            .set(controls::GRIT, grit);
        rig.run(&sine(15_000.0, 0.5, 0.2));
        rig.run(&sine(15_000.0, 0.5, 0.3)).swap_remove(0)
    };
    assert!(rms(&run(0.0)) < 0.1 * rms(&run(100.0)));
}

#[test]
fn stretch_at_the_top_of_move_is_tape_at_normal_speed() {
    let tone = sine(330.0, 0.25, 0.4);
    let mut tape = Rig::<1>::new();
    tape.loop_only().set(controls::LOOP_MODE, TAPE);
    let mut stretch = Rig::<1>::new();
    stretch
        .loop_only()
        .set(controls::LOOP_MODE, STRETCH)
        .set(controls::MOVE, 100.0);
    tape.catch(&tone);
    stretch.catch(&tone);
    let (a, b) = (tape.listen(1.0), stretch.listen(1.0));
    for (x, y) in a.iter().zip(&b) {
        assert!((x - y).abs() < 1.0e-3);
    }
}

#[test]
fn stretch_stops_in_the_middle_of_move_and_runs_backwards_below_it() {
    let mut rig = Rig::<1>::new();
    rig.loop_only()
        .set(controls::LOOP_MODE, STRETCH)
        .set(controls::MOVE, 50.0)
        .set(controls::LENGTH, 20.0);
    rig.catch(&sine(330.0, 0.25, 0.4));
    let start = rig.head();
    let out = rig.listen(0.5);
    assert_eq!(rig.head(), start);
    assert!(rms(&out) > 0.05, "a held slice keeps sounding");

    rig.set(controls::MOVE, 25.0);
    rig.listen(0.05);
    let before = rig.head();
    rig.listen(0.02);
    assert!(rig.head() > before, "backwards is further from the end");
}

#[test]
fn touch_holds_the_slice_only_while_the_input_is_loud() {
    let mut rig = Rig::<1>::new();
    rig.loop_only()
        .set(controls::LOOP_MODE, TOUCH)
        .set(controls::MOVE, 50.0);
    rig.catch(&sine(330.0, 0.25, 0.6));

    let before = rig.head();
    rig.listen(0.05);
    assert!(rig.head() != before, "quiet: the loop plays on");

    rig.run(&sine(220.0, 0.5, 0.05));
    let held = rig.head();
    rig.run(&sine(220.0, 0.5, 0.2));
    assert_eq!(rig.head(), held, "loud: the slice repeats");

    rig.listen(0.4);
    let after = rig.head();
    rig.listen(0.05);
    assert!(rig.head() != after, "quiet again: the loop plays on");
}

#[test]
fn changing_loop_mode_keeps_the_loop_without_a_click() {
    let mut rig = Rig::<1>::new();
    rig.loop_only();
    rig.catch(&sine(440.0, 0.25, 0.4));
    for mode in [STRETCH, TOUCH, TAPE, TOUCH, STRETCH, TAPE] {
        rig.set(controls::LOOP_MODE, mode);
        let out = rig.listen(0.2);
        assert!(rms(&out) > 0.1, "{mode}");
        assert!(largest_step(&out) < STEP, "{mode}");
    }
}

#[test]
fn moving_the_loop_controls_while_a_loop_plays_does_not_click() {
    for mode in [TAPE, STRETCH, TOUCH] {
        let mut rig = Rig::<2>::new();
        rig.loop_only().set(controls::LOOP_MODE, mode);
        rig.catch(&sine(440.0, 0.25, 0.5));
        for (length, movement, width, balance, route, direct) in [
            (45.0, 56.0, 80.0, 30.0, 1.0, 50.0),
            (30.0, 60.0, 100.0, 70.0, 0.0, 0.0),
            (100.0, 71.0, 0.0, 0.0, 2.0, 100.0),
            (60.0, 71.0, 50.0, 40.0, 0.0, 20.0),
        ] {
            rig.set(controls::LENGTH, length)
                .set(controls::MOVE, movement)
                .set(controls::WIDTH, width)
                .set(controls::BALANCE, balance)
                .set(controls::ROUTE, route)
                .set(controls::DIRECT, direct);
            for side in rig.run(&silence(0.3)) {
                assert!(largest_step(&side) < STEP, "{mode} {length}");
            }
        }
    }
}

#[test]
fn overdub_adds_to_the_loop_and_fade_sets_what_stays() {
    let dubbed = |fade: f32| {
        let mut rig = Rig::<1>::new();
        rig.loop_only();
        rig.catch(&sine(220.0, 0.2, 0.25));
        rig.set(controls::OVERDUB, 1.0).set(controls::FADE, fade);
        // Four passes of a new tone.
        rig.run(&sine(880.0, 0.2, 1.0));
        rig.set(controls::OVERDUB, 0.0);
        rig.listen(0.2)
    };
    // Fade 0: each pass replaces the last, so only the new tone is left.
    let replaced = dubbed(0.0);
    assert!(near(frequency(&replaced), 880.0, 0.05));
    assert!(tone_level(&replaced, 220.0) < 0.01);
    // Fade 100: the old tone stays underneath the new one.
    let kept = dubbed(100.0);
    assert!(
        near(tone_level(&kept, 220.0), 0.2, 0.15),
        "{}",
        tone_level(&kept, 220.0)
    );
}

#[test]
fn overdub_at_full_fade_stays_bounded_for_many_passes() {
    let mut rig = Rig::<1>::new();
    rig.loop_only().set(controls::LENGTH, 0.0);
    rig.catch(&sine(220.0, 0.5, 0.25));
    rig.set(controls::OVERDUB, 1.0);
    let out = rig.run(&sine(330.0, 1.0, 3.0)).swap_remove(0);
    assert!(peak(&out) <= 1.1, "{}", peak(&out));
}

#[test]
fn delay_time_is_counted_in_steps_of_the_clock() {
    for (clock, ratio) in [(100.0, 1.0_f32), (75.0, 2.0), (50.0, 4.0)] {
        let mut rig = Rig::<1>::new();
        rig.wet_only(DELAY)
            .set(controls::SHAPE, 0.0)
            .set(controls::TIME, 20.0)
            .set(controls::CLOCK, clock);
        let mut input = silence(0.5);
        input[0] = 0.5;
        let out = rig.run(&input).swap_remove(0);
        let steps = wet::period(oxidal_moment::controls::WetMode::Delay, 0.2, RATE).round();
        let expected = steps * ratio;
        let found = loudest(&out) as f32;
        assert!(
            (found - expected).abs() <= 2.0 + 4.0 * ratio,
            "{clock}: {found}"
        );
    }
}

#[test]
fn delay_at_the_top_of_shape_repeats_without_fading() {
    let mut rig = Rig::<1>::new();
    rig.wet_only(DELAY)
        .set(controls::SHAPE, 100.0)
        .set(controls::TIME, 30.0);
    rig.run(&sine(330.0, 0.25, 0.05));
    let early = rms(&rig.listen(1.0));
    rig.listen(3.0);
    let late = rms(&rig.listen(1.0));
    assert!(near(late, early, 0.05), "{early} {late}");
}

#[test]
fn slip_shifts_by_its_semitone_steps() {
    for (shape, expected) in [(50.0, 220.0), (100.0, 440.0), (75.0, 311.1), (0.0, 440.0)] {
        let mut rig = Rig::<1>::new();
        rig.wet_only(SLIP)
            .set(controls::SHAPE, shape)
            .set(controls::TIME, 60.0);
        rig.run(&sine(220.0, 0.25, 0.3));
        let out = rig.run(&sine(220.0, 0.25, 1.0)).swap_remove(0);
        assert!(
            near(frequency(&out), expected, 0.05),
            "{shape}: {}",
            frequency(&out)
        );
    }
}

#[test]
fn freeze_holds_every_wet_mode_without_growth() {
    for mode in [SMEAR, DELAY, SLIP] {
        let mut rig = Rig::<1>::new();
        rig.wet_only(mode)
            .set(controls::SHAPE, 60.0)
            .set(controls::TIME, 30.0);
        rig.run(&sine(330.0, 0.25, 0.5));
        rig.set(controls::FREEZE, 1.0);
        rig.run(&sine(990.0, 0.25, 0.3));
        let early = rms(&rig.listen(1.0));
        rig.listen(4.0);
        let late = rms(&rig.listen(1.0));
        assert!(early > 0.01, "{mode}: nothing held");
        assert!(late < early * 1.2, "{mode}: {early} grew to {late}");
        assert!(late > early * 0.6, "{mode}: {early} fell to {late}");
    }
}

#[test]
fn moving_the_wet_controls_does_not_click() {
    for mode in [SMEAR, DELAY, SLIP] {
        let mut rig = Rig::<2>::new();
        rig.wet_only(mode).set(controls::TIME, 30.0);
        rig.run(&sine(440.0, 0.1, 0.6));
        let tone = sine(440.0, 0.1, 0.2);
        for (shape, width, freeze) in [
            (95.0, 100.0, 0.0),
            (5.0, 0.0, 0.0),
            (95.0, 100.0, 1.0),
            (5.0, 0.0, 0.0),
        ] {
            rig.set(controls::SHAPE, shape)
                .set(controls::WIDTH, width)
                .set(controls::FREEZE, freeze);
            for side in rig.run(&tone) {
                assert!(largest_step(&side) < STEP, "{mode} {shape} {freeze}");
            }
        }
    }
}

#[test]
fn chance_decides_how_much_enters_the_wet_half() {
    let run = |chance: f32| {
        let mut rig = Rig::<1>::new();
        rig.wet_only(DELAY)
            .set(controls::SHAPE, 0.0)
            .set(controls::TIME, 10.0)
            .set(controls::CHANCE, chance);
        rig.run(&sine(330.0, 0.25, 4.0)).swap_remove(0)
    };
    assert_eq!(peak(&run(0.0)), 0.0);
    let (some, all) = (rms(&run(50.0)), rms(&run(100.0)));
    assert!(some > 0.2 * all && some < 0.9 * all, "{some} {all}");
}

#[test]
fn the_wet_half_is_recorded_while_listening() {
    let caught = |wet_on: f32| {
        let mut rig = Rig::<1>::new();
        rig.loop_only()
            .set(controls::WET, wet_on)
            .set(controls::WET_MODE, DELAY)
            .set(controls::SHAPE, 90.0)
            .set(controls::TIME, 30.0)
            .set(controls::LENGTH, 30.0);
        rig.run(&sine(330.0, 0.25, 0.2));
        // By now only the wet half's repeats are still sounding.
        rig.listen(0.6);
        rig.set(controls::CATCH, 1.0).set(controls::WET, 0.0);
        rig.listen(0.2);
        rms(&rig.listen(0.5))
    };
    assert!(caught(1.0) > 0.01, "the repeats are in the loop");
    assert!(caught(0.0) < 1.0e-4, "nothing was playing");
}

#[test]
fn overdub_records_the_clean_input_and_never_the_wet_half() {
    let dubbed = |wet_on: f32| {
        let mut rig = Rig::<1>::new();
        rig.loop_only();
        rig.catch(&sine(220.0, 0.2, 0.25));
        rig.set(controls::WET, wet_on)
            .set(controls::WET_MODE, DELAY)
            .set(controls::SHAPE, 90.0)
            .set(controls::TIME, 20.0)
            .set(controls::OVERDUB, 1.0);
        rig.run(&sine(880.0, 0.2, 0.5));
        rig.set(controls::OVERDUB, 0.0).set(controls::WET, 0.0);
        // Long enough for the delay's tail to end.
        rig.listen(6.0);
        rig.listen(0.5)
    };
    let (with, without) = (dubbed(1.0), dubbed(0.0));
    assert!(near(rms(&with), rms(&without), 0.05));
}

#[test]
fn route_sends_the_loop_through_the_wet_half_and_direct_keeps_some_clean() {
    let heard = |route: f32, direct: f32| {
        let mut rig = Rig::<1>::new();
        rig.set(controls::MIX, 100.0)
            .set(controls::BALANCE, 0.0)
            .set(controls::ROUTE, route)
            .set(controls::DIRECT, direct);
        rig.catch(&sine(440.0, 0.25, 0.3));
        rig.listen(0.2);
        rms(&rig.listen(0.3))
    };
    // Balance 0 hears only the clean loop.
    assert!(
        heard(0.0, 0.0) > 0.1,
        "Input: the loop is not in the wet half"
    );
    assert!(heard(2.0, 0.0) < 1.0e-3, "Loop: it is all in the wet half");
    assert!(near(heard(2.0, 50.0), 0.5 * heard(0.0, 0.0), 0.1));
}

#[test]
fn link_makes_the_loop_a_whole_number_of_times() {
    let mut rig = Rig::<1>::new();
    rig.loop_only()
        .set(controls::WET_MODE, DELAY)
        .set(controls::TIME, 50.0)
        .set(controls::LINK, 1.0);
    rig.catch(&silence(1.0));
    let period = f64::from(wet::period(
        oxidal_moment::controls::WetMode::Delay,
        0.5,
        RATE,
    ));
    let times = rig.loop_length() / period;
    assert!((times - times.round()).abs() < 1.0e-3, "{times}");
    assert!(times.round() >= 1.0);
}

#[test]
fn link_to_tempo_makes_the_loop_the_division_at_the_bpm() {
    let mut rig = Rig::<1>::new();
    rig.loop_only()
        .set(controls::LINK, 3.0)
        .set(controls::BPM, 120.0)
        .set(controls::DIVISION, 6.0);
    rig.catch(&silence(1.0));
    assert!((rig.loop_length() - 24_000.0).abs() < 1.0, "a beat at 120");
}

#[test]
fn time_can_follow_the_loop() {
    let mut rig = Rig::<1>::new();
    rig.wet_only(DELAY)
        .set(controls::SHAPE, 0.0)
        .set(controls::LINK, 2.0)
        .set(controls::TIME, 100.0);
    rig.catch(&silence(0.5));
    let length = rig.loop_length();
    rig.listen(0.1);
    let mut input = silence(1.0);
    input[0] = 0.5;
    let out = rig.run(&input).swap_remove(0);
    assert!((loudest(&out) as f64 - length).abs() < 3.0, "{length}");
}

#[test]
fn width_zero_keeps_the_stereo_picture() {
    for (mode, wet_mode) in [(TAPE, SMEAR), (STRETCH, DELAY), (TOUCH, SLIP)] {
        let mut rig = Rig::<2>::new();
        rig.set(controls::MIX, 100.0)
            .set(controls::LOOP_MODE, mode)
            .set(controls::WET_MODE, wet_mode)
            .set(controls::WIDTH, 0.0);
        let left = sine(330.0, 0.25, 0.4);
        let right = silence(0.4);
        rig.run_sides(&left, &right);
        rig.set(controls::CATCH, 1.0);
        let out = rig.run_sides(&left, &right);
        assert!(rms(&out[0]) > 0.01, "{mode}");
        assert_eq!(peak(&out[1]), 0.0, "{mode}");
    }
}

#[test]
fn width_turns_one_side_of_a_tape_loop_round() {
    let mut rig = Rig::<2>::new();
    rig.loop_only().set(controls::WIDTH, 100.0);
    let mut chirp = sine(220.0, 0.25, 0.2);
    chirp.extend(sine(880.0, 0.25, 0.2));
    rig.catch(&chirp);
    let out = rig.run(&silence(0.4));
    let difference: Vec<f32> = out[0].iter().zip(&out[1]).map(|(a, b)| a - b).collect();
    assert!(rms(&difference) > 0.05);
}

#[test]
fn width_makes_the_delay_cross_from_side_to_side() {
    let mut rig = Rig::<2>::new();
    rig.wet_only(DELAY)
        .set(controls::SHAPE, 80.0)
        .set(controls::TIME, 20.0)
        .set(controls::WIDTH, 100.0);
    let mut input = silence(0.5);
    input[0] = 0.5;
    let out = rig.run(&input);
    let steps = wet::period(oxidal_moment::controls::WetMode::Delay, 0.2, RATE).round() as usize;
    assert!(out[0][steps].abs() > 0.1, "the first repeat is on the left");
    assert!(out[1][steps].abs() < 1.0e-3);
    assert!(out[1][2 * steps].abs() > 0.05, "the second is on the right");
    assert!(out[0][2 * steps].abs() < 1.0e-3);
}
