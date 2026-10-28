use std::{
    ffi::{CStr, CString, c_char, c_void},
    marker::PhantomData,
    ptr::NonNull,
    rc::Rc,
};

#[derive(Debug)]
pub struct NativeError(pub String);
impl std::fmt::Display for NativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for NativeError {}
type Result<T> = std::result::Result<T, NativeError>;

unsafe extern "C" {
    fn oxidal_t3k_eq(
        engine: *mut c_void,
        id: *const c_char,
        kind: i32,
        index: i32,
        value: i32,
        band: *const c_char,
    ) -> i32;

    fn oxidal_t3k_stage_submit(
        engine: *mut c_void,
        token: u64,
        command: u32,
        request: *const c_char,
        length: u32,
    ) -> i32;
    fn oxidal_t3k_stage_read(
        engine: *mut c_void,
        token: u64,
        output: *mut c_char,
        capacity: u32,
        written: *mut u32,
    ) -> i32;

    fn oxidal_t3k_prepare_model(
        engine: *mut c_void,
        target: *const c_char,
        path: *const c_char,
        metadata: *const c_char,
    ) -> i32;
    fn oxidal_t3k_preparation(
        engine: *mut c_void,
        action: i32,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_structure(engine: *mut c_void, request: *const c_char) -> i32;
    fn oxidal_t3k_remove_block(engine: *mut c_void, id: *const c_char) -> i32;
    fn oxidal_t3k_input_mode(engine: *mut c_void, mode: i32) -> i32;
    fn oxidal_t3k_chain(
        engine: *mut c_void,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_split(
        engine: *mut c_void,
        amp: *const c_char,
        cab: *const c_char,
        confirm: bool,
        pitch: bool,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_split_state(
        engine: *mut c_void,
        stage: i32,
        out: *mut u8,
        capacity: usize,
        written: *mut usize,
    ) -> i32;

    fn oxidal_t3k_reset_empty(engine: *mut c_void) -> i32;
    fn oxidal_t3k_restore_slot(
        engine: *mut c_void,
        target: *const c_char,
        lane: i32,
        index: i32,
    ) -> i32;
    fn oxidal_t3k_load_preset(engine: *mut c_void, bytes: *const u8, length: usize) -> i32;
    fn oxidal_t3k_save_preset(
        engine: *mut c_void,
        name: *const c_char,
        out: *mut u8,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_error() -> *const c_char;
    fn oxidal_t3k_create(rate: f64, frames: i32, result: *mut *mut c_void) -> i32;
    fn oxidal_t3k_create_stage(rate: f64, frames: i32, role: i32, result: *mut *mut c_void) -> i32;
    fn oxidal_t3k_destroy(engine: *mut c_void) -> i32;
    fn oxidal_t3k_latency_samples(engine: *mut c_void, samples: *mut u32) -> i32;
    fn oxidal_t3k_prepare_stream(engine: *mut c_void, ready: *mut u32) -> i32;
    fn oxidal_t3k_catalog(
        engine: *mut c_void,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_runtime(
        engine: *mut c_void,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_block_controls(
        engine: *mut c_void,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_set_block(
        engine: *mut c_void,
        id: *const c_char,
        parameter: *const c_char,
        value: f32,
    ) -> i32;
    fn oxidal_t3k_set(engine: *mut c_void, id: *const c_char, normalized: f32) -> i32;
    fn oxidal_t3k_process(
        engine: *mut c_void,
        left: *mut f32,
        right: *mut f32,
        frames: usize,
    ) -> i32;
    fn oxidal_t3k_capture(
        engine: *mut c_void,
        out: *mut u8,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
    fn oxidal_t3k_restore(engine: *mut c_void, bytes: *const u8, length: usize) -> i32;
    fn oxidal_t3k_pump(engine: *mut c_void) -> i32;
    fn oxidal_t3k_load_model(
        engine: *mut c_void,
        path: *const c_char,
        out: *mut c_char,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
}
fn checked(code: i32) -> Result<()> {
    if code == 0 {
        return Ok(());
    }
    // SAFETY: bridge returns its NUL-terminated thread-local error until the next call.
    Err(NativeError(
        unsafe { CStr::from_ptr(oxidal_t3k_error()) }
            .to_string_lossy()
            .into_owned(),
    ))
}
fn string(value: &str) -> Result<CString> {
    CString::new(value).map_err(|_| NativeError("interior NUL".into()))
}

#[derive(Clone, Copy, Debug)]
#[repr(i32)]
pub enum InputMode {
    Stereo = 0,
    Left = 1,
    Right = 2,
    DualMono = 3,
}

/// Opaque state captured by this backend, not arbitrary imported bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State(Vec<u8>);
impl State {
    pub fn byte_len(&self) -> usize {
        self.0.len()
    }
}

/// Derived native instance states, preserving source assets and allocation of global controls.
/// Use `prepare` to allocate the matching DSP roles; restoring each as a whole
/// preset would apply the output DC blocker twice. Full parity remains scope-limited.
#[derive(Clone, Debug)]
pub struct SplitStages {
    pub amp: State,
    pub cab: State,
    pub pitch: serde_json::Value,
}

impl SplitStages {
    /// Prepare the paired processing roles on the current owner. This loads assets
    /// and waits for readiness; call outside a streaming callback. The amp omits
    /// the final DC blocker, which the cab applies once before the output controls.
    /// The pair currently requires a 48 kHz host to avoid duplicated boundary
    /// resampling. Whole-preset engines keep their existing sample-rate support.
    /// Extracted external pitch still requires a separate upstream processor.
    pub fn prepare(&self, rate: f64, frames: usize) -> Result<(Engine, Engine)> {
        let mut amp = Engine::with_stage_role(rate, frames, ProcessingRole::Amp)?;
        amp.restore(&self.amp)?;
        amp.wait_ready()?;
        let mut cab = Engine::with_stage_role(rate, frames, ProcessingRole::Cab)?;
        cab.restore(&self.cab)?;
        cab.wait_ready()?;
        Ok((amp, cab))
    }
}

/// Host processing role, intentionally independent of exported native state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ProcessingRole {
    WholePreset = 0,
    Amp = 1,
    Cab = 2,
}

/// Single-owner offline processor. !Send/!Sync keeps JUCE calls and destruction on its owner thread.
/// Multiple handles may coexist on that process owner. Construction and transfer on
/// another thread are rejected. This is not a real-time-safe or live ALSA interface.
pub struct Engine {
    ptr: NonNull<c_void>,
    frames: usize,
    rate: f64,
    role: ProcessingRole,
    owner: PhantomData<Rc<()>>,
    json_buffer: Vec<u8>,
}
impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine")
            .field("ptr", &self.ptr)
            .field("frames", &self.frames)
            .field("rate", &self.rate)
            .field("role", &self.role)
            .finish_non_exhaustive()
    }
}
impl Engine {
    pub fn configuration(&self) -> (f64, usize) {
        (self.rate, self.frames)
    }
    pub fn processing_role(&self) -> ProcessingRole {
        self.role
    }
    pub fn new(rate: f64, frames: usize) -> Result<Self> {
        Self::with_stage_role(rate, frames, ProcessingRole::WholePreset)
    }
    fn with_stage_role(rate: f64, frames: usize, role: ProcessingRole) -> Result<Self> {
        if !rate.is_finite()
            || !(8000.0..=192000.0).contains(&rate)
            || !(1..=2048).contains(&frames)
        {
            return Err(NativeError("invalid audio configuration".into()));
        }
        let mut ptr = std::ptr::null_mut();
        // SAFETY: out pointer is live; native validates configuration and constructs one owned handle.
        checked(unsafe {
            match role {
                ProcessingRole::WholePreset => oxidal_t3k_create(rate, frames as i32, &mut ptr),
                role => oxidal_t3k_create_stage(rate, frames as i32, role as i32, &mut ptr),
            }
        })?;
        Ok(Self {
            ptr: NonNull::new(ptr).ok_or_else(|| NativeError("null native result".into()))?,
            frames,
            rate,
            role,
            owner: PhantomData,
            json_buffer: Vec::new(),
        })
    }
    fn json(
        &mut self,
        call: impl FnOnce(*mut c_void, *mut c_char, usize, *mut usize) -> i32,
    ) -> Result<serde_json::Value> {
        // Reuse one bounded scratch allocation; these calls run outside PCM.
        self.json_buffer
            .resize(oxidal_audio::lifecycle::PLAYBACK_FRAME_BYTES, 0);
        let buffer = &mut self.json_buffer;
        let mut written = 0;
        checked(call(
            self.ptr.as_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut written,
        ))?;
        if written > buffer.len() {
            return Err(NativeError("invalid native JSON length".into()));
        }
        serde_json::from_slice(&buffer[..written]).map_err(|e| NativeError(e.to_string()))
    }
    /// Port of the existing amp/cab partition; prepares both states without mutating this engine.
    pub fn split_amp_cab(
        &mut self,
        amp: &str,
        cab: &str,
        confirm: bool,
        external_pitch: bool,
    ) -> Result<SplitStages> {
        let amp = string(amp)?;
        let cab = string(cab)?;
        // SAFETY: owner handle and C strings outlive the bounded native operation.
        let pitch = self.json(|p, b, n, w| unsafe {
            oxidal_t3k_split(
                p,
                amp.as_ptr(),
                cab.as_ptr(),
                confirm,
                external_pitch,
                b,
                n,
                w,
            )
        })?;
        let read = |stage| -> Result<State> {
            let mut length = 0;
            // SAFETY: null output requests the size of an adapter-produced cached state.
            checked(unsafe {
                oxidal_t3k_split_state(
                    self.ptr.as_ptr(),
                    stage,
                    std::ptr::null_mut(),
                    0,
                    &mut length,
                )
            })?;
            if !(5..=32 * 1024 * 1024).contains(&length) {
                return Err(NativeError("Invalid stage size".into()));
            }
            let mut bytes = vec![0; length];
            let capacity = length;
            // SAFETY: output has the requested capacity; owner-exclusive access keeps the state stable.
            checked(unsafe {
                oxidal_t3k_split_state(
                    self.ptr.as_ptr(),
                    stage,
                    bytes.as_mut_ptr(),
                    capacity,
                    &mut length,
                )
            })?;
            if length != capacity {
                return Err(NativeError("Stage size changed".into()));
            }
            Ok(State(bytes))
        };
        Ok(SplitStages {
            amp: read(0)?,
            cab: read(1)?,
            pitch,
        })
    }
    /// Native input routing, persisted in instance state rather than preset files.
    pub fn set_input_mode(&mut self, mode: InputMode) -> Result<()> {
        // SAFETY: enum discriminants match the pinned native input-mode ABI.
        checked(unsafe { oxidal_t3k_input_mode(self.ptr.as_ptr(), mode as i32) })
    }
    /// Control-thread structural edit. Call wait_ready before accepting the result.
    pub fn remove_block(&mut self, id: &str) -> Result<()> {
        let id = string(id)?;
        // SAFETY: bounded identity and live exclusive owner; native rejects stale/insert IDs.
        checked(unsafe { oxidal_t3k_remove_block(self.ptr.as_ptr(), id.as_ptr()) })
    }
    pub fn layout(&mut self) -> Result<crate::protocol::ChainLayout> {
        use crate::protocol::{ChainBlock, ChainLayout};
        let state = self.chain()?;
        let lane = |key: &str| -> Result<Vec<ChainBlock>> {
            state[key].as_array().map_or(Ok(vec![]), |blocks| {
                blocks
                    .iter()
                    .map(|b| {
                        Ok(ChainBlock {
                            id: b["blockId"]
                                .as_str()
                                .ok_or_else(|| NativeError("Missing block identity".into()))?
                                .into(),
                            insert: b["kind"] == "insert",
                        })
                    })
                    .collect()
            })
        };
        Ok(ChainLayout {
            stereo: state["stereoEnabled"].as_bool().unwrap_or(false),
            left: lane("chain")?,
            right: lane("chainRight")?,
        })
    }
    /// Draft-only structural mutation; the editor owns rollback, history and revision.
    pub fn edit_structure(&mut self, edit: &crate::protocol::StructureEdit) -> Result<()> {
        use crate::protocol::{ChainLane, StructureEdit};
        if self.role != ProcessingRole::WholePreset {
            return Err(NativeError(
                "Extracted stages do not support structural edits".into(),
            ));
        }
        let layout = self.layout()?;
        let blocks = |lane| {
            if lane == ChainLane::Left {
                &layout.left
            } else {
                &layout.right
            }
        };
        match edit {
            StructureEdit::Reorder { lane, block_ids } => {
                let current = blocks(*lane);
                if current.is_empty()
                    || block_ids.len() != current.len()
                    || block_ids.iter().enumerate().any(|(i, id)| {
                        !current.iter().any(|b| &b.id == id) || block_ids[..i].contains(id)
                    })
                {
                    return Err(NativeError(
                        "Order must contain every block in the selected lane exactly once".into(),
                    ));
                }
            }
            StructureEdit::Move {
                block_id,
                lane,
                index,
            }
            | StructureEdit::Duplicate {
                block_id,
                lane,
                index,
            } => {
                if (*lane == ChainLane::Right && !layout.stereo)
                    || *index > blocks(*lane).len()
                    || !layout
                        .left
                        .iter()
                        .chain(&layout.right)
                        .any(|b| b.id == *block_id && !b.insert)
                    || matches!(edit, StructureEdit::Move { .. })
                        && (!layout.stereo || blocks(*lane).iter().any(|b| b.id == *block_id))
                {
                    return Err(NativeError("Invalid or stale structural target".into()));
                }
            }
            StructureEdit::Stereo { .. } => (),
        }
        let bytes = serde_json::to_string(edit).map_err(|e| NativeError(e.to_string()))?;
        if bytes.len() > 262144 {
            return Err(NativeError("Structural request exceeds byte budget".into()));
        }
        let request = string(&bytes)?;
        // SAFETY: owned JSON string and exclusive native handle remain live. Both sides validate.
        checked(unsafe { oxidal_t3k_structure(self.ptr.as_ptr(), request.as_ptr()) })
    }
    pub fn chain(&mut self) -> Result<serde_json::Value> {
        // SAFETY: live owner handle and bounded JSON output.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_chain(p, b, n, w) })
    }
    /// Preparation only: wait for assets/edit holds and reset DSP histories and
    /// resampling clocks before admission. Never call on a sounding instance.
    pub fn prepare_stream(&mut self) -> Result<()> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut left = vec![0.0; self.frames];
        let mut right = left.clone();
        loop {
            self.pump()?;
            let mut ready = 0;
            // SAFETY: exclusive owner handle and writable result. Native checks
            // pending assets/edit holds before restarting prepared DSP state.
            checked(unsafe { oxidal_t3k_prepare_stream(self.ptr.as_ptr(), &mut ready) })?;
            if ready == 1 {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(NativeError("native stream preparation timed out".into()));
            }
            left.fill(0.0);
            right.fill(0.0);
            self.process(&mut left, &mut right)?;
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    /// Reported processor delay at the configured host rate. Query after
    /// preparation/pumping; this excludes audio-device and transport latency.
    pub fn latency_samples(&self) -> Result<u32> {
        let mut samples = 0;
        // SAFETY: live owner handle and writable, correctly sized output.
        checked(unsafe { oxidal_t3k_latency_samples(self.ptr.as_ptr(), &mut samples) })?;
        Ok(samples)
    }
    /// Submit the reference stage gesture on the native owner. Pump and read
    /// until completion; audio may continue while the operation is pending.
    pub fn stage_submit(
        &mut self,
        token: u64,
        action: &crate::protocol::StageAction,
    ) -> Result<()> {
        let (command, payload) = action.encode().map_err(NativeError)?;
        if token == 0 || payload.len() > 256 {
            return Err(NativeError("Invalid stage request envelope".into()));
        }
        // SAFETY: owner handle and bounded UTF-8 payload outlive submit, which copies it.
        checked(unsafe {
            oxidal_t3k_stage_submit(
                self.ptr.as_ptr(),
                token,
                command,
                payload.as_ptr().cast(),
                payload.len() as u32,
            )
        })
    }
    pub fn stage_read(&mut self, token: u64) -> Result<Option<serde_json::Value>> {
        let mut output = vec![0_u8; 32768];
        let mut written = 0;
        // SAFETY: live owner handle and buffer; native reports bytes including the terminal NUL.
        checked(unsafe {
            oxidal_t3k_stage_read(
                self.ptr.as_ptr(),
                token,
                output.as_mut_ptr().cast(),
                output.len() as u32,
                &mut written,
            )
        })?;
        if written == 0 {
            return Ok(None);
        }
        let written = written as usize;
        if written > output.len() || output[written - 1] != 0 {
            return Err(NativeError("Invalid stage response envelope".into()));
        }
        serde_json::from_slice(&output[..written - 1])
            .map(Some)
            .map_err(|e| NativeError(e.to_string()))
    }
    /// Immediate owner edit, outside the processing callback. No message-loop wait.
    pub fn set_eq(&mut self, block_id: &str, edit: &oxidal_audio::eq::EqEdit) -> Result<()> {
        use oxidal_audio::eq::EqEdit;
        if block_id.is_empty() || block_id.len() > 128 || block_id.chars().any(char::is_control) {
            return Err(NativeError("Invalid EQ target".into()));
        }
        let (kind, index, value, band) = match edit {
            EqEdit::Enabled { value } => (0, 0, i32::from(*value), String::new()),
            EqEdit::Pre { value } => (1, 0, i32::from(*value), String::new()),
            EqEdit::Band { index, band } if band.valid(usize::from(*index)) => (
                2,
                i32::from(*index),
                0,
                serde_json::to_string(band).map_err(|e| NativeError(e.to_string()))?,
            ),
            _ => return Err(NativeError("Invalid EQ edit".into())),
        };
        let id = CString::new(block_id).map_err(|e| NativeError(e.to_string()))?;
        let band = CString::new(band).map_err(|e| NativeError(e.to_string()))?;
        // SAFETY: owner handle and validated strings live through this synchronous call.
        checked(unsafe {
            oxidal_t3k_eq(
                self.ptr.as_ptr(),
                id.as_ptr(),
                kind,
                index,
                value,
                band.as_ptr(),
            )
        })
    }
    /// Owned EQ readback for reconstruction. Never a capture on the DSP callback.
    pub fn eq_snapshot(&mut self) -> Result<Vec<crate::protocol::BlockEqState>> {
        let chain = self.chain()?;
        let mut result = Vec::new();
        for lane in ["chain", "chainRight"] {
            // Mono source presets omit the optional right lane.
            if lane == "chainRight" && chain.get(lane).is_none() {
                continue;
            }
            let blocks = chain[lane]
                .as_array()
                .ok_or_else(|| NativeError("Missing native chain".into()))?;
            for block in blocks.iter().filter(|b| b["kind"] == "tone") {
                let block_id = block["blockId"]
                    .as_str()
                    .ok_or_else(|| NativeError("Missing native block identity".into()))?;
                let eq = serde_json::from_value(block["params"]["eq"].clone())
                    .map_err(|e| NativeError(format!("Invalid native EQ readback: {e}")))?;
                result.push(crate::protocol::BlockEqState {
                    block_id: block_id.into(),
                    eq,
                });
            }
        }
        Ok(result)
    }
    /// Replay into an isolated prepared/export engine, never a sounding instance.
    /// Validate all targets and values before mutation; on failure discard this candidate.
    /// The caller supplies a token sequence disjoint from its live gestures.
    pub fn restore_eq(
        &mut self,
        states: &[crate::protocol::BlockEqState],
        token: &mut u64,
    ) -> Result<()> {
        use crate::protocol::{BlockEdit, EditPhase, StageAction};
        let current = self.eq_snapshot()?;
        if states.len() != current.len()
            || states.iter().enumerate().any(|(i, state)| {
                current[i].block_id != state.block_id
                    || states[..i].iter().any(|s| s.block_id == state.block_id)
            })
        {
            return Err(NativeError(
                "EQ snapshot does not match native blocks".into(),
            ));
        }
        let mut actions = Vec::new();
        for (block_index, state) in states.iter().enumerate() {
            let previous = &current[block_index].eq;
            for (index, band) in state.eq.bands.iter().enumerate() {
                if previous.bands[index] == *band {
                    continue;
                }
                actions.push(StageAction::BlockEdit {
                    edit: BlockEdit::EqBand {
                        phase: EditPhase::Commit,
                        block_id: state.block_id.clone(),
                        index: index as u8,
                        band: band.clone(),
                    },
                });
            }
            if previous.pre != state.eq.pre {
                actions.push(StageAction::BlockEdit {
                    edit: BlockEdit::EqPre {
                        phase: EditPhase::Commit,
                        block_id: state.block_id.clone(),
                        value: state.eq.pre,
                    },
                });
            }
            if previous.enabled != state.eq.enabled {
                actions.push(StageAction::BlockEdit {
                    edit: BlockEdit::EqEnabled {
                        phase: EditPhase::Commit,
                        block_id: state.block_id.clone(),
                        value: state.eq.enabled,
                    },
                });
            }
        }
        token
            .checked_add(actions.len() as u64)
            .ok_or_else(|| NativeError("Stage token exhausted".into()))?;
        for action in &actions {
            let (_, payload) = action.encode().map_err(NativeError)?;
            if payload.len() > 256 {
                return Err(NativeError("EQ request exceeds envelope".into()));
            }
        }
        for action in actions {
            *token += 1;
            self.stage_submit(*token, &action)?;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                self.pump()?;
                if let Some(reply) = self.stage_read(*token)? {
                    if reply["state"] != "done" {
                        return Err(NativeError(format!("EQ replay failed: {reply}")));
                    }
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    return Err(NativeError("EQ replay timed out".into()));
                }
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
        if self.eq_snapshot()? != states {
            return Err(NativeError("EQ replay readback differs".into()));
        }
        Ok(())
    }
    pub fn catalog(&mut self) -> Result<serde_json::Value> {
        // SAFETY: json supplies a live handle and bounded writable buffer/length.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_catalog(p, b, n, w) })
    }
    pub fn runtime(&mut self) -> Result<serde_json::Value> {
        // SAFETY: same bounded JSON contract.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_runtime(p, b, n, w) })
    }
    pub fn live_controls(&mut self) -> Result<Vec<oxidal_audio::lifecycle::LiveControl>> {
        use oxidal_audio::lifecycle::{LiveControl, valid_controls};
        let parameters: Vec<crate::protocol::Parameter> =
            serde_json::from_value(self.catalog()?).map_err(|e| NativeError(e.to_string()))?;
        let mut controls: Vec<_> = parameters
            .into_iter()
            .filter(|p| {
                crate::protocol::live_writable(&p.id)
                    && match self.role {
                        ProcessingRole::WholePreset => true,
                        ProcessingRole::Amp => {
                            p.id == "inputLevel"
                                || p.id.starts_with("gate")
                                || p.id.starts_with("pitch")
                        }
                        ProcessingRole::Cab => p.id == "outputLevel" || p.id.starts_with("tone"),
                    }
            })
            .map(|p| LiveControl {
                target: p.id.clone(),
                label: parameter_label(&p.id).to_owned(),
                display: parameter_display(&p),
                value: p.normalized as f32,
                toggle: p.toggle,
            })
            .collect();
        controls.extend(
            self.block_controls()?
                .into_iter()
                .filter(|p| !p.staged)
                .map(|p| LiveControl {
                    target: p.id,
                    label: format!("{} · {} · {}", display_title(&p.name), p.lane, p.parameter),
                    value: p.value as f32,
                    toggle: p.step == 1.0,
                    display: if p.step == 1.0 {
                        if p.value == 1.0 {
                            "On".into()
                        } else {
                            "Off".into()
                        }
                    } else if p.parameter == "inputGain" || p.parameter == "outputGain" {
                        format!("{:.1} dB", (p.value - 0.5) * 48.0)
                    } else {
                        format!("{:.1}%", p.value * 100.0)
                    },
                }),
        );
        if !valid_controls(&controls) {
            return Err(NativeError("Invalid live control catalog".into()));
        }
        Ok(controls)
    }
    /// Experimental control-thread operation between PCM steps, not RT-qualified.
    pub fn set_live_control(&mut self, target: &str, value: f32) -> Result<()> {
        let controls = self.live_controls()?;
        let control = controls
            .iter()
            .find(|c| c.target == target)
            .ok_or_else(|| NativeError("Control requires offline or prepared editing".into()))?;
        if !control.accepts(value) {
            return Err(NativeError("Invalid live control value".into()));
        }
        if crate::protocol::live_writable(target) {
            self.set_normalized(target, value)
        } else {
            let block = self
                .block_controls()?
                .into_iter()
                .find(|c| c.id == target)
                .ok_or_else(|| NativeError("Stale native block".into()))?;
            self.set_block(&block.block_id, &block.parameter, value)
        }
    }
    pub fn block_controls(&mut self) -> Result<Vec<crate::protocol::BlockControl>> {
        // SAFETY: json supplies the live owner handle and bounded writable buffer.
        let rows = self.json(|p, b, n, w| unsafe { oxidal_t3k_block_controls(p, b, n, w) })?;
        serde_json::from_value(rows).map_err(|e| NativeError(e.to_string()))
    }
    pub fn set_block(&mut self, id: &str, parameter: &str, value: f32) -> Result<()> {
        let id = string(id)?;
        let parameter = string(parameter)?;
        // SAFETY: both strings and owner handle outlive the call. The native boundary
        // validates identity, control allowlist, finite unit values and exact toggles.
        checked(unsafe {
            oxidal_t3k_set_block(self.ptr.as_ptr(), id.as_ptr(), parameter.as_ptr(), value)
        })
    }
    pub fn set_normalized(&mut self, id: &str, value: f32) -> Result<()> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(NativeError("invalid normalized value".into()));
        }
        let id = string(id)?;
        // SAFETY: handle and NUL-terminated id outlive call; bridge checks parameter identity.
        checked(unsafe { oxidal_t3k_set(self.ptr.as_ptr(), id.as_ptr(), value) })
    }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<()> {
        if left.is_empty() || left.len() != right.len() || left.len() > self.frames {
            return Err(NativeError("invalid stereo buffer lengths".into()));
        }
        // SAFETY: exclusive slices are disjoint, equal-length and bounded by native allocation.
        checked(unsafe {
            oxidal_t3k_process(
                self.ptr.as_ptr(),
                left.as_mut_ptr(),
                right.as_mut_ptr(),
                left.len(),
            )
        })
    }
    pub fn capture(&mut self) -> Result<State> {
        let mut length = 0;
        // SAFETY: null output requests an owned native snapshot and its bounded length.
        checked(unsafe {
            oxidal_t3k_capture(self.ptr.as_ptr(), std::ptr::null_mut(), 0, &mut length)
        })?;
        if length == 0 || length > 32 * 1024 * 1024 {
            return Err(NativeError("invalid native state size".into()));
        }
        let mut bytes = vec![0; length];
        let capacity = length;
        // SAFETY: output is allocated to the captured size; no calls intervene or run concurrently.
        checked(unsafe {
            oxidal_t3k_capture(self.ptr.as_ptr(), bytes.as_mut_ptr(), capacity, &mut length)
        })?;
        if length != capacity {
            return Err(NativeError("native state size changed".into()));
        }
        Ok(State(bytes))
    }
    pub fn restore(&mut self, state: &State) -> Result<()> {
        // SAFETY: State is only constructible from this backend's bounded capture, and lives through call.
        checked(unsafe { oxidal_t3k_restore(self.ptr.as_ptr(), state.0.as_ptr(), state.0.len()) })
    }
    /// Current insertion targets, read from the actual native chain.
    pub fn slots(&mut self) -> Result<Vec<oxidal_audio::lifecycle::NativeSlot>> {
        use oxidal_audio::lifecycle::{NativeSlot, SlotPosition, valid_slots};
        let chain = self.chain()?;
        let mut slots = vec![];
        for (lane, key) in ["chain", "chainRight"].iter().enumerate() {
            if let Some(blocks) = chain[key].as_array() {
                for (index, block) in blocks
                    .iter()
                    .enumerate()
                    .filter(|(_, b)| b["kind"] == "insert")
                {
                    slots.push(NativeSlot {
                        target: block["blockId"]
                            .as_str()
                            .ok_or_else(|| NativeError("Missing native slot identity".into()))?
                            .into(),
                        position: SlotPosition {
                            lane: lane as u8,
                            index: index as u32,
                        },
                    });
                }
            }
        }
        if !valid_slots(&slots) {
            return Err(NativeError("Native insertion catalog invalid".into()));
        }
        Ok(slots)
    }
    /// Restore a recorded insertion coordinate on an isolated owner before PCM.
    pub fn restore_slot(
        &mut self,
        target: &str,
        position: &oxidal_audio::lifecycle::SlotPosition,
    ) -> Result<()> {
        if !position.valid() {
            return Err(NativeError("Invalid insertion coordinate".into()));
        }
        let target = string(target)?;
        // SAFETY: live uniquely owned handle and string; native boundary checks slot and identity.
        checked(unsafe {
            oxidal_t3k_restore_slot(
                self.ptr.as_ptr(),
                target.as_ptr(),
                position.lane.into(),
                position.index as i32,
            )
        })
    }
    /// Create an empty native working chain on an isolated preparation owner.
    /// Preset-scoped parameters reset; machine/device settings retain their scope.
    /// This whole-chain operation must not run on an active PCM owner.
    pub fn reset_empty(&mut self) -> Result<()> {
        // SAFETY: this Engine has unique thread ownership; the ABI checks preparation state.
        checked(unsafe { oxidal_t3k_reset_empty(self.ptr.as_ptr()) })?;
        self.wait_ready()
    }
    pub fn load_preset(&mut self, bytes: &[u8]) -> Result<()> {
        oxidal_presets::inspect(bytes).map_err(|e| NativeError(e.to_string()))?;
        // SAFETY: structurally validated, bounded bytes remain live for this synchronous call.
        checked(unsafe { oxidal_t3k_load_preset(self.ptr.as_ptr(), bytes.as_ptr(), bytes.len()) })
    }
    /// Reconstruct only a complete, confirmed scalar catalog on an isolated engine.
    /// This does not transfer transient delay buffers or general graph state.
    pub fn apply_live_snapshot(
        &mut self,
        controls: &[oxidal_audio::lifecycle::LiveControl],
    ) -> Result<()> {
        let actual = self.live_controls()?;
        let missing: Vec<_> = actual
            .iter()
            .filter(|a| !controls.iter().any(|c| c.target == a.target))
            .map(|a| a.target.as_str())
            .collect();
        if !oxidal_audio::lifecycle::valid_controls(controls)
            || !crate::protocol::legacy_image_gap(&missing)
            || controls.iter().any(|c| {
                !actual
                    .iter()
                    .any(|a| a.target == c.target && a.toggle == c.toggle && a.accepts(c.value))
            })
        {
            return Err(NativeError(
                "Live control catalog does not match source preset".into(),
            ));
        }
        // The full catalog is already validated above. Re-reading/serializing it
        // for every field makes large-chain recovery quadratic in JSON traffic.
        // Reuse the owned block descriptors and only write changed values.
        let blocks = self.block_controls()?;
        for control in controls {
            if actual
                .iter()
                .any(|a| a.target == control.target && a.value == control.value)
            {
                continue;
            }
            if crate::protocol::live_writable(&control.target) {
                self.set_normalized(&control.target, control.value)?;
            } else {
                let block = blocks
                    .iter()
                    .find(|b| b.id == control.target)
                    .ok_or_else(|| NativeError("Stale native replay block".into()))?;
                self.set_block(&block.block_id, &block.parameter, control.value)?;
            }
        }
        let restored = self.live_controls()?;
        if controls.iter().any(|c| {
            !restored
                .iter()
                .any(|a| a.target == c.target && (a.value - c.value).abs() < 1e-5)
        }) {
            return Err(NativeError(
                "Live control reconstruction did not match".into(),
            ));
        }
        Ok(())
    }
    pub fn save_preset(&mut self, name: &str) -> Result<Vec<u8>> {
        if name.trim().is_empty() || name.len() > 100 || name.chars().any(char::is_control) {
            return Err(NativeError(
                "Name must contain 1–100 bytes without control characters".into(),
            ));
        }
        let name = string(name.trim())?;
        let mut length = 0;
        // SAFETY: null buffer requests one native snapshot into its private buffer.
        checked(unsafe {
            oxidal_t3k_save_preset(
                self.ptr.as_ptr(),
                name.as_ptr(),
                std::ptr::null_mut(),
                0,
                &mut length,
            )
        })?;
        if length == 0 || length > oxidal_presets::MAX_FILE_BYTES {
            return Err(NativeError("invalid preset size".into()));
        }
        let mut bytes = vec![0; length];
        let capacity = length;
        // SAFETY: live unique handle, output sized by the immediately preceding capture.
        checked(unsafe {
            oxidal_t3k_save_preset(
                self.ptr.as_ptr(),
                name.as_ptr(),
                bytes.as_mut_ptr(),
                capacity,
                &mut length,
            )
        })?;
        if length != capacity {
            return Err(NativeError("preset size changed".into()));
        }
        oxidal_presets::inspect(&bytes).map_err(|e| NativeError(e.to_string()))?;
        Ok(bytes)
    }
    /// Pump queued loaders and process silent offline blocks until every native block is ready.
    /// No readiness claim is based on a fixed delay alone.
    pub fn wait_ready(&mut self) -> Result<()> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            self.pump()?;
            self.process(&mut vec![0.0; self.frames], &mut vec![0.0; self.frames])?;
            let state = self.runtime()?;
            let blocks = state["blocks"]
                .as_array()
                .ok_or_else(|| NativeError("missing runtime blocks".into()))?;
            if state["truncated"] == true || blocks.iter().any(|b| b["loadFailed"] == true) {
                return Err(NativeError(
                    "native load failed or runtime exceeded bounds".into(),
                ));
            }
            if blocks
                .iter()
                .all(|b| b["loaded"] == true && b["modelLoading"] != true)
            {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(NativeError("native readiness timeout".into()));
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    pub fn pump(&mut self) -> Result<()> {
        // SAFETY: !Send/!Sync and exclusive borrow retain owner-thread message dispatch.
        checked(unsafe { oxidal_t3k_pump(self.ptr.as_ptr()) })
    }
    /// Start parsing/prewarming away from the DSP owner. No chain mutation until commit.
    pub fn prepare_model(
        &mut self,
        target: &str,
        path: &std::path::Path,
        tone: &serde_json::Value,
    ) -> Result<()> {
        if target.is_empty() || target.len() > 128 || !path.is_absolute() || !path.is_file() {
            return Err(NativeError(
                "Invalid model preparation target or path".into(),
            ));
        }
        let metadata = serde_json::to_string(tone)
            .map_err(|_| NativeError("Invalid model metadata".into()))?;
        if metadata.len() > 32768 {
            return Err(NativeError("Model metadata exceeds limit".into()));
        }
        // Admission precedes candidate preparation/commit. Reserve worst-case
        // control labels and native JSON expansion for this additional block.
        let mut controls = self.live_controls()?;
        for i in 0..5 {
            controls.push(oxidal_audio::lifecycle::LiveControl {
                target: format!("admission:{i}:{}", "x".repeat(160)),
                label: "x".repeat(256),
                display: "x".repeat(128),
                value: 0.5,
                toggle: false,
            });
        }
        let chain = serde_json::to_vec(&self.chain()?).map_err(|e| NativeError(e.to_string()))?;
        let eq = self.eq_snapshot()?;
        let eq_bytes = serde_json::to_vec(&eq)
            .map_err(|e| NativeError(e.to_string()))?
            .len();
        if !oxidal_audio::lifecycle::catalog_fits(&controls)
            || eq_bytes + 8192 > oxidal_audio::lifecycle::CATALOG_BYTES
            || chain
                .len()
                .saturating_add(metadata.len().saturating_mul(8))
                .saturating_add(65536)
                > oxidal_audio::lifecycle::PLAYBACK_FRAME_BYTES
        {
            return Err(NativeError(
                "Model exceeds the available control-state byte budget; previous sound retained"
                    .into(),
            ));
        }
        let target = string(target)?;
        let path = string(
            path.to_str()
                .ok_or_else(|| NativeError("Non-UTF8 path".into()))?,
        )?;
        let metadata = string(&metadata)?;
        // SAFETY: owner-thread handle and live NUL-terminated strings; native copies before returning.
        checked(unsafe {
            oxidal_t3k_prepare_model(
                self.ptr.as_ptr(),
                target.as_ptr(),
                path.as_ptr(),
                metadata.as_ptr(),
            )
        })
    }
    /// Poll, commit (1), or cancel (2) the pending preparation. Commit uses a native
    /// wet-mute splice; this is not a prepared gapless engine crossfade.
    pub fn model_preparation(&mut self, action: i32) -> Result<serde_json::Value> {
        if !(0..=2).contains(&action) {
            return Err(NativeError("Invalid preparation action".into()));
        }
        // SAFETY: same bounded JSON contract and exclusive owner as other adapter calls.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_preparation(p, action, b, n, w) })
    }
    pub fn load_local_model(&mut self, path: &std::path::Path) -> Result<serde_json::Value> {
        if !path.is_absolute() || !path.is_file() {
            return Err(NativeError(
                "model path must be an existing absolute file".into(),
            ));
        }
        let path = string(
            path.to_str()
                .ok_or_else(|| NativeError("non-UTF8 path".into()))?,
        )?;
        // SAFETY: bounded JSON contract; path remains live during native call.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_load_model(p, path.as_ptr(), b, n, w) })
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: unique handle has not been destroyed; !Send prevents cross-thread destruction.
        if unsafe { oxidal_t3k_destroy(self.ptr.as_ptr()) } != 0 {
            // Never continue with a half-destroyed native processor.
            std::process::abort();
        }
    }
}

// Keep the control label within its byte contract while retaining full model
// metadata in the native preset. UTF-8 titles must not fail after model commit.
fn display_title(name: &str) -> &str {
    let mut end = name.len().min(128);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

// Physical presentation follows the pinned processor and native KnobScale.h;
// values sent to DSP remain normalized, never double-converted.
pub(crate) fn parameter_label(id: &str) -> &str {
    match id {
        "inputLevel" => "Input level",
        "outputLevel" => "Output level",
        "outputBalance" => "Stereo balance",
        "spreadEnabled" => "Spread",
        "spreadOffset" => "Spread offset",
        "spreadWobble" => "Wobble depth",
        "spreadWobbleEnabled" => "Wobble",
        "spreadCrossover" => "Crossover frequency",
        "spreadCrossoverEnabled" => "Low-band protection",
        "spreadDiffuseEnabled" => "Diffusion",
        "alignEnabled" => "Alignment",
        "alignOffset" => "Alignment offset",
        "alignWobble" => "Alignment wobble depth",
        "alignWobbleEnabled" => "Alignment wobble",
        "alignCrossover" => "Alignment crossover",
        "alignCrossoverEnabled" => "Alignment low-band protection",
        "alignDiffuseEnabled" => "Alignment diffusion",
        "chainPanLeft" => "Left chain pan",
        "chainPanRight" => "Right chain pan",
        "chainPanLinked" => "Link chain pans",
        "chainInvertLeft" => "Left polarity inversion",
        "chainInvertRight" => "Right polarity inversion",
        "pitchEnabled" => "Pitch shift",
        "pitchSemitones" => "Pitch shift amount",
        "pitchStep" => "Whole semitones",
        "pitchTonality" => "Pitch tonality",
        "pitchWindow" => "Pitch window",
        "toneBass" => "Bass",
        "toneMid" => "Middle",
        "toneTreble" => "Treble",
        "toneEqEnabled" => "Tone stack",
        "gateEnabled" => "Noise gate",
        "gateThreshold" => "Gate threshold",
        "gateRelease" => "Gate release",
        "gateHold" => "Gate hold",
        "gateRange" => "Gate depth",
        "inputCalibrationLevel" => "Input calibration",
        "osEnabled" => "Oversampling",
        "osFactor" => "Oversampling factor",
        _ => id,
    }
}
pub(crate) fn parameter_display(p: &crate::protocol::Parameter) -> String {
    if p.toggle {
        return if p.value == 0.0 {
            "Off".into()
        } else {
            "On".into()
        };
    }
    match p.id.as_str() {
        "inputLevel" | "outputLevel" => format!("{:.1} dB", (p.normalized - 0.5) * 48.0),
        "outputBalance" => format!("{:.1} dB", (p.normalized - 0.5) * 24.0),
        "spreadOffset" | "alignOffset" => {
            let ms = (p.normalized - 0.5) * 48.0;
            if ms.abs() < 0.05 {
                "0 ms".into()
            } else {
                format!("{:.1} ms {}", ms.abs(), if ms < 0.0 { "L" } else { "R" })
            }
        }
        "spreadWobble" | "alignWobble" => format!("{:.0}%", p.normalized * 100.0),
        "spreadCrossover" | "alignCrossover" => {
            format!("{:.0} Hz", 32.5 * 16.0_f64.powf(p.normalized))
        }
        "chainPanLeft" | "chainPanRight" => {
            let position = p.normalized - 0.5;
            if position.abs() < 0.0001 {
                "Center".into()
            } else {
                format!(
                    "{:.0}% {}",
                    position.abs() * 200.0,
                    if position < 0.0 { "L" } else { "R" }
                )
            }
        }
        "pitchSemitones" => format!("{:+.1} st", p.value),
        "pitchTonality" => {
            if p.value >= 19999.0 {
                "Off".into()
            } else {
                format!("{:.0} Hz", p.value)
            }
        }
        "gateThreshold" | "gateRange" => format!("{:.1} dB", p.value),
        "gateRelease" | "gateHold" => format!("{:.1} ms", p.value),
        "toneBass" | "toneMid" | "toneTreble" => format!("{:.1}", p.value),
        _ => p.display.clone(),
    }
}
