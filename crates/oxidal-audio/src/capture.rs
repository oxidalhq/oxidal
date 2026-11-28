//! DI recording and reamping inside an audio worker. A helper thread owns all
//! file work: it opens a DI render and keeps a ring full for the input source,
//! and drains capture rings (the raw input R0 for Record DI, the rig output W0
//! for a reamp) into `incoming/<id>.capture` as little-endian float32. The
//! audio thread only installs rings it is handed, counts frames and decides
//! when a reamp has run its source plus tail. It never opens files, allocates
//! or blocks; finished rings go back to the helper to be freed.
//!
//! The daemon owns the job (exclusivity, finalizing the asset, source details);
//! the worker reports how many frames were written and whether the disk
//! failed.
//! @see docs/media.md
use crate::backing::MediaId;
use crate::session_media::{Consumer, InputSource, Producer, ring};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TryRecvError, sync_channel};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CaptureCommand {
    /// Write the raw interface input (mono) until stopped.
    RecordDi { output: MediaId, seq: u32 },
    /// Feed a DI render into the rig and write the rig's output (stereo)
    /// for the source length plus `tail_frames`, skipping `latency_frames`
    /// at the start so the result lines up with the DI.
    Reamp {
        source: MediaId,
        /// Channels in the source render, and which one to use.
        channels: u16,
        channel: u16,
        frames: u64,
        trim_and_gate: bool,
        output: MediaId,
        tail_frames: u64,
        latency_frames: u64,
        /// Hear the reamp while it runs; off mutes the outputs (not the result).
        monitoring: bool,
        seq: u32,
    },
    /// End the job; `keep` false discards what was written.
    Stop { seq: u32, keep: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaptureKind {
    Di,
    Reamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaptureFault {
    /// Writing failed (disk full or removed); the valid part is kept.
    Disk,
    /// The DI render could not be read.
    Source,
    /// The writer fell behind and samples were lost.
    Overflow,
}

/// Where the worker's capture job is.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureStatus {
    pub seq: u32,
    pub kind: CaptureKind,
    /// Still taking audio.
    pub running: bool,
    /// The file is complete on disk and synced; the daemon may finalize it.
    pub finished: bool,
    /// Frames on disk.
    pub frames: u64,
    /// Samples the audio thread could not hand over.
    pub lost: u64,
    pub fault: Option<CaptureFault>,
    /// Largest recent input sample, for the recording meter (dBFS).
    pub peak_dbfs: f32,
    pub discarded: bool,
}

const RING_SECONDS: u32 = 2;
const READ_BYTES: usize = 64 * 1024;

/// What the helper hands the audio thread for one job.
enum Arrival {
    Di {
        seq: u32,
        tap: Producer,
        shared: Arc<Progress>,
    },
    Reamp {
        seq: u32,
        source: Consumer,
        wet: Producer,
        shared: Arc<Progress>,
    },
    Failed {
        seq: u32,
        kind: CaptureKind,
        fault: CaptureFault,
    },
}

enum HelperCommand {
    Open(CaptureCommand),
    /// The audio thread has stopped feeding; flush and close.
    Finish {
        discard: bool,
    },
}

#[expect(
    dead_code,
    reason = "held only so a finished ring is freed here, off the audio thread"
)]
enum Retired {
    Producer(Producer),
    Consumer(Consumer),
}

/// Written by the helper, read by the audio thread for status.
#[derive(Debug, Default)]
struct Progress {
    frames: AtomicU64,
    finished: AtomicBool,
    disk_failed: AtomicBool,
    source_failed: AtomicBool,
}

#[derive(Debug)]
enum Active {
    /// The R0 tap itself lives in the host stage.
    Di,
    Reamp {
        wet: Producer,
        /// Frames of source still to feed, then tail frames still to run.
        source_left: u64,
        tail_left: u64,
        monitoring: bool,
        /// The DI has been fully fed and the input switched to silence.
        silenced: bool,
    },
}

/// Audio-thread half of the capture engine.
pub struct Capture {
    commands: SyncSender<HelperCommand>,
    arrivals: Receiver<Arrival>,
    retire: SyncSender<Retired>,
    limbo: Option<Retired>,
    wanted: u32,
    pending: Option<CaptureCommand>,
    active: Option<Active>,
    progress: Option<Arc<Progress>>,
    status: Option<CaptureStatus>,
    peak: f32,
    peak_decay: f32,
    lost: u64,
    /// Requests for the host: give back the R0 tap; return to Live input.
    release_tap: bool,
    restore_live: bool,
}
impl std::fmt::Debug for Capture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Capture")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

fn returned<T>(error: std::sync::mpsc::TrySendError<T>) -> T {
    match error {
        std::sync::mpsc::TrySendError::Full(v) | std::sync::mpsc::TrySendError::Disconnected(v) => {
            v
        }
    }
}

/// Path a capture is written to while it runs.
pub fn capture_path(root: &Path, output: MediaId) -> PathBuf {
    root.join("incoming")
        .join(format!("{}.capture", output.as_str()))
}

/// Starts the helper thread for a stream at `rate`.
pub fn start(rate: u32, root: PathBuf) -> Capture {
    let (commands, command_rx) = sync_channel(4);
    let (arrival_tx, arrivals) = sync_channel(2);
    let (retire, retired) = sync_channel(8);
    std::thread::Builder::new()
        .name("capture-helper".into())
        .spawn(move || helper(rate, root, command_rx, arrival_tx, retired))
        .expect("start the capture helper");
    Capture {
        commands,
        arrivals,
        retire,
        limbo: None,
        wanted: 0,
        pending: None,
        active: None,
        progress: None,
        status: None,
        peak: 0.0,
        peak_decay: (-1.0 / (0.3 * rate.max(1) as f32)).exp(),
        lost: 0,
        release_tap: false,
        restore_live: false,
    }
}

/// What the host should do with its input and outputs this block.
pub(crate) struct Plan {
    pub source: Option<InputSource>,
    pub raw_tap: Option<Producer>,
    pub muted: bool,
}

impl Capture {
    pub fn status(&self) -> Option<CaptureStatus> {
        let mut status = self.status?;
        if let Some(progress) = &self.progress {
            status.frames = progress.frames.load(Ordering::Acquire);
            status.finished = progress.finished.load(Ordering::Acquire);
            if progress.disk_failed.load(Ordering::Acquire) {
                status.fault = Some(CaptureFault::Disk);
            } else if progress.source_failed.load(Ordering::Acquire) {
                status.fault = Some(CaptureFault::Source);
            }
        }
        status.lost = self.lost;
        if status.lost > 0 && status.fault.is_none() {
            status.fault = Some(CaptureFault::Overflow);
        }
        status.peak_dbfs = if self.peak > 0.0 {
            20.0 * self.peak.log10()
        } else {
            -120.0
        };
        Some(status)
    }

    /// Whether a reamp currently replaces the live input.
    pub fn reamping(&self) -> bool {
        matches!(self.active, Some(Active::Reamp { .. }))
    }

    pub fn command(&mut self, command: CaptureCommand) {
        match command {
            CaptureCommand::RecordDi { seq, .. } | CaptureCommand::Reamp { seq, .. } => {
                if self.active.is_some() || self.status.is_some_and(|s| s.running) {
                    return;
                }
                if self
                    .commands
                    .try_send(HelperCommand::Open(command))
                    .is_err()
                {
                    return;
                }
                let kind = if matches!(command, CaptureCommand::RecordDi { .. }) {
                    CaptureKind::Di
                } else {
                    CaptureKind::Reamp
                };
                self.wanted = seq;
                self.pending = Some(command);
                self.progress = None;
                self.lost = 0;
                self.peak = 0.0;
                self.status = Some(CaptureStatus {
                    seq,
                    kind,
                    running: true,
                    finished: false,
                    frames: 0,
                    lost: 0,
                    fault: None,
                    peak_dbfs: -120.0,
                    discarded: false,
                });
            }
            CaptureCommand::Stop { seq, keep } => {
                if self.status.is_some_and(|s| s.seq == seq && s.running) {
                    self.finish(!keep);
                }
            }
        }
    }

    fn hand_back(&mut self, item: Retired) {
        if let Some(waiting) = self.limbo.take()
            && let Err(e) = self.retire.try_send(waiting)
        {
            self.limbo = Some(returned(e));
        }
        if let Err(e) = self.retire.try_send(item) {
            self.limbo = Some(returned(e));
        }
    }

    fn finish(&mut self, discard: bool) {
        self.pending = None;
        match self.active.take() {
            Some(Active::Di) => self.release_tap = true,
            Some(Active::Reamp { wet, .. }) => {
                self.hand_back(Retired::Producer(wet));
                self.restore_live = true;
            }
            None => {}
        }
        let _ = self.commands.try_send(HelperCommand::Finish { discard });
        if let Some(status) = &mut self.status {
            status.running = false;
            status.discarded = discard;
        }
    }

    /// Before the input stage: installs arrived rings and says what the
    /// input should be. `raw` is the interface input (R0) for the meter.
    pub(crate) fn before_input(&mut self, raw: &[f32]) -> Plan {
        if let Some(waiting) = self.limbo.take()
            && let Err(e) = self.retire.try_send(waiting)
        {
            self.limbo = Some(returned(e));
        }
        let mut plan = Plan {
            source: None,
            raw_tap: None,
            muted: false,
        };
        loop {
            match self.arrivals.try_recv() {
                Ok(Arrival::Di { seq, tap, shared })
                    if seq == self.wanted && self.pending.is_some() =>
                {
                    self.pending = None;
                    self.progress = Some(shared);
                    // The host owns the R0 tap; it returns the previous one.
                    self.active = Some(Active::Di);
                    plan.raw_tap = Some(tap);
                }
                Ok(Arrival::Reamp {
                    seq,
                    source,
                    wet,
                    shared,
                }) if seq == self.wanted && self.pending.is_some() => {
                    let Some(CaptureCommand::Reamp {
                        frames,
                        tail_frames,
                        latency_frames,
                        trim_and_gate,
                        monitoring,
                        ..
                    }) = self.pending.take()
                    else {
                        continue;
                    };
                    self.progress = Some(shared);
                    plan.source = Some(InputSource::Reamp {
                        frames: source,
                        trim_and_gate,
                    });
                    self.active = Some(Active::Reamp {
                        wet,
                        source_left: frames,
                        tail_left: tail_frames + latency_frames,
                        monitoring,
                        silenced: false,
                    });
                }
                Ok(Arrival::Failed { seq, kind, fault }) if seq == self.wanted => {
                    self.pending = None;
                    self.status = Some(CaptureStatus {
                        seq,
                        kind,
                        running: false,
                        finished: false,
                        frames: 0,
                        lost: 0,
                        fault: Some(fault),
                        peak_dbfs: -120.0,
                        discarded: true,
                    });
                }
                Ok(Arrival::Di { tap, .. }) => self.hand_back(Retired::Producer(tap)),
                Ok(Arrival::Reamp { source, wet, .. }) => {
                    self.hand_back(Retired::Consumer(source));
                    self.hand_back(Retired::Producer(wet));
                }
                Ok(Arrival::Failed { .. }) => {}
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }
        // The input meter follows the raw guitar while recording.
        if matches!(self.active, Some(Active::Di)) {
            for s in raw {
                self.peak = (self.peak * self.peak_decay).max(s.abs());
            }
        }
        if let Some(Active::Reamp {
            source_left,
            monitoring,
            silenced,
            ..
        }) = &mut self.active
        {
            if *source_left == 0 && !*silenced {
                // The DI has been fed: the rig rings out on silence.
                plan.source = Some(InputSource::Silent);
                *silenced = true;
            }
            // This block consumes up to one block of the DI.
            *source_left = source_left.saturating_sub(raw.len() as u64);
            plan.muted = !*monitoring;
        }
        // Mute from the moment a reamp is accepted, not when its ring arrives.
        if let Some(CaptureCommand::Reamp { monitoring, .. }) = self.pending {
            plan.muted = !monitoring;
        }
        plan
    }

    /// The host hands back an R0 tap it replaced; it is freed off-thread.
    pub(crate) fn release_tap(&mut self, tap: Producer) {
        self.hand_back(Retired::Producer(tap));
    }
    /// The host hands back an input source it replaced.
    pub(crate) fn release_source(&mut self, source: InputSource) {
        if let InputSource::Reamp { frames, .. } = source {
            self.hand_back(Retired::Consumer(frames));
        }
    }
    /// What the host must undo now: (give back the R0 tap, return to Live).
    pub(crate) fn take_requests(&mut self) -> (bool, bool) {
        let faulted = self.progress.as_ref().is_some_and(|p| {
            p.disk_failed.load(Ordering::Acquire) || p.source_failed.load(Ordering::Acquire)
        });
        if faulted && self.active.is_some() {
            self.finish(false);
        }
        (
            std::mem::take(&mut self.release_tap),
            std::mem::take(&mut self.restore_live),
        )
    }

    /// After tone gain (W0): writes the rig output and ends a reamp once its
    /// source and tail have run.
    pub(crate) fn after_rig(&mut self, left: &[f32], right: &[f32]) {
        let mut ended = false;
        if let Some(Active::Reamp {
            wet,
            tail_left,
            silenced,
            ..
        }) = &mut self.active
        {
            let mut pair = [0.0f32; 2];
            for (l, r) in left.iter().zip(right) {
                pair[0] = *l;
                pair[1] = *r;
                if wet.push(&pair) < 2 {
                    self.lost += 2;
                }
            }
            if *silenced {
                *tail_left = tail_left.saturating_sub(left.len() as u64);
                ended = *tail_left == 0;
            }
        }
        if ended {
            self.finish(false);
        }
    }

    /// The host reports samples its raw tap dropped while recording.
    pub(crate) fn add_lost(&mut self, samples: u64) {
        if matches!(self.active, Some(Active::Di)) {
            self.lost += samples;
        }
    }
}

fn helper(
    rate: u32,
    root: PathBuf,
    commands: Receiver<HelperCommand>,
    arrivals: SyncSender<Arrival>,
    retired: Receiver<Retired>,
) {
    crate::realtime::leave();
    let mut job: Option<Job> = None;
    let mut bytes = vec![0u8; READ_BYTES];
    let mut samples = vec![0f32; READ_BYTES / 4];
    loop {
        while retired.try_recv().is_ok() {}
        let wait = if job.is_some() {
            Duration::from_millis(5)
        } else {
            Duration::from_millis(50)
        };
        match commands.recv_timeout(wait) {
            Ok(HelperCommand::Open(command)) => {
                if let Some(old) = job.take() {
                    old.close(true);
                }
                match Job::open(rate, &root, command) {
                    Ok((new, arrival)) => {
                        if arrivals.send(arrival).is_err() {
                            new.close(true);
                            return;
                        }
                        job = Some(new);
                    }
                    Err(arrival) => {
                        if arrivals.send(arrival).is_err() {
                            return;
                        }
                    }
                }
            }
            Ok(HelperCommand::Finish { discard }) => {
                if let Some(mut done) = job.take() {
                    // Drain what the audio thread handed over, then close.
                    if !discard {
                        let _ = done.drain(&mut samples);
                    }
                    done.close(discard);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                if let Some(old) = job.take() {
                    old.close(false);
                }
                return;
            }
        }
        if let Some(active) = &mut job {
            if active.drain(&mut samples).is_err() {
                active.progress.disk_failed.store(true, Ordering::Release);
            }
            if active.feed(&mut bytes).is_err() {
                active.progress.source_failed.store(true, Ordering::Release);
            }
        }
    }
}

struct Job {
    path: PathBuf,
    out: Option<BufWriter<std::fs::File>>,
    capture: Consumer,
    /// Values per frame in the capture (1 for DI, 2 for reamp).
    width: u64,
    skip: u64,
    written_samples: u64,
    progress: Arc<Progress>,
    source: Option<Source>,
}

struct Source {
    file: std::fs::File,
    feed: Producer,
    channels: usize,
    channel: usize,
    left: u64,
}

impl Job {
    fn open(rate: u32, root: &Path, command: CaptureCommand) -> Result<(Self, Arrival), Arrival> {
        let progress = Arc::new(Progress::default());
        match command {
            CaptureCommand::RecordDi { output, seq } => {
                let path = capture_path(root, output);
                let file = std::fs::File::create(&path).map_err(|_| Arrival::Failed {
                    seq,
                    kind: CaptureKind::Di,
                    fault: CaptureFault::Disk,
                })?;
                let (tap, capture) = ring((rate * RING_SECONDS) as usize);
                Ok((
                    Self {
                        path,
                        out: Some(BufWriter::with_capacity(256 * 1024, file)),
                        capture,
                        width: 1,
                        skip: 0,
                        written_samples: 0,
                        progress: Arc::clone(&progress),
                        source: None,
                    },
                    Arrival::Di {
                        seq,
                        tap,
                        shared: progress,
                    },
                ))
            }
            CaptureCommand::Reamp {
                source,
                channels,
                channel,
                frames,
                output,
                latency_frames,
                seq,
                ..
            } => {
                let fail = |fault| Arrival::Failed {
                    seq,
                    kind: CaptureKind::Reamp,
                    fault,
                };
                let render = root
                    .join("assets")
                    .join(source.as_str())
                    .join(format!("play-{rate}.f32"));
                let file = std::fs::File::open(&render).map_err(|_| fail(CaptureFault::Source))?;
                let expected = frames * u64::from(channels) * 4;
                if channels == 0
                    || channel >= channels
                    || file.metadata().map(|m| m.len()).ok() != Some(expected)
                {
                    return Err(fail(CaptureFault::Source));
                }
                let path = capture_path(root, output);
                let out = std::fs::File::create(&path).map_err(|_| fail(CaptureFault::Disk))?;
                let (feed, source_ring) = ring((rate * RING_SECONDS) as usize);
                let (wet, capture) = ring((rate * RING_SECONDS * 2) as usize);
                let mut job = Self {
                    path,
                    out: Some(BufWriter::with_capacity(256 * 1024, out)),
                    capture,
                    width: 2,
                    skip: latency_frames * 2,
                    written_samples: 0,
                    progress: Arc::clone(&progress),
                    source: Some(Source {
                        file,
                        feed,
                        channels: usize::from(channels),
                        channel: usize::from(channel),
                        left: frames,
                    }),
                };
                // Fill the source ring before the audio thread starts pulling.
                let mut bytes = vec![0u8; READ_BYTES];
                for _ in 0..8 {
                    if job.feed(&mut bytes).is_err() {
                        return Err(fail(CaptureFault::Source));
                    }
                }
                Ok((
                    job,
                    Arrival::Reamp {
                        seq,
                        source: source_ring,
                        wet,
                        shared: progress,
                    },
                ))
            }
            CaptureCommand::Stop { seq, .. } => Err(Arrival::Failed {
                seq,
                kind: CaptureKind::Di,
                fault: CaptureFault::Source,
            }),
        }
    }

    /// Moves captured samples to disk.
    fn drain(&mut self, samples: &mut [f32]) -> std::io::Result<()> {
        let Some(out) = &mut self.out else {
            return Ok(());
        };
        loop {
            let n = self.capture.pop(samples);
            if n == 0 {
                return Ok(());
            }
            let mut start = 0;
            if self.skip > 0 {
                let dropped = (self.skip as usize).min(n);
                self.skip -= dropped as u64;
                start = dropped;
            }
            for s in &samples[start..n] {
                out.write_all(&s.to_le_bytes())?;
            }
            self.written_samples += (n - start) as u64;
            self.progress
                .frames
                .store(self.written_samples / self.width, Ordering::Release);
        }
    }

    /// Keeps the DI source ring full (one channel of the render).
    fn feed(&mut self, bytes: &mut [u8]) -> std::io::Result<()> {
        let Some(source) = &mut self.source else {
            return Ok(());
        };
        let frame_bytes = source.channels * 4;
        let room = source.feed.free().min(bytes.len() / frame_bytes);
        let frames = (room as u64).min(source.left) as usize;
        if frames == 0 {
            return Ok(());
        }
        source.file.read_exact(&mut bytes[..frames * frame_bytes])?;
        let mut mono = [0f32; 256];
        for chunk in bytes[..frames * frame_bytes].chunks(frame_bytes * mono.len()) {
            let n = chunk.len() / frame_bytes;
            for (i, frame) in chunk.chunks_exact(frame_bytes).enumerate() {
                let at = source.channel * 4;
                mono[i] =
                    f32::from_le_bytes([frame[at], frame[at + 1], frame[at + 2], frame[at + 3]]);
            }
            source.feed.push(&mono[..n]);
        }
        source.left -= frames as u64;
        Ok(())
    }

    /// Flushes and syncs (or deletes) the capture file, then reports it.
    fn close(mut self, discard: bool) {
        if let Some(out) = self.out.take() {
            let synced = out
                .into_inner()
                .map_err(|e| e.into_error())
                .and_then(|file| file.sync_all());
            if synced.is_err() {
                self.progress.disk_failed.store(true, Ordering::Release);
            }
        }
        if discard {
            let _ = std::fs::remove_file(&self.path);
        }
        self.progress.finished.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{HostLevels, HostSignal, HostUtility};

    const RATE: u32 = 48_000;
    const DI: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2T";
    const OUT: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2V";

    fn root() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "oxidal-capture-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("incoming")).unwrap();
        root
    }

    fn read(path: &Path) -> Vec<f32> {
        std::fs::read(path)
            .unwrap()
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect()
    }

    fn signal(root: &Path) -> HostSignal {
        let mut signal = HostSignal::new(RATE, true, HostLevels::default());
        signal.attach_capture(start(RATE, root.to_path_buf()));
        signal
    }

    fn wait(signal: &HostSignal, until: impl Fn(&CaptureStatus) -> bool) -> CaptureStatus {
        for _ in 0..2000 {
            if let Some(status) = signal.state().capture
                && until(&status)
            {
                return status;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!(
            "capture never reached the expected state: {:?}",
            signal.state().capture
        );
    }

    #[test]
    fn record_di_writes_exactly_the_raw_input() {
        let root = root();
        let mut signal = signal(&root);
        let output = MediaId::parse(OUT).unwrap();
        signal.command(HostUtility::Capture {
            command: CaptureCommand::RecordDi { output, seq: 1 },
        });
        let mut sent = Vec::new();
        let mut counter = 0u32;
        for block in 0..400 {
            let mut l: Vec<f32> = (0..64)
                .map(|_| {
                    counter += 1;
                    counter as f32 / 100_000.0
                })
                .collect();
            let mut r = l.clone();
            let raw = l.clone();
            signal.input(&mut l, &mut r);
            if signal.state().capture.is_some_and(|s| s.running) && block > 0 {
                sent.extend(raw);
            }
            std::thread::sleep(Duration::from_micros(100));
        }
        signal.command(HostUtility::Capture {
            command: CaptureCommand::Stop { seq: 1, keep: true },
        });
        let mut l = [0.0; 64];
        signal.input(&mut l, &mut [0.0; 64]);
        let status = wait(&signal, |s| s.finished);
        assert_eq!(
            (status.kind, status.running, status.fault),
            (CaptureKind::Di, false, None)
        );
        let written = read(&capture_path(&root, output));
        assert_eq!(written.len() as u64, status.frames);
        assert!(written.len() > 20_000, "{}", written.len());
        // Contiguous raw samples (the guitar was not trimmed or gated first).
        assert!(
            written
                .windows(2)
                .all(|w| ((w[1] - w[0]) * 100_000.0 - 1.0).abs() < 0.01)
        );
        assert!(status.peak_dbfs > -30.0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_reamp_replaces_the_guitar_writes_the_rig_and_restores_live() {
        let root = root();
        let frames = 9_600u64;
        let dir = root.join("assets").join(DI);
        std::fs::create_dir_all(&dir).unwrap();
        // A stereo DI file; the right channel is chosen.
        let mut bytes = Vec::new();
        for i in 0..frames {
            bytes.extend_from_slice(&(-1.0f32).to_le_bytes());
            bytes.extend_from_slice(&((i + 1) as f32 / 100_000.0).to_le_bytes());
        }
        std::fs::write(dir.join(format!("play-{RATE}.f32")), bytes).unwrap();
        let mut signal = signal(&root);
        let output = MediaId::parse(OUT).unwrap();
        let tail = 4_800u64;
        signal.command(HostUtility::Capture {
            command: CaptureCommand::Reamp {
                source: MediaId::parse(DI).unwrap(),
                channels: 2,
                channel: 1,
                frames,
                trim_and_gate: false,
                output,
                tail_frames: tail,
                latency_frames: 0,
                monitoring: false,
                seq: 7,
            },
        });
        let mut heard_live_during = false;
        let mut loudest_out = 0.0f32;
        for block in 0..2000 {
            let (mut l, mut r) = ([0.9f32; 128], [0.9f32; 128]);
            signal.input(&mut l, &mut r);
            let reamping = signal.state().capture.is_some_and(|s| s.running);
            if reamping && l.contains(&0.9) && l[0] != 0.9 {
                heard_live_during = true;
            }
            // The "rig" here is a pass-through.
            signal.output(&mut l, &mut r);
            // After the 10 ms mute fade, nothing reaches the outputs.
            if reamping && block > 40 {
                loudest_out = l.iter().fold(loudest_out, |m, v| m.max(v.abs()));
            }
            if signal.state().capture.is_some_and(|s| !s.running) {
                break;
            }
            std::thread::sleep(Duration::from_micros(200));
        }
        let status = wait(&signal, |s| s.finished);
        assert_eq!(status.fault, None);
        assert!(!heard_live_during);
        assert!(
            loudest_out < 0.05,
            "monitoring off mutes the outputs: {loudest_out}"
        );
        let written = read(&capture_path(&root, output));
        assert_eq!(written.len() as u64, status.frames * 2);
        let left: Vec<f32> = written.chunks_exact(2).map(|p| p[0]).collect();
        // The whole DI, then the tail (block-rounded), and the rig output is stereo.
        let start = left.iter().position(|v| *v != 0.0).unwrap();
        let di = &left[start..start + frames as usize];
        let bad = di
            .iter()
            .enumerate()
            .find(|(i, v)| (*v * 100_000.0 - (*i + 1) as f32).abs() >= 0.01);
        assert!(
            bad.is_none(),
            "start {start}, first bad {bad:?}, head {:?}",
            &left[..start + 4]
        );
        assert!(written.chunks_exact(2).all(|p| p[0] == p[1]));
        assert!(
            status.frames >= frames + tail && status.frames < frames + tail + 512 + start as u64
        );
        assert!(
            left[start + frames as usize..].iter().all(|v| *v == 0.0),
            "tail is the rig ringing out"
        );
        // Live guitar is back afterwards.
        let (mut l, mut r) = ([0.25f32; 64], [0.25f32; 64]);
        signal.input(&mut l, &mut r);
        assert_eq!(l, [0.25; 64]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_source_is_reported_and_nothing_is_written() {
        let root = root();
        let mut signal = signal(&root);
        let output = MediaId::parse(OUT).unwrap();
        signal.command(HostUtility::Capture {
            command: CaptureCommand::Reamp {
                source: MediaId::parse(DI).unwrap(),
                channels: 1,
                channel: 0,
                frames: 100,
                trim_and_gate: true,
                output,
                tail_frames: 0,
                latency_frames: 0,
                monitoring: true,
                seq: 2,
            },
        });
        for _ in 0..200 {
            let (mut l, mut r) = ([0.5f32; 64], [0.5f32; 64]);
            signal.input(&mut l, &mut r);
            if signal.state().capture.is_some_and(|s| s.fault.is_some()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        let status = signal.state().capture.unwrap();
        assert_eq!(status.fault, Some(CaptureFault::Source));
        assert!(!status.running);
        assert!(!capture_path(&root, output).exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
