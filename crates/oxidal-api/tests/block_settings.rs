//! The offline editor's shared settings use the installed effect layout.
#![cfg(unix)]
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use oxidal_api::{Config, router};
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt, path::Path};
use tower::ServiceExt;

fn app(root: &Path) -> Router {
    router(Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: None,
        graph_worker: Some(root.join("worker")),
        rig_worker: None,
        mapping_path: root.join("maps"),
        preset_dir: root.join("presets"),
        media_dir: None,
        ui_dir: root.join("ui"),
        shutdown: None,
    })
    .unwrap()
}

async fn request(app: &Router, command: Option<Value>) -> (u16, Value) {
    let path = "/api/v1/presets/block-settings";
    let request = if let Some(body) = command {
        Request::post(path)
            .header("Host", "127.0.0.1")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    } else {
        Request::get(path)
            .header("Host", "127.0.0.1")
            .body(Body::empty())
            .unwrap()
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let code = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (code, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn offline_settings_survive_restart_and_reject_incompatible_or_stale_edits() {
    let root = std::env::temp_dir().join(format!(
        "oxidal-block-settings-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let plugin = "urn:oxidal:plugin:echo#mono";
    let port = oxidal_lv2::Port {
        symbol: "enabled".into(),
        input: true,
        control: true,
        integer: true,
        toggled: true,
        minimum: Some(0.),
        maximum: Some(1.),
        default: Some(0.),
        ..Default::default()
    };
    fs::write(
        root.join("catalog.json"),
        json!({"sample_rate":48000,"plugins":[{"uri":plugin,"name":"Echo","ports":[port]}]})
            .to_string(),
    )
    .unwrap();
    let worker = root.join("worker");
    fs::write(&worker, "#!/bin/sh\n[ \"$1\" = --catalog ] && [ \"$2\" = 48000 ] || exit 1\nexec cat \"$(dirname \"$0\")/catalog.json\"\n").unwrap();
    fs::set_permissions(worker, fs::Permissions::from_mode(0o700)).unwrap();
    let first = app(&root);
    assert_eq!(
        request(&first, None).await,
        (200, json!({"entries":[],"revision":0}))
    );
    let entry = json!({"id":"a".repeat(32),"name":"Lead","plugin":plugin,"controls":{"enabled":1}});
    let create = json!({"kind":"create","revision":0,"entry":entry});
    let (code, saved) = request(&first, Some(create.clone())).await;
    assert_eq!(code, 200, "{saved}");
    assert_eq!(request(&first, Some(create)).await.0, 409);
    let reopened = app(&root);
    assert_eq!(request(&reopened, None).await.1, saved);
    let mut replace = json!({"kind":"replace","revision":1,"entry":entry});
    for invalid in [
        json!({"enabled":0.5}),
        json!({"enabled":1,"extra":0}),
        json!({"unavailable":1}),
    ] {
        replace["entry"]["controls"] = invalid;
        assert_eq!(request(&reopened, Some(replace.clone())).await.0, 422);
    }
    assert_eq!(request(&reopened, None).await.1, saved);
    replace["entry"]["controls"] = json!({"enabled":0});
    let (code, saved) = request(&reopened, Some(replace)).await;
    assert_eq!(code, 200);
    assert_eq!(saved["entries"][0]["controls"]["enabled"], 0.0);
    let mut other = entry.clone();
    other["id"] = json!("b".repeat(32));
    assert_eq!(
        request(
            &reopened,
            Some(json!({"kind":"create","revision":2,"entry":other}))
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &reopened,
            Some(json!({"kind":"delete","revision":2,"id":entry["id"]}))
        )
        .await
        .0,
        409
    );
    let before_failed_write = request(&reopened, None).await.1;
    let temp = root.join("presets/block-settings-v1.json.tmp");
    fs::create_dir(&temp).unwrap();
    assert_eq!(
        request(
            &reopened,
            Some(json!({"kind":"delete","revision":3,"id":entry["id"]}))
        )
        .await
        .0,
        500
    );
    assert_eq!(request(&reopened, None).await.1, before_failed_write);
    fs::remove_dir(temp).unwrap();
    let (_, last) = request(
        &reopened,
        Some(json!({"kind":"delete","revision":3,"id":entry["id"]})),
    )
    .await;
    assert_eq!(last["entries"][0]["id"], other["id"]);
    fs::remove_dir_all(root).unwrap();
}
