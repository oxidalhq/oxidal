//! Device-side artwork, independent from DSP and immutable preset bytes.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_presets::{ArtworkSource, OwnedStore, Store};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Cursor, Read, Write},
    net::{IpAddr, SocketAddr},
    path::{Path as FsPath, PathBuf},
    sync::Arc,
    time::Duration,
};

const MAX_DOWNLOAD: usize = 4 * 1024 * 1024;
const MAX_PNG: usize = 1024 * 1024;
const CACHE_BUDGET: u64 = 256 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AssetArtwork {
    pub block_id: String,
    pub title: String,
    pub gear: String,
    /// Hash of the metadata URL; URLs (potentially signed) never reach the browser or logs.
    pub key: Option<String>,
    pub cached: bool,
}
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    #[serde(default)]
    owned: bool,
}
fn key(url: &str) -> String {
    format!("{:x}", Sha256::digest(url.as_bytes()))
}
fn cache_path(root: &FsPath, id: &str) -> Result<PathBuf, &'static str> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid artwork identity");
    }
    Ok(root.join("artwork").join(format!("{id}.cache")))
}
fn sources(root: &FsPath, id: &str, owned: bool) -> Result<Vec<ArtworkSource>, &'static str> {
    let bytes = if owned {
        OwnedStore::new(root.join("owned")).read(id).map(|v| v.1)
    } else {
        Store::new(root.to_owned()).original(id)
    }
    .map_err(|_| "Preset is unavailable")?;
    oxidal_presets::artwork(&bytes).map_err(|_| "Preset artwork metadata is unavailable")
}
fn cached(root: &FsPath, id: &str) -> Result<Vec<u8>, &'static str> {
    let path = cache_path(root, id)?;
    let meta = std::fs::symlink_metadata(&path).map_err(|_| "Artwork is not saved offline")?;
    if !meta.file_type().is_file() || meta.len() > (MAX_PNG + 32) as u64 {
        return Err("Artwork cache is invalid");
    }
    let mut bytes = vec![];
    std::fs::File::open(path)
        .map_err(|_| "Artwork cache is unavailable")?
        .take((MAX_PNG + 33) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Artwork cache is unavailable")?;
    if bytes.len() < 40
        || bytes.len() > MAX_PNG + 32
        || Sha256::digest(&bytes[32..])[..] != bytes[..32]
        || !bytes[32..].starts_with(b"\x89PNG\r\n\x1a\n")
    {
        return Err("Artwork cache integrity failed");
    }
    Ok(bytes.split_off(32))
}
fn thumbnail(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > MAX_DOWNLOAD {
        return Err("Artwork exceeds 4 MiB");
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "Invalid artwork")?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP)
    ) {
        return Err("Artwork must be PNG, JPEG or WebP");
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "Artwork cannot be decoded within its limits")?;
    let mut output = Cursor::new(vec![]);
    decoded
        .thumbnail(384, 384)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "Artwork cannot be encoded")?;
    let bytes = output.into_inner();
    if bytes.len() > MAX_PNG {
        return Err("Artwork thumbnail is too large");
    }
    Ok(bytes)
}
fn publish(root: &FsPath, id: &str, bytes: &[u8]) -> Result<(), &'static str> {
    let path = cache_path(root, id)?;
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|_| "Artwork storage is unavailable")?;
    let size = std::fs::read_dir(dir)
        .map_err(|_| "Artwork storage is unavailable")?
        .try_fold(0u64, |n, e| {
            e.and_then(|e| e.metadata())
                .map(|m| n.saturating_add(m.len()))
        })
        .map_err(|_| "Artwork storage is unavailable")?;
    if size + bytes.len() as u64 + 32 > CACHE_BUDGET {
        return Err("Offline artwork cache is full");
    }
    // One daemon export permit serializes this temporary file and the cache budget.
    let tmp = dir.join(format!(".artwork-{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)?;
        file.write_all(&Sha256::digest(bytes))?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    let _ = std::fs::remove_file(tmp);
    result.map_err(|_| "Artwork storage is unavailable")
}
fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || a == 169 && b == 254
                || a == 172 && (16..=31).contains(&b)
                || a == 192 && (b == 168 || b == 0 || b == 2 || b == 88 && c == 99)
                || a == 100 && (64..=127).contains(&b)
                || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
                || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8)
                    || s[0] == 0x2002
                    || s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}
fn safe_url(value: &str) -> Result<reqwest::Url, &'static str> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid artwork source")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || url.fragment().is_some()
    {
        return Err("Artwork requires a public HTTPS source");
    }
    Ok(url)
}
async fn fetch(value: &str) -> Result<Vec<u8>, &'static str> {
    let url = safe_url(value)?;
    let host = url.host_str().unwrap();
    let addrs: Vec<SocketAddr> =
        tokio::time::timeout(Duration::from_secs(3), tokio::net::lookup_host((host, 443)))
            .await
            .map_err(|_| "Artwork DNS timed out")?
            .map_err(|_| "Artwork host is unavailable")?
            .collect();
    if addrs.is_empty() || addrs.iter().any(|a| !public(a.ip())) {
        return Err("Artwork source is not a public host");
    }
    // Pin the checked addresses to avoid a second DNS lookup; never use ambient proxies.
    // Redirects are rejected, so a public source cannot redirect to device/local services.
    let client = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|_| "Artwork HTTPS is unavailable")?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Artwork download failed")?;
    image_body(response).await
}
async fn image_body(mut response: reqwest::Response) -> Result<Vec<u8>, &'static str> {
    if response.status() != reqwest::StatusCode::OK {
        return Err("Artwork source did not return an image");
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_DOWNLOAD as u64)
    {
        return Err("Artwork exceeds 4 MiB");
    }
    let mime = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if !matches!(mime, "image/png" | "image/jpeg" | "image/webp") {
        return Err("Artwork source returned an unsupported type");
    }
    let mut bytes = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Artwork download was interrupted")?
    {
        if bytes.len() + chunk.len() > MAX_DOWNLOAD {
            return Err("Artwork exceeds 4 MiB");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub(super) async fn list(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    Query(selection): Query<Selection>,
) -> Response {
    let root = shared.config.preset_dir.clone();
    match tokio::task::spawn_blocking(move || {
        Ok::<_, &'static str>(
            sources(&root, &id, selection.owned)?
                .into_iter()
                .map(|s| {
                    let key = s.url.filter(|u| safe_url(u).is_ok()).map(|u| key(&u));
                    let ready = key.as_ref().is_some_and(|k| cached(&root, k).is_ok());
                    AssetArtwork {
                        block_id: s.block_id,
                        title: s.title,
                        gear: s.gear,
                        key,
                        cached: ready,
                    }
                })
                .collect::<Vec<_>>(),
        )
    })
    .await
    {
        Ok(Ok(art)) => Json(art).into_response(),
        _ => failure(StatusCode::NOT_FOUND, "Preset artwork is unavailable"),
    }
}
pub(super) async fn read(
    State(shared): State<Arc<Shared>>,
    Path((id, key)): Path<(String, String)>,
    Query(selection): Query<Selection>,
) -> Response {
    let root = shared.config.preset_dir.clone();
    match tokio::task::spawn_blocking(move || {
        let belongs = sources(&root, &id, selection.owned)?
            .iter()
            .any(|s| s.url.as_ref().is_some_and(|u| self::key(u) == key));
        if !belongs {
            return Err("Artwork does not belong to this preset");
        }
        cached(&root, &key)
    })
    .await
    {
        Ok(Ok(bytes)) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "private, max-age=3600"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        _ => failure(StatusCode::NOT_FOUND, "Artwork is not saved offline"),
    }
}
pub(super) async fn download(
    State(shared): State<Arc<Shared>>,
    Path((id, key)): Path<(String, String)>,
    Query(selection): Query<Selection>,
) -> Response {
    let Ok(permit) = shared.artwork_work.clone().try_acquire_owned() else {
        return failure(StatusCode::CONFLICT, "Artwork download already in progress");
    };
    let root = shared.config.preset_dir.clone();
    let root_copy = root.clone();
    let key_copy = key.clone();
    let source = tokio::task::spawn_blocking(move || {
        let source = sources(&root_copy, &id, selection.owned)?
            .into_iter()
            .find(|s| s.url.as_ref().is_some_and(|u| self::key(u) == key_copy))
            .ok_or("Artwork does not belong to this preset")?;
        Ok::<_, &'static str>((source.url.unwrap(), cached(&root_copy, &key_copy).is_ok()))
    })
    .await;
    let (url, ready) = match source {
        Ok(Ok(s)) => s,
        _ => {
            return failure(
                StatusCode::NOT_FOUND,
                "Artwork does not belong to this preset",
            );
        }
    };
    if ready {
        return StatusCode::NO_CONTENT.into_response();
    }
    let bytes = match fetch(&url).await {
        Ok(b) => b,
        Err(e) => return failure(StatusCode::BAD_GATEWAY, e),
    };
    match tokio::task::spawn_blocking(move || {
        // Permit survives HTTP cancellation until decoding/publication finishes.
        let _permit = permit;
        publish(&root, &key, &thumbnail(&bytes)?)
    })
    .await
    {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => failure(StatusCode::UNPROCESSABLE_ENTITY, e),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Artwork storage failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &[u8] =
        include_bytes!("../../oxidal-presets/tests/fixtures/authored-artwork.t3kpreset");
    #[test]
    fn artwork_identity_uses_source_not_titles_and_preserves_absence() {
        let sources = oxidal_presets::artwork(FIXTURE).unwrap();
        assert_eq!(sources.len(), 3);
        assert_eq!(sources[0].title, sources[1].title);
        assert_ne!(
            key(sources[0].url.as_ref().unwrap()),
            key(sources[1].url.as_ref().unwrap())
        );
        assert_eq!(sources[1].gear, "cab");
        assert_eq!(sources[2].gear, "space");
        assert!(sources[2].url.is_none());
        for url in [
            "http://example.com/a.png",
            "file:///etc/passwd",
            "data:image/png;base64,AAAA",
            "https://name:secret@example.com/a",
            "https://example.com:8443/a",
        ] {
            assert!(safe_url(url).is_err());
        }
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!public(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(public(ip.parse().unwrap()), "{ip}");
        }
    }
    fn sample_png() -> Vec<u8> {
        let image = image::RgbImage::from_pixel(600, 300, image::Rgb([24, 96, 72]));
        let mut bytes = Cursor::new(vec![]);
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }
    #[tokio::test]
    async fn device_cache_serves_offline_after_restart_and_rejects_cross_asset_or_corrupt_data() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-artwork-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let info = Store::new(root.clone()).import(FIXTURE).unwrap();
        let sources = sources(&root, &info.sha256, false).unwrap();
        let first = key(sources[0].url.as_ref().unwrap());
        let second = key(sources[1].url.as_ref().unwrap());
        let png = thumbnail(&sample_png()).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (384, 192));
        assert!(thumbnail(b"<svg><script/></svg>").is_err());
        assert!(thumbnail(&vec![0; MAX_DOWNLOAD + 1]).is_err());
        publish(&root, &first, &png).unwrap();
        assert!(cached(&root, &second).is_err());
        let config = crate::Config {
            debug_socket: None,
            device_socket: None,
            graph_worker: None,
            rig_worker: None,
            audio_worker: None,
            native_worker: None,
            shutdown: None,
            simulator: false,
            mapping_path: root.join("mapping.json"),
            preset_dir: root.clone(),
            ui_dir: root.join("ui"),
        };
        // Two separate daemon lifetimes; no image source server exists or is contacted.
        for _ in 0..2 {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = format!(
                "http://{}/api/v1/presets/{}/artwork",
                listener.local_addr().unwrap(),
                info.sha256
            );
            let app = crate::router(config.clone()).unwrap();
            let task = tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            let client = reqwest::Client::new();
            let list: Vec<AssetArtwork> = client
                .get(&address)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert!(list[0].cached);
            assert!(!list[1].cached);
            let reply = client
                .get(format!("{address}/{first}"))
                .send()
                .await
                .unwrap();
            assert_eq!(reply.status(), StatusCode::OK);
            assert_eq!(reply.headers()[header::CONTENT_TYPE], "image/png");
            assert_eq!(&reply.bytes().await.unwrap()[..], png);
            // Existing images need no internet even when the download action is repeated.
            assert_eq!(
                client
                    .post(format!("{address}/{first}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NO_CONTENT
            );
            for missing in [&second, &"a".repeat(64)] {
                assert_eq!(
                    client
                        .get(format!("{address}/{missing}"))
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    StatusCode::NOT_FOUND
                );
            }
            task.abort();
            let _ = task.await;
        }
        assert_eq!(
            Store::new(root.clone()).original(&info.sha256).unwrap(),
            FIXTURE
        );
        let file = cache_path(&root, &first).unwrap();
        let mut broken = std::fs::read(&file).unwrap();
        broken[40] ^= 1;
        std::fs::write(&file, broken).unwrap();
        assert!(cached(&root, &first).is_err());
        publish(&root, &first, &png).unwrap();
        assert_eq!(cached(&root, &first).unwrap(), png);
        assert!(cache_path(&root, "../../escape").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn refuses_local_sources_before_connecting() {
        assert!(fetch("https://127.0.0.1/image.png").await.is_err());
        assert!(fetch("https://[::1]/image.png").await.is_err());
    }
    #[tokio::test]
    async fn validates_download_type_status_and_size_before_decoding() {
        use axum::routing::get;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new()
            .route(
                "/ok",
                get(|| async { ([(header::CONTENT_TYPE, "image/png")], sample_png()) }),
            )
            .route("/html", get(|| async { "<html>not an image</html>" }))
            .route(
                "/large",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "image/png")],
                        vec![0; MAX_DOWNLOAD + 1],
                    )
                }),
            )
            .route(
                "/redirect",
                get(|| async {
                    (
                        StatusCode::FOUND,
                        [(header::LOCATION, "https://127.0.0.1/")],
                    )
                }),
            );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let bytes = image_body(client.get(format!("{address}/ok")).send().await.unwrap())
            .await
            .unwrap();
        assert!(thumbnail(&bytes).is_ok());
        for path in ["html", "large", "redirect"] {
            assert!(
                image_body(
                    client
                        .get(format!("{address}/{path}"))
                        .send()
                        .await
                        .unwrap()
                )
                .await
                .is_err()
            );
        }
        task.abort();
        let _ = task.await;
    }
}
