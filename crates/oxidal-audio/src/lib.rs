//! Audio-device discovery, exact probes and experimental Linux duplex transport.
//! @see docs/audio.md
pub mod eq;
pub mod lifecycle;
pub mod meter;
pub mod midi;
#[allow(unsafe_code)]
pub mod realtime;
pub mod structure;
pub mod tools;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[cfg(all(target_os = "linux", feature = "alsa"))]
mod linux;
#[cfg(any(test, all(target_os = "linux", feature = "alsa")))]
mod samples;
#[cfg(all(target_os = "linux", feature = "alsa"))]
pub mod stream;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Capture,
    Playback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SampleFormat {
    S16,
    S24,
    S24Packed,
    S32,
    Float,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioEndpoint {
    /// ALSA card ID plus PCM device; re-enumerate before using it. Not a USB serial number.
    pub id: String,
    pub name: String,
    pub direction: Direction,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioDevices {
    pub backend_available: bool,
    /// Discovery support must never be mistaken for an implemented playback engine.
    pub streaming_available: bool,
    pub endpoints: Vec<AudioEndpoint>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioProbe {
    pub endpoint: String,
    pub direction: Direction,
    pub sample_rate: u32,
    pub channels: u32,
    pub format: SampleFormat,
    pub period_frames: u32,
    pub periods: u32,
}

impl AudioProbe {
    pub fn validate(&self) -> Result<(), String> {
        if self.endpoint.is_empty()
            || self.endpoint.len() > 160
            || !(8000..=192000).contains(&self.sample_rate)
            || !(1..=64).contains(&self.channels)
            || !(16..=8192).contains(&self.period_frames)
            || !(2..=8).contains(&self.periods)
        {
            return Err("Invalid audio probe bounds".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StreamConfig {
    #[serde(default = "crate::tools::hear_yourself_default")]
    pub hear_yourself: bool,
    /// Unit-wide input trim and master level; the daemon fills these at every start.
    #[serde(default)]
    pub levels: crate::tools::HostLevels,
    pub input: AudioProbe,
    pub output: AudioProbe,
    /// Zero-based channels; duplicate input indexes copy mono to both processor channels.
    pub input_map: [u32; 2],
    /// Duplicate output indexes mix the stereo processor output equally into mono.
    pub output_map: [u32; 2],
}
impl StreamConfig {
    pub fn validate(&self) -> Result<(), String> {
        self.input.validate()?;
        self.output.validate()?;
        if self.input.direction != Direction::Capture
            || self.output.direction != Direction::Playback
            || self.input.sample_rate != self.output.sample_rate
            || self.input.period_frames != self.output.period_frames
            || self.input.period_frames > 2048
            || self.input_map.iter().any(|&c| c >= self.input.channels)
            || self.output_map.iter().any(|&c| c >= self.output.channels)
        {
            return Err(
                "Incompatible stream directions, rate, block size or channel mapping".into(),
            );
        }
        if self.input.endpoint != self.output.endpoint {
            return Err("Independent input/output devices require clock-drift handling; this experimental stream requires one duplex endpoint".into());
        }
        self.levels.validate()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AudioProbeResult {
    pub configuration: AudioProbe,
    pub buffer_frames: u32,
    /// Only a point-in-time open/configure/readback/close check, never live readiness.
    pub streaming_available: bool,
}

/// Enumerates hardware without opening PCM streams, so refreshing does not claim an interface.
pub fn devices() -> Result<AudioDevices, String> {
    #[cfg(all(target_os = "linux", feature = "alsa"))]
    return linux::devices();
    #[cfg(not(all(target_os = "linux", feature = "alsa")))]
    Ok(AudioDevices {
        backend_available: false,
        streaming_available: false,
        endpoints: vec![],
        warnings: vec!["ALSA discovery requires a Linux build with the alsa feature".into()],
    })
}

/// Briefly opens a discovered hardware endpoint, checks exact settings, then releases it.
/// No reads/writes/start calls: the probe cannot play or record sound.
pub fn probe(request: &AudioProbe) -> Result<AudioProbeResult, String> {
    request.validate()?;
    #[cfg(all(target_os = "linux", feature = "alsa"))]
    {
        let inventory = devices()?;
        require_endpoint(request, &inventory)?;
        linux::probe(request)
    }
    #[cfg(not(all(target_os = "linux", feature = "alsa")))]
    Err("ALSA probing is unavailable in this build".into())
}

#[cfg(any(test, all(target_os = "linux", feature = "alsa")))]
fn require_endpoint(request: &AudioProbe, inventory: &AudioDevices) -> Result<(), String> {
    if !inventory
        .endpoints
        .iter()
        .any(|e| e.id == request.endpoint && e.direction == request.direction)
    {
        return Err("Audio endpoint missing or direction unavailable; refresh devices".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> AudioProbe {
        AudioProbe {
            endpoint: "hw:CARD=Example,DEV=0".into(),
            direction: Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format: SampleFormat::S16,
            period_frames: 128,
            periods: 3,
        }
    }
    #[test]
    fn rejects_invalid_bounds_and_unlisted_pcm_names() {
        let mut request = request();
        let inventory = AudioDevices {
            backend_available: true,
            streaming_available: false,
            endpoints: vec![AudioEndpoint {
                id: request.endpoint.clone(),
                name: "USB interface".into(),
                direction: Direction::Capture,
            }],
            warnings: vec![],
        };
        request.validate().unwrap();
        require_endpoint(&request, &inventory).unwrap();
        request.direction = Direction::Playback;
        assert!(require_endpoint(&request, &inventory).is_err());
        request.direction = Direction::Capture;
        for name in ["default", "null", "file:/tmp/recording", "hw:999"] {
            request.endpoint = name.into();
            assert!(require_endpoint(&request, &inventory).is_err());
        }
        request.channels = 0;
        assert!(request.validate().is_err());
        request.channels = 2;
        request.period_frames = u32::MAX;
        assert!(request.validate().is_err());
        request.period_frames = 128;
        request.sample_rate = 0;
        assert!(request.validate().is_err());
    }
    #[test]
    fn discovery_never_claims_live_audio() {
        let inventory = devices().unwrap();
        assert!(!inventory.streaming_available);
    }
}
