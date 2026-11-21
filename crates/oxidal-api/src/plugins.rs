//! Read-only installed metadata in a disposable process. Discovery never takes PCM.
use super::*;
use axum::extract::{Query, rejection::QueryRejection};
use oxidal_lv2::{CATALOG_LIMIT, PluginCatalog};
use std::process::Stdio;
use tokio::io::AsyncReadExt;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogQuery {
    sample_rate: u32,
}

pub async fn catalog(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<CatalogQuery>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Expected sample_rate query");
    };
    if !(8000..=192000).contains(&query.sample_rate) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "Invalid sample rate");
    }
    match installed(&shared, query.sample_rate).await {
        Ok(catalog) => Json(catalog).into_response(),
        Err((status, reason)) => failure(status, &reason),
    }
}

pub(super) async fn installed(
    shared: &Shared,
    rate: u32,
) -> Result<PluginCatalog, (StatusCode, String)> {
    let worker = shared.config.graph_worker.clone().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "LV2 discovery is unavailable".into(),
    ))?;
    let permit = tokio::time::timeout(
        Duration::from_secs(12),
        shared.catalog_work.clone().acquire_owned(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .ok_or((
        StatusCode::CONFLICT,
        "LV2 discovery already in progress".into(),
    ))?;
    tokio::spawn(async move {
        let _permit = permit;
        discover(worker, rate).await
    })
    .await
    .map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "LV2 discovery task failed".into(),
        )
    })?
    .map_err(|reason| (StatusCode::SERVICE_UNAVAILABLE, reason))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtworkQuery {
    uri: String,
}

pub async fn artwork(
    State(shared): State<Arc<Shared>>,
    Query(query): Query<ArtworkQuery>,
) -> Response {
    if query.uri.is_empty() || query.uri.len() > 4096 || query.uri.chars().any(char::is_control) {
        return failure(StatusCode::BAD_REQUEST, "Invalid plugin URI");
    }
    let Some(worker) = shared.config.graph_worker.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Ok(permit)) = tokio::time::timeout(
        Duration::from_secs(12),
        shared.catalog_work.clone().acquire_owned(),
    )
    .await
    else {
        return failure(StatusCode::CONFLICT, "LV2 discovery already in progress");
    };
    match tokio::spawn(async move {
        let _permit = permit;
        worker_output(
            worker,
            "--artwork",
            query.uri,
            oxidal_lv2::artwork::MAX_BYTES,
        )
        .await
    })
    .await
    {
        Ok(Ok(bytes)) if oxidal_lv2::artwork::admitted_png(&bytes) => (
            [
                (axum::http::header::CONTENT_TYPE, "image/png"),
                (axum::http::header::CACHE_CONTROL, "private, max-age=86400"),
                (axum::http::header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Ok(Ok(_)) => StatusCode::NOT_FOUND.into_response(),
        _ => failure(StatusCode::SERVICE_UNAVAILABLE, "LV2 artwork worker failed"),
    }
}

pub(super) async fn discover(worker: PathBuf, sample_rate: u32) -> Result<PluginCatalog, String> {
    let bytes = worker_output(worker, "--catalog", sample_rate.to_string(), CATALOG_LIMIT).await?;
    let mut catalog: PluginCatalog =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid LV2 discovery response")?;
    catalog.validate()?;
    for plugin in &mut catalog.plugins {
        if plugin
            .pack_id
            .as_deref()
            .is_some_and(|id| !oxidal_device::packs::known(id))
        {
            plugin.pack_id = None;
        }
    }
    if catalog.sample_rate != sample_rate {
        return Err("LV2 catalog sample rate mismatch".into());
    }
    Ok(catalog)
}

async fn worker_output(
    worker: PathBuf,
    mode: &str,
    argument: String,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut child = tokio::process::Command::new(worker)
        .arg(mode)
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Cannot start LV2 discovery")?;
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or("Missing catalog output")?
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Cannot read LV2 catalog")?;
        if bytes.len() > limit {
            return Err("LV2 catalog exceeds response limit".to_owned());
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Cannot reap LV2 discovery")?;
        if !status.success() {
            return Err("LV2 discovery failed".to_owned());
        }
        Ok(bytes)
    })
    .await
    .unwrap_or_else(|_| Err("LV2 discovery timed out".into()));
    if result.is_err() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn artwork_route_serves_only_bounded_png_worker_output() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;

        let root =
            std::env::temp_dir().join(format!("oxidal-lv2-artwork-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let worker = root.join("worker");
        let png = include_bytes!("../../oxidal-lv2/tests/fixtures/metadata/thumbnail.png");
        let mut bad_dimensions = png.to_vec();
        bad_dimensions[16..20].copy_from_slice(&1025u32.to_be_bytes());
        std::fs::write(root.join("thumbnail.png"), png).unwrap();
        std::fs::write(root.join("bad-dimensions.png"), bad_dimensions).unwrap();
        std::fs::write(
            &worker,
            r#"#!/bin/sh
[ "$#" -eq 2 ] && [ "$1" = --artwork ] || exit 1
case "$2" in
  'https://example.org/plugin#thumb') exec cat "$(dirname "$0")/thumbnail.png" ;;
  urn:bad-dimensions) exec cat "$(dirname "$0")/bad-dimensions.png" ;;
  urn:absent) exit 0 ;;
  urn:invalid) printf '<svg></svg>' ;;
  urn:oversized) exec yes x ;;
  *) exit 1 ;;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&worker, std::fs::Permissions::from_mode(0o700)).unwrap();
        let app = router(Config {
            debug_socket: None,
            device_socket: None,
            simulator: false,
            native_worker: None,
            audio_worker: None,
            graph_worker: Some(worker),
            rig_worker: None,
            mapping_path: root.join("mappings.json"),
            preset_dir: root.join("presets"),
            media_dir: None,
            ui_dir: root.join("ui"),
            shutdown: None,
        })
        .unwrap();
        for (query, status) in [
            ("?uri=https%3A%2F%2Fexample.org%2Fplugin%23thumb", 200),
            ("?uri=urn%3Aabsent", 404),
            ("?uri=urn%3Ainvalid", 404),
            ("?uri=urn%3Abad-dimensions", 404),
            ("?uri=urn%3Aoversized", 503),
            ("?uri=urn%3Afailed", 503),
            ("?uri=", 400),
            ("?uri=urn%3Ainvalid%00", 400),
            ("?uri=urn%3Aabsent&path=%2Fetc%2Fpasswd", 400),
            ("", 400),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::get(format!("/api/v1/plugins/lv2/artwork{query}"))
                        .header(axum::http::header::HOST, "127.0.0.1")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status, "{query}");
            if status == 200 {
                assert_eq!(response.headers()["content-type"], "image/png");
                assert_eq!(
                    response.headers()["cache-control"],
                    "private, max-age=86400"
                );
                assert_eq!(response.headers()["x-content-type-options"], "nosniff");
                let bytes = axum::body::to_bytes(response.into_body(), png.len())
                    .await
                    .unwrap();
                assert_eq!(bytes.as_ref(), png);
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rejects_bad_catalog_responses_and_reaps_failures() {
        let root = std::env::temp_dir().join(format!("oxidal-catalog-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let worker = root.join("worker");
        for (reply, expected) in [
            (r#"{"sample_rate":48000,"plugins":[]}"#, None),
            (
                r#"{"sample_rate":96000,"plugins":[]}"#,
                Some("sample rate mismatch"),
            ),
            (
                r#"{"sample_rate":48000,"plugins":[],"extra":true}"#,
                Some("Invalid LV2 discovery response"),
            ),
            ("not-json", Some("Invalid LV2 discovery response")),
        ] {
            std::fs::write(&worker, format!("#!/bin/sh\nprintf '%s' '{reply}'\n")).unwrap();
            std::fs::set_permissions(&worker, std::fs::Permissions::from_mode(0o700)).unwrap();
            let result = discover(worker.clone(), 48000).await;
            match expected {
                Some(message) => assert!(result.unwrap_err().contains(message)),
                None => assert!(result.unwrap().plugins.is_empty()),
            }
        }
        std::fs::write(&worker, "#!/bin/sh\nexit 1\n").unwrap();
        assert_eq!(
            discover(worker.clone(), 48000).await.unwrap_err(),
            "LV2 discovery failed"
        );
        assert!(discover(root.join("missing"), 48000).await.is_err());
        // A direct executable avoids shell descendants; capture its PID to prove
        // an oversized producer is killed/reaped, not left running after rejection.
        std::fs::write(
            &worker,
            format!(
                "#!/bin/sh\necho $$ > '{}'\nexec yes x\n",
                root.join("pid").display()
            ),
        )
        .unwrap();
        assert_eq!(
            discover(worker, 48000).await.unwrap_err(),
            "LV2 catalog exceeds response limit"
        );
        let pid = std::fs::read_to_string(root.join("pid")).unwrap();
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
