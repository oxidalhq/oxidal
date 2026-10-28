//! Offline native TONE3000 adapter spike. See docs/native-tone3000.md.
//! The native feature is explicit; default builds never substitute a simulated engine.
#[cfg(feature = "native")]
mod native;
#[cfg(feature = "native")]
pub use native::{Engine, InputMode, NativeError, ProcessingRole, SplitStages, State};

#[cfg(feature = "native")]
pub mod editor;
#[cfg(feature = "native")]
pub mod model_preparation;
pub mod protocol;

#[cfg(feature = "native")]
pub mod working;

pub mod preferences;

#[cfg(feature = "native")]
pub mod midi;
