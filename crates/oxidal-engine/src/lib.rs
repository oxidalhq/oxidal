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
mod lv2_state;
#[cfg(feature = "native")]
mod partition;

pub mod protocol;
#[cfg(feature = "native")]
mod session;
#[cfg(feature = "native")]
pub use session::Session;
#[cfg(feature = "native")]
mod resident;
#[cfg(feature = "native")]
pub use resident::ResidentSet;
#[cfg(feature = "native")]
mod saving;
#[cfg(feature = "native")]
pub use saving::{prepare_native_setting, save_revision, save_revision_with_models};

/// Codec baseline for the pinned adapter sources. It is not a binary signature
/// or a claim that every upstream field/setting has passed fidelity qualification.
/// Installed library identity remains the build/image qualification's responsibility.
pub fn native_profile_id() -> Result<String, String> {
    let pins: serde_json::Value =
        serde_json::from_str(include_str!("../../../native/tone3000/sources.json"))
            .map_err(|_| "Invalid native source pins")?;
    let revision = pins["tone3000"]["revision"]
        .as_str()
        .ok_or("Missing native revision")?;
    Ok(format!("tone3000-plugin:{revision}"))
}
