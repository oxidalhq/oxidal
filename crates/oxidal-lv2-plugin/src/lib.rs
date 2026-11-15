//! The LV2 plugin interface for Oxidal's own effects.
//!
//! An effect implements [`Plugin`] in safe Rust and exports itself with
//! [`export!`]. This crate holds the C interface from the LV2 core
//! specification (`LV2_Descriptor` and its callbacks) and nothing else: no
//! extensions, no state, no events. Ports are numbered controls first, then
//! audio inputs, then audio outputs, as Oxidal's other effects are.
//! @see docs/native-effects.md
#![deny(unsafe_code)]

pub use abi::{Descriptor, descriptor};

/// The largest block handed to [`Plugin::process`]; longer host blocks are
/// split, so an effect can size its scratch memory once.
pub const MAX_BLOCK: usize = 1024;

/// One of Oxidal's own effects, as the host sees it.
pub trait Plugin: Send + 'static {
    /// Control input ports, numbered from zero in the order of the TTL file.
    const CONTROLS: usize;
    /// Audio channels in and out: 1 for the mono plugin, 2 for the stereo one.
    const CHANNELS: usize;
    /// Builds the effect and allocates everything it will ever need.
    fn new(sample_rate: f32) -> Self;
    /// Clears delay memories and filters; called when the host activates.
    fn reset(&mut self) {}
    /// Processes one block of at most [`MAX_BLOCK`] frames. `controls` holds
    /// the newest value of every control; `inputs` and `outputs` each hold
    /// `CHANNELS` slices of the same length. Must not allocate, lock or block.
    fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]);
}

/// Exports the `lv2_descriptor` entry point of an effect library.
///
/// ```ignore
/// oxidal_lv2_plugin::export!(
///     BloomMono => c"urn:oxidal:plugin:bloom#mono",
///     BloomStereo => c"urn:oxidal:plugin:bloom#stereo",
/// );
/// ```
#[macro_export]
macro_rules! export {
    ($($plugin:ty => $uri:expr),+ $(,)?) => {
        /// The LV2 entry point: one descriptor per plugin in this library.
        #[allow(unsafe_code)]
        #[unsafe(no_mangle)]
        pub extern "C" fn lv2_descriptor(index: u32) -> *const $crate::Descriptor {
            static DESCRIPTORS: &[$crate::Descriptor] =
                &[$($crate::descriptor::<$plugin>($uri)),+];
            match DESCRIPTORS.get(index as usize) {
                Some(found) => found,
                None => ::core::ptr::null(),
            }
        }
    };
}

#[allow(unsafe_code)]
mod abi {
    use super::{MAX_BLOCK, Plugin};
    use core::ffi::{CStr, c_char, c_void};

    /// `LV2_Descriptor` from the LV2 core specification, field for field.
    #[repr(C)]
    #[derive(Debug)]
    pub struct Descriptor {
        uri: *const c_char,
        instantiate: unsafe extern "C" fn(
            *const Descriptor,
            f64,
            *const c_char,
            *const *const c_void,
        ) -> *mut c_void,
        connect_port: unsafe extern "C" fn(*mut c_void, u32, *mut c_void),
        activate: Option<unsafe extern "C" fn(*mut c_void)>,
        run: unsafe extern "C" fn(*mut c_void, u32),
        deactivate: Option<unsafe extern "C" fn(*mut c_void)>,
        cleanup: unsafe extern "C" fn(*mut c_void),
        extension_data: unsafe extern "C" fn(*const c_char) -> *const c_void,
    }

    // SAFETY: a descriptor is immutable; its only pointer is a 'static string.
    unsafe impl Sync for Descriptor {}

    /// The descriptor of plugin `P` under `uri`.
    pub const fn descriptor<P: Plugin>(uri: &'static CStr) -> Descriptor {
        assert!(P::CHANNELS == 1 || P::CHANNELS == 2);
        Descriptor {
            uri: uri.as_ptr(),
            instantiate: instantiate::<P>,
            connect_port: connect_port::<P>,
            activate: Some(activate::<P>),
            run: run::<P>,
            deactivate: None,
            cleanup: cleanup::<P>,
            extension_data,
        }
    }

    struct Instance<P> {
        plugin: P,
        /// Host buffers: controls, then audio inputs, then audio outputs.
        ports: Vec<*mut f32>,
        controls: Vec<f32>,
        /// Copies of the inputs, so in-place host buffers never alias.
        scratch: [Vec<f32>; 2],
    }

    unsafe extern "C" fn instantiate<P: Plugin>(
        _descriptor: *const Descriptor,
        sample_rate: f64,
        _bundle_path: *const c_char,
        _features: *const *const c_void,
    ) -> *mut c_void {
        let instance = Instance {
            plugin: P::new(sample_rate as f32),
            ports: vec![core::ptr::null_mut(); P::CONTROLS + 2 * P::CHANNELS],
            controls: vec![0.0; P::CONTROLS],
            scratch: [vec![0.0; MAX_BLOCK], vec![0.0; MAX_BLOCK]],
        };
        Box::into_raw(Box::new(instance)).cast()
    }

    unsafe extern "C" fn connect_port<P: Plugin>(
        handle: *mut c_void,
        port: u32,
        data: *mut c_void,
    ) {
        // SAFETY: the host passes the handle `instantiate` returned.
        let instance = unsafe { &mut *handle.cast::<Instance<P>>() };
        if let Some(slot) = instance.ports.get_mut(port as usize) {
            *slot = data.cast();
        }
    }

    unsafe extern "C" fn activate<P: Plugin>(handle: *mut c_void) {
        // SAFETY: the host passes the handle `instantiate` returned.
        let instance = unsafe { &mut *handle.cast::<Instance<P>>() };
        instance.plugin.reset();
    }

    unsafe extern "C" fn run<P: Plugin>(handle: *mut c_void, frames: u32) {
        // SAFETY: the host passes the handle `instantiate` returned.
        let Instance {
            plugin,
            ports,
            controls,
            scratch,
        } = unsafe { &mut *handle.cast::<Instance<P>>() };
        let _denormals = super::denormals::Guard::new();
        for (value, port) in controls.iter_mut().zip(ports.iter()) {
            if !port.is_null() {
                // SAFETY: a connected control port points at one float.
                let next = unsafe { **port };
                if next.is_finite() {
                    *value = next;
                }
            }
        }
        let (inputs, outputs) = ports[P::CONTROLS..].split_at(P::CHANNELS);
        if inputs.iter().chain(outputs).any(|port| port.is_null()) {
            return;
        }
        if P::CHANNELS == 2 && outputs[0] == outputs[1] {
            return; // one buffer for both outputs cannot hold a stereo result
        }
        let frames = frames as usize;
        let mut done = 0;
        while done < frames {
            let len = (frames - done).min(MAX_BLOCK);
            for (copy, port) in scratch.iter_mut().zip(inputs) {
                // SAFETY: an audio port holds at least `frames` samples, and
                // the scratch buffer is ours, so the ranges cannot overlap.
                unsafe { core::ptr::copy_nonoverlapping(port.add(done), copy.as_mut_ptr(), len) };
            }
            let (left_in, right_in) = scratch.split_at(1);
            let ins: [&[f32]; 2] = [&left_in[0][..len], &right_in[0][..len]];
            // SAFETY: the output ports are distinct host buffers of at least
            // `frames` samples; inputs were copied out, so nothing aliases.
            let mut outs: [&mut [f32]; 2] = unsafe {
                [
                    core::slice::from_raw_parts_mut(outputs[0].add(done), len),
                    if P::CHANNELS == 2 {
                        core::slice::from_raw_parts_mut(outputs[1].add(done), len)
                    } else {
                        &mut []
                    },
                ]
            };
            plugin.process(controls, &ins[..P::CHANNELS], &mut outs[..P::CHANNELS]);
            done += len;
        }
    }

    unsafe extern "C" fn cleanup<P: Plugin>(handle: *mut c_void) {
        // SAFETY: the host passes the handle `instantiate` returned, once.
        drop(unsafe { Box::from_raw(handle.cast::<Instance<P>>()) });
    }

    unsafe extern "C" fn extension_data(_uri: *const c_char) -> *const c_void {
        core::ptr::null()
    }
}

/// Makes very small numbers round to zero while an effect runs, so decaying
/// filters and delays never slow the audio callback down.
#[allow(unsafe_code)]
mod denormals {
    #[derive(Debug)]
    pub(crate) struct Guard {
        #[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
        saved: u64,
    }

    impl Guard {
        #[cfg(target_arch = "aarch64")]
        pub(crate) fn new() -> Self {
            let saved: u64;
            // SAFETY: reads and writes the floating-point control register of
            // this thread only; bit 24 (FZ) selects flush-to-zero.
            unsafe {
                core::arch::asm!("mrs {0}, fpcr", out(reg) saved, options(nomem, nostack));
                core::arch::asm!("msr fpcr, {0}", in(reg) saved | (1 << 24), options(nomem, nostack));
            }
            Self { saved }
        }

        #[cfg(target_arch = "x86_64")]
        pub(crate) fn new() -> Self {
            let mut saved: u32 = 0;
            // SAFETY: reads and writes this thread's MXCSR; bits 15 (FTZ) and
            // 6 (DAZ) select flush-to-zero and denormals-are-zero.
            unsafe {
                core::arch::asm!("stmxcsr [{0}]", in(reg) &mut saved, options(nostack));
                let flushed: u32 = saved | 0x8040;
                core::arch::asm!("ldmxcsr [{0}]", in(reg) &flushed, options(nostack, readonly));
            }
            Self {
                saved: u64::from(saved),
            }
        }

        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        pub(crate) fn new() -> Self {
            Self {}
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            #[cfg(target_arch = "aarch64")]
            // SAFETY: restores the register value read in `new`.
            unsafe {
                core::arch::asm!("msr fpcr, {0}", in(reg) self.saved, options(nomem, nostack));
            }
            #[cfg(target_arch = "x86_64")]
            // SAFETY: restores the register value read in `new`.
            unsafe {
                let saved = self.saved as u32;
                core::arch::asm!("ldmxcsr [{0}]", in(reg) &saved, options(nostack, readonly));
            }
        }
    }
}

#[cfg(test)]
#[allow(unsafe_code)]
mod tests {
    use super::*;
    use core::ffi::{CStr, c_void};

    use std::sync::atomic::{AtomicUsize, Ordering};

    static RESETS: AtomicUsize = AtomicUsize::new(0);
    static LARGEST_BLOCK: AtomicUsize = AtomicUsize::new(0);

    /// Doubles the left input, adds the control, and counts resets.
    struct Twice;

    impl Plugin for Twice {
        const CONTROLS: usize = 1;
        const CHANNELS: usize = 2;
        fn new(sample_rate: f32) -> Self {
            assert_eq!(sample_rate, 48_000.0);
            Self
        }
        fn reset(&mut self) {
            RESETS.fetch_add(1, Ordering::Relaxed);
        }
        fn process(&mut self, controls: &[f32], inputs: &[&[f32]], outputs: &mut [&mut [f32]]) {
            LARGEST_BLOCK.fetch_max(inputs[0].len(), Ordering::Relaxed);
            for i in 0..inputs[0].len() {
                outputs[0][i] = 2.0 * inputs[0][i] + controls[0];
                outputs[1][i] = inputs[1][i] - inputs[0][i];
            }
        }
    }

    export!(Twice => c"urn:oxidal:test:twice");

    // Mirrors the layout of `Descriptor` so the test can call through it as a host would.
    #[repr(C)]
    struct Host {
        uri: *const core::ffi::c_char,
        instantiate: unsafe extern "C" fn(
            *const Descriptor,
            f64,
            *const core::ffi::c_char,
            *const *const c_void,
        ) -> *mut c_void,
        connect_port: unsafe extern "C" fn(*mut c_void, u32, *mut c_void),
        activate: Option<unsafe extern "C" fn(*mut c_void)>,
        run: unsafe extern "C" fn(*mut c_void, u32),
        deactivate: Option<unsafe extern "C" fn(*mut c_void)>,
        cleanup: unsafe extern "C" fn(*mut c_void),
        extension_data: unsafe extern "C" fn(*const core::ffi::c_char) -> *const c_void,
    }

    #[test]
    fn a_host_can_run_the_plugin_in_place_across_long_blocks() {
        assert!(lv2_descriptor(1).is_null());
        let descriptor = lv2_descriptor(0);
        assert!(!descriptor.is_null());
        // SAFETY: `Host` has the layout of `Descriptor`; the calls follow the LV2 lifecycle.
        unsafe {
            let host = &*descriptor.cast::<Host>();
            assert_eq!(
                CStr::from_ptr(host.uri).to_str().unwrap(),
                "urn:oxidal:test:twice"
            );
            assert!(host.deactivate.is_none() && (host.extension_data)(host.uri).is_null());
            let handle =
                (host.instantiate)(descriptor, 48_000.0, core::ptr::null(), core::ptr::null());
            let frames = 2 * MAX_BLOCK + 37;
            let mut control_value = 0.5_f32;
            let control = &raw mut control_value;
            // Left runs in place (input and output share a buffer); right does not.
            let mut left: Vec<f32> = (0..frames).map(|i| i as f32).collect();
            let right_in: Vec<f32> = vec![1.0; frames];
            let mut right_out = vec![0.0_f32; frames];
            (host.connect_port)(handle, 0, control.cast());
            (host.connect_port)(handle, 1, left.as_mut_ptr().cast());
            (host.connect_port)(handle, 2, right_in.as_ptr().cast_mut().cast());
            (host.connect_port)(handle, 3, left.as_mut_ptr().cast());
            (host.connect_port)(handle, 4, right_out.as_mut_ptr().cast());
            (host.connect_port)(handle, 99, core::ptr::null_mut()); // ignored
            (host.activate.unwrap())(handle);
            (host.run)(handle, frames as u32);
            for i in 0..frames {
                assert_eq!(left[i], 2.0 * i as f32 + 0.5);
                assert_eq!(right_out[i], 1.0 - i as f32);
            }
            // A control that is not a number keeps its last value.
            control.write(f32::NAN);
            (host.run)(handle, 1);
            assert_eq!(left[0], 2.0 * 0.5 + 0.5);
            assert_eq!(RESETS.load(Ordering::Relaxed), 1);
            assert_eq!(LARGEST_BLOCK.load(Ordering::Relaxed), MAX_BLOCK);
            (host.cleanup)(handle);
        }
    }

    #[test]
    fn tiny_numbers_flush_to_zero_while_the_guard_lives() {
        let _guard = denormals::Guard::new();
        let mut tiny = core::hint::black_box(1.0e-30_f32);
        for _ in 0..20 {
            tiny = core::hint::black_box(tiny * 0.1);
        }
        if cfg!(any(target_arch = "aarch64", target_arch = "x86_64")) {
            assert_eq!(tiny, 0.0);
        }
    }
}
