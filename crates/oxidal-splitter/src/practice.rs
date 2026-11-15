use std::{num::NonZeroU32, ops::Range};

/// Beat positions in frames on a single audio timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeatGrid {
    rate: NonZeroU32,
    frames: Vec<u64>,
}

impl BeatGrid {
    /// Requires strictly increasing positions.
    pub fn new(rate: NonZeroU32, frames: Vec<u64>) -> Option<Self> {
        if frames.windows(2).any(|pair| pair[0] >= pair[1]) {
            return None;
        }
        Some(Self { rate, frames })
    }

    /// Prepare a grid for a player render, rounding each absolute position
    /// independently to avoid accumulating rounding error.
    pub fn at_rate(&self, rate: NonZeroU32) -> Option<Self> {
        let source_rate = u128::from(self.rate.get());
        let render_rate = u128::from(rate.get());
        let mut frames = Vec::with_capacity(self.frames.len());
        for &frame in &self.frames {
            let scaled = (u128::from(frame) * render_rate + source_rate / 2) / source_rate;
            let position = u64::try_from(scaled).ok()?;
            if frames.last() != Some(&position) {
                frames.push(position);
            }
        }
        Some(Self { rate, frames })
    }

    /// Find click positions in a half-open playback span without allocating.
    pub fn beats_in(&self, span: Range<u64>) -> &[u64] {
        if span.is_empty() {
            return &[];
        }
        let first = self.frames.partition_point(|&frame| frame < span.start);
        let past_last = self.frames.partition_point(|&frame| frame < span.end);
        &self.frames[first..past_last]
    }
}

/// A validated set of practice frames. A is included and B is the wrap point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PracticeRange {
    start: u64,
    end: u64,
}

impl PracticeRange {
    pub fn new(start: u64, end: u64, song_frames: u64) -> Option<Self> {
        (start < end && end <= song_frames).then_some(Self { start, end })
    }

    /// The next contiguous span for the cursor, ending at or before B.
    pub fn span(&self, cursor: u64, frames: u64) -> Option<Range<u64>> {
        if !(self.start..self.end).contains(&cursor) {
            return None;
        }
        Some(cursor..cursor.saturating_add(frames).min(self.end))
    }

    /// Advance a cursor inside the selection, wrapping from B to A.
    pub fn advance(&self, cursor: u64, frames: u64) -> Option<u64> {
        if !(self.start..self.end).contains(&cursor) {
            return None;
        }
        let offset = u128::from(cursor - self.start) + u128::from(frames);
        let length = u128::from(self.end - self.start);
        Some(self.start + (offset % length) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_positions_stay_aligned_after_rate_conversion_and_seek() {
        let source = NonZeroU32::new(44_100).unwrap();
        let output = NonZeroU32::new(48_000).unwrap();
        let frames = vec![0, 22_050, 44_100, 49_101];
        let grid = BeatGrid::new(source, frames)
            .unwrap()
            .at_rate(output)
            .unwrap();
        assert_eq!(grid.beats_in(1..48_000), &[24_000]);
        assert_eq!(grid.beats_in(48_000..60_000), &[48_000, 53_443]);
        assert!(grid.beats_in(60_000..61_000).is_empty());
        assert!(BeatGrid::new(output, vec![1, 1]).is_none());
    }

    #[test]
    fn practice_wrap_excludes_b_and_repeats_the_click_at_a() {
        let range = PracticeRange::new(48, 96, 120).unwrap();
        let beats = BeatGrid::new(NonZeroU32::new(48_000).unwrap(), vec![48, 72, 96]).unwrap();
        let before_wrap = range.span(72, 48).unwrap();
        assert_eq!(before_wrap, 72..96);
        assert_eq!(beats.beats_in(before_wrap), &[72]);
        let after_wrap = range.advance(72, 24).unwrap();
        assert_eq!(after_wrap, 48);
        assert_eq!(beats.beats_in(range.span(after_wrap, 24).unwrap()), &[48]);
        assert_eq!(range.advance(72, 48 * 8 + 25), Some(49));
        assert_eq!(range.span(96, 1), None);
        assert!(PracticeRange::new(48, 48, 120).is_none());
        assert!(PracticeRange::new(48, 121, 120).is_none());
    }
}
