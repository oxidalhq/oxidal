//! Backing-track import: probe, decode, resample and measure an uploaded WAV
//! or MP3 into a play-ready float32 render, then finalize it as an asset. Runs
//! on one low-priority background thread, one file at a time, never in the
//! audio path. Decoding and resampling stream in bounded chunks, so a long
//! track never sits whole in memory.
//! @see docs/media.md
use crate::media::{
    MediaError, MediaKind, MediaManifest, MediaPlayback, MediaRender, MediaSource, SCHEMA, Store,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CODEC_TYPE_MP3, CODEC_TYPE_NULL, DecoderOptions};
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Loudness every track is trimmed toward by default.
pub(crate) const TARGET_LUFS: f64 = -18.0;
const TRIM_RANGE: (f64, f64) = (-24.0, 6.0);
/// Peaks are never trimmed above this.
const PEAK_CEILING_DBFS: f64 = -1.0;
const CHUNK: usize = 4096;
pub(crate) const RESAMPLER: &str = "rubato sinc 256 blackman-harris2 v1";

/// What the upload declared.
#[derive(Debug, Clone)]
pub(crate) struct ImportRequest {
    pub title: String,
    pub wav: bool,
    pub kind: MediaKind,
    /// Stream rate the render is made for.
    pub rate: u32,
}

/// Progress callback: fraction of the source decoded, 0–1.
pub(crate) type Progress<'a> = &'a mut dyn FnMut(f64);

/// Decode a stem with the same rate conversion as backing track import.
pub(crate) fn render_stem(
    source: &Path,
    wav: bool,
    rate: u32,
    target: &Path,
    store: &Store,
    allowed: impl Fn() -> bool,
) -> Result<(u64, u16), MediaError> {
    let rendered = render(source, wav, rate, target, store, &mut |_| {}, allowed)?;
    Ok((rendered.frames, rendered.channels))
}

/// SHA-256 of the original, to spot an import that is already in Library.
pub(crate) fn hash_file(path: &Path) -> Result<String, MediaError> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Turns a received upload into an asset. The upload file is moved into the
/// staged asset as its original; on failure nothing is left behind.
pub(crate) fn import(
    store: &Store,
    upload: &Path,
    request: &ImportRequest,
    progress: Progress<'_>,
) -> Result<MediaManifest, MediaError> {
    let staging = store.stage()?;
    let result = (|| {
        let original = if request.wav {
            "original.wav"
        } else {
            "original.mp3"
        };
        let original_path = staging.file(original)?;
        fs::rename(upload, &original_path)?;
        let bytes = fs::metadata(&original_path)?.len();
        let sha256 = hash_file(&original_path)?;
        let render_name = format!("play-{}.f32", request.rate);
        let rendered = render(
            &original_path,
            request.wav,
            request.rate,
            &staging.file(&render_name)?,
            store,
            progress,
            || true,
        )?;
        let trim_db = trim_for(rendered.loudness_lufs, rendered.peak_dbfs);
        let manifest = MediaManifest {
            schema: SCHEMA,
            id: staging.id.clone(),
            kind: request.kind,
            title: request.title.clone(),
            created_at: crate::media::now_iso(),
            source: Some(MediaSource {
                file: original.into(),
                bytes,
                sha256,
                container: rendered.container.into(),
                codec: rendered.codec,
                rate: rendered.source_rate,
                channels: rendered.channels,
                frames: rendered.source_frames,
                lossy: !request.wav,
            }),
            renders: vec![MediaRender {
                file: render_name,
                rate: request.rate,
                channels: rendered.channels,
                frames: rendered.frames,
                sha256: rendered.sha256,
                resampler: (rendered.source_rate != request.rate).then(|| RESAMPLER.into()),
                peak_dbfs: Some(round1(rendered.peak_dbfs)),
                loudness_lufs: rendered.loudness_lufs.map(round1),
            }],
            playback: MediaPlayback { trim_db },
            provenance: None,
        };
        Ok(manifest)
    })();
    match result {
        Ok(manifest) => {
            store.finalize(staging, &manifest)?;
            Ok(manifest)
        }
        Err(error) => {
            let _ = store.abandon(staging);
            Err(error)
        }
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Default track trim: toward −18 LUFS, within −24…+6 dB, and never pushing
/// the peak above −1 dBFS. Silence keeps 0 dB.
pub(crate) fn trim_for(loudness_lufs: Option<f64>, peak_dbfs: f64) -> f64 {
    let Some(lufs) = loudness_lufs.filter(|l| l.is_finite()) else {
        return 0.0;
    };
    let toward = (TARGET_LUFS - lufs).clamp(TRIM_RANGE.0, TRIM_RANGE.1);
    let ceiling = if peak_dbfs.is_finite() {
        PEAK_CEILING_DBFS - peak_dbfs
    } else {
        TRIM_RANGE.1
    };
    round1(toward.min(ceiling).max(TRIM_RANGE.0))
}

struct Rendered {
    container: &'static str,
    codec: String,
    source_rate: u32,
    source_frames: u64,
    channels: u16,
    frames: u64,
    sha256: String,
    peak_dbfs: f64,
    loudness_lufs: Option<f64>,
}

/// Streams the render to `target`, hashing and measuring as it writes.
struct Sink {
    out: BufWriter<fs::File>,
    hasher: Sha256,
    meter: ebur128::EbuR128,
    peak: f32,
    frames: u64,
    channels: usize,
    written_since_check: u64,
}
impl Sink {
    fn push(&mut self, interleaved: &[f32], store: &Store) -> Result<(), MediaError> {
        let mut bytes = Vec::with_capacity(interleaved.len() * 4);
        for s in interleaved {
            let s = if s.is_finite() { *s } else { 0.0 };
            self.peak = self.peak.max(s.abs());
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        self.meter
            .add_frames_f32(interleaved)
            .map_err(|e| MediaError::Invalid(format!("loudness: {e}")))?;
        self.hasher.update(&bytes);
        self.out.write_all(&bytes)?;
        self.frames += (interleaved.len() / self.channels) as u64;
        // Re-admit space every few MiB so a full card stops the import early.
        self.written_since_check += bytes.len() as u64;
        if self.written_since_check >= 4 << 20 {
            store.admit(self.written_since_check)?;
            self.written_since_check = 0;
        }
        Ok(())
    }
}

fn reject(reason: &str) -> MediaError {
    MediaError::Invalid(reason.into())
}

fn render(
    source: &Path,
    wav: bool,
    rate: u32,
    target: &Path,
    store: &Store,
    progress: Progress<'_>,
    allowed: impl Fn() -> bool,
) -> Result<Rendered, MediaError> {
    let file = fs::File::open(source)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(if wav { "wav" } else { "mp3" });
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            // Gapless: drop the encoder delay and padding MP3 files carry.
            &FormatOptions {
                enable_gapless: true,
                ..FormatOptions::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|_| {
            reject(if wav {
                "Not a readable WAV file"
            } else {
                "Not a readable MP3 file"
            })
        })?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .filter(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| reject("The file has no audio track"))?
        .clone();
    let params = &track.codec_params;
    let is_mp3 = params.codec == CODEC_TYPE_MP3;
    if wav == is_mp3 {
        return Err(reject(
            "The file's contents do not match its .wav or .mp3 name",
        ));
    }
    let source_rate = params
        .sample_rate
        .filter(|r| (8_000..=192_000).contains(r))
        .ok_or_else(|| reject("Sample rate must be 8–192 kHz"))?;
    let channels = params
        .channels
        .map(|c| c.count())
        .filter(|c| (1..=2).contains(c))
        .ok_or_else(|| reject("Only mono and stereo files are supported"))?;
    let codec = symphonia::default::get_codecs()
        .get_codec(params.codec)
        .map_or_else(|| "unknown".into(), |d| d.short_name.to_owned());
    let total = params.n_frames;
    let mut decoder = symphonia::default::get_codecs()
        .make(params, &DecoderOptions::default())
        .map_err(|_| reject("This WAV or MP3 encoding is not supported"))?;
    let track_id = track.id;

    let ratio = f64::from(rate) / f64::from(source_rate);
    let mut resampler = if source_rate == rate {
        None
    } else {
        use rubato::{
            SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
        };
        let parameters = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Cubic,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };
        Some(
            SincFixedIn::<f32>::new(ratio, 1.0, parameters, CHUNK, channels)
                .map_err(|e| MediaError::Invalid(format!("resampler: {e}")))?,
        )
    };
    let mut sink = Sink {
        out: BufWriter::with_capacity(256 * 1024, fs::File::create(target)?),
        hasher: Sha256::new(),
        meter: ebur128::EbuR128::new(
            channels as u32,
            rate,
            ebur128::Mode::I | ebur128::Mode::SAMPLE_PEAK,
        )
        .map_err(|e| MediaError::Invalid(format!("loudness: {e}")))?,
        peak: 0.0,
        frames: 0,
        channels,
        written_since_check: 0,
    };
    let mut planar: Vec<Vec<f32>> = vec![Vec::with_capacity(CHUNK * 2); channels];
    let mut decoded_frames = 0u64;
    let mut skip = resampler
        .as_ref()
        .map_or(0, |r: &rubato::SincFixedIn<f32>| {
            use rubato::Resampler;
            r.output_delay()
        });
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    let emit = |resampler: &mut Option<rubato::SincFixedIn<f32>>,
                planar: &mut Vec<Vec<f32>>,
                flush: bool,
                sink: &mut Sink,
                skip: &mut usize|
     -> Result<(), MediaError> {
        use rubato::Resampler;
        let Some(resampler) = resampler else {
            let frames = planar[0].len();
            let mut interleaved = Vec::with_capacity(frames * channels);
            for i in 0..frames {
                for channel in planar.iter() {
                    interleaved.push(channel[i]);
                }
            }
            planar.iter_mut().for_each(Vec::clear);
            return sink.push(&interleaved, store);
        };
        loop {
            let needed = resampler.input_frames_next();
            let available = planar[0].len();
            let output = if available >= needed {
                let input: Vec<&[f32]> = planar.iter().map(|c| &c[..needed]).collect();
                let output = resampler
                    .process(&input, None)
                    .map_err(|e| MediaError::Invalid(format!("resampler: {e}")))?;
                planar.iter_mut().for_each(|c| {
                    c.drain(..needed);
                });
                output
            } else if flush && available > 0 {
                let input: Vec<&[f32]> = planar.iter().map(|c| &c[..]).collect();
                let output = resampler
                    .process_partial(Some(&input), None)
                    .map_err(|e| MediaError::Invalid(format!("resampler: {e}")))?;
                planar.iter_mut().for_each(Vec::clear);
                output
            } else {
                return Ok(());
            };
            let frames = output[0].len();
            let start = (*skip).min(frames);
            *skip -= start;
            let mut interleaved = Vec::with_capacity((frames - start) * channels);
            for i in start..frames {
                for channel in &output {
                    interleaved.push(channel[i]);
                }
            }
            sink.push(&interleaved, store)?;
        }
    };
    let mut corrupt = 0usize;
    loop {
        if !allowed() {
            return Err(reject("Stem preparation interrupted"));
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(DecodeError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(DecodeError::ResetRequired) => break,
            Err(_) => return Err(reject("The file is damaged and cannot be read")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A few damaged MP3 frames are skipped, as players do; many are not.
            Err(DecodeError::DecodeError(_)) => {
                corrupt += 1;
                if corrupt > 16 {
                    return Err(reject("The file is damaged and cannot be read"));
                }
                continue;
            }
            Err(_) => return Err(reject("The file is damaged and cannot be read")),
        };
        if decoded.frames() == 0 {
            continue;
        }
        let buffer = sample_buffer
            .get_or_insert_with(|| SampleBuffer::new(decoded.capacity() as u64, *decoded.spec()));
        if buffer.capacity() < decoded.capacity() * channels {
            *buffer = SampleBuffer::new(decoded.capacity() as u64, *decoded.spec());
        }
        buffer.copy_interleaved_ref(decoded);
        let samples = buffer.samples();
        for frame in samples.chunks_exact(channels) {
            for (c, s) in frame.iter().enumerate() {
                planar[c].push(*s);
            }
        }
        decoded_frames += (samples.len() / channels) as u64;
        if planar[0].len() >= CHUNK {
            emit(&mut resampler, &mut planar, false, &mut sink, &mut skip)?;
        }
        if let Some(total) = total.filter(|t| *t > 0) {
            progress((decoded_frames as f64 / total as f64).min(1.0));
        }
    }
    if decoded_frames == 0 {
        let _ = fs::remove_file(target);
        return Err(reject("The file contains no audio"));
    }
    emit(&mut resampler, &mut planar, true, &mut sink, &mut skip)?;
    // Resampled length is the source length at the new rate; flush the filter
    // tail with silence until it is reached, then drop any excess.
    let expected = if resampler.is_some() {
        (decoded_frames as f64 * ratio).round() as u64
    } else {
        decoded_frames
    };
    while sink.frames < expected && resampler.is_some() {
        planar.iter_mut().for_each(|c| c.resize(CHUNK, 0.0));
        let before = sink.frames;
        emit(&mut resampler, &mut planar, true, &mut sink, &mut skip)?;
        if sink.frames == before {
            break;
        }
    }
    let Sink {
        out,
        hasher,
        meter,
        peak,
        frames,
        ..
    } = sink;
    let file = out
        .into_inner()
        .map_err(|e| MediaError::Io(e.to_string()))?;
    let (frames, sha256) = if frames > expected {
        // Drop the resampler's excess tail and hash only what is kept.
        file.set_len(expected * channels as u64 * 4)?;
        file.sync_all()?;
        drop(file);
        (expected, hash_file(target)?)
    } else {
        file.sync_all()?;
        (frames, hex(&hasher.finalize()))
    };
    let peak_dbfs = if peak > 0.0 {
        20.0 * f64::from(peak).log10()
    } else {
        -120.0
    };
    Ok(Rendered {
        container: if is_mp3 { "mp3" } else { "wav" },
        codec,
        source_rate,
        source_frames: decoded_frames,
        channels: channels as u16,
        frames,
        sha256,
        peak_dbfs,
        loudness_lufs: meter.loudness_global().ok().filter(|l| l.is_finite()),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::media::Store;

    /// A PCM or float WAV with a 997 Hz tone at −6 dBFS.
    pub(crate) fn wav(rate: u32, channels: u16, bits: u16, float: bool, seconds: f64) -> Vec<u8> {
        let frames = (f64::from(rate) * seconds) as u32;
        let block = channels * bits / 8;
        let data = frames * u32::from(block);
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&(if float { 3u16 } else { 1u16 }).to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * u32::from(block)).to_le_bytes());
        out.extend_from_slice(&block.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data.to_le_bytes());
        for i in 0..frames {
            let v = (std::f64::consts::TAU * 997.0 * f64::from(i) / f64::from(rate)).sin() * 0.5;
            for _ in 0..channels {
                match (bits, float) {
                    (32, true) => out.extend_from_slice(&(v as f32).to_le_bytes()),
                    (16, false) => out.extend_from_slice(&((v * 32767.0) as i16).to_le_bytes()),
                    (24, false) => {
                        out.extend_from_slice(&((v * 8_388_607.0) as i32).to_le_bytes()[..3])
                    }
                    (32, false) => {
                        out.extend_from_slice(&((v * 2_147_483_647.0) as i32).to_le_bytes())
                    }
                    _ => unreachable!(),
                }
            }
        }
        out
    }

    fn fixture(name: &str) -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/media")
                .join(name),
        )
        .unwrap()
    }

    fn temp_store() -> (std::path::PathBuf, Store) {
        let root = std::env::temp_dir().join(format!("oxidal-import-{}", crate::media::new_id()));
        let store = Store::open(&root).unwrap();
        (root, store)
    }

    fn run(store: &Store, bytes: &[u8], wav: bool, rate: u32) -> Result<MediaManifest, MediaError> {
        let upload = store.upload_part(&crate::media::new_id()).unwrap();
        fs::write(&upload, bytes).unwrap();
        let mut last = 0.0;
        let result = import(
            store,
            &upload,
            &ImportRequest {
                title: "Test".into(),
                wav,
                kind: MediaKind::Backing,
                rate,
            },
            &mut |p| {
                assert!(p >= last && p <= 1.0);
                last = p;
            },
        );
        assert!(!upload.exists(), "the upload is consumed either way");
        result
    }

    fn render_samples(store: &Store, manifest: &MediaManifest) -> Vec<f32> {
        let render = &manifest.renders[0];
        fs::read(store.file(&manifest.id, &render.file).unwrap())
            .unwrap()
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect()
    }

    #[test]
    fn every_wav_encoding_imports_to_the_expected_frames_at_48k() {
        let (root, store) = temp_store();
        for (rate, channels, bits, float) in [
            (44_100, 2, 16, false),
            (48_000, 1, 24, false),
            (96_000, 2, 32, false),
            (44_100, 1, 32, true),
        ] {
            let manifest = run(&store, &wav(rate, channels, bits, float, 1.0), true, 48_000)
                .unwrap_or_else(|e| panic!("{rate} {channels} {bits} {float}: {e:?}"));
            let render = &manifest.renders[0];
            assert_eq!(render.channels, channels);
            assert_eq!(render.frames, 48_000, "{rate} Hz → exactly one second");
            let source = manifest.source.as_ref().unwrap();
            assert_eq!(
                (source.rate, source.frames, source.lossy),
                (rate, u64::from(rate), false)
            );
            assert_eq!(render.resampler.is_some(), rate != 48_000);
            // −6 dBFS tone keeps its level through decode and resample.
            let samples = render_samples(&store, &manifest);
            let peak = samples[4800..43_200]
                .iter()
                .fold(0.0f32, |m, v| m.max(v.abs()));
            assert!((peak - 0.5).abs() < 0.01, "{rate}/{bits}: peak {peak}");
            assert!((render.peak_dbfs.unwrap() + 6.0).abs() < 0.2);
            // A sine at −6 dBFS peak is about −9 LUFS (−3 dB RMS, K-weighted near 1 kHz),
            // stereo adds 3 LU; the trim brings it toward −18 LUFS.
            let lufs = render.loudness_lufs.unwrap();
            let expected = if channels == 2 { -6.0 } else { -9.0 };
            assert!((lufs - expected).abs() < 0.6, "{lufs}");
            assert!((manifest.playback.trim_db - (TARGET_LUFS - lufs)).abs() < 0.11);
            assert_eq!(
                render.sha256,
                hash_file(&store.file(&manifest.id, &render.file).unwrap()).unwrap()
            );
        }
        assert_eq!(store.list().unwrap().len(), 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mp3_cbr_and_vbr_decode_and_resample_to_the_source_length() {
        let (root, store) = temp_store();
        for (name, channels) in [
            ("tone-44k-stereo-cbr128.mp3", 2),
            ("tone-44k-mono-vbr.mp3", 1),
            ("tone-48k-stereo-cbr192.mp3", 2),
        ] {
            let manifest = run(&store, &fixture(name), false, 48_000).unwrap();
            let source = manifest.source.as_ref().unwrap();
            let render = &manifest.renders[0];
            assert_eq!(
                (source.codec.as_str(), source.lossy, render.channels),
                ("mp3", true, channels)
            );
            // Gapless decode: one second of music, without encoder padding.
            assert!(
                source.frames.abs_diff(u64::from(source.rate)) <= 1152,
                "{name}: {}",
                source.frames
            );
            let expected =
                (source.frames as f64 * 48_000.0 / f64::from(source.rate)).round() as u64;
            assert!(
                render.frames.abs_diff(expected) <= 2,
                "{name}: {} vs {expected}",
                render.frames
            );
            assert!(
                (render.peak_dbfs.unwrap() + 6.0).abs() < 1.0,
                "{name}: peak {:?} frames {} source {:?}",
                render.peak_dbfs,
                render.frames,
                source
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bad_files_are_rejected_with_a_reason_and_leave_nothing() {
        let (root, store) = temp_store();
        let cases: [(&[u8], bool, &str); 4] = [
            (b"not audio at all", true, "readable WAV"),
            (&wav(44_100, 2, 16, false, 0.2), false, "match"),
            (&wav(44_100, 2, 16, false, 0.0), true, "no audio"),
            (
                b"ID3\x03\x00\x00\x00\x00\x00\x00garbage",
                false,
                "readable MP3",
            ),
        ];
        for (bytes, is_wav, reason) in cases {
            match run(&store, bytes, is_wav, 48_000) {
                Err(MediaError::Invalid(message)) => assert!(message.contains(reason), "{message}"),
                other => panic!("expected rejection, got {other:?}"),
            }
        }
        // Three channels.
        let mut surround = wav(48_000, 2, 16, false, 0.1);
        surround[22] = 3;
        assert!(matches!(
            run(&store, &surround, true, 48_000),
            Err(MediaError::Invalid(_))
        ));
        assert!(store.list().unwrap().is_empty());
        assert_eq!(fs::read_dir(root.join("incoming")).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trim_targets_minus_18_lufs_within_range_and_under_the_peak_ceiling() {
        assert_eq!(trim_for(Some(-12.0), -3.0), -6.0);
        assert_eq!(trim_for(Some(-30.0), -20.0), 6.0, "limited to +6");
        assert_eq!(trim_for(Some(-24.0), -2.0), 1.0, "peak stays at −1 dBFS");
        assert_eq!(trim_for(Some(10.0), 0.0), -24.0);
        assert_eq!(trim_for(None, -120.0), 0.0, "silence is not boosted");
    }
}
