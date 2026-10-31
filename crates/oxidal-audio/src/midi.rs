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
        let parts: Vec<_> = self
            .input
            .strip_prefix("hw:")
            .unwrap_or("")
            .split(',')
            .collect();
        if parts.len() != 3
            || parts[0].is_empty()
            || self.input.len() > 128
            || !parts[0]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || parts[1..].iter().any(|p| p.parse::<u16>().is_err())
            || self.channel > 16
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
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Status {
    pub connected: bool,
    pub events: u64,
    pub last: Option<Message>,
    pub error: Option<String>,
}
/// Keeps running status across read boundaries and real-time messages. SysEx and
/// system-common cancel it; unsupported channel messages are consumed correctly.
#[derive(Debug, Default)]
pub struct Decoder {
    status: u8,
    first: Option<u8>,
}
impl Decoder {
    pub fn push(&mut self, byte: u8) -> Option<Message> {
        if byte >= 0xf8 {
            return None;
        }
        if byte >= 0x80 {
            self.status = if byte < 0xf0 { byte } else { 0 };
            self.first = None;
            return None;
        }
        let channel = (self.status & 15) + 1;
        match self.status & 0xf0 {
            0xc0 => Some(Message::Program {
                channel,
                program: byte,
            }),
            0xd0 | 0 => None,
            kind => {
                let Some(first) = self.first.take() else {
                    self.first = Some(byte);
                    return None;
                };
                if kind == 0xb0 {
                    Some(Message::Control {
                        channel,
                        controller: first,
                        value: byte,
                    })
                } else {
                    None
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
        let mut bytes = [0; 64];
        let count = match self.port.read(&mut bytes) {
            Ok(count) => count,
            Err(error) if error.errno() == 11 => return Ok(0), // EAGAIN on Linux
            Err(error) => return Err(error.to_string()),
        };
        for byte in &bytes[..count] {
            if let Some(message) = self.decoder.push(*byte) {
                receive(message);
            }
        }
        Ok(count)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branch_gates_follow_both_values_and_toggles_ignore_release() {
        let mut settings = Settings {
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
}

/// Device reads and retry state shared by workers; never called inside PCM.
#[cfg(all(target_os = "linux", feature = "alsa"))]
#[derive(Debug)]
pub struct Connection {
    settings: Option<Settings>,
    pub status: Status,
    port: Option<Input>,
    retry: std::time::Instant,
}
#[cfg(all(target_os = "linux", feature = "alsa"))]
impl Connection {
    pub fn new(settings: Option<Settings>) -> Self {
        Self {
            settings,
            status: Status::default(),
            port: None,
            retry: std::time::Instant::now() - std::time::Duration::from_secs(2),
        }
    }
    pub fn configure(&mut self, settings: Option<Settings>) {
        *self = Self::new(settings);
    }
    pub fn test(
        &self,
        message: Message,
        mut receive: impl FnMut(&Settings, Message) -> Result<bool, String>,
    ) -> Result<bool, String> {
        receive(
            self.settings
                .as_ref()
                .ok_or("MIDI is not configured for the playing preset")?,
            message,
        )
    }
    pub fn poll(&mut self, mut receive: impl FnMut(&Settings, Message) -> Result<bool, String>) {
        let Some(settings) = &self.settings else {
            return;
        };
        if self.port.is_none() && self.retry.elapsed() >= std::time::Duration::from_secs(2) {
            self.retry = std::time::Instant::now();
            match Input::open(&settings.input) {
                Ok(port) => {
                    self.port = Some(port);
                    self.status.connected = true;
                    self.status.error = None;
                }
                Err(error) => {
                    self.status.connected = false;
                    self.status.error = Some(error);
                }
            }
        }
        if let Some(port) = &mut self.port {
            let mut messages = [None; 64];
            let mut count = 0;
            match port.read(|message| {
                messages[count] = Some(message);
                count += 1;
            }) {
                Ok(_) => {
                    for message in messages.into_iter().flatten() {
                        self.status.events = self.status.events.saturating_add(1);
                        self.status.last = Some(message);
                        match receive(settings, message) {
                            Ok(true) => self.status.error = None,
                            Ok(false) => {}
                            Err(error) => self.status.error = Some(error),
                        }
                    }
                }
                Err(error) => {
                    self.port = None;
                    self.status.connected = false;
                    self.status.error = Some(error);
                    self.retry = std::time::Instant::now();
                }
            }
        }
    }
}
