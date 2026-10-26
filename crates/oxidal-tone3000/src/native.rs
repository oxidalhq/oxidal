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
