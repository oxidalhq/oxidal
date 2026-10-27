//! Owned native/LV2 graph preparation. Not yet connected to a playback worker.
//! Construction, routing and controls require the existing single DSP owner.
#[cfg(feature = "native")]
mod prepared;
#[cfg(feature = "native")]
pub use prepared::{PreparedRig, Processor};
