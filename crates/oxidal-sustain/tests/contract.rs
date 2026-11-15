//! The rules every Oxidal effect keeps: silence stays silent, output stays
//! bounded, block size does not matter, Off is exactly the input, controls
//! never click, every rate works, and the control table matches the TTL.
//! @see docs/native-sustain.md

mod common;

use common::*;
use oxidal_lv2_plugin::Plugin;
use oxidal_sustain::engine::Voice;
use oxidal_sustain::{CONTROLS, Sustain, port};

const RATE: f32 = 48_000.0;

/// A note that has died by 3 s, with silence after it up to `seconds`.
fn short_note(rate: f32, frequency: f64, seconds: f64) -> Vec<f32> {
    let pluck = Pluck {
        decay: 3.0,
        ..Pluck::default()
    };
    let mut input = pluck.note(rate, 3.0, frequency);
    input.resize(at(rate, seconds), 0.0);
    input
}

#[test]
fn silence_in_gives_silence_out_in_every_mode() {
    let silence = vec![0.0; at(RATE, 2.0)];
    for mode in [0.0, 1.0, 2.0] {
        let mut mono = Rig::<1>::new(RATE).with(port::MODE, mode);
        assert_eq!(peak(&mono.run(&silence)), 0.0, "mono, mode {mode}");
        let mut stereo = Rig::<2>::new(RATE).with(port::MODE, mode);
        let (left, right) = stereo.run_with(&silence, &silence, |_, _| {});
        assert_eq!(peak(&left) + peak(&right), 0.0, "stereo, mode {mode}");
        // After a note has been muted its tail ends and silence returns.
        let mut note = Pluck::default().note(RATE, 1.0, 196.0);
        mute(&mut note, at(RATE, 0.8), 200);
        note.resize(at(RATE, 2.0), 0.0);
        let out = Rig::<1>::new(RATE).with(port::MODE, mode).run(&note);
        assert!(peak(&out[at(RATE, 0.5)..at(RATE, 0.8)]) > 0.01);
        assert_eq!(peak(&out[at(RATE, 1.2)..]), 0.0, "tail, mode {mode}");
    }
}

#[test]
fn output_stays_finite_and_bounded_at_the_extreme_settings() {
    // Everything at its most: full Drive, Level and Sensitivity, the
    // shortest Bloom, the brightest Tone and the highest harmonic.
    let extreme = |mode: f32| {
        Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::HARMONIC, 2.0)
            .with(port::DRIVE, 100.0)
            .with(port::BLOOM, 100.0)
            .with(port::SENSITIVITY, 100.0)
            .with(port::TONE, 100.0)
            .with(port::LEVEL, 6.0)
    };
    let seconds = 10.0;
    let mut impulse = vec![0.0; at(RATE, seconds)];
    impulse[100] = 1.0;
    // A full-scale tone that fades out by itself, then silence: the sustain
    // carries on at the tone's level, doubled by Level.
    let tone: Vec<f32> = (0..at(RATE, seconds))
        .map(|i| {
            let t = i as f32 / RATE;
            let fade = if t < 3.0 {
                1.0
            } else {
                (-(t - 3.0) * 2.0).exp()
            };
            fade * (core::f32::consts::TAU * 220.0 * t).sin()
        })
        .collect();
    for mode in [0.0, 1.0, 2.0] {
        let (left, right) = extreme(mode).run_with(&impulse, &impulse, |_, _| {});
        assert!(left.iter().chain(&right).all(|x| x.is_finite()));
        assert!(
            peak(&left) <= 1.0 && peak(&right) <= 1.0,
            "impulse, mode {mode}"
        );
        let mut rig = extreme(mode);
        let (left, right) = rig.run_with(&tone, &tone, |_, _| {});
        assert!(left.iter().chain(&right).all(|x| x.is_finite()));
        let top = peak(&left).max(peak(&right));
        assert!(top <= 3.0, "tone, mode {mode}: peak {top}");
        // It did sustain: this is the loop at full strength, not silence.
        assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
        assert!(rms(&left[at(RATE, 9.0)..]) > 0.5, "tone, mode {mode}");
        // No offset builds up in the sustained sound.
        let tail = &left[at(RATE, 8.0)..];
        let mean = tail.iter().map(|x| f64::from(*x)).sum::<f64>() / tail.len() as f64;
        assert!(mean.abs() < 1.0e-3, "tone, mode {mode}: offset {mean}");
    }
}

#[test]
fn the_block_size_does_not_change_the_output() {
    // Two notes, a chord and a mute: every path, in every mode.
    let mut input = Pluck::default().note(RATE, 0.6, 110.0);
    mute(&mut input, at(RATE, 0.598), 96);
    input.resize(at(RATE, 2.6), 0.0);
    add_at(
        &mut input,
        &Pluck::default().note(RATE, 0.5, 196.0),
        at(RATE, 0.6),
    );
    mute(&mut input, at(RATE, 1.0), 200);
    for note in [164.81, 207.65, 246.94] {
        let string = Pluck::default().note(RATE, 1.2, note);
        add_at(&mut input, &string, at(RATE, 1.3));
    }
    for mode in [0.0, 1.0, 2.0] {
        let mut reference = Vec::new();
        for block in [96, 1, 32, 1024] {
            let mut rig = Rig::<1>::new(RATE).with(port::MODE, mode);
            rig.block = block;
            let out = rig.run(&input);
            assert_eq!(rig.plugin.engine().voice(), Voice::Chord);
            if reference.is_empty() {
                reference = out;
                continue;
            }
            let worst = out
                .iter()
                .zip(&reference)
                .fold(0.0_f32, |top, (a, b)| top.max((a - b).abs()));
            assert!(
                worst <= 1.0e-6,
                "mode {mode}, block {block}: differs by {worst}"
            );
        }
    }
}

#[test]
fn off_is_exactly_the_input() {
    let left = short_note(RATE, 146.83, 5.0);
    let right: Vec<f32> = noise(left.len(), 0.002, 11)
        .iter()
        .zip(&left)
        .map(|(n, x)| n - 0.5 * x)
        .collect();
    // Off from the start, whatever Dry says.
    for dry in [0.0, 1.0] {
        let mut rig = Rig::<2>::new(RATE).with(port::ON, 0.0).with(port::DRY, dry);
        let (out_left, out_right) = rig.run_with(&left, &right, |_, _| {});
        assert!(
            out_left == left && out_right == right,
            "Off changed the signal"
        );
    }
    // Switched off while a note is being held: exact again 100 ms later.
    let mut rig = Rig::<2>::new(RATE);
    let off_at = at(RATE, 3.5);
    let (out_left, out_right) = rig.run_with(&left, &right, |rig, i| {
        if i >= off_at {
            rig.controls[port::ON] = 0.0;
        }
    });
    assert!(
        peak(&out_left[at(RATE, 3.3)..off_at]) > 0.02,
        "nothing was held"
    );
    let settled = at(RATE, 3.6);
    assert!(out_left[settled..] == left[settled..] && out_right[settled..] == right[settled..]);
    // And switching it off is a fade, not a cut.
    let usual = steepest(&out_left[at(RATE, 3.3)..off_at]);
    assert!(steepest(&out_left[off_at - 1..settled]) <= 1.25 * usual);
    // Level at its lowest with Dry on is the input plus a sustain 24 dB down.
    let quiet = Rig::<1>::new(RATE).with(port::LEVEL, -24.0).run(&left);
    let full = Rig::<1>::new(RATE).run(&left);
    let tail = at(RATE, 4.0);
    let ratio = db(rms(&quiet[tail..]) / rms(&full[tail..]));
    assert!(
        (ratio + 24.0).abs() < 0.5,
        "Level -24 dB gave {ratio:.2} dB"
    );
}

/// Holds a note with `port` at `from`, sweeps it to `to` over half a second
/// while the note is held, and compares the steepest step of the sweep with
/// that of the held note at either end of it.
fn sweep(mode: f32, port: usize, from: f32, to: f32) {
    let input = short_note(RATE, 146.83, 6.0);
    let (start, end) = (at(RATE, 4.0), at(RATE, 4.5));
    let mut rig = Rig::<1>::new(RATE).with(port::MODE, mode).with(port, from);
    let out = rig.run_changing(&input, |rig, i| {
        let along = (i.saturating_sub(start)) as f32 / (end - start) as f32;
        rig.controls[port] = from + (to - from) * along.clamp(0.0, 1.0);
    });
    let before = steepest(&out[at(RATE, 3.5)..start]);
    let after = steepest(&out[at(RATE, 5.5)..]);
    let during = steepest(&out[start - 1..at(RATE, 5.0)]);
    let symbol = CONTROLS[port].symbol;
    assert!(before > 0.0 && after > 0.0, "{symbol}: nothing was held");
    assert!(
        during <= 1.25 * before.max(after),
        "{symbol} {from} to {to} in mode {mode}: stepped {during}, held note {before} and {after}"
    );
}

#[test]
fn every_continuous_control_sweeps_without_a_step() {
    for mode in [0.0, 1.0, 2.0] {
        for port in [
            port::DRIVE,
            port::BLOOM,
            port::SENSITIVITY,
            port::TONE,
            port::LEVEL,
        ] {
            let (low, high) = (CONTROLS[port].minimum, CONTROLS[port].maximum);
            sweep(mode, port, low, high);
            sweep(mode, port, high, low);
        }
    }
}

/// Changes a switch or choice while a note is held. The two voices cross
/// over, so the bound is the sum of their own steepest steps.
fn switch(setup: &[(usize, f32)], port: usize, to: f32) {
    let input = short_note(RATE, 146.83, 6.0);
    let change = at(RATE, 4.0);
    let mut rig = Rig::<1>::new(RATE).with(port::BLOOM, 300.0);
    for (port, value) in setup {
        rig.controls[*port] = *value;
    }
    let out = rig.run_changing(&input, |rig, i| {
        if i >= change {
            rig.controls[port] = to;
        }
    });
    let before = steepest(&out[at(RATE, 3.5)..change]);
    let after = steepest(&out[at(RATE, 5.5)..]);
    let during = steepest(&out[change - 1..at(RATE, 4.5)]);
    let symbol = CONTROLS[port].symbol;
    assert!(before + after > 0.0, "{symbol}: nothing was held");
    assert!(
        during <= 1.1 * (before + after),
        "{symbol} to {to} from {setup:?}: stepped {during}, voices {before} and {after}"
    );
}

#[test]
fn switching_mode_harmonic_dry_and_on_mid_note_does_not_click() {
    for (from, to) in [
        (0.0, 1.0),
        (1.0, 0.0),
        (0.0, 2.0),
        (2.0, 1.0),
        (1.0, 2.0),
        (2.0, 0.0),
    ] {
        switch(&[(port::MODE, from)], port::MODE, to);
    }
    for (from, to) in [(0.0, 1.0), (1.0, 2.0), (2.0, 0.0), (0.0, 2.0)] {
        switch(
            &[(port::MODE, 1.0), (port::HARMONIC, from)],
            port::HARMONIC,
            to,
        );
    }
    switch(&[], port::DRY, 0.0);
    switch(&[(port::DRY, 0.0)], port::DRY, 1.0);
    switch(&[], port::ON, 0.0);
    // Switching On while a real string rings brings the sustain in smoothly.
    let pluck = Pluck {
        decay: 0.5,
        ..Pluck::default()
    };
    let input = pluck.note(RATE, 4.0, 146.83);
    let mut rig = Rig::<1>::new(RATE).with(port::ON, 0.0);
    let out = rig.run_changing(&input, |rig, i| {
        if i >= at(RATE, 1.0) {
            rig.controls[port::ON] = 1.0;
        }
    });
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
    let added: Vec<f32> = out.iter().zip(&input).map(|(o, i)| o - i).collect();
    assert!(
        rms(&added[at(RATE, 3.0)..]) > 0.01,
        "switching On started nothing"
    );
    assert!(steepest(&added[..at(RATE, 2.0)]) <= steepest(&added[at(RATE, 3.0)..]) * 1.25);
}

#[test]
fn every_sample_rate_keeps_pitch_level_and_times() {
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        let mut input = Pluck::default().note(rate, 5.0, 196.0);
        mute(&mut input, at(rate, 7.0), at(rate, 0.004));
        input.resize(at(rate, 8.0), 0.0);
        // A second note, muted at 1.5 s after it is picked.
        let mut second = Pluck::default().note(rate, 2.0, 246.94);
        mute(&mut second, at(rate, 1.5), at(rate, 0.004));
        input.resize(at(rate, 12.0), 0.0);
        add_at(&mut input, &second, at(rate, 8.0));
        let target = rms(&input[at(rate, 0.05)..at(rate, 0.15)])
            * 10.0_f64.powf(f64::from(default_plateau_db()) / 20.0);
        let out = Rig::<1>::new(rate).run(&input);
        // Pitch and level of the first note, held alone.
        let held = &out[at(rate, 6.5)..at(rate, 7.5)];
        let off = cents(frequency(held, rate, 196.0), 196.0);
        assert!(off.abs() < 10.0, "{rate} Hz: {off:+.2} cents");
        let level = db(rms(held) / target);
        assert!(level.abs() < 3.0, "{rate} Hz: {level:+.2} dB");
        // The new note took over within 150 ms...
        let old = amplitude(&out[at(rate, 8.15)..at(rate, 8.45)], rate, 196.0);
        assert!(
            db(old / target) < -40.0,
            "{rate} Hz: old note left at {old}"
        );
        // ...and its mute released it within 300 ms.
        assert!(
            peak(&out[at(rate, 9.3)..at(rate, 9.5)]) > 0.02,
            "{rate} Hz: not held"
        );
        assert_eq!(peak(&out[at(rate, 9.8)..]), 0.0, "{rate} Hz: mute too slow");
    }
}

#[test]
fn the_stereo_plugin_keeps_the_dry_signal_in_stereo() {
    let left = short_note(RATE, 196.0, 6.0);
    let right: Vec<f32> = left.iter().map(|x| -0.4 * x).collect();
    let mut rig = Rig::<2>::new(RATE);
    let (out_left, out_right) = rig.run_with(&left, &right, |_, _| {});
    assert_eq!(rig.plugin.engine().voice(), Voice::Driver);
    // The pick passes untouched on both sides.
    let early = at(RATE, 0.02);
    assert!(out_left[..early] == left[..early] && out_right[..early] == right[..early]);
    // Once the strings are silent both sides carry the same held note.
    let tail = at(RATE, 5.0);
    assert!(rms(&out_left[tail..]) > 0.01);
    assert_eq!(out_left[tail..], out_right[tail..]);
    // The mono plugin holds the same kind of note from one channel.
    let mono = Rig::<1>::new(RATE).run(&left);
    assert!(db(rms(&mono[tail..]) / rms(&out_left[tail..])).abs() < 12.0);
    // One side silent: the note is still found and held.
    let silent = vec![0.0; left.len()];
    let (one, other) = Rig::<2>::new(RATE).run_with(&left, &silent, |_, _| {});
    assert!(rms(&one[tail..]) > 0.005 && one[tail..] == other[tail..]);
}

#[test]
fn wild_control_values_never_panic_and_stay_bounded() {
    let wild = [
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::MAX,
        f32::MIN,
        -1.0e9,
        1.0e9,
        -0.0,
        0.5,
        1.0e-30,
        3.0,
        -3.0,
    ];
    let mut input = Pluck::default().note(RATE, 3.0, 110.0);
    add_at(&mut input, &noise(at(RATE, 3.0), 0.01, 9), 0);
    add_at(
        &mut input,
        &Pluck::default().note(RATE, 1.0, 329.63),
        at(RATE, 1.5),
    );
    input[5000] = f32::NAN;
    input[5001] = f32::INFINITY;
    let mut rig = Rig::<2>::new(RATE);
    rig.block = 64;
    let mut turn = 0_usize;
    let (left, right) = rig.run_with(&input, &input, |rig, _| {
        turn += 1;
        for (index, control) in rig.controls.iter_mut().enumerate() {
            *control = wild[(turn / (index + 1) + 5 * index) % wild.len()];
        }
    });
    assert!(
        left.iter()
            .chain(&right)
            .all(|x| x.is_finite() && x.abs() < 8.0)
    );
    // Too few controls, no audio, and odd rates do not panic either.
    let mut plugin = Sustain::<2>::new(1.0);
    let mut out = [vec![0.0_f32; 16], vec![0.0_f32; 16]];
    let [out_left, out_right] = &mut out;
    plugin.process(&[], &[&[0.5; 16], &[0.5; 16]], &mut [out_left, out_right]);
    plugin.process(&[1.0; 2], &[], &mut []);
    for rate in [
        0.0,
        -44_100.0,
        f32::NAN,
        f32::INFINITY,
        8000.0,
        192_000.0,
        1.0e9,
    ] {
        let mut plugin = Sustain::<1>::new(rate);
        plugin.reset();
        let mut out = vec![0.0_f32; 512];
        for _ in 0..40 {
            plugin.process(&[], &[&input[..512]], &mut [&mut out]);
        }
        assert!(out.iter().all(|x| x.is_finite()), "rate {rate}");
    }
}

/// The number after `key` in a TTL port description.
fn number(port: &str, key: &str) -> f32 {
    let rest = port
        .split(key)
        .nth(1)
        .unwrap_or_else(|| panic!("no {key} in {port}"));
    rest.trim_start()
        .split([' ', ';'])
        .next()
        .and_then(|word| word.parse().ok())
        .unwrap_or_else(|| panic!("no number after {key} in {port}"))
}

fn symbol(port: &str) -> &str {
    port.split("lv2:symbol \"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .unwrap_or_else(|| panic!("no symbol in {port}"))
}

#[test]
fn the_control_table_matches_the_ttl_file() {
    let ttl = include_str!("../lv2/sustain.ttl");
    let plugins: Vec<&str> = ttl.split("<urn:oxidal:plugin:sustain#").skip(1).collect();
    assert_eq!(plugins.len(), 2);
    for (plugin, audio) in plugins.iter().zip([
        vec!["in_l", "out_l"],
        vec!["in_l", "in_r", "out_l", "out_r"],
    ]) {
        let ports: Vec<&str> = plugin.split("[ a lv2:").skip(1).collect();
        assert_eq!(ports.len(), CONTROLS.len() + audio.len());
        for (index, control) in CONTROLS.iter().enumerate() {
            let port = ports[index];
            assert!(port.starts_with("InputPort, lv2:ControlPort"), "{port}");
            assert_eq!(number(port, "lv2:index"), index as f32);
            assert_eq!(symbol(port), control.symbol);
            assert_eq!(
                number(port, "lv2:minimum"),
                control.minimum,
                "{}",
                control.symbol
            );
            assert_eq!(
                number(port, "lv2:maximum"),
                control.maximum,
                "{}",
                control.symbol
            );
            assert_eq!(
                number(port, "lv2:default"),
                control.default,
                "{}",
                control.symbol
            );
            assert!(control.minimum <= control.default && control.default <= control.maximum);
        }
        for (offset, name) in audio.iter().enumerate() {
            let port = ports[CONTROLS.len() + offset];
            assert!(port.contains("lv2:AudioPort"), "{port}");
            assert_eq!(port.starts_with("InputPort"), name.starts_with("in"));
            assert_eq!(number(port, "lv2:index"), (CONTROLS.len() + offset) as f32);
            assert_eq!(symbol(port), *name);
        }
    }
    assert_eq!(<Sustain<1> as Plugin>::CONTROLS, CONTROLS.len());
    assert_eq!(<Sustain<2> as Plugin>::CHANNELS, 2);
}
