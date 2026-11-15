//! WAV download headers and PCM24 encoding for session media.

pub(crate) fn header(frames: u64, channels: u16, rate: u32) -> Option<[u8; 44]> {
    let data = frames.checked_mul(u64::from(channels) * 3)?;
    let data = u32::try_from(data).ok()?;
    let pad = data % 2;
    let riff = data.checked_add(36 + pad)?;
    let block = channels.checked_mul(3)?;
    let byte_rate = rate.checked_mul(u32::from(block))?;
    let mut header = [0; 44];
    header[..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&riff.to_le_bytes());
    header[8..16].copy_from_slice(b"WAVEfmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&channels.to_le_bytes());
    header[24..28].copy_from_slice(&rate.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&block.to_le_bytes());
    header[34..36].copy_from_slice(&24u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data.to_le_bytes());
    Some(header)
}

pub(crate) fn encode(samples: &[u8], output: &mut Vec<u8>) {
    for &sample in samples.as_chunks::<4>().0 {
        let value = f32::from_le_bytes(sample);
        let value = if value.is_finite() {
            value.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let packed = (value * 8_388_607.0).round() as i32;
        output.extend_from_slice(&packed.to_le_bytes()[..3]);
    }
}

/// Wrap the stored f32 samples unchanged. The fact chunk records the
/// frame count for the non-PCM format.
pub(crate) fn stem_header(frames: u64, rate: u32) -> Option<[u8; 58]> {
    let frames = u32::try_from(frames).ok()?;
    let data = frames.checked_mul(8)?;
    let size = data.checked_add(50)?;
    let byte_rate = rate.checked_mul(8)?;
    let mut header = [0; 58];
    header[..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&size.to_le_bytes());
    header[8..16].copy_from_slice(b"WAVEfmt ");
    header[16..20].copy_from_slice(&18u32.to_le_bytes());
    header[20..22].copy_from_slice(&3u16.to_le_bytes()); // IEEE float
    header[22..24].copy_from_slice(&2u16.to_le_bytes());
    header[24..28].copy_from_slice(&rate.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&8u16.to_le_bytes());
    header[34..36].copy_from_slice(&32u16.to_le_bytes());
    header[38..42].copy_from_slice(b"fact");
    header[42..46].copy_from_slice(&4u32.to_le_bytes());
    header[46..50].copy_from_slice(&frames.to_le_bytes());
    header[50..54].copy_from_slice(b"data");
    header[54..58].copy_from_slice(&data.to_le_bytes());
    Some(header)
}
