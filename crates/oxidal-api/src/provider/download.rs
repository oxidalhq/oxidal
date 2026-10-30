//! Fetch an entitled model into a verified audition cache. This does not change audio or save a rig.
use super::{
    Access, Account,
    catalog::{Model, Tone, fetch},
};
use crate::{Shared, failure};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::{MAX_FILE_BYTES, ModelAsset, ModelStore};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StageModel {
    pub tone_id: u64,
    pub model_id: u64,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StagedModel {
    pub id: String,
    pub tone_id: u64,
    pub model_id: u64,
    pub title: String,
    pub name: String,
    pub sha256: String,
}
#[derive(Deserialize)]
struct DownloadModel {
    #[serde(flatten)]
    model: Model,
    model_url: String,
}
impl Account {
    async fn stage_model(
        &self,
        request: StageModel,
        root: PathBuf,
    ) -> Result<StagedModel, &'static str> {
        if request.tone_id == 0 || request.model_id == 0 {
            return Err("Select a tone and model");
        }
        let _permit = self
            .requests
            .try_acquire()
            .map_err(|_| "TONE3000 is busy; retry shortly")?;
        let access = self.access().await?;
        let tone: Tone = fetch(&access, &format!("tones/{}", request.tone_id), &[]).await?;
        let model: DownloadModel =
            fetch(&access, &format!("models/{}", request.model_id), &[]).await?;
        if !tone.valid()
            || !model.model.valid()
            || tone.id != request.tone_id
            || model.model.tone_id != tone.id
            || model.model.id != request.model_id
        {
            return Err("Tone/model selection changed; select it again");
        }
        if !matches!(tone.format.as_str(), "nam" | "ir") {
            return Err("Select a NAM model or an IR");
        }
        if !self.current(&access) {
            return Err("Account changed; retry the selection");
        }
        let bytes = download(&access, &model.model_url, model.model.id).await?;
        if !self.current(&access) {
            return Err("Account changed; retry the selection");
        }
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let mut metadata = serde_json::to_value(&tone).map_err(|_| "Invalid tone metadata")?;
        let mut descriptor =
            serde_json::to_value(&model.model).map_err(|_| "Invalid model metadata")?;
        // Native saved presets embed these bytes. No expiring provider URL is made durable.
        descriptor["model_url"] = format!(
            "oxidal-model://{sha256}/{}",
            if tone.format == "nam" {
                "model.nam"
            } else {
                "model.wav"
            }
        )
        .into();
        metadata["models"] = serde_json::json!([descriptor]);
        let asset = ModelAsset {
            schema: 1,
            tone_id: tone.id,
            model_id: model.model.id,
            title: tone.title.clone(),
            name: model.model.name.clone(),
            format: tone.format,
            sha256: sha256.clone(),
            tone: metadata,
        };
        let id = tokio::task::spawn_blocking(move || ModelStore::new(root).stage(&asset, &bytes))
            .await
            .map_err(|_| "Model staging stopped")?
            .map_err(|_| "Cannot store the audition model; check free storage")?;
        // A disconnect may arrive during the disk write. The inert cache may remain, but
        // its reply cannot authorize a later chain edit on behalf of that account.
        if !self.current(&access) {
            return Err("Account changed; retry the selection");
        }
        Ok(StagedModel {
            id,
            tone_id: tone.id,
            model_id: model.model.id,
            title: tone.title,
            name: model.model.name,
            sha256,
        })
    }
}
fn valid_initial(access: &Access, value: &str, model: u64) -> Result<reqwest::Url, &'static str> {
    let origin = reqwest::Url::parse(&access.origin).map_err(|_| "Invalid provider origin")?;
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid model download address")?;
    let prefix = format!("/api/v1/models/{model}/download");
    if url.origin() != origin.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !(url.path() == prefix || url.path().starts_with(&(prefix + "/")))
    {
        return Err("Untrusted model download address");
    }
    Ok(url)
}
/// A redirect may go to any public HTTPS host (the provider's file storage),
/// never to an address, a local name, another port or embedded credentials.
pub(crate) fn trusted_redirect(url: &reqwest::Url) -> bool {
    // `domain()` is none for IPv4 and IPv6 addresses.
    let named = url.domain().is_some_and(|name| {
        name.contains('.')
            && !name.ends_with(".local")
            && !name.ends_with(".localhost")
            && !name.eq_ignore_ascii_case("localhost")
    });
    url.scheme() == "https"
        && named
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}
async fn download(access: &Access, value: &str, model: u64) -> Result<Vec<u8>, &'static str> {
    let mut url = valid_initial(access, value, model)?;
    for hop in 0..4 {
        let mut request = access
            .client
            .get(url.clone())
            .timeout(std::time::Duration::from_secs(60));
        if hop == 0 {
            request = request.bearer_auth(&access.token);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "Model download interrupted; previous sound is unchanged")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Invalid download redirect")?;
            let next = url
                .join(location)
                .map_err(|_| "Invalid download redirect")?;
            // The provider hands model files to its storage service, as the
            // TONE3000 plugin follows. Redirects never carry the Bearer token.
            if !trusted_redirect(&next) {
                return Err("Untrusted model download redirect");
            }
            url = next;
            continue;
        }
        if response.status() != StatusCode::OK {
            return Err("Model download unavailable; previous sound is unchanged");
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_FILE_BYTES as u64)
        {
            return Err("Model exceeds the supported file size");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Model download interrupted")?
        {
            if bytes.len() + chunk.len() > MAX_FILE_BYTES {
                return Err("Model exceeds the supported file size");
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err("Model download was empty");
        }
        return Ok(bytes);
    }
    Err("Too many model download redirects")
}
pub(crate) async fn stage(
    State(shared): State<Arc<Shared>>,
    Json(request): Json<StageModel>,
) -> Response {
    match shared
        .account
        .stage_model(request, shared.config.preset_dir.join("audition-models"))
        .await
    {
        Ok(value) => Json(value).into_response(),
        Err(error) => failure(StatusCode::BAD_GATEWAY, error),
    }
}
#[cfg(test)]
mod tests;
