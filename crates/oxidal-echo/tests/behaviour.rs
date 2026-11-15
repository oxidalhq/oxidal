//! What each mode of Oxidal Echo is meant to do: repeats on time, tape that
//! glides, a bucket brigade that darkens, backwards windows, ducking, ping
//! pong and Hold.
//! @see docs/native-echo.md

mod common;

use common::*;
use oxidal_echo::controls::{self, DIVISIONS, Mode};

/// The sample at which the first repeat of an impulse peaks.
fn first_repeat(out: &[f32]) -> usize {
    let mut at = 0;
    for (i, x) in out.iter().enumerate() {
        if x.abs() > out[at].abs() {
            at = i;
        }
    }
    at
}

#[test]
fn the_first_digital_repeat_arrives_at_time_within_one_sample() {
    for rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        for milliseconds in [20.0_f32, 33.3, 250.0, 1234.5, 4000.0] {
            let mut rig = Rig::<2>::new(rate);
            rig.repeats_only().set(controls::TIME, milliseconds);
            let frames = rig.samples(milliseconds * 0.001 + 0.05);
            let out = rig.run(&impulse(frames));
            let expected = f64::from(milliseconds) * 0.001 * f64::from(rate);
            for side in &out {
                let at = first_repeat(side);
                assert!(
                    (at as f64 - expected).abs() <= 1.0,
                    "{milliseconds} ms at {rate}: {at}, not {expected}"
                );
                assert!(side[at].abs() > 0.8);
            }
        }
    }
}

#[test]
fn each_division_gives_the_right_delay_at_120_bpm() {
    let seconds = [
        2.0,
        1.5,
        1.0,
        0.75,
        0.5,
        0.375,
        1.0 / 3.0,
        0.25,
        1.0 / 6.0,
        0.125,
    ];
    assert_eq!(seconds.len(), DIVISIONS.len());
    for (rate, mode) in [
        (48_000.0_f32, Mode::Digital),
        (44_100.0, Mode::Digital),
        (96_000.0, Mode::Tape),
    ] {
        for (division, expected) in seconds.iter().enumerate() {
            let mut rig = Rig::<1>::new(rate);
            rig.mode(mode)
                .repeats_only()
                .set(controls::SYNC, 1.0)
                .set(controls::BPM, 120.0)
                .set(controls::DIVISION, division as f32)
                .set(controls::TIME, 77.0); // ignored while Sync is on
            let out = rig.run(&impulse(rig.samples(*expected as f32 + 0.05)));
            let at = first_repeat(&out[0]);
            let samples = expected * f64::from(rate);
            // Tape reads between samples, so its peak may sit one sample off.
            let slack = if mode == Mode::Tape { 2.0 } else { 1.0 };
            assert!(
                (at as f64 - samples).abs() <= slack,
                "{} at {rate}: {at}, not {samples}",
                DIVISIONS[division].0
            );
        }
        // At 90 BPM a dotted eighth is half a second.
        let mut rig = Rig::<1>::new(rate);
        rig.mode(mode)
            .repeats_only()
            .set(controls::SYNC, 1.0)
            .set(controls::BPM, 90.0)
            .set(controls::DIVISION, 5.0);
        let at = first_repeat(&rig.run(&impulse(rig.samples(0.6)))[0]);
        assert!((at as f64 - 0.5 * f64::from(rate)).abs() <= 2.0);
    }
}

#[test]
fn feedback_sets_how_fast_the_repeats_fall() {
    let mut rig = Rig::<1>::new(48_000.0);
    rig.repeats_only()
        .set(controls::TIME, 100.0)
        .set(controls::FEEDBACK, 50.0);
    let out = rig.run(&impulse(24_000));
    let repeats: Vec<f32> = (1..=4).map(|n| out[0][n * 4800].abs()).collect();
    for pair in repeats.windows(2) {
        // Each repeat is about half the one before (Tone, in the middle,
        // takes a little off the very top of a click).
        assert!((pair[1] / pair[0] - 0.5).abs() < 0.08, "{repeats:?}");
    }
}

#[test]
fn tape_glides_in_pitch_on_a_time_change_and_digital_does_not() {
    let rate = 48_000.0;
    let tone = sine(rate, 440.0, 0.4, 96_000);
    let run = |mode: Mode| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(mode).repeats_only().set(controls::TIME, 300.0);
        let out = rig.run_with(&tone, &tone, |at, values| {
            if at >= 48_000 {
                values[controls::TIME] = 200.0;
            }
        });
        out.into_iter().next().unwrap_or_default()
    };
    let tape = run(Mode::Tape);
    let digital = run(Mode::Digital);
    // Before the change both play the note as it is.
    assert!((frequency(&tape[24_000..48_000], rate) - 440.0).abs() < 1.0);
    assert!((frequency(&digital[24_000..48_000], rate) - 440.0).abs() < 1.0);
    // Shortening the delay speeds the tape up: the pitch rises, then returns.
    let gliding = frequency(&tape[48_480..50_400], rate);
    assert!(gliding > 440.0 * 1.3, "tape played {gliding} Hz");
    assert!((frequency(&tape[84_000..96_000], rate) - 440.0).abs() < 1.0);
    // Digital crossfades to the new position: the pitch never moves.
    let steady = frequency(&digital[48_000..57_600], rate);
    assert!(
        (steady - 440.0).abs() < 440.0 * 0.01,
        "digital played {steady} Hz"
    );
    // Bucket slides as tape does (its clock changes speed).
    let bucket = run(Mode::Bucket);
    assert!(frequency(&bucket[48_480..50_400], rate) > 440.0 * 1.3);
}

#[test]
fn tape_keeps_the_pitch_at_every_rate_and_wobbles_only_when_asked() {
    for rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        let tone = sine(rate, 440.0, 0.3, (rate * 2.0) as usize);
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Tape)
            .repeats_only()
            .set(controls::TIME, 250.0);
        let out = rig.run(&tone);
        let played = frequency(&out[0][rate as usize..], rate);
        assert!((played - 440.0).abs() < 0.5, "{played} Hz at {rate}");
    }
    // With Mod up, the pitch of the repeat moves around the note.
    let rate = 48_000.0;
    let tone = sine(rate, 440.0, 0.3, 240_000);
    let mut rig = Rig::<1>::new(rate);
    rig.mode(Mode::Tape)
        .repeats_only()
        .set(controls::TIME, 250.0)
        .set(controls::MOD, 100.0);
    let out = rig.run(&tone);
    let (mut lowest, mut highest) = (f64::MAX, f64::MIN);
    for window in out[0][48_000..].chunks_exact(2400) {
        let played = frequency(window, rate);
        lowest = lowest.min(played);
        highest = highest.max(played);
    }
    let cents = 1200.0 * (highest / lowest).log2();
    println!("tape wobble at full Mod: {lowest:.1} to {highest:.1} Hz ({cents:.0} cents)");
    assert!(cents > 8.0 && cents < 80.0, "{cents} cents");
}

#[test]
fn tape_age_darkens_and_saturates() {
    let rate = 48_000.0;
    let level = |age: f32, hertz: f64, amplitude: f64| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Tape)
            .repeats_only()
            .set(controls::TIME, 100.0)
            .set(controls::AGE, age);
        let out = rig.run(&sine(rate, hertz, amplitude, 48_000));
        amplitude_at(&out[0][24_000..], rate, hertz) / amplitude
    };
    // High loss grows with Age; a quiet low note passes either way.
    let (new, worn) = (level(0.0, 5000.0, 0.05), level(100.0, 5000.0, 0.05));
    println!(
        "tape at 5 kHz: new {:.1} dB, worn {:.1} dB",
        db(new),
        db(worn)
    );
    assert!(db(new) > -4.0 && db(worn) < db(new) - 10.0);
    assert!(db(level(0.0, 220.0, 0.05)).abs() < 1.0);
    assert!(db(level(100.0, 220.0, 0.05)).abs() < 1.5);
    // A loud note is squashed, more so on worn tape.
    let (new, worn) = (level(0.0, 220.0, 0.8), level(100.0, 220.0, 0.8));
    println!(
        "tape at 0.8 of full scale: new {:.1} dB, worn {:.1} dB",
        db(new),
        db(worn)
    );
    assert!(db(new) > -1.5 && db(worn) < db(new) - 2.0);
}

#[test]
fn heads_play_their_pattern_at_their_spacing() {
    let rate = 48_000.0;
    let run = |heads: f32, spacing: f32| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Heads)
            .repeats_only()
            .set(controls::TIME, 400.0)
            .set(controls::HEADS, heads)
            .set(controls::SPACING, spacing);
        rig.run(&impulse(24_000))
            .into_iter()
            .next()
            .unwrap_or_default()
    };
    let near = |out: &[f32], seconds: f32| {
        let at = (seconds * rate) as usize;
        peak(&out[at - 24..at + 24])
    };
    // All four heads, evenly spaced: repeats at 100, 200, 300 and 400 ms.
    let all = run(14.0, 0.0);
    for seconds in [0.1, 0.2, 0.3, 0.4] {
        assert!(near(&all, seconds) > 0.25, "no head at {seconds}");
    }
    assert!(near(&all, 0.15) < 0.01 && near(&all, 0.35) < 0.01);
    // Heads 2 and 4 only.
    let two = run(8.0, 0.0);
    assert!(near(&two, 0.2) > 0.3 && near(&two, 0.4) > 0.3);
    assert!(near(&two, 0.1) < 0.01 && near(&two, 0.3) < 0.01);
    // Golden spacing: 94.4, 152.8, 247.2 and 400 ms.
    let golden = run(14.0, 100.0);
    for seconds in [0.0944, 0.1528, 0.2472, 0.4] {
        assert!(near(&golden, seconds) > 0.25, "no head at {seconds}");
    }
    assert!(near(&golden, 0.2) < 0.01 && near(&golden, 0.3) < 0.01);
    // Feedback comes from the last sounding head: head 2 alone repeats
    // every 200 ms.
    let mut rig = Rig::<1>::new(rate);
    rig.mode(Mode::Heads)
        .repeats_only()
        .set(controls::TIME, 400.0)
        .set(controls::HEADS, 1.0)
        .set(controls::FEEDBACK, 80.0);
    let out = rig.run(&impulse(48_000));
    assert!(near(&out[0], 0.2) > 0.5 && near(&out[0], 0.4) > 0.3 && near(&out[0], 0.6) > 0.2);
    assert!(near(&out[0], 0.3) < 0.01);
    // In stereo the heads sit across the image at full Width.
    let mut wide = Rig::<2>::new(rate);
    wide.mode(Mode::Heads)
        .repeats_only()
        .set(controls::TIME, 400.0)
        .set(controls::WIDTH, 100.0);
    let out = wide.run(&impulse(24_000));
    assert!(near(&out[0], 0.1) > 0.25 && near(&out[1], 0.1) < 0.01);
    // (The right side also trails by 12 ms at full Width.)
    assert!(near(&out[1], 0.212) > 0.25 && near(&out[0], 0.2) < 0.01);
}

#[test]
fn bucket_bandwidth_falls_as_the_delay_time_rises() {
    let rate = 48_000.0;
    let level = |milliseconds: f32, hertz: f64| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Bucket)
            .repeats_only()
            .set(controls::TIME, milliseconds);
        let out = rig.run(&sine(rate, hertz, 0.2, 72_000));
        amplitude_at(&out[0][48_000..], rate, hertz) / 0.2
    };
    let short = level(100.0, 3000.0);
    let middle = level(250.0, 3000.0);
    let long = level(450.0, 3000.0);
    println!(
        "bucket at 3 kHz: 100 ms {:.1} dB, 250 ms {:.1} dB, 450 ms {:.1} dB",
        db(short),
        db(middle),
        db(long)
    );
    assert!(db(short) > -3.0);
    assert!(db(middle) < db(short) - 3.0);
    assert!(db(long) < db(middle) - 6.0);
    // The low end stays whatever the time.
    assert!(db(level(100.0, 300.0)).abs() < 1.5);
    assert!(db(level(450.0, 300.0)).abs() < 1.5);
}

#[test]
fn bucket_noise_rises_with_age_and_delay_time_and_stops_with_the_signal() {
    let rate = 48_000.0;
    // What the line adds besides the 220 Hz note and its low harmonics.
    let residue = |age: f32, milliseconds: f32| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Bucket)
            .repeats_only()
            .set(controls::TIME, milliseconds)
            .set(controls::AGE, age);
        let out = rig.run(&sine(rate, 220.0, 0.2, 96_000));
        let tail = &out[0][48_000..];
        let mut power = rms(tail).powi(2);
        for harmonic in 1..=9 {
            power -= 0.5 * amplitude_at(tail, rate, 220.0 * f64::from(harmonic)).powi(2);
        }
        power.max(0.0).sqrt()
    };
    let (clean, short, long) = (
        residue(0.0, 400.0),
        residue(100.0, 50.0),
        residue(100.0, 400.0),
    );
    println!("bucket noise: clean {clean:.5}, aged short {short:.5}, aged long {long:.5}");
    assert!(long > 3.0 * clean && long > 1.5 * short);
}

#[test]
fn reverse_plays_each_window_backwards() {
    for (rate, milliseconds) in [
        (48_000.0_f32, 100.0_f32),
        (44_100.0, 250.0),
        (96_000.0, 60.0),
    ] {
        let mut rig = Rig::<2>::new(rate);
        rig.mode(Mode::Reverse)
            .repeats_only()
            .set(controls::TIME, milliseconds);
        let window = rig.samples(milliseconds * 0.001);
        let input = noise(21, 0.5, 4 * window);
        let out = rig.run(&input);
        let fade = rig.samples(0.02).min(window / 4) + 1;
        for side in &out {
            for start in [window, 2 * window, 3 * window] {
                for a in fade..window {
                    // The window that ended at `start`, last sample first.
                    assert_eq!(side[start + a], input[start - 1 - a], "{rate} {start} {a}");
                }
            }
        }
    }
    // Past about 2.7 s the window stops growing (the memory holds two).
    let mut rig = Rig::<1>::new(48_000.0);
    rig.mode(Mode::Reverse)
        .repeats_only()
        .set(controls::TIME, 4000.0);
    let input = noise(22, 0.5, 48_000 * 6);
    let out = rig.run(&input);
    assert!(all_finite_within(&out, 1.0) && rms(&out[0][5 * 48_000..]) > 0.1);
}

#[test]
fn duck_lowers_the_repeats_while_you_play() {
    let rate = 48_000.0;
    let mut playing = sine(rate, 220.0, 0.3, 48_000);
    playing.extend(silence(48_000));
    let wet = |amount: f32| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Duck)
            .set(controls::TIME, 200.0)
            .set(controls::FEEDBACK, 70.0)
            .set(controls::MIX, 50.0)
            .set(controls::MOD, amount);
        let out = rig.run(&playing);
        let repeats: Vec<f32> = out[0].iter().zip(&playing).map(|(y, x)| y - x).collect();
        // While playing, and in the gap once the follower has let go.
        (rms(&repeats[24_000..48_000]), rms(&repeats[72_000..84_000]))
    };
    let (under, gap) = wet(100.0);
    let (open_under, open_gap) = wet(0.0);
    let (half_under, _) = wet(50.0);
    println!("duck: under {under:.4}, gap {gap:.4}; without {open_under:.4}, {open_gap:.4}");
    assert!(under < 0.05 * open_under, "repeats were not ducked");
    assert!(gap > 0.8 * open_gap, "repeats did not come back");
    assert!(gap > 10.0 * under);
    assert!(db(half_under / open_under) < -4.0 && db(half_under / open_under) > -8.0);
}

#[test]
fn filter_sweeps_a_resonance_through_the_repeats() {
    let rate = 48_000.0;
    let input = noise(8, 0.3, 96_000);
    let balance = |depth: f32| {
        let mut rig = Rig::<1>::new(rate);
        rig.mode(Mode::Filter)
            .repeats_only()
            .set(controls::TIME, 250.0)
            .set(controls::MOD, depth);
        let out = rig.run(&input);
        // Brightness of the repeats in each 50 ms: energy of the sample
        // differences over the energy of the samples.
        out[0][24_000..]
            .chunks_exact(2400)
            .map(|chunk| {
                let steps: Vec<f32> = chunk.windows(2).map(|pair| pair[1] - pair[0]).collect();
                rms(&steps) / rms(chunk).max(1.0e-9)
            })
            .collect::<Vec<f64>>()
    };
    let spread = |values: &[f64]| {
        let (low, high) = values
            .iter()
            .fold((f64::MAX, f64::MIN), |(l, h), v| (l.min(*v), h.max(*v)));
        high / low
    };
    let (still, swept) = (spread(&balance(0.0)), spread(&balance(100.0)));
    println!("filter brightness range: still {still:.2}, swept {swept:.2}");
    assert!(still < 1.2 && swept > 2.0);
}

#[test]
fn ping_alternates_sides_and_is_digital_in_mono() {
    let rate = 48_000.0;
    let mut rig = Rig::<2>::new(rate);
    rig.mode(Mode::Ping)
        .repeats_only()
        .set(controls::TIME, 100.0)
        .set(controls::FEEDBACK, 70.0)
        .set(controls::WIDTH, 100.0);
    let out = rig.run(&impulse(28_800));
    let near = |side: &[f32], n: usize| peak(&side[n * 4800 - 8..n * 4800 + 8]);
    let mut previous = f32::MAX;
    for n in 1..=5 {
        let (here, there) = if n % 2 == 1 { (0, 1) } else { (1, 0) };
        let (loud, quiet) = (near(&out[here], n), near(&out[there], n));
        assert!(
            loud > 0.1 && quiet < 1.0e-4,
            "repeat {n}: {loud} and {quiet}"
        );
        assert!(loud < previous);
        previous = loud;
    }
    // Width at zero puts every repeat in the middle.
    rig.echo = oxidal_lv2_plugin::Plugin::new(rate);
    rig.set(controls::WIDTH, 0.0);
    let out = rig.run(&impulse(28_800));
    for n in 1..=5 {
        assert!((near(&out[0], n) - near(&out[1], n)).abs() < 1.0e-6);
    }
    // The mono plugin has no sides: Ping there is Digital.
    let input = pluck(rate, 196.0, 0.3, 48_000);
    let (mut ping, mut digital) = (Rig::<1>::new(rate), Rig::<1>::new(rate));
    ping.mode(Mode::Ping).set(controls::FEEDBACK, 60.0);
    digital.mode(Mode::Digital).set(controls::FEEDBACK, 60.0);
    assert!(ping.run(&input) == digital.run(&input));
}

#[test]
fn width_spreads_the_repeats_and_zero_keeps_them_mono() {
    let rate = 48_000.0;
    let input = pluck(rate, 196.0, 0.4, 48_000);
    for mode in Mode::ALL {
        let mut rig = Rig::<2>::new(rate);
        rig.mode(mode)
            .set(controls::WIDTH, 0.0)
            .set(controls::MIX, 100.0);
        let narrow = rig.run(&input);
        assert!(narrow[0] == narrow[1], "{mode:?} is not mono at Width 0");
        let mut rig = Rig::<2>::new(rate);
        rig.mode(mode)
            .set(controls::WIDTH, 100.0)
            .set(controls::MIX, 100.0);
        let wide = rig.run(&input);
        let difference: Vec<f32> = wide[0].iter().zip(&wide[1]).map(|(l, r)| l - r).collect();
        assert!(
            rms(&difference) > 0.1 * rms(&wide[0]),
            "{mode:?} is not wide"
        );
    }
    // At full Width the right repeat trails the left by 12 ms.
    let mut rig = Rig::<2>::new(rate);
    rig.repeats_only()
        .set(controls::TIME, 200.0)
        .set(controls::WIDTH, 100.0);
    let out = rig.run(&impulse(14_400));
    assert_eq!(first_repeat(&out[0]), 9600);
    assert!((first_repeat(&out[1]) as i64 - (9600 + 576)).abs() <= 1);
}

/// Level of each loop of a held sound, in dB relative to the first.
fn held_levels(mode: Mode, seconds: usize) -> Vec<f64> {
    let rate = 48_000.0;
    let mut rig = Rig::<2>::new(rate);
    rig.mode(mode)
        .set(controls::TIME, 250.0)
        .set(controls::FEEDBACK, 40.0)
        .set(controls::MIX, 50.0);
    rig.run(&pluck(rate, 196.0, 0.2, 24_000));
    rig.set(controls::HOLD, 1.0);
    // Playing on top of a held loop adds nothing to it.
    let mut input = pluck(rate, 330.0, 0.3, 48_000);
    input.extend(silence(seconds * 48_000 - 48_000));
    let out = rig.run(&input);
    // The loops are measured from two seconds on (Duck needs the playing
    // to have stopped before it lets the loop up again).
    let loops: Vec<f64> = out[0][96_000..].chunks_exact(24_000).map(rms).collect();
    assert!(loops[0] > 0.01, "{mode:?} holds nothing");
    loops.iter().map(|level| db(level / loops[0])).collect()
}

#[test]
fn hold_keeps_looping_at_the_same_level() {
    for mode in Mode::ALL {
        let levels = held_levels(mode, 8);
        let (low, high) = levels
            .iter()
            .fold((f64::MAX, f64::MIN), |(l, h), v| (l.min(*v), h.max(*v)));
        println!("{mode:?}: held loops within {low:.2} to {high:.2} dB");
        assert!(low > -1.0 && high < 1.0, "{mode:?}: {low} to {high} dB");
    }
    // Releasing Hold lets the loop die away as an ordinary echo.
    let mut rig = Rig::<1>::new(48_000.0);
    rig.set(controls::TIME, 100.0)
        .set(controls::FEEDBACK, 30.0)
        .set(controls::MIX, 50.0)
        .set(controls::HOLD, 1.0);
    rig.run(&silence(4800));
    rig.set(controls::HOLD, 0.0);
    rig.run(&pluck(48_000.0, 196.0, 0.2, 9600));
    rig.set(controls::HOLD, 1.0);
    assert!(rms(&rig.run(&silence(96_000))[0][48_000..]) > 0.01);
    rig.set(controls::HOLD, 0.0);
    assert!(peak(&rig.run(&silence(96_000))[0][72_000..]) < 1.0e-6);
}

/// The full-length version: about a minute in a debug build, so it runs on
/// request with `cargo test --release -- --ignored`.
#[test]
#[ignore = "long: run with --release -- --ignored"]
fn hold_keeps_looping_for_sixty_seconds_within_one_decibel() {
    for mode in Mode::ALL {
        let levels = held_levels(mode, 61);
        let (low, high) = levels
            .iter()
            .fold((f64::MAX, f64::MIN), |(l, h), v| (l.min(*v), h.max(*v)));
        println!("{mode:?}: 60 s of Hold within {low:.2} to {high:.2} dB");
        assert!(low > -1.0 && high < 1.0, "{mode:?}: {low} to {high} dB");
    }
}

#[test]
fn a_change_of_mode_keeps_the_tail() {
    let rate = 48_000.0;
    let mut input = pluck(rate, 196.0, 0.3, 9600);
    input.extend(silence(62_400));
    let tail_after = |to: Mode| {
        let mut rig = Rig::<1>::new(rate);
        rig.set(controls::TIME, 150.0)
            .set(controls::FEEDBACK, 80.0)
            .set(controls::MIX, 50.0)
            .set(controls::MOD, 0.0);
        let target = Mode::ALL.iter().position(|m| *m == to).unwrap_or(0) as f32;
        let out = rig.run_with(&input, &input, |at, values| {
            if at >= 48_000 {
                values[controls::MODE] = target;
            }
        });
        rms(&out[0][50_400..62_400])
    };
    let reference = tail_after(Mode::Digital);
    assert!(reference > 0.005);
    for mode in Mode::ALL {
        let ratio = tail_after(mode) / reference;
        println!("{mode:?}: tail after the switch at {:.1} dB", db(ratio));
        assert!(ratio > 0.3 && ratio < 2.0, "{mode:?}: {ratio}");
    }
}

#[test]
fn the_default_sound_is_about_as_loud_as_the_dry_guitar() {
    let rate = 48_000.0;
    // Dry and repeats add or cancel a little depending on the note and the
    // delay, so each case may sit up to 2 dB off and the average within 1.
    let mut changes = Vec::new();
    for hertz in [110.0, 147.0, 196.0, 262.0, 330.0] {
        let input = pluck(rate, hertz, 0.6, 192_000);
        let mut mono = Rig::<1>::new(rate);
        let mut stereo = Rig::<2>::new(rate);
        let (one, two) = (mono.run(&input), stereo.run(&input));
        let dry = rms(&input[48_000..]);
        for side in one.iter().chain(&two) {
            let change = db(rms(&side[48_000..]) / dry);
            changes.push(change);
        }
    }
    let average = changes.iter().sum::<f64>() / changes.len() as f64;
    println!("default level: {average:+.2} dB on average, {changes:.2?}");
    assert!(average.abs() < 1.0, "{average} dB");
    assert!(changes.iter().all(|change| change.abs() < 2.0));
}
