//! What must hold in every mode at every setting: silence stays silent,
//! output stays finite and bounded, the block size does not matter, Mix at
//! zero is the untouched input, and no control value can break the effect.
//! @see docs/native-motion.md

mod common;

use common::*;
use oxidal_lv2_plugin::Plugin;
use oxidal_motion::{CONTROLS, Mode, Motion};

const RATE: f32 = 48_000.0;
/// No setting may drive the output past this for a full-scale input. The
/// largest values measured are near 3 (flanger at full feedback on its
/// resonance).
const BOUND: f32 = 4.0;

fn programs() -> impl Iterator<Item = (Mode, f32)> {
    Mode::ALL
        .into_iter()
        .flat_map(|mode| [0.0, 1.0, 2.0].map(|shape| (mode, shape)))
}

#[test]
fn silence_in_gives_silence_out_once_the_tail_has_ended() {
    for (mode, shape) in programs() {
        let controls = in_mode(
            mode,
            &[("shape", shape), ("feedback", 70.0), ("depth", 100.0)],
        );
        // From the start: nothing in, exactly nothing out.
        let (left, right) = stereo(RATE, &controls, &silence(24_000));
        assert!(
            left.iter().chain(&right).all(|x| *x == 0.0),
            "{} {shape}",
            mode.name()
        );
        // After a note: the tail ends.
        let mut input = plucked(48_000, RATE);
        input.extend(silence(96_000));
        let (left, right) = stereo(RATE, &controls, &input);
        let tail = peak(&left[120_000..]).max(peak(&right[120_000..]));
        assert!(
            tail < 1.0e-6,
            "{} {shape} still sounds: {tail}",
            mode.name()
        );
    }
}

/// Ten seconds at the extremes: full depth, full feedback, fastest rate.
fn stays_bounded(input: &[f32], feedback: f32) {
    for (mode, shape) in programs() {
        let controls = in_mode(
            mode,
            &[
                ("shape", shape),
                ("rate", 12.0),
                ("depth", 100.0),
                ("feedback", feedback),
                ("tone", 100.0),
                ("stereo", 180.0),
                ("fast", 1.0),
                ("mix", 100.0),
            ],
        );
        let (left, right) = stereo(RATE, &controls, input);
        assert!(
            left.iter().chain(&right).all(|x| x.is_finite()),
            "{} {shape}",
            mode.name()
        );
        let loudest = peak(&left).max(peak(&right));
        assert!(loudest < BOUND, "{} {shape} reached {loudest}", mode.name());
    }
}

#[test]
fn a_loud_sustained_tone_stays_bounded_at_the_extremes_for_ten_seconds() {
    stays_bounded(&sine(440.0, 1.0, 480_000, RATE), 100.0);
}

#[test]
fn an_impulse_stays_bounded_at_the_extremes_for_ten_seconds() {
    let mut input = silence(480_000);
    // After the few milliseconds over which a new effect opens its input.
    input[4_800] = 1.0;
    input[4_801] = -1.0;
    stays_bounded(&input, -100.0);
}

#[test]
fn silence_after_loud_input_decays_and_leaves_no_offset() {
    for (mode, shape) in programs() {
        let controls = in_mode(
            mode,
            &[
                ("shape", shape),
                ("feedback", 100.0),
                ("depth", 100.0),
                ("mix", 100.0),
            ],
        );
        // A full-scale tone with a constant offset on top, then silence.
        let mut input: Vec<f32> = sine(330.0, 0.7, 96_000, RATE)
            .iter()
            .map(|x| x + 0.3)
            .collect();
        input.extend(silence(240_000));
        let out = mono(RATE, &controls, &input);
        assert!(peak(&out) < BOUND, "{} {shape}", mode.name());
        let late = &out[288_000..];
        assert!(
            peak(late) < 1.0e-4,
            "{} {shape} holds {}",
            mode.name(),
            peak(late)
        );
    }
}

#[test]
fn the_block_size_does_not_change_the_output() {
    let input = [plucked(24_000, RATE), noise(0.2, 24_000, 5)];
    for (mode, shape) in programs() {
        let controls = in_mode(mode, &[("shape", shape), ("feedback", 60.0), ("rate", 3.0)]);
        let reference = render(&mut plugin::<2>(RATE), &controls, &input, 96);
        for block in [1, 32, 1024] {
            let other = render(&mut plugin::<2>(RATE), &controls, &input, block);
            assert!(
                other == reference,
                "{} {shape} differs at a block of {block}",
                mode.name()
            );
        }
    }
}

#[test]
fn mix_at_zero_is_the_untouched_input_once_tails_have_ended() {
    for (mode, shape) in programs() {
        let on = in_mode(mode, &[("shape", shape), ("feedback", 80.0)]);
        let off = in_mode(mode, &[("shape", shape), ("feedback", 80.0), ("mix", 0.0)]);
        let input = [plucked(192_000, RATE), noise(0.3, 192_000, 9)];
        // One second with the effect on, then Mix goes to zero.
        let mut motion = plugin::<2>(RATE);
        let out = render_with(&mut motion, &input, 96, |frame| {
            if frame < 48_000 {
                on.clone()
            } else {
                off.clone()
            }
        });
        for (output, input) in out.iter().zip(&input) {
            let same = output[144_000..]
                .iter()
                .zip(&input[144_000..])
                .all(|(a, b)| a.to_bits() == b.to_bits());
            assert!(same, "{} {shape} is not bit-exact dry", mode.name());
        }
        // With Mix at zero from the start, every sample is the input.
        let out = render(&mut plugin::<2>(RATE), &off, &input, 96);
        assert!(
            out[0] == input[0] && out[1] == input[1],
            "{} {shape}",
            mode.name()
        );
    }
}

#[test]
fn turning_mix_down_lets_a_feedback_tail_ring_out() {
    // A flanger at full feedback rings; Mix going to zero closes the send,
    // not the return, so the ringing fades by itself instead of being cut.
    let on = in_mode(
        Mode::Flanger,
        &[
            ("feedback", 100.0),
            ("depth", 0.0),
            ("mix", 100.0),
            ("tone", 100.0),
        ],
    );
    let off = in_mode(
        Mode::Flanger,
        &[
            ("feedback", 100.0),
            ("depth", 0.0),
            ("mix", 0.0),
            ("tone", 100.0),
        ],
    );
    let mut input = sine(577.35, 0.5, 24_000, RATE);
    input.extend(silence(96_000));
    let out = render_with(&mut plugin::<1>(RATE), &[input], 96, |frame| {
        if frame < 24_000 {
            on.clone()
        } else {
            off.clone()
        }
    });
    let just_after = peak(&out[0][24_480..25_440]);
    let later = peak(&out[0][28_800..33_600]);
    let end = peak(&out[0][96_000..]);
    assert!(just_after > 0.05, "the tail was cut: {just_after}");
    assert!(
        later > 1.0e-3 && later < just_after,
        "the tail should fade: {later}"
    );
    assert_eq!(end, 0.0);
}

#[test]
fn no_control_value_and_no_input_value_can_break_it() {
    let frames = 9_600;
    let mut wild = noise(1.0, frames, 3);
    for index in (0..frames).step_by(7) {
        wild[index] = [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -1.0][index % 4];
    }
    let mut picker = oxidal_dsp::Noise::new(77);
    let extremes = [
        -1.0e30_f32,
        1.0e30,
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::MAX,
        f32::MIN,
        -0.0,
        1.0e-30,
    ];
    let mut mono_plugin = plugin::<1>(RATE);
    let mut stereo_plugin = plugin::<2>(RATE);
    for round in 0..200 {
        let controls: Vec<f32> = CONTROLS
            .iter()
            .map(|control| {
                let pick = picker.next();
                if round % 3 == 0 {
                    extremes[((pick.abs() * 97.0) as usize) % extremes.len()]
                } else {
                    control.minimum + (control.maximum - control.minimum) * (1.5 * pick + 0.5)
                }
            })
            .collect();
        let block = [1, 17, 96, 1024][round % 4];
        let input = if round % 2 == 0 {
            wild.clone()
        } else {
            noise(1.0, frames, round as u32 + 1)
        };
        let out = render(
            &mut mono_plugin,
            &controls,
            core::slice::from_ref(&input),
            block,
        );
        assert!(
            out[0].iter().all(|x| x.is_finite() && x.abs() < BOUND),
            "mono, round {round}"
        );
        let out = render(
            &mut stereo_plugin,
            &controls,
            &[input.clone(), input],
            block,
        );
        assert!(
            out.iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() < BOUND),
            "stereo, round {round}"
        );
    }
    // Too few controls, no controls, and blocks of nothing are all accepted.
    let mut output = vec![0.0_f32; 64];
    let input = vec![0.25_f32; 64];
    let mut other = output.clone();
    stereo_plugin.process(
        &[],
        &[input.as_slice(), input.as_slice()],
        &mut [other.as_mut_slice(), output.as_mut_slice()],
    );
    mono_plugin.process(
        &[4.0, 2.0],
        &[input.as_slice()],
        &mut [output.as_mut_slice()],
    );
    mono_plugin.process(&defaults(), &[&[]], &mut [&mut []]);
    mono_plugin.process(&defaults(), &[], &mut []);
    assert!(output.iter().all(|x| x.is_finite()));
}

#[test]
fn every_sample_rate_runs_in_mono_and_stereo() {
    for rate in [44_100.0_f32, 48_000.0, 88_200.0, 96_000.0] {
        let frames = (0.5 * rate) as usize;
        let input = plucked(frames, rate);
        for mode in Mode::ALL {
            let controls = in_mode(mode, &[("feedback", 50.0)]);
            let single = mono(rate, &controls, &input);
            let (left, right) = stereo(rate, &controls, &input);
            for out in [&single, &left, &right] {
                assert!(out.iter().all(|x| x.is_finite()));
                let level = decibels(rms(out) / rms(&input));
                assert!(
                    level.abs() < 6.0,
                    "{} at {rate} Hz: {level} dB",
                    mode.name()
                );
            }
        }
    }
    // A rate nobody should ask for still builds something that runs.
    for rate in [0.0, -1.0, f32::NAN, f32::INFINITY, 1.0e9] {
        let mut odd = Motion::<2>::new(rate);
        odd.reset();
        let out = render(
            &mut odd,
            &defaults(),
            &[plucked(2_000, RATE), plucked(2_000, RATE)],
            96,
        );
        assert!(out.iter().flatten().all(|x| x.is_finite()));
    }
}

#[test]
fn a_reset_starts_again_from_the_same_state() {
    let input = [plucked(24_000, RATE)];
    for mode in Mode::ALL {
        let controls = in_mode(mode, &[("feedback", 60.0)]);
        let mut motion = plugin::<1>(RATE);
        let first = render(&mut motion, &controls, &input, 96);
        motion.reset();
        let second = render(&mut motion, &controls, &input, 96);
        assert!(first == second, "{}", mode.name());
    }
}
