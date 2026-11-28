//! Tone pictures for the model browser, fetched once through the unit and kept
//! on it, so the browser shows them offline and never talks to image hosts.
//! @see docs/tone3000-account.md
use crate::{Shared, failure};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use std::{path::PathBuf, sync::Arc, time::Duration};

const MAX_IMAGE: usize = 4 * 1024 * 1024;
const TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/// A tone shows at most this many pictures; the first is the card picture.
const MAX_PICTURES: usize = 8;

/// The first picture keeps its original file name, so pictures kept before
/// tones had several still show.
fn paths(root: &std::path::Path, id: u64, n: usize) -> (PathBuf, PathBuf) {
    let dir = root.join("tone-images");
    let name = if n == 0 {
        id.to_string()
    } else {
        format!("{id}-{n}")
    };
    (
        dir.join(format!("{name}.img")),
        dir.join(format!("{name}.type")),
    )
}
fn cached(root: &std::path::Path, id: u64, n: usize) -> Option<(Vec<u8>, String)> {
    let (image, kind) = paths(root, id, n);
    let kind = std::fs::read_to_string(kind).ok()?;
    let bytes = std::fs::read(image).ok()?;
    (TYPES.contains(&kind.as_str()) && !bytes.is_empty() && bytes.len() <= MAX_IMAGE)
        .then_some((bytes, kind))
}
fn store(
    root: &std::path::Path,
    id: u64,
    n: usize,
    bytes: &[u8],
    kind: &str,
) -> std::io::Result<()> {
    let (image, kind_path) = paths(root, id, n);
    std::fs::create_dir_all(image.parent().expect("tone-images"))?;
    let temporary = image.with_extension("tmp");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, &image)?;
    std::fs::write(kind_path, kind)
}
/// The tone's first picture: an HTTPS address on a public host, fetched
/// without the account token and with the same redirect rule as downloads.
async fn fetch(url: &str) -> Result<(Vec<u8>, String), &'static str> {
    let url = reqwest::Url::parse(url).map_err(|_| "Invalid picture address")?;
    if !super::download::trusted_redirect(&url) {
        return Err("Untrusted picture address");
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 || !super::download::trusted_redirect(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Picture client unavailable")?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Picture unavailable")?;
    if response.status() != StatusCode::OK {
        return Err("Picture unavailable");
    }
    let kind = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| TYPES.contains(&v.as_str()))
        .ok_or("Unsupported picture type")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Picture interrupted")? {
        if bytes.len() + chunk.len() > MAX_IMAGE {
            return Err("Picture exceeds 4 MiB");
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("Picture was empty");
    }
    Ok((bytes, kind))
}

#[derive(serde::Deserialize)]
pub(crate) struct PictureQuery {
    /// Which of the tone's pictures, counting from 0 (the card picture).
    n: Option<usize>,
}

pub(crate) async fn tone_image(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<u64>,
    Query(query): Query<PictureQuery>,
) -> Response {
    let n = query.n.unwrap_or(0);
    if id == 0 || n >= MAX_PICTURES {
        return failure(StatusCode::BAD_REQUEST, "Invalid tone");
    }
    let root = shared.config.preset_dir.clone();
    let lookup = root.clone();
    let found = tokio::task::spawn_blocking(move || cached(&lookup, id, n))
        .await
        .ok()
        .flatten();
    let (bytes, kind) = match found {
        Some(hit) => hit,
        None => {
            let tone = match shared.account.tone(id).await {
                Ok(tone) => tone,
                Err(e) => return failure(StatusCode::BAD_GATEWAY, e),
            };
            let Some(url) = tone.images.as_ref().and_then(|i| i.get(n)) else {
                return failure(StatusCode::NOT_FOUND, "This tone has no such picture");
            };
            let (bytes, kind) = match fetch(url).await {
                Ok(hit) => hit,
                Err(e) => return failure(StatusCode::BAD_GATEWAY, e),
            };
            let (saved, saved_kind) = (bytes.clone(), kind.clone());
            // A picture that cannot be kept is still shown this time.
            let _ =
                tokio::task::spawn_blocking(move || store(&root, id, n, &saved, &saved_kind)).await;
            (bytes, kind)
        }
    };
    (
        [
            (header::CONTENT_TYPE, kind),
            (header::CACHE_CONTROL, "private, max-age=86400".to_string()),
        ],
        Body::from(bytes),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_pictures_are_kept_and_read_back() {
        let root = std::env::temp_dir().join(format!("oxidal-tone-images-{}", std::process::id()));
        assert!(cached(&root, 7, 0).is_none());
        store(&root, 7, 0, b"\x89PNG fake", "image/png").unwrap();
        assert_eq!(
            cached(&root, 7, 0).unwrap(),
            (b"\x89PNG fake".to_vec(), "image/png".into())
        );
        store(&root, 8, 0, b"x", "text/html").unwrap();
        assert!(
            cached(&root, 8, 0).is_none(),
            "an unexpected type is never served"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn later_pictures_are_kept_apart_from_the_first() {
        let root = std::env::temp_dir().join(format!("oxidal-tone-more-{}", std::process::id()));
        store(&root, 9, 0, b"first", "image/png").unwrap();
        store(&root, 9, 2, b"third", "image/jpeg").unwrap();
        assert_eq!(cached(&root, 9, 0).unwrap().0, b"first");
        assert_eq!(cached(&root, 9, 2).unwrap().0, b"third");
        assert!(cached(&root, 9, 1).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
