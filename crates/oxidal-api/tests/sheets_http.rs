use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use oxidal_api::{Config, router};
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const SHEETS: &str = "/media/sheets";
const TRACK: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        Self(std::env::temp_dir().join(format!(
            "oxidal-sheet-http-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )))
    }

    fn router(&self) -> Router {
        fs::create_dir_all(self.0.join("presets")).unwrap();
        router(Config {
            debug_socket: None,
            device_socket: None,
            graph_worker: None,
            rig_worker: None,
            audio_worker: None,
            native_worker: None,
            shutdown: None,
            simulator: false,
            mapping_path: self.0.join("mappings.json"),
            preset_dir: self.0.join("presets"),
            media_dir: Some(self.0.join("media")),
            ui_dir: self.0.join("ui"),
        })
        .unwrap()
    }

    fn media(&self, name: &str) -> PathBuf {
        self.0.join("media").join(name)
    }

    fn install_fixture_track(&self) {
        let track = self.media("assets").join(TRACK);
        fs::create_dir_all(&track).unwrap();
        fs::write(track.join("play-48000.f32"), [0; 4]).unwrap();
        fs::write(track.join("manifest.json"), serde_json::to_vec(&json!({
            "schema":1, "id":TRACK, "kind":"backing", "title":"Backing", "created_at":"2026-01-01T00:00:00Z",
            "renders":[{"file":"play-48000.f32","rate":48000,"channels":1,"frames":1,"sha256":"0".repeat(64)}]
        })).unwrap()).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

async fn http(app: &Router, method: &str, path: &str, body: Option<Value>) -> Response {
    let body = body
        .map(|value| Body::from(value.to_string()))
        .unwrap_or_else(Body::empty);
    let request = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1")
        .header("content-type", "application/json")
        .body(body)
        .unwrap();
    app.clone().oneshot(request).await.unwrap()
}

async fn json_response(response: Response, status: StatusCode) -> Value {
    let actual = response.status();
    let bytes = to_bytes(response.into_body(), 5 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(actual, status, "{}", String::from_utf8_lossy(&bytes));
    serde_json::from_slice(&bytes).unwrap()
}

async fn create(app: &Router, current: &str, source: &str) -> Value {
    json_response(
        http(
            app,
            "POST",
            SHEETS,
            Some(json!({
                "expected":current, "title":"Harbour", "format":"chordpro", "source":source
            })),
        )
        .await,
        StatusCode::CREATED,
    )
    .await
}

#[tokio::test]
async fn sheet_http_export_pagination_stale_edit_and_restart() {
    let fixture = Fixture::new();
    let app = fixture.router();
    let initial = json_response(http(&app, "GET", SHEETS, None).await, StatusCode::OK).await;
    assert_eq!(initial, json!({"registry_revision":"","sheets":[]}));
    let source = "{title: Harbour}\r\n[Am]été\t<script>x</script>\r\n";
    let one = create(&app, "", source).await;
    let revision = one["sheet"]["revision"].as_str().unwrap();
    let id = one["sheet"]["id"].as_str().unwrap();
    let path = format!("{SHEETS}/{id}");
    let export = http(&app, "GET", &format!("{path}/export"), None).await;
    assert_eq!(export.status(), 200);
    assert_eq!(
        export.headers()["content-type"],
        "text/plain; charset=utf-8"
    );
    assert_eq!(export.headers()["cache-control"], "no-store");
    assert_eq!(export.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        export.headers()["content-disposition"],
        format!("attachment; filename=\"{id}.cho\"")
    );
    assert_eq!(
        &to_bytes(export.into_body(), 65_536).await.unwrap()[..],
        source.as_bytes()
    );

    let two = create(&app, one["registry_revision"].as_str().unwrap(), "Second").await;
    let page = json_response(
        http(&app, "GET", &format!("{SHEETS}?limit=1"), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(page["sheets"].as_array().unwrap().len(), 1);
    assert!(page["sheets"][0].get("source").is_none());
    let next = page["next"].as_str().unwrap();
    let last = json_response(
        http(&app, "GET", &format!("{SHEETS}?after={next}&limit=1"), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(last["sheets"].as_array().unwrap().len(), 1);
    assert_ne!(last["sheets"][0]["id"], page["sheets"][0]["id"]);
    assert!(last.get("next").is_none());
    assert_eq!(last["registry_revision"], two["registry_revision"]);

    let edit = |source: &str| json!({"expected": revision, "title":"Harbour", "format":"text", "source":source});
    let (a, b) = tokio::join!(
        http(&app, "PATCH", &path, Some(edit("One"))),
        http(&app, "PATCH", &path, Some(edit("Two"))),
    );
    let (saved, stale) = if a.status() == 200 { (a, b) } else { (b, a) };
    let saved = json_response(saved, StatusCode::OK).await;
    json_response(stale, StatusCode::CONFLICT).await;
    drop(app);

    let reopened = fixture.router();
    let read = json_response(http(&reopened, "GET", &path, None).await, StatusCode::OK).await;
    assert_eq!(read, saved["sheet"]);
}

#[tokio::test]
async fn sheet_http_link_delete_is_atomic_and_missing_links_remain_visible() {
    let fixture = Fixture::new();
    let app = fixture.router();
    fixture.install_fixture_track();
    let created = create(&app, "", "Words").await;
    let id = created["sheet"]["id"].as_str().unwrap();
    let revision = created["sheet"]["revision"].as_str().unwrap();
    let registry = created["registry_revision"].as_str().unwrap();
    let path = format!("{SHEETS}/{id}");
    let links = format!("{SHEETS}/links");
    let target = json!({"kind":"track","asset":TRACK});
    let link = |expected: &str, sheet: Option<&str>| json!({"expected":expected,"target":target,"sheet":sheet});
    let delete =
        |registry: &str, revision: &str| json!({"expected":revision,"registry_revision":registry});

    let (link_result, delete_result) = tokio::join!(
        http(&app, "PUT", &links, Some(link(registry, Some(id)))),
        http(&app, "DELETE", &path, Some(delete(registry, revision))),
    );
    let (path, id, revision) = if link_result.status() == 200 {
        json_response(delete_result, StatusCode::CONFLICT).await;
        let linked = json_response(link_result, StatusCode::OK).await;
        assert_eq!(linked["links"][0]["available"], true);
        (path, id.to_owned(), revision.to_owned())
    } else {
        json_response(link_result, StatusCode::CONFLICT).await;
        let deleted = json_response(delete_result, StatusCode::OK).await;
        let created = create(
            &app,
            deleted["registry_revision"].as_str().unwrap(),
            "Words",
        )
        .await;
        let id = created["sheet"]["id"].as_str().unwrap().to_owned();
        let registry = created["registry_revision"].as_str().unwrap();
        json_response(
            http(&app, "PUT", &links, Some(link(registry, Some(&id)))).await,
            StatusCode::OK,
        )
        .await;
        (
            format!("{SHEETS}/{id}"),
            id,
            created["sheet"]["revision"].as_str().unwrap().to_owned(),
        )
    };
    let refs = format!("{path}/references");
    let preview = json_response(http(&app, "GET", &refs, None).await, StatusCode::OK).await;
    assert_eq!(preview["links"][0]["sheet"], id);
    assert_eq!(preview["sheet_revision"], revision);
    json_response(
        http(
            &app,
            "DELETE",
            &path,
            Some(delete(
                preview["registry_revision"].as_str().unwrap(),
                &revision,
            )),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;

    let track = format!("/media/assets/{TRACK}");
    assert_eq!(http(&app, "DELETE", &track, None).await.status(), 204);
    let dangling = json_response(http(&app, "GET", &refs, None).await, StatusCode::OK).await;
    assert_eq!(dangling["links"][0]["available"], false);
    let current = dangling["registry_revision"].as_str().unwrap();
    json_response(
        http(&app, "PUT", &links, Some(link(current, Some(&id)))).await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    let removed = json_response(
        http(&app, "PUT", &links, Some(link(current, None))).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(removed["links"], json!([]));
    json_response(
        http(&app, "DELETE", &path, Some(delete(current, &revision))).await,
        StatusCode::CONFLICT,
    )
    .await;
    json_response(
        http(
            &app,
            "DELETE",
            &path,
            Some(delete(
                removed["registry_revision"].as_str().unwrap(),
                &revision,
            )),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(http(&app, "GET", &path, None).await.status(), 404);
}

#[tokio::test]
async fn sheet_http_backup_restores_missing_targets_and_refuses_overwrite() {
    let source = Fixture::new();
    let src = source.router();
    let initial = create(&src, "", "Read [F]this\n").await;
    let id = initial["sheet"]["id"].as_str().unwrap();
    let preset = oxidal_presets::Store::new(source.0.join("presets"))
        .import(include_bytes!(
            "../../oxidal-presets/tests/fixtures/authored-current.t3kpreset"
        ))
        .unwrap()
        .sha256;
    let preset_target = json!({"kind":"preset","preset":{"kind":"original","id":preset}});
    let links = format!("{SHEETS}/links");
    let linked = json_response(
        http(
            &src,
            "PUT",
            &links,
            Some(json!({
                "expected":initial["registry_revision"], "target":preset_target, "sheet":id
            })),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(linked["links"][0]["available"], true);
    let archive = json_response(
        http(&src, "GET", &format!("{SHEETS}/backup"), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(archive["schema"], 1);
    assert_eq!(archive["links"][0]["target"], preset_target);

    let tar = http(&src, "GET", "/backup/library", None).await;
    assert_eq!(tar.status(), 200);
    let tar_path = source.0.join("backup.tar");
    fs::write(
        &tar_path,
        to_bytes(tar.into_body(), 5 * 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    let member = |name| {
        let output = std::process::Command::new("/usr/bin/tar")
            .arg("-xOf")
            .arg(&tar_path)
            .arg(name)
            .output()
            .unwrap();
        assert!(output.status.success());
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    assert_eq!(member("chord-sheets.json"), archive);
    assert!(
        member("manifest.json")["includes"]
            .as_array()
            .unwrap()
            .contains(&json!("chord-sheets.json"))
    );

    let dest_fixture = Fixture::new();
    let dest = dest_fixture.router();
    let restore = format!("{SHEETS}/restore");
    let body = |expected: &str| json!({"expected":expected,"archive":archive});
    json_response(
        http(&dest, "POST", &restore, Some(body(id))).await,
        StatusCode::CONFLICT,
    )
    .await;
    let restored = json_response(
        http(&dest, "POST", &restore, Some(body(""))).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(restored["restored"], 1);
    json_response(
        http(
            &dest,
            "POST",
            &restore,
            Some(body(restored["registry_revision"].as_str().unwrap())),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    let path = format!("{SHEETS}/{id}");
    let doc = json_response(http(&dest, "GET", &path, None).await, StatusCode::OK).await;
    assert_eq!(doc["id"], id);
    assert_eq!(doc["source"], initial["sheet"]["source"]);
    assert_ne!(doc["revision"], initial["sheet"]["revision"]);
    let missing = json_response(http(&dest, "GET", &links, None).await, StatusCode::OK).await;
    assert_eq!(missing["links"][0]["available"], false);
    assert_eq!(missing["links"][0]["target"], preset_target);
}

#[tokio::test]
async fn sheet_http_corruption_recovery_preserves_original_and_rejects_changed_or_oversize_data() {
    let fixture = Fixture::new();
    let app = fixture.router();
    let created = create(&app, "", "Words").await;
    let archive = json_response(
        http(&app, "GET", &format!("{SHEETS}/backup"), None).await,
        StatusCode::OK,
    )
    .await;
    let registry = fixture.media("chord-sheets.json");
    fs::write(&registry, b"first damaged copy").unwrap();
    let bad = json_response(
        http(&app, "GET", SHEETS, None).await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    let stale = bad["damaged_sha256"].as_str().unwrap();
    let corrupt = br#"{"schema":99}"#;
    fs::write(&registry, corrupt).unwrap();
    let bad = json_response(
        http(&app, "GET", "/backup/library", None).await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    let digest = bad["damaged_sha256"].as_str().unwrap();
    assert_ne!(digest, stale);
    assert_eq!(digest.len(), 64);
    assert_eq!(http(&app, "GET", "/media", None).await.status(), 200);
    let restore = format!("{SHEETS}/restore");
    let recover = |digest: &str| json!({"damaged_sha256":digest,"archive":archive});
    json_response(
        http(&app, "POST", &restore, Some(recover(stale))).await,
        StatusCode::CONFLICT,
    )
    .await;
    let quarantine = fixture.media(&format!("chord-sheets-damaged-{digest}.json"));
    fs::write(&quarantine, b"occupied").unwrap();
    json_response(
        http(&app, "POST", &restore, Some(recover(digest))).await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(fs::read(&quarantine).unwrap(), b"occupied");
    assert_eq!(fs::read(&registry).unwrap(), corrupt);

    fs::remove_file(&quarantine).unwrap();
    let restored = json_response(
        http(&app, "POST", &restore, Some(recover(digest))).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(restored["restored"], 1);
    assert_eq!(fs::read(&quarantine).unwrap(), corrupt);
    let id = created["sheet"]["id"].as_str().unwrap();
    assert_eq!(
        http(&app, "GET", &format!("{SHEETS}/{id}"), None)
            .await
            .status(),
        200
    );

    fs::File::create(&registry)
        .unwrap()
        .set_len(4 * 1024 * 1024 + 1)
        .unwrap();
    let bad = json_response(
        http(&app, "GET", SHEETS, None).await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    assert!(bad.get("damaged_sha256").is_none());
    assert_eq!(
        http(&app, "POST", &restore, Some(recover(digest)))
            .await
            .status(),
        503
    );

    #[cfg(unix)]
    {
        let elsewhere = fixture.media("unrelated.json");
        fs::remove_file(&registry).unwrap();
        fs::write(&elsewhere, corrupt).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &registry).unwrap();
        let bad = json_response(
            http(&app, "GET", SHEETS, None).await,
            StatusCode::SERVICE_UNAVAILABLE,
        )
        .await;
        assert!(bad.get("damaged_sha256").is_none());
        assert_eq!(
            http(&app, "POST", &restore, Some(recover(digest)))
                .await
                .status(),
            503
        );
        assert_eq!(fs::read(&elsewhere).unwrap(), corrupt);
    }
}

#[tokio::test]
async fn sheet_http_rejects_invalid_input_and_no_space_without_creating_registry() {
    let fixture = Fixture::new();
    let app = fixture.router();
    let body = |format: &str, source: &str| json!({"expected":"","title":"Song","format":format,"source":source});
    for (format, source) in [
        ("pdf", "text"),
        ("text", "a\0b"),
        ("text", ""),
        ("text", "line\u{0085}line"),
    ] {
        json_response(
            http(&app, "POST", SHEETS, Some(body(format, source))).await,
            StatusCode::BAD_REQUEST,
        )
        .await;
    }
    for text in ["a".repeat(65_537), "a".repeat(400_000)] {
        json_response(
            http(&app, "POST", SHEETS, Some(body("text", &text))).await,
            StatusCode::PAYLOAD_TOO_LARGE,
        )
        .await;
    }
    let restore = format!("{SHEETS}/restore");
    let unknown_schema = json!({"expected":"","archive":{"schema":99,"sheets":[],"links":[]}});
    json_response(
        http(&app, "POST", &restore, Some(unknown_schema)).await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert!(!fixture.media("chord-sheets.json").exists());

    drop(app);
    fs::write(
        fixture.media("store.json"),
        br#"{"schema":1,"reserve_bytes":18446744073709551615}"#,
    )
    .unwrap();
    let app = fixture.router();
    json_response(
        http(&app, "POST", SHEETS, Some(body("text", "Song"))).await,
        StatusCode::INSUFFICIENT_STORAGE,
    )
    .await;
    assert!(!fixture.media("chord-sheets.json").exists());
}
