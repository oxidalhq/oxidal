//! What the sustainer must do for a player: hold a note, follow a bend,
//! release on a mute, move to the next note, land on a harmonic, hold a chord
//! and not be fooled by an octave-wrong reading.
//! @see docs/native-sustain.md

mod common;

use common::*;
use oxidal_sustain::engine::{Phase, Voice};
use oxidal_sustain::port;

const RATE: f32 = 48_000.0;

/// Root mean square of a note just after it was picked, which with the
/// plateau of the Drive setting is the level it is held at.
fn picked(input: &[f32], rate: f32) -> f64 {
    rms(&input[at(rate, 0.05)..at(rate, 0.15)])
}

/// Level of one second of `signal` from `second`, in dB against `target`.
fn level_db(signal: &[f32], rate: f32, second: f64, target: f64) -> f64 {
    db(rms(&signal[at(rate, second)..at(rate, second + 1.0)]) / target)
}

fn pitch_at(signal: &[f32], rate: f32, second: f64, guess: f64) -> f64 {
    frequency(
        &signal[at(rate, second)..at(rate, second + 1.0)],
        rate,
        guess,
    )
}

/// Plays `note` for five seconds, then silence up to `seconds`, and checks
/// the held level every second and the pitch.
fn holds(note: f64, rate: f32, seconds: f64, shape: impl Fn(Vec<f32>) -> Vec<f32>, what: &str) {
    let mut input = shape(Pluck::default().note(rate, 5.0, note));
    input.resize(at(rate, seconds), 0.0);
    let target = picked(&input, rate) * 10.0_f64.powf(f64::from(default_plateau_db()) / 20.0);
    let mut rig = Rig::<1>::new(rate);
    let out = rig.run(&input);
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver, "{what}");
    let mut second = 6.0;
    while second + 1.0 <= seconds {
        let level = level_db(&out, rate, second, target);
        assert!(
            level.abs() < 3.0,
            "{what}: {level:+.2} dB from the target at {second} s"
        );
        let off = cents(pitch_at(&out, rate, second, note), note);
        assert!(off.abs() < 10.0, "{what}: {off:+.2} cents at {second} s");
        second += 1.0;
    }
}

#[test]
fn a_single_note_is_held_steady_for_a_minute_after_the_string_has_died() {
    // The input is silent from 5 s; the note must still be there at 66 s.
    holds(110.0, RATE, 66.0, |x| x, "A2 for a minute");
}

#[test]
fn notes_across_the_neck_are_held_at_their_own_pitch() {
    for note in [82.41, 146.83, 329.63, 659.26, 1318.5] {
        holds(note, RATE, 9.0, |x| x, &format!("{note} Hz"));
    }
}

#[test]
fn noise_and_a_clipped_high_gain_signal_are_held_too() {
    holds(
        196.0,
        RATE,
        9.0,
        |mut x| {
            // Hiss at -66 dBFS, as a quiet guitar lead has.
            let hiss = noise(at(RATE, 9.0), 0.0005, 7);
            x.resize(hiss.len(), 0.0);
            add_at(&mut x, &hiss, 0);
            x
        },
        "with hiss",
    );
    holds(
        146.83,
        RATE,
        9.0,
        |x| x.iter().map(|s| 0.1 * (12.0 * s).tanh()).collect(),
        "clipped",
    );
}

#[test]
fn drive_sets_the_level_the_note_is_held_at() {
    for drive in [0.0_f32, 50.0, 100.0] {
        let mut input = Pluck::default().note(RATE, 5.0, 196.0);
        input.resize(at(RATE, 9.0), 0.0);
        let target = picked(&input, RATE) * 10.0_f64.powf(f64::from(plateau_db(drive)) / 20.0);
        let out = Rig::<1>::new(RATE).with(port::DRIVE, drive).run(&input);
        let level = level_db(&out, RATE, 8.0, target);
        assert!(
            level.abs() < 1.5,
            "Drive {drive}: {level:+.2} dB from its plateau"
        );
    }
}

#[test]
fn switching_in_neither_raises_nor_drops_a_sounding_note() {
    // A slowly decaying note, as a string really rings: for its first two
    // seconds the output stays within 1 dB of... the level it is held at or
    // the dry note, whichever is louder.
    let pluck = Pluck {
        decay: 0.6,
        ..Pluck::default()
    };
    let input = pluck.note(RATE, 3.0, 146.83);
    let out = Rig::<1>::new(RATE).run(&input);
    let held = picked(&input, RATE) * 10.0_f64.powf(f64::from(default_plateau_db()) / 20.0);
    for tenth in 1..28 {
        let (a, b) = (
            at(RATE, 0.1 * tenth as f64),
            at(RATE, 0.1 * tenth as f64 + 0.1),
        );
        let expected = rms(&input[a..b]).max(held);
        let off = db(rms(&out[a..b]) / expected);
        assert!(off.abs() < 1.5, "{off:+.2} dB at {} ms", 100 * tenth);
    }
    // And the pick itself passes untouched.
    assert_eq!(out[..at(RATE, 0.02)], input[..at(RATE, 0.02)]);
}

#[test]
fn a_two_semitone_bend_is_followed_while_the_string_sounds() {
    let up = 196.0 * 2.0_f64.powf(2.0 / 12.0);
    let mut input = Pluck::default().bent(RATE, 5.0, |t| {
        let bend = ((t - 0.4) / 0.5).clamp(0.0, 1.0);
        196.0 * 2.0_f64.powf(2.0 * bend / 12.0)
    });
    input.resize(at(RATE, 8.0), 0.0);
    let mut rig = Rig::<1>::new(RATE);
    let out = rig.run(&input);
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
    let off = cents(pitch_at(&out, RATE, 6.5, up), up);
    assert!(
        off.abs() < 20.0,
        "the bent note is held {off:+.2} cents off"
    );
    // A slow vibrato of 30 cents is followed and its centre is kept.
    let mut input = Pluck::default().bent(RATE, 5.0, |t| {
        220.0 * 2.0_f64.powf(0.3 / 12.0 * (std::f64::consts::TAU * 5.0 * t).sin())
    });
    input.resize(at(RATE, 8.0), 0.0);
    let out = Rig::<1>::new(RATE).run(&input);
    let off = cents(pitch_at(&out, RATE, 6.5, 220.0), 220.0);
    assert!(
        off.abs() < 35.0,
        "vibrato left the note {off:+.2} cents off"
    );
}

#[test]
fn an_abrupt_mute_releases_the_note_within_300_ms() {
    for (decay, muted_at) in [(1.5, 1.5), (0.5, 3.0), (0.5, 0.4)] {
        let pluck = Pluck {
            decay,
            ..Pluck::default()
        };
        let mut input = pluck.note(RATE, 6.0, 164.81);
        mute(&mut input, at(RATE, muted_at), at(RATE, 0.004));
        let target = picked(&input, RATE);
        let mut rig = Rig::<1>::new(RATE);
        let out = rig.run(&input);
        // The sustain was there before the mute...
        let before = rms(&out[at(RATE, muted_at - 0.1)..at(RATE, muted_at)]);
        assert!(
            db(before / target) > -6.0,
            "nothing sustained before the mute"
        );
        // ...and is 40 dB down 300 ms after it, and silent from then on.
        let after = peak(&out[at(RATE, muted_at + 0.3)..]);
        assert!(
            db(f64::from(after) / target) < -40.0,
            "mute at {muted_at} s left {:.1} dB",
            db(f64::from(after) / target)
        );
        assert_eq!(peak(&out[at(RATE, muted_at + 0.5)..]), 0.0);
        assert_eq!(rig.plugin.engine().phase(), Phase::Idle);
    }
}

#[test]
fn a_natural_decay_is_not_taken_for_a_mute() {
    // A short, fast-dying note (40 dB a second) is still a note.
    let pluck = Pluck {
        decay: 4.5,
        ..Pluck::default()
    };
    let mut input = pluck.note(RATE, 3.0, 440.0);
    input.resize(at(RATE, 6.0), 0.0);
    let mut rig = Rig::<1>::new(RATE);
    let out = rig.run(&input);
    assert_eq!(rig.plugin.engine().phase(), Phase::Sustaining);
    assert!(rms(&out[at(RATE, 5.0)..]) > 0.5 * picked(&input, RATE) * 0.5);
}

/// The sustained part of the output: what was added to the input.
fn added(out: &[f32], input: &[f32]) -> Vec<f32> {
    out.iter().zip(input).map(|(o, i)| o - i).collect()
}

#[test]
fn a_new_note_replaces_the_old_one_within_150_ms_without_a_click() {
    // The first string has died and the Driver holds it; a new note is picked.
    let (old, new, picked_at) = (110.0, 164.81, 5.0);
    let mut input = Pluck::default().note(RATE, 4.0, old);
    input.resize(at(RATE, 11.0), 0.0);
    let second = Pluck::default().note(RATE, 4.0, new);
    add_at(&mut input, &second, at(RATE, picked_at));
    let mut rig = Rig::<1>::new(RATE);
    let out = rig.run(&input);
    let wet = added(&out, &input);
    let held = amplitude(&wet[at(RATE, 4.5)..at(RATE, 5.0)], RATE, old);
    assert!(held > 0.03, "the first note was not being held");
    // 150 ms after the pick the old pitch is at least 40 dB down.
    let left = amplitude(
        &wet[at(RATE, picked_at + 0.15)..at(RATE, picked_at + 0.45)],
        RATE,
        old,
    );
    assert!(
        db(left / held) < -40.0,
        "old pitch still at {:.1} dB",
        db(left / held)
    );
    // No click: the handover never moves the output faster than the held
    // note itself was moving (its steepest step in the second before).
    let usual = steepest(&wet[at(RATE, 4.0)..at(RATE, 5.0)]);
    let handover = steepest(&wet[at(RATE, 5.0) - 1..at(RATE, 5.5)]);
    assert!(
        handover <= 1.25 * usual,
        "handover stepped {handover} against the note's own {usual}"
    );
    // The new note is then held at its own pitch.
    let off = cents(pitch_at(&out, RATE, 10.0, new), new);
    assert!(off.abs() < 10.0, "new note held {off:+.2} cents off");
    assert!(amplitude(&out[at(RATE, 10.0)..], RATE, old) < 0.01 * held);
}

#[test]
fn a_note_played_over_a_ringing_one_on_the_same_string_takes_over() {
    // The first note is cut by the next pick, as on one string.
    let mut input = Pluck::default().note(RATE, 1.0, 196.0);
    mute(&mut input, at(RATE, 0.998), at(RATE, 0.002));
    input.resize(at(RATE, 8.0), 0.0);
    add_at(
        &mut input,
        &Pluck::default().note(RATE, 4.0, 246.94),
        at(RATE, 1.0),
    );
    let mut rig = Rig::<1>::new(RATE);
    let out = rig.run(&input);
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
    let off = cents(pitch_at(&out, RATE, 7.0, 246.94), 246.94);
    assert!(off.abs() < 10.0, "second note held {off:+.2} cents off");
    assert!(amplitude(&out[at(RATE, 7.0)..], RATE, 196.0) < 1.0e-3);
}

#[test]
fn a_legato_note_without_a_pick_moves_the_driver() {
    // A hammer-on: the pitch changes with no jump in level.
    let mut input = Pluck {
        decay: 0.8,
        ..Pluck::default()
    }
    .bent(RATE, 5.0, |t| if t < 1.0 { 196.0 } else { 246.94 });
    input.resize(at(RATE, 9.0), 0.0);
    let out = Rig::<1>::new(RATE).run(&input);
    let off = cents(pitch_at(&out, RATE, 8.0, 246.94), 246.94);
    assert!(off.abs() < 10.0, "hammered note held {off:+.2} cents off");
}

#[test]
fn harmonic_mode_lands_on_the_chosen_harmonic() {
    for (choice, number) in [(0.0_f32, 2.0), (1.0, 3.0), (2.0, 4.0)] {
        let mut input = Pluck::default().note(RATE, 5.0, 110.0);
        input.resize(at(RATE, 9.0), 0.0);
        let target = picked(&input, RATE) * 10.0_f64.powf(f64::from(default_plateau_db()) / 20.0);
        let out = Rig::<1>::new(RATE)
            .with(port::MODE, 1.0)
            .with(port::HARMONIC, choice)
            .run(&input);
        let tail = &out[at(RATE, 7.0)..];
        let wanted = 110.0 * number;
        let off = cents(frequency(tail, RATE, wanted), wanted);
        assert!(off.abs() < 10.0, "harmonic {number}: {off:+.2} cents off");
        let (own, harmonic) = (amplitude(tail, RATE, 110.0), amplitude(tail, RATE, wanted));
        assert!(
            harmonic > 20.0 * own,
            "harmonic {number}: the note itself is still there"
        );
        let level = db(rms(tail) / target);
        assert!(
            level.abs() < 3.0,
            "harmonic {number}: {level:+.2} dB from the target"
        );
    }
}

#[test]
fn mix_mode_starts_on_the_note_and_blooms_into_the_harmonic() {
    let mut input = Pluck {
        decay: 4.0,
        ..Pluck::default()
    }
    .note(RATE, 2.0, 146.83);
    input.resize(at(RATE, 10.0), 0.0);
    let out = Rig::<1>::new(RATE)
        .with(port::MODE, 2.0)
        .with(port::BLOOM, 4000.0)
        .run(&input);
    let share = |from: f64| {
        let part = &out[at(RATE, from)..at(RATE, from + 0.5)];
        let own = amplitude(part, RATE, 146.83);
        let above = amplitude(part, RATE, 293.66);
        above / own.max(1.0e-9)
    };
    // The plucked note's own second harmonic is 0.47 of its fundamental.
    assert!(share(0.3) < 0.6, "it began on the harmonic: {}", share(0.3));
    assert!(
        share(2.2) > share(1.0) && share(1.0) > share(0.3),
        "the harmonic is not growing"
    );
    assert!(
        share(6.0) > 20.0,
        "it never reached the harmonic: {}",
        share(6.0)
    );
    // A short Bloom gets there sooner.
    let fast = Rig::<1>::new(RATE)
        .with(port::MODE, 2.0)
        .with(port::BLOOM, 300.0)
        .run(&input);
    let part = &fast[at(RATE, 1.5)..at(RATE, 2.0)];
    assert!(amplitude(part, RATE, 293.66) > 20.0 * amplitude(part, RATE, 146.83));
}

/// Several plucked notes sounding together.
fn strum(notes: &[f64], seconds: f64) -> Vec<f32> {
    let mut chord = vec![0.0; at(RATE, seconds)];
    for (index, note) in notes.iter().enumerate() {
        let pluck = Pluck {
            level: 0.07,
            ..Pluck::default()
        };
        // Strings a few milliseconds apart, as a strum is.
        add_at(&mut chord, &pluck.note(RATE, seconds, *note), index * 240);
    }
    chord
}

#[test]
fn chords_take_the_chord_hold_path_and_are_sustained() {
    let chords: [&[f64]; 4] = [
        &[110.0, 164.81],          // a fifth: one common period, no fundamental
        &[146.83, 196.0],          // a fourth
        &[164.81, 207.65, 246.94], // a major triad
        &[98.0, 123.47, 146.83],   // the same, low on the neck
    ];
    for notes in chords {
        let mut input = strum(notes, 5.0);
        input.resize(at(RATE, 12.0), 0.0);
        let target = picked(&input, RATE) * 10.0_f64.powf(f64::from(default_plateau_db()) / 20.0);
        let mut rig = Rig::<1>::new(RATE);
        let mut early = Voice::None;
        let out = rig.run_changing(&input, |rig, i| {
            if i == at(RATE, 1.0) {
                early = rig.plugin.engine().voice();
            }
        });
        assert_eq!(early, Voice::Chord, "{notes:?} was not taken as a chord");
        assert_eq!(rig.plugin.engine().voice(), Voice::Chord);
        // Held at a steady level long after the strings have died.
        for second in [6.0, 8.0, 11.0] {
            let level = level_db(&out, RATE, second, target);
            assert!(level.abs() < 3.0, "{notes:?}: {level:+.2} dB at {second} s");
        }
        // Every note of the chord is in what is held.
        let tail = &out[at(RATE, 9.0)..at(RATE, 11.0)];
        for note in notes {
            let found = amplitude(tail, RATE, *note);
            assert!(
                found > 0.2 * target,
                "{notes:?}: {note} Hz is missing ({found})"
            );
        }
    }
}

#[test]
fn a_muted_chord_is_released_and_a_single_note_after_it_uses_the_driver() {
    let mut input = strum(&[164.81, 207.65, 246.94], 2.0);
    mute(&mut input, at(RATE, 1.5), at(RATE, 0.004));
    input.resize(at(RATE, 8.0), 0.0);
    add_at(
        &mut input,
        &Pluck::default().note(RATE, 4.0, 220.0),
        at(RATE, 3.0),
    );
    let mut rig = Rig::<1>::new(RATE);
    let mut between = 1.0_f32;
    let out = rig.run_changing(&input, |_, _| {});
    between = between.min(peak(&out[at(RATE, 1.9)..at(RATE, 3.0)]));
    assert_eq!(between, 0.0, "the muted chord was not released");
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
    let off = cents(pitch_at(&out, RATE, 7.0, 220.0), 220.0);
    assert!(off.abs() < 10.0);
}

#[test]
fn a_stretch_that_reads_an_octave_high_does_not_move_the_driver() {
    // For 90 ms the note loses its fundamental and every odd harmonic, so
    // its waveform repeats twice as often and a pitch reader says "octave
    // up"; the level does not change. The Driver must stay where it is.
    let pluck = Pluck {
        decay: 0.3,
        ..Pluck::default()
    };
    let whole = pluck.note(RATE, 4.0, 110.0);
    let even = Pluck {
        harmonics: 4,
        ..pluck
    }
    .note(RATE, 4.0, 220.0);
    let mut input = whole.clone();
    let (from, to, fade) = (at(RATE, 1.0), at(RATE, 1.09), at(RATE, 0.005));
    for i in from..to {
        let edge = ((i - from).min(to - i) as f32 / fade as f32).min(1.0);
        input[i] = whole[i] * (1.0 - edge) + even[i] * edge;
    }
    input.resize(at(RATE, 8.0), 0.0);
    let mut rig = Rig::<1>::new(RATE);
    let expected = f64::from(RATE) / 110.0;
    let mut worst = 0.0_f64;
    let out = rig.run_changing(&input, |rig, i| {
        if i > at(RATE, 0.5) && i < at(RATE, 3.0) {
            assert_eq!(rig.plugin.engine().voice(), Voice::Driver, "at sample {i}");
            worst = worst.max(cents(f64::from(rig.plugin.engine().period()), expected).abs());
        }
    });
    assert!(worst < 20.0, "the Driver moved by {worst:.1} cents");
    let off = cents(pitch_at(&out, RATE, 7.0, 110.0), 110.0);
    assert!(
        off.abs() < 10.0,
        "held {off:+.2} cents off after the stretch"
    );
}

#[test]
fn a_fast_run_never_makes_the_voice_jump() {
    // Sixteen notes 110 ms apart, each cutting the last, then one held note.
    // With Dry off the output is the voice alone.
    let scale = [196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 369.99, 392.0];
    let mut input = vec![0.0; at(RATE, 9.0)];
    for step in 0..16 {
        let mut note = Pluck::default().note(RATE, 0.11, scale[step % 8]);
        let length = note.len();
        mute(&mut note, length - 96, 96);
        add_at(&mut input, &note, at(RATE, 0.11 * step as f64));
    }
    add_at(
        &mut input,
        &Pluck::default().note(RATE, 4.0, 196.0),
        at(RATE, 1.76),
    );
    let mut rig = Rig::<1>::new(RATE).with(port::DRY, 0.0);
    let out = rig.run(&input);
    // The measure of "no jump": the steepest step of the same voice in the
    // first second of one held note, when it is at its brightest.
    let alone = Rig::<1>::new(RATE)
        .with(port::DRY, 0.0)
        .run(&Pluck::default().note(RATE, 1.0, 196.0));
    let usual = steepest(&alone);
    let run = steepest(&out[..at(RATE, 1.76)]);
    assert!(
        peak(&out[..at(RATE, 1.76)]) > 0.01,
        "the voice never sounded in the run"
    );
    assert!(
        usual > 0.0 && run <= 1.25 * usual,
        "the run stepped {run} against {usual}"
    );
    let off = cents(pitch_at(&out, RATE, 8.0, 196.0), 196.0);
    assert!(off.abs() < 10.0);
}

#[test]
fn steady_hiss_and_hum_start_nothing() {
    // Hiss below the threshold: silence out with Dry off.
    let hiss = noise(at(RATE, 3.0), 0.001, 3);
    let out = Rig::<1>::new(RATE).with(port::DRY, 0.0).run(&hiss);
    assert_eq!(peak(&out), 0.0);
    // Loud noise has no pitch to drive and is never louder than it came in
    // by more than the Lift allows.
    let loud = noise(at(RATE, 3.0), 0.05, 5);
    let out = Rig::<1>::new(RATE).run(&loud);
    assert!(rms(&out) < 2.5 * rms(&loud));
}
