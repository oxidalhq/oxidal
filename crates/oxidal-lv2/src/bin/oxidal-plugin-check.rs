//! Offline installed-plugin smoke checks; no ALSA device or real-time policy.
//! @see docs/lv2.md
use oxidal_lv2::{Plugin, World};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Debug)]
struct Options {
    pack: String,
    bundle: Option<PathBuf>,
    rate: u32,
    frames: usize,
    timeout: Duration,
    probe: Option<String>,
    result: Option<PathBuf>,
}
impl Options {
    fn parse() -> Result<Self, String> {
        let mut o = Self {
            pack: "installed".into(),
            bundle: None,
            rate: 48000,
            frames: 48,
            timeout: Duration::from_secs(10),
            probe: None,
            result: None,
        };
        let mut args = std::env::args().skip(1);
        while let Some(key) = args.next() {
            let value = args.next().ok_or("Every option requires a value")?;
            match key.as_str() {
                "--pack" => o.pack = value,
                "--bundle" => o.bundle = Some(value.into()),
                "--sample-rate" => o.rate = value.parse().map_err(|_| "Invalid sample rate")?,
                "--frames" => o.frames = value.parse().map_err(|_| "Invalid frame count")?,
                "--timeout-ms" => {
                    o.timeout = Duration::from_millis(value.parse().map_err(|_| "Invalid timeout")?)
                }
                "--probe" => o.probe = Some(value),
                "--result" => o.result = Some(value.into()),
                _ => return Err(format!("Unknown option: {key}")),
            }
        }
        if !(8000..=192000).contains(&o.rate)
            || !(1..=2048).contains(&o.frames)
            || o.timeout < Duration::from_millis(10)
            || o.timeout > Duration::from_secs(60)
            || o.pack.is_empty()
            || o.pack.len() > 100
            || o.probe.is_some() != o.result.is_some()
        {
            return Err("Invalid probe options".into());
        }
        Ok(o)
    }
    fn world(&self) -> Result<World, String> {
        match &self.bundle {
            Some(p) => World::bundle(p),
            None => World::discover(),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
struct ResultRow {
    uri: String,
    name: String,
    status: String,
    reason: Option<String>,
    frames_processed: u64,
    channels: usize,
    peak: f32,
    rms: f64,
    latency_frames: u32,
}
impl ResultRow {
    fn empty(uri: String, name: String, status: &str, reason: Option<String>) -> Self {
        Self {
            uri,
            name,
            status: status.into(),
            reason,
            frames_processed: 0,
            channels: 0,
            peak: 0.0,
            rms: 0.0,
            latency_frames: 0,
        }
    }
}
#[derive(Debug, Serialize)]
struct Report {
    version: u32,
    pack: String,
    sample_rate: u32,
    block_frames: usize,
    input: &'static str,
    counts: BTreeMap<String, usize>,
    plugins: Vec<ResultRow>,
}
fn failed(row: &mut ResultRow, reason: String) {
    row.status = if reason.to_ascii_lowercase().contains("nonfinite") {
        "non_finite"
    } else {
        "failed"
    }
    .into();
    row.reason = Some(reason);
}
fn probe(o: &Options, uri: &str) -> Result<ResultRow, String> {
    let world = o.world()?;
    let info = world
        .plugins(f64::from(o.rate))?
        .into_iter()
        .find(|p| p.uri == uri)
        .ok_or("Plugin disappeared")?;
    let mut row = ResultRow::empty(uri.into(), info.name, "usable", None);
    let mut left = match Plugin::new_ports(&world, uri, f64::from(o.rate), o.frames) {
        Ok(p) => p,
        Err(e) => {
            failed(&mut row, e);
            return Ok(row);
        }
    };
    row.channels = left.channels();
    // Exercise both input channels for mono plugins using independent instances,
    // as a dual-mono rig does; declared stereo plugins own one instance.
    let mut right = if row.channels == 1 {
        Some(Plugin::new_ports(&world, uri, f64::from(o.rate), o.frames)?)
    } else {
        None
    };
    row.latency_frames = match left.prepare_latency() {
        Ok(n) => n,
        Err(e) => {
            failed(&mut row, e);
            return Ok(row);
        }
    };
    if let Some(p) = &mut right {
        p.prepare_latency()?;
    }
    let mut l = vec![0.0; o.frames];
    let mut r = vec![0.0; o.frames];
    let mut energy = 0.0;
    let mut noise = 0x19780912u32;
    let blocks = (o.rate as usize).div_ceil(o.frames);
    for block in 0..blocks {
        for n in 0..o.frames {
            let t = (block * o.frames + n) as f32 / o.rate as f32;
            noise ^= noise << 13;
            noise ^= noise >> 17;
            noise ^= noise << 5;
            let chord = [110.0, 164.81, 220.0, 329.63]
                .into_iter()
                .map(|f| (t * f * std::f32::consts::TAU).sin())
                .sum::<f32>()
                * 0.025;
            let hiss = (noise as f32 / u32::MAX as f32 - 0.5) * 0.02;
            l[n] = chord + hiss;
            r[n] = chord * 0.7 - hiss;
        }
        let result = if let Some(p) = &mut right {
            left.process_mono(&mut l)
                .and_then(|()| p.process_mono(&mut r))
        } else {
            left.process(&mut l, &mut r)
        };
        if let Err(e) = result {
            failed(&mut row, e);
            return Ok(row);
        }
        for x in l.iter().chain(&r) {
            if !x.is_finite() {
                failed(&mut row, "Nonfinite plugin output".into());
                return Ok(row);
            }
            row.peak = row.peak.max(x.abs());
            energy += f64::from(*x).powi(2);
        }
        row.frames_processed += o.frames as u64;
    }
    row.rms = (energy / (row.frames_processed * 2) as f64).sqrt();
    if row.peak < 1e-9 {
        row.status = "silent".into();
        row.reason =
            Some("Silent at defaults; may require assets, messages or different controls".into());
    }
    // Explicitly drop before writing a success receipt: destruction is tested too.
    drop(right);
    drop(left);
    drop(world);
    Ok(row)
}
fn wait(
    command: &mut Command,
    timeout: Duration,
) -> Result<Option<std::process::ExitStatus>, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return match result {
                    Err(e) => Err(e.to_string()),
                    _ => Ok(None),
                };
            }
        }
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let o = Options::parse()?;
    if let Some(uri) = &o.probe {
        let row = probe(&o, uri)?;
        std::fs::write(o.result.as_ref().unwrap(), serde_json::to_vec(&row)?)?;
        return Ok(());
    }
    let world = o.world()?;
    let mut catalog = world.plugins(f64::from(o.rate))?;
    catalog.sort_by(|a, b| a.uri.cmp(&b.uri));
    drop(world);
    let root = std::env::temp_dir().join(format!("oxidal-plugin-check-{}", std::process::id()));
    std::fs::create_dir(&root)?;
    let result = (|| -> Result<Report, Box<dyn std::error::Error>> {
        let mut plugins = Vec::new();
        for info in catalog {
            if let Some(reason) = info.unsupported {
                plugins.push(ResultRow::empty(
                    info.uri,
                    info.name,
                    "rejected",
                    Some(reason),
                ));
                continue;
            }
            let receipt = root.join("result.json");
            let _ = std::fs::remove_file(&receipt);
            let mut cmd = Command::new(std::env::current_exe()?);
            cmd.args([
                "--probe",
                &info.uri,
                "--sample-rate",
                &o.rate.to_string(),
                "--frames",
                &o.frames.to_string(),
                "--result",
            ])
            .arg(&receipt);
            if let Some(bundle) = &o.bundle {
                cmd.arg("--bundle").arg(bundle);
            }
            let row = match wait(&mut cmd, o.timeout) {
                Ok(Some(status)) if status.success() => match std::fs::read(&receipt)
                    .ok()
                    .filter(|b| b.len() <= 65536)
                    .and_then(|b| serde_json::from_slice::<ResultRow>(&b).ok())
                    .filter(|r| r.uri == info.uri)
                {
                    Some(row) => row,
                    None => ResultRow::empty(
                        info.uri,
                        info.name,
                        "failed",
                        Some("Invalid child receipt".into()),
                    ),
                },
                Ok(Some(status)) => {
                    use std::os::unix::process::ExitStatusExt;
                    ResultRow::empty(
                        info.uri,
                        info.name,
                        if status.signal().is_some() {
                            "crashed"
                        } else {
                            "failed"
                        },
                        Some(status.to_string()),
                    )
                }
                Ok(None) => ResultRow::empty(
                    info.uri,
                    info.name,
                    "timed_out",
                    Some("Child killed and reaped at deadline".into()),
                ),
                Err(reason) => ResultRow::empty(info.uri, info.name, "failed", Some(reason)),
            };
            plugins.push(row);
        }
        let mut counts = BTreeMap::new();
        for row in &plugins {
            *counts.entry(row.status.clone()).or_insert(0) += 1;
        }
        Ok(Report {
            version: 1,
            pack: o.pack.clone(),
            sample_rate: o.rate,
            block_frames: o.frames,
            input: "deterministic stereo chord plus noise; defaults; one second rounded to blocks",
            counts,
            plugins,
        })
    })();
    std::fs::remove_dir_all(root)?;
    println!("{}", serde_json::to_string_pretty(&result?)?);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crashed_and_timed_out_children_are_reaped_without_stopping_the_parent() {
        use std::os::unix::process::ExitStatusExt;
        let crash = wait(
            Command::new("sh").args(["-c", "kill -SEGV $$"]),
            Duration::from_secs(1),
        )
        .unwrap()
        .unwrap();
        assert_eq!(crash.signal(), Some(11));
        assert!(
            wait(Command::new("sleep").arg("5"), Duration::from_millis(30))
                .unwrap()
                .is_none()
        );
        assert!(
            wait(&mut Command::new("true"), Duration::from_secs(1))
                .unwrap()
                .unwrap()
                .success()
        );
    }
}
