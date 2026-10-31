//! Local files use the same verified audition store without provider credentials.
use crate::{Shared, failure};
use axum::{
    Json,
    body::Bytes,
    extract::{
        Query, State,
        rejection::{BytesRejection, QueryRejection},
    },
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_presets::{Error, ModelAsset, ModelStore};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LocalModel {
    pub id: String,
    pub title: String,
    pub name: String,
    pub format: String,
    pub sha256: String,
    /// The TONE3000 tone it came from; absent for a file added on this unit,
    /// which carries no provider data.
    #[serde(default, skip_serializing_if = "is_local")]
    pub tone_id: u64,
    /// The tone's gear type (amp, pedal, cab…), when known.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub gear: String,
    /// Display-only relative import folder; never used as a storage path.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder: String,
    /// Actual bounded WAV-header readings; absent for NAM/unsupported headers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<oxidal_presets::WavInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nam: Option<oxidal_presets::NamInfo>,
    /// Persisted metadata of this downloaded tone, available without an account request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_tone: Option<crate::provider::catalog::Tone>,
}
fn is_local(tone_id: &u64) -> bool {
    *tone_id == 0
}
impl LocalModel {
    fn new(id: String, asset: ModelAsset) -> Self {
        Self {
            nam: serde_json::from_value(asset.tone["oxidal_nam"].clone()).ok(),
            provider_tone: if asset.tone_id > 0 {
                serde_json::from_value(asset.tone.clone()).ok()
            } else {
                None
            },
            audio: None,
            id,
            folder: asset.tone["oxidal_folder"].as_str().unwrap_or("").into(),
            gear: asset
                .tone
                .get("gear")
                .and_then(|g| g.as_str())
                .unwrap_or("")
                .chars()
                .take(64)
                .collect(),
            tone_id: asset.tone_id,
            title: asset.title,
            name: asset.name,
            format: asset.format,
            sha256: asset.sha256,
        }
    }
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LocalModelPage {
    pub data: Vec<LocalModel>,
    pub next: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    name: String,
    folder: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct List {
    after: Option<String>,
    /// Include models downloaded from TONE3000, not only local files.
    #[serde(default)]
    all: bool,
    format: Option<String>,
    query: Option<String>,
}
fn error(error: Error) -> Response {
    match error {
        Error::Conflict(message) => failure(StatusCode::CONFLICT, message),
        Error::Invalid(message) => failure(StatusCode::UNPROCESSABLE_ENTITY, message),
        Error::Io(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Local model storage is unavailable",
        ),
    }
}
pub(super) async fn upload(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<Upload>, QueryRejection>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Choose a file name");
    };
    let bytes = match body {
        Ok(bytes) => bytes,
        Err(e) => return failure(e.status(), "File exceeds the 32 MiB upload limit"),
    };
    let root = shared.config.preset_dir.join("audition-models");
    match tokio::task::spawn_blocking(move || {
        ModelStore::new(root).stage_local_in_folder(&query.name, query.folder.as_deref(), &bytes)
    })
    .await
    {
        Ok(Ok((id, asset))) => (
            StatusCode::CREATED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(LocalModel::new(id, asset)),
        )
            .into_response(),
        Ok(Err(e)) => error(e),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Local file staging stopped",
        ),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    pub assets: Vec<String>,
}
pub(super) async fn collection(
    State(shared): State<Arc<Shared>>,
    request: Result<Json<Collection>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(request)) = request else {
        return failure(StatusCode::BAD_REQUEST, "Choose local collection assets");
    };
    let root = shared.config.preset_dir.join("audition-models");
    match tokio::task::spawn_blocking(move || ModelStore::new(root).collection(&request.assets))
        .await
    {
        Ok(Ok((id, asset))) => (
            StatusCode::CREATED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(LocalModel::new(id, asset)),
        )
            .into_response(),
        Ok(Err(e)) => error(e),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Local collection staging stopped",
        ),
    }
}
pub(super) async fn list(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<List>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Invalid local model cursor");
    };
    let root = shared.config.preset_dir.join("audition-models");
    match tokio::task::spawn_blocking(move || {
        let store = ModelStore::new(root);
        let (rows, next) = store.filtered_page(
            query.after.as_deref(),
            query.all,
            query.format.as_deref(),
            query.query.as_deref().unwrap_or(""),
        )?;
        let data = rows
            .into_iter()
            .map(|(id, asset)| {
                let audio = if asset.format == "ir" {
                    store.wav_info(&id).ok().flatten()
                } else {
                    None
                };
                let mut model = LocalModel::new(id, asset);
                model.audio = audio;
                model
            })
            .collect();
        Ok::<_, Error>(LocalModelPage { data, next })
    })
    .await
    {
        Ok(Ok(page)) => ([(header::CACHE_CONTROL, "no-store")], Json(page)).into_response(),
        Ok(Err(e)) => error(e),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Local model listing stopped",
        ),
    }
}
