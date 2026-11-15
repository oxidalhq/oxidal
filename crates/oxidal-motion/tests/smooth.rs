//! Nothing clicks: every continuous control can be swept or thrown from one
//! end to the other while audio runs, and Mode and Shape can change at any
//! moment, without a sample-to-sample step beyond what the effect makes when
//! left alone.
//! @see docs/native-motion.md

mod common;

use common::*;
use oxidal_motion::{CONTROLS, Mode};

const RATE: f32 = 48_000.0;
/// The stated threshold. A change may raise the largest sample-to-sample step
/// by at most 30 % over the larger of the two steady states it moves between,
/// plus 0.002 of full scale (-54 dB). The test tone, 55 Hz at half scale,
/// steps by 0.0036 a sample on its own, so a click of one hundredth of full
/// scale would fail.
fn allowed(steady: f32) -> f32 {
    1.3 * steady + 0.002
}

fn tone(frames: usize) -> Vec<f32> {
    sine(55.0, 0.5, frames, RATE)
}

/// The largest step on either side of the stereo plugin, after its start.
fn step_of(out: &[Vec<f32>]) -> f32 {
    out.iter()
        .fold(0.0, |step, side| step.max(largest_step(&side[4_800..])))
}

fn steady(controls: &[f32], frames: usize) -> f32 {
    let input = tone(frames);
    step_of(&render(
        &mut plugin::<2>(RATE),
        controls,
        &[input.clone(), input],
        96,
    ))
}

fn sweeps_are_smooth(shape: f32) {
    let frames = 48_000;
    let input = tone(frames);
    for mode in Mode::ALL {
        for name in ["rate", "bpm", "depth", "feedback", "tone", "stereo", "mix"] {
            let control = CONTROLS
                .iter()
                .find(|control| control.symbol == name)
                .unwrap();
            let (low, high) = (control.minimum, control.maximum);
            let sync = if name == "bpm" { 1.0 } else { 0.0 };
            let at = |value: f32| {
                in_mode(
                    mode,
                    &[
                        ("shape", shape),
                        ("sync", sync),
                        ("feedback", 50.0),
                        (name, value),
                    ],
                )
            };
            let limit = allowed(steady(&at(low), frames).max(steady(&at(high), frames)));
            // A ramp over a quarter second in 2 ms steps (as a scene makes), a
            // jump up and a jump down (as a switch or a MIDI message makes).
            let moves: [&dyn Fn(f32) -> f32; 3] = [
                &|seconds| low + (high - low) * ((seconds - 0.4) / 0.25).clamp(0.0, 1.0),
                &|seconds| if seconds < 0.5 { low } else { high },
                &|seconds| if seconds < 0.5 { high } else { low },
            ];
            for (index, value_at) in moves.iter().enumerate() {
                let out = render_with(
                    &mut plugin::<2>(RATE),
                    &[input.clone(), input.clone()],
                    96,
                    |frame| at(value_at(frame as f32 / RATE)),
                );
                let step = step_of(&out);
                assert!(
                    step <= limit,
                    "{} shape {shape}: {name} move {index} steps by {step}, allowed {limit}",
                    mode.name()
                );
            }
        }
    }
}

#[test]
fn every_continuous_control_sweeps_without_a_click_shape_a() {
    sweeps_are_smooth(0.0);
}

#[test]
fn every_continuous_control_sweeps_without_a_click_shape_b() {
    sweeps_are_smooth(1.0);
}

#[test]
fn every_continuous_control_sweeps_without_a_click_shape_c() {
    sweeps_are_smooth(2.0);
}

#[test]
fn sync_division_and_fast_switch_without_a_click() {
    let frames = 48_000;
    let input = tone(frames);
    for mode in Mode::ALL {
        for (name, low, high) in [
            ("sync", 0.0, 1.0),
            ("division", 0.0, 12.0),
            ("fast", 0.0, 1.0),
        ] {
            let at = |value: f32| {
                in_mode(
                    mode,
                    &[
                        ("sync", if name == "division" { 1.0 } else { 0.0 }),
                        (name, value),
                    ],
                )
            };
            let limit = allowed(steady(&at(low), frames).max(steady(&at(high), frames)));
            for flip in [false, true] {
                let out = render_with(
                    &mut plugin::<2>(RATE),
                    &[input.clone(), input.clone()],
                    96,
                    |frame| at(if (frame < 24_000) != flip { low } else { high }),
                );
                let step = step_of(&out);
                assert!(
                    step <= limit,
                    "{}: {name} steps by {step}, allowed {limit}",
                    mode.name()
                );
            }
        }
    }
}

/// Switches from one effect to another at three different moments.
fn switch_is_smooth(from: (Mode, f32), to: (Mode, f32)) {
    let frames = 28_800;
    let input = tone(frames);
    let before = in_mode(from.0, &[("shape", from.1), ("feedback", 50.0)]);
    let after = in_mode(to.0, &[("shape", to.1), ("feedback", 50.0)]);
    let limit = allowed(steady(&before, frames).max(steady(&after, frames)));
    for at in [14_400, 14_496 + 37, 15_000] {
        let out = render_with(
            &mut plugin::<2>(RATE),
            &[input.clone(), input.clone()],
            96,
            |frame| {
                if frame < at {
                    before.clone()
                } else {
                    after.clone()
                }
            },
        );
        let step = step_of(&out);
        assert!(
            step <= limit,
            "{} {} to {} {} steps by {step}, allowed {limit}",
            from.0.name(),
            from.1,
            to.0.name(),
            to.1
        );
    }
}

#[test]
fn switching_between_any_two_modes_makes_no_step() {
    for from in Mode::ALL {
        for to in Mode::ALL {
            if from != to {
                switch_is_smooth((from, 0.0), (to, 0.0));
            }
        }
    }
}

#[test]
fn switching_shape_and_mode_together_makes_no_step() {
    for (index, from) in Mode::ALL.into_iter().enumerate() {
        for (a, b) in [(0.0, 1.0), (1.0, 2.0), (2.0, 0.0)] {
            switch_is_smooth((from, a), (from, b));
            let to = Mode::ALL[(index + 4) % Mode::ALL.len()];
            switch_is_smooth((from, b), (to, a));
        }
    }
}

#[test]
fn a_switch_during_a_switch_waits_its_turn() {
    // Three changes inside one crossfade: each still fades, none steps.
    let frames = 28_800;
    let input = tone(frames);
    let order = [Mode::Phaser, Mode::Rotary, Mode::Ring, Mode::Chorus];
    let limit = allowed(
        order
            .iter()
            .map(|mode| steady(&in_mode(*mode, &[]), frames))
            .fold(0.0, f32::max),
    );
    let out = render_with(
        &mut plugin::<2>(RATE),
        &[input.clone(), input],
        32,
        |frame| {
            let index = ((frame as i64 - 14_400) / 480 + 1).clamp(0, 3) as usize;
            in_mode(order[index], &[])
        },
    );
    assert!(step_of(&out) <= limit);
}

#[test]
fn a_mode_change_crossfades_over_thirty_to_sixty_milliseconds() {
    // A constant input shows the blend alone: the tremolo at no depth passes
    // 0.5 through, the phaser at an even blend gives 0.707.
    let input = vec![0.5_f32; 48_000];
    let before = in_mode(Mode::Tremolo, &[("depth", 0.0)]);
    let after = in_mode(Mode::Phaser, &[("depth", 0.0)]);
    let out = render_with(&mut plugin::<1>(RATE), &[input], 96, |frame| {
        if frame < 24_000 {
            before.clone()
        } else {
            after.clone()
        }
    })
    .remove(0);
    let (start, end) = (out[23_999], out[47_999]);
    assert!((start - 0.5).abs() < 1e-4 && (end - 0.5 * 2.0_f32.sqrt()).abs() < 1e-3);
    let margin = 0.01 * (end - start).abs();
    let first = 12_000
        + out[12_000..]
            .iter()
            .position(|x| (x - start).abs() > margin)
            .unwrap();
    let last = out.iter().rposition(|x| (x - end).abs() > margin).unwrap();
    let milliseconds = (last - first) as f32 / 48.0;
    assert!(first >= 24_000, "the change began early");
    assert!(
        (30.0..=60.0).contains(&milliseconds),
        "the crossfade took {milliseconds} ms"
    );
}
