use super::*;
use alsa::{
    Ctl, PCM, ValueOr, card,
    ctl::DeviceIter,
    pcm::{Access, Format, HwParams},
};

fn direction(value: Direction) -> alsa::Direction {
    match value {
        Direction::Capture => alsa::Direction::Capture,
        Direction::Playback => alsa::Direction::Playback,
    }
}
fn format(value: SampleFormat) -> Format {
    match value {
        SampleFormat::S16 => Format::s16(),
        SampleFormat::S24 => Format::s24(),
        SampleFormat::S24Packed => Format::s24_3(),
        SampleFormat::S32 => Format::s32(),
        SampleFormat::Float => Format::float(),
    }
}

pub fn devices() -> Result<AudioDevices, String> {
    let mut result = AudioDevices {
        backend_available: true,
        streaming_available: false,
        endpoints: vec![],
        warnings: vec![],
    };
    // Bound malformed driver enumeration; partial results retain explicit warnings.
    for item in card::Iter::new().take(64) {
        let card = item.map_err(|e| e.to_string())?;
        let ctl = match Ctl::from_card(&card, true) {
            Ok(ctl) => ctl,
            Err(e) => {
                result
                    .warnings
                    .push(format!("Card {}: {e}", card.get_index()));
                continue;
            }
        };
        let info = ctl.card_info().map_err(|e| e.to_string())?;
        let id = info.get_id().map_err(|e| e.to_string())?;
        let name = info.get_name().map_err(|e| e.to_string())?;
        // IDs are used in ALSA's hardware-only name syntax, not accepted as arbitrary PCM expressions.
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            result.warnings.push(format!(
                "Card {} has an unsupported ALSA ID",
                card.get_index()
            ));
            continue;
        }
        for device in DeviceIter::new(&ctl).take(64) {
            for d in [Direction::Capture, Direction::Playback] {
                match ctl.pcm_info(device as u32, 0, direction(d)) {
                    Ok(pcm) => result.endpoints.push(AudioEndpoint {
                        id: format!("hw:CARD={id},DEV={device}"),
                        name: format!("{name} — {}", pcm.get_name().unwrap_or("PCM")),
                        direction: d,
                    }),
                    // ENOENT: no stream in this direction. All other errors remain visible.
                    Err(e) if e.errno() == 2 => (),
                    Err(e) => result.warnings.push(format!("{id}/{device} {d:?}: {e}")),
                }
            }
        }
    }
    Ok(result)
}

pub fn probe(request: &AudioProbe) -> Result<AudioProbeResult, String> {
    configure(request).map_err(|e| {
        format!("Audio probe failed (device busy, disconnected or unsupported settings): {e}")
    })
}
fn configure(request: &AudioProbe) -> Result<AudioProbeResult, Box<dyn std::error::Error>> {
    let pcm = PCM::new(&request.endpoint, direction(request.direction), true)?;
    let hw = HwParams::any(&pcm)?;
    hw.set_rate_resample(false)?;
    hw.set_access(Access::RWInterleaved)?;
    hw.set_format(format(request.format))?;
    hw.set_channels(request.channels)?;
    hw.set_rate(request.sample_rate, ValueOr::Nearest)?;
    hw.set_period_size(request.period_frames.into(), ValueOr::Nearest)?;
    hw.set_periods(request.periods, ValueOr::Nearest)?;
    let expected_buffer = request.period_frames * request.periods;
    hw.set_buffer_size(expected_buffer.into())?;
    pcm.hw_params(&hw)?;
    let actual = pcm.hw_params_current()?;
    if actual.get_rate()? != request.sample_rate
        || actual.get_channels()? != request.channels
        || actual.get_period_size()? != i64::from(request.period_frames)
        || actual.get_periods()? != request.periods
        || actual.get_buffer_size()? != i64::from(expected_buffer)
        || actual.get_format()? != format(request.format)
        || actual.get_access()? != Access::RWInterleaved
    {
        return Err("ALSA changed the requested configuration; no settings were retained".into());
    }
    // Handles and hw params drop here. No start, read, write or drain operation is issued.
    Ok(AudioProbeResult {
        configuration: request.clone(),
        buffer_frames: expected_buffer,
        streaming_available: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_alsa_null_pcm_configures_both_directions_and_releases() {
        // ALSA's own null plugin exercises real libasound without pretending to be a physical device.
        // It is deliberately unreachable through the public hardware-only probe API.
        for direction in [Direction::Capture, Direction::Playback] {
            for format in [
                SampleFormat::S16,
                SampleFormat::S24,
                SampleFormat::S24Packed,
                SampleFormat::S32,
                SampleFormat::Float,
            ] {
                let request = AudioProbe {
                    endpoint: "null".into(),
                    direction,
                    sample_rate: 48000,
                    channels: 2,
                    format,
                    period_frames: 128,
                    periods: 3,
                };
                for _ in 0..2 {
                    let result = probe(&request).unwrap();
                    assert_eq!(result.buffer_frames, 384);
                    assert!(!result.streaming_available);
                }
            }
        }
    }
    #[test]
    fn missing_pcm_is_a_real_failure() {
        let request = AudioProbe {
            endpoint: "hw:CARD=OXIDAL_MISSING,DEV=0".into(),
            direction: Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format: SampleFormat::S16,
            period_frames: 128,
            periods: 3,
        };
        assert!(probe(&request).is_err());
    }
}
