//! Focused pitch-detector qualification across bass and guitar range.
use oxidal_audio::{
    structure::AuthoringAction,
    tools::{Command, TunerReading},
};
use oxidal_tone3000::{Engine, working::Authoring};
use std::{error::Error, path::Path};

const BLOCK: usize = 128;
const NOTES: [(&str, f64); 9] = [
    ("E1", 41.203_445),
    ("A1", 55.0),
    ("E2", 82.406_889),
    ("A2", 110.0),
    ("D3", 146.832_384),
    ("G3", 195.997_718),
    ("B3", 246.941_651),
    ("E4", 329.627_557),
    ("A4", 440.0),
];

fn send(
    owner: &mut Authoring,
    engine: &mut Engine,
    command: Command,
) -> Result<oxidal_audio::structure::AuthoringStatus, Box<dyn Error>> {
    owner
        .command(engine, AuthoringAction::Utility { command })
        .map_err(Into::into)
}

fn reading(
    owner: &mut Authoring,
    engine: &mut Engine,
) -> Result<Option<TunerReading>, Box<dyn Error>> {
    Ok(send(owner, engine, Command::Poll)?.tools.tuner)
}

fn cents(actual: f64, expected: f64) -> f64 {
    1200.0 * (actual / expected).log2()
}

fn main() -> Result<(), Box<dyn Error>> {
    let root = std::env::temp_dir().join("oxidal-tuner-qualification");
    std::fs::create_dir_all(&root)?;
    let mut worst_error = 0.0_f64;
    let mut worst_jitter = 0.0_f64;
    let mut slowest_ms = 0.0_f64;
    println!("rate,note,expected_hz,measured_hz,error_cents,jitter_cents,response_ms,confidence");
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        for (note, expected) in NOTES {
            let mut engine = Engine::new(rate, BLOCK)?;
            engine.reset_empty()?;
            engine.set_normalized("gateEnabled", 0.0)?;
            let mut owner =
                Authoring::for_source(Path::new(&root), format!("tuner:{rate}:{note}"), None);
            send(&mut owner, &mut engine, Command::Tuner { enabled: true })?;
            let mut first = None;
            let mut accepted = Vec::new();
            // Give every note up to 1.5 seconds, polling at roughly 21 ms.
            let limit = (rate * 1.5 / BLOCK as f64).ceil() as usize;
            for block in 0..limit {
                let mut left = [0.0; BLOCK];
                for (index, sample) in left.iter_mut().enumerate() {
                    let frame = block * BLOCK + index;
                    *sample =
                        (std::f64::consts::TAU * expected * frame as f64 / rate).sin() as f32 * 0.1;
                }
                let mut right = left;
                engine.process(&mut left, &mut right)?;
                if block % 8 == 7
                    && let Some(value) = reading(&mut owner, &mut engine)?
                    && value.confidence >= 0.7
                    && value.frequency > 0.0
                {
                    first.get_or_insert(block + 1);
                    accepted.push(value);
                    if accepted.len() == 8 {
                        break;
                    }
                }
            }
            if accepted.len() < 8 {
                return Err(format!(
                    "{note} at {rate} Hz produced only {} confident readings",
                    accepted.len()
                )
                .into());
            }
            let errors = accepted
                .iter()
                .map(|value| cents(value.frequency, expected))
                .collect::<Vec<_>>();
            let mean = errors.iter().sum::<f64>() / errors.len() as f64;
            let jitter = errors
                .iter()
                .map(|value| (value - mean).abs())
                .fold(0.0_f64, f64::max);
            let response_ms = first.unwrap() as f64 * BLOCK as f64 / rate * 1000.0;
            let confidence =
                accepted.iter().map(|value| value.confidence).sum::<f64>() / accepted.len() as f64;
            let measured = expected * 2.0_f64.powf(mean / 1200.0);
            println!(
                "{rate:.0},{note},{expected:.6},{measured:.6},{mean:.3},{jitter:.3},{response_ms:.1},{confidence:.3}"
            );
            worst_error = worst_error.max(mean.abs());
            worst_jitter = worst_jitter.max(jitter);
            slowest_ms = slowest_ms.max(response_ms);
            if mean.abs() > 2.0 {
                return Err(format!("{note} at {rate} Hz error is {mean:.3} cents").into());
            }
            if jitter > 1.0 {
                return Err(format!("{note} at {rate} Hz jitter is {jitter:.3} cents").into());
            }
            if response_ms > 1_000.0 {
                return Err(format!("{note} at {rate} Hz response is {response_ms:.1} ms").into());
            }
        }
    }
    println!(
        "PASS: max error {worst_error:.3} cents, max jitter {worst_jitter:.3} cents, slowest response {slowest_ms:.1} ms"
    );
    Ok(())
}
