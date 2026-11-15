//! Following the fretting hand: bends and vibrato made while the Driver
//! carries the note are followed for as long as the string still moves,
//! loud or faint, and the last pitch is held once it has sunk into the noise.
//! The faint-string tests listen to the sustained voice alone (Dry off), so
//! what is measured is the Driver, not the real string under it.
//! @see docs/native-sustain.md

mod common;

use common::*;
use oxidal_sustain::pitch::PitchReader;
use oxidal_sustain::port;
use std::f64::consts::TAU;

const RATE: f32 = 48_000.0;
const NOTE: f64 = 196.0;
/// Readings are 10 ms apart; 60 ms is six of them.
const MOST_LAG: usize = 6;

/// Pitch readings of a signal, one per 10 ms (zero where none was found).
fn readings(signal: &[f32]) -> Vec<f64> {
    let mut reader = PitchReader::new(RATE);
    let mut found = Vec::new();
    for x in signal {
        if reader.push(*x) {
            let period = reader.reading().period;
            found.push(if period > 0.0 {
                f64::from(RATE / period)
            } else {
                0.0
            });
        }
    }
    found
}

/// A bend of two semitones over 200 ms at 6, 12 and 18 s, held 1.5 s and let
/// back down over 200 ms.
fn bends(t: f64) -> f64 {
    let up = [6.0, 12.0, 18.0]
        .iter()
        .map(|start| {
            let rise = ((t - start) / 0.2).clamp(0.0, 1.0);
            let fall = ((t - start - 1.7) / 0.2).clamp(0.0, 1.0);
            rise - fall
        })
        .sum::<f64>();
    NOTE * 2.0_f64.powf(2.0 * up / 12.0)
}

/// 5.5 Hz vibrato of 30 cents either way, from 1 s.
fn vibrato(t: f64) -> f64 {
    let depth = if t < 1.0 { 0.0 } else { 0.3 };
    NOTE * 2.0_f64.powf(depth / 12.0 * (TAU * 5.5 * t).sin())
}

/// Readings of the output against readings of the same pitch curve played
/// steadily (so the reader's own delay cancels), between `from` and `to`
/// seconds. For each second it finds the lag, up to 60 ms, at which the
/// output matches best, and returns the worst error in cents at that lag
/// over all the seconds: the output follows within that error and 60 ms.
fn following(out: &[f32], pitch: &dyn Fn(f64) -> f64, ratio: f64, from: f64, to: f64) -> f64 {
    let steady = Pluck {
        decay: 0.0,
        ..Pluck::default()
    }
    .bent(RATE, to + 0.5, |t| ratio * pitch(t));
    let (truth, heard) = (readings(&steady), readings(out));
    let (first, last) = (
        (from * 100.0) as usize,
        ((to * 100.0) as usize).min(heard.len()),
    );
    let mut missing = 0;
    let mut overall = 0.0_f64;
    let mut start = first;
    while start < last {
        let stop = (start + 100).min(last);
        let mut best = f64::MAX;
        for lag in 0..=MOST_LAG {
            let mut worst = 0.0_f64;
            for index in start..stop {
                let (Some(&expected), Some(&found)) = (truth.get(index - lag), heard.get(index))
                else {
                    continue;
                };
                if found <= 0.0 || expected <= 0.0 {
                    if lag == 0 {
                        missing += 1;
                    }
                    continue;
                }
                worst = worst.max(cents(found, expected).abs());
            }
            best = best.min(worst);
        }
        overall = overall.max(best);
        start = stop;
    }
    assert!(
        missing <= (last - first) / 50,
        "{missing} readings of the output failed"
    );
    overall
}

/// A string that decays steadily from its pick to -65 dBFS at 20 s and on,
/// over hiss at -70 dBFS, with its pitch following `pitch`.
fn fading_string(pitch: &dyn Fn(f64) -> f64, seconds: f64) -> Vec<f32> {
    let pluck = Pluck {
        decay: 0.259, // 45 dB in 20 s
        ..Pluck::default()
    };
    let mut input = pluck.bent(RATE, seconds, pitch);
    let hiss = noise(input.len(), 0.000_316, 21);
    add_at(&mut input, &hiss, 0);
    input
}

/// The Driver's frequency stays within `cents` of the note: no octave jumps.
fn no_jumps(input: &[f32], mode: f32, limit: f64) {
    let mut rig = Rig::<1>::new(RATE).with(port::MODE, mode);
    let mut worst = 0.0_f64;
    rig.run_changing(input, |rig, i| {
        if i > at(RATE, 0.5) {
            let hertz = f64::from(RATE / rig.plugin.engine().period());
            worst = worst.max(cents(hertz, NOTE).abs());
        }
    });
    assert!(
        worst < limit,
        "the Driver went {worst:.0} cents from the note"
    );
}

#[test]
fn a_loud_ringing_string_is_followed_through_bends_and_vibrato() {
    // A slowly decaying string, -22 to -30 dBFS for its first four seconds:
    // the Driver is active from 0.1 s and the player bends and shakes it.
    let loud = |pitch: &dyn Fn(f64) -> f64| {
        let pluck = Pluck {
            decay: 0.2,
            ..Pluck::default()
        };
        pluck.bent(RATE, 4.0, pitch)
    };
    let early_bend = |t: f64| {
        let up = ((t - 1.0) / 0.15).clamp(0.0, 1.0) - ((t - 2.2) / 0.15).clamp(0.0, 1.0);
        NOTE * 2.0_f64.powf(2.0 * up / 12.0)
    };
    for (name, pitch) in [
        ("bend", &early_bend as &dyn Fn(f64) -> f64),
        ("vibrato", &vibrato),
    ] {
        let input = loud(pitch);
        let out = Rig::<1>::new(RATE).run(&input);
        let error = following(&out, pitch, 1.0, 0.5, 3.8);
        assert!(error < 15.0, "loud {name}: {error:.1} cents off");
    }
}

#[test]
fn vibrato_is_followed_until_the_string_sinks_into_the_noise() {
    let input = fading_string(&vibrato, 32.0);
    let out = Rig::<1>::new(RATE).with(port::DRY, 0.0).run(&input);
    let error = following(&out, &vibrato, 1.0, 1.5, 20.0);
    assert!(error < 15.0, "vibrato followed {error:.1} cents off");
    // Once the string is below the hiss the last pitch is held, steadily.
    let held = readings(&out[at(RATE, 29.0)..]);
    let (low, high) = held
        .iter()
        .filter(|hertz| **hertz > 0.0)
        .fold((f64::MAX, 0.0_f64), |(lo, hi), hz| {
            (lo.min(*hz), hi.max(*hz))
        });
    assert!(
        cents(high, low) < 2.0,
        "the held note wavers by {:.1} cents",
        cents(high, low)
    );
    assert!(
        cents(low, NOTE).abs() < 35.0,
        "the held note is {:.1} cents off",
        cents(low, NOTE)
    );
    no_jumps(&input, 0.0, 60.0);
}

#[test]
fn bends_are_followed_at_6_12_and_18_seconds_in_every_mode() {
    let input = fading_string(&bends, 21.0);
    let out = Rig::<1>::new(RATE).with(port::DRY, 0.0).run(&input);
    let error = following(&out, &bends, 1.0, 1.0, 20.5);
    assert!(error < 15.0, "bends followed {error:.1} cents off");
    no_jumps(&input, 0.0, 230.0);
    // The harmonic follows in proportion, in Harmonic mode and once Mix has
    // bloomed.
    for mode in [1.0, 2.0] {
        let out = Rig::<1>::new(RATE)
            .with(port::DRY, 0.0)
            .with(port::MODE, mode)
            .with(port::BLOOM, 1000.0)
            .run(&input);
        let error = following(&out, &bends, 2.0, 3.0, 20.5);
        assert!(
            error < 15.0,
            "mode {mode}: the octave followed {error:.1} cents off"
        );
    }
}
