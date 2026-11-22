//! Stage switch pairs are stored with the preset; the sounding worker owns every action.
use crate::Shared;
use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::lifecycle::AudioPhase;
use oxidal_engine::protocol::{ControlCommand, RigAudioAction, RigAudioCommand, Target};
use oxidal_lv2::protocol::{GraphAudioAction, GraphAudioCommand};
use oxidal_presets::{LibraryKind as Kind, LibraryReference as Entry, switches::*};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SwitchPress {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performer: Option<String>,
    pub session: String,
    pub revision: String,
    pub profile: SwitchProfile,
    pub position: u8,
    pub gesture: SwitchGesture,
    pub pressed: bool,
}

type GateKey = (SwitchProfile, u8, SwitchGesture, String);
#[derive(Debug, Default)]
pub(super) struct Gates {
    session: Option<(Entry, String)>,
    held: BTreeMap<GateKey, SwitchAction>,
    changed_ms: Option<u64>,
}
impl Gates {
    fn observe(&mut self, entry: &Entry, session: &str) {
        if !self
            .session
            .as_ref()
            .is_some_and(|(e, s)| e == entry && s == session)
        {
            self.held.clear();
            self.session = Some((entry.clone(), session.to_string()))
        }
    }
}
fn fail(reason: &str) -> Response {
    crate::failure(StatusCode::CONFLICT, reason)
}
fn state_response(result: Result<SwitchLayoutState, oxidal_presets::Error>) -> Response {
    match result {
        Ok(state) => ([(header::CACHE_CONTROL, "no-store")], Json(state)).into_response(),
        Err(oxidal_presets::Error::Conflict(e)) => fail(e),
        Err(oxidal_presets::Error::Invalid(reason)) => {
            crate::failure(StatusCode::UNPROCESSABLE_ENTITY, reason)
        }
        Err(oxidal_presets::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            crate::failure(StatusCode::NOT_FOUND, "Preset not found")
        }
        Err(e) => crate::failure(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}
fn freeze_port(uri: &str) -> Option<&'static str> {
    match uri {
        "urn:oxidal:plugin:bloom#mono" | "urn:oxidal:plugin:bloom#stereo" => Some("freeze"),
        "urn:oxidal:plugin:echo#mono" | "urn:oxidal:plugin:echo#stereo" => Some("hold"),
        _ => None,
    }
}
fn targets(root: PathBuf, entry: &Entry) -> Result<Vec<(String, String)>, oxidal_presets::Error> {
    let bindings = match entry.kind {
        Kind::Rig => {
            let manifest =
                oxidal_presets::BundleStore::new(root.join("bundles")).manifest(&entry.id)?;
            let Some(host) = manifest.oxidal else {
                return Ok(vec![]);
            };
            host.graph
                .nodes
                .into_iter()
                .filter_map(|n| {
                    let plugin = host
                        .lv2
                        .iter()
                        .find(|p| Some(&p.id) == n.instance.as_ref())?;
                    Some((n.id, plugin.plugin_uri.clone()))
                })
                .collect()
        }
        Kind::Graph => oxidal_presets::GraphStore::new(root.join("graphs"))
            .read(&entry.id)?
            .preset
            .bindings
            .into_iter()
            .map(|b| (b.node, b.uri))
            .collect(),
        Kind::Original => {
            oxidal_presets::Store::new(root).original(&entry.id)?;
            vec![]
        }
        Kind::Owned => {
            oxidal_presets::OwnedStore::new(root.join("owned")).read(&entry.id)?;
            vec![]
        }
    };
    Ok(bindings
        .into_iter()
        .filter_map(|(n, uri)| Some((n, freeze_port(&uri)?.to_owned())))
        .collect())
}
pub(super) async fn get(
    State(s): State<Arc<Shared>>,
    Path((kind, id)): Path<(Kind, String)>,
) -> Response {
    let entry = Entry { kind, id };
    let _library = s.library_access.clone().read_owned().await;
    let result = tokio::task::spawn_blocking(move || {
        targets(s.config.preset_dir.clone(), &entry)?;
        s.midi_map.switch_layout(&entry)
    })
    .await;
    result.map_or_else(|_| fail("Cannot read switch layout"), state_response)
}
pub(super) async fn save(
    State(s): State<Arc<Shared>>,
    Path((kind, id)): Path<(Kind, String)>,
    Json(update): Json<SwitchLayoutUpdate>,
) -> Response {
    if let Some(reason) = s.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let entry = Entry { kind, id };
    let _library = s.library_access.clone().read_owned().await;
    let mut gates = s.switch_gates.lock().await;
    if let Some(session) = session(&s, &entry) {
        gates.observe(&entry, &session);
        if !gates.held.is_empty() {
            return fail("Release held switches before changing the layout");
        }
    }
    let s = Arc::clone(&s);
    let result = tokio::task::spawn_blocking(move || {
        let available = targets(s.config.preset_dir.clone(), &entry)?;
        let existing = s.midi_map.switch_layout(&entry)?;
        let map = s.midi_map.snapshot()?;
        let confirmed = observed_inputs(&s, &map);
        for input in update
            .layout
            .switches
            .iter()
            .filter_map(|a| a.input.as_ref())
        {
            if !existing
                .layout
                .switches
                .iter()
                .any(|a| a.input.as_ref() == Some(input))
                && !confirmed.contains(input)
            {
                return Err(oxidal_presets::Error::Invalid(
                    "Press this CC on the configured controller before assigning it",
                ));
            }
        }
        for assignment in &update.layout.switches {
            if let SwitchAction::Freeze { node, symbol, .. } = &assignment.action
                && !available.iter().any(|(n, p)| n == node && p == symbol)
            {
                return Err(oxidal_presets::Error::Invalid(
                    "Freeze target is unavailable in this preset",
                ));
            }
        }
        s.midi_map.save_switch_layout(&entry, update)
    })
    .await;
    if result.as_ref().is_ok_and(Result::is_ok) {
        gates.changed_ms = oxidal_audio::realtime::monotonic_millis();
    }
    result.map_or_else(|_| fail("Cannot save switch layout"), state_response)
}
pub(super) fn session(s: &Shared, e: &Entry) -> Option<String> {
    match e.kind {
        Kind::Rig => {
            let state = s.rig_playback.snapshot();
            let control = state.control?;
            (state.phase == AudioPhase::Running
                && state.device_owned
                && control.source_revision == e.id)
                .then_some(control.session)
        }
        Kind::Graph => {
            let state = s.graph_playback.snapshot();
            let id = state
                .configured
                .as_ref()?
                .library_id
                .as_ref()
                .or(state.saved_copy.as_ref())?;
            (state.phase == AudioPhase::Running && state.device_owned && id == &e.id)
                .then_some(state.control?.session)
        }
        Kind::Owned | Kind::Original => {
            let state = s.playback.snapshot();
            let p = state.configured?;
            (state.phase == AudioPhase::Running
                && state.device_owned
                && p.preset_id == e.id
                && p.owned == (e.kind == Kind::Owned))
                .then(|| format!("{}:{}", state.session, state.revision))
        }
    }
}
fn value(mode: FreezeMode, pressed: bool, current: f64) -> f64 {
    f64::from(match mode {
        FreezeMode::Gate => pressed,
        FreezeMode::Toggle => current < 0.5,
    })
}
async fn apply(
    s: &Shared,
    e: &Entry,
    request: &SwitchPress,
    action: &SwitchAction,
    received_ms: Option<u64>,
) -> Result<(), String> {
    if session(s, e).as_ref() != Some(&request.session) {
        return Err("The playing preset or session changed".into());
    }
    match action {
        SwitchAction::TapTempo { note } => {
            if request.pressed {
                s.tempo
                    .switch_tap(s, e, &request.session, *note, received_ms)
                    .await?;
            }
        }
        SwitchAction::Freeze { node, symbol, mode } => {
            if !request.pressed && *mode == FreezeMode::Toggle {
                return Ok(());
            }
            match e.kind {
                Kind::Rig => {
                    let state = s.rig_playback.snapshot();
                    let c = state
                        .control
                        .filter(|c| c.session == request.session && c.source_revision == e.id)
                        .ok_or("Rig changed")?;
                    let target = Target::Lv2 {
                        node: node.clone(),
                        symbol: symbol.clone(),
                    };
                    let current = c
                        .controls
                        .iter()
                        .find(|row| row.target == target && row.toggle)
                        .ok_or("Freeze control is unavailable")?;
                    let new = value(*mode, request.pressed, current.value);
                    let confirmed = s
                        .rig_playback
                        .dispatch(RigAudioCommand {
                            session: state.session,
                            expected_revision: state.revision,
                            action: RigAudioAction::Control {
                                command: ControlCommand {
                                    session: c.session,
                                    expected_revision: c.revision,
                                    target: target.clone(),
                                    value: new,
                                },
                            },
                        })
                        .await?;
                    if !confirmed.control.is_some_and(|c| {
                        c.session == request.session
                            && c.controls
                                .iter()
                                .any(|r| r.target == target && r.value == new)
                    }) {
                        return Err("Freeze was not confirmed".into());
                    }
                }
                Kind::Graph => {
                    let state = s.graph_playback.snapshot();
                    let c = state
                        .control
                        .filter(|c| c.session == request.session)
                        .ok_or("Effects session changed")?;
                    if !state.configured.as_ref().is_some_and(|p| {
                        p.bindings.iter().any(|b| {
                            &b.node == node && freeze_port(&b.uri) == Some(symbol.as_str())
                        })
                    }) {
                        return Err("Freeze target changed".into());
                    }
                    let target = format!("{node}.{symbol}");
                    let current = state
                        .native_values
                        .iter()
                        .find(|row| row.target == target)
                        .ok_or("Freeze control is unavailable")?;
                    let new = value(*mode, request.pressed, f64::from(current.value));
                    let command = oxidal_control::Command {
                        session: c.session,
                        protocol: c.protocol,
                        request_id: format!("switch-{}", c.revision),
                        expected_revision: Some(c.revision),
                        action: oxidal_control::Action::Set {
                            target: target.clone(),
                            value: new,
                        },
                    };
                    let confirmed = s
                        .graph_playback
                        .dispatch(GraphAudioCommand {
                            session: state.session,
                            expected_revision: state.revision,
                            action: GraphAudioAction::Control {
                                command: Box::new(command),
                            },
                        })
                        .await?;
                    if !confirmed
                        .native_values
                        .iter()
                        .any(|r| r.target == target && f64::from(r.value) == new)
                    {
                        return Err("Freeze was not confirmed".into());
                    }
                }
                _ => return Err("This preset has no Freeze control".into()),
            }
        }
    }
    Ok(())
}
pub(super) async fn perform(
    s: &Shared,
    e: &Entry,
    request: SwitchPress,
    received_ms: Option<u64>,
) -> Result<(), String> {
    let mut gates = s.switch_gates.lock().await;
    if request.pressed && s.captures.reamping() {
        return Err(crate::capture::REAMP_LOCKED.to_owned());
    }
    if session(s, e).as_ref() != Some(&request.session) {
        return Err("The playing preset or session changed".into());
    }
    if received_ms
        .zip(gates.changed_ms)
        .is_some_and(|(received, changed)| received <= changed)
    {
        return Err("Switch layout changed after MIDI receipt".into());
    }
    gates.observe(e, &request.session);
    let state = s.midi_map.switch_layout(e).map_err(|err| err.to_string())?;
    if state.revision != request.revision {
        return Err("Switch layout changed".into());
    }
    let key = (request.profile, request.position, request.gesture);
    let assignment = state
        .layout
        .switches
        .iter()
        .find(|a| (a.profile, a.position, a.gesture) == key)
        .ok_or("Switch has no custom assignment")?;
    let gate = matches!(
        assignment.action,
        SwitchAction::Freeze {
            mode: FreezeMode::Gate,
            ..
        }
    );
    let performer = request.performer.as_deref().unwrap_or("screen");
    if performer.len() > 256 || performer.is_empty() {
        return Err("Invalid switch performer".into());
    }
    let key = (key.0, key.1, key.2, performer.to_owned());
    if gate && request.pressed == gates.held.contains_key(&key) {
        return Ok(());
    }
    if gate
        && !request.pressed
        && gates
            .held
            .iter()
            .any(|(other, action)| other != &key && action == &assignment.action)
    {
        gates.held.remove(&key);
        return Ok(());
    }
    if gate && request.pressed && gates.held.len() >= 128 {
        return Err("Too many held switches".into());
    }
    apply(s, e, &request, &assignment.action, received_ms).await?;
    if gate {
        if request.pressed {
            gates.held.insert(key, assignment.action.clone());
        } else {
            gates.held.remove(&key);
        }
    }
    Ok(())
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReleaseSwitches {
    pub session: String,
}

/// An operator can recover a gate after the browser that pressed it disconnects.
pub(super) async fn release(
    State(s): State<Arc<Shared>>,
    Path((kind, id)): Path<(Kind, String)>,
    Json(command): Json<ReleaseSwitches>,
) -> Response {
    let entry = Entry { kind, id };
    let mut gates = s.switch_gates.lock().await;
    if session(&s, &entry).as_ref() != Some(&command.session) {
        return fail("The playing preset or session changed");
    }
    gates.observe(&entry, &command.session);
    while let Some(((profile, position, gesture, performer), action)) = gates
        .held
        .first_key_value()
        .map(|(k, a)| (k.clone(), a.clone()))
    {
        let release = SwitchPress {
            performer: Some(performer),
            session: command.session.clone(),
            revision: String::new(),
            profile,
            position,
            gesture,
            pressed: false,
        };
        if let Err(reason) = apply(&s, &entry, &release, &action, None).await {
            return fail(&reason);
        }
        gates.held.retain(|_, held| held != &action);
    }
    Json(serde_json::json!({"ok":true})).into_response()
}

pub(super) async fn press(
    State(s): State<Arc<Shared>>,
    Path((kind, id)): Path<(Kind, String)>,
    Json(mut request): Json<SwitchPress>,
) -> Response {
    request.performer = Some(format!(
        "touch:{}",
        request.performer.as_deref().unwrap_or("screen")
    ));
    match perform(&s, &Entry { kind, id }, request, None).await {
        Ok(()) => Json(serde_json::json!({"ok":true})).into_response(),
        Err(e) => fail(&e),
    }
}

#[derive(Debug, Clone)]
pub(super) struct Origin {
    entry: Entry,
    session: String,
    port: String,
    channel: u8,
}
impl Origin {
    pub(super) fn from_settings(
        kind: Kind,
        id: &str,
        session: &str,
        settings: Option<&oxidal_audio::midi::Settings>,
        event: &oxidal_audio::midi::Observed,
    ) -> Option<Self> {
        let working = settings?.for_source(event.source);
        if working.scene(event.message).is_some()
            || working.parameter(event.message).is_some()
            || working.branch(event.message).is_some()
        {
            return None;
        }
        Self::new(kind, id, session, settings, event.source)
    }
    pub(super) fn new(
        kind: Kind,
        id: &str,
        session: &str,
        settings: Option<&oxidal_audio::midi::Settings>,
        source: u8,
    ) -> Option<Self> {
        let settings = settings?;
        let (port, channel) = if source == 0 {
            (&settings.input, settings.channel)
        } else {
            let input = settings.extra_inputs.get(usize::from(source) - 1)?;
            (&input.input, input.channel)
        };
        Some(Self {
            entry: Entry {
                kind,
                id: id.to_owned(),
            },
            session: session.to_owned(),
            port: port.clone(),
            channel,
        })
    }
}
fn physical_assignment<'a>(
    origin: &Origin,
    event: oxidal_audio::midi::Message,
    layout: &'a SwitchLayout,
) -> Option<(&'a SwitchAssignment, bool)> {
    let oxidal_audio::midi::Message::Control {
        channel,
        controller,
        value,
    } = event
    else {
        return None;
    };
    if origin.channel != 0 && origin.channel != channel {
        return None;
    }
    let assignment = layout.switches.iter().find(|a| {
        a.input.as_ref().is_some_and(|i| {
            i.port == origin.port && i.channel == channel && i.controller == controller
        })
    })?;
    Some((assignment, value >= 64))
}
#[derive(Default)]
pub(super) struct PhysicalLayout {
    current: Option<(Entry, u64, SwitchLayoutState)>,
}
pub(super) async fn physical(
    s: &Shared,
    map: &oxidal_presets::MidiMap,
    event: &crate::midi_recall::Event,
    cache: &mut PhysicalLayout,
) -> Option<Result<(), String>> {
    let oxidal_audio::midi::Message::Control { channel, .. } = event.message else {
        return None;
    };
    let origin = event.origin.as_ref()?;
    let selected = if event.source == 0 {
        (map.input.as_ref()?, map.channel)
    } else {
        let i = map.extra_inputs.get(usize::from(event.source) - 1)?;
        (&i.input, i.channel)
    };
    if selected.0 != &origin.port || (selected.1 != 0 && selected.1 != channel) {
        return None;
    }
    let generation = s.midi_map.generation();
    if !cache
        .current
        .as_ref()
        .is_some_and(|(e, g, _)| e == &origin.entry && *g == generation)
    {
        cache.current = Some((
            origin.entry.clone(),
            generation,
            s.midi_map.switch_layout(&origin.entry).ok()?,
        ));
    }
    let (_, _, state) = cache.current.as_ref()?;
    let (assignment, pressed) = physical_assignment(origin, event.message, &state.layout)?;
    let request = SwitchPress {
        performer: Some(format!(
            "midi:{}:{}",
            assignment.input.as_ref()?.channel,
            origin.port
        )),
        revision: state.revision.clone(),
        session: origin.session.clone(),
        profile: assignment.profile,
        position: assignment.position,
        gesture: assignment.gesture,
        pressed,
    };
    Some(perform(s, &origin.entry, request, event.received_ms).await)
}
fn observed_inputs(s: &Shared, map: &oxidal_presets::MidiMap) -> Vec<SwitchInput> {
    let mixed = s.rig_playback.snapshot();
    let native = s.playback.snapshot();
    let graph = s.graph_playback.snapshot();
    let status = if mixed.device_owned && mixed.phase == AudioPhase::Running {
        mixed.control.map(|c| c.midi)
    } else if native.device_owned && native.phase == AudioPhase::Running {
        Some(native.midi)
    } else if graph.device_owned && graph.phase == AudioPhase::Running {
        graph.midi
    } else {
        None
    };
    let Some(status) = status else { return vec![] };
    status
        .recent
        .iter()
        .filter_map(|event| {
            let oxidal_audio::midi::Message::Control {
                channel,
                controller,
                value,
            } = event.message
            else {
                return None;
            };
            if value < 64 {
                return None;
            }
            let port = status.input_ports.get(usize::from(event.source))?;
            let (selected, ch) = if event.source == 0 {
                (map.input.as_ref()?, map.channel)
            } else {
                let extra = map.extra_inputs.get(usize::from(event.source) - 1)?;
                (&extra.input, extra.channel)
            };
            (port == selected && (ch == 0 || ch == channel)).then(|| SwitchInput {
                port: port.clone(),
                channel,
                controller,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxidal_audio::midi::Message;
    #[test]
    fn independent_ccs_match_only_the_observed_port_and_channel() {
        let origin = Origin {
            entry: Entry {
                kind: Kind::Rig,
                id: "a".repeat(64),
            },
            session: "worker1".into(),
            port: "hw:Captain".into(),
            channel: 2,
        };
        let layout = SwitchLayout {
            version: 1,
            switches: vec![SwitchAssignment {
                profile: SwitchProfile::Ten,
                position: 6,
                gesture: SwitchGesture::Hold,
                action: SwitchAction::Freeze {
                    node: "wash".into(),
                    symbol: "freeze".into(),
                    mode: FreezeMode::Gate,
                },
                input: Some(SwitchInput {
                    port: "hw:Captain".into(),
                    channel: 2,
                    controller: 100,
                }),
            }],
        };
        let cc = |channel, controller, value| Message::Control {
            channel,
            controller,
            value,
        };
        assert!(
            physical_assignment(&origin, cc(2, 100, 127), &layout)
                .unwrap()
                .1
        );
        assert!(
            !physical_assignment(&origin, cc(2, 100, 0), &layout)
                .unwrap()
                .1
        );
        assert!(physical_assignment(&origin, cc(1, 100, 127), &layout).is_none());
        assert!(physical_assignment(&origin, cc(2, 101, 127), &layout).is_none());
        assert!(
            physical_assignment(
                &Origin {
                    port: "hw:Chocolate".into(),
                    ..origin.clone()
                },
                cc(2, 100, 127),
                &layout
            )
            .is_none()
        );
        assert!(
            physical_assignment(
                &origin,
                Message::Program {
                    channel: 2,
                    program: 6
                },
                &layout
            )
            .is_none()
        );
    }
    #[test]
    fn gate_receipts_expire_after_worker_replacement() {
        let entry = Entry {
            kind: Kind::Rig,
            id: "a".repeat(64),
        };
        let mut gates = Gates::default();
        gates.observe(&entry, "first");
        gates.held.insert(
            (SwitchProfile::Four, 1, SwitchGesture::Hold, "touch".into()),
            SwitchAction::Freeze {
                node: "wash".into(),
                symbol: "freeze".into(),
                mode: FreezeMode::Gate,
            },
        );
        gates.observe(&entry, "first");
        assert_eq!(gates.held.len(), 1);
        gates.observe(&entry, "replacement");
        assert!(gates.held.is_empty());
    }
}
