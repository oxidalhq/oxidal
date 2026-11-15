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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LoopRange {
    pub a: u64,
    pub b: u64,
}

impl LoopRange {
    pub fn valid(self, frames: u64) -> bool {
        self.a < self.b && self.b <= frames
    }
    pub fn contains(self, frame: u64) -> bool {
        (self.a..self.b).contains(&frame)
    }
    pub fn wrap(self, frame: u64) -> u64 {
        self.a + frame.saturating_sub(self.a) % (self.b - self.a)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Click {
    Manual {
        bpm_tenths: u16,
        first_frame: u64,
        level_db: f32,
    },
    Detected {
        timing: MediaId,
        level_db: f32,
    },
}

impl Click {
    pub fn valid(self, frames: u64) -> bool {
        match self {
            Self::Manual {
                bpm_tenths,
                first_frame,
                level_db,
            } => {
                (300..=3000).contains(&bpm_tenths)
                    && first_frame < frames
                    && (-60.0..=0.0).contains(&level_db)
            }
            Self::Detected { level_db, .. } => (-60.0..=0.0).contains(&level_db),
        }
    }
}

/// Stem files a song split stores, in this order, as
/// `songs/{source}/splits/{split}/{name}.f32` (stereo f32 at the stream rate).
pub const STEM_NAMES: [&str; 6] = ["vocals", "drums", "bass", "other", "guitar", "piano"];

/// Play a split's stems instead of one render, mixed live with `gains`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StemMix {
    pub source: MediaId,
    pub split: MediaId,
    /// Linear gain per entry of [`STEM_NAMES`]; 0 is silent. Absent stems
    /// must be 0.
    pub gains: [f32; 6],
    /// Bit `i` set when the split has stem `STEM_NAMES[i]`.
    pub present: u8,
}
impl StemMix {
    fn valid(&self) -> bool {
        self.present != 0 && self.present < 1 << STEM_NAMES.len() && valid_stem_gains(&self.gains)
    }
}
fn valid_stem_gains(gains: &[f32; 6]) -> bool {
    gains
        .iter()
        .all(|g| g.is_finite() && (0.0..=4.0).contains(g))
}

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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range: Option<LoopRange>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        click: Option<Click>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<u16>,
        /// Play these stems mixed live instead of the asset's render.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stems: Option<StemMix>,
        gain_db: f32,
    },
    /// New live stem gains for the playing stems, heard after the read-ahead.
    StemGains {
        gains: [f32; 6],
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
                range,
                click,
                speed,
                stems,
                gain_db,
                ..
            } => {
                (1..=2).contains(&channels)
                    && stems.is_none_or(|stems| channels == 2 && stems.valid())
                    && frames > 0
                    && from < frames
                    && valid_gain(gain_db)
                    && range.is_none_or(|range| range.valid(frames) && range.contains(from))
                    && click.is_none_or(|click| click.valid(frames))
                    && speed.is_none_or(|speed| (50..=150).contains(&speed))
            }
            Self::Gain { gain_db } => valid_gain(gain_db),
            Self::StemGains { gains } => valid_stem_gains(&gains),
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
/// Live stem changes are heard after the read-ahead, so stems keep it short.
const STEM_RING_SECONDS: f32 = 0.5;
const STEM_CHUNK_FRAMES: usize = 2048;

enum ReaderCommand {
    Open {
        asset: MediaId,
        channels: u16,
        frames: u64,
        from: u64,
        seq: u32,
        repeat: bool,
        range: Option<LoopRange>,
        click: Option<Click>,
        speed: u16,
        stems: Option<StemMix>,
    },
    Repeat(bool),
    StemGains([f32; 6]),
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
    range: Option<LoopRange>,
    speed: u16,
    fraction: u16,
    want_playing: bool,
    started: bool,
    fade: f32,
    fade_step: f32,
    gain: f32,
    gain_target: f32,
    gain_step: f32,
    status: BackingStatus,
    scratch: [f32; 768],
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
        range: None,
        speed: 100,
        fraction: 0,
        want_playing: false,
        started: false,
        fade: 0.0,
        fade_step: 1.0 / (FADE_SECONDS * rate as f32),
        gain: 0.0,
        gain_target: 0.0,
        gain_step: 1.0 - (-1.0 / (GAIN_GLIDE_SECONDS / 4.0 * rate as f32)).exp(),
        status: BackingStatus::default(),
        scratch: [0.0; 768],
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
                range,
                click,
                speed,
                stems,
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
                    range,
                    click,
                    speed: speed.unwrap_or(100),
                    stems,
                };
                if self.commands.try_send(open).is_err() {
                    return;
                }
                self.wanted = seq;
                self.total = frames;
                self.repeat = repeat;
                self.range = range;
                self.speed = speed.unwrap_or(100);
                self.fraction = 0;
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
            BackingCommand::StemGains { gains } => {
                // A full queue drops this change; the daemon resends on the next edit.
                let _ = self.commands.try_send(ReaderCommand::StemGains(gains));
            }
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
                * 3;
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
            let remaining = if self.repeat || self.range.is_some() || leaving {
                frames
            } else {
                remaining_at_speed(
                    self.status.frame,
                    self.fraction,
                    self.total,
                    self.speed,
                    frames,
                )
            };
            let got = self.current.as_mut().map_or(0, |current| {
                current.pop(&mut self.scratch[..remaining * 3]) / 3
            });
            if got < remaining && !leaving {
                short = true;
            }
            for i in 0..frames {
                let (l, r, click) = if i < got {
                    (
                        self.scratch[3 * i],
                        self.scratch[3 * i + 1],
                        self.scratch[3 * i + 2],
                    )
                } else {
                    (0.0, 0.0, 0.0)
                };
                self.fade = if leaving {
                    (self.fade - self.fade_step).max(0.0)
                } else {
                    (self.fade + self.fade_step).min(1.0)
                };
                self.gain += (self.gain_target - self.gain) * self.gain_step;
                let g = self.fade * self.gain;
                left[i] += l * g + click * self.fade;
                right[i] += r * g + click * self.fade;
            }
            if leaving {
                if self.fade <= 0.0 {
                    self.swap_if_silent();
                    break;
                }
                continue;
            }
            advance(&mut self.status.frame, &mut self.fraction, self.speed, got);
            if let Some(range) = self.range {
                self.status.frame = range.wrap(self.status.frame);
            } else if self.repeat && self.total > 0 {
                self.status.frame %= self.total;
            }
            if !self.repeat && self.range.is_none() && self.status.frame >= self.total {
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
    let capacity = (rate * RING_SECONDS * 3) as usize;
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
                range,
                click,
                speed,
                stems,
            }) => {
                track = None;
                let opened = Input::open(&root, rate, asset, channels, frames, stems).and_then(
                    |mut input| {
                        input.seek(from)?;
                        Ok(input)
                    },
                );
                match opened {
                    Ok(input) => {
                        let (chunk, capacity) = if stems.is_some() {
                            (
                                STEM_CHUNK_FRAMES,
                                ((rate as f32 * STEM_RING_SECONDS) as usize * 3)
                                    .max(STEM_CHUNK_FRAMES * 3 * 4),
                            )
                        } else {
                            (READ_BYTES / (usize::from(channels) * 4), capacity)
                        };
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
                            input,
                            producer,
                            chunk,
                            repeat,
                            range: range.unwrap_or(LoopRange { a: 0, b: frames }),
                            section: range.is_some(),
                            position: from,
                            click: click.and_then(|click| ClickRender::load(&root, rate, click)),
                            speed,
                            fraction: 0,
                            stretch: (speed != 100).then(|| crate::stretch::Stretch::new(rate)),
                            done: false,
                            carry: Vec::new(),
                            frames: Vec::with_capacity(chunk),
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
            Some(ReaderCommand::StemGains(gains)) => {
                if let Some(Track {
                    input: Input::Stems { gains: current, .. },
                    ..
                }) = &mut track
                {
                    *current = gains;
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

enum ClickBeats {
    Manual { first: u64, period: u64 },
    Detected(Vec<u64>),
}

struct ClickRender {
    beats: ClickBeats,
    pulse: Vec<f32>,
}

impl ClickRender {
    fn load(root: &std::path::Path, rate: u32, settings: Click) -> Option<Self> {
        let (beats, level) = match settings {
            Click::Manual {
                bpm_tenths,
                first_frame,
                level_db,
            } => (
                ClickBeats::Manual {
                    first: first_frame,
                    period: ((u64::from(rate) * 600 + u64::from(bpm_tenths / 2))
                        / u64::from(bpm_tenths))
                    .max(1),
                },
                level_db,
            ),
            Click::Detected { timing, level_db } => {
                #[derive(Deserialize)]
                struct Document {
                    rate: u32,
                    beats: Vec<u64>,
                }
                let path = root
                    .join("timing")
                    .join(format!("{}.json", timing.as_str()));
                let file = std::fs::File::open(path).ok()?;
                let record: Document = serde_json::from_reader(file.take(16 << 20)).ok()?;
                if record.rate == 0
                    || record.beats.is_empty()
                    || record.beats.windows(2).any(|pair| pair[0] >= pair[1])
                {
                    return None;
                }
                let source = u128::from(record.rate);
                let positions = record
                    .beats
                    .into_iter()
                    .map(|position| {
                        u64::try_from(
                            (u128::from(position) * u128::from(rate) + source / 2) / source,
                        )
                        .ok()
                    })
                    .collect::<Option<Vec<_>>>()?;
                (ClickBeats::Detected(positions), level_db)
            }
        };
        let peak = gain(level);
        let length = (rate / 35).max(1);
        let pulse = (0..length)
            .map(|i| {
                let phase = i as f32 / rate as f32 * std::f32::consts::TAU * 1400.0;
                phase.sin() * peak * (1.0 - i as f32 / length as f32).powi(2)
            })
            .collect();
        Some(Self { beats, pulse })
    }

    fn sample(&self, frame: u64) -> f32 {
        let delta = match &self.beats {
            ClickBeats::Manual { first, period } => {
                frame.checked_sub(*first).map(|elapsed| elapsed % period)
            }
            ClickBeats::Detected(beats) => {
                let index = beats.partition_point(|&beat| beat <= frame);
                index.checked_sub(1).map(|index| frame - beats[index])
            }
        };
        delta
            .and_then(|value| self.pulse.get(value as usize))
            .copied()
            .unwrap_or(0.0)
    }
}

/// Where a track's audio comes from: one render, or a split's stems mixed
/// with live gains. Both read stereo frames at the stream rate.
enum Input {
    Render {
        file: std::fs::File,
        channels: usize,
    },
    Stems {
        files: Vec<(usize, std::fs::File)>,
        gains: [f32; 6],
    },
}
impl Input {
    fn open(
        root: &std::path::Path,
        rate: u32,
        asset: MediaId,
        channels: u16,
        frames: u64,
        stems: Option<StemMix>,
    ) -> std::io::Result<Self> {
        let sized = |path: PathBuf, expected: u64| {
            let file = std::fs::File::open(path)?;
            if file.metadata()?.len() != expected {
                return Err(std::io::Error::other("render size differs"));
            }
            Ok(file)
        };
        let Some(stems) = stems else {
            let path = root
                .join("assets")
                .join(asset.as_str())
                .join(format!("play-{rate}.f32"));
            return Ok(Self::Render {
                file: sized(path, frames * u64::from(channels) * 4)?,
                channels: usize::from(channels),
            });
        };
        let dir = root
            .join("songs")
            .join(stems.source.as_str())
            .join("splits")
            .join(stems.split.as_str());
        let files = STEM_NAMES
            .iter()
            .enumerate()
            .filter(|&(index, _)| stems.present & (1 << index) != 0)
            .map(|(index, name)| Ok((index, sized(dir.join(format!("{name}.f32")), frames * 8)?)))
            .collect::<std::io::Result<Vec<_>>>()?;
        Ok(Self::Stems {
            files,
            gains: stems.gains,
        })
    }

    fn seek(&mut self, frame: u64) -> std::io::Result<()> {
        match self {
            Self::Render { file, channels } => {
                file.seek(SeekFrom::Start(frame * *channels as u64 * 4))?;
            }
            Self::Stems { files, .. } => {
                for (_, file) in files {
                    file.seek(SeekFrom::Start(frame * 8))?;
                }
            }
        }
        Ok(())
    }

    /// Reads up to `out.len()` frames from the current position and returns
    /// how many were read; 0 at the end of the files.
    fn read(&mut self, out: &mut [[f32; 2]], bytes: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Render { file, channels } => {
                let stride = *channels * 4;
                let want = out.len().min(bytes.len() / stride) * stride;
                let read = fill_from(file, &mut bytes[..want])? / stride;
                for (frame, sample) in out
                    .iter_mut()
                    .zip(bytes[..read * stride].chunks_exact(stride))
                {
                    let left = f32::from_le_bytes(sample[..4].try_into().expect("left sample"));
                    let right = if *channels == 2 {
                        f32::from_le_bytes(sample[4..8].try_into().expect("right sample"))
                    } else {
                        left
                    };
                    *frame = [left, right];
                }
                Ok(read)
            }
            Self::Stems { files, gains } => {
                let frames = out.len().min(bytes.len() / 8);
                out[..frames].fill([0.0; 2]);
                let mut shortest = frames;
                for (index, file) in files.iter_mut() {
                    let read = fill_from(file, &mut bytes[..frames * 8])? / 8;
                    shortest = shortest.min(read);
                    let level = gains[*index];
                    if level == 0.0 {
                        continue;
                    }
                    for (frame, sample) in out.iter_mut().zip(bytes[..read * 8].chunks_exact(8)) {
                        frame[0] +=
                            level * f32::from_le_bytes(sample[..4].try_into().expect("left"));
                        frame[1] +=
                            level * f32::from_le_bytes(sample[4..].try_into().expect("right"));
                    }
                }
                for frame in &mut out[..shortest] {
                    *frame = [frame[0].clamp(-1.0, 1.0), frame[1].clamp(-1.0, 1.0)];
                }
                Ok(shortest)
            }
        }
    }

    fn read_at(
        &mut self,
        from: u64,
        target: &mut [[f32; 2]],
        bytes: &mut [u8],
    ) -> std::io::Result<()> {
        self.seek(from)?;
        let mut done = 0;
        while done < target.len() {
            let read = self.read(&mut target[done..], bytes)?;
            if read == 0 {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            done += read;
        }
        Ok(())
    }
}

/// Reads until `buffer` is full or the file ends; returns the bytes read.
fn fill_from(file: &mut std::fs::File, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut read = 0;
    while read < buffer.len() {
        let n = file.read(&mut buffer[read..])?;
        if n == 0 {
            break;
        }
        read += n;
    }
    Ok(read)
}

struct Track {
    input: Input,
    producer: Producer,
    /// Frames read per chunk.
    chunk: usize,
    repeat: bool,
    range: LoopRange,
    section: bool,
    position: u64,
    click: Option<ClickRender>,
    speed: u16,
    fraction: u16,
    stretch: Option<crate::stretch::Stretch>,
    /// Reached the end with Repeat off; wait for commands.
    done: bool,
    /// Stereo samples read but not yet accepted by a full ring.
    carry: Vec<f32>,
    /// Frames of the current chunk, reused between reads.
    frames: Vec<[f32; 2]>,
}
impl Track {
    /// Moves one chunk into the ring. `Ok(false)` means the ring is full.
    fn fill(&mut self, bytes: &mut [u8], stereo: &mut Vec<f32>) -> std::io::Result<bool> {
        if !self.carry.is_empty() {
            let taken = self.producer.push(&self.carry);
            self.carry.drain(..taken);
            return Ok(self.carry.is_empty());
        }
        if self.done || self.producer.free() < self.chunk * 3 {
            return Ok(false);
        }
        if self.stretch.is_some() {
            return self.stretched(bytes, stereo);
        }
        let frames = (self.range.b - self.position).min(self.chunk as u64) as usize;
        self.frames.resize(frames, [0.0; 2]);
        let read = if frames == 0 {
            0
        } else {
            self.input.read(&mut self.frames, bytes)?
        };
        if read == 0 {
            if (self.repeat || self.section) && self.position == self.range.b {
                self.position = self.range.a;
                self.input.seek(self.position)?;
                return Ok(true);
            }
            self.done = true;
            return Ok(false);
        }
        stereo.clear();
        for &[l, r] in &self.frames[..read] {
            stereo.push(l);
            stereo.push(r);
            stereo.push(
                self.click
                    .as_ref()
                    .map_or(0.0, |click| click.sample(self.position)),
            );
            self.position += 1;
        }
        let taken = self.producer.push(stereo);
        if taken < stereo.len() {
            self.carry.extend_from_slice(&stereo[taken..]);
        }
        Ok(true)
    }

    fn stretched(&mut self, bytes: &mut [u8], output: &mut Vec<f32>) -> std::io::Result<bool> {
        let stretch = self.stretch.as_mut().expect("stretched track");
        if self.position >= self.range.b {
            if !self.repeat && !self.section {
                self.done = true;
                return Ok(false);
            }
            self.position = self.range.wrap(self.position);
            stretch.reset();
        }
        let count = remaining_at_speed(
            self.position,
            self.fraction,
            self.range.b,
            self.speed,
            stretch.hop(),
        );
        let source = &mut self.input;
        let rendered = stretch.grain(
            self.position,
            self.range.a,
            self.range.b,
            count,
            |from, input| source.read_at(from, input, bytes),
        )?;
        output.clear();
        let mut frame = self.position;
        let mut fraction = self.fraction;
        for &[l, r] in rendered {
            output.extend_from_slice(&[
                l,
                r,
                self.click.as_ref().map_or(0.0, |click| click.sample(frame)),
            ]);
            advance(&mut frame, &mut fraction, self.speed, 1);
        }
        self.position = frame;
        self.fraction = fraction;
        let taken = self.producer.push(output);
        self.carry.extend_from_slice(&output[taken..]);
        Ok(true)
    }
}

fn advance(frame: &mut u64, fraction: &mut u16, speed: u16, output: usize) {
    let ticks = output as u64 * u64::from(speed) + u64::from(*fraction);
    *frame = frame.saturating_add(ticks / 100);
    *fraction = (ticks % 100) as u16;
}

fn remaining_at_speed(frame: u64, fraction: u16, end: u64, speed: u16, max: usize) -> usize {
    let ticks = (u128::from(end.saturating_sub(frame)) * 100).saturating_sub(u128::from(fraction));
    ticks.div_ceil(u128::from(speed)).min(max as u128) as usize
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
            range: None,
            click: None,
            speed: None,
            stems: None,
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
    fn stems_mix_live_and_a_mute_is_heard_within_the_short_read_ahead() {
        const SOURCE: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2V";
        const SPLIT: &str = "01JD2W8T3N8M4K6V0P7Q9R1S2W";
        let (root, asset) = render(8, 2);
        let frames = u64::from(RATE) * 4;
        let dir = root.join("songs").join(SOURCE).join("splits").join(SPLIT);
        std::fs::create_dir_all(&dir).unwrap();
        // Vocals at 0.25 and drums at 0.125 on both channels.
        for (name, level) in [("vocals", 0.25f32), ("drums", 0.125)] {
            let bytes: Vec<u8> = (0..frames * 2).flat_map(|_| level.to_le_bytes()).collect();
            std::fs::write(dir.join(format!("{name}.f32")), bytes).unwrap();
        }
        let mut backing = start(RATE, root.clone());
        backing.command(BackingCommand::Play {
            asset,
            channels: 2,
            frames,
            from: 0,
            seq: 1,
            repeat: false,
            range: None,
            click: None,
            speed: None,
            stems: Some(StemMix {
                source: MediaId::parse(SOURCE).unwrap(),
                split: MediaId::parse(SPLIT).unwrap(),
                gains: [1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
                present: 0b11,
            }),
            gain_db: 0.0,
        });
        let both = run(&mut backing, 4000, |b| {
            b.status().frame > u64::from(RATE / 4)
        });
        assert!(
            (both.last().unwrap() - 0.375).abs() < 1e-4,
            "{}",
            both.last().unwrap()
        );

        // Mute vocals: within the stem read-ahead only the drums remain.
        backing.command(BackingCommand::StemGains {
            gains: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0],
        });
        let start_frame = backing.status().frame;
        let after = run(&mut backing, 8000, |b| {
            b.status().frame > start_frame + u64::from(RATE)
        });
        assert!(
            (after.last().unwrap() - 0.125).abs() < 1e-4,
            "{}",
            after.last().unwrap()
        );
        let heard_at = after
            .iter()
            .position(|&sample| (sample - 0.125).abs() < 1e-4)
            .unwrap();
        assert!(
            (heard_at as f32) < RATE as f32 * (STEM_RING_SECONDS + 0.1),
            "mute heard after {heard_at} frames"
        );
        assert_eq!(backing.status().underruns, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_split_with_a_missing_stem_file_is_reported_missing() {
        let (root, asset) = render(8, 2);
        let mut backing = start(RATE, root.clone());
        backing.command(BackingCommand::Play {
            asset,
            channels: 2,
            frames: 4800,
            from: 0,
            seq: 3,
            repeat: false,
            range: None,
            click: None,
            speed: None,
            stems: Some(StemMix {
                source: asset,
                split: asset,
                gains: [1.0; 6],
                present: 0b1,
            }),
            gain_db: 0.0,
        });
        run(&mut backing, 2000, |b| b.status().missing);
        assert!(backing.status().missing);
        std::fs::remove_dir_all(root).unwrap();
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
    fn practice_section_wraps_at_b_and_never_reads_outside_the_range() {
        let frames = 24_000;
        let range = LoopRange { a: 3000, b: 9000 };
        let (root, asset) = render(frames, 1);
        let mut backing = start(RATE, root.clone());
        backing.command(BackingCommand::Play {
            asset,
            channels: 1,
            frames,
            from: range.a,
            seq: 1,
            repeat: false,
            range: Some(range),
            click: None,
            speed: None,
            stems: None,
            gain_db: 0.0,
        });
        let output = run(&mut backing, 300, |_| false);
        let audible: Vec<u64> = output
            .iter()
            .skip_while(|sample| **sample == 0.0)
            .skip(480)
            .map(|value| frame_of(*value))
            .collect();
        assert!(audible.len() > 12_000);
        assert!(audible.iter().all(|&frame| range.contains(frame)));
        assert!(
            audible
                .windows(2)
                .all(|pair| pair[1] == range.wrap(pair[0] + 1))
        );
        assert!(backing.status().playing && !backing.status().ended);
        assert_eq!(backing.status().underruns, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn practice_speed_changes_duration_while_retaining_tone_pitch() {
        let frames = u64::from(RATE);
        for speed in [50, 75, 125, 150] {
            let (root, asset) = render(frames, 1);
            let pcm = (0..frames)
                .flat_map(|frame| {
                    let phase = frame as f32 / RATE as f32 * std::f32::consts::TAU * 440.0;
                    (0.25 * phase.sin()).to_le_bytes()
                })
                .collect::<Vec<_>>();
            std::fs::write(
                root.join("assets")
                    .join(ID)
                    .join(format!("play-{RATE}.f32")),
                pcm,
            )
            .unwrap();
            let mut backing = start(RATE, root.clone());
            backing.command(BackingCommand::Play {
                asset,
                channels: 1,
                frames,
                from: 0,
                seq: 1,
                repeat: false,
                range: None,
                click: None,
                speed: Some(speed),
                stems: None,
                gain_db: 0.0,
            });
            // This is a reader/consumer timing check. Pace the synthetic
            // consumer at the actual 128-frame deadline.
            let mut output = Vec::new();
            for _ in 0..2000 {
                let (mut left, mut right) = ([0.0; 128], [0.0; 128]);
                backing.mix(&mut left, &mut right);
                output.extend_from_slice(&left);
                if backing.status().ended {
                    break;
                }
                std::thread::sleep(Duration::from_secs_f64(128.0 / f64::from(RATE)));
            }
            assert!(backing.status().ended, "speed {speed}");
            assert_eq!(backing.status().underruns, 0, "speed {speed}");
            let start = output
                .iter()
                .position(|sample| sample.abs() > 1e-7)
                .unwrap();
            let expected = (frames * 100).div_ceil(u64::from(speed)) as usize;
            assert!(output.len() - start <= expected + 128);
            assert!(output.len() - start >= expected - 2);
            let region = &output[start + 8000..start + 16_000];
            let crossings = region
                .windows(2)
                .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
                .count();
            let measured = crossings as f64 * RATE as f64 / region.len() as f64;
            assert!(
                (measured - 440.0).abs() < 22.0,
                "speed {speed}: {measured} Hz"
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn manual_click_has_its_own_level_and_follows_the_loop() {
        let frames = 48_000;
        let range = LoopRange { a: 4000, b: 16_000 };
        let (root, asset) = render(frames, 1);
        std::fs::write(
            root.join("assets")
                .join(ID)
                .join(format!("play-{RATE}.f32")),
            vec![0u8; frames as usize * 4],
        )
        .unwrap();
        let mut backing = start(RATE, root.clone());
        backing.command(BackingCommand::Play {
            asset,
            channels: 1,
            frames,
            from: range.a,
            seq: 1,
            repeat: false,
            range: Some(range),
            click: Some(Click::Manual {
                bpm_tenths: 2400,
                first_frame: 8000,
                level_db: -12.0,
            }),
            speed: None,
            stems: None,
            gain_db: -90.0,
        });
        let output = run(&mut backing, 500, |_| false);
        let first = output
            .iter()
            .position(|sample| sample.abs() > 0.01)
            .unwrap();
        assert!(
            output[first + 12_000..first + 12_100]
                .iter()
                .any(|sample| sample.abs() > 0.01)
        );
        assert!(
            output[first + 2000..first + 11_900]
                .iter()
                .all(|sample| *sample == 0.0)
        );
        assert_eq!(backing.status().underruns, 0);
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
