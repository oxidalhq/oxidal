//! Backing-track playback inside an audio worker. A reader thread streams a
//! play-ready float32 render from the media store into a preallocated ring;
//! the audio thread pops it, fades, applies the player gain and mixes it at the
//! session mix point. The daemon owns the transport state; the worker only
//! plays what it is told and reports where it is.
//!
//! The audio thread never opens files, allocates or blocks: commands to the
//! reader and rings in both directions travel over bounded channels with
//! `try_send`/`try_recv`, and finished rings are handed back to the reader so
//! their memory is freed off the audio thread.
//! @see docs/media.md
use crate::session_media::{Consumer, Producer, ring};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TryRecvError, sync_channel};
use std::time::Duration;

/// A media asset ID (26-character ULID), fixed-size so commands stay `Copy`.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct MediaId([u8; 26]);
impl MediaId {
    pub fn parse(text: &str) -> Option<Self> {
        const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        let bytes: [u8; 26] = text.as_bytes().try_into().ok()?;
        (bytes[0] <= b'7' && bytes.iter().all(|b| CROCKFORD.contains(b))).then_some(Self(bytes))
    }
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("validated ASCII")
    }
}
impl std::fmt::Debug for MediaId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl Serialize for MediaId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for MediaId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        Self::parse(&text).ok_or_else(|| serde::de::Error::custom("invalid media ID"))
    }
}
impl JsonSchema for MediaId {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "MediaId".into()
    }
    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        String::json_schema(generator)
    }
}

/// What the daemon asks the worker's backing player to do.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BackingCommand {
    /// Play a render from `from` (a frame), fading in once 100 ms is buffered.
    /// Sent again with a new `seq` to seek: the old position fades out first.
    Play {
        asset: MediaId,
        channels: u16,
        frames: u64,
        from: u64,
        seq: u32,
        repeat: bool,
        gain_db: f32,
    },
    /// Fade out and stop. The last frame stays in the status.
    Stop {
        seq: u32,
    },
    /// Player level plus track trim, gliding over 20 ms.
    Gain {
        gain_db: f32,
    },
    Repeat {
        repeat: bool,
    },
}
impl BackingCommand {
    pub fn valid(&self) -> bool {
        match *self {
            Self::Play {
                channels,
                frames,
                from,
                gain_db,
                ..
            } => (1..=2).contains(&channels) && frames > 0 && from < frames && valid_gain(gain_db),
            Self::Gain { gain_db } => valid_gain(gain_db),
            Self::Stop { .. } | Self::Repeat { .. } => true,
        }
    }
}
fn valid_gain(db: f32) -> bool {
    db.is_finite() && (-90.0..=12.0).contains(&db)
}

/// Where the worker's backing player is, reported with every telemetry snapshot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackingStatus {
    /// The command sequence this status describes.
    pub seq: u32,
    /// Frame last sent to the outputs.
    pub frame: u64,
    pub playing: bool,
    /// Reached the last frame with Repeat off.
    pub ended: bool,
    /// Blocks that ran out of data and played silence, this worker lifetime.
    pub underruns: u64,
    /// The render could not be opened.
    pub missing: bool,
}

const FADE_SECONDS: f32 = 0.010;
const GAIN_GLIDE_SECONDS: f32 = 0.020;
/// Ring holds this much read-ahead.
const RING_SECONDS: u32 = 2;
/// Fade in only once this much is buffered.
const START_SECONDS: f32 = 0.100;
const READ_BYTES: usize = 64 * 1024;

enum ReaderCommand {
    Open {
        asset: MediaId,
        channels: u16,
        frames: u64,
        from: u64,
        seq: u32,
        repeat: bool,
    },
    Repeat(bool),
    Close,
}

enum Arrival {
    Track { seq: u32, frames: Consumer },
    Missing { seq: u32 },
}

/// Audio-thread half of the backing player.
pub struct Backing {
    rate: u32,
    commands: SyncSender<ReaderCommand>,
    arrivals: Receiver<Arrival>,
    retire: SyncSender<Consumer>,
    /// A ring waiting to be handed back because the retire channel was full.
    limbo: Option<Consumer>,
    current: Option<Consumer>,
    /// The ring for a new position, waiting while the old one fades out.
    next: Option<Consumer>,
    /// Fading the current ring out to move to another position or track.
    switching: bool,
    /// Sequence the daemon most recently asked for.
    wanted: u32,
    /// Frames in the asset, and where the current ring starts.
    total: u64,
    repeat: bool,
    want_playing: bool,
    started: bool,
    fade: f32,
    fade_step: f32,
    gain: f32,
    gain_target: f32,
    gain_step: f32,
    status: BackingStatus,
    scratch: [f32; 512],
}
impl std::fmt::Debug for Backing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Backing")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

/// The media root workers read renders from: `OXIDAL_MEDIA_DIR`, else the
/// daemon's development default.
pub fn media_root() -> PathBuf {
    std::env::var_os("OXIDAL_MEDIA_DIR")
        .map_or_else(|| PathBuf::from(".local/media"), PathBuf::from)
}

/// Starts the reader thread for a stream at `rate` and returns the audio
/// thread's half. The reader stops when the returned half is dropped.
pub fn start(rate: u32, root: PathBuf) -> Backing {
    let (commands, command_rx) = sync_channel(8);
    let (arrival_tx, arrivals) = sync_channel(2);
    let (retire, retired) = sync_channel(8);
    std::thread::Builder::new()
        .name("backing-reader".into())
        .spawn(move || reader(rate, root, command_rx, arrival_tx, retired))
        .expect("start the backing reader");
    let rate = rate.max(1);
    Backing {
        rate,
        commands,
        arrivals,
        retire,
        limbo: None,
        current: None,
        next: None,
        switching: false,
        wanted: 0,
        total: 0,
        repeat: false,
        want_playing: false,
        started: false,
        fade: 0.0,
        fade_step: 1.0 / (FADE_SECONDS * rate as f32),
        gain: 0.0,
        gain_target: 0.0,
        gain_step: 1.0 - (-1.0 / (GAIN_GLIDE_SECONDS / 4.0 * rate as f32)).exp(),
        status: BackingStatus::default(),
        scratch: [0.0; 512],
    }
}

fn returned<T>(error: std::sync::mpsc::TrySendError<T>) -> T {
    match error {
        std::sync::mpsc::TrySendError::Full(value)
        | std::sync::mpsc::TrySendError::Disconnected(value) => value,
    }
}

fn gain(db: f32) -> f32 {
    if db <= -90.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

impl Backing {
    pub fn status(&self) -> BackingStatus {
        self.status
    }
    pub fn command(&mut self, command: BackingCommand) {
        if !command.valid() {
            return;
        }
        match command {
            BackingCommand::Play {
                asset,
                channels,
                frames,
                from,
                seq,
                repeat,
                gain_db,
            } => {
                // Ask first: if the reader's queue is full, keep playing as before.
                let open = ReaderCommand::Open {
                    asset,
                    channels,
                    frames,
                    from,
                    seq,
                    repeat,
                };
                if self.commands.try_send(open).is_err() {
                    return;
                }
                self.wanted = seq;
                self.total = frames;
                self.repeat = repeat;
                self.want_playing = true;
                if self.current.is_some() {
                    self.switching = true;
                }
                if let Some(stale) = self.next.take() {
                    self.hand_back(stale);
                }
                self.gain_target = gain(gain_db);
                if self.current.is_none() {
                    // Nothing audible to fade out: start the new level directly.
                    self.gain = self.gain_target;
                }
                self.status = BackingStatus {
                    seq,
                    frame: from,
                    playing: true,
                    ended: false,
                    underruns: self.status.underruns,
                    missing: false,
                };
            }
            BackingCommand::Stop { seq } => {
                if self.commands.try_send(ReaderCommand::Close).is_ok() {
                    self.wanted = seq;
                    self.want_playing = false;
                    self.status.seq = seq;
                    self.status.playing = false;
                }
            }
            BackingCommand::Gain { gain_db } => self.gain_target = gain(gain_db),
            BackingCommand::Repeat { repeat } => {
                if self
                    .commands
                    .try_send(ReaderCommand::Repeat(repeat))
                    .is_ok()
                {
                    self.repeat = repeat;
                }
            }
        }
    }

    fn retire_current(&mut self) {
        if let Some(old) = self.current.take() {
            self.hand_back(old);
        }
        self.started = false;
        self.fade = 0.0;
    }
    fn hand_back(&mut self, consumer: Consumer) {
        if let Some(waiting) = self.limbo.take()
            && let Err(e) = self.retire.try_send(waiting)
        {
            self.limbo = Some(returned(e));
        }
        if let Err(e) = self.retire.try_send(consumer) {
            // Retried every block. If an older ring is still waiting, it is
            // dropped here: the reader has stopped, so nothing else can free it.
            self.limbo = Some(returned(e));
        }
    }

    /// Mixes the backing track into `left`/`right` (the session mix point).
    pub fn mix(&mut self, left: &mut [f32], right: &mut [f32]) {
        if let Some(waiting) = self.limbo.take()
            && let Err(e) = self.retire.try_send(waiting)
        {
            self.limbo = Some(returned(e));
        }
        // Rings for an older request than the latest are discarded.
        loop {
            match self.arrivals.try_recv() {
                Ok(Arrival::Track { seq, frames }) if seq == self.wanted && self.want_playing => {
                    if self.current.is_none() {
                        self.current = Some(frames);
                        self.started = false;
                    } else {
                        if let Some(stale) = self.next.replace(frames) {
                            self.hand_back(stale);
                        }
                        self.switching = true;
                    }
                }
                Ok(Arrival::Track { frames, .. }) => self.hand_back(frames),
                Ok(Arrival::Missing { seq }) if seq == self.wanted => {
                    self.status.missing = true;
                    self.status.playing = false;
                    self.want_playing = false;
                }
                Ok(Arrival::Missing { .. }) => {}
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }
        self.swap_if_silent();
        if self.current.is_none() {
            return;
        }
        let leaving = !self.want_playing || self.switching;
        if !self.started && !leaving {
            let needed = ((START_SECONDS * self.rate as f32) as u64)
                .min(self.total.saturating_sub(self.status.frame))
                .max(1) as usize
                * 2;
            if self
                .current
                .as_ref()
                .is_some_and(|c| c.available() < needed)
            {
                return;
            }
            self.started = true;
        }
        if !self.started {
            return;
        }
        let mut short = false;
        for (left, right) in left.chunks_mut(256).zip(right.chunks_mut(256)) {
            let frames = left.len();
            let leaving = !self.want_playing || self.switching;
            // Only pop what the track still has, so the end lands exactly.
            let remaining = if self.repeat || leaving {
                frames
            } else {
                (self.total.saturating_sub(self.status.frame) as usize).min(frames)
            };
            let got = self.current.as_mut().map_or(0, |current| {
                current.pop(&mut self.scratch[..remaining * 2]) / 2
            });
            if got < remaining && !leaving {
                short = true;
            }
            for i in 0..frames {
                let (l, r) = if i < got {
                    (self.scratch[2 * i], self.scratch[2 * i + 1])
                } else {
                    (0.0, 0.0)
                };
                self.fade = if leaving {
                    (self.fade - self.fade_step).max(0.0)
                } else {
                    (self.fade + self.fade_step).min(1.0)
                };
                self.gain += (self.gain_target - self.gain) * self.gain_step;
                let g = self.fade * self.gain;
                left[i] += l * g;
                right[i] += r * g;
            }
            if leaving {
                if self.fade <= 0.0 {
                    self.swap_if_silent();
                    break;
                }
                continue;
            }
            self.status.frame += got as u64;
            if self.repeat && self.total > 0 {
                self.status.frame %= self.total;
            }
            if !self.repeat && self.status.frame >= self.total {
                self.status.frame = self.total;
                self.status.ended = true;
                self.status.playing = false;
                self.want_playing = false;
                let _ = self.commands.try_send(ReaderCommand::Close);
                self.retire_current();
                break;
            }
        }
        if short {
            self.status.underruns += 1;
        }
    }

    /// Once the leaving ring is silent, release it and move to the next.
    fn swap_if_silent(&mut self) {
        let leaving = !self.want_playing || self.switching;
        if !leaving || self.fade > 0.0 || self.current.is_none() && self.next.is_none() {
            return;
        }
        self.retire_current();
        if let Some(next) = self.next.take() {
            self.current = Some(next);
            self.switching = false;
        } else if self.want_playing {
            // The new ring has not arrived yet; it installs itself on arrival.
            self.switching = false;
        }
    }
}

/// Non-realtime reader: opens renders, seeks, converts mono to stereo and keeps
/// the ring full. Frees rings the audio thread hands back.
fn reader(
    rate: u32,
    root: PathBuf,
    commands: Receiver<ReaderCommand>,
    arrivals: SyncSender<Arrival>,
    retired: Receiver<Consumer>,
) {
    crate::realtime::leave();
    let capacity = (rate * RING_SECONDS * 2) as usize;
    let mut track: Option<Track> = None;
    let mut bytes = vec![0u8; READ_BYTES];
    let mut stereo = Vec::with_capacity(READ_BYTES / 2);
    loop {
        while retired.try_recv().is_ok() {}
        let command = if track.as_ref().is_some_and(|t| !t.done) {
            match commands.try_recv() {
                Ok(command) => Some(command),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => return,
            }
        } else {
            match commands.recv_timeout(Duration::from_millis(20)) {
                Ok(command) => Some(command),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        match command {
            Some(ReaderCommand::Open {
                asset,
                channels,
                frames,
                from,
                seq,
                repeat,
            }) => {
                track = None;
                let path = root
                    .join("assets")
                    .join(asset.as_str())
                    .join(format!("play-{rate}.f32"));
                let opened = std::fs::File::open(&path).and_then(|mut file| {
                    let expected = frames * u64::from(channels) * 4;
                    if file.metadata()?.len() != expected {
                        return Err(std::io::Error::other("render size differs"));
                    }
                    file.seek(SeekFrom::Start(from * u64::from(channels) * 4))?;
                    Ok(file)
                });
                match opened {
                    Ok(file) => {
                        let (producer, consumer) = ring(capacity);
                        if arrivals
                            .send(Arrival::Track {
                                seq,
                                frames: consumer,
                            })
                            .is_err()
                        {
                            return;
                        }
                        track = Some(Track {
                            file,
                            producer,
                            channels: usize::from(channels),
                            repeat,
                            done: false,
                            carry: Vec::new(),
                        });
                    }
                    Err(_) => {
                        if arrivals.send(Arrival::Missing { seq }).is_err() {
                            return;
                        }
                    }
                }
            }
            Some(ReaderCommand::Repeat(repeat)) => {
                if let Some(track) = &mut track {
                    track.repeat = repeat;
                    if repeat {
                        track.done = false;
                    }
                }
            }
            Some(ReaderCommand::Close) => track = None,
            None => {}
        }
        if let Some(t) = &mut track {
            match t.fill(&mut bytes, &mut stereo) {
                Ok(true) => {}
                // Ring full: let the audio thread drain a little.
                Ok(false) => std::thread::sleep(Duration::from_millis(5)),
                Err(_) => {
                    // A read error mid-track: stop feeding; the audio thread
                    // reports underruns until the daemon decides.
                    t.done = true;
                }
            }
        }
    }
}

struct Track {
    file: std::fs::File,
    producer: Producer,
    channels: usize,
    repeat: bool,
    /// Reached the end with Repeat off; wait for commands.
    done: bool,
    /// Stereo samples read but not yet accepted by a full ring.
    carry: Vec<f32>,
}
impl Track {
    /// Moves one chunk into the ring. `Ok(false)` means the ring is full.
    fn fill(&mut self, bytes: &mut [u8], stereo: &mut Vec<f32>) -> std::io::Result<bool> {
        if !self.carry.is_empty() {
            let taken = self.producer.push(&self.carry);
            self.carry.drain(..taken);
            return Ok(self.carry.is_empty());
        }
        if self.done || self.producer.free() < bytes.len() / 4 * 2 {
            return Ok(false);
        }
        let frame_bytes = self.channels * 4;
        let want = bytes.len() / frame_bytes * frame_bytes;
        let mut read = 0;
        while read < want {
            let n = self.file.read(&mut bytes[read..want])?;
            if n == 0 {
                break;
            }
            read += n;
        }
        let read = read / frame_bytes * frame_bytes;
        if read == 0 {
            if self.repeat {
                self.file.seek(SeekFrom::Start(0))?;
                return Ok(true);
            }
            self.done = true;
            return Ok(false);
        }
        stereo.clear();
        for frame in bytes[..read].chunks_exact(frame_bytes) {
            let l = f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
            let r = if self.channels == 2 {
                f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]])
            } else {
                l
            };
            stereo.push(l);
            stereo.push(r);
        }
        let taken = self.producer.push(stereo);
        if taken < stereo.len() {
            self.carry.extend_from_slice(&stereo[taken..]);
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const ID: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2T";

    /// A render whose every sample names its frame: frame / 100 000.
    fn render(frames: u64, channels: u16) -> (PathBuf, MediaId) {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "oxidal-backing-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let dir = root.join("assets").join(ID);
        std::fs::create_dir_all(&dir).unwrap();
        let mut bytes = Vec::new();
        for frame in 0..frames {
            for c in 0..channels {
                let v = frame as f32 / 100_000.0 + if c == 1 { 0.5 } else { 0.0 };
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        std::fs::write(dir.join(format!("play-{RATE}.f32")), bytes).unwrap();
        (root, MediaId::parse(ID).unwrap())
    }

    fn play(
        asset: MediaId,
        frames: u64,
        from: u64,
        seq: u32,
        repeat: bool,
        channels: u16,
    ) -> BackingCommand {
        BackingCommand::Play {
            asset,
            channels,
            frames,
            from,
            seq,
            repeat,
            gain_db: 0.0,
        }
    }

    /// Runs blocks until `until` holds, collecting the left channel.
    fn run(backing: &mut Backing, blocks: usize, until: impl Fn(&Backing) -> bool) -> Vec<f32> {
        let mut out = Vec::new();
        for _ in 0..blocks {
            let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
            backing.mix(&mut l, &mut r);
            out.extend_from_slice(&l);
            if until(backing) {
                break;
            }
            std::thread::sleep(Duration::from_micros(200));
        }
        out
    }

    fn frame_of(sample: f32) -> u64 {
        (sample * 100_000.0).round() as u64
    }

    #[test]
    fn plays_a_track_through_to_its_exact_last_frame() {
        let frames = 24_000;
        let (root, asset) = render(frames, 1);
        let mut backing = start(RATE, root.clone());
        backing.command(play(asset, frames, 0, 1, false, 1));
        let out = run(&mut backing, 5000, |b| b.status().ended);
        let status = backing.status();
        assert!(status.ended && !status.playing, "{status:?}");
        assert_eq!(status.frame, frames);
        assert_eq!(status.underruns, 0);
        // After the 10 ms fade-in, every frame follows the previous one.
        let audible: Vec<u64> = out
            .iter()
            .skip_while(|v| **v == 0.0)
            .skip(480)
            .map(|v| frame_of(*v))
            .take_while(|f| *f > 0)
            .collect();
        assert!(audible.len() > 20_000);
        assert!(
            audible.windows(2).all(|w| w[1] == w[0] + 1),
            "no gap or repeat"
        );
        assert_eq!(*audible.last().unwrap(), frames - 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stop_fades_out_and_keeps_the_position() {
        let frames = 96_000;
        let (root, asset) = render(frames, 2);
        let mut backing = start(RATE, root.clone());
        backing.command(play(asset, frames, 0, 1, false, 2));
        run(&mut backing, 5000, |b| b.status().frame > 10_000);
        backing.command(BackingCommand::Stop { seq: 2 });
        let held = backing.status().frame;
        let out = run(&mut backing, 20, |_| false);
        assert!(!backing.status().playing);
        assert_eq!(backing.status().frame, held);
        // The fade lasts 10 ms (480 frames), then silence.
        assert!(out[..480].iter().any(|v| *v != 0.0));
        assert!(out[600..].iter().all(|v| *v == 0.0));
        assert!(
            out[1..480]
                .windows(2)
                .all(|w| w[1].abs() <= w[0].abs() + 1e-3)
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_seek_fades_out_and_resumes_at_the_new_frame() {
        let frames = 192_000;
        let (root, asset) = render(frames, 1);
        let mut backing = start(RATE, root.clone());
        backing.command(play(asset, frames, 0, 1, false, 1));
        run(&mut backing, 5000, |b| b.status().frame > 5_000);
        backing.command(play(asset, frames, 120_000, 2, false, 1));
        assert_eq!(backing.status().frame, 120_000, "reported at once");
        let out = run(&mut backing, 5000, |b| b.status().frame > 130_000);
        // Old position fades out; then silence until 100 ms is buffered; then
        // the new position fades in from the seek frame.
        let first_new = out.iter().position(|v| frame_of(*v) >= 120_000).unwrap();
        let before = &out[..first_new];
        assert!(
            before
                .iter()
                .rev()
                .take(100)
                .all(|v| frame_of(*v) < 120_000 + 480)
        );
        let resumed: Vec<u64> = out[first_new..]
            .iter()
            .skip(480)
            .map(|v| frame_of(*v))
            .collect();
        assert!(resumed.len() > 1000);
        assert!(
            resumed[0] < 120_000 + 960,
            "starts at the seek point: {}",
            resumed[0]
        );
        assert!(resumed.windows(2).all(|w| w[1] == w[0] + 1));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeat_wraps_without_a_gap() {
        let frames = 12_000;
        let (root, asset) = render(frames, 1);
        let mut backing = start(RATE, root.clone());
        backing.command(play(asset, frames, 0, 1, true, 1));
        let mut wrapped = false;
        let out = run(&mut backing, 5000, |b| {
            b.status().frame > 6_000 && b.status().underruns == 0 && b.status().playing
        })
        .into_iter()
        .chain(run(&mut backing, 5000, |b| b.status().frame < 3_000))
        .chain(run(&mut backing, 400, |_| false))
        .collect::<Vec<_>>();
        let audible: Vec<u64> = out
            .iter()
            .skip_while(|v| **v == 0.0)
            .skip(480)
            .map(|v| frame_of(*v))
            .collect();
        for w in audible.windows(2) {
            if w[1] == 0 && w[0] == frames - 1 {
                wrapped = true;
            } else {
                assert_eq!(w[1], w[0] + 1, "seam must be continuous");
            }
        }
        assert!(wrapped, "played across the end");
        assert!(!backing.status().ended && backing.status().underruns == 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_render_is_reported_and_stale_requests_are_ignored() {
        let (root, asset) = render(100, 1);
        let mut backing = start(RATE, root.clone());
        // Wrong frame count: the size check refuses it.
        backing.command(play(asset, 101, 0, 1, false, 1));
        run(&mut backing, 500, |b| b.status().missing);
        assert!(backing.status().missing && !backing.status().playing);
        // Invalid commands change nothing.
        backing.command(play(asset, 100, 100, 2, false, 1));
        backing.command(BackingCommand::Gain { gain_db: f32::NAN });
        assert_eq!(backing.status().seq, 1);
        assert!(MediaId::parse("../etc").is_none());
        assert_eq!(serde_json::to_string(&asset).unwrap(), format!("\"{ID}\""));
        std::fs::remove_dir_all(root).unwrap();
    }
}
