//! Owned native/LV2 graph preparation and isolated experimental rig worker.
//! Construction, routing and controls require the existing single DSP owner.
#[cfg(feature = "native")]
mod prepared;
#[cfg(feature = "native")]
pub use prepared::{PreparedRig, Processor};

#[cfg(feature = "native")]
mod ports;
#[cfg(feature = "native")]
pub use ports::PreparedPorts;

#[cfg(feature = "native")]
mod loading;
#[cfg(feature = "native")]
pub use loading::native_profile_id;

pub mod protocol;
#[cfg(feature = "native")]
mod session;
#[cfg(feature = "native")]
pub use session::Session;
#[cfg(feature = "native")]
mod saving;
#[cfg(feature = "native")]
pub use saving::save_revision;
