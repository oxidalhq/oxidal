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
    let Some(worker) = shared.config.graph_worker.clone() else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "LV2 discovery is unavailable",
        );
    };
    let Ok(permit) = shared.catalog_work.clone().try_acquire_owned() else {
        return failure(StatusCode::CONFLICT, "LV2 discovery already in progress");
    };
    // The task owns both child and permit if the browser disconnects. Always reap
    // before allowing another scan; a cancelled request cannot multiply workers.
    let task = tokio::spawn(async move {
        let _permit = permit;
        discover(worker, query.sample_rate).await
    });
    match task.await {
        Ok(Ok(catalog)) => Json(catalog).into_response(),
        Ok(Err(error)) => failure(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(_) => failure(StatusCode::SERVICE_UNAVAILABLE, "LV2 discovery task failed"),
    }
}

async fn discover(worker: PathBuf, sample_rate: u32) -> Result<PluginCatalog, String> {
    let mut child = tokio::process::Command::new(worker)
        .arg("--catalog")
        .arg(sample_rate.to_string())
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
            .take((CATALOG_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Cannot read LV2 catalog")?;
        if bytes.len() > CATALOG_LIMIT {
            return Err("LV2 catalog exceeds response limit".to_owned());
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Cannot reap LV2 discovery")?;
        if !status.success() {
            return Err("LV2 discovery failed".to_owned());
        }
        let catalog: PluginCatalog =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid LV2 discovery response")?;
        catalog.validate()?;
        if catalog.sample_rate != sample_rate {
            return Err("LV2 catalog sample rate mismatch".to_owned());
        }
        Ok(catalog)
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
