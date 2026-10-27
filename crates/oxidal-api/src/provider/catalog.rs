//! Provider metadata for explicit user selection. No tokens or download URLs in the UI contract.
//! @see docs/tone3000-account.md
use super::{Access, Account};
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const MAX_CATALOG: usize = 1024 * 1024;
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Collection {
    #[default]
    Favorites,
    Downloaded,
    Created,
    Trending,
    Latest,
}
impl Collection {
    fn path(self) -> &'static str {
        match self {
            Self::Favorites => "favorited",
            Self::Downloaded => "downloaded",
            Self::Created => "created",
            Self::Trending => "trending",
            Self::Latest => "latest",
        }
    }
    fn paginated(self) -> bool {
        !matches!(self, Self::Trending | Self::Latest)
    }
}
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema)]
pub enum Architecture {
    #[serde(rename = "1")]
    A1,
    #[default]
    #[serde(rename = "2")]
    A2,
    #[serde(rename = "custom")]
    Custom,
}
impl Architecture {
    fn value(self) -> &'static str {
        match self {
            Self::A1 => "1",
            Self::A2 => "2",
            Self::Custom => "custom",
        }
    }
}
fn first() -> u32 {
    1
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ToneQuery {
    #[serde(default)]
    pub collection: Collection,
    #[serde(default = "first")]
    pub page: u32,
    #[serde(default)]
    pub query: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelQuery {
    pub tone_id: u64,
    #[serde(default = "first")]
    pub page: u32,
    #[serde(default)]
    pub architecture: Architecture,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct Creator {
    pub username: String,
    pub display_name: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct Tone {
    pub id: u64,
    pub title: String,
    pub user: Creator,
    pub gear: String,
    pub format: String,
    pub license: String,
    pub images: Option<Vec<String>>,
    pub url: String,
    pub models_count: u64,
    #[serde(default)]
    pub a1_models_count: u64,
    #[serde(default)]
    pub a2_models_count: u64,
    #[serde(default)]
    pub custom_models_count: u64,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct Model {
    pub id: u64,
    pub tone_id: u64,
    pub name: String,
    pub size: Option<String>,
    pub architecture_version: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct Page<T> {
    pub data: Vec<T>,
    #[serde(default = "first")]
    pub page: u32,
    #[serde(default = "first")]
    pub total_pages: u32,
}
fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn https(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    })
}
impl Tone {
    pub(super) fn valid(&self) -> bool {
        self.id > 0
            && text(&self.title, 512)
            && text(&self.user.username, 128)
            && self.user.display_name.as_ref().is_none_or(|s| text(s, 256))
            && text(&self.gear, 64)
            && text(&self.format, 32)
            && text(&self.license, 128)
            && self.url.len() <= 2048
            && https(&self.url)
            && self.images.as_ref().is_none_or(|images| {
                images.len() <= 20 && images.iter().all(|s| s.len() <= 4096 && https(s))
            })
    }
}
impl Model {
    pub(super) fn valid(&self) -> bool {
        self.id > 0
            && self.tone_id > 0
            && text(&self.name, 512)
            && self.size.as_ref().is_none_or(|s| text(s, 64))
            && self
                .architecture_version
                .as_ref()
                .is_none_or(|s| matches!(s.as_str(), "1" | "2" | "custom"))
    }
}
impl Account {
    async fn catalog<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T, &'static str> {
        let _permit = self
            .requests
            .try_acquire()
            .map_err(|_| "TONE3000 is busy; retry shortly")?;
        let access = self.access().await?;
        let value = fetch(&access, path, query).await?;
        // A disconnected/replaced/refreshed account cannot deliver an earlier account's reply.
        if !self.current(&access) {
            return Err("Account changed; retry the selection");
        }
        Ok(value)
    }
    async fn tones(&self, query: ToneQuery) -> Result<Page<Tone>, &'static str> {
        if query.page == 0
            || query.page > 10000
            || query.query.len() > 200
            || query.query.chars().any(char::is_control)
        {
            return Err("Invalid library page or search");
        }
        if !query.collection.paginated() && (query.page != 1 || !query.query.is_empty()) {
            return Err("This feed has one page and no text filter");
        }
        let params = if query.collection.paginated() {
            vec![
                ("page", query.page.to_string()),
                ("page_size", "20".into()),
                ("query", query.query),
            ]
        } else {
            vec![]
        };
        let page: Page<Tone> = self
            .catalog(&format!("tones/{}", query.collection.path()), &params)
            .await?;
        if page.data.len() > 20 || page.page != query.page || !page.data.iter().all(Tone::valid) {
            return Err("Invalid TONE3000 library response");
        }
        Ok(page)
    }
    async fn models(&self, query: ModelQuery) -> Result<Page<Model>, &'static str> {
        if query.tone_id == 0 || query.page == 0 || query.page > 10000 {
            return Err("Invalid tone or model page");
        }
        let page: Page<Model> = self
            .catalog(
                "models",
                &[
                    ("tone_id", query.tone_id.to_string()),
                    ("page", query.page.to_string()),
                    ("page_size", "20".into()),
                    ("architecture", query.architecture.value().into()),
                ],
            )
            .await?;
        if page.data.len() > 20
            || page.page != query.page
            || !page
                .data
                .iter()
                .all(|m| m.valid() && m.tone_id == query.tone_id)
        {
            return Err("Invalid TONE3000 model response");
        }
        Ok(page)
    }
    async fn tone(&self, id: u64) -> Result<Tone, &'static str> {
        if id == 0 {
            return Err("Invalid tone");
        }
        let tone: Tone = self.catalog(&format!("tones/{id}"), &[]).await?;
        if tone.id != id || !tone.valid() {
            return Err("Invalid TONE3000 tone response");
        }
        Ok(tone)
    }
}
pub(super) async fn fetch<T: serde::de::DeserializeOwned>(
    access: &Access,
    path: &str,
    query: &[(&str, String)],
) -> Result<T, &'static str> {
    let mut response = access
        .client
        .get(format!("{}/api/v1/{path}", access.origin))
        .query(query)
        .bearer_auth(&access.token)
        .send()
        .await
        .map_err(|_| "Cannot reach TONE3000; local presets remain available")?;
    match response.status().as_u16() {
        200 => (),
        401 => return Err("TONE3000 authorization expired; reconnect your account"),
        403 | 404 => return Err("This tone or model is unavailable to your account"),
        429 => return Err("TONE3000 request limit reached; wait before retrying"),
        _ => return Err("TONE3000 request failed; retry shortly"),
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "TONE3000 response interrupted")?
    {
        if bytes.len() + chunk.len() > MAX_CATALOG {
            return Err("TONE3000 response exceeds the catalog limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid TONE3000 response")
}
fn reply<T: Serialize>(result: Result<T, &'static str>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => failure(StatusCode::BAD_GATEWAY, error),
    }
}
pub(crate) async fn tones(
    State(shared): State<Arc<Shared>>,
    Query(query): Query<ToneQuery>,
) -> Response {
    reply(shared.account.tones(query).await)
}
pub(crate) async fn models(
    State(shared): State<Arc<Shared>>,
    Query(query): Query<ModelQuery>,
) -> Response {
    reply(shared.account.models(query).await)
}
pub(crate) async fn tone(State(shared): State<Arc<Shared>>, Path(id): Path<u64>) -> Response {
    reply(shared.account.tone(id).await)
}
#[cfg(test)]
pub(super) mod tests;
