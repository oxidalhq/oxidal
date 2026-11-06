//! Bounded native inspection, portable declarations and immutable preset storage.
//! This is not an audio backend or a declaration of preset playback compatibility.
//! @see docs/presets/format.md
mod details;
pub use details::{
    CopyCredit, DetailsCatalog, DetailsEntry, DetailsStore, DetailsUpdate, PresetDetails,
};
mod catalog;
pub use catalog::{
    CatalogStore, LibraryAction, LibraryCatalog, LibraryItem, LibraryKind, LibraryOrigin,
    LibraryUpdate,
};
mod bundle;
mod graph;
pub mod manifest;
pub use bundle::{Bundle, BundleStore};
pub use graph::{GraphPreset, GraphStore, SavedGraph};
mod midi;
mod model;
mod nam_info;
pub use nam_info::NamInfo;
mod wav_info;
pub use wav_info::WavInfo;
mod native;
pub use midi::{MidiMap, MidiMapEntry, MidiMapStore, MidiMapUpdate, MidiTemplate};
pub use model::{LocalAssetPage, ModelAsset, ModelStore};
mod owned;
mod removal;
pub use owned::{OwnedPreset, OwnedStore};
pub use removal::{
    LibraryReference, ModelRemoval, ModelRemovalPreview, ModelRemovalRequest, ModelRemovalResult,
    PendingRemoval, RemovalPreview, RemovalReferences, RemovalRequest, RemovalResult, RemovalStore,
};
mod store;
pub use native::{
    ArtworkSource, Framing, Inspection, MAX_FILE_BYTES, artwork, embedded_digests, inspect,
};
pub use store::{Library, Store};

#[derive(Debug)]
pub enum Error {
    Conflict(&'static str),
    Invalid(&'static str),
    Io(std::io::Error),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Conflict(message) | Self::Invalid(message) => f.write_str(message),
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
