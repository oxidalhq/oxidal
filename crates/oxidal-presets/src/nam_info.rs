//! Small descriptive fields from uploaded NAMs; model IDs are never tone IDs.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Default, Serialize, Deserialize, schemars::JsonSchema)]
pub struct NamInfo {
    pub name: Option<String>,
    pub author: Option<String>,
    pub trainer: Option<String>,
    pub gear: Option<String>,
    pub source_tone_id: Option<u64>,
    pub source_url: Option<String>,
}
impl NamInfo {
    pub(crate) fn from_model(model: &serde_json::Value) -> Self {
        let m = &model["metadata"];
        let text = |value: &serde_json::Value| {
            value.as_str().filter(|s| !s.trim().is_empty()).map(|s| {
                s.chars()
                    .filter(|c| !c.is_control())
                    .take(256)
                    .collect::<String>()
            })
        };
        let trainer = text(&m["trainer"]);
        let source_tone_id = m["tone3000"]["tone_id"]
            .as_u64()
            .or_else(|| model["tone3000"]["tone_id"].as_u64())
            .or_else(|| {
                trainer
                    .as_deref()
                    .filter(|t| t.eq_ignore_ascii_case("TONE3000"))
                    .and_then(|_| m["tone_id"].as_u64())
            })
            .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991);
        Self {
            name: text(&m["name"]),
            author: text(&m["modeled_by"]),
            trainer,
            gear: text(&m["gear_model"]).or_else(|| text(&m["gear_make"])),
            source_tone_id,
            source_url: text(&m["tone3000"]["url"]).or_else(|| text(&m["tone_url"])),
        }
    }
}
/// Trainer-written references in dBu. These readings never change an audio gain.
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CaptureLevels {
    pub input_dbu: Option<f64>,
    pub output_dbu: Option<f64>,
    pub gear_type: Option<String>,
}
impl CaptureLevels {
    pub(crate) fn read(bytes: &[u8]) -> crate::Result<Self> {
        #[derive(Deserialize)]
        struct Capture {
            #[serde(default)]
            metadata: serde_json::Value,
        }
        let capture: Capture =
            serde_json::from_slice(bytes).map_err(|_| crate::Error::Invalid("Invalid NAM data"))?;
        let reference = |key: &str| {
            capture.metadata[key]
                .as_f64()
                .filter(|v| (-60.0..=60.0).contains(v))
        };
        Ok(Self {
            input_dbu: reference("input_level_dbu"),
            output_dbu: reference("output_level_dbu"),
            gear_type: capture.metadata["gear_type"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
                .map(str::to_owned),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_trainer_or_model_id_alone_never_invents_a_tone_identity() {
        let info = NamInfo::from_model(
            &serde_json::json!({"metadata":{"trainer":"TONE3000","model_id":123,"modeled_by":"Third-party maker"}}),
        );
        assert_eq!(info.source_tone_id, None);
        assert_eq!(info.author.as_deref(), Some("Third-party maker"));
        let info =
            NamInfo::from_model(&serde_json::json!({"metadata":{"tone3000":{"tone_id":42}}}));
        assert_eq!(info.source_tone_id, Some(42));
    }

    #[test]
    fn capture_levels_use_only_finite_trainer_references() {
        let levels = CaptureLevels::read(
            br#"{"metadata":{"input_level_dbu":-18.4,"output_level_dbu":12,"gear_type":" amp "}}"#,
        )
        .unwrap();
        assert_eq!(
            (levels.input_dbu, levels.output_dbu),
            (Some(-18.4), Some(12.0))
        );
        assert_eq!(levels.gear_type.as_deref(), Some("amp"));
        for model in [
            r#"{}"#,
            r#"{"metadata":{"input_level_dbu":61,"output_level_dbu":"0"}}"#,
        ] {
            let levels = CaptureLevels::read(model.as_bytes()).unwrap();
            assert_eq!((levels.input_dbu, levels.output_dbu), (None, None));
        }
        assert!(CaptureLevels::read(b"not json").is_err());
    }
}
