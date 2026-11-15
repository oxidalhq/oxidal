//! Measurements printed for tuning; not assertions. Run with
//! `cargo test --release -p oxidal-bloom --test probe -- --ignored --nocapture`.
//! @see docs/native-bloom.md
mod support;
use support::*;

#[test]
#[ignore = "prints measurements for tuning"]
fn levels() {
    let rate = 48_000.0;
    for mode in MODES {
        let steady = tilted(rate, 8.0, 0.1, 9);
        let tail = (4.0 * rate) as usize;
        let mut wet = Rig::<2>::new(rate)
            .with(port::MODE, mode)
            .with(port::MIX, 100.0);
        let (l, r) = wet.run(&steady, 96);
        let mut mono = Rig::<1>::new(rate)
            .with(port::MODE, mode)
            .with(port::MIX, 100.0);
        let (ml, _) = mono.run(&steady, 96);
        let note = held(rate, 6.0, 196.0, 0.25);
        let mut both = Rig::<2>::new(rate).with(port::MODE, mode);
        let (bl, _) = both.run(&note, 96);
        let pl = plucks(rate, 6.0, 196.0, 1.5, 0.5);
        let mut p = Rig::<2>::new(rate).with(port::MODE, mode);
        let (pb, _) = p.run(&pl, 96);
        println!(
            "mode {mode}: noise wet L {:+.1} dB R {:+.1} dB mono {:+.1} dB corr {:.2} | default mix held {:+.2} dB plucks {:+.2} dB",
            db(rms(&l[tail..]) / rms(&steady[tail..])),
            db(rms(&r[tail..]) / rms(&steady[tail..])),
            db(rms(&ml[tail..]) / rms(&steady[tail..])),
            correlation(&l[tail..], &r[tail..]),
            db(rms(&bl[tail..]) / rms(&note[tail..])),
            db(rms(&pb) / rms(&pl)),
        );
    }
}

#[test]
#[ignore = "prints measurements for tuning"]
fn decays() {
    let rate = 48_000.0;
    for mode in [ROOM, HALL, PLATE, SPRING, CLOUD, BLOOM, SHIMMER] {
        for decay in [0.5, 1.0, 2.5, 6.0] {
            let mut flat = Rig::<2>::new(rate)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .with(port::DECAY, decay)
                .with(port::TONE, 100.0)
                .with(port::MOD, 0.0)
                .with(port::SHIMMER, 0.0)
                .with(port::PREDELAY, 0.0);
            let (l, _) = flat.run(&impulse(rate, decay * 1.6 + 0.5, 1.0), 96);
            let mut usual = Rig::<2>::new(rate)
                .with(port::MODE, mode)
                .with(port::MIX, 100.0)
                .with(port::DECAY, decay);
            let (u, _) = usual.run(&impulse(rate, decay * 1.6 + 0.5, 1.0), 96);
            println!(
                "mode {mode} decay {decay}: flat {:.2} s, defaults {:.2} s",
                decay_time(&l, rate, -5.0, -35.0),
                decay_time(&u, rate, -5.0, -35.0)
            );
        }
    }
}

fn levels_of(signal: &[f32], rate: f32, window: f32, count: usize) -> String {
    envelope(signal, rate, window)
        .iter()
        .take(count)
        .map(|level| format!("{level:.0}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
#[ignore = "prints measurements for tuning"]
fn shapes() {
    let rate = 48_000.0;
    for (build, decay) in [
        (0.2, 2.5),
        (1.0, 2.5),
        (3.0, 2.5),
        (0.3, 12.0),
        (1.0, 12.0),
        (3.0, 12.0),
    ] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, BLOOM)
            .with(port::MIX, 100.0)
            .with(port::BUILD, build)
            .with(port::DECAY, decay);
        let burst: Vec<f32> = noise(rate, 0.05, 0.5, 5)
            .into_iter()
            .chain(vec![0.0; (6.0 * rate) as usize])
            .collect();
        let (l, _) = rig.run(&burst, 96);
        println!(
            "bloom build {build} decay {decay}: {}",
            levels_of(&l, rate, 0.25, 20)
        );
    }
    for shape in [0.0, 1.0, 2.0] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, NONLINEAR)
            .with(port::MIX, 100.0)
            .with(port::SHAPE, shape)
            .with(port::DECAY, 0.6);
        let burst: Vec<f32> = noise(rate, 0.02, 0.5, 5)
            .into_iter()
            .chain(vec![0.0; (1.2 * rate) as usize])
            .collect();
        let (l, _) = rig.run(&burst, 96);
        println!("nonlinear shape {shape}: {}", levels_of(&l, rate, 0.05, 20));
    }
    let mut rig = Rig::<2>::new(rate)
        .with(port::MODE, SPRING)
        .with(port::MIX, 100.0);
    let (l, _) = rig.run(&impulse(rate, 0.4, 1.0), 96);
    println!("spring: {}", levels_of(&l, rate, 0.01, 40));
    let mut rig = Rig::<2>::new(rate)
        .with(port::MODE, SHIMMER)
        .with(port::MIX, 100.0)
        .with(port::DECAY, 8.0);
    let note: Vec<f32> = held(rate, 1.0, 196.0, 0.3)
        .into_iter()
        .chain(vec![0.0; (8.0 * rate) as usize])
        .collect();
    let (l, _) = rig.run(&note, 96);
    for second in 0..9 {
        let from = (second as f32 * rate) as usize;
        let piece = &l[from..from + 32_768];
        println!(
            "shimmer second {second}: centroid {:.0} Hz level {:.1} dB",
            centroid(piece, rate),
            db(rms(piece))
        );
    }
}

#[test]
#[ignore = "prints measurements for tuning"]
fn spring_chirp() {
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, SPRING)
            .with(port::MIX, 100.0)
            .with(port::PREDELAY, 0.0)
            .with(port::LOWCUT, 20.0);
        let (l, _) = rig.run(&impulse(rate, 0.5, 1.0), 96);
        let n = (0.008 * rate) as usize;
        let line: Vec<String> = (0..12)
            .map(|w| {
                let piece = &l[w * n / 2..w * n / 2 + n];
                format!("{:.0}", strongest(piece, rate, 100.0, 8000.0))
            })
            .collect();
        println!(
            "spring rate {rate}: strongest per 4 ms step: {}",
            line.join(" ")
        );
    }
}

#[test]
#[ignore = "prints measurements for tuning"]
fn switch_steps() {
    let rate = 48_000.0;
    for from in MODES {
        let mut line = String::new();
        for to in MODES {
            let mut worst = 0.0_f32;
            for ringing in [false, true] {
                let mut rig = Rig::<2>::new(rate)
                    .with(port::MODE, from)
                    .with(port::MIX, 60.0)
                    .with(port::DECAY, 4.0);
                let input = if ringing {
                    then_silence(sine(rate, 0.5, 110.0, 0.25), rate, 0.5)
                } else {
                    sine(rate, 1.0, 110.0, 0.25)
                };
                let (l, r) = rig.run_with(&input, 96, |frame, controls| {
                    if frame >= 28_800 {
                        controls[port::MODE] = to;
                    }
                });
                worst = worst
                    .max(max_step(&l[28_000..]))
                    .max(max_step(&r[28_000..]));
            }
            line += &format!("{:.4} ", worst);
        }
        println!("from {from}: {line}");
    }
    let mut rig = Rig::<2>::new(rate)
        .with(port::MODE, HALL)
        .with(port::MIX, 100.0)
        .with(port::DECAY, 15.0)
        .with(port::PREDELAY, 0.0);
    let (l, _) = rig.run(&then_silence(tilted(rate, 0.03, 0.5, 5), rate, 3.0), 96);
    println!("hall {:?}", &envelope(&l, rate, 0.1)[..12]);
    for build in [0.1, 1.0, 4.0] {
        let mut rig = Rig::<2>::new(rate)
            .with(port::MODE, BLOOM)
            .with(port::MIX, 100.0)
            .with(port::DECAY, 15.0)
            .with(port::PREDELAY, 0.0)
            .with(port::BUILD, build);
        let (l, _) = rig.run(&then_silence(tilted(rate, 0.03, 0.5, 5), rate, 3.0), 96);
        println!("bloom {build} {:?}", &envelope(&l, rate, 0.1)[..16]);
    }
}
