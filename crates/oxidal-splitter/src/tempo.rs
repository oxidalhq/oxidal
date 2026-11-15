//! Tempo and beat positions for the practice click.
//!
//! Method: D. P. W. Ellis, "Beat Tracking by Dynamic Programming", Journal of
//! New Music Research 36(1), 2007. Tempo is the autocorrelation lag of the
//! onset envelope with the most weight around 120 BPM; beats are the
//! dynamic-programming path that rewards strong onsets and spacing close to
//! that tempo, so they follow gentle tempo changes.

use crate::BeatGrid;
use std::num::NonZeroU32;

const ENVELOPE_HZ: u32 = 100;
const MIN_BEAT_BPM: f64 = 45.0;
const MAX_BEAT_BPM: f64 = 220.0;
/// Centre of the tempo preference and its width in octaves (Ellis 2007).
const PREFERRED_BPM: f64 = 120.0;
const PREFERENCE_OCTAVES: f64 = 1.4;
/// How strongly beat spacing is held to the estimated period (Ellis 2007).
const TIGHTNESS: f64 = 100.0;

/// Estimate for recordings with a steady or gently changing pulse.
#[derive(Debug, PartialEq)]
pub struct TempoEstimate {
    pub bpm: f64,
    pub beats: BeatGrid,
}

/// Offline onset analysis. Retains one envelope value per 10 ms window and
/// accepts arbitrary chunk boundaries from the audio decoder.
#[derive(Debug)]
pub struct TempoAnalyzer {
    rate: NonZeroU32,
    frames_per_window: u32,
    frames: u32,
    energy: f64,
    previous_level: f32,
    novelty: Vec<f32>,
}

impl TempoAnalyzer {
    pub fn new(rate: NonZeroU32) -> Self {
        Self {
            rate,
            frames_per_window: (rate.get() / ENVELOPE_HZ).max(1),
            frames: 0,
            energy: 0.0,
            previous_level: 0.0,
            novelty: Vec::new(),
        }
    }

    pub fn push_mono(&mut self, samples: &[f32]) {
        for &sample in samples {
            if sample.is_finite() {
                self.energy += f64::from(sample).powi(2);
            }
            self.frames += 1;
            if self.frames == self.frames_per_window {
                let mean_square = self.energy / f64::from(self.frames);
                let level = (mean_square * 10_000.0).ln_1p() as f32;
                self.novelty.push((level - self.previous_level).max(0.0));
                self.previous_level = level;
                self.energy = 0.0;
                self.frames = 0;
            }
        }
    }

    /// Estimate the tempo and beat positions, or decline material without a
    /// clear pulse.
    pub fn finish(self) -> Option<TempoEstimate> {
        let window_rate = f64::from(self.rate.get()) / f64::from(self.frames_per_window);
        let novelty = self.novelty;
        let strongest = novelty.iter().copied().fold(0.0, f32::max);
        let threshold = (strongest * 0.15).max(0.1);
        let minimum_gap = (window_rate / 10.0).ceil() as usize;
        if onset_count(&novelty, threshold, minimum_gap) < 4 {
            return None;
        }
        let period = tempo_period(&novelty, window_rate)?;
        let beats = track_beats(&novelty, period, threshold)?;
        if beats.len() < 4 {
            return None;
        }
        // A pulse puts most beats on real onsets. Scattered attacks leave the
        // tracker bridging silence instead.
        let near = (minimum_gap / 2).max(1);
        let on_onsets = beats
            .iter()
            .filter(|&&beat| {
                novelty[beat.saturating_sub(near)..(beat + near + 1).min(novelty.len())]
                    .iter()
                    .any(|&level| level >= threshold)
            })
            .count();
        if on_onsets * 4 < beats.len() * 3 {
            return None;
        }
        let span = (beats[beats.len() - 1] - beats[0]) as f64;
        let bpm = 60.0 * window_rate * (beats.len() - 1) as f64 / span;
        if !(MIN_BEAT_BPM..=MAX_BEAT_BPM).contains(&bpm) {
            return None;
        }
        let positions = beats
            .into_iter()
            .map(|index| index as u64 * u64::from(self.frames_per_window))
            .collect();
        Some(TempoEstimate {
            bpm,
            beats: BeatGrid::new(self.rate, positions)?,
        })
    }
}

/// Beat period in envelope windows, refined between neighbouring lags.
fn tempo_period(novelty: &[f32], window_rate: f64) -> Option<f64> {
    let lag_for = |bpm: f64| 60.0 * window_rate / bpm;
    let shortest = (lag_for(MAX_BEAT_BPM).floor() as usize).max(2);
    let longest = (lag_for(MIN_BEAT_BPM).ceil() as usize).min(novelty.len() / 2);
    if longest <= shortest + 1 {
        return None;
    }
    let preferred = lag_for(PREFERRED_BPM);
    // A short smoothing keeps a beat that falls between two windows from
    // splitting its correlation across neighbouring lags.
    let smooth: Vec<f64> = (0..novelty.len())
        .map(|index| {
            [(-2, 0.06), (-1, 0.24), (0, 0.4), (1, 0.24), (2, 0.06)]
                .iter()
                .filter_map(|&(offset, weight)| {
                    let at = index.checked_add_signed(offset)?;
                    novelty.get(at).map(|&n| f64::from(n) * weight)
                })
                .sum()
        })
        .collect();
    let weighted = |lag: usize| {
        let sum: f64 = smooth
            .iter()
            .zip(&smooth[lag..])
            .map(|(&a, &b)| a * b)
            .sum();
        let octaves = (lag as f64 / preferred).log2();
        sum / (novelty.len() - lag) as f64 * (-0.5 * (octaves / PREFERENCE_OCTAVES).powi(2)).exp()
    };
    let scores: Vec<f64> = (shortest - 1..=longest + 1).map(weighted).collect();
    let (best, &peak) = scores[1..scores.len() - 1]
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))?;
    if peak <= 0.0 {
        return None;
    }
    let (before, after) = (scores[best], scores[best + 2]);
    let curve = before - 2.0 * peak + after;
    let offset = if curve < 0.0 {
        (0.5 * (before - after) / curve).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    Some((shortest + best) as f64 + offset)
}

/// Each window scores its onset strength plus the best earlier beat, less a
/// penalty for spacing away from `period`. The chain ending on the
/// best-scoring strong onset gives the beats.
fn track_beats(novelty: &[f32], period: f64, threshold: f32) -> Option<Vec<usize>> {
    let count = novelty.len() as f64;
    let mean = novelty.iter().map(|&n| f64::from(n)).sum::<f64>() / count;
    let spread = (novelty
        .iter()
        .map(|&n| (f64::from(n) - mean).powi(2))
        .sum::<f64>()
        / count)
        .sqrt()
        .max(f64::EPSILON);
    let local: Vec<f64> = novelty.iter().map(|&n| f64::from(n) / spread).collect();
    let nearest = (period / 2.0).round().max(1.0) as usize;
    let farthest = (period * 2.0).round() as usize;
    let mut score = vec![0.0; local.len()];
    let mut previous = vec![usize::MAX; local.len()];
    for index in 0..local.len() {
        let mut best = 0.0;
        if let Some(latest) = index.checked_sub(nearest) {
            let earliest = index.saturating_sub(farthest);
            for (earlier, &earlier_score) in score[earliest..=latest].iter().enumerate() {
                let earlier = earliest + earlier;
                let spacing = ((index - earlier) as f64 / period).ln();
                let candidate = earlier_score - TIGHTNESS * spacing * spacing;
                if candidate > best {
                    best = candidate;
                    previous[index] = earlier;
                }
            }
        }
        score[index] = local[index] + best;
    }
    let strong = f64::from(threshold) / spread;
    let mut beat = (0..local.len())
        .filter(|&index| local[index] >= strong)
        .max_by(|&a, &b| score[a].total_cmp(&score[b]))?;
    let mut beats = vec![beat];
    while previous[beat] != usize::MAX {
        beat = previous[beat];
        beats.push(beat);
    }
    beats.reverse();
    // Drop any lead-in before the first real onset.
    let first = beats.iter().position(|&b| local[b] >= strong)?;
    Some(beats.split_off(first))
}

fn onset_count(novelty: &[f32], threshold: f32, minimum_gap: usize) -> usize {
    let mut count = 0;
    let mut last: Option<usize> = None;
    for (index, &level) in novelty.iter().enumerate() {
        let previous = index.checked_sub(1).map_or(0.0, |i| novelty[i]);
        let next = novelty.get(index + 1).copied().unwrap_or(0.0);
        if level < threshold || level <= previous || level < next {
            continue;
        }
        if last.is_none_or(|last| index - last >= minimum_gap) {
            count += 1;
            last = Some(index);
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn analyse(samples: &[f32]) -> Option<TempoEstimate> {
        let mut analyser = TempoAnalyzer::new(NonZeroU32::new(RATE).unwrap());
        for chunk in samples.chunks(997) {
            analyser.push_mono(chunk);
        }
        analyser.finish()
    }

    fn analyse_clicks(beats: &[usize]) -> Option<TempoEstimate> {
        let mut samples = vec![0.0; beats.last().copied().unwrap_or(0) + RATE as usize / 2];
        for &beat in beats {
            samples[beat..beat + 96].fill(0.8);
        }
        analyse(&samples)
    }

    #[test]
    fn estimates_steady_bpm_and_retains_a_nonzero_first_beat() {
        let beats: Vec<_> = (0..12).map(|beat| 9_600 + beat * 24_000).collect();
        let estimate = analyse_clicks(&beats).unwrap();
        let expected: Vec<_> = beats.iter().map(|&beat| beat as u64).collect();
        assert!((estimate.bpm - 120.0).abs() < 0.01);
        assert_eq!(estimate.beats.beats_in(0..u64::MAX), &expected);
    }

    #[test]
    fn preserves_beats_that_change_spacing() {
        let beats = [4_800, 33_600, 61_440, 88_320, 114_240, 139_200, 163_200];
        let estimate = analyse_clicks(&beats).unwrap();
        assert!((100.0..120.0).contains(&estimate.bpm));
        let found = estimate.beats.beats_in(0..u64::MAX);
        assert_eq!(found.len(), beats.len());
        for (&actual, expected) in found.iter().zip(beats) {
            assert!(actual.abs_diff(expected as u64) < u64::from(RATE / ENVELOPE_HZ));
        }
    }

    /// Kick on every beat, quieter off-beat hats and a chord stab entering
    /// off the grid: the old all-intervals rule declined this.
    #[test]
    fn follows_a_beat_through_off_beat_and_syncopated_onsets() {
        let beat = 26_182; // 110 BPM at 48 kHz
        let count = 32;
        let mut samples = vec![0.0f32; beat * (count + 1)];
        let mut hit = |at: usize, level: f32, length: usize| {
            for (offset, sample) in samples[at..at + length].iter_mut().enumerate() {
                *sample += level * (1.0 - offset as f32 / length as f32);
            }
        };
        for index in 0..count {
            hit(4_800 + index * beat, 0.9, 2_400);
            hit(4_800 + index * beat + beat / 2, 0.25, 480);
            if index % 4 == 1 {
                hit(4_800 + index * beat + beat * 3 / 4, 0.5, 4_800);
            }
        }
        let estimate = analyse(&samples).unwrap();
        assert!((estimate.bpm - 110.0).abs() < 1.0, "{}", estimate.bpm);
        let found = estimate.beats.beats_in(0..u64::MAX);
        let on_kicks = found
            .iter()
            .filter(|&&at| {
                let offset = (at as usize + beat - 4_800) % beat;
                offset.min(beat - offset) < 960
            })
            .count();
        assert!(
            on_kicks * 10 >= found.len() * 9,
            "{on_kicks} of {}",
            found.len()
        );
    }

    #[test]
    fn rejects_silence_and_attacks_without_a_pulse() {
        assert!(analyse_clicks(&[]).is_none());
        assert!(analyse_clicks(&[0, 14_400, 67_200, 88_800, 165_600, 182_400, 278_400]).is_none());
    }
}
