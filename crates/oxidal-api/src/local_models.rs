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
}
impl LocalModel {
    fn new(id: String, asset: ModelAsset) -> Self {
        Self {
            id,
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
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct List {
    after: Option<String>,
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
        ModelStore::new(root).stage_local(&query.name, &bytes)
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
pub(super) async fn list(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<List>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Invalid local model cursor");
    };
    let root = shared.config.preset_dir.join("audition-models");
    match tokio::task::spawn_blocking(move || {
        ModelStore::new(root).local_page(query.after.as_deref())
    })
    .await
    {
        Ok(Ok((rows, next))) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(LocalModelPage {
                data: rows
                    .into_iter()
                    .map(|(id, asset)| LocalModel::new(id, asset))
                    .collect(),
                next,
            }),
        )
            .into_response(),
        Ok(Err(e)) => error(e),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Local model listing stopped",
        ),
    }
}
