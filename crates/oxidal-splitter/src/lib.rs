//! Offline song preparation and timing. The media API owns jobs and the
//! backing player owns the live transport.
//! @see docs/media.md#song-preparation-and-practice-timing

mod mix;
mod practice;
mod tempo;

pub use mix::{MixError, MixRecipe, SplitMode, StemMix, StemRole};
pub use practice::{BeatGrid, PracticeRange};
pub use tempo::{TempoAnalyzer, TempoEstimate};
