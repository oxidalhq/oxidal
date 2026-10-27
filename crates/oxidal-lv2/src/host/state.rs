//! Owner-only state capture/restore. No raw URIDs or ambient paths are persisted.
use super::{Plugin, error, ox_lv2_unmap, text};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    ffi::{CString, c_char, c_void},
    path::PathBuf,
};
const ATOM: &str = "http://lv2plug.in/ns/ext/atom#";
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StateProperty {
    pub key: String,
    pub type_uri: String,
    /// POD bytes with numeric Atom values in little-endian order; atom:URID
    /// is encoded as its NUL-terminated URI instead.
    pub data: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PluginState {
    pub version: u32,
    pub plugin_uri: String,
    pub properties: Vec<StateProperty>,
}
/// An approved, existing asset. The caller owns its lifetime and content checks.
#[derive(Debug, Clone)]
pub struct StatePath {
    pub absolute: PathBuf,
    pub alias: String,
}
#[repr(C)]
struct NativePath {
    absolute: *const c_char,
    alias: *const c_char,
}
type Store = unsafe extern "C" fn(*mut c_void, u32, *const c_void, usize, u32, u32) -> u32;
type Retrieve =
    unsafe extern "C" fn(*mut c_void, u32, *mut usize, *mut u32, *mut u32) -> *const c_void;
unsafe extern "C" {
    fn ox_lv2_has_state(h: *mut c_void) -> i32;
    fn ox_lv2_state(
        h: *mut c_void,
        restore: i32,
        store: Option<Store>,
        retrieve: Option<Retrieve>,
        context: *mut c_void,
        paths: *const NativePath,
        count: u32,
    ) -> i32;
}
struct Paths {
    _strings: Vec<(CString, CString)>,
    native: Vec<NativePath>,
    aliases: BTreeSet<String>,
}
fn alias_valid(alias: &str) -> bool {
    !alias.is_empty()
        && alias.len() <= 4096
        && !alias.contains(['\\', ':'])
        && !alias.contains(char::is_control)
        && alias
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
impl Paths {
    fn new(paths: &[StatePath]) -> Result<Self, String> {
        if paths.len() > 256 {
            return Err("Too many state path mappings".into());
        }
        let mut aliases = BTreeSet::new();
        let mut absolute = BTreeSet::new();
        let mut strings = Vec::new();
        for path in paths {
            if !alias_valid(&path.alias)
                || !aliases.insert(path.alias.clone())
                || !path.absolute.is_absolute()
            {
                return Err("Invalid or duplicate state path mapping".into());
            }
            let canonical = path
                .absolute
                .canonicalize()
                .map_err(|_| "State asset is missing")?;
            if !canonical.is_file()
                || canonical != path.absolute
                || !absolute.insert(canonical.clone())
            {
                return Err("State assets need unique canonical file paths".into());
            }
            let name = canonical.to_str().ok_or("State path is not UTF-8")?;
            strings.push((
                CString::new(name).map_err(|_| "Invalid state path")?,
                CString::new(path.alias.as_str()).map_err(|_| "Invalid state alias")?,
            ));
        }
        let native = strings
            .iter()
            .map(|(absolute, alias)| NativePath {
                absolute: absolute.as_ptr(),
                alias: alias.as_ptr(),
            })
            .collect();
        Ok(Self {
            _strings: strings,
            native,
            aliases,
        })
    }
}
fn string(data: &[u8]) -> Result<&str, String> {
    std::ffi::CStr::from_bytes_with_nul(data)
        .map_err(|_| "State string must have one terminator")?
        .to_str()
        .map_err(|_| "State string is not UTF-8".into())
}
fn uri_valid(uri: &str) -> bool {
    !uri.is_empty() && uri.len() < 256 && !uri.contains(char::is_control)
}
fn numeric_bytes(type_uri: &str, data: &[u8], saving: bool) -> Vec<u8> {
    match type_uri.strip_prefix(ATOM) {
        Some("Float" | "Int" | "Bool") if data.len() == 4 => {
            let bytes = [data[0], data[1], data[2], data[3]];
            if saving {
                u32::from_ne_bytes(bytes).to_le_bytes().to_vec()
            } else {
                u32::from_le_bytes(bytes).to_ne_bytes().to_vec()
            }
        }
        Some("Double" | "Long") if data.len() == 8 => {
            let bytes = [
                data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
            ];
            if saving {
                u64::from_ne_bytes(bytes).to_le_bytes().to_vec()
            } else {
                u64::from_le_bytes(bytes).to_ne_bytes().to_vec()
            }
        }
        _ => data.to_vec(),
    }
}
fn validate_property(property: &StateProperty, paths: &Paths) -> Result<(), String> {
    if !uri_valid(&property.key)
        || !uri_valid(&property.type_uri)
        || property.data.is_empty()
        || property.data.len() > MAX_BYTES
    {
        return Err("Invalid state property bounds".into());
    }
    if let Some(kind) = property.type_uri.strip_prefix(ATOM) {
        let valid = match kind {
            "String" | "URI" => string(&property.data).is_ok(),
            "URID" => string(&property.data).is_ok_and(uri_valid),
            "Path" => {
                string(&property.data).is_ok_and(|s| s.is_empty() || paths.aliases.contains(s))
            }
            "Int" | "Bool" | "Float" => property.data.len() == 4,
            "Long" | "Double" => property.data.len() == 8,
            "Chunk" => true,
            // Structured Atom bodies contain local URIDs. Do not persist them as
            // supposedly portable opaque bytes without a recursive codec.
            _ => false,
        };
        if !valid {
            return Err("Unsupported or malformed state Atom value".into());
        }
    }
    Ok(())
}
struct Capture<'a> {
    host: *mut c_void,
    paths: &'a Paths,
    properties: Vec<StateProperty>,
    bytes: usize,
    failure: Option<String>,
}
unsafe extern "C" fn store(
    raw: *mut c_void,
    key: u32,
    value: *const c_void,
    size: usize,
    type_id: u32,
    flags: u32,
) -> u32 {
    // SAFETY: C invokes synchronously with the unique Capture borrow supplied by save_state.
    let c = unsafe { &mut *raw.cast::<Capture<'_>>() };
    let result = (|| {
        if flags & 3 != 3
            || flags & 4 != 0
            || value.is_null()
            || size == 0
            || size > MAX_BYTES.saturating_sub(c.bytes)
            || c.properties.len() >= 256
        {
            return Err("State requires bounded portable POD properties".into());
        }
        // SAFETY: callback payload is readable for size bytes during this call;
        // URID lookup returns stable host strings which are copied immediately.
        let mut property = unsafe {
            StateProperty {
                key: text(ox_lv2_unmap(c.host, key))?,
                type_uri: text(ox_lv2_unmap(c.host, type_id))?,
                data: std::slice::from_raw_parts(value.cast::<u8>(), size).to_vec(),
            }
        };
        if property.type_uri == format!("{ATOM}URID") {
            let bytes: [u8; 4] = property
                .data
                .as_slice()
                .try_into()
                .map_err(|_| "Invalid state URID")?;
            // SAFETY: same live host map; unknown IDs return null and are rejected.
            let uri = unsafe { text(ox_lv2_unmap(c.host, u32::from_ne_bytes(bytes)))? };
            property.data = CString::new(uri)
                .map_err(|_| "Invalid state URI")?
                .into_bytes_with_nul();
        }
        property.data = numeric_bytes(&property.type_uri, &property.data, true);
        validate_property(&property, c.paths)?;
        if c.properties.iter().any(|old| old.key == property.key) {
            return Err("Duplicate state property".into());
        }
        if property.data.len() > MAX_BYTES.saturating_sub(c.bytes) {
            return Err("State byte budget exceeded".into());
        }
        c.bytes += property.data.len();
        c.properties.push(property);
        Ok(())
    })();
    if let Err(reason) = result {
        c.failure = Some(reason);
        return 2;
    }
    0
}
struct NativeProperty {
    key: u32,
    type_id: u32,
    data: Vec<u8>,
}
unsafe extern "C" fn retrieve(
    raw: *mut c_void,
    key: u32,
    size: *mut usize,
    type_id: *mut u32,
    flags: *mut u32,
) -> *const c_void {
    // SAFETY: restore owns these immutable property buffers until C returns.
    let properties = unsafe { &*raw.cast::<Vec<NativeProperty>>() };
    if let Some(p) = properties.iter().find(|p| p.key == key) {
        // SAFETY: non-null LV2 out arguments are writable; each output is optional.
        unsafe {
            if !size.is_null() {
                *size = p.data.len();
            }
            if !type_id.is_null() {
                *type_id = p.type_id;
            }
            if !flags.is_null() {
                *flags = 3;
            }
        }
        p.data.as_ptr().cast()
    } else {
        std::ptr::null()
    }
}
impl Plugin {
    pub fn has_state(&self) -> bool {
        // SAFETY: instance and extension data remain owned by self.
        unsafe { ox_lv2_has_state(self.left.ptr.as_ptr()) != 0 }
    }
    /// Blocking owner-only snapshot, for isolated export/preparation, never DSP.
    /// Files must be explicitly mapped to owned aliases by the caller.
    pub fn save_state(&mut self, paths: &[StatePath]) -> Result<PluginState, String> {
        if self.failed || self.right.is_some() {
            return Err("State requires a healthy declared-port instance".into());
        }
        let paths = Paths::new(paths)?;
        let mut capture = Capture {
            host: self.left.ptr.as_ptr(),
            paths: &paths,
            properties: Vec::new(),
            bytes: 0,
            failure: None,
        };
        // SAFETY: C stops/drains plugin work before synchronous state callbacks;
        // paths, callback context and all CString pointers outlive the call.
        let status = unsafe {
            ox_lv2_state(
                self.left.ptr.as_ptr(),
                0,
                Some(store),
                None,
                (&mut capture as *mut Capture<'_>).cast(),
                paths.native.as_ptr(),
                paths.native.len() as u32,
            )
        };
        if status != 0 || capture.failure.is_some() {
            self.failed = true;
            return Err(capture.failure.unwrap_or_else(error));
        }
        capture.properties.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(PluginState {
            version: 1,
            plugin_uri: self.info.uri.clone(),
            properties: capture.properties,
        })
    }
    /// Restore on a disposable candidate before exposing it to playback. Failed
    /// callbacks poison that candidate; they never publish a partially restored rig.
    pub fn restore_state(
        &mut self,
        state: &PluginState,
        paths: &[StatePath],
    ) -> Result<(), String> {
        if self.failed
            || self.right.is_some()
            || state.version != 1
            || state.plugin_uri != self.info.uri
            || state.properties.len() > 256
        {
            return Err("Invalid plugin state identity or instance".into());
        }
        let paths = Paths::new(paths)?;
        let mut keys = BTreeSet::new();
        let mut bytes = 0usize;
        for p in &state.properties {
            validate_property(p, &paths)?;
            bytes = bytes
                .checked_add(p.data.len())
                .ok_or("State byte overflow")?;
            if bytes > MAX_BYTES || !keys.insert(&p.key) {
                return Err("Duplicate state property or byte budget exceeded".into());
            }
        }
        let mut properties = Vec::new();
        for p in &state.properties {
            let key = self.map_atom_uri(&p.key)?;
            let type_id = self.map_atom_uri(&p.type_uri)?;
            let data = if p.type_uri == format!("{ATOM}URID") {
                self.map_atom_uri(string(&p.data)?)?.to_ne_bytes().to_vec()
            } else {
                numeric_bytes(&p.type_uri, &p.data, false)
            };
            properties.push(NativeProperty { key, type_id, data });
        }
        // SAFETY: exclusive live instance; all callback payloads and mappings
        // remain stable until synchronous restore and worker restart complete.
        let status = unsafe {
            ox_lv2_state(
                self.left.ptr.as_ptr(),
                1,
                None,
                Some(retrieve),
                (&mut properties as *mut Vec<NativeProperty>).cast(),
                paths.native.as_ptr(),
                paths.native.len() as u32,
            )
        };
        if status != 0 {
            self.failed = true;
            return Err(error());
        }
        self.prepared_latency = None;
        if let Err(reason) = self.prepare_latency() {
            self.failed = true;
            return Err(reason);
        }
        Ok(())
    }
}
