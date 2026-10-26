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
    fn oxidal_t3k_destroy(engine: *mut c_void) -> i32;
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

/// Opaque state captured by this backend, not arbitrary imported bytes.
#[derive(Clone, Debug)]
pub struct State(Vec<u8>);
impl State {
    pub fn byte_len(&self) -> usize {
        self.0.len()
    }
}

/// Single-owner offline processor. !Send/!Sync keeps JUCE calls and destruction on its owner thread.
/// This is not a real-time-safe or live ALSA interface.
#[derive(Debug)]
pub struct Engine {
    ptr: NonNull<c_void>,
    frames: usize,
    owner: PhantomData<Rc<()>>,
}
impl Engine {
    pub fn new(rate: f64, frames: usize) -> Result<Self> {
        if !rate.is_finite()
            || !(8000.0..=192000.0).contains(&rate)
            || !(1..=2048).contains(&frames)
        {
            return Err(NativeError("invalid audio configuration".into()));
        }
        let mut ptr = std::ptr::null_mut();
        // SAFETY: out pointer is live; native validates configuration and constructs one owned handle.
        checked(unsafe { oxidal_t3k_create(rate, frames as i32, &mut ptr) })?;
        Ok(Self {
            ptr: NonNull::new(ptr).ok_or_else(|| NativeError("null native result".into()))?,
            frames,
            owner: PhantomData,
        })
    }
    fn json(
        &mut self,
        call: impl FnOnce(*mut c_void, *mut c_char, usize, *mut usize) -> i32,
    ) -> Result<serde_json::Value> {
        let mut buffer = vec![0u8; 256 * 1024];
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
    pub fn catalog(&mut self) -> Result<serde_json::Value> {
        // SAFETY: json supplies a live handle and bounded writable buffer/length.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_catalog(p, b, n, w) })
    }
    pub fn runtime(&mut self) -> Result<serde_json::Value> {
        // SAFETY: same bounded JSON contract.
        self.json(|p, b, n, w| unsafe { oxidal_t3k_runtime(p, b, n, w) })
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
    pub fn load_preset(&mut self, bytes: &[u8]) -> Result<()> {
        oxidal_presets::inspect(bytes).map_err(|e| NativeError(e.to_string()))?;
        // SAFETY: structurally validated, bounded bytes remain live for this synchronous call.
        checked(unsafe { oxidal_t3k_load_preset(self.ptr.as_ptr(), bytes.as_ptr(), bytes.len()) })
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
