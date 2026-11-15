use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read, Seek, SeekFrom, Write};

const GAIN_RANGE: std::ops::RangeInclusive<i16> = -240..=60;
const RENDER_CHUNK_FRAMES: usize = 4096;
const MAX_MIX_PEAK: f32 = 0.891_250_9; // -1 dBFS

/// The role from the split manifest, independent of the model's tensor order.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum StemRole {
    Vocals,
    Drums,
    Bass,
    Other,
    Guitar,
    Piano,
}

impl StemRole {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Vocals => "vocals",
            Self::Drums => "drums",
            Self::Bass => "bass",
            Self::Other => "other",
            Self::Guitar => "guitar",
            Self::Piano => "piano",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SplitMode {
    Four,
    Six,
}

impl SplitMode {
    pub const fn roles(self) -> &'static [StemRole] {
        use StemRole::{Bass, Drums, Guitar, Other, Piano, Vocals};
        match self {
            Self::Four => &[Vocals, Drums, Bass, Other],
            Self::Six => &[Vocals, Drums, Bass, Other, Guitar, Piano],
        }
    }
}

/// Saved settings for one stem. Store fixed tenths of a decibel so a reopened
/// editor can restore exactly the control value that was used for rendering.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StemMix {
    pub muted: bool,
    pub solo: bool,
    #[serde(deserialize_with = "deserialize_gain")]
    #[schemars(with = "i32", range(min = -240, max = 60))]
    gain_tenths_db: i16,
}

impl StemMix {
    pub fn new(gain_tenths_db: i16, muted: bool, solo: bool) -> Option<Self> {
        GAIN_RANGE.contains(&gain_tenths_db).then_some(Self {
            muted,
            solo,
            gain_tenths_db,
        })
    }

    pub fn gain_tenths_db(self) -> i16 {
        self.gain_tenths_db
    }
}

fn deserialize_gain<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i16, D::Error> {
    let gain = i16::deserialize(deserializer)?;
    if !GAIN_RANGE.contains(&gain) {
        return Err(serde::de::Error::custom("stem gain must be -24 to +6 dB"));
    }
    Ok(gain)
}

/// The editable settings saved with a generated stereo mix.
/// @see docs/media.md#stem-mix-recipes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum MixRecipe {
    Four {
        vocals: StemMix,
        drums: StemMix,
        bass: StemMix,
        other: StemMix,
    },
    Six {
        vocals: StemMix,
        drums: StemMix,
        bass: StemMix,
        other: StemMix,
        guitar: StemMix,
        piano: StemMix,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MixError {
    StemRoles,
    FrameCount,
    NonFiniteOutput,
}

impl MixRecipe {
    pub const fn mode(&self) -> SplitMode {
        match self {
            Self::Four { .. } => SplitMode::Four,
            Self::Six { .. } => SplitMode::Six,
        }
    }

    /// Render immutable stereo little-endian float32 stems to a staged
    /// backing stream. The first pass verifies lengths and measures the
    /// unscaled mix. The second applies only the attenuation needed to fit
    /// within -1 dBFS, uniformly across the entire song.
    pub fn render_pcm<R: Read + Seek>(
        &self,
        stems: &mut BTreeMap<StemRole, R>,
        frames: u64,
        output: impl Write,
    ) -> io::Result<()> {
        self.render_pcm_checked(stems, frames, output, || Ok(()))
    }

    /// Same immutable render, with a job-state check at chunk boundaries.
    pub fn render_pcm_checked<R: Read + Seek>(
        &self,
        stems: &mut BTreeMap<StemRole, R>,
        frames: u64,
        mut output: impl Write,
        mut check: impl FnMut() -> io::Result<()>,
    ) -> io::Result<()> {
        if frames == 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "empty stems"));
        }
        let mut peak = 0.0_f32;
        self.visit_pcm_chunks(stems, frames, |_, chunk_peak| {
            check()?;
            peak = peak.max(chunk_peak);
            Ok(())
        })?;
        let attenuation = if peak > MAX_MIX_PEAK {
            MAX_MIX_PEAK / peak
        } else {
            1.0
        };
        let mut bytes = Vec::with_capacity(RENDER_CHUNK_FRAMES * 8);
        self.visit_pcm_chunks(stems, frames, |chunk, _| {
            check()?;
            bytes.clear();
            for &sample in chunk.iter().flatten() {
                bytes.extend_from_slice(&(sample * attenuation).to_le_bytes());
            }
            output.write_all(&bytes)
        })?;
        output.flush()
    }

    fn visit_pcm_chunks<R: Read + Seek>(
        &self,
        stems: &mut BTreeMap<StemRole, R>,
        frames: u64,
        mut visit: impl FnMut(&[[f32; 2]], f32) -> io::Result<()>,
    ) -> io::Result<()> {
        let mut buffers = BTreeMap::new();
        for (&role, file) in &mut *stems {
            file.seek(SeekFrom::Start(0))?;
            buffers.insert(role, vec![[0.0; 2]; RENDER_CHUNK_FRAMES]);
        }
        let mut bytes = vec![0; RENDER_CHUNK_FRAMES * 8];
        let mut mixed = vec![[0.0; 2]; RENDER_CHUNK_FRAMES];
        let mut remaining = frames;
        while remaining > 0 {
            let count = remaining.min(RENDER_CHUNK_FRAMES as u64) as usize;
            for (&role, file) in &mut *stems {
                let bytes = &mut bytes[..count * 8];
                file.read_exact(bytes)?;
                for (frame, &[l0, l1, l2, l3, r0, r1, r2, r3]) in buffers
                    .get_mut(&role)
                    .expect("stem buffers use the same keys")
                    .iter_mut()
                    .zip(bytes.as_chunks::<8>().0)
                {
                    *frame = [
                        f32::from_le_bytes([l0, l1, l2, l3]),
                        f32::from_le_bytes([r0, r1, r2, r3]),
                    ];
                }
            }
            let sources = buffers
                .iter()
                .map(|(&role, source)| (role, &source[..count]))
                .collect();
            let peak = self
                .render_chunk(&sources, &mut mixed[..count])
                .map_err(|error| {
                    io::Error::new(io::ErrorKind::InvalidData, format!("{error:?}"))
                })?;
            visit(&mixed[..count], peak)?;
            remaining -= count as u64;
        }
        for file in stems.values_mut() {
            if file.read(&mut [0])? != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "stem contains more frames than declared",
                ));
            }
        }
        Ok(())
    }

    /// Sum one frame-aligned chunk and return its peak before headroom
    /// correction. The renderer can compute one shared correction for all
    /// chunks of a completed mix. Discard the output on error.
    pub fn render_chunk(
        &self,
        stems: &BTreeMap<StemRole, &[[f32; 2]]>,
        output: &mut [[f32; 2]],
    ) -> Result<f32, MixError> {
        let tracks = self.tracks();
        if stems.len() != tracks.iter().flatten().count() {
            return Err(MixError::StemRoles);
        }
        let any_solo = tracks.iter().flatten().any(|(_, edit)| edit.solo);
        output.fill([0.0; 2]);
        for (role, edit) in tracks.into_iter().flatten() {
            let source = stems.get(&role).ok_or(MixError::StemRoles)?;
            if source.len() != output.len() {
                return Err(MixError::FrameCount);
            }
            if edit.muted || (any_solo && !edit.solo) {
                continue;
            }
            let gain = 10.0_f32.powf(f32::from(edit.gain_tenths_db()) / 200.0);
            for (sum, frame) in output.iter_mut().zip(*source) {
                sum[0] += frame[0] * gain;
                sum[1] += frame[1] * gain;
            }
        }
        let mut peak = 0.0_f32;
        for &sample in output.iter().flatten() {
            if !sample.is_finite() {
                return Err(MixError::NonFiniteOutput);
            }
            peak = peak.max(sample.abs());
        }
        Ok(peak)
    }

    /// Linear gain per role for live playback, with mute and solo applied
    /// exactly as the renderer applies them; silent roles are 0.
    pub fn live_gains(&self) -> Vec<(StemRole, f32)> {
        let tracks = self.tracks();
        let any_solo = tracks.iter().flatten().any(|(_, edit)| edit.solo);
        tracks
            .into_iter()
            .flatten()
            .map(|(role, edit)| {
                let silent = edit.muted || (any_solo && !edit.solo);
                let gain = 10.0_f32.powf(f32::from(edit.gain_tenths_db()) / 200.0);
                (role, if silent { 0.0 } else { gain })
            })
            .collect()
    }

    fn tracks(&self) -> [Option<(StemRole, StemMix)>; 6] {
        let (vocals, drums, bass, other, extra) = match *self {
            Self::Four {
                vocals,
                drums,
                bass,
                other,
            } => (vocals, drums, bass, other, [None, None]),
            Self::Six {
                vocals,
                drums,
                bass,
                other,
                guitar,
                piano,
            } => (
                vocals,
                drums,
                bass,
                other,
                [
                    Some((StemRole::Guitar, guitar)),
                    Some((StemRole::Piano, piano)),
                ],
            ),
        };
        [
            Some((StemRole::Vocals, vocals)),
            Some((StemRole::Drums, drums)),
            Some((StemRole::Bass, bass)),
            Some((StemRole::Other, other)),
            extra[0],
            extra[1],
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn saved_six_stem_edit_reopens_and_renders_vocals_without_guitar() {
        let neutral = StemMix::default();
        let recipe = MixRecipe::Six {
            vocals: StemMix::new(60, false, true).unwrap(),
            drums: neutral,
            bass: neutral,
            other: neutral,
            guitar: StemMix::new(-35, true, true).unwrap(),
            piano: neutral,
        };
        let saved = serde_json::to_vec(&recipe).unwrap();
        let reopened: MixRecipe = serde_json::from_slice(&saved).unwrap();
        assert_eq!(reopened, recipe);

        let source = [[0.2, -0.1]];
        let stems = [
            StemRole::Vocals,
            StemRole::Drums,
            StemRole::Bass,
            StemRole::Other,
            StemRole::Guitar,
            StemRole::Piano,
        ]
        .map(|role| (role, &source[..]))
        .into_iter()
        .collect();
        let mut output = [[0.0; 2]];
        let peak = reopened.render_chunk(&stems, &mut output).unwrap();
        assert!((peak - 0.399_052_47).abs() < 1e-6);
        assert!((output[0][1] - -0.199_526_24).abs() < 1e-6);
    }

    #[test]
    fn four_stem_render_mutes_vocals_and_rejects_misaligned_inputs() {
        let neutral = StemMix::default();
        let recipe = MixRecipe::Four {
            vocals: StemMix::new(0, true, false).unwrap(),
            drums: neutral,
            bass: neutral,
            other: neutral,
        };
        let source = [[0.25, -0.125]];
        let mut stems = [
            StemRole::Vocals,
            StemRole::Drums,
            StemRole::Bass,
            StemRole::Other,
        ]
        .map(|role| (role, &source[..]))
        .into_iter()
        .collect();
        let mut output = [[0.0; 2]];
        assert_eq!(recipe.render_chunk(&stems, &mut output), Ok(0.75));
        assert_eq!(output, [[0.75, -0.375]]);

        stems.insert(StemRole::Bass, &[]);
        assert_eq!(
            recipe.render_chunk(&stems, &mut output),
            Err(MixError::FrameCount)
        );
        stems.remove(&StemRole::Bass);
        stems.insert(StemRole::Guitar, &source);
        assert_eq!(
            recipe.render_chunk(&stems, &mut output),
            Err(MixError::StemRoles)
        );
    }

    #[test]
    fn persisted_recipe_rejects_invalid_gain_and_wrong_stem_mode() {
        assert!(StemMix::new(61, false, false).is_none());
        let neutral = StemMix::default();
        let mut saved = serde_json::to_value(MixRecipe::Four {
            vocals: neutral,
            drums: neutral,
            bass: neutral,
            other: neutral,
        })
        .unwrap();
        saved["vocals"]["gain_tenths_db"] = 61.into();
        assert!(serde_json::from_value::<MixRecipe>(saved.clone()).is_err());
        saved["vocals"]["gain_tenths_db"] = 0.into();
        saved["guitar"] = serde_json::to_value(neutral).unwrap();
        assert!(serde_json::from_value::<MixRecipe>(saved).is_err());
    }

    #[test]
    fn late_peak_applies_one_gain_to_the_whole_staged_render() {
        let neutral = StemMix::default();
        let recipe = MixRecipe::Four {
            vocals: neutral,
            drums: neutral,
            bass: neutral,
            other: neutral,
        };
        let quiet = [0.125_f32, -0.125].map(f32::to_le_bytes).concat();
        let loud = [0.5_f32, -0.5].map(f32::to_le_bytes).concat();
        let mut pcm = quiet.repeat(RENDER_CHUNK_FRAMES);
        pcm.extend_from_slice(&loud);
        let mut stems = [
            StemRole::Vocals,
            StemRole::Drums,
            StemRole::Bass,
            StemRole::Other,
        ]
        .map(|role| (role, Cursor::new(pcm.as_slice())))
        .into_iter()
        .collect();
        let frames = RENDER_CHUNK_FRAMES as u64 + 1;
        let mut output = Vec::new();
        recipe.render_pcm(&mut stems, frames, &mut output).unwrap();
        assert_eq!(output.len(), frames as usize * 8);
        let first = f32::from_le_bytes(output[..4].try_into().unwrap());
        let last = f32::from_le_bytes(output[output.len() - 8..][..4].try_into().unwrap());
        assert!((first - MAX_MIX_PEAK * 0.25).abs() < 1e-6);
        assert!((last - MAX_MIX_PEAK).abs() < 1e-6);

        let mut invalid = Vec::new();
        assert!(
            recipe
                .render_pcm(&mut stems, frames - 1, &mut invalid)
                .is_err()
        );
        assert!(invalid.is_empty());
    }
}
