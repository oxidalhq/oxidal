use crate::{PluginInfo, Port};
use std::{
    ffi::{CStr, CString, c_char, c_void},
    path::Path,
    ptr::NonNull,
    rc::Rc,
};
unsafe extern "C" {
    fn ox_lv2_error() -> *const c_char;
    fn ox_lv2_world(bundle: *const c_char) -> *mut c_void;
    fn ox_lv2_world_free(w: *mut c_void);
    fn ox_lv2_count(w: *mut c_void) -> u32;
    fn ox_lv2_plugin(w: *mut c_void, index: u32) -> *const c_void;
    fn ox_lv2_uri(p: *const c_void) -> *const c_char;
    fn ox_lv2_name(p: *const c_void) -> *const c_char;
    fn ox_lv2_ports(p: *const c_void) -> u32;
    fn ox_lv2_symbol(p: *const c_void, index: u32) -> *const c_char;
    fn ox_lv2_port(
        w: *mut c_void,
        p: *const c_void,
        index: u32,
        d: *mut f32,
        lo: *mut f32,
        hi: *mut f32,
    ) -> i32;
    fn ox_lv2_supported(w: *mut c_void, p: *const c_void) -> i32;
    fn ox_lv2_new(w: *mut c_void, p: *const c_void, rate: f64, frames: u32) -> *mut c_void;
    fn ox_lv2_free(h: *mut c_void);
    fn ox_lv2_set(h: *mut c_void, port: u32, value: f32);
    fn ox_lv2_get(h: *mut c_void, port: u32) -> f32;
    fn ox_lv2_run(h: *mut c_void, l: *mut f32, r: *mut f32, frames: u32) -> i32;
}
fn text(p: *const c_char) -> Result<String, String> {
    if p.is_null() {
        return Err("Missing native string".into());
    }
    // SAFETY: all callers pass a native-owned terminated string valid until the next FFI call.
    let s = unsafe { CStr::from_ptr(p) }
        .to_str()
        .map_err(|_| "Invalid native UTF-8")?;
    if s.len() > 4096 {
        return Err("Native string too long".into());
    }
    Ok(s.to_owned())
}
fn error() -> String {
    // SAFETY: static thread-local terminated buffer, copied before any subsequent FFI call.
    text(unsafe { ox_lv2_error() }).unwrap_or_else(|_| "LV2 operation failed".into())
}
#[derive(Debug)]
struct Inner(NonNull<c_void>);
impl Drop for Inner {
    fn drop(&mut self) {
        // SAFETY: Rc keeps the world alive until every instance has been freed.
        unsafe { ox_lv2_world_free(self.0.as_ptr()) };
    }
}
/// Non-Send/Sync: discovery, preparation, processing and destruction share one owner.
#[derive(Debug, Clone)]
pub struct World(Rc<Inner>);
impl World {
    pub fn discover() -> Result<Self, String> {
        Self::open(None)
    }
    pub fn bundle(path: &Path) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path.is_dir() {
            return Err("Bundle must be a directory".into());
        }
        let path = CString::new(format!(
            "{}/",
            path.to_str().ok_or("Bundle path must be UTF-8")?
        ))
        .map_err(|_| "Invalid bundle path")?;
        Self::open(Some(&path))
    }
    fn open(path: Option<&CString>) -> Result<Self, String> {
        // SAFETY: optional string outlives this call; C constructs a fresh owned world.
        let ptr = unsafe { ox_lv2_world(path.map_or(std::ptr::null(), |p| p.as_ptr())) };
        Ok(Self(Rc::new(Inner(NonNull::new(ptr).ok_or_else(error)?))))
    }
    fn handles(&self) -> Result<Vec<*const c_void>, String> {
        // SAFETY: world is live on its owner thread; returned plugin pointers borrow it.
        let count = unsafe { ox_lv2_count(self.0.0.as_ptr()) };
        if count > 4096 {
            return Err("Plugin discovery limit exceeded".into());
        }
        (0..count)
            .map(|i| {
                // SAFETY: i is in the native collection bounds, world outlives pointer.
                let p = unsafe { ox_lv2_plugin(self.0.0.as_ptr(), i) };
                if p.is_null() {
                    Err("Plugin disappeared".into())
                } else {
                    Ok(p)
                }
            })
            .collect()
    }
    pub fn plugins(&self, rate: f64) -> Result<Vec<PluginInfo>, String> {
        self.handles()?
            .into_iter()
            .map(|p| self.describe(p, rate))
            .collect()
    }
    fn describe(&self, p: *const c_void, rate: f64) -> Result<PluginInfo, String> {
        if !rate.is_finite() || !(8000.0..=192000.0).contains(&rate) {
            return Err("Invalid sample rate".into());
        }
        // SAFETY: p came from this world's live plugin collection; metadata is read-only.
        let (uri, count, supported) = unsafe {
            (
                text(ox_lv2_uri(p))?,
                ox_lv2_ports(p),
                ox_lv2_supported(self.0.0.as_ptr(), p),
            )
        };
        let mut unsupported = (supported != 0).then(error);
        // SAFETY: p borrows this live world; immediately copy the native name.
        let name = unsafe { text(ox_lv2_name(p)) }.unwrap_or_else(|_| uri.clone());
        if !(1..=128).contains(&count) {
            return Ok(PluginInfo {
                name,
                uri,
                ports: vec![],
                unsupported: Some("Port count outside 1–128".into()),
            });
        }
        let mut ports = Vec::new();
        for i in 0..count {
            let (mut d, mut lo, mut hi) = (0.0, 0.0, 0.0);
            // SAFETY: validated index and writable out scalars; strings copied while world is live.
            let (f, symbol) = unsafe {
                (
                    ox_lv2_port(self.0.0.as_ptr(), p, i, &mut d, &mut lo, &mut hi),
                    text(ox_lv2_symbol(p, i))?,
                )
            };
            if f < 0 {
                return Err(error());
            }
            if f & 64 != 0 {
                d *= rate as f32;
                lo *= rate as f32;
                hi *= rate as f32;
            }
            let port = Port {
                index: i,
                symbol,
                audio: f & 1 != 0,
                control: f & 2 != 0,
                input: f & 4 != 0,
                output: f & 8 != 0,
                integer: f & 16 != 0,
                toggled: f & 32 != 0,
                logarithmic: f & 128 != 0,
                latency: f & 256 != 0,
                minimum: lo.is_finite().then_some(lo),
                maximum: hi.is_finite().then_some(hi),
                default: d.is_finite().then_some(d),
            };
            if port.audio == port.control || port.input == port.output || port.latency {
                unsupported = Some("Unsupported port class, direction or latency".into());
            }
            if port.control
                && port.input
                && (port.range().is_err()
                    || port.default.is_none_or(|d| port.normalize(d).is_err()))
            {
                unsupported = Some("Unsupported bounded control metadata".into());
            }
            ports.push(port);
        }
        let ins = ports.iter().filter(|p| p.audio && p.input).count();
        let outs = ports.iter().filter(|p| p.audio && p.output).count();
        if ins != outs || !(1..=2).contains(&ins) {
            unsupported = Some("Require mono/mono or stereo/stereo audio".into());
        }
        Ok(PluginInfo {
            name,
            uri,
            ports,
            unsupported,
        })
    }
}
#[derive(Debug)]
struct Instance {
    ptr: NonNull<c_void>,
    _world: World,
}
impl Instance {
    fn new(world: &World, p: *const c_void, rate: f64, frames: u32) -> Result<Self, String> {
        // SAFETY: plugin belongs to world; C validates frame/rate and owns all connected buffers/features.
        let ptr = unsafe { ox_lv2_new(world.0.0.as_ptr(), p, rate, frames) };
        Ok(Self {
            ptr: NonNull::new(ptr).ok_or_else(error)?,
            _world: world.clone(),
        })
    }
}
impl Drop for Instance {
    fn drop(&mut self) {
        // SAFETY: sole instance owner; C deactivates/frees before World field drops.
        unsafe { ox_lv2_free(self.ptr.as_ptr()) };
    }
}
/// Prepared stereo processor. Mono effects use two independent instances, preserving stereo history.
#[derive(Debug)]
pub struct Plugin {
    left: Instance,
    right: Option<Instance>,
    info: PluginInfo,
    frames: usize,
    rate: f64,
    failed: bool,
    channels: usize,
}
impl Plugin {
    pub fn configuration(&self) -> (f64, usize) {
        (self.rate, self.frames)
    }
    pub fn info(&self) -> &PluginInfo {
        &self.info
    }
    /// Compatibility stereo host: mono plugins use two independent instances.
    pub fn new(world: &World, uri: &str, rate: f64, frames: usize) -> Result<Self, String> {
        Self::instantiate(world, uri, rate, frames, true)
    }
    /// Match the discovered audio ports exactly. A mono plugin owns one instance
    /// and must be called through process_mono; no hidden stereo duplication.
    pub fn new_ports(world: &World, uri: &str, rate: f64, frames: usize) -> Result<Self, String> {
        Self::instantiate(world, uri, rate, frames, false)
    }
    pub fn channels(&self) -> usize {
        self.channels
    }
    fn instantiate(
        world: &World,
        uri: &str,
        rate: f64,
        frames: usize,
        stereo: bool,
    ) -> Result<Self, String> {
        if frames == 0 || frames > 2048 || !frames.is_power_of_two() {
            return Err("Require fixed power-of-two frames 1–2048".into());
        }
        for p in world.handles()? {
            let info = world.describe(p, rate)?;
            if info.uri != uri {
                continue;
            }
            if let Some(reason) = &info.unsupported {
                return Err(reason.clone());
            }
            let mono = info.ports.iter().filter(|p| p.audio && p.input).count() == 1;
            return Ok(Self {
                left: Instance::new(world, p, rate, frames as u32)?,
                right: if mono && stereo {
                    Some(Instance::new(world, p, rate, frames as u32)?)
                } else {
                    None
                },
                info,
                frames,
                rate,
                failed: false,
                channels: if mono && !stereo { 1 } else { 2 },
            });
        }
        Err("LV2 URI not discovered".into())
    }
    pub fn set(&mut self, index: u32, value: f32) -> Result<f32, String> {
        if self.failed {
            return Err("Failed plugin must be recreated".into());
        }
        let p = self.info.ports.get(index as usize).ok_or("Unknown port")?;
        p.normalize(value)?;
        if (p.integer && value.fract() != 0.0)
            || (p.toggled && Some(value) != p.minimum && Some(value) != p.maximum)
        {
            return Err("Expected discrete native value".into());
        }
        // SAFETY: index identifies a connected input control; finite range checked. Exclusive mutable owner.
        unsafe {
            ox_lv2_set(self.left.ptr.as_ptr(), index, value);
            if let Some(r) = &self.right {
                ox_lv2_set(r.ptr.as_ptr(), index, value);
            }
        }
        self.value(index)
    }
    pub fn value(&self, index: u32) -> Result<f32, String> {
        if !self
            .info
            .ports
            .get(index as usize)
            .is_some_and(|p| p.control)
        {
            return Err("Not a control port".into());
        }
        // SAFETY: valid connected scalar port, instance live on owner thread.
        let v = unsafe { ox_lv2_get(self.left.ptr.as_ptr(), index) };
        if v.is_finite() {
            Ok(v)
        } else {
            Err("Nonfinite control output".into())
        }
    }
    pub fn process_mono(&mut self, samples: &mut [f32]) -> Result<(), String> {
        if self.failed {
            samples.fill(0.0);
            return Err("Failed plugin must be recreated".into());
        }
        if self.channels != 1
            || samples.len() != self.frames
            || samples.iter().any(|v| !v.is_finite())
        {
            samples.fill(0.0);
            return Err("Invalid fixed mono buffer or plugin layout".into());
        }
        // SAFETY: new_ports admitted exactly one input/output port and no right
        // instance. The C bridge never dereferences right for this mono layout;
        // samples is exclusive, finite, and has the instantiated frame count.
        let status = unsafe {
            ox_lv2_run(
                self.left.ptr.as_ptr(),
                samples.as_mut_ptr(),
                std::ptr::null_mut(),
                self.frames as u32,
            )
        };
        if status != 0 {
            self.failed = true;
            samples.fill(0.0);
            return Err(error());
        }
        Ok(())
    }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<(), String> {
        if self.failed {
            return Err("Failed plugin must be recreated".into());
        }
        if self.channels != 2
            || left.len() != self.frames
            || right.len() != self.frames
            || left.iter().chain(right.iter()).any(|x| !x.is_finite())
        {
            return Err("Invalid fixed stereo buffer".into());
        }
        // SAFETY: both slices are exclusive, live, and exact declared size. C owns stable port buffers.
        let first = unsafe {
            ox_lv2_run(
                self.left.ptr.as_ptr(),
                left.as_mut_ptr(),
                right.as_mut_ptr(),
                self.frames as u32,
            )
        };
        let second = if first == 0 {
            if let Some(r) = &self.right {
                // SAFETY: mono run reads/writes only its left argument. Distinct slices remain live.
                unsafe {
                    ox_lv2_run(
                        r.ptr.as_ptr(),
                        right.as_mut_ptr(),
                        left.as_mut_ptr(),
                        self.frames as u32,
                    )
                }
            } else {
                0
            }
        } else {
            first
        };
        if second != 0 {
            self.failed = true;
            left.fill(0.0);
            right.fill(0.0);
            Err(error())
        } else {
            Ok(())
        }
    }
}
