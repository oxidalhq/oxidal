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
}
