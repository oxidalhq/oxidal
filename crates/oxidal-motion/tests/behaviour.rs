//! What each mode is meant to do, measured from its output: rates and
//! divisions, tremolo depth, the harmonic tremolo's steady level, vibrato
//! pitch, all-pass phasing, flanger comb and through-zero null, chorus voice
//! times, rotary speed ramps, ring carrier, stereo spread and default level.
//! @see docs/native-motion.md

mod common;

use common::*;
use oxidal_motion::{DIVISIONS, Engine, Mode, Settings};

const RATE: f32 = 48_000.0;

/// The repetition rate of a slowly varying measurement given as
/// `(time in samples, value)` points.
fn rate_of(points: &[(f32, f32)], sample_rate: f32) -> f32 {
    let (low, high) = points
        .iter()
        .fold((f32::MAX, f32::MIN), |(low, high), (_, x)| {
            (low.min(*x), high.max(*x))
        });
    let middle = 0.5 * (low + high);
    let crossings: Vec<f32> = points
        .windows(2)
        .filter(|pair| pair[0].1 < middle && pair[1].1 >= middle)
        .map(|pair| {
            pair[0].0 + (pair[1].0 - pair[0].0) * (middle - pair[0].1) / (pair[1].1 - pair[0].1)
        })
        .collect();
    assert!(crossings.len() >= 2, "fewer than two cycles");
    (crossings.len() - 1) as f32 * sample_rate / (crossings[crossings.len() - 1] - crossings[0])
}

/// The tremolo's gain over time: a constant input comes out as the gain.
fn tremolo_gain(sample_rate: f32, changes: &[(&str, f32)], seconds: f32) -> Vec<f32> {
    let input = vec![0.5_f32; (seconds * sample_rate) as usize];
    mono(sample_rate, &in_mode(Mode::Tremolo, changes), &input)
        .iter()
        .map(|x| x / 0.5)
        .collect()
}

fn within(measured: f32, expected: f32, fraction: f32) -> bool {
    (measured - expected).abs() <= fraction * expected.abs()
}

#[test]
fn the_tremolo_rate_matches_the_rate_control_within_two_percent() {
    for hertz in [0.1_f32, 0.5, 0.8, 3.0, 7.3, 12.0] {
        for shape in [0.0, 1.0, 2.0] {
            let gain = tremolo_gain(
                RATE,
                &[("rate", hertz), ("shape", shape), ("depth", 100.0)],
                3.4 / hertz + 0.2,
            );
            let measured = repetition_hertz(&gain[2_400..], RATE);
            assert!(
                within(measured, hertz, 0.02),
                "Rate {hertz} Hz, shape {shape}: measured {measured} Hz"
            );
        }
    }
}

#[test]
fn every_division_matches_its_note_value_at_120_bpm() {
    for (index, (name, beats)) in DIVISIONS.iter().enumerate() {
        // At 120 BPM a quarter note lasts half a second.
        let expected = 1.0 / (0.5 * beats);
        let changes = [
            ("sync", 1.0),
            ("bpm", 120.0),
            ("division", index as f32),
            ("rate", 9.0),
            ("depth", 100.0),
        ];
        let gain = tremolo_gain(RATE, &changes, 3.4 / expected + 0.2);
        let measured = repetition_hertz(&gain[2_400..], RATE);
        assert!(
            within(measured, expected, 0.02),
            "{name}: measured {measured} Hz, expected {expected} Hz"
        );
    }
    // And the tempo scales it: a quarter note at 90 BPM is 1.5 Hz.
    let gain = tremolo_gain(
        RATE,
        &[("sync", 1.0), ("bpm", 90.0), ("division", 6.0)],
        3.0,
    );
    assert!(within(repetition_hertz(&gain[2_400..], RATE), 1.5, 0.02));
}

#[test]
fn the_vibrato_pitch_swings_at_the_rate_and_scales_with_depth() {
    let note = 1_000.0;
    let input = sine(note, 0.5, 96_000, RATE);
    for shape in [0.0, 1.0] {
        let mut swings = Vec::new();
        for depth in [25.0_f32, 50.0, 100.0] {
            let out = mono(
                RATE,
                &in_mode(
                    Mode::Vibrato,
                    &[
                        ("rate", 5.0),
                        ("depth", depth),
                        ("shape", shape),
                        ("tone", 100.0),
                    ],
                ),
                &input,
            );
            let track: Vec<(f32, f32)> = pitch_track(&out[9_600..], RATE);
            let measured = rate_of(&track, RATE);
            assert!(within(measured, 5.0, 0.02), "vibrato rate {measured} Hz");
            let swing = track.iter().fold(0.0_f32, |swing, (_, hertz)| {
                swing.max((hertz / note - 1.0).abs())
            });
            // Full Depth is 60 cents each way: a ratio of 0.0353.
            let expected = 0.035_265 * depth / 100.0;
            assert!(
                within(swing, expected, 0.08),
                "depth {depth}: swing {swing}, expected {expected}"
            );
            swings.push(swing);
        }
        assert!(
            within(swings[1] / swings[0], 2.0, 0.05) && within(swings[2] / swings[1], 2.0, 0.05)
        );
    }
    // No dry signal at the default Mix: with no Depth the note comes out
    // alone, at its own level and pitch.
    let out = mono(
        RATE,
        &in_mode(Mode::Vibrato, &[("depth", 0.0), ("tone", 100.0)]),
        &input,
    );
    assert!(within(rms(&out[9_600..]), rms(&input[9_600..]), 0.02));
}

#[test]
fn tremolo_at_full_depth_reaches_near_silence_at_the_trough() {
    for shape in [0.0, 1.0, 2.0] {
        let gain = tremolo_gain(
            RATE,
            &[("rate", 2.0), ("shape", shape), ("depth", 100.0)],
            2.0,
        );
        let (trough, crest) = gain[4_800..]
            .iter()
            .fold((f32::MAX, 0.0_f32), |(low, high), x| {
                (low.min(*x), high.max(*x))
            });
        assert!(
            trough.abs() < 0.01 * crest,
            "shape {shape}: trough {trough}, crest {crest}"
        );
        // Half depth leaves half the swing; no depth leaves the signal alone.
        let half = tremolo_gain(RATE, &[("rate", 2.0), ("shape", shape)], 2.0);
        let (low, high) = half[4_800..]
            .iter()
            .fold((f32::MAX, 0.0_f32), |(low, high), x| {
                (low.min(*x), high.max(*x))
            });
        assert!(
            within(low / high, 0.5, 0.02),
            "shape {shape}: {low} to {high}"
        );
        let none = tremolo_gain(RATE, &[("shape", shape), ("depth", 0.0)], 0.5);
        assert!(none[4_800..].iter().all(|x| (x - 1.0).abs() < 1e-5));
    }
}

#[test]
fn harmonic_tremolo_keeps_the_level_steadier_while_lows_and_highs_alternate() {
    // A low and a high tone of equal strength, well apart from the crossover.
    let frames = 336_000;
    let (low, high) = (60.0, 6_000.0);
    let input: Vec<f32> = sine(low, 0.3, frames, RATE)
        .iter()
        .zip(sine(high, 0.3, frames, RATE))
        .map(|(a, b)| a + b)
        .collect();
    let window = 2_400; // 50 ms: whole cycles of both tones
    let swing = |levels: &[f32]| {
        let (least, most) = levels.iter().fold((f32::MAX, 0.0_f32), |(least, most), x| {
            (least.min(*x), most.max(*x))
        });
        most / least
    };
    for shape in [0.0, 1.0, 2.0] {
        let changes = [("rate", 0.5), ("depth", 100.0), ("shape", shape)];
        let tremolo = mono(RATE, &in_mode(Mode::Tremolo, &changes), &input);
        let harmonic = mono(RATE, &in_mode(Mode::Harmonic, &changes), &input);
        let tremolo_swing = swing(&envelope(&tremolo[48_000..], window));
        let harmonic_swing = swing(&envelope(&harmonic[48_000..], window));
        assert!(
            tremolo_swing > 8.0,
            "tremolo level swings by {tremolo_swing}"
        );
        assert!(
            harmonic_swing < 1.25,
            "harmonic level swings by {harmonic_swing}"
        );
        // The two bands take turns: when the lows are up the highs are down.
        let (mut lows, mut highs) = (Vec::new(), Vec::new());
        for piece in harmonic[48_000..].chunks_exact(window) {
            lows.push(component(piece, low, RATE));
            highs.push(component(piece, high, RATE));
        }
        assert!(
            swing(&lows) > 4.0 && swing(&highs) > 4.0,
            "each band should swing: {} {}",
            swing(&lows),
            swing(&highs)
        );
        let mean = |v: &[f32]| v.iter().sum::<f32>() / v.len() as f32;
        let (mean_low, mean_high) = (mean(&lows), mean(&highs));
        let together: f32 = lows
            .iter()
            .zip(&highs)
            .map(|(a, b)| (a - mean_low) * (b - mean_high))
            .sum();
        let spread = |v: &[f32], m: f32| v.iter().map(|x| (x - m) * (x - m)).sum::<f32>().sqrt();
        let correlation = together / (spread(&lows, mean_low) * spread(&highs, mean_high));
        assert!(correlation < -0.8, "bands move together: {correlation}");
        // And the swap happens at the rate.
        let points: Vec<(f32, f32)> = lows
            .iter()
            .enumerate()
            .map(|(i, x)| ((i * window) as f32, *x))
            .collect();
        assert!(within(rate_of(&points, RATE), 0.5, 0.05));
    }
}

#[test]
fn phaser_and_vibe_are_all_pass_with_no_feedback_and_full_mix() {
    let hiss = noise(0.3, 192_000, 21);
    let note = sine(500.0, 0.4, 96_000, RATE);
    for mode in [Mode::Phaser, Mode::Vibe] {
        for shape in [0.0, 1.0, 2.0] {
            for depth in [0.0, 50.0, 100.0] {
                let controls = in_mode(
                    mode,
                    &[
                        ("shape", shape),
                        ("depth", depth),
                        ("feedback", 0.0),
                        ("mix", 100.0),
                        ("rate", 2.0),
                    ],
                );
                let out = mono(RATE, &controls, &hiss);
                let level = decibels(rms(&out[9_600..]) / rms(&hiss[9_600..]));
                assert!(
                    level.abs() < 0.1,
                    "{} {shape} depth {depth}: {level} dB on noise",
                    mode.name()
                );
                // A single note keeps its level at every moment of the sweep.
                let out = mono(RATE, &controls, &note);
                for piece in envelope(&out[9_600..], 960) {
                    let level = decibels(piece / (0.4 * core::f32::consts::FRAC_1_SQRT_2));
                    assert!(
                        level.abs() < 0.3,
                        "{} {shape} depth {depth}: {level} dB on a note",
                        mode.name()
                    );
                }
            }
        }
    }
}

/// The gain of a fixed setting at each frequency, from its impulse response.
fn response(controls: &[f32], frequencies: &[f32]) -> Vec<f32> {
    let mut input = silence(24_000);
    input[4_800] = 1.0;
    let out = mono(RATE, controls, &input);
    frequencies
        .iter()
        .map(|hertz| component(&out[4_800..], *hertz, RATE) * (out.len() - 4_800) as f32 / 2.0)
        .collect()
}

#[test]
fn the_phaser_has_two_three_or_four_notches_and_feedback_sharpens_them() {
    let frequencies: Vec<f32> = (0..160)
        .map(|i| 30.0 * 2.0_f32.powf(i as f32 / 18.0))
        .collect();
    for (shape, notches) in [(0.0, 2), (1.0, 3), (2.0, 4)] {
        let gains = response(
            &in_mode(Mode::Phaser, &[("shape", shape), ("depth", 0.0)]),
            &frequencies,
        );
        let dips = gains
            .windows(3)
            .filter(|w| w[1] < w[0] && w[1] < w[2] && w[1] < 0.25)
            .count();
        assert_eq!(dips, notches, "shape {shape}");
        // Between the notches the blend returns to full level.
        assert!(gains.iter().fold(0.0_f32, |most, gain| most.max(*gain)) > 1.3);
    }
    let plain = response(
        &in_mode(Mode::Phaser, &[("depth", 0.0), ("mix", 100.0)]),
        &frequencies,
    );
    let sharp = response(
        &in_mode(
            Mode::Phaser,
            &[("depth", 0.0), ("mix", 100.0), ("feedback", 80.0)],
        ),
        &frequencies,
    );
    let most = |gains: &[f32]| gains.iter().fold(0.0_f32, |most, gain| most.max(*gain));
    assert!(
        most(&plain) < 1.02 && most(&sharp) > 2.0,
        "feedback should raise a peak"
    );
    // The vibe's four stages are spread out, so its two notches lie far
    // apart: nearly four octaves, where the four-stage phaser's are 2.5.
    let spacing = |gains: &[f32]| {
        let dips: Vec<f32> = gains
            .windows(3)
            .zip(&frequencies[1..])
            .filter(|(w, _)| w[1] < w[0] && w[1] < w[2] && w[1] < 0.25)
            .map(|(_, hertz)| *hertz)
            .collect();
        assert_eq!(dips.len(), 2, "{dips:?}");
        (dips[1] / dips[0]).log2()
    };
    let vibe = spacing(&response(
        &in_mode(Mode::Vibe, &[("depth", 0.0)]),
        &frequencies,
    ));
    let phaser = spacing(&response(
        &in_mode(Mode::Phaser, &[("depth", 0.0)]),
        &frequencies,
    ));
    assert!(
        (phaser - 2.54).abs() < 0.15 && (vibe - 3.83).abs() < 0.2,
        "phaser {phaser}, vibe {vibe} octaves"
    );
}

#[test]
fn the_vibe_sweep_is_lopsided_and_full_mix_gives_vibrato() {
    // With Mix at 100 only the phase-shifted signal is left, and a moving
    // phase is a pitch bend. The lamp brightens faster than it fades, so the
    // bend one way is short and strong and the way back long and gentle.
    let note = 400.0;
    let input = sine(note, 0.4, 192_000, RATE);
    let bends = |shape: f32, rate: f32| {
        let controls = in_mode(
            Mode::Vibe,
            &[
                ("shape", shape),
                ("depth", 100.0),
                ("mix", 100.0),
                ("rate", rate),
            ],
        );
        let out = mono(RATE, &controls, &input);
        assert!(
            within(rms(&out[48_000..]), rms(&input[48_000..]), 0.02),
            "all-pass"
        );
        let track = pitch_track(&out[48_000..], RATE);
        let up = track
            .iter()
            .fold(0.0_f32, |up, (_, hertz)| up.max(hertz / note - 1.0));
        let down = track
            .iter()
            .fold(0.0_f32, |down, (_, hertz)| down.max(1.0 - hertz / note));
        let sharp =
            track.iter().filter(|(_, hertz)| *hertz > note).count() as f32 / track.len() as f32;
        assert!(
            within(rate_of(&track, RATE), rate, 0.03),
            "the bend repeats at the rate"
        );
        (up, down, sharp)
    };
    // Shape C has an even lamp: up and down mirror each other.
    let (up, down, sharp) = bends(2.0, 6.0);
    assert!(
        up > 0.002 && within(up, down, 0.05),
        "shape C bends up by {up} and down by {down}"
    );
    assert!(
        (sharp - 0.5).abs() < 0.04,
        "shape C is sharp for {sharp} of the time"
    );
    // Shapes A and B brighten faster than they fade.
    for shape in [0.0, 1.0] {
        let (up, down, sharp) = bends(shape, 6.0);
        assert!(
            up > 1.3 * down,
            "shape {shape} bends up by {up} and down by {down}"
        );
        assert!(
            sharp < 0.45,
            "shape {shape} is sharp for {sharp} of the time"
        );
        // At a slow rate the lamp keeps up and the bend is nearly even again.
        let (up, down, _) = bends(shape, 1.0);
        assert!(
            up > 0.002 && up < 1.25 * down,
            "shape {shape} at 1 Hz: {up} {down}"
        );
    }
}

#[test]
fn the_flanger_combs_at_its_delay_and_stays_bounded_at_full_feedback() {
    for rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        // No Depth holds the delay at 1.732 ms: the even blend cancels a note
        // whose half period that is and doubles one whose period it is.
        let fixed = in_mode(Mode::Flanger, &[("depth", 0.0), ("tone", 100.0)]);
        let frames = rate as usize;
        let skip = frames / 4;
        let null = mono(rate, &fixed, &sine(288.675, 0.5, frames, rate));
        let crest = mono(rate, &fixed, &sine(577.35, 0.5, frames, rate));
        let reference = 0.5 * core::f32::consts::FRAC_1_SQRT_2;
        assert!(
            rms(&null[skip..]) < 0.05 * reference,
            "{rate}: notch at {}",
            rms(&null[skip..]) / reference
        );
        assert!(
            within(rms(&crest[skip..]), 2.0_f32.sqrt() * reference, 0.03),
            "{rate}: peak"
        );
    }
    // Full feedback, either sign, on the comb's own resonance and on noise.
    for feedback in [100.0, -100.0] {
        let controls = in_mode(
            Mode::Flanger,
            &[
                ("depth", 0.0),
                ("feedback", feedback),
                ("mix", 100.0),
                ("tone", 100.0),
            ],
        );
        let hertz = if feedback > 0.0 { 577.35 } else { 288.675 };
        let mut input = sine(hertz, 1.0, 240_000, RATE);
        input.extend(silence(144_000));
        let out = mono(RATE, &controls, &input);
        assert!(out.iter().all(|x| x.is_finite()));
        let loudest = peak(&out);
        assert!(
            loudest > 1.2 && loudest < 4.0,
            "feedback {feedback}: peak {loudest}"
        );
        assert!(
            peak(&out[336_000..]) < 1.0e-3,
            "the resonance should die away"
        );
        let moving = in_mode(
            Mode::Flanger,
            &[
                ("depth", 100.0),
                ("feedback", feedback),
                ("mix", 100.0),
                ("rate", 0.3),
            ],
        );
        let out = mono(RATE, &moving, &noise(1.0, 240_000, 4));
        assert!(peak(&out) < 4.0 && out.iter().all(|x| x.is_finite()));
    }
}

#[test]
fn the_through_zero_flanger_passes_through_a_null() {
    // Shape C subtracts the moving copy from the fixed one: when the two
    // delays meet, everything cancels, whatever is playing.
    let mut smooth = [oxidal_dsp::OnePole::default(); 2];
    for pole in &mut smooth {
        pole.set_cutoff(RATE, 1_500.0);
    }
    let hiss: Vec<f32> = noise(1.0, 192_000, 8)
        .iter()
        .map(|x| {
            let once = smooth[0].lowpass(*x);
            smooth[1].lowpass(once)
        })
        .collect();
    let controls = |shape: f32| {
        in_mode(
            Mode::Flanger,
            &[
                ("shape", shape),
                ("depth", 100.0),
                ("rate", 0.5),
                ("tone", 100.0),
            ],
        )
    };
    let cancelled = mono(RATE, &controls(2.0), &hiss);
    let inverted = envelope(&cancelled[48_000..], 48);
    let added = envelope(&mono(RATE, &controls(1.0), &hiss)[48_000..], 48);
    let typical = rms(&hiss) * 0.9 * 2.0_f32.sqrt();
    let least = inverted.iter().fold(f32::MAX, |least, x| least.min(*x));
    let most = added.iter().fold(0.0_f32, |most, x| most.max(*x));
    assert!(
        least < 0.05 * typical,
        "the null only reaches {}",
        least / typical
    );
    // Shape B adds them instead: at the meeting point the two copies double.
    assert!(
        most > 1.7 * rms(&hiss) * 0.6,
        "the peak only reaches {}",
        most / rms(&hiss)
    );
    // Two nulls a cycle: the moving copy crosses the fixed one going each way.
    let quiet: Vec<(f32, f32)> = envelope(&cancelled[48_000..], 240)
        .iter()
        .enumerate()
        .map(|(i, x)| (i as f32 * 240.0, -x.min(0.2 * typical)))
        .collect();
    assert!(within(rate_of(&quiet, RATE), 1.0, 0.05));
}

/// The times, in milliseconds after an impulse, at which echoes arrive.
fn arrivals(sample_rate: f32, controls: &[f32]) -> Vec<f32> {
    let at = (0.2 * sample_rate) as usize;
    let mut input = silence((0.3 * sample_rate) as usize);
    input[at] = 1.0;
    let out = mono(sample_rate, controls, &input);
    let loudest = peak(&out);
    let mut found: Vec<usize> = Vec::new();
    for index in 1..out.len() - 1 {
        let value = out[index].abs();
        if value > 0.4 * loudest
            && value >= out[index - 1].abs()
            && value >= out[index + 1].abs()
            && found.last().is_none_or(|last| index - last > 8)
        {
            found.push(index);
        }
    }
    found
        .iter()
        .map(|index| (*index as f32 - at as f32) * 1_000.0 / sample_rate)
        .collect()
}

#[test]
fn chorus_voices_arrive_at_their_times_at_every_sample_rate() {
    for rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        let tolerance = 1_500.0 / rate; // a sample and a half, in milliseconds
        for (shape, expected) in [(0.0, vec![7.0, 13.0]), (1.0, vec![7.0, 11.0, 17.0])] {
            let times = arrivals(
                rate,
                &in_mode(
                    Mode::Chorus,
                    &[
                        ("shape", shape),
                        ("depth", 0.0),
                        ("mix", 100.0),
                        ("tone", 100.0),
                    ],
                ),
            );
            assert_eq!(
                times.len(),
                expected.len(),
                "{rate} Hz, shape {shape}: {times:?}"
            );
            for (time, expected) in times.iter().zip(&expected) {
                assert!(
                    (time - expected).abs() <= tolerance,
                    "{rate} Hz: voice at {time} ms, expected {expected} ms"
                );
            }
        }
        // The dry path is never delayed: with the dry signal in the blend, the
        // first arrival is at zero.
        let times = arrivals(rate, &in_mode(Mode::Chorus, &[("depth", 0.0)]));
        assert_eq!(times.first().copied(), Some(0.0));
    }
}

#[test]
fn the_vibrato_bend_does_not_grow_with_the_rate() {
    let note = 1_000.0;
    let bend_at = |rate: f32, seconds: f32| {
        let input = sine(note, 0.4, (seconds * RATE) as usize, RATE);
        let controls = in_mode(
            Mode::Vibrato,
            &[("rate", rate), ("depth", 100.0), ("tone", 100.0)],
        );
        let out = mono(RATE, &controls, &input);
        pitch_track(&out[9_600..], RATE)
            .iter()
            .fold(0.0_f32, |bend, (_, hertz)| {
                bend.max((hertz / note - 1.0).abs())
            })
    };
    // The sweep shrinks as the rate rises, so the bend stays at 60 cents.
    let (slow, fast) = (bend_at(2.0, 2.0), bend_at(10.0, 1.0));
    assert!(
        within(slow, 0.035_265, 0.08) && within(fast, 0.035_265, 0.08),
        "{slow} {fast}"
    );
    // Below about 1 Hz the sweep is at its 6 ms limit and the bend eases off:
    // 2 pi * 0.25 Hz * 6 ms = 0.94 %.
    let slowest = bend_at(0.25, 6.0);
    assert!(within(slowest, 0.009_42, 0.1), "{slowest}");
}

#[test]
fn times_and_pitches_hold_at_every_sample_rate() {
    for rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        // Tremolo rate.
        let gain = tremolo_gain(rate, &[("rate", 3.0), ("depth", 100.0)], 1.6);
        let measured = repetition_hertz(&gain[(0.1 * rate) as usize..], rate);
        assert!(
            within(measured, 3.0, 0.02),
            "{rate} Hz: tremolo at {measured} Hz"
        );
        // Vibrato depth.
        let input = sine(1_000.0, 0.5, rate as usize, rate);
        let out = mono(
            rate,
            &in_mode(
                Mode::Vibrato,
                &[("rate", 5.0), ("depth", 100.0), ("tone", 100.0)],
            ),
            &input,
        );
        let track = pitch_track(&out[(0.2 * rate) as usize..], rate);
        let swing = track.iter().fold(0.0_f32, |swing, (_, hertz)| {
            swing.max((hertz / 1_000.0 - 1.0).abs())
        });
        assert!(
            within(swing, 0.035_265, 0.08),
            "{rate} Hz: vibrato swing {swing}"
        );
        assert!(within(rate_of(&track, rate), 5.0, 0.03));
        // Ring carrier: a constant input comes out as the carrier itself.
        for (setting, hertz) in [(12.0, 2_000.0), (0.05, 20.0), (0.774_6, 200.0)] {
            let steady = vec![0.5_f32; rate as usize];
            let out = mono(
                rate,
                &in_mode(
                    Mode::Ring,
                    &[("rate", setting), ("depth", 100.0), ("tone", 100.0)],
                ),
                &steady,
            );
            let crossings = upward_crossings(&out[(0.2 * rate) as usize..], 0.0);
            let measured = (crossings.len() - 1) as f32 * rate
                / (crossings[crossings.len() - 1] - crossings[0]);
            assert!(
                within(measured, hertz, 0.01),
                "{rate} Hz: carrier at {measured} Hz, expected {hertz}"
            );
        }
    }
}

#[test]
fn ring_depth_blends_from_the_note_to_its_sidebands() {
    let note = 440.0;
    let input = sine(note, 0.4, 96_000, RATE);
    // Rate at 0.7746 Hz is the middle of the control: a 200 Hz carrier.
    let at = |depth: f32, shape: f32| {
        let out = mono(
            RATE,
            &in_mode(
                Mode::Ring,
                &[
                    ("rate", 0.774_6),
                    ("depth", depth),
                    ("shape", shape),
                    ("tone", 100.0),
                ],
            ),
            &input,
        );
        let part = &out[48_000..];
        (
            component(part, note, RATE) / 0.4,
            component(part, note - 200.0, RATE) / 0.4,
            component(part, note + 200.0, RATE) / 0.4,
            decibels(rms(part) / rms(&input)),
        )
    };
    let (straight, below, above, level) = at(0.0, 0.0);
    assert!(within(straight, 1.0, 0.03) && below < 0.01 && above < 0.01 && level.abs() < 0.3);
    let (straight, below, above, level) = at(100.0, 0.0);
    assert!(
        straight < 0.01,
        "full Depth should remove the note: {straight}"
    );
    assert!(
        within(below, 0.707, 0.05) && within(above, 0.707, 0.08),
        "sidebands {below} {above}"
    );
    assert!(level.abs() < 0.5);
    let (straight, below, above, level) = at(50.0, 0.0);
    assert!(straight > 0.6 && below > 0.4 && above > 0.4 && level.abs() < 0.5);
    // Shape B adds odd multiples of the carrier, Shape C doubles it.
    for shape in [1.0, 2.0] {
        let (straight, _, _, level) = at(100.0, shape);
        assert!(
            straight < 0.02 && level.abs() < 0.6,
            "shape {shape}: {straight}, {level} dB"
        );
    }
    let out = mono(
        RATE,
        &in_mode(
            Mode::Ring,
            &[
                ("rate", 0.774_6),
                ("depth", 100.0),
                ("shape", 2.0),
                ("tone", 100.0),
            ],
        ),
        &input,
    );
    assert!(
        component(&out[48_000..], note + 400.0, RATE) > 0.2
            && component(&out[48_000..], note + 200.0, RATE) < 0.01
    );
}

#[test]
fn the_rotary_ramps_between_slow_and_fast_at_two_paces() {
    let mut engine = Engine::new(RATE, 2);
    let silent = silence(4_800);
    let mut scratch = [silence(4_800), silence(4_800)];
    let mut run = |engine: &mut Engine, fast: bool, tenths: usize, shape: f32| -> Vec<(f32, f32)> {
        let settings = Settings::from_controls(&in_mode(
            Mode::Rotary,
            &[("fast", if fast { 1.0 } else { 0.0 }), ("shape", shape)],
        ));
        (0..tenths)
            .map(|_| {
                let [left, right] = &mut scratch;
                engine.process(
                    &settings,
                    &[silent.as_slice(), silent.as_slice()],
                    &mut [left.as_mut_slice(), right.as_mut_slice()],
                );
                engine.rotor_speeds()
            })
            .collect()
    };
    // Slow: the horn turns at the Rate, the drum a little slower.
    let slow = run(&mut engine, false, 10, 0.0);
    let (horn, drum) = slow[9];
    assert!(
        within(horn, 0.8, 0.01) && within(drum, 0.8 * 0.86, 0.01),
        "slow speeds {horn} {drum}"
    );
    // Fast on: both climb, never jump, and the horn gets there first.
    let up = run(&mut engine, true, 150, 0.0);
    assert!(
        up[0].0 < 2.0 && up[0].1 < 1.0,
        "a jump in the first tenth of a second: {:?}",
        up[0]
    );
    assert!(
        up.windows(2)
            .all(|pair| pair[1].0 >= pair[0].0 && pair[1].1 >= pair[0].1)
    );
    let reached = |speeds: &[(f32, f32)], pick: fn(&(f32, f32)) -> f32, level: f32| {
        speeds
            .iter()
            .position(|speeds| pick(speeds) >= level)
            .map(|tenth| tenth as f32 / 10.0)
    };
    let horn_time = reached(&up, |s| s.0, 0.9 * 6.4).unwrap();
    let drum_time = reached(&up, |s| s.1, 0.9 * 6.4 * 0.86).unwrap();
    assert!(
        horn_time > 0.5 && horn_time < 3.0,
        "horn took {horn_time} s"
    );
    assert!(
        drum_time > 4.0 && drum_time < 12.0 && drum_time > 2.5 * horn_time,
        "drum took {drum_time} s"
    );
    assert!(within(up[149].0, 6.4, 0.01) && within(up[149].1, 6.4 * 0.86, 0.03));
    // Fast off: both fall back, again over time.
    let down = run(&mut engine, false, 300, 0.0);
    assert!(
        down[0].0 > 5.0
            && down
                .windows(2)
                .all(|pair| pair[1].0 <= pair[0].0 && pair[1].1 <= pair[0].1)
    );
    assert!(within(down[299].0, 0.8, 0.02) && within(down[299].1, 0.8 * 0.86, 0.05));
    // Shape C brakes to a stop with Fast off; Shape B parks the drum only.
    let braked = run(&mut engine, false, 300, 2.0);
    assert!(braked[5].0 > 0.2 && braked[299].0 < 0.001 && braked[299].1 < 0.01);
    let parked = run(&mut engine, true, 300, 1.0);
    assert!(within(parked[299].0, 6.4, 0.01) && parked[299].1 < 0.01);
}

#[test]
fn the_rotary_sounds_its_ramp_and_bends_pitch() {
    // A high note goes to the horn: its level beats once a turn.
    let note = 3_000.0;
    let input = sine(note, 0.4, 480_000, RATE);
    let slow = in_mode(Mode::Rotary, &[]);
    let fast = in_mode(Mode::Rotary, &[("fast", 1.0)]);
    let out = render_with(&mut plugin::<1>(RATE), &[input], 96, |frame| {
        if frame < 240_000 {
            slow.clone()
        } else {
            fast.clone()
        }
    })
    .remove(0);
    let level: Vec<f32> = envelope(&out, 240);
    let points = |from: usize, to: usize| -> Vec<(f32, f32)> {
        level[from..to]
            .iter()
            .enumerate()
            .map(|(i, x)| ((i * 240) as f32, *x))
            .collect()
    };
    // 200 envelope points a second.
    let slow_rate = rate_of(&points(200, 1_000), RATE);
    let early_rate = rate_of(&points(1_000, 1_200), RATE);
    let fast_rate = rate_of(&points(1_600, 2_000), RATE);
    assert!(within(slow_rate, 0.8, 0.05), "slow horn at {slow_rate} Hz");
    assert!(within(fast_rate, 6.4, 0.05), "fast horn at {fast_rate} Hz");
    assert!(
        early_rate > 1.2 * slow_rate && early_rate < 0.8 * fast_rate,
        "in the first second: {early_rate} Hz"
    );
    // Level and tone swing by several decibels, and the pitch bends.
    let (least, most) = level[1_600..]
        .iter()
        .fold((f32::MAX, 0.0_f32), |(least, most), x| {
            (least.min(*x), most.max(*x))
        });
    assert!(decibels(most / least) > 6.0);
    let track = pitch_track(&out[384_000..], RATE);
    let bend = track.iter().fold(0.0_f32, |bend, (_, hertz)| {
        bend.max((hertz / note - 1.0).abs())
    });
    // A 0.18 m horn at 6.4 turns a second: 2 pi * 6.4 * 0.18 / 343 = 2.1 %.
    assert!(within(bend, 0.0211, 0.25), "pitch bend {bend}");
}

#[test]
fn stereo_spreads_a_mono_input_and_zero_keeps_the_sides_equal() {
    let input = plucked(96_000, RATE);
    for mode in Mode::ALL {
        for shape in [0.0, 1.0, 2.0] {
            let fast = if mode == Mode::Rotary { 1.0 } else { 0.0 };
            let together = in_mode(
                mode,
                &[
                    ("shape", shape),
                    ("stereo", 0.0),
                    ("fast", fast),
                    ("depth", 100.0),
                ],
            );
            let (left, right) = stereo(RATE, &together, &input);
            assert!(
                left == right,
                "{} {shape}: sides differ with Stereo at zero",
                mode.name()
            );
            for degrees in [30.0, 90.0, 180.0] {
                let apart = in_mode(
                    mode,
                    &[
                        ("shape", shape),
                        ("stereo", degrees),
                        ("fast", fast),
                        ("depth", 100.0),
                    ],
                );
                let (left, right) = stereo(RATE, &apart, &input);
                let difference: Vec<f32> = left.iter().zip(&right).map(|(a, b)| a - b).collect();
                let amount = rms(&difference) / rms(&left);
                assert!(
                    amount > 0.02,
                    "{} {shape}: sides nearly equal at {degrees} degrees ({amount})",
                    mode.name()
                );
            }
        }
    }
    // The mono plugin ignores Stereo altogether.
    for mode in Mode::ALL {
        let narrow = mono(RATE, &in_mode(mode, &[("stereo", 0.0)]), &input);
        let wide = mono(RATE, &in_mode(mode, &[("stereo", 180.0)]), &input);
        assert!(narrow == wide, "{}", mode.name());
    }
    // Tremolo at 180 degrees pans: one side is up when the other is down.
    let steady = vec![0.5_f32; 96_000];
    let (left, right) = stereo(
        RATE,
        &in_mode(
            Mode::Tremolo,
            &[("stereo", 180.0), ("depth", 100.0), ("rate", 2.0)],
        ),
        &steady,
    );
    let sum_swing = left[9_600..]
        .iter()
        .zip(&right[9_600..])
        .fold((f32::MAX, 0.0_f32), |(low, high), (a, b)| {
            (low.min(a + b), high.max(a + b))
        });
    assert!(
        sum_swing.1 / sum_swing.0 < 1.01,
        "the sum of both sides should stay level"
    );
}

#[test]
fn stereo_inputs_keep_their_own_sides() {
    // Different signals left and right stay apart in every mode but Rotary,
    // where one cabinet hears their sum.
    let frames = 48_000;
    let input = [sine(300.0, 0.4, frames, RATE), silence(frames)];
    for mode in Mode::ALL {
        let out = render(
            &mut plugin::<2>(RATE),
            &in_mode(mode, &[("mix", 100.0)]),
            &input,
            96,
        );
        let right = rms(&out[1][9_600..]);
        if mode == Mode::Rotary {
            assert!(right > 0.05, "the rotary should sound on both sides");
        } else {
            assert!(
                right == 0.0,
                "{} leaks {right} into the silent side",
                mode.name()
            );
        }
    }
}

#[test]
fn the_default_level_stays_within_a_decibel_of_the_dry_signal() {
    let input = plucked(384_000, RATE);
    for mode in Mode::ALL {
        for shape in [0.0, 1.0, 2.0] {
            let out = mono(RATE, &in_mode(mode, &[("shape", shape)]), &input);
            let level = decibels(rms(&out) / rms(&input));
            // Rotary Shape C at its defaults is a parked rotor, which colours
            // the level by where it stands; it is checked while turning.
            if mode == Mode::Rotary && shape == 2.0 {
                let turning = mono(
                    RATE,
                    &in_mode(mode, &[("shape", shape), ("fast", 1.0)]),
                    &input,
                );
                let level = decibels(rms(&turning) / rms(&input));
                assert!(level.abs() < 1.0, "Rotary C turning: {level} dB");
                continue;
            }
            assert!(
                level.abs() < 1.0,
                "{} shape {shape}: {level} dB",
                mode.name()
            );
        }
    }
}
