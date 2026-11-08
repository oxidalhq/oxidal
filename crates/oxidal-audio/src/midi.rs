//! MIDI byte decoding and hardware-only ALSA input. No audio-thread I/O.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Message {
    Program {
        channel: u8,
        program: u8,
    },
    Control {
        channel: u8,
        controller: u8,
        value: u8,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[schemars(rename = "Target")]
pub enum ControlTarget {
    Native { node: String, parameter: String },
    Lv2 { node: String, symbol: String },
    Bypass { node: String },
    Merge { node: String, port: usize },
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ControlMode {
    #[default]
    Absolute,
    Toggle,
    RelativeTwosComplement,
    RelativeOffset64,
}
/// Confirmed scalar descriptor shared by mixed and standalone native owners.
/// Values remain in each control's actual units; native values are normalized.
#[derive(Debug)]
pub struct MappedControl {
    pub value: f64,
    pub minimum: f64,
    pub maximum: f64,
    pub integer: bool,
    pub toggle: bool,
    pub logarithmic: bool,
}
impl MappedControl {
    pub fn midi_value(&self, mode: ControlMode, raw: u8) -> Result<Option<f64>, String> {
        use ControlMode as M;
        if raw > 127
            || !self.accepts(self.value)
            || !self.minimum.is_finite()
            || !self.maximum.is_finite()
            || self.minimum >= self.maximum
        {
            return Err("Invalid mapped control range".into());
        }
        if mode == M::Toggle {
            return if !self.toggle {
                Err("Toggle MIDI needs a switch control".into())
            } else if raw < 64 {
                Ok(None)
            } else {
                Ok(Some(if self.value == self.minimum {
                    self.maximum
                } else {
                    self.minimum
                }))
            };
        }
        if self.toggle {
            return if mode != M::Absolute {
                Err("Relative MIDI cannot control a switch".into())
            } else {
                Ok(Some(if raw >= 64 {
                    self.maximum
                } else {
                    self.minimum
                }))
            };
        }
        let logarithmic = self.logarithmic && self.minimum > 0.0;
        let normalize = |value: f64| {
            if logarithmic {
                (value / self.minimum).ln() / (self.maximum / self.minimum).ln()
            } else {
                (value - self.minimum) / (self.maximum - self.minimum)
            }
        };
        let normalized = match mode {
            M::Absolute => f64::from(raw) / 127.0,
            M::RelativeTwosComplement => {
                let delta = if raw < 64 {
                    i16::from(raw)
                } else {
                    i16::from(raw) - 128
                };
                if delta == 0 {
                    return Ok(None);
                }
                normalize(self.value) + f64::from(delta) / 127.0
            }
            M::RelativeOffset64 => {
                let delta = i16::from(raw) - 64;
                if delta == 0 {
                    return Ok(None);
                }
                normalize(self.value) + f64::from(delta) / 127.0
            }
            M::Toggle => unreachable!(),
        }
        .clamp(0.0, 1.0);
        let value = if logarithmic {
            self.minimum * (self.maximum / self.minimum).powf(normalized)
        } else {
            self.minimum + (self.maximum - self.minimum) * normalized
        };
        let value = if self.integer { value.round() } else { value };
        let value = value.clamp(self.minimum, self.maximum);
        if !self.accepts(value) {
            return Err("Mapped MIDI value is invalid".into());
        }
        Ok(Some(value))
    }
    pub fn accepts(&self, v: f64) -> bool {
        v.is_finite()
            && (self.minimum..=self.maximum).contains(&v)
            && (!self.integer || v.fract() == 0.0)
            && (!self.toggle || v == self.minimum || v == self.maximum)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ParameterBinding {
    pub target: ControlTarget,
    pub controller: u8,
    #[serde(default)]
    pub mode: ControlMode,
}
impl ControlTarget {
    pub fn valid(&self) -> bool {
        let node = match self {
            Self::Native { node, .. }
            | Self::Lv2 { node, .. }
            | Self::Bypass { node }
            | Self::Merge { node, .. } => node,
        };
        if node.is_empty()
            || node.len() > 64
            || !node.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
            || !node
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return false;
        }
        match self {
            Self::Native { parameter, .. } => {
                !parameter.is_empty()
                    && parameter.len() <= 256
                    && !parameter.chars().any(char::is_control)
            }
            Self::Lv2 { symbol, .. } => {
                !symbol.is_empty()
                    && symbol.len() <= 128
                    && symbol
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            }
            Self::Merge { port, .. } => *port < 64,
            Self::Bypass { .. } => true,
        }
    }
}
/// Device-local configuration, deliberately absent from portable sound data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub input: String,
    /// 0 accepts all MIDI channels; otherwise 1–16.
    pub channel: u8,
    pub bindings: Vec<Binding>,
    #[serde(default)]
    pub branch_bindings: Vec<BranchBinding>,
    #[serde(default)]
    pub parameter_bindings: Vec<ParameterBinding>,
    /// Further controllers listened to at once, each enabled explicitly. Their
    /// messages share these mappings but keep their own channel and bank state.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_inputs: Vec<ExtraInput>,
}
/// One more controller: its own endpoint and channel filter (0 accepts all).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExtraInput {
    pub input: String,
    pub channel: u8,
}
/// Most controllers heard at once, the first plus extras.
pub const MAX_INPUTS: usize = 4;
fn alsa_endpoint_valid(input: &str) -> bool {
    let parts: Vec<_> = input.strip_prefix("hw:").unwrap_or("").split(',').collect();
    parts.len() == 3
        && !parts[0].is_empty()
        && input.len() <= 128
        && parts[0]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && parts[1..].iter().all(|p| p.parse::<u16>().is_ok())
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub scene: String,
    /// Exactly one trigger is required. Programs are wire values 0–127.
    pub program: Option<u8>,
    pub controller: Option<u8>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BranchMode {
    Toggle,
    Gate,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BranchBinding {
    pub branch: String,
    pub controller: u8,
    pub mode: BranchMode,
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !alsa_endpoint_valid(&self.input)
            || self.channel > 16
            || self.extra_inputs.len() >= MAX_INPUTS
            || self.extra_inputs.iter().enumerate().any(|(i, extra)| {
                !alsa_endpoint_valid(&extra.input)
                    || extra.channel > 16
                    || extra.input == self.input
                    || self.extra_inputs[..i]
                        .iter()
                        .any(|old| old.input == extra.input)
            })
            || self.bindings.len() > 256
            || self.branch_bindings.len() > 128
            || self.parameter_bindings.len() > 128
        {
            return Err("Invalid MIDI input configuration".into());
        }
        for (index, binding) in self.bindings.iter().enumerate() {
            if binding.scene.is_empty()
                || binding.scene.len() > 64
                || binding.program.is_some() == binding.controller.is_some()
                || binding.program.is_some_and(|v| v > 127)
                || binding
                    .controller
                    .is_some_and(|v| v > 127 || matches!(v, 0 | 32))
                || self.bindings[..index].iter().any(|old| {
                    old.program == binding.program && old.controller == binding.controller
                })
            {
                return Err("Invalid or duplicate MIDI scene binding".into());
            }
        }
        for (index, binding) in self.branch_bindings.iter().enumerate() {
            if binding.branch.is_empty()
                || binding.branch.len() > 64
                || binding.controller > 127
                || matches!(binding.controller, 0 | 32)
                || self
                    .bindings
                    .iter()
                    .any(|scene| scene.controller == Some(binding.controller))
                || self.branch_bindings[..index]
                    .iter()
                    .any(|old| old.controller == binding.controller)
            {
                return Err("Invalid or colliding MIDI branch binding".into());
            }
        }
        for (index, binding) in self.parameter_bindings.iter().enumerate() {
            if !binding.target.valid()
                || binding.controller > 127
                || matches!(binding.controller, 0 | 32)
                || self
                    .bindings
                    .iter()
                    .any(|b| b.controller == Some(binding.controller))
                || self
                    .branch_bindings
                    .iter()
                    .any(|b| b.controller == binding.controller)
                || self.parameter_bindings[..index]
                    .iter()
                    .any(|b| b.controller == binding.controller)
            {
                return Err("Invalid or colliding MIDI parameter binding".into());
            }
        }
        Ok(())
    }
    /// How this controller sees the mappings: source 0 is the first input, the
    /// rest are `extra_inputs`. Only the channel filter differs, so each source
    /// is judged on its own channel while sharing the preset's assignments.
    pub fn for_source(&self, source: u8) -> std::borrow::Cow<'_, Settings> {
        let channel = match usize::from(source).checked_sub(1) {
            None => self.channel,
            Some(index) => self
                .extra_inputs
                .get(index)
                .map_or(self.channel, |e| e.channel),
        };
        if channel == self.channel {
            std::borrow::Cow::Borrowed(self)
        } else {
            std::borrow::Cow::Owned(Settings {
                channel,
                ..self.clone()
            })
        }
    }
    /// None means toggle the confirmed branch target; Some is an absolute gate.
    pub fn branch(&self, message: Message) -> Option<(&BranchBinding, Option<bool>)> {
        let Message::Control {
            channel,
            controller,
            value,
        } = message
        else {
            return None;
        };
        if !(1..=16).contains(&channel)
            || value > 127
            || (self.channel != 0 && self.channel != channel)
        {
            return None;
        }
        let binding = self
            .branch_bindings
            .iter()
            .find(|b| b.controller == controller)?;
        match binding.mode {
            BranchMode::Toggle if value >= 64 => Some((binding, None)),
            BranchMode::Gate => Some((binding, Some(value >= 64))),
            _ => None,
        }
    }
    pub fn parameter(&self, message: Message) -> Option<(&ParameterBinding, u8)> {
        let Message::Control {
            channel,
            controller,
            value,
        } = message
        else {
            return None;
        };
        if !(1..=16).contains(&channel)
            || controller > 127
            || value > 127
            || (self.channel != 0 && self.channel != channel)
        {
            return None;
        }
        self.parameter_bindings
            .iter()
            .find(|b| b.controller == controller)
            .map(|b| (b, value))
    }
    pub fn scene(&self, message: Message) -> Option<&str> {
        let (channel, program, controller) = match message {
            Message::Program { channel, program }
                if (1..=16).contains(&channel) && program <= 127 =>
            {
                (channel, Some(program), None)
            }
            Message::Control {
                channel,
                controller,
                value,
            } if (1..=16).contains(&channel)
                && controller <= 127
                && (64..=127).contains(&value) =>
            {
                (channel, None, Some(controller))
            }
            _ => return None,
        };
        if self.channel != 0 && self.channel != channel {
            return None;
        }
        self.bindings
            .iter()
            .find(|b| b.program == program && b.controller == controller)
            .map(|b| b.scene.as_str())
    }
}
/// Newest messages retained for ordered observation and passive learning.
pub const RECENT_LIMIT: usize = 32;
/// A learn window ends by itself so a vanished browser cannot leave footswitch
/// control disabled.
pub const LEARN_WINDOW: std::time::Duration = std::time::Duration::from_secs(30);

/// One received PC/CC message with its position in the input's event count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Observed {
    /// Equals `Status::events` after this message; consecutive messages differ by one.
    pub seq: u64,
    pub message: Message,
    /// Which controller sent it: 0 is the first input, then the extras in order.
    #[serde(default)]
    pub source: u8,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Status {
    pub connected: bool,
    pub events: u64,
    pub last: Option<Message>,
    pub error: Option<String>,
    /// True while passive learning suppresses action dispatch.
    #[serde(default)]
    pub learning: bool,
    /// Oldest first, at most [`RECENT_LIMIT`]. A gap after the last `seq` a
    /// consumer processed means older events were overwritten; a lower `events`
    /// count means the worker restarted.
    #[serde(default)]
    pub recent: Vec<Observed>,
    /// One entry per extra controller, in the order of `Settings::extra_inputs`.
    #[serde(default)]
    pub sources: Vec<SourceStatus>,
}
/// Connection state of one extra controller.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceStatus {
    pub connected: bool,
    pub error: Option<String>,
}
impl Status {
    /// Messages recorded after `previous` (the event count the consumer last
    /// processed), oldest first, so a burst between polls is not collapsed to
    /// its last message. A lower count means the worker restarted, so every
    /// retained message is new. Nothing is returned while learning.
    pub fn unseen(&self, previous: u64) -> Vec<Observed> {
        if self.learning {
            return Vec::new();
        }
        let from = if self.events < previous { 0 } else { previous };
        self.recent
            .iter()
            .filter(|item| item.seq > from)
            .copied()
            .collect()
    }
    /// Record a received message in arrival order.
    pub fn observe(&mut self, source: u8, message: Message) {
        self.events = self.events.saturating_add(1);
        self.last = Some(message);
        if self.recent.len() >= RECENT_LIMIT {
            self.recent.remove(0);
        }
        self.recent.push(Observed {
            seq: self.events,
            message,
            source,
        });
    }
}

/// Record every message, then dispatch it unless passive learning is active.
/// Learning never reaches `receive`, so learning a switch cannot sound its
/// existing assignment.
/// @see docs/architecture.md
pub fn deliver(
    status: &mut Status,
    settings: &Settings,
    source: u8,
    message: Message,
    protected: bool,
    receive: impl FnMut(&Settings, Message) -> Result<bool, String>,
) {
    status.observe(source, message);
    if status.learning {
        return;
    }
    let view = settings.for_source(source);
    match dispatch_protected(&view, message, protected, receive) {
        Ok(true) => status.error = None,
        Ok(false) => {}
        Err(error) => status.error = Some(error),
    }
}

/// Deadline for an active learn window; returns whether learning is still on.
pub fn learning_active(until: &mut Option<std::time::Instant>, now: std::time::Instant) -> bool {
    match *until {
        Some(deadline) if now < deadline => true,
        _ => {
            *until = None;
            false
        }
    }
}
/// Unmapped wire events for passive learning and future transport consumers.
/// These are not serialized commands: observing a note or clock never dispatches
/// an action through the existing PC/CC control path.
/// @see docs/architecture.md
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputEvent {
    Message(Message),
    NoteOn { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8, velocity: u8 },
    Realtime(Realtime),
}

/// Defined MIDI real-time bytes. Undefined bytes are ignored without disturbing
/// an incomplete channel message. Reset is surfaced for consumer-owned cleanup.
/// @see docs/architecture.md
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Realtime {
    Clock,
    Start,
    Continue,
    Stop,
    ActiveSensing,
    Reset,
}

/// Keeps running status across read boundaries and real-time messages. SysEx and
/// system-common cancel it; unsupported channel messages are consumed correctly.
#[derive(Debug, Default)]
pub struct Decoder {
    status: u8,
    first: Option<u8>,
}
impl Decoder {
    /// Compatibility path for existing scene/branch/parameter mappings.
    /// @see docs/architecture.md
    pub fn push(&mut self, byte: u8) -> Option<Message> {
        match self.push_event(byte) {
            Some(InputEvent::Message(message)) => Some(message),
            _ => None,
        }
    }

    /// Decode one byte without allocating, preserving notes and real-time events
    /// separately from mapped PC/CC messages. Zero-velocity Note On is a release.
    /// @see docs/architecture.md
    pub fn push_event(&mut self, byte: u8) -> Option<InputEvent> {
        if byte >= 0xf8 {
            let realtime = match byte {
                0xf8 => Realtime::Clock,
                0xfa => Realtime::Start,
                0xfb => Realtime::Continue,
                0xfc => Realtime::Stop,
                0xfe => Realtime::ActiveSensing,
                0xff => Realtime::Reset,
                _ => return None,
            };
            return Some(InputEvent::Realtime(realtime));
        }
        if byte >= 0x80 {
            self.status = if byte < 0xf0 { byte } else { 0 };
            self.first = None;
            return None;
        }
        let channel = (self.status & 15) + 1;
        match self.status & 0xf0 {
            0xc0 => Some(InputEvent::Message(Message::Program {
                channel,
                program: byte,
            })),
            0xd0 | 0 => None,
            kind => {
                let Some(first) = self.first.take() else {
                    self.first = Some(byte);
                    return None;
                };
                match kind {
                    0x90 if byte != 0 => Some(InputEvent::NoteOn {
                        channel,
                        note: first,
                        velocity: byte,
                    }),
                    0x80 | 0x90 => Some(InputEvent::NoteOff {
                        channel,
                        note: first,
                        velocity: byte,
                    }),
                    0xb0 => Some(InputEvent::Message(Message::Control {
                        channel,
                        controller: first,
                        value: byte,
                    })),
                    _ => None,
                }
            }
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Devices {
    pub available: bool,
    pub inputs: Vec<Endpoint>,
    pub warnings: Vec<String>,
}
// Some input-only devices are omitted by the pinned rawmidi iterator, which
// queries both stream directions. Admit only discovered hardware hints for the
// current stable card ID as a fallback; never open arbitrary ALSA expressions.
#[cfg(any(test, all(target_os = "linux", feature = "alsa")))]
fn hardware_hint(card: &str, hint: &str) -> Option<String> {
    let prefix = format!("hw:CARD={card},DEV=");
    let value = hint.strip_prefix(&prefix)?;
    let mut parts = value.split(",SUBDEV=");
    let device = parts.next()?.parse::<u16>().ok()?;
    let sub = parts.next().unwrap_or("0").parse::<u16>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(format!("hw:{card},{device},{sub}"))
}
#[cfg(all(target_os = "linux", feature = "alsa"))]
pub fn devices() -> Result<Devices, String> {
    use alsa::{Ctl, Direction, card, rawmidi};
    let mut result = Devices {
        available: true,
        inputs: vec![],
        warnings: vec![],
    };
    for card in card::Iter::new().take(64) {
        let card = card.map_err(|e| e.to_string())?;
        let ctl = match Ctl::from_card(&card, true) {
            Ok(ctl) => ctl,
            Err(error) => {
                result.warnings.push(error.to_string());
                continue;
            }
        };
        let info = ctl.card_info().map_err(|e| e.to_string())?;
        let id = info.get_id().map_err(|e| e.to_string())?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            continue;
        }
        for input in rawmidi::Iter::new(&ctl).take(1024) {
            match input {
                Ok(input) if input.get_stream() == Direction::Capture => {
                    result.inputs.push(Endpoint {
                        id: format!("hw:{id},{},{}", input.get_device(), input.get_subdevice()),
                        name: format!(
                            "{} · {}",
                            info.get_name().unwrap_or(id),
                            input.get_subdevice_name().unwrap_or_default()
                        ),
                    })
                }
                Ok(_) => {}
                Err(error) => {
                    result.warnings.push(error.to_string());
                    break;
                }
            }
        }
        match alsa::device_name::HintIter::new_str(Some(&card), "rawmidi") {
            Ok(hints) => {
                for hint in hints.take(1024) {
                    if hint.direction == Some(Direction::Playback) {
                        continue;
                    }
                    let Some(endpoint) = hint
                        .name
                        .as_deref()
                        .and_then(|hint| hardware_hint(id, hint))
                    else {
                        continue;
                    };
                    if result.inputs.iter().any(|input| input.id == endpoint) {
                        continue;
                    }
                    result.inputs.push(Endpoint {
                        id: endpoint,
                        name: hint
                            .desc
                            .unwrap_or_else(|| info.get_name().unwrap_or(id).to_owned())
                            .replace('\n', " · "),
                    });
                }
            }
            Err(error) => result.warnings.push(error.to_string()),
        }
    }
    Ok(result)
}
#[cfg(not(all(target_os = "linux", feature = "alsa")))]
pub fn devices() -> Result<Devices, String> {
    Ok(Devices {
        available: false,
        inputs: vec![],
        warnings: vec![],
    })
}
#[cfg(all(target_os = "linux", feature = "alsa"))]
#[derive(Debug)]
pub struct Input {
    port: alsa::rawmidi::Rawmidi,
    decoder: Decoder,
}
#[cfg(all(target_os = "linux", feature = "alsa"))]
impl Input {
    pub fn open(endpoint: &str) -> Result<Self, String> {
        if !devices()?.inputs.iter().any(|input| input.id == endpoint) {
            return Err("MIDI input is unavailable; refresh devices".into());
        }
        let port = alsa::rawmidi::Rawmidi::new(endpoint, alsa::Direction::Capture, true)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            port,
            decoder: Decoder::default(),
        })
    }
    /// One bounded, non-blocking read, called outside PCM. The caller owns error
    /// reporting and reconnection; losing MIDI must never stop the audio stream.
    pub fn read(&mut self, mut receive: impl FnMut(Message)) -> Result<usize, String> {
        self.read_events(|event| {
            if let InputEvent::Message(message) = event {
                receive(message);
            }
        })
    }

    /// One bounded read for passive observation or explicit event consumers.
    /// Callers supply timestamping, mapping and scheduling outside the decoder;
    /// no event here directly changes audio or claims controller capabilities.
    /// @see docs/architecture.md
    pub fn read_events(&mut self, mut receive: impl FnMut(InputEvent)) -> Result<usize, String> {
        let mut bytes = [0; 64];
        let count = match self.port.read(&mut bytes) {
            Ok(count) => count,
            Err(error) if error.errno() == 11 => return Ok(0), // EAGAIN on Linux
            Err(error) => return Err(error.to_string()),
        };
        for byte in &bytes[..count] {
            if let Some(event) = self.decoder.push_event(*byte) {
                receive(event);
            }
        }
        Ok(count)
    }
}
/// Apply the device Protect policy before either hardware or test dispatch.
/// Scene/branch mappings take precedence over parameter mappings, as in the engine.
/// @see docs/interface.md
pub fn dispatch_protected(
    settings: &Settings,
    message: Message,
    protected: bool,
    mut receive: impl FnMut(&Settings, Message) -> Result<bool, String>,
) -> Result<bool, String> {
    if protected
        && settings.scene(message).is_none()
        && settings.branch(message).is_none()
        && settings
            .parameter(message)
            .is_some_and(|(binding, _)| !matches!(binding.target, ControlTarget::Bypass { .. }))
    {
        return Err("Protect is on. Turn Protect off to change this parameter.".into());
    }
    receive(settings, message)
}

/// Device reads and retry state shared by workers; never called inside PCM.
/// Each configured controller has its own port, decoder and retry timer, so one
/// unplugged device never stalls or corrupts another.
#[cfg(all(target_os = "linux", feature = "alsa"))]
#[derive(Debug)]
pub struct Connection {
    protected: bool,
    settings: Option<Settings>,
    pub status: Status,
    ports: Vec<Option<Input>>,
    retry: Vec<std::time::Instant>,
    learn_until: Option<std::time::Instant>,
}
/// Record one controller's connection outcome. Source 0 keeps the long-standing
/// `connected`/`error` fields; the rest report in `sources`.
#[cfg(all(target_os = "linux", feature = "alsa"))]
fn set_source_state(status: &mut Status, source: usize, connected: bool, error: Option<String>) {
    if source == 0 {
        status.connected = connected;
        status.error = error;
    } else if let Some(entry) = status.sources.get_mut(source - 1) {
        entry.connected = connected;
        entry.error = error;
    }
}
#[cfg(all(target_os = "linux", feature = "alsa"))]
impl Connection {
    pub fn new(settings: Option<Settings>) -> Self {
        Self {
            protected: std::env::var("OXIDAL_PROTECT").is_ok_and(|value| value == "1"),
            settings,
            status: Status::default(),
            ports: Vec::new(),
            retry: Vec::new(),
            learn_until: None,
        }
    }
    /// Start or cancel a passive learn window. Configuration changes cancel it.
    pub fn learn(&mut self, on: bool) {
        self.learn_until = on.then(|| std::time::Instant::now() + LEARN_WINDOW);
        self.status.learning = on;
    }
    pub fn configure(&mut self, settings: Option<Settings>) {
        let protected = self.protected;
        *self = Self::new(settings);
        self.protected = protected;
    }
    pub fn protect(&mut self, on: bool) {
        self.protected = on;
    }
    pub fn test(
        &self,
        message: Message,
        mut receive: impl FnMut(&Settings, Message) -> Result<bool, String>,
    ) -> Result<bool, String> {
        dispatch_protected(
            self.settings
                .as_ref()
                .ok_or("MIDI is not configured for the playing preset")?,
            message,
            self.protected,
            &mut receive,
        )
    }
    pub fn poll(&mut self, mut receive: impl FnMut(&Settings, Message) -> Result<bool, String>) {
        let Some(settings) = &self.settings else {
            return;
        };
        let now = std::time::Instant::now();
        self.status.learning = learning_active(&mut self.learn_until, now);
        let count = 1 + settings.extra_inputs.len();
        self.ports.resize_with(count, || None);
        self.retry
            .resize(count, now - std::time::Duration::from_secs(2));
        self.status
            .sources
            .resize(count - 1, SourceStatus::default());
        for source in 0..count {
            let endpoint = if source == 0 {
                &settings.input
            } else {
                &settings.extra_inputs[source - 1].input
            };
            if self.ports[source].is_none()
                && self.retry[source].elapsed() >= std::time::Duration::from_secs(2)
            {
                self.retry[source] = std::time::Instant::now();
                match Input::open(endpoint) {
                    Ok(port) => {
                        self.ports[source] = Some(port);
                        set_source_state(&mut self.status, source, true, None);
                    }
                    Err(error) => set_source_state(&mut self.status, source, false, Some(error)),
                }
            }
            let Some(port) = &mut self.ports[source] else {
                continue;
            };
            let mut messages = [None; 64];
            let mut read = 0;
            match port.read(|message| {
                messages[read] = Some(message);
                read += 1;
            }) {
                Ok(_) => {
                    for message in messages.into_iter().flatten() {
                        deliver(
                            &mut self.status,
                            settings,
                            source as u8,
                            message,
                            self.protected,
                            &mut receive,
                        );
                    }
                }
                Err(error) => {
                    self.ports[source] = None;
                    set_source_state(&mut self.status, source, false, Some(error));
                    self.retry[source] = std::time::Instant::now();
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protect_filters_parameter_edits_before_dispatch_but_keeps_performance_actions() {
        let mut settings = Settings {
            extra_inputs: vec![],
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![Binding {
                scene: "lead".into(),
                program: Some(3),
                controller: None,
            }],
            branch_bindings: vec![BranchBinding {
                branch: "clean".into(),
                controller: 23,
                mode: BranchMode::Toggle,
            }],
            parameter_bindings: vec![],
        };
        let cc = |controller| Message::Control {
            channel: 1,
            controller,
            value: 127,
        };
        for target in [
            ControlTarget::Native {
                node: "amp".into(),
                parameter: "toneBass".into(),
            },
            ControlTarget::Lv2 {
                node: "delay".into(),
                symbol: "time".into(),
            },
            ControlTarget::Merge {
                node: "mix".into(),
                port: 0,
            },
        ] {
            settings.parameter_bindings = vec![ParameterBinding {
                target,
                controller: 21,
                mode: ControlMode::Absolute,
            }];
            let mut dispatched = false;
            assert!(
                dispatch_protected(&settings, cc(21), true, |_, _| {
                    dispatched = true;
                    Ok(true)
                })
                .unwrap_err()
                .contains("Protect")
            );
            assert!(!dispatched);
            assert!(
                dispatch_protected(&settings, cc(21), false, |_, _| {
                    dispatched = true;
                    Ok(true)
                })
                .unwrap()
            );
            assert!(dispatched);
        }
        settings.parameter_bindings[0].target = ControlTarget::Bypass {
            node: "delay".into(),
        };
        for message in [
            cc(21),
            cc(23),
            Message::Program {
                channel: 1,
                program: 3,
            },
            cc(99),
        ] {
            assert!(dispatch_protected(&settings, message, true, |_, _| Ok(true)).unwrap());
        }
    }
    #[test]
    fn branch_gates_follow_both_values_and_toggles_ignore_release() {
        let mut settings = Settings {
            extra_inputs: vec![],
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![],
            parameter_bindings: vec![],
            branch_bindings: vec![BranchBinding {
                branch: "lead".into(),
                controller: 20,
                mode: BranchMode::Gate,
            }],
        };
        settings.validate().unwrap();
        let high = Message::Control {
            channel: 1,
            controller: 20,
            value: 127,
        };
        let low = Message::Control {
            channel: 1,
            controller: 20,
            value: 0,
        };
        assert_eq!(settings.branch(high).unwrap().1, Some(true));
        assert_eq!(settings.branch(low).unwrap().1, Some(false));
        settings.branch_bindings[0].mode = BranchMode::Toggle;
        assert_eq!(settings.branch(high).unwrap().1, None);
        assert!(settings.branch(low).is_none());
        settings.bindings.push(Binding {
            scene: "clean".into(),
            controller: Some(20),
            program: None,
        });
        assert!(settings.validate().is_err());
    }
    #[test]
    fn bank_select_controllers_are_reserved_for_global_preset_recall() {
        let mut settings = Settings {
            extra_inputs: vec![],
            input: "hw:Controller,0,0".into(),
            channel: 1,
            bindings: vec![],
            parameter_bindings: vec![],
            branch_bindings: vec![BranchBinding {
                branch: "lead".into(),
                controller: 0,
                mode: BranchMode::Toggle,
            }],
        };
        assert!(settings.validate().is_err());
        settings.branch_bindings[0].controller = 32;
        assert!(settings.validate().is_err());
        settings.branch_bindings[0].controller = 31;
        settings.validate().unwrap();
    }
    #[test]
    fn hardware_hints_normalize_only_the_discovered_card() {
        assert_eq!(
            hardware_hint("Controller", "hw:CARD=Controller,DEV=0"),
            Some("hw:Controller,0,0".into())
        );
        assert_eq!(
            hardware_hint("Controller", "hw:CARD=Controller,DEV=1,SUBDEV=2"),
            Some("hw:Controller,1,2".into())
        );
        for hint in [
            "default",
            "virtual",
            "hw:CARD=Other,DEV=0",
            "hw:CARD=Controller,DEV=0,EXTRA=1",
        ] {
            assert!(hardware_hint("Controller", hint).is_none());
        }
    }
    #[test]
    fn bindings_match_channel_pc_and_cc_press_but_not_release() {
        let settings = Settings {
            extra_inputs: vec![],
            branch_bindings: vec![],
            parameter_bindings: vec![],
            input: "hw:Controller,0,0".into(),
            channel: 2,
            bindings: vec![
                Binding {
                    scene: "clean".into(),
                    program: Some(0),
                    controller: None,
                },
                Binding {
                    scene: "lead".into(),
                    program: None,
                    controller: Some(20),
                },
            ],
        };
        settings.validate().unwrap();
        assert_eq!(
            settings.scene(Message::Program {
                channel: 2,
                program: 0
            }),
            Some("clean")
        );
        assert_eq!(
            settings.scene(Message::Program {
                channel: 1,
                program: 0
            }),
            None
        );
        assert_eq!(
            settings.scene(Message::Control {
                channel: 2,
                controller: 20,
                value: 127
            }),
            Some("lead")
        );
        assert_eq!(
            settings.scene(Message::Control {
                channel: 2,
                controller: 20,
                value: 0
            }),
            None
        );
        let mut invalid = settings.clone();
        invalid.bindings.push(invalid.bindings[0].clone());
        assert!(invalid.validate().is_err());
        invalid = settings;
        invalid.input = "default".into();
        assert!(invalid.validate().is_err());
    }
    #[test]
    fn running_status_realtime_and_chunk_boundaries_preserve_pc_and_cc() {
        let mut decoder = Decoder::default();
        let messages: Vec<_> = [
            0xc3, 7, 0xf8, 8, 0xb0, 20, 0xfe, 127, 20, 0, 0xd0, 22, 23, 0xc0, 2,
        ]
        .into_iter()
        .filter_map(|byte| decoder.push(byte))
        .collect();
        assert_eq!(
            messages,
            vec![
                Message::Program {
                    channel: 4,
                    program: 7
                },
                Message::Program {
                    channel: 4,
                    program: 8
                },
                Message::Control {
                    channel: 1,
                    controller: 20,
                    value: 127
                },
                Message::Control {
                    channel: 1,
                    controller: 20,
                    value: 0
                },
                Message::Program {
                    channel: 1,
                    program: 2
                }
            ]
        );
    }
    #[test]
    fn system_common_sysex_and_other_channel_messages_do_not_become_controls() {
        let mut decoder = Decoder::default();
        let messages: Vec<_> = [
            12, 0xb0, 7, 0xf0, 1, 2, 0xf8, 3, 0xf7, 127, 0x90, 60, 100, 61, 0, 0xb5, 22, 63, 0xf2,
            0, 0, 127, 0xc0, 0,
        ]
        .into_iter()
        .filter_map(|byte| decoder.push(byte))
        .collect();
        assert_eq!(
            messages,
            vec![
                Message::Control {
                    channel: 6,
                    controller: 22,
                    value: 63
                },
                Message::Program {
                    channel: 1,
                    program: 0
                }
            ]
        );
    }

    #[test]
    fn note_press_and_both_release_forms_keep_channel_and_running_status() {
        for channel in 1..=16 {
            let mut decoder = Decoder::default();
            let events: Vec<_> = [
                0x90 | (channel - 1),
                60,
                127,
                60,
                0,
                0x80 | (channel - 1),
                61,
                23,
                62,
                0,
            ]
            .into_iter()
            .filter_map(|byte| decoder.push_event(byte))
            .collect();
            assert_eq!(
                events,
                [
                    InputEvent::NoteOn {
                        channel,
                        note: 60,
                        velocity: 127,
                    },
                    InputEvent::NoteOff {
                        channel,
                        note: 60,
                        velocity: 0,
                    },
                    InputEvent::NoteOff {
                        channel,
                        note: 61,
                        velocity: 23,
                    },
                    InputEvent::NoteOff {
                        channel,
                        note: 62,
                        velocity: 0,
                    },
                ]
            );
        }
    }

    #[test]
    fn realtime_at_every_byte_boundary_preserves_notes_pc_cc_and_legacy_filtering() {
        let bytes = [0x9f, 60, 127, 60, 0, 0xbf, 21, 127, 0xcf, 7];
        let messages = [
            Message::Control {
                channel: 16,
                controller: 21,
                value: 127,
            },
            Message::Program {
                channel: 16,
                program: 7,
            },
        ];
        let expected = [
            InputEvent::NoteOn {
                channel: 16,
                note: 60,
                velocity: 127,
            },
            InputEvent::NoteOff {
                channel: 16,
                note: 60,
                velocity: 0,
            },
            InputEvent::Message(messages[0]),
            InputEvent::Message(messages[1]),
        ];
        for (byte, realtime) in [
            (0xf8, Realtime::Clock),
            (0xfa, Realtime::Start),
            (0xfb, Realtime::Continue),
            (0xfc, Realtime::Stop),
            (0xfe, Realtime::ActiveSensing),
            (0xff, Realtime::Reset),
        ] {
            for offset in 0..=bytes.len() {
                let mut stream = bytes.to_vec();
                stream.insert(offset, byte);
                let mut decoder = Decoder::default();
                let mut legacy = Decoder::default();
                let events: Vec<_> = stream
                    .iter()
                    .filter_map(|byte| decoder.push_event(*byte))
                    .collect();
                assert_eq!(
                    events
                        .iter()
                        .filter(|e| matches!(e, InputEvent::Realtime(_)))
                        .copied()
                        .collect::<Vec<_>>(),
                    [InputEvent::Realtime(realtime)],
                );
                assert_eq!(
                    events
                        .into_iter()
                        .filter(|e| !matches!(e, InputEvent::Realtime(_)))
                        .collect::<Vec<_>>(),
                    expected,
                );
                assert_eq!(
                    stream
                        .into_iter()
                        .filter_map(|byte| legacy.push(byte))
                        .collect::<Vec<_>>(),
                    messages,
                );
            }
        }
    }

    #[test]
    fn event_decoder_cancels_partial_notes_for_system_common_and_sysex() {
        let mut decoder = Decoder::default();
        let events: Vec<_> = [
            0x90, 60, 0xf2, 1, 2, 127, 0x90, 61, 0xf0, 1, 2, 0xf8, 0xf7, 127, 0xa0, 60, 80, 61, 90,
            0xe0, 0, 64, 0xd0, 22, 23, 0x91, 62, 0xf9, 0xfd, 100,
        ]
        .into_iter()
        .filter_map(|byte| decoder.push_event(byte))
        .collect();
        assert_eq!(
            events,
            [
                InputEvent::Realtime(Realtime::Clock),
                InputEvent::NoteOn {
                    channel: 2,
                    note: 62,
                    velocity: 100,
                },
            ]
        );
    }

    fn messages(status: &Status, previous: u64) -> Vec<Message> {
        status
            .unseen(previous)
            .into_iter()
            .map(|o| o.message)
            .collect()
    }

    fn scene_settings() -> Settings {
        Settings {
            extra_inputs: vec![],
            input: "hw:SINCO,0,0".into(),
            channel: 1,
            bindings: vec![Binding {
                scene: "clean".into(),
                program: Some(0),
                controller: None,
            }],
            branch_bindings: vec![],
            parameter_bindings: vec![],
        }
    }

    #[test]
    fn recent_log_keeps_arrival_order_and_a_detectable_gap_when_full() {
        let mut status = Status::default();
        for program in 0..(RECENT_LIMIT as u8 + 5) {
            status.observe(
                0,
                Message::Program {
                    channel: 1,
                    program,
                },
            );
        }
        assert_eq!(status.events, RECENT_LIMIT as u64 + 5);
        assert_eq!(status.recent.len(), RECENT_LIMIT);
        assert_eq!(status.recent[0].seq, 6);
        assert!(status.recent.windows(2).all(|w| w[1].seq == w[0].seq + 1));
        assert_eq!(status.last, Some(status.recent[RECENT_LIMIT - 1].message));
    }

    #[test]
    fn learning_records_every_message_but_never_dispatches() {
        let settings = scene_settings();
        let mut status = Status {
            learning: true,
            ..Status::default()
        };
        let mut dispatched = 0;
        for program in [0, 0, 1] {
            deliver(
                &mut status,
                &settings,
                0,
                Message::Program {
                    channel: 1,
                    program,
                },
                false,
                |_, _| {
                    dispatched += 1;
                    Ok(true)
                },
            );
        }
        assert_eq!(dispatched, 0);
        // A repeated PC is a real second press, not a duplicate to drop.
        assert_eq!(status.recent.len(), 3);
        status.learning = false;
        deliver(
            &mut status,
            &settings,
            0,
            Message::Program {
                channel: 1,
                program: 0,
            },
            false,
            |_, _| {
                dispatched += 1;
                Ok(true)
            },
        );
        assert_eq!(dispatched, 1);
        assert_eq!(status.recent.len(), 4);
    }

    #[test]
    fn dispatch_errors_surface_and_success_clears_them() {
        let settings = scene_settings();
        let mut status = Status::default();
        let message = Message::Program {
            channel: 1,
            program: 0,
        };
        deliver(&mut status, &settings, 0, message, false, |_, _| {
            Err("refused".into())
        });
        assert_eq!(status.error.as_deref(), Some("refused"));
        deliver(&mut status, &settings, 0, message, false, |_, _| Ok(true));
        assert_eq!(status.error, None);
    }

    #[test]
    fn unseen_returns_a_burst_in_order_and_handles_restart_and_learning() {
        let bank = |value| Message::Control {
            channel: 1,
            controller: 0,
            value,
        };
        let program = Message::Program {
            channel: 1,
            program: 3,
        };
        let mut status = Status::default();
        status.observe(0, bank(1));
        status.observe(
            0,
            Message::Control {
                channel: 1,
                controller: 32,
                value: 2,
            },
        );
        status.observe(0, program);
        // Bank Select CCs and the Program arrive in one poll interval.
        assert_eq!(messages(&status, 0).len(), 3);
        assert_eq!(messages(&status, 0).last(), Some(&program));
        assert_eq!(messages(&status, 2), vec![program]);
        assert!(messages(&status, 3).is_empty());
        // Restart: the count fell below the consumer's, everything retained is new.
        assert_eq!(messages(&status, 50).len(), 3);
        status.learning = true;
        assert!(messages(&status, 0).is_empty());
    }

    #[test]
    fn a_wire_burst_reaches_recall_in_order_and_is_not_collapsed_to_the_last_message() {
        // Bank Select MSB/LSB, Program Change and a CC press in one USB read,
        // using running status for the second controller, as a pedal would.
        let wire = [
            0xb0, 0x00, 0x01, 0x20, 0x02, // Bank Select 0/32 on channel 1
            0xc0, 0x03, // Program Change 3
            0xb0, 0x15, 0x7f, // CC 21 press
            0xf8, // interleaved clock must not disturb anything
            0x15, 0x00, // running status: CC 21 release
        ];
        let mut decoder = Decoder::default();
        let settings = scene_settings();
        let mut status = Status::default();
        let mut dispatched = Vec::new();
        for byte in wire {
            if let Some(message) = decoder.push(byte) {
                deliver(&mut status, &settings, 0, message, false, |_, m| {
                    dispatched.push(m);
                    Ok(true)
                });
            }
        }
        // The consumer last saw nothing: it must get all five, oldest first.
        let unseen = messages(&status, 0);
        assert_eq!(unseen.len(), 5);
        assert_eq!(unseen, dispatched);
        assert!(matches!(
            unseen[0],
            Message::Control {
                controller: 0,
                value: 1,
                ..
            }
        ));
        assert!(matches!(
            unseen[1],
            Message::Control {
                controller: 32,
                value: 2,
                ..
            }
        ));
        assert_eq!(
            unseen[2],
            Message::Program {
                channel: 1,
                program: 3
            }
        );
        // Only the last was visible through `last`: the old path lost the rest.
        assert_eq!(
            status.last,
            Some(Message::Control {
                channel: 1,
                controller: 21,
                value: 0
            })
        );
        // A second poll after more input returns only what is new.
        assert!(messages(&status, status.events).is_empty());
    }

    #[test]
    fn each_extra_controller_is_judged_on_its_own_channel_and_tagged_in_the_log() {
        let mut settings = scene_settings(); // first controller: channel 1, Program 0 = clean
        settings.extra_inputs = vec![ExtraInput {
            input: "hw:Captain,0,0".into(),
            channel: 3,
        }];
        settings.validate().unwrap();
        let program_on = |channel| Message::Program {
            channel,
            program: 0,
        };
        let mut status = Status::default();
        let mut ran = Vec::new();
        // The same Program Change 0 arrives from both controllers on different channels.
        for (source, channel) in [(0u8, 1u8), (1, 1), (1, 3), (0, 3)] {
            deliver(
                &mut status,
                &settings,
                source,
                program_on(channel),
                false,
                |s, m| {
                    ran.push((source, s.scene(m).map(str::to_owned)));
                    Ok(true)
                },
            );
        }
        // Controller 0 listens on channel 1 and controller 1 on channel 3, so only
        // the matching channel on each maps to the scene.
        let mapped: Vec<_> = ran
            .iter()
            .map(|(source, scene)| (*source, scene.is_some()))
            .collect();
        assert_eq!(mapped, [(0, true), (1, false), (1, true), (0, false)]);
        let sources: Vec<_> = status.recent.iter().map(|o| o.source).collect();
        assert_eq!(sources, [0, 1, 1, 0]);
        // An unknown source falls back to the first controller's filter.
        assert_eq!(settings.for_source(9).channel, 1);
    }

    #[test]
    fn extra_controllers_are_validated_explicitly() {
        let extra = |input: &str, channel| ExtraInput {
            input: input.into(),
            channel,
        };
        let with = |extras: Vec<ExtraInput>| {
            let mut settings = scene_settings();
            settings.extra_inputs = extras;
            settings.validate()
        };
        assert!(with(vec![extra("hw:Captain,0,0", 0)]).is_ok());
        assert!(
            with(vec![extra("hw:SINCO,0,0", 1)]).is_err(),
            "same device as the first"
        );
        assert!(
            with(vec![extra("hw:A,0,0", 1), extra("hw:A,0,0", 2)]).is_err(),
            "the same device twice"
        );
        assert!(with(vec![extra("not-a-device", 1)]).is_err());
        assert!(with(vec![extra("hw:A,0,0", 17)]).is_err());
        let four: Vec<_> = (0..MAX_INPUTS)
            .map(|i| extra(&format!("hw:D{i},0,0"), 1))
            .collect();
        assert!(
            with(four).is_err(),
            "at most {MAX_INPUTS} controllers in all"
        );
    }

    #[test]
    fn learn_window_expires_on_its_own() {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let mut until = Some(start + LEARN_WINDOW);
        assert!(learning_active(&mut until, start + Duration::from_secs(1)));
        assert!(!learning_active(&mut until, start + LEARN_WINDOW));
        assert_eq!(until, None);
        assert!(!learning_active(&mut None, start));
    }

    #[test]
    fn fresh_connection_does_not_complete_an_old_partial_press() {
        let mut decoder = Decoder::default();
        assert_eq!(decoder.push_event(0x90), None);
        assert_eq!(decoder.push_event(60), None);
        decoder = Decoder::default();
        assert_eq!(decoder.push_event(127), None);
        assert_eq!(decoder.push_event(60), None);
        assert_eq!(decoder.push_event(0), None);
        assert_eq!(decoder.push_event(0xc0), None);
        assert_eq!(
            decoder.push_event(7),
            Some(InputEvent::Message(Message::Program {
                channel: 1,
                program: 7,
            }))
        );
    }
}
