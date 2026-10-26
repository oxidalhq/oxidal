//! Native-endian interleaved PCM conversion. Called with preallocated buffers.
use crate::SampleFormat;

pub(crate) fn width(format: SampleFormat) -> usize {
    match format {
        SampleFormat::S16 => 2,
        SampleFormat::S24Packed => 3,
        SampleFormat::S24 | SampleFormat::S32 | SampleFormat::Float => 4,
    }
}

pub(crate) fn decode(bytes: &[u8], format: SampleFormat) -> Result<f32, &'static str> {
    let value = match format {
        SampleFormat::S16 => {
            i16::from_ne_bytes(bytes.try_into().map_err(|_| "PCM width")?) as f32 / 32768.0
        }
        SampleFormat::S24 => {
            let raw = i32::from_ne_bytes(bytes.try_into().map_err(|_| "PCM width")?);
            ((raw << 8) >> 8) as f32 / 8388608.0
        }
        SampleFormat::S24Packed => {
            let raw: [u8; 3] = bytes.try_into().map_err(|_| "PCM width")?;
            let expanded = if cfg!(target_endian = "little") {
                [raw[0], raw[1], raw[2], 0]
            } else {
                [0, raw[0], raw[1], raw[2]]
            };
            ((i32::from_ne_bytes(expanded) << 8) >> 8) as f32 / 8388608.0
        }
        SampleFormat::S32 => {
            i32::from_ne_bytes(bytes.try_into().map_err(|_| "PCM width")?) as f32 / 2147483648.0
        }
        SampleFormat::Float => f32::from_ne_bytes(bytes.try_into().map_err(|_| "PCM width")?),
    };
    if !value.is_finite() {
        return Err("Nonfinite capture sample");
    }
    Ok(value)
}

pub(crate) fn encode(
    value: f32,
    format: SampleFormat,
    bytes: &mut [u8],
) -> Result<(), &'static str> {
    if !value.is_finite() || bytes.len() != width(format) {
        return Err("Invalid playback sample");
    }
    let clipped = f64::from(value).clamp(-1.0, 1.0);
    match format {
        SampleFormat::S16 => bytes.copy_from_slice(
            &((clipped * 32768.0).round().clamp(-32768.0, 32767.0) as i16).to_ne_bytes(),
        ),
        SampleFormat::S24 | SampleFormat::S24Packed => {
            let raw =
                ((clipped * 8388608.0).round().clamp(-8388608.0, 8388607.0) as i32).to_ne_bytes();
            if matches!(format, SampleFormat::S24) {
                bytes.copy_from_slice(&raw);
            } else if cfg!(target_endian = "little") {
                bytes.copy_from_slice(&raw[..3]);
            } else {
                bytes.copy_from_slice(&raw[1..]);
            }
        }
        SampleFormat::S32 => bytes.copy_from_slice(
            &((clipped * 2147483648.0)
                .round()
                .clamp(-2147483648.0, 2147483647.0) as i32)
                .to_ne_bytes(),
        ),
        SampleFormat::Float => bytes.copy_from_slice(&value.to_ne_bytes()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_signed_boundaries_and_float_without_wrapping() {
        for format in [
            SampleFormat::S16,
            SampleFormat::S24,
            SampleFormat::S24Packed,
            SampleFormat::S32,
            SampleFormat::Float,
        ] {
            for value in [-1.0, -0.5, 0.0, 0.5, 1.0] {
                let mut bytes = vec![0; width(format)];
                encode(value, format, &mut bytes).unwrap();
                assert!((decode(&bytes, format).unwrap() - value).abs() <= 1.0 / 32768.0);
            }
            let mut bytes = vec![0; width(format)];
            assert!(encode(f32::NAN, format, &mut bytes).is_err());
            encode(2.0, format, &mut bytes).unwrap();
            let result = decode(&bytes, format).unwrap();
            if matches!(format, SampleFormat::Float) {
                assert_eq!(result, 2.0);
            } else {
                assert!(result > 0.99 && result <= 1.0);
            }
        }
        assert_eq!(
            decode(&(-1_i16).to_ne_bytes(), SampleFormat::S16).unwrap(),
            -1.0 / 32768.0
        );
        assert_eq!(
            decode(&[255; 3], SampleFormat::S24Packed).unwrap(),
            -1.0 / 8388608.0
        );
        assert!(decode(&f32::INFINITY.to_ne_bytes(), SampleFormat::Float).is_err());
    }
}
