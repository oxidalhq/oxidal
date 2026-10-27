//! Bounded native preset inspection and immutable original storage.
//! This is not an audio backend or a declaration of preset playback compatibility.
//! @see docs/presets/format.md
mod graph;
pub use graph::{GraphPreset, GraphStore, SavedGraph};
mod model;
mod native;
pub use model::{ModelAsset, ModelStore};
mod owned;
pub use owned::{OwnedPreset, OwnedStore};
mod store;
pub use native::{ArtworkSource, Framing, Inspection, MAX_FILE_BYTES, artwork, inspect};
pub use store::{Library, Store};

#[derive(Debug)]
pub enum Error {
    Invalid(&'static str),
    Io(std::io::Error),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::Io(_) => f.write_str("Preset storage is unavailable"),
        }
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}
type Result<T> = std::result::Result<T, Error>;
