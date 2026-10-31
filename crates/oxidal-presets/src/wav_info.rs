//! Informational WAV headers, independent of playback admission.
//! Reads bounded chunk headers and skips sample data; never infers from a filename.
use std::io::{Read, Seek, SeekFrom};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub floating_point: bool,
    pub frames: u64,
    pub duration_ms: f64,
}

impl WavInfo {
    pub(crate) fn read(reader: &mut (impl Read + Seek), len: u64) -> Option<Self> {
        let mut header = [0; 12];
        reader.read_exact(&mut header).ok()?;
        if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
            return None;
        }
        let end = u64::from(u32::from_le_bytes(header[4..8].try_into().ok()?)) + 8;
        if end > len || end < 12 {
            return None;
        }
        let (mut position, mut format, mut data) = (12u64, None, None);
        for _ in 0..64 {
            if position.checked_add(8)? > end {
                break;
            }
            reader.seek(SeekFrom::Start(position)).ok()?;
            let mut chunk = [0; 8];
            reader.read_exact(&mut chunk).ok()?;
            let size = u64::from(u32::from_le_bytes(chunk[4..].try_into().ok()?));
            let start = position + 8;
            if start.checked_add(size)? > end {
                return None;
            }
            if &chunk[..4] == b"fmt " {
                if size < 16 {
                    return None;
                }
                let mut bytes = [0; 40];
                let count = usize::try_from(size.min(40)).ok()?;
                reader.read_exact(&mut bytes[..count]).ok()?;
                let word = |offset| u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
                let mut code = word(0);
                let channels = word(2);
                let rate = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
                let align = word(12);
                let mut bits = word(14);
                if align != channels.checked_mul(bits.div_ceil(8))? {
                    return None;
                }
                if code == 0xfffe {
                    if size < 40
                        || word(16) < 22
                        || bytes[26..40] != [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]
                    {
                        return None;
                    }
                    code = word(24);
                    let valid = word(18);
                    if valid > bits {
                        return None;
                    }
                    if valid != 0 {
                        bits = valid;
                    }
                }
                if !matches!(code, 1 | 3)
                    || (code == 3 && !matches!(bits, 32 | 64))
                    || channels == 0
                    || rate == 0
                    || align == 0
                    || bits == 0
                    || bits > 64
                {
                    return None;
                }
                format = Some((channels, rate, align, bits, code == 3));
            } else if &chunk[..4] == b"data" {
                data = Some(size);
            }
            if format.is_some() && data.is_some() {
                break;
            }
            position = start.checked_add(size)?.checked_add(size % 2)?;
        }
        let (channels, sample_rate, align, bits_per_sample, floating_point) = format?;
        let data = data?;
        if data % u64::from(align) != 0 {
            return None;
        }
        let frames = data / u64::from(align);
        Some(Self {
            sample_rate,
            channels,
            bits_per_sample,
            floating_point,
            frames,
            duration_ms: frames as f64 * 1000.0 / f64::from(sample_rate),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn wav(rate: u32, code: u16, bits: u16, channels: u16) -> Vec<u8> {
        let align = channels * bits / 8;
        let size = rate / 5 * u32::from(align);
        let mut b = b"RIFF".to_vec();
        b.extend((36 + size).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(code.to_le_bytes());
        b.extend(channels.to_le_bytes());
        b.extend(rate.to_le_bytes());
        b.extend((rate * u32::from(align)).to_le_bytes());
        b.extend(align.to_le_bytes());
        b.extend(bits.to_le_bytes());
        b.extend(b"data");
        b.extend(size.to_le_bytes());
        b.resize(b.len() + size as usize, 0);
        b
    }
    #[test]
    fn actual_header_values_and_float_stereo_are_reported() {
        for (rate, code, bits, channels) in [(48000, 1, 24, 1), (96000, 3, 32, 2)] {
            let bytes = wav(rate, code, bits, channels);
            let info = WavInfo::read(&mut Cursor::new(&bytes), bytes.len() as u64).unwrap();
            assert_eq!(info.sample_rate, rate);
            assert_eq!(info.channels, channels);
            assert_eq!(info.bits_per_sample, bits);
            assert_eq!(info.floating_point, code == 3);
            assert_eq!(info.duration_ms, 200.0);
        }
    }
    #[test]
    fn skips_odd_unknown_chunks_and_never_reads_samples() {
        struct Counted {
            inner: Cursor<Vec<u8>>,
            bytes: usize,
        }
        impl Read for Counted {
            fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
                let n = self.inner.read(b)?;
                self.bytes += n;
                Ok(n)
            }
        }
        impl Seek for Counted {
            fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
                self.inner.seek(pos)
            }
        }
        let mut bytes = wav(48000, 1, 24, 1);
        bytes.splice(12..12, [b'J', b'U', b'N', b'K', 1, 0, 0, 0, 0, 0]);
        let riff = (bytes.len() as u32 - 8).to_le_bytes();
        bytes[4..8].copy_from_slice(&riff);
        let len = bytes.len() as u64;
        let mut reader = Counted {
            inner: Cursor::new(bytes),
            bytes: 0,
        };
        assert_eq!(WavInfo::read(&mut reader, len).unwrap().sample_rate, 48000);
        assert!(reader.bytes < 100);
    }
    #[test]
    fn malformed_bounds_and_unsupported_encodings_are_unknown() {
        let bytes = wav(48000, 1, 24, 1);
        assert!(WavInfo::read(&mut Cursor::new(&bytes), 20).is_none());
        let mut bad = bytes.clone();
        bad[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(WavInfo::read(&mut Cursor::new(&bad), bad.len() as u64).is_none());
        let bad = wav(48000, 6, 8, 1);
        assert!(WavInfo::read(&mut Cursor::new(&bad), bad.len() as u64).is_none());
    }
    #[test]
    fn extensible_pcm_uses_valid_bits_and_container_frame_size() {
        let mut bytes = wav(48000, 1, 24, 1);
        bytes[16..20].copy_from_slice(&40u32.to_le_bytes());
        bytes[20..22].copy_from_slice(&0xfffeu16.to_le_bytes());
        let mut extension = Vec::new();
        extension.extend(22u16.to_le_bytes());
        extension.extend(20u16.to_le_bytes());
        extension.extend(0u32.to_le_bytes());
        extension.extend([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]);
        bytes.splice(36..36, extension);
        let size = bytes.len() as u32 - 8;
        bytes[4..8].copy_from_slice(&size.to_le_bytes());
        let info = WavInfo::read(&mut Cursor::new(&bytes), bytes.len() as u64).unwrap();
        assert_eq!(info.bits_per_sample, 20);
        assert_eq!(info.frames, 9600);
        assert_eq!(info.duration_ms, 200.0);
    }
}
