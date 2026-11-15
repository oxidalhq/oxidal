//! Behaviour of the whole effect, driven through the `Plugin` trait as a host
//! drives it. Long versions of the two slowest checks are marked `ignore`;
//! run them with `cargo test --release -p oxidal-bloom -- --ignored`.
//! @see docs/native-bloom.md
mod support;

use oxidal_bloom::{Bloom, CONTROLS, defaults};
use oxidal_lv2_plugin::Plugin;
use support::*;

const RATE: f32 = 48_000.0;
/// The largest change from one sample to the next that a control change or a
/// mode switch may cause on a 110 Hz tone at a quarter of full scale. The
/// tone itself moves by 0.0036 a sample; a click is a step of 0.1 or more.
const MAX_STEP: f32 = 0.02;

fn tone(seconds: f32) -> Vec<f32> {
    sine(RATE, seconds, 110.0, 0.25)
}

#[test]
fn the_control_table_matches_the_ttl_file() {
    let ttl = include_str!("../lv2/bloom.ttl");
    let field = |line: &str, key: &str| -> Option<String> {
        let rest = &line[line.find(key)? + key.len()..];
        let rest = rest.trim_start().trim_start_matches('"');
        let end = rest.find(['"', ' ', ';']).unwrap_or(rest.len());
        Some(rest[..end].to_string())
    };
    let plugins: Vec<&str> = ttl.split("<urn:oxidal:plugin:bloom#").skip(1).collect();
    assert_eq!(plugins.len(), 2);
    for (plugin, audio) in plugins.iter().zip([
        vec!["in_l", "out_l"],
        vec!["in_l", "in_r", "out_l", "out_r"],
    ]) {
        let ports: Vec<&str> = plugin
            .lines()
            .filter(|line| line.contains("lv2:index"))
            .collect();
        assert_eq!(ports.len(), CONTROLS.len() + audio.len());
        for (index, (line, control)) in ports.iter().zip(CONTROLS).enumerate() {
            let number = |key: &str| field(line, key).unwrap().parse::<f32>().unwrap();
            assert!(line.contains("lv2:InputPort, lv2:ControlPort"), "{line}");
            assert_eq!(number("lv2:index "), index as f32);
            assert_eq!(field(line, "lv2:symbol ").unwrap(), control.symbol);
            assert_eq!(
                number("lv2:minimum "),
                control.minimum,
                "{}",
                control.symbol
            );
            assert_eq!(
                number("lv2:maximum "),
                control.maximum,
                "{}",
                control.symbol
            );
            assert_eq!(
                number("lv2:default "),
                control.default,
                "{}",
                control.symbol
            );
            if line.contains("logarithmic") {
                assert!(control.minimum > 0.0);
            }
        }
        for (offset, (line, symbol)) in ports[CONTROLS.len()..].iter().zip(&audio).enumerate() {
            assert!(line.contains("lv2:AudioPort"));
            assert_eq!(
                field(line, "lv2:index ").unwrap().parse::<usize>().unwrap(),
                CONTROLS.len() + offset
            );
            assert_eq!(&field(line, "lv2:symbol ").unwrap(), symbol);
            let direction = if symbol.starts_with("in") {
                "lv2:InputPort"
            } else {
                "lv2:OutputPort"
            };
            assert!(line.contains(direction));
        }
    }
    assert_eq!(<Bloom<1> as Plugin>::CONTROLS, CONTROLS.len());
    assert_eq!(<Bloom<2> as Plugin>::CHANNELS, 2);
    assert_eq!(ttl.matches("rdfs:label").count(), 2 * (8 + 3 + 3));
}

#[test]
fn silence_in_gives_silence_out_once_the_tail_has_ended() {
    for mode in MODES {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::DECAY, 0.4);
        let (l, r) = rig.silence(0.2);
        assert!(l.iter().chain(&r).all(|x| *x == 0.0), "mode {mode} hums");
        rig.run(&plucks(RATE, 0.8, 196.0, 1.5, 0.5), 96);
        let (l, r) = rig.silence(5.0);
        let last = l.len() - 24_000;
        assert!(peak(&l[..24_000]) > 1.0e-4, "mode {mode} has no tail");
        assert!(
            l[last..].iter().chain(&r[last..]).all(|x| *x == 0.0),
            "mode {mode} never falls silent"
        );
    }
}

/// Every control at the end that stresses the mode most.
fn extreme(mode: f32, build: f32) -> Rig<2> {
    Rig::<2>::new(RATE)
        .with(port::MODE, mode)
        .with(port::DECAY, 60.0)
        .with(port::SIZE, 100.0)
        .with(port::TONE, 100.0)
        .with(port::LOWCUT, 20.0)
        .with(port::MOD, 100.0)
        .with(port::SPEED, 100.0)
        .with(port::SHIMMER, 100.0)
        .with(port::BUILD, build)
        .with(port::MIX, 100.0)
}

fn extremes_stay_bounded_for(seconds: f32) {
    for mode in MODES {
        let mut loudest = 0.0_f32;
        for build in [0.1, 5.0] {
            let mut rig = extreme(mode, build);
            let (l, r) = rig.run(&impulse(RATE, seconds, 1.0), 96);
            assert!(all_finite(&l) && all_finite(&r), "mode {mode}");
            loudest = loudest.max(peak(&l)).max(peak(&r));
            let mut rig = extreme(mode, build);
            let loud: Vec<f32> = sine(RATE, seconds, 220.0, 0.9)
                .iter()
                .zip(sine(RATE, seconds, 1661.0, 0.4))
                .map(|(a, b)| a + b)
                .collect();
            let (l, r) = rig.run(&loud, 96);
            assert!(all_finite(&l) && all_finite(&r), "mode {mode}");
            loudest = loudest.max(peak(&l)).max(peak(&r));
            // And the silence after loud input.
            let (l, r) = rig.silence(1.0);
            assert!(all_finite(&l) && all_finite(&r), "mode {mode}");
            loudest = loudest.max(peak(&l)).max(peak(&r));
        }
        // The wet signal has a ceiling of 16; a loud tone held for this long
        // into a 60 s tail stays well below it.
        assert!(loudest < 12.0, "mode {mode} peaks at {loudest}");
    }
}

#[test]
fn extreme_settings_stay_finite_and_bounded() {
    extremes_stay_bounded_for(2.5);
}

#[test]
#[ignore = "ten seconds per case; run in a release build"]
fn extreme_settings_stay_finite_and_bounded_for_ten_seconds() {
    extremes_stay_bounded_for(10.0);
}

#[test]
fn the_block_size_does_not_change_the_output() {
    let input = plucks(RATE, 0.7, 196.0, 0.45, 0.5);
    for mode in MODES {
        let render = |block: usize| {
            let mut rig = Rig::<2>::new(RATE)
                .with(port::MODE, mode)
                .with(port::MOD, 70.0);
            rig.run(&input, block)
        };
        let (l, r) = render(96);
        for block in [1, 32, 1024] {
            let (bl, br) = render(block);
            let worst = l
                .iter()
                .zip(&bl)
                .chain(r.iter().zip(&br))
                .fold(0.0_f32, |worst, (a, b)| worst.max((a - b).abs()));
            assert!(
                worst < 1.0e-5,
                "mode {mode}, block {block}: differs by {worst}"
            );
        }
    }
}

#[test]
fn mix_at_zero_is_the_input_bit_for_bit() {
    let input = plucks(RATE, 4.0, 196.0, 0.5, 0.5);
    for mode in MODES {
        // From the first sample when it starts at zero.
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::MIX, 0.0);
        let (l, r) = rig.run(&input[..9600], 96);
        assert!(l == input[..9600] && r == input[..9600], "mode {mode}");
        // And again once a tail has rung out after Mix is turned down.
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::DECAY, 0.4);
        rig.run(&input[..24_000], 96);
        rig.set(port::MIX, 0.0);
        let (l, r) = rig.run(&input, 96);
        let from = input.len() - 24_000;
        assert!(
            l[from..] == input[from..] && r[from..] == input[from..],
            "mode {mode}"
        );
        // The mono plugin too.
        let mut rig = Rig::<1>::new(RATE)
            .with(port::MODE, mode)
            .with(port::MIX, 0.0);
        let (l, _) = rig.run(&input[..4800], 96);
        assert!(l == input[..4800], "mode {mode} mono");
    }
}

#[test]
fn the_dry_path_is_never_delayed() {
    for mode in MODES {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::PREDELAY, 20.0);
        let (l, _) = rig.run(&impulse(RATE, 0.1, 1.0), 96);
        let dry = (0.3 * core::f32::consts::FRAC_PI_2).cos();
        assert!(
            (l[0] - dry).abs() < 1.0e-6,
            "mode {mode}: first sample {}",
            l[0]
        );
        assert!(
            peak(&l[1..900]) < 1.0e-6,
            "mode {mode}: the reverb came before its pre-delay"
        );
    }
}

/// Sweeps one control from `from` to `to` and back during a steady tone and
/// returns the largest sample-to-sample step of either output.
fn sweep(mode: f32, port: usize, from: f32, to: f32) -> f32 {
    let mut rig = Rig::<2>::new(RATE).with(mode_port(), mode).with(port, from);
    let input = tone(1.5);
    rig.run(&input[..24_000], 96);
    let blocks = (input.len() - 24_000) / 96;
    let (l, r) = rig.run_with(&input[24_000..], 96, |frame, controls| {
        let position = frame as f32 / (blocks * 96) as f32;
        let there = 1.0 - (2.0 * position - 1.0).abs();
        controls[port] = from + (to - from) * there;
    });
    max_step(&l).max(max_step(&r))
}

fn mode_port() -> usize {
    port::MODE
}

#[test]
fn every_continuous_control_sweeps_without_a_step() {
    let continuous = [
        port::DECAY,
        port::PREDELAY,
        port::SIZE,
        port::TONE,
        port::LOWCUT,
        port::MOD,
        port::SPEED,
        port::SHIMMER,
        port::BUILD,
        port::MIX,
    ];
    let mut worst = 0.0_f32;
    for (mode, ports) in [
        (HALL, &continuous[..]),
        (ROOM, &[port::SIZE, port::DECAY][..]),
        (PLATE, &[port::SIZE, port::DECAY, port::TONE, port::MOD][..]),
        (
            SPRING,
            &[port::SIZE, port::DECAY, port::TONE, port::MOD][..],
        ),
        (CLOUD, &[port::SIZE, port::MOD][..]),
        (BLOOM, &[port::BUILD, port::SIZE][..]),
        (SHIMMER, &[port::SHIMMER, port::SIZE][..]),
        (NONLINEAR, &[port::SIZE, port::DECAY, port::TONE][..]),
    ] {
        for &port in ports {
            let control = CONTROLS[port];
            let step = sweep(mode, port, control.minimum, control.maximum);
            assert!(
                step < MAX_STEP,
                "mode {mode}, {}: step {step}",
                control.symbol
            );
            worst = worst.max(step);
        }
    }
    println!("largest step in a control sweep: {worst}");
}

#[test]
fn switches_change_without_a_step() {
    let input = tone(2.4);
    let mut worst = 0.0_f32;
    for (mode, port, values) in [
        (HALL, port::FREEZE, [0.0, 1.0, 0.0, 1.0]),
        (PLATE, port::FREEZE, [0.0, 1.0, 0.0, 1.0]),
        (SPRING, port::FREEZE, [0.0, 1.0, 0.0, 1.0]),
        (NONLINEAR, port::FREEZE, [0.0, 1.0, 0.0, 1.0]),
        (SHIMMER, port::INTERVAL, [0.0, 1.0, 2.0, 0.0]),
        (NONLINEAR, port::SHAPE, [0.0, 1.0, 2.0, 0.0]),
    ] {
        let mut rig = Rig::<2>::new(RATE)
            .with(mode_port(), mode)
            .with(port::MIX, 60.0);
        let (l, r) = rig.run_with(&input, 96, |frame, controls| {
            controls[port] = values[(frame * 4 / input.len()).min(3)];
        });
        let step = max_step(&l).max(max_step(&r));
        assert!(step < MAX_STEP, "mode {mode}, port {port}: step {step}");
        worst = worst.max(step);
    }
    println!("largest step at a switch: {worst}");
}

#[test]
fn a_mode_switch_mid_tail_has_no_step_and_keeps_the_tail() {
    // Through every mode and back, while a note sounds and after it stops.
    let order = [
        0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 5.0, 2.0, 6.0, 3.0, 0.0, 7.0, 4.0, 1.0,
    ];
    let hop = 0.2;
    let sounding = tone(hop * order.len() as f32);
    let ringing = then_silence(tone(0.6), RATE, hop * order.len() as f32);
    let mut worst = 0.0_f32;
    for (input, offset) in [(&sounding, 0.0), (&ringing, 0.5)] {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MIX, 60.0)
            .with(port::DECAY, 4.0);
        let (l, r) = rig.run_with(input, 96, |frame, controls| {
            let step = ((frame as f32 / RATE - offset).max(0.0) / hop) as usize;
            controls[port::MODE] = order[step.min(order.len() - 1)];
        });
        worst = worst.max(max_step(&l)).max(max_step(&r));
    }
    assert!(worst < MAX_STEP, "a mode switch stepped by {worst}");
    println!("largest step at a mode switch: {worst}");

    // The old tail rings on under the new mode instead of stopping.
    for (from, to) in [
        (HALL, PLATE),
        (PLATE, SPRING),
        (CLOUD, NONLINEAR),
        (SPRING, HALL),
        (HALL, ROOM),
    ] {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, from)
            .with(port::MIX, 100.0)
            .with(port::DECAY, 4.0);
        rig.run(&tilted(RATE, 1.0, 0.2, 3), 96);
        let (before, _) = rig.silence(0.1);
        rig.set(port::MODE, to);
        let (after, _) = rig.silence(0.4);
        let drop = db(rms(&after[9600..]) / rms(&before));
        assert!(
            drop > -9.0,
            "{from} to {to}: the tail fell {drop} dB in 0.4 s"
        );
    }
}

#[test]
fn the_tail_rings_out_when_mix_is_turned_down() {
    for mode in [HALL, PLATE, SPRING, CLOUD] {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::DECAY, 4.0);
        rig.run(&tilted(RATE, 1.0, 0.2, 3), 96);
        let (before, _) = rig.silence(0.1);
        rig.set(port::MIX, 0.0);
        let (after, _) = rig.silence(0.5);
        let drop = db(rms(&after[12_000..]) / rms(&before));
        assert!(drop > -9.0, "mode {mode}: the tail fell {drop} dB with Mix");
    }
}

#[test]
fn decay_time_follows_the_decay_control_in_hall_and_room() {
    for mode in [HALL, ROOM] {
        for decay in [0.8, 2.5] {
            // Exactly, with no damping and no modulation.
            let mut rig = Rig::<2>::new(RATE)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .with(port::DECAY, decay)
                .with(port::TONE, 100.0)
                .with(port::MOD, 0.0);
            let (l, _) = rig.run(&impulse(RATE, 1.3 * decay + 0.3, 1.0), 96);
            let flat = decay_time(&l, RATE, -5.0, -35.0);
            assert!(
                (flat / decay - 1.0).abs() < 0.05,
                "mode {mode}: {flat} s for {decay} s"
            );
            // Within a fifth at the default settings, on a guitar-like burst.
            let mut rig = Rig::<2>::new(RATE)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .with(port::DECAY, decay);
            let burst = then_silence(tilted(RATE, 0.05, 0.5, 2), RATE, 1.3 * decay + 0.3);
            let (l, _) = rig.run(&burst, 96);
            let usual = decay_time(&l[2400..], RATE, -5.0, -35.0);
            assert!(
                (usual / decay - 1.0).abs() < 0.2,
                "mode {mode}: {usual} s for {decay} s"
            );
        }
    }
}

/// Plays into the reverb, turns Freeze on and returns the level in decibels
/// of each second that follows, on the left and the right.
fn frozen(mode: f32, seconds: usize) -> (Vec<f32>, Vec<f32>) {
    let mut rig = Rig::<2>::new(RATE)
        .with(port::MODE, mode)
        .with(port::MIX, 100.0);
    rig.run(&plucks(RATE, 1.5, 196.0, 0.5, 0.5), 96);
    rig.set(port::FREEZE, 1.0);
    rig.silence(0.5);
    let (mut left, mut right) = (Vec::new(), Vec::new());
    for _ in 0..seconds {
        // New playing must not get in while the tail is held.
        let (l, r) = rig.run(&tilted(RATE, 1.0, 0.3, 4), 96);
        assert!(all_finite(&l) && all_finite(&r));
        left.push(db(rms(&l)));
        right.push(db(rms(&r)));
    }
    (left, right)
}

fn freeze_holds_for(mode: f32, seconds: usize) {
    let (left, right) = frozen(mode, seconds);
    for levels in [left, right] {
        let first = levels[0];
        assert!(first > -60.0, "mode {mode}: nothing was held ({first} dB)");
        for (second, level) in levels.iter().enumerate() {
            assert!(
                (level - first).abs() < 1.0,
                "mode {mode}: {level} dB after {second} s, {first} dB at first"
            );
        }
    }
}

#[test]
fn freeze_holds_the_tail_for_a_minute_without_growth_or_decay() {
    freeze_holds_for(HALL, 60);
}

#[test]
fn freeze_holds_in_every_mode_and_lets_go_again() {
    for mode in [ROOM, PLATE, SPRING, CLOUD, BLOOM, SHIMMER, NONLINEAR] {
        freeze_holds_for(mode, 6);
    }
    // Released, the tail dies away at the decay time.
    let mut rig = Rig::<2>::new(RATE)
        .with(port::MODE, HALL)
        .with(port::MIX, 100.0)
        .with(port::DECAY, 1.0);
    rig.run(&plucks(RATE, 1.0, 196.0, 0.5, 0.5), 96);
    rig.set(port::FREEZE, 1.0);
    let (held, _) = rig.silence(2.0);
    rig.set(port::FREEZE, 0.0);
    let (released, _) = rig.silence(2.0);
    assert!(db(rms(&released[72_000..]) / rms(&held[72_000..])) < -60.0);
}

#[test]
#[ignore = "a minute per mode; run in a release build"]
fn freeze_holds_for_a_minute_in_every_mode() {
    for mode in MODES {
        freeze_holds_for(mode, 60);
    }
}

#[test]
fn shimmer_lifts_the_tail_by_its_interval_and_brightens_it_over_time() {
    // The centroid of the tail climbs as energy goes round the shifters.
    let mut rig = Rig::<2>::new(RATE)
        .with(port::MODE, SHIMMER)
        .with(port::MIX, 100.0)
        .with(port::DECAY, 10.0)
        .with(port::SHIMMER, 100.0);
    let (l, _) = rig.run(&then_silence(held(RATE, 1.0, 196.0, 0.3), RATE, 5.0), 96);
    let at = |second: f32| {
        let from = (second * RATE) as usize;
        centroid(&l[from..from + 32_768], RATE)
    };
    let (early, middle, late) = (at(0.3), at(2.0), at(4.0));
    assert!(
        middle > 1.5 * early && late > 1.5 * early,
        "{early} {middle} {late} Hz"
    );
    // Without Shimmer the same tail does not brighten.
    let mut plain = Rig::<2>::new(RATE)
        .with(port::MODE, SHIMMER)
        .with(port::MIX, 100.0)
        .with(port::DECAY, 10.0)
        .with(port::SHIMMER, 0.0);
    let (p, _) = plain.run(&then_silence(held(RATE, 1.0, 196.0, 0.3), RATE, 5.0), 96);
    let dull = centroid(&p[(4.0 * RATE) as usize..][..32_768], RATE);
    assert!(
        late > 1.5 * dull,
        "{late} Hz with Shimmer, {dull} Hz without"
    );
}

/// Level in decibels of `signal` in the band within 3% of `hertz`.
fn band(signal: &[f32], rate: f32, hertz: f32) -> f32 {
    let power = spectrum(signal);
    let n = 2 * power.len();
    let (low, high) = (
        0.97 * hertz * n as f32 / rate,
        1.03 * hertz * n as f32 / rate,
    );
    let sum: f64 = power[low as usize..=high as usize].iter().sum();
    10.0 * (sum.max(1.0e-30)).log10() as f32
}

#[test]
fn shimmer_intervals_are_in_tune_at_every_sample_rate() {
    for (rate, interval, ratio) in [
        (48_000.0, 0.0, 2.0),
        (48_000.0, 1.0, 1.498_307),
        (48_000.0, 2.0, 0.5),
        (44_100.0, 0.0, 2.0),
        (96_000.0, 0.0, 2.0),
    ] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, SHIMMER)
            .with(port::MIX, 100.0)
            .with(port::DECAY, 6.0)
            .with(port::MOD, 0.0)
            .with(port::SHIMMER, 100.0)
            .with(port::INTERVAL, interval);
        let (l, _) = rig.run(&sine(rate, 1.6, 440.0, 0.3), 96);
        let piece = &l[l.len() - 32_768..];
        let wanted = 440.0 * ratio;
        // A delay-line shifter puts a steady tone on lines one grain rate
        // (12.5 and 15 Hz here) apart under a peak at the shifted pitch, and
        // the reverb favours some lines over others: the strongest lies
        // within a line or so of the pitch, and their centre is on it.
        let found = strongest(piece, rate, 0.8 * wanted, 1.25 * wanted);
        assert!(
            (found - wanted).abs() < 20.0,
            "rate {rate}, interval {interval}: {found} Hz"
        );
        let power = spectrum(piece);
        let hertz = |bin: usize| bin as f32 * rate / (2 * power.len()) as f32;
        let (mut weighted, mut total) = (0.0_f64, 0.0_f64);
        for (bin, p) in power.iter().enumerate() {
            if hertz(bin) > 0.8 * wanted && hertz(bin) < 1.25 * wanted {
                weighted += p * f64::from(hertz(bin));
                total += p;
            }
        }
        let centre = (weighted / total) as f32;
        assert!(
            (centre / wanted - 1.0).abs() < 0.03,
            "rate {rate}, interval {interval}: {centre} Hz"
        );
        let shifted = band(piece, rate, wanted);
        assert!(
            shifted > band(piece, rate, 440.0) - 30.0,
            "rate {rate}, interval {interval}"
        );
    }
}

#[test]
fn a_mono_input_makes_a_wide_stereo_field() {
    for mode in MODES {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::MIX, 100.0);
        let (l, r) = rig.run(&tilted(RATE, 2.5, 0.2, 6), 96);
        let from = 48_000;
        let likeness = correlation(&l[from..], &r[from..]);
        assert!(
            likeness.abs() < 0.6,
            "mode {mode}: left and right correlate by {likeness}"
        );
        let balance = db(rms(&l[from..]) / rms(&r[from..]));
        assert!(
            balance.abs() < 2.0,
            "mode {mode}: {balance} dB between the sides"
        );
    }
}

#[test]
fn the_level_at_the_default_settings_is_close_to_the_dry_signal() {
    for mode in MODES {
        for stereo in [false, true] {
            let steady = tilted(RATE, 6.0, 0.1, 9);
            let (out, _) = if stereo {
                Rig::<2>::new(RATE).with(port::MODE, mode).run(&steady, 96)
            } else {
                Rig::<1>::new(RATE).with(port::MODE, mode).run(&steady, 96)
            };
            let from = 3 * 48_000;
            let change = db(rms(&out[from..]) / rms(&steady[from..]));
            assert!(
                change.abs() < 1.0,
                "mode {mode} stereo {stereo}: {change} dB"
            );
        }
        let notes = plucks(RATE, 4.5, 196.0, 1.5, 0.5);
        let (out, _) = Rig::<2>::new(RATE).with(port::MODE, mode).run(&notes, 96);
        let change = db(rms(&out) / rms(&notes));
        assert!(
            change.abs() < 2.0,
            "mode {mode}: plucked notes change by {change} dB"
        );
    }
}

#[test]
fn times_are_right_at_every_sample_rate() {
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        // Decay time in Hall.
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, HALL)
            .with(port::MIX, 100.0)
            .with(port::DECAY, 0.8)
            .with(port::TONE, 100.0)
            .with(port::MOD, 0.0);
        let (l, r) = rig.run(&impulse(rate, 1.4, 1.0), 96);
        let measured = decay_time(&l, rate, -5.0, -35.0);
        assert!(
            (measured / 0.8 - 1.0).abs() < 0.05,
            "rate {rate}: {measured} s"
        );
        assert!(all_finite(&r));

        // Pre-delay: nothing before it, the first reflections just after.
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, ROOM)
            .with(port::MIX, 100.0)
            .with(port::PREDELAY, 100.0);
        let (l, _) = rig.run(&impulse(rate, 0.3, 1.0), 96);
        let first = l.iter().position(|x| x.abs() > 1.0e-4).unwrap() as f32 / rate;
        assert!(
            (0.0999..0.115).contains(&first),
            "rate {rate}: reverb starts at {first} s"
        );

        // The gate of Nonlinear lasts Decay seconds.
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, NONLINEAR)
            .with(port::MIX, 100.0)
            .with(port::PREDELAY, 0.0)
            .with(port::DECAY, 0.3);
        let (l, _) = rig.run(&then_silence(tilted(rate, 0.01, 0.5, 2), rate, 0.6), 96);
        let levels = envelope(&l, rate, 0.05);
        assert!(
            levels[4] > levels[1] - 6.0,
            "rate {rate}: the gate sags: {levels:?}"
        );
        assert!(
            levels[8] < levels[4] - 40.0,
            "rate {rate}: the gate stays open: {levels:?}"
        );
    }
}

#[test]
fn bloom_swells_and_build_makes_the_swell_longer() {
    let peak_time = |mode: f32, build: f32| {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, mode)
            .with(port::MIX, 100.0)
            .with(port::DECAY, 15.0)
            .with(port::PREDELAY, 0.0)
            .with(port::BUILD, build);
        let (l, _) = rig.run(&then_silence(tilted(RATE, 0.03, 0.5, 5), RATE, 3.0), 96);
        let levels = envelope(&l, RATE, 0.1);
        let loudest = levels.iter().cloned().fold(f32::MIN, f32::max);
        (
            levels.iter().position(|level| *level == loudest).unwrap(),
            levels[0] - loudest,
        )
    };
    let (hall, _) = peak_time(HALL, 1.0);
    let (quick, _) = peak_time(BLOOM, 0.1);
    let (slow, start) = peak_time(BLOOM, 4.0);
    assert!(hall <= 1, "a hall is loudest at once");
    assert!(
        slow >= quick + 3 && quick > hall,
        "peaks after {hall}, {quick} and {slow} tenths of a second"
    );
    assert!(
        start < -6.0,
        "the swell starts only {start} dB below its peak"
    );
}

#[test]
fn nonlinear_shapes_gate_reverse_and_swell() {
    let shape = |shape: f32| {
        let mut rig = Rig::<2>::new(RATE)
            .with(port::MODE, NONLINEAR)
            .with(port::MIX, 100.0)
            .with(port::PREDELAY, 0.0)
            .with(port::SHAPE, shape)
            .with(port::DECAY, 0.6);
        let (l, _) = rig.run(&then_silence(tilted(RATE, 0.02, 0.5, 5), RATE, 1.0), 96);
        envelope(&l, RATE, 0.05)
    };
    let gate = shape(0.0);
    assert!(
        (gate[2] - gate[10]).abs() < 4.0 && gate[14] < gate[10] - 40.0,
        "{gate:?}"
    );
    let reverse = shape(1.0);
    assert!(
        reverse[11] > reverse[2] + 12.0 && reverse[14] < reverse[11] - 40.0,
        "{reverse:?}"
    );
    let swell = shape(2.0);
    assert!(
        swell[6] > swell[1] + 12.0 && swell[6] > swell[11] + 6.0,
        "{swell:?}"
    );
}

#[test]
fn spring_echoes_are_rising_chirps() {
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, SPRING)
            .with(port::MIX, 100.0)
            .with(port::PREDELAY, 0.0)
            .with(port::LOWCUT, 20.0);
        let (l, _) = rig.run(&impulse(rate, 0.2, 1.0), 96);
        let window = (0.008 * rate) as usize;
        let pitch = |milliseconds: f32| {
            let from = (0.001 * milliseconds * rate) as usize;
            strongest(&l[from..from + window], rate, 100.0, 8000.0)
        };
        let (early, middle, late) = (pitch(0.0), pitch(8.0), pitch(24.0));
        assert!(
            early < 1000.0 && middle > 2500.0 && late > middle,
            "rate {rate}: {early} {middle} {late}"
        );
        assert!(late < 4100.0, "rate {rate}: above the transition frequency");
    }
}

#[test]
fn mono_and_stereo_both_run_at_every_rate_and_mode() {
    for rate in [44_100.0, 96_000.0] {
        for mode in MODES {
            let input = plucks(rate, 0.3, 196.0, 0.5, 0.5);
            let (l, _) = Rig::<1>::new(rate)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .run(&input, 96);
            assert!(
                all_finite(&l) && rms(&l) > 1.0e-4,
                "mono, mode {mode}, rate {rate}"
            );
            let (l, r) = Rig::<2>::new(rate)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .run(&input, 96);
            assert!(
                all_finite(&l) && all_finite(&r),
                "stereo, mode {mode}, rate {rate}"
            );
            assert!(
                rms(&l) > 1.0e-4 && rms(&r) > 1.0e-4,
                "stereo, mode {mode}, rate {rate}"
            );
        }
    }
}

#[test]
fn wild_control_values_and_odd_buffers_never_panic() {
    let input = plucks(RATE, 0.25, 196.0, 0.5, 0.9);
    for fill in [
        -1.0e9,
        1.0e9,
        f32::MAX,
        f32::MIN,
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        0.3,
    ] {
        for mode in MODES {
            let mut rig = Rig::<2>::new(RATE);
            rig.controls = [fill; 14];
            if fill == 0.3 {
                rig.controls[port::MODE] = mode;
                rig.controls[port::FREEZE] = 1.0e9;
                rig.controls[port::DECAY] = -5.0;
            }
            let (l, r) = rig.run(&input, 64);
            assert!(
                all_finite(&l) && all_finite(&r) && peak(&l) < 17.0,
                "fill {fill}"
            );
            // Back to ordinary values in one step.
            rig.controls = defaults();
            rig.controls[port::MODE] = mode;
            let (l, r) = rig.run(&input, 64);
            assert!(
                all_finite(&l) && all_finite(&r) && peak(&l) < 17.0,
                "fill {fill}"
            );
        }
    }
    // Input that is not a number is treated as silence.
    let mut rig = Rig::<2>::new(RATE);
    let broken: Vec<f32> = (0..4800)
        .map(|i| if i % 7 == 0 { f32::NAN } else { f32::INFINITY })
        .collect();
    let (l, r) = rig.run(&broken, 96);
    assert!(l.iter().chain(&r).all(|x| *x == 0.0));

    // Missing controls fall back to defaults; missing or uneven buffers do nothing rash.
    let mut plugin = Bloom::<2>::new(RATE);
    let (mut a, mut b) = ([0.0_f32; 64], [0.0_f32; 40]);
    plugin.process(&[], &[&input[..64], &input[..64]], &mut [&mut a, &mut b]);
    plugin.process(&[7.0, 1.0], &[&input[..10]], &mut [&mut a, &mut b]);
    plugin.process(&defaults(), &[], &mut [&mut a, &mut b]);
    plugin.process(&defaults(), &[&input[..64], &input[..64]], &mut []);
    plugin.process(
        &defaults(),
        &[&input[..0], &input[..0]],
        &mut [&mut a[..0], &mut b[..0]],
    );
    assert!(all_finite(&a) && all_finite(&b));
    for rate in [f32::NAN, 0.0, 1.0e9, 22_050.0] {
        let mut odd = Bloom::<1>::new(rate);
        odd.reset();
        odd.process(&defaults(), &[&input[..64]], &mut [&mut a]);
        assert!(all_finite(&a));
    }
}
