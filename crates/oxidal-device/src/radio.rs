//! Regulatory parsing; only non-disabled, initiation-allowed 2.4 GHz channels are exposed.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Radio {
    pub country: String,
    pub channels: Vec<u8>,
}
pub fn country(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix("COUNTRY="))
        .filter(|v| v.len() == 2 && v.bytes().all(|b| b.is_ascii_uppercase()))
        .map(str::to_owned)
}
pub fn channels(text: &str) -> Vec<u8> {
    let mut result = Vec::new();
    for line in text.lines() {
        let frequency = line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok());
        if !frequency.is_some_and(|v| (2412..=2472).contains(&v)) {
            continue;
        }
        if !line.contains("MHz")
            || line.contains("disabled")
            || line.contains("no IR")
            || line.contains("radar")
        {
            continue;
        }
        let Some((_, tail)) = line.split_once('[') else {
            continue;
        };
        let Some((number, _)) = tail.split_once(']') else {
            continue;
        };
        if let Ok(channel) = number.parse::<u8>()
            && (1..=13).contains(&channel)
            && !result.contains(&channel)
        {
            result.push(channel);
        }
    }
    result.sort_unstable();
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn respects_driver_regulatory_flags() {
        assert_eq!(
            channels(
                "* 2412 MHz [1] (20.0 dBm)\n* 2467 MHz [12] (disabled)\n* 2472 MHz [13] (20.0 dBm) (no IR)\n* 5180 MHz [36] (20.0 dBm)\n* 2437 MHz [6] (20.0 dBm)"
            ),
            vec![1, 6]
        );
        assert_eq!(country("COUNTRY=NZ\n"), Some("NZ".into()));
        assert!(country("COUNTRY=NZ;reboot").is_none());
    }
}
