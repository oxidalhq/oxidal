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
use std::{sync::Arc, time::Duration};

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
    /// IR models have no NAM architecture; omit the provider filter.
    #[serde(rename = "any")]
    Any,
}
impl Architecture {
    fn value(self) -> Option<&'static str> {
        match self {
            Self::A1 => Some("1"),
            Self::A2 => Some("2"),
            Self::Custom => Some("custom"),
            Self::Any => None,
        }
    }
}
/// TONE3000 gear types a tone list can be narrowed to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Gear {
    Amp,
    AmpCab,
    Pedal,
    Outboard,
    Cab,
    Space,
    Experimental,
}
impl Gear {
    fn value(self) -> &'static str {
        match self {
            Self::Amp => "amp",
            Self::AmpCab => "amp-cab",
            Self::Pedal => "pedal",
            Self::Outboard => "outboard",
            Self::Cab => "cab",
            Self::Space => "space",
            Self::Experimental => "experimental",
        }
    }
    /// The provider still sends `full-rig` for older amp-and-cab tones.
    fn matches(self, gear: &str) -> bool {
        gear == self.value() || (self == Self::AmpCab && gear == "full-rig")
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
    /// Only tones of this gear type; none lists every type.
    #[serde(default)]
    pub gear: Option<Gear>,
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
    #[serde(
        default,
        deserialize_with = "creator_profile",
        skip_serializing_if = "Option::is_none"
    )]
    pub profile_url: Option<String>,
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
fn creator_profile<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_str()
        .filter(|text| valid_creator_profile(text))
        .map(str::to_owned))
}

fn valid_creator_profile(text: &str) -> bool {
    if text.len() > 2048 || text.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Some((scheme, address)) = text.split_once("://") else {
        return false;
    };
    let Some((authority, path)) = address.split_once('/') else {
        return false;
    };
    let profile = path.strip_suffix('/').unwrap_or(path);
    let profile_lower = profile.to_ascii_lowercase();
    if !scheme.eq_ignore_ascii_case("https")
        || !matches!(
            authority.to_ascii_lowercase().as_str(),
            "tone3000.com" | "www.tone3000.com" | "tone3000.com:443" | "www.tone3000.com:443"
        )
        || profile.is_empty()
        || profile.contains(['/', '\\'])
        || matches!(
            profile_lower.as_str(),
            "." | ".." | "%2e" | ".%2e" | "%2e." | "%2e%2e"
        )
        || !profile.split('%').skip(1).all(|part| {
            part.get(..2)
                .filter(|hex| hex.bytes().all(|b| b.is_ascii_hexdigit()))
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .is_some_and(|b| b > b' ' && !matches!(b, b'/' | b'\\' | 0x7f))
        })
    {
        return false;
    }
    reqwest::Url::parse(text).is_ok_and(|url| {
        matches!(url.host_str(), Some("tone3000.com" | "www.tone3000.com"))
            && url.port_or_known_default() == Some(443)
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

/// The provider calls the creator address `user.url`; our stored metadata
/// calls it `profile_url`. Read the provider's field only at that boundary.
pub(super) fn provider_tone(mut value: serde_json::Value) -> Result<Tone, &'static str> {
    if let Some(user) = value
        .get_mut("user")
        .and_then(serde_json::Value::as_object_mut)
    {
        user.remove("profile_url");
        if let Some(url) = user.remove("url") {
            user.insert("profile_url".into(), url);
        }
    }
    serde_json::from_value(value).map_err(|_| "Invalid TONE3000 tone response")
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
        // Requests wait their turn: a dialog that reads several tones at once
        // must not have all but one refused.
        let _permit = tokio::time::timeout(Duration::from_secs(20), self.requests.acquire())
            .await
            .map_err(|_| "TONE3000 requests are queued behind a slow one; retry shortly")?
            .map_err(|_| "TONE3000 requests stopped")?;
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
        let mut params = if query.collection.paginated() {
            vec![
                ("page", query.page.to_string()),
                ("page_size", "20".into()),
                ("query", query.query),
            ]
        } else {
            vec![]
        };
        // Every list but Latest filters by gear on TONE3000; Latest takes no
        // parameters, so its ten tones are narrowed here.
        if let Some(gear) = query.gear
            && !matches!(query.collection, Collection::Latest)
        {
            params.push(("gear", gear.value().into()));
        }
        let raw: Page<serde_json::Value> = self
            .catalog(&format!("tones/{}", query.collection.path()), &params)
            .await?;
        if raw.data.len() > 20 || raw.page != query.page {
            return Err("Invalid TONE3000 library response");
        }
        let mut page = Page {
            data: raw
                .data
                .into_iter()
                .map(provider_tone)
                .collect::<Result<Vec<_>, _>>()?,
            page: raw.page,
            total_pages: raw.total_pages,
        };
        if !page.data.iter().all(Tone::valid) {
            return Err("Invalid TONE3000 library response");
        }
        if let Some(gear) = query.gear {
            page.data.retain(|tone| gear.matches(&tone.gear));
        }
        Ok(page)
    }
    async fn models(&self, query: ModelQuery) -> Result<Page<Model>, &'static str> {
        if query.tone_id == 0 || query.page == 0 || query.page > 10000 {
            return Err("Invalid tone or model page");
        }
        let mut params = vec![
            ("tone_id", query.tone_id.to_string()),
            ("page", query.page.to_string()),
            ("page_size", "20".into()),
        ];
        if let Some(architecture) = query.architecture.value() {
            params.push(("architecture", architecture.into()));
        }
        let page: Page<Model> = self.catalog("models", &params).await?;
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
    pub(super) async fn tone(&self, id: u64) -> Result<Tone, &'static str> {
        if id == 0 {
            return Err("Invalid tone");
        }
        let tone = provider_tone(self.catalog(&format!("tones/{id}"), &[]).await?)?;
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
        401 => return Err("TONE3000 authorization expired (HTTP 401); reconnect your account"),
        403 => return Err("TONE3000 refused this tone or model for your account (HTTP 403)"),
        404 => return Err("This tone or model is not on TONE3000 (HTTP 404)"),
        429 => {
            return Err(
                "TONE3000 request limit reached (HTTP 429); wait a few minutes before retrying",
            );
        }
        500 => return Err("TONE3000 had an internal error (HTTP 500); retry shortly"),
        502 | 504 => return Err("TONE3000 did not answer in time (HTTP 502/504); retry shortly"),
        503 => return Err("TONE3000 is unavailable (HTTP 503); retry shortly"),
        _ => return Err("TONE3000 request failed with an unexpected status; retry shortly"),
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
