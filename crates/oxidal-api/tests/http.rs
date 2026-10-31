use oxidal_api::{Config, router};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);

#[tokio::test]
async fn interrupted_library_removal_recovers_before_router_start_and_corruption_blocks_startup() {
    use oxidal_presets::{LibraryKind, RemovalReferences, RemovalRequest, RemovalStore, Store};
    let root = std::env::temp_dir().join(format!(
        "oxidal-startup-removal-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let bytes = include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
    let id = Store::new(root.clone()).import(bytes).unwrap().sha256;
    let removal = RemovalStore::new(root.clone());
    let preview = removal
        .preview(LibraryKind::Original, &id, &RemovalReferences::default())
        .unwrap();
    let pending = removal
        .begin(
            &RemovalRequest {
                entry_kind: LibraryKind::Original,
                id: id.clone(),
                expected_preview: preview.token,
                delete_models: false,
            },
            &RemovalReferences::default(),
        )
        .unwrap();
    std::mem::forget(pending);
    assert!(!root.join(format!("{id}.t3kpreset")).exists());
    let config = Config {
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
    assert!(router(config.clone()).is_ok());
    assert_eq!(
        std::fs::read(root.join(format!("{id}.t3kpreset"))).unwrap(),
        bytes
    );
    let corrupt = root.join(".remove-corrupt");
    std::fs::create_dir(&corrupt).unwrap();
    std::fs::write(corrupt.join("intent.json"), b"invalid journal").unwrap();
    let error = router(config).err().unwrap();
    assert!(error.contains("Cannot recover interrupted preset removal"));
    assert!(corrupt.join("intent.json").exists());
    assert!(root.join(format!("{id}.t3kpreset")).exists());
    std::fs::remove_dir_all(root).unwrap();
}

async fn start(simulator: bool) -> (String, tokio::task::JoinHandle<()>, PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "oxidal-test-{}-{}.json",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let app = router(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator,
        mapping_path: path.clone(),
        preset_dir: path.with_extension("presets"),
        ui_dir: PathBuf::from("nonexistent"),
    })
    .unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, task, path)
}
#[tokio::test]
async fn ui_page_revalidates_while_hashed_assets_stay_immutable() {
    let root = std::env::temp_dir().join(format!(
        "oxidal-ui-cache-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(root.join("ui/assets")).unwrap();
    std::fs::write(root.join("ui/index.html"), "<!doctype html>").unwrap();
    std::fs::write(root.join("ui/assets/index-abc123.js"), "export {}").unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = router(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator: true,
        mapping_path: root.join("mappings.json"),
        preset_dir: root.join("presets"),
        ui_dir: root.join("ui"),
    })
    .unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let cache = |path: &'static str| {
        let url = url.clone();
        async move {
            let response = reqwest::get(format!("{url}{path}")).await.unwrap();
            // Client routes keep ServeDir's existing 404-with-page fallback.
            assert!(
                response.status().is_success() || path == "/rig",
                "{path}: {}",
                response.status()
            );
            response
                .headers()
                .get("cache-control")
                .map(|v| v.to_str().unwrap().to_owned())
        }
    };
    assert_eq!(cache("/").await.as_deref(), Some("no-cache"));
    assert_eq!(cache("/index.html").await.as_deref(), Some("no-cache"));
    // Client routes fall back to the page and must revalidate too.
    assert_eq!(cache("/rig").await.as_deref(), Some("no-cache"));
    assert_eq!(
        cache("/assets/index-abc123.js").await.as_deref(),
        Some("public, max-age=31536000, immutable")
    );
    task.abort();
    let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn real_service_rejects_bad_input_and_syncs_midi_web() {
    let (url, task, _) = start(true).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["revision"], 0);
    let request = json!({"session":state["session"],"protocol":1,"request_id":"midi","expected_revision":0,"action":{"type":"midi","input":{"device":"simulator","channel":1,"cc":21,"value":127}}});
    let response = client
        .post(format!("{url}/commands"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let state: Value = response.json().await.unwrap();
    assert_eq!(state["parameters"][0]["value"], 1.0);
    assert_eq!(state["origin"], "midi");
    assert_eq!(
        client
            .post(format!("{url}/commands"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let mut unsupported = request.clone();
    unsupported["protocol"] = json!(2);
    unsupported["expected_revision"] = json!(1);
    assert_eq!(
        client
            .post(format!("{url}/commands"))
            .json(&unsupported)
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let bad = client
        .post(format!("{url}/commands"))
        .header("content-type", "application/json")
        .body("{")
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 400);
    assert_eq!(bad.json::<Value>().await.unwrap()["error"], "invalid_json");
    assert_eq!(
        client
            .post(format!("{url}/commands"))
            .header("origin", "https://evil.example")
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let mut rig = oxidal_graph::Rig::example(true);
    rig.edges[0].from = "missing".into();
    let result: Value = client
        .post(format!("{url}/rig/validate"))
        .json(&rig)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(result["valid"], false);
    assert_eq!(
        client
            .post(format!("{url}/commands"))
            .header("content-type", "application/json")
            .body(" ".repeat(70000))
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    task.abort();
}
#[tokio::test]
async fn persistence_is_validated_and_simulator_can_be_disabled() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let request = json!({"session":state["session"],"protocol":1,"request_id":"save","expected_revision":0,"action":{"type":"mappings","file":state["mappings"]}});
    assert!(
        client
            .post(format!("{url}/commands"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    assert!(path.is_file());
    let app = router(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator: false,
        mapping_path: path.clone(),
        preset_dir: path.with_extension("presets"),
        ui_dir: "none".into(),
    });
    assert!(app.is_ok());
    let request = json!({"session":state["session"],"protocol":1,"request_id":"midi","expected_revision":1,"action":{"type":"midi","input":{"device":"simulator","channel":1,"cc":21,"value":1}}});
    let error: Value = client
        .post(format!("{url}/commands"))
        .json(&request)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(error["error"], "simulator_disabled");
    std::fs::write(&path, b"bad data").unwrap();
    assert!(
        router(Config {
            debug_socket: None,
            device_socket: None,
            graph_worker: None,
            rig_worker: None,
            audio_worker: None,
            native_worker: None,
            shutdown: None,
            simulator: false,
            mapping_path: path.clone(),
            preset_dir: path.with_extension("presets"),
            ui_dir: "none".into()
        })
        .is_err()
    );
    std::fs::remove_file(path).unwrap();
    task.abort();
}
#[test]
fn refuses_lan_listener() {
    assert!(oxidal_api::validate_address("0.0.0.0:3210".parse().unwrap()).is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn native_binary_stops_with_an_open_event_subscription() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut child = Command::new(env!("CARGO_BIN_EXE_oxidald"))
        .env("OXIDAL_ADDR", "127.0.0.1:0")
        .env(
            "OXIDAL_PRESET_DIR",
            std::env::temp_dir().join(format!("oxidal-shutdown-presets-{}", std::process::id())),
        )
        .env(
            "OXIDAL_MAPPING_PATH",
            std::env::temp_dir().join(format!("oxidal-shutdown-{}.json", std::process::id())),
        )
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let url = line
        .split("http://")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap();
    let response = reqwest::get(format!("http://{url}/api/v1/events"))
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert!(
        Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status()
            .unwrap()
            .success()
    );
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if Instant::now() >= until {
            child.kill().unwrap();
            let _ = child.wait();
            panic!("daemon did not shut down with SSE open");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    drop(response);
}

#[tokio::test]
async fn concurrent_relative_commands_do_not_lose_updates() {
    let (url, task, _) = start(true).await;
    let client = reqwest::Client::new();
    let initial: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut edits = Vec::new();
    for index in 0..20 {
        let client = client.clone();
        let endpoint = format!("{url}/commands");
        let session = initial["session"].clone();
        edits.push(tokio::spawn(async move {
            client.post(endpoint).json(&json!({"protocol":1,"session":session,"request_id":format!("edit-{index}"),"expected_revision":null,"action":{"type":"adjust","target":"nam-a.level","delta":0.01}})).send().await.unwrap().error_for_status().unwrap().json::<Value>().await.unwrap()
        }));
    }
    let mut highest = initial;
    for edit in edits {
        let state = edit.await.unwrap();
        if state["revision"].as_u64() > highest["revision"].as_u64() {
            highest = state;
        }
    }
    let final_state: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(final_state["revision"], 20);
    assert!((final_state["parameters"][0]["value"].as_f64().unwrap() - 0.7).abs() < 1e-9);
    assert_eq!(final_state["request_id"], highest["request_id"]);
    task.abort();
}

const CURRENT_PRESET: &[u8] =
    include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
const LEGACY_PRESET: &[u8] =
    include_bytes!("../../oxidal-presets/tests/fixtures/authored-legacy.t3kpreset");

#[tokio::test]
async fn native_library_import_preserves_originals_and_never_mutates_the_rig() {
    let (url, task, path) = start(true).await;
    let client = reqwest::Client::new();
    let before: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut ids = Vec::new();
    for bytes in [CURRENT_PRESET, LEGACY_PRESET, CURRENT_PRESET] {
        let response = client
            .post(format!("{url}/presets"))
            .header("content-type", "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let info: Value = response.json().await.unwrap();
        assert_eq!(info["playback_available"], false);
        let id = info["sha256"].as_str().unwrap();
        let download = client
            .get(format!("{url}/presets/{id}/original"))
            .send()
            .await
            .unwrap();
        assert!(
            download.headers()["content-disposition"]
                .to_str()
                .unwrap()
                .starts_with("attachment;")
        );
        assert_eq!(download.bytes().await.unwrap().as_ref(), bytes);
        ids.push(id.to_owned());
    }
    assert_eq!(ids[0], ids[2]);
    let library: Value = client
        .get(format!("{url}/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(library["presets"].as_array().unwrap().len(), 2);
    let endpoint = format!("{url}/presets/catalog");
    let mut catalog: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let initial = catalog["revision"].clone();
    let moved = catalog["items"][1]["id"].clone();
    for (id, action) in [
        (
            json!(ids[0]),
            json!({"kind":"rename","name":"My library label"}),
        ),
        (moved.clone(), json!({"kind":"move","up":true})),
        (json!(ids[0]), json!({"kind":"visibility","archived":true})),
    ] {
        let response=client.post(&endpoint).json(&json!({"expected_revision":catalog["revision"],"entry_kind":"original","id":id,"action":action})).send().await.unwrap();
        assert_eq!(response.status(), 200);
        catalog = response.json().await.unwrap();
    }
    assert_eq!(catalog["items"][0]["id"], moved);
    let hidden: Value = client
        .get(format!("{url}/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(hidden["presets"].as_array().unwrap().len(), 1);
    // Removed library entries remain available to existing rigs and exact download.
    let original = client
        .get(format!("{url}/presets/{}/original", ids[0]))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(original.as_ref(), CURRENT_PRESET);
    assert_eq!(client.post(&endpoint).json(&json!({"expected_revision":initial,"entry_kind":"original","id":ids[0],"action":{"kind":"rename","name":"Stale"}})).send().await.unwrap().status(),409);
    assert_eq!(client.post(&endpoint).json(&json!({"expected_revision":catalog["revision"],"entry_kind":"original","id":"../../escape","action":{"kind":"visibility","archived":false}})).send().await.unwrap().status(),422);
    let response=client.post(&endpoint).json(&json!({"expected_revision":catalog["revision"],"entry_kind":"original","id":ids[0],"action":{"kind":"visibility","archived":false}})).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let visible: Value = client
        .get(format!("{url}/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(visible["presets"].as_array().unwrap().len(), 2);
    assert!(
        visible["presets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "My library label")
    );
    for bytes in [
        b"not a preset".to_vec(),
        CURRENT_PRESET[..CURRENT_PRESET.len() - 1].to_vec(),
        [CURRENT_PRESET, b"extra"].concat(),
    ] {
        assert_eq!(
            client
                .post(format!("{url}/presets"))
                .body(bytes)
                .send()
                .await
                .unwrap()
                .status(),
            422
        );
    }
    assert_eq!(
        client
            .post(format!("{url}/presets"))
            .header("origin", "https://evil.example")
            .body(CURRENT_PRESET)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{url}/presets"))
            .body(vec![0u8; oxidal_presets::MAX_FILE_BYTES + 1])
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    assert_eq!(
        client
            .get(format!("{url}/presets/invalid/original"))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let after: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(before, after);
    let after_library: Value = client
        .get(format!("{url}/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(visible, after_library);
    task.abort();
    std::fs::remove_dir_all(path.with_extension("presets")).unwrap();
}

#[tokio::test]
async fn preset_disk_failure_leaves_control_and_import_status_honest() {
    let (url, task, path) = start(false).await;
    let root = path.with_extension("presets");
    std::fs::write(&root, b"not a directory").unwrap();
    let client = reqwest::Client::new();
    let before: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        client
            .post(format!("{url}/presets"))
            .body(CURRENT_PRESET)
            .send()
            .await
            .unwrap()
            .status(),
        500
    );
    let after: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(std::fs::read(&root).unwrap(), b"not a directory");
    task.abort();
    std::fs::remove_file(root).unwrap();
}

#[tokio::test]
async fn native_binary_recovers_the_same_original_after_restart() {
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    struct Daemon(Child);
    impl Drop for Daemon {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let root = std::env::temp_dir().join(format!(
        "oxidal-preset-restart-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let launch = || {
        let mut child = Daemon(
            Command::new(env!("CARGO_BIN_EXE_oxidald"))
                .env("OXIDAL_ADDR", "127.0.0.1:0")
                .env("OXIDAL_MAPPING_PATH", root.join("mappings.json"))
                .env("OXIDAL_PRESET_DIR", root.join("presets"))
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut line = String::new();
        BufReader::new(child.0.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let address = line
            .split("http://")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap();
        (child, format!("http://{address}/api/v1"))
    };
    let client = reqwest::Client::new();
    let (first, url) = launch();
    let info: Value = client
        .post(format!("{url}/presets"))
        .body(CURRENT_PRESET)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    drop(first); // A real process termination, not a second in-memory store object.
    let (second, url) = launch();
    let library: Value = client
        .get(format!("{url}/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(library["presets"][0], info);
    let id = info["sha256"].as_str().unwrap();
    let bytes = client
        .get(format!("{url}/presets/{id}/original"))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), CURRENT_PRESET);
    drop(second);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn owned_edit_commands_reject_competitors_and_retain_terminal_receipts() {
    let (url, task, _) = start(true).await;
    let client = reqwest::Client::new();
    let initial: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let post = |action: Value, revision: Option<u64>| {
        client.post(format!("{url}/commands")).json(&serde_json::json!({
            "protocol":1,"session":initial["session"],"request_id":"edit-test","expected_revision":revision,"action":action
        })).send()
    };
    let begin = serde_json::json!({"type":"edit","edit":{"phase":"begin","owner":"one","token":"first","target":"nam-a.level"}});
    assert_eq!(
        post(begin, initial["revision"].as_u64())
            .await
            .unwrap()
            .status(),
        200
    );
    let preview = serde_json::json!({"type":"edit","edit":{"phase":"preview","owner":"one","token":"first","sequence":1,"value":0.8}});
    assert_eq!(post(preview.clone(), None).await.unwrap().status(), 200);
    assert_eq!(post(preview, None).await.unwrap().status(), 409);
    let cancel =
        serde_json::json!({"type":"edit","edit":{"phase":"cancel","owner":"two","token":"first"}});
    assert_eq!(post(cancel, None).await.unwrap().status(), 409);
    assert_eq!(
        post(
            serde_json::json!({"type":"set","target":"nam-a.level","value":0.2}),
            None
        )
        .await
        .unwrap()
        .status(),
        409
    );
    let commit = serde_json::json!({"type":"edit","edit":{"phase":"commit","owner":"one","token":"first","sequence":2,"value":0.73}});
    let committed: Value = post(commit.clone(), None)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(committed["parameters"][0]["value"], 0.73);
    assert!(committed["edit"].is_null());
    let duplicate: Value = post(commit, None).await.unwrap().json().await.unwrap();
    assert_eq!(duplicate, committed);
    let late_cancel: Value = post(
        serde_json::json!({"type":"edit","edit":{"phase":"cancel","owner":"one","token":"first"}}),
        None,
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(late_cancel, committed);
    task.abort();
}

#[tokio::test]
async fn audio_inspection_preserves_authoring_and_rejects_arbitrary_pcm() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    let before: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let inventory = client
        .get(format!("{url}/audio/devices"))
        .send()
        .await
        .unwrap();
    assert!(inventory.status().is_success());
    let inventory: Value = inventory.json().await.unwrap();
    assert_eq!(inventory["streaming_available"], false);
    assert!(inventory["endpoints"].is_array());
    let request = json!({"endpoint":"file:/tmp/oxidal-must-not-create", "direction":"capture", "sample_rate":48000,
        "channels":2, "format":"s16", "period_frames":128, "periods":3});
    let rejected = client
        .post(format!("{url}/audio/probe"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), 422);
    let mut invalid = request.clone();
    invalid["channels"] = json!(0);
    assert_eq!(
        client
            .post(format!("{url}/audio/probe"))
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    assert_eq!(
        client
            .post(format!("{url}/audio/probe"))
            .header("Origin", "https://elsewhere.example")
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let after: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(before, after);
    assert!(
        client
            .get(format!("{url}/presets"))
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    task.abort();
}

#[tokio::test]
async fn playback_unavailable_rejects_stale_and_foreign_control_without_stopping_ui() {
    let (url, task, _) = start(true).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["phase"], "unavailable");
    assert_eq!(state["device_owned"], false);
    let command = json!({"session":state["session"],"expected_revision":state["revision"],"action":{"kind":"stop"}});
    assert_eq!(
        client
            .post(format!("{url}/audio"))
            .json(&command)
            .header("origin", "https://untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{url}/audio"))
            .json(&command)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let mut stale = command;
    stale["session"] = json!("previous-boot");
    assert_eq!(
        client
            .post(format!("{url}/audio"))
            .json(&stale)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        client
            .post(format!("{url}/audio"))
            .header("content-type", "application/json")
            .body("{")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let unchanged: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unchanged, state);
    for path in ["health", "state", "presets"] {
        assert!(
            client
                .get(format!("{url}/{path}"))
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
    }
    task.abort();
}

#[tokio::test]
async fn graph_playback_is_explicitly_unavailable_without_a_configured_worker() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/graph-audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["phase"], "unavailable");
    assert_eq!(state["device_owned"], false);
    assert!(state["control"].is_null());
    let response=client.post(format!("{url}/graph-audio")).json(&json!({"session":state["session"],"expected_revision":state["revision"],"action":{"kind":"stop"}})).send().await.unwrap();
    assert_eq!(response.status(), 409);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "Graph worker unavailable"
    );
    let after: Value = client
        .get(format!("{url}/graph-audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after, state);
    task.abort();
}

#[tokio::test]
async fn network_boundary_is_optional_strict_and_redacts_invalid_credentials() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/device/network"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["available"], false);
    for (body, status) in [
        (json!({"type":"status","shell":"reboot"}), 400),
        (
            json!({"type":"join","interface":"../bad","ssid":"Test","password":"do-not-echo-this"}),
            422,
        ),
        (
            json!({"type":"join","interface":"wlan0","ssid":"Test","password":"do-not-echo-this"}),
            503,
        ),
    ] {
        let response = client
            .post(format!("{url}/device/network"))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status);
        assert!(!response.text().await.unwrap().contains("do-not-echo-this"));
    }
    task.abort();
}

#[tokio::test]
async fn monitor_reports_real_availability_without_inventing_audio() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    let response = client.get(format!("{url}/monitor")).send().await.unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let value: Value = response.json().await.unwrap();
    assert!(value["audio"].is_null());
    assert!(value["xruns"].is_null());
    assert_eq!(value["audio_phase"], "unavailable");
    assert_eq!(value["graph_phase"], "unavailable");
    let foreign = client
        .get(format!("{url}/monitor"))
        .header("origin", "https://foreign.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 403);
    task.abort();
}

#[tokio::test]
async fn debug_is_disabled_optional_and_rejects_foreign_origins_and_unknown_fields() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/debug"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["available"], false);
    assert_eq!(state["enabled"], false);
    for command in [
        json!({"type":"run","command":"never-echo-this"}),
        json!({"type":"enable"}),
    ] {
        let response = client
            .post(format!("{url}/debug"))
            .json(&command)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 409);
        assert!(!response.text().await.unwrap().contains("never-echo-this"));
    }
    assert_eq!(
        client
            .post(format!("{url}/debug"))
            .json(&json!({"type":"enable","root":true}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        client
            .post(format!("{url}/debug"))
            .header("origin", "https://foreign.invalid")
            .json(&json!({"type":"enable"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    task.abort();
}

/// Opt-in source-download check; ordinary CI is entirely offline/deterministic.
#[tokio::test]
#[ignore = "requires OXIDAL_ARTWORK_PRESET pointing to an owned preset with public artwork and internet access"]
async fn source_artwork_download_is_persisted_without_changing_audio_or_original() {
    let file =
        std::env::var_os("OXIDAL_ARTWORK_PRESET").expect("Set OXIDAL_ARTWORK_PRESET explicitly");
    let bytes = std::fs::read(file).unwrap();
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let info: Value = client
        .post(format!("{url}/presets"))
        .body(bytes.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = info["sha256"].as_str().unwrap();
    let base = format!("{url}/presets/{id}/artwork");
    let rows: Value = client
        .get(&base)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let item = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["key"].is_string())
        .expect("Preset must supply an image");
    let key = item["key"].as_str().unwrap();
    let response = client.post(format!("{base}/{key}")).send().await.unwrap();
    assert_eq!(response.status(), 204, "{}", response.text().await.unwrap());
    let image = client.get(format!("{base}/{key}")).send().await.unwrap();
    assert_eq!(image.status(), 200);
    assert_eq!(image.headers()["content-type"], "image/png");
    let png = image.bytes().await.unwrap();
    assert!(image::load_from_memory(&png).is_ok());
    let saved: Value = client
        .get(&base)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        saved
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["key"] == key && a["cached"] == true)
    );
    assert_eq!(
        client
            .get(format!("{url}/audio"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        state
    );
    assert_eq!(
        &client
            .get(format!("{url}/presets/{id}/original"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()[..],
        bytes
    );
    task.abort();
    let _ = task.await;
    std::fs::remove_dir_all(path.with_extension("presets")).unwrap();
}

#[tokio::test]
async fn terminal_is_optional_and_rejects_foreign_origin() {
    let (url, task, _) = start(false).await;
    let client = reqwest::Client::new();
    let payload = serde_json::json!({"type":"start","id":"a".repeat(32),"cols":80,"rows":24});
    for mode in ["unprivileged", "admin"] {
        assert_eq!(
            client
                .post(format!("{url}/terminal/{mode}"))
                .json(&payload)
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            client
                .post(format!("{url}/terminal/{mode}"))
                .header("Origin", "https://foreign.invalid")
                .json(&payload)
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::FORBIDDEN
        );
    }
    task.abort();
}

#[tokio::test]
async fn account_api_is_available_without_audio_and_rejects_secret_keys_and_stale_commands() {
    let (url, task, root) = start(false).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/account/tone3000"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["phase"], "disconnected");
    let request = json!({"session":state["session"],"expected_revision":state["revision"],"action":{"kind":"connect","client_id":"t3k_cs_do-not-accept"}});
    let response = client
        .post(format!("{url}/account/tone3000"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 409);
    let body = response.text().await.unwrap();
    assert!(!body.contains("t3k_cs_do-not-accept"));
    let response = client
        .post(format!("{url}/account/tone3000"))
        .json(&json!({"session":"stale","expected_revision":0,"action":{"kind":"disconnect"}}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 409);
    task.abort();
    let _ = std::fs::remove_dir_all(root.with_extension("presets"));
}

#[tokio::test]
async fn portable_library_publishes_verified_revisions_without_changing_audio() {
    let (url, task, path) = start(false).await;
    let c = reqwest::Client::new();
    async fn get(c: &reqwest::Client, url: &str, route: &str) -> Value {
        let r = c.get(format!("{url}/{route}")).send().await.unwrap();
        assert!(r.status().is_success());
        r.json().await.unwrap()
    }
    async fn publish(
        c: &reqwest::Client,
        url: &str,
        m: &Value,
        sources: Value,
    ) -> reqwest::Response {
        c.post(format!("{url}/presets/rigs"))
            .json(&json!({"manifest_json":m.to_string(),"resources":sources}))
            .send()
            .await
            .unwrap()
    }
    let page = get(&c, &url, "presets/rigs").await;
    assert_eq!(page["presets"], json!([]));
    assert!(
        page["native_profile"]
            .as_str()
            .unwrap()
            .starts_with("tone3000-plugin:")
    );
    let before = get(&c, &url, "rig-audio").await;
    let mut m = json!({"format":"oxidal.preset","formatVersion":1,"id":"21915afb-b95b-4b74-a88c-537f06d3594a","name":"New rig","tone3000":{"instances":[]},"oxidal":{"graph":{"nodes":[{"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},{"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],"edges":[{"from":{"node":"in","port":0},"to":{"node":"out","port":0}},{"from":{"node":"in","port":1},"to":{"node":"out","port":1}}]},"lv2":[],"recall":{"tails":"cut"}},"resources":[],"extensions":{"urn:example:annotation":{"value":"retain me"}},"requiredExtensions":[]});
    let r = publish(&c, &url, &m, json!({})).await;
    assert!(
        r.status().is_success(),
        "{}",
        r.text().await.unwrap_or_default()
    );
    let first: Value = r.json().await.unwrap();
    let repeated: Value = publish(&c, &url, &m, json!({})).await.json().await.unwrap();
    assert_eq!(first, repeated);
    let revision = first["revision"].as_str().unwrap();
    assert_eq!(
        get(&c, &url, &format!("presets/rigs/{revision}")).await,
        first
    );
    let bad = m.to_string().replace(
        "\"formatVersion\":1",
        "\"formatVersion\":1,\"formatVersion\":1",
    );
    assert_eq!(
        c.post(format!("{url}/presets/rigs"))
            .json(&json!({"manifest_json":bad,"resources":{}}))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let bytes = include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
    let imported: Value = c
        .post(format!("{url}/presets"))
        .body(bytes.to_vec())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = imported["sha256"].as_str().unwrap();
    // Source browsing is available without starting a native editor or audio worker.
    let sources = get(&c, &url, "presets/rig-sources").await;
    assert_eq!(
        sources,
        json!([{"preset": imported, "source":{"kind":"original","preset":id}}])
    );
    m["tone3000"]["instances"] =
        json!([{"id":"native","preset":"payload","profile":page["native_profile"]}]);
    m["resources"] = json!([{"id":"payload","path":"native/current.t3kpreset","kind":"tone3000-preset","sha256":id,"bytes":bytes.len()}]);
    m["oxidal"]["graph"]["nodes"].as_array_mut().unwrap().push(json!({"id":"tone","kind":"tone3000","audioInputs":2,"audioOutputs":2,"instance":"native","bypassed":false}));
    m["oxidal"]["graph"]["edges"] = json!(
        (0..2)
            .flat_map(|p| vec![
                json!({"from":{"node":"in","port":p},"to":{"node":"tone","port":p}}),
                json!({"from":{"node":"tone","port":p},"to":{"node":"out","port":p}})
            ])
            .collect::<Vec<_>>()
    );
    let binding = json!({"payload":{"kind":"original","preset":id}});
    let mut forged = m.clone();
    forged["resources"][0]["bytes"] = json!(1);
    assert_eq!(
        publish(&c, &url, &forged, binding.clone()).await.status(),
        422
    );
    assert_eq!(publish(&c, &url, &m, json!({})).await.status(), 422);
    let r = publish(&c, &url, &m, binding).await;
    assert!(
        r.status().is_success(),
        "{}",
        r.text().await.unwrap_or_default()
    );
    let native: Value = r.json().await.unwrap();
    let from_native =
        json!({"payload":{"kind":"bundle","revision":native["revision"],"resource":"payload"}});
    m["name"] = json!("Renamed copy");
    let changed: Value = publish(&c, &url, &m, from_native.clone())
        .await
        .json()
        .await
        .unwrap();
    assert_ne!(changed["revision"], native["revision"]);
    assert_eq!(
        changed["manifest"]["extensions"],
        first["manifest"]["extensions"]
    );
    let store = oxidal_presets::BundleStore::new(path.with_extension("presets").join("bundles"));
    let b = store.read(changed["revision"].as_str().unwrap()).unwrap();
    assert_eq!(b.resource("payload").unwrap(), bytes);
    assert!(store.read(native["revision"].as_str().unwrap()).is_ok());
    m["resources"][0]["sha256"] = json!("a".repeat(64));
    assert_eq!(publish(&c, &url, &m, from_native).await.status(), 422);
    assert_eq!(get(&c, &url, "rig-audio").await, before);
    // Working auditions stay addressable but never appear as user-saved presets.
    let mut working = first["manifest"].clone();
    working["extensions"]["urn:oxidal:authoring"] = json!({"draft":true,"labels":{}});
    let draft: Value = publish(&c, &url, &working, json!({}))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(
        get(
            &c,
            &url,
            &format!("presets/rigs/{}", draft["revision"].as_str().unwrap())
        )
        .await,
        draft
    );
    let listed = get(&c, &url, "presets/rigs").await;
    assert!(
        listed["presets"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["revision"] != draft["revision"])
    );
    // Metadata pagination is bounded, independent of immutable payload size.
    let mut empty = first["manifest"].clone();
    for n in 0..20 {
        empty["name"] = json!(format!("Page {n}"));
        assert!(
            publish(&c, &url, &empty, json!({}))
                .await
                .status()
                .is_success()
        );
    }
    let page = get(&c, &url, "presets/rigs").await;
    assert_eq!(page["presets"].as_array().unwrap().len(), 20);
    let next = page["next"].as_str().unwrap();
    let page2 = get(&c, &url, &format!("presets/rigs?after={next}")).await;
    assert_eq!(page2["presets"].as_array().unwrap().len(), 3);
    assert!(page2["next"].is_null());
    task.abort();
    std::fs::remove_dir_all(path.with_extension("presets")).unwrap();
}

#[tokio::test]
async fn unit_levels_are_validated_durable_and_outside_presets() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let endpoint = format!("{url}/levels");
    let get_levels = || async {
        client
            .get(&endpoint)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    };
    assert_eq!(
        get_levels().await,
        json!({"input_trim_db": 0.0, "output_level_db": 0.0, "mono": false})
    );
    for invalid in [
        json!({"input_trim_db": 30.0, "output_level_db": 0.0}),
        json!({"input_trim_db": 0.0, "output_level_db": 13.0}),
    ] {
        let response = client.post(&endpoint).json(&invalid).send().await.unwrap();
        assert_eq!(response.status(), 422);
    }
    let unknown = json!({"input_trim_db": 0.0, "output_level_db": 0.0, "eq": 1});
    let response = client.post(&endpoint).json(&unknown).send().await.unwrap();
    assert_eq!(response.status(), 400);
    let wanted = json!({"input_trim_db": -4.5, "output_level_db": -12.0, "mono": true});
    let response = client.post(&endpoint).json(&wanted).send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(get_levels().await, wanted);
    let root = path.with_extension("presets");
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(root.join("unit-levels.json")).unwrap())
            .unwrap(),
        wanted
    );
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn boosts_are_stored_per_preset_and_scene_and_validated() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let boosts = format!("{url}/boosts");
    let empty: Value = client
        .get(&boosts)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        empty,
        json!({"boosts": {}, "playing": [], "calibrated_db": 0.0, "applied_db": 0.0})
    );
    let set = |key: &str, db: f64| {
        client
            .post(&boosts)
            .json(&json!({"key": key, "boost_db": db}))
            .send()
    };
    let saved: Value = set("scenes:clean-to-heavy#solo", 3.2)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Stored in 0.5 dB steps; nothing plays, so nothing is applied.
    assert_eq!(saved["boosts"], json!({"scenes:clean-to-heavy#solo": 3.0}));
    assert_eq!(saved["applied_db"], 0.0);
    for (key, db) in [("scenes:a", 12.5), ("other:a", 1.0), ("scenes:", 1.0)] {
        assert_eq!(set(key, db).await.unwrap().status(), 422);
    }
    let cleared: Value = set("scenes:clean-to-heavy#solo", 0.0)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cleared["boosts"], json!({}));
    let root = path.with_extension("presets");
    assert!(root.join("boosts.json").is_file());
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn calibration_reports_progress_and_refuses_without_audio_setup() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let endpoint = format!("{url}/calibration");
    let idle: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(idle["target_lufs"], Value::Null);
    assert_eq!(idle["entries"], json!([]));
    assert_eq!(idle["progress"]["running"], false);
    // Nothing has ever played, so there is no audio setup to calibrate with.
    let mut state: Value = client
        .post(&endpoint)
        .json(&json!({"action": "run"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    for _ in 0..50 {
        if state["progress"]["running"] == false {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        state = client
            .get(&endpoint)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    }
    assert_eq!(state["progress"]["running"], false);
    assert!(
        state["progress"]["error"]
            .as_str()
            .unwrap()
            .contains("Settings → Audio")
    );
    let bad = client
        .post(&endpoint)
        .json(&json!({"action": "everything"}))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 400);
    let reset: Value = client
        .post(&endpoint)
        .json(&json!({"action": "reset"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(reset["entries"], json!([]));
    task.abort();
    std::fs::remove_dir_all(path.with_extension("presets")).unwrap();
}

#[tokio::test]
async fn guitar_profiles_set_the_unit_input_trim() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let guitars = format!("{url}/guitars");
    let empty: Value = client
        .get(&guitars)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(empty["guitars"], json!([]));
    let profiles = json!({
        "guitars": [
            {"id": "jiva", "name": "Ibanez Jiva", "peak_dbfs": -8.0},
            {"id": "steinberger", "name": "Steinberger", "trim_db": 6.0,
             "peak_dbfs": -14.0, "noise_dbfs": -70.0, "gate": true}
        ],
        "reference": "jiva",
        "active": "steinberger"
    });
    let response = client.post(&guitars).json(&profiles).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let levels: Value = client
        .get(format!("{url}/levels"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(levels["input_trim_db"], 6.0);
    assert_eq!(levels["gate_db"], -58.0);
    // A view holding older levels changes the master level, not the guitar's.
    let stale = json!({"input_trim_db": 0.0, "output_level_db": -6.0, "mono": false});
    let levels: Value = client
        .post(format!("{url}/levels"))
        .json(&stale)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        levels,
        json!({"input_trim_db": 6.0, "output_level_db": -6.0, "mono": false, "gate_db": -58.0})
    );
    let mut unknown = profiles.clone();
    unknown["active"] = json!("strat");
    let response = client.post(&guitars).json(&unknown).send().await.unwrap();
    assert_eq!(response.status(), 422);
    let root = path.with_extension("presets");
    assert!(root.join("guitars.json").is_file());
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn native_device_defaults_are_durable_validated_and_revision_checked() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let endpoint = format!("{url}/native/defaults");
    let initial: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(initial["settings"]["nam_size"], 0.0);
    let request = json!({"expected_revision":initial["revision"],"settings":{"nam_size":0.75,"multi_core":true,"parameters":{"osFactor":0.5,"inputCalibrationLevel":0.6}}});
    let response = client.post(&endpoint).json(&request).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let saved: Value = response.json().await.unwrap();
    assert_ne!(saved["revision"], initial["revision"]);
    assert_eq!(
        client
            .post(&endpoint)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let mut invalid = request.clone();
    invalid["expected_revision"] = saved["revision"].clone();
    invalid["settings"]["parameters"]["outputLevel"] = json!(0.5);
    assert_eq!(
        client
            .post(&endpoint)
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    assert_eq!(
        client
            .get(&endpoint)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        saved
    );
    let root = path.with_extension("presets");
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(root.join("native-defaults.json")).unwrap())
            .unwrap(),
        saved["settings"]
    );
    task.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn uploaded_nam_descriptions_and_cached_tone_images_need_no_account() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let model = json!({"architecture":"Linear","metadata":{"name":"Independent amp","modeled_by":"Maker","trainer":"TONE3000","model_id":123}});
    let uploaded: Value = client
        .post(format!("{url}/models/local?name=Amp.nam"))
        .body(serde_json::to_vec(&model).unwrap())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(uploaded["nam"]["name"], "Independent amp");
    assert_eq!(uploaded["nam"]["author"], "Maker");
    assert!(uploaded["nam"]["source_tone_id"].is_null());
    assert!(uploaded.get("provider_tone").is_none());
    let images = path.with_extension("presets").join("tone-images");
    std::fs::create_dir_all(&images).unwrap();
    std::fs::write(images.join("42.img"), b"cached-picture").unwrap();
    std::fs::write(images.join("42.type"), "image/png").unwrap();
    let image = client
        .get(format!("{url}/tone3000/tones/42/image"))
        .send()
        .await
        .unwrap();
    assert_eq!(image.status(), 200);
    assert_eq!(image.bytes().await.unwrap().as_ref(), b"cached-picture");
    task.abort();
    let _ = std::fs::remove_dir_all(path.with_extension("presets"));
}

#[tokio::test]
async fn ir_listing_reads_actual_wav_header_without_changing_audio() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let endpoint = format!("{url}/models/local");
    let before: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut wav = b"RIFF".to_vec();
    wav.extend(324u32.to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(48000u32.to_le_bytes());
    wav.extend(144000u32.to_le_bytes());
    wav.extend(3u16.to_le_bytes());
    wav.extend(24u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(288u32.to_le_bytes());
    wav.resize(332, 0);
    assert_eq!(
        client
            .post(&endpoint)
            .query(&[("name", "Cab.wav"), ("folder", "Cabinet/44.1 kHz")])
            .body(wav)
            .send()
            .await
            .unwrap()
            .status(),
        201
    );
    let page: Value = client
        .get(&endpoint)
        .query(&[("format", "ir")])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let audio = &page["data"][0]["audio"];
    assert_eq!(audio["sample_rate"], 48000);
    assert_eq!(audio["bits_per_sample"], 24);
    assert_eq!(audio["channels"], 1);
    assert_eq!(audio["frames"], 96);
    assert_eq!(audio["duration_ms"], 2.0);
    assert_eq!(
        client
            .get(format!("{url}/audio"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        before
    );
    task.abort();
    let _ = std::fs::remove_dir_all(path.with_extension("presets"));
}

#[tokio::test]
async fn local_file_upload_needs_no_provider_account_and_does_not_change_audio() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let endpoint = format!("{url}/models/local");
    let audio: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let bytes = br#"{"architecture":"Linear","weights":[1]}"#;
    let response = client
        .post(&endpoint)
        .query(&[("name", "My local amp.nam")])
        .header("Content-Type", "application/octet-stream")
        .body(bytes.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let uploaded: Value = response.json().await.unwrap();
    let page: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["data"][0], uploaded);
    assert_eq!(uploaded["format"], "nam");
    assert!(uploaded.get("tone_id").is_none());
    let folder: Value = client
        .post(&endpoint)
        .query(&[("name", "Folder amp.nam"), ("folder", "My models/Clean")])
        .body(bytes.to_vec())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(folder["folder"], "My models/Clean");
    for (format, query, count) in [
        ("nam", "LOCAL AMP", 1),
        ("ir", "", 0),
        ("nam", "missing", 0),
    ] {
        let filtered: Value = client
            .get(&endpoint)
            .query(&[("all", "true"), ("format", format), ("query", query)])
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(filtered["data"].as_array().unwrap().len(), count);
    }
    assert_eq!(
        client
            .get(&endpoint)
            .query(&[("format", "wrong")])
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let larger = serde_json::to_vec(
        &json!({"architecture":"Linear","weights":[1],"metadata":{"padding":"x".repeat(128*1024)}}),
    )
    .unwrap();
    assert_eq!(
        client
            .post(&endpoint)
            .query(&[("name", "Large local.nam")])
            .body(larger)
            .send()
            .await
            .unwrap()
            .status(),
        201,
        "binary model upload uses its 32 MiB route budget, not the 64 KiB command budget"
    );
    for (name, data) in [
        ("../escape.nam", bytes.as_slice()),
        ("wrong.txt", bytes.as_slice()),
        ("broken.nam", b"bad".as_slice()),
        ("empty.wav", b"".as_slice()),
    ] {
        assert_eq!(
            client
                .post(&endpoint)
                .query(&[("name", name)])
                .body(data.to_vec())
                .send()
                .await
                .unwrap()
                .status(),
            422
        );
    }
    assert_eq!(
        client
            .get(&endpoint)
            .query(&[("after", "../escape")])
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    assert_eq!(
        client
            .get(format!("{url}/audio"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        audio
    );
    let root = path.with_extension("presets");
    let model_store = oxidal_presets::ModelStore::new(root.join("audition-models"));
    let second = model_store
        .stage_local(
            "Gain 2.nam",
            br#"{"architecture":"Linear","weights":[0.5]}"#,
        )
        .unwrap();
    let result = client
        .post(format!("{endpoint}/collection"))
        .json(&json!({"assets":[uploaded["id"],second.0]}))
        .send()
        .await
        .unwrap();
    assert_eq!(result.status(), 201);
    let collection: Value = result.json().await.unwrap();
    let (_, files) = model_store
        .preparation(collection["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(
        client
            .post(format!("{endpoint}/collection"))
            .json(&json!({"assets":["../bad"]}))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    assert_eq!(
        client
            .get(format!("{url}/audio"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        audio
    );
    let (asset, file) = model_store.read(uploaded["id"].as_str().unwrap()).unwrap();
    assert_eq!(asset.tone_id, 0);
    assert_eq!(asset.tone["local"], true);
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn native_log_export_is_bounded_read_only_and_does_not_follow_symlinks() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let root = path.with_extension("presets");
    let empty = client
        .get(format!("{url}/debug/logs"))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), 200);
    assert!(
        empty
            .text()
            .await
            .unwrap()
            .contains("No native engine logs")
    );
    for (folder, tail) in [
        ("native-runtime", "recent editor event"),
        ("audio-runtime", "recent playback event"),
    ] {
        let folder = root.join(folder).join("user/.config/TONE3000");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("TONE3000.log"),
            format!("{}\n{tail}", "x".repeat(150000)),
        )
        .unwrap();
    }
    #[cfg(unix)]
    {
        let folder = root.join("rig-runtime/playback/user/.config/TONE3000");
        std::fs::create_dir_all(&folder).unwrap();
        let private = root.join("must-not-export.txt");
        std::fs::write(&private, "not an allowed native log").unwrap();
        std::os::unix::fs::symlink(&private, folder.join("TONE3000.log")).unwrap();
    }
    let response = client
        .get(format!("{url}/debug/logs?path=/etc/passwd"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(
        response.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/plain")
    );
    let text = response.text().await.unwrap();
    assert!(text.len() < 200000);
    assert!(text.contains("TONE3000 source pin:"));
    assert!(text.contains("recent editor event") && text.contains("recent playback event"));
    assert!(!text.contains("not an allowed native log"));
    let audio: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(audio["phase"], "unavailable");
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn owned_download_preserves_bytes_and_can_be_reimported() {
    let (url, task, path) = start(true).await;
    let store = oxidal_presets::OwnedStore::new(path.with_extension("presets").join("owned"));
    let saved = store.save_created(CURRENT_PRESET).unwrap();
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{url}/presets/owned/{}/download", saved.id))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(
        response.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment; filename=\"saved-")
    );
    let bytes = response.bytes().await.unwrap();
    assert_eq!(bytes.as_ref(), CURRENT_PRESET);
    let restored = client
        .post(format!("{url}/presets"))
        .header("content-type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .unwrap();
    assert_eq!(restored.status(), 201);
    let info: Value = restored.json().await.unwrap();
    assert_eq!(info["sha256"], saved.id);
    assert_eq!(
        client
            .get(format!("{url}/presets/owned/invalid/download"))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    std::fs::write(
        path.with_extension("presets")
            .join("owned")
            .join(&saved.id)
            .join("metadata.json"),
        b"{}",
    )
    .unwrap();
    assert_eq!(
        client
            .get(format!("{url}/presets/owned/{}/download", saved.id))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    task.abort();
    let _ = std::fs::remove_dir_all(path.with_extension("presets"));
}

#[tokio::test]
async fn monitoring_history_records_without_a_browser_and_exports_validated_samples() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let history = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let response = client
                .get(format!("{url}/monitor/history"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let body: Value = response.json().await.unwrap();
            if !body["records"].as_array().unwrap().is_empty() {
                break body;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(history["interval_seconds"], 5);
    assert_eq!(history["storage_limit_bytes"], 8 * 1024 * 1024);
    assert!(history["records"][0]["recorded_at_ms"].as_u64().unwrap() > 0);
    assert!(history["records"][0]["readings"]["error"].is_null());
    let download = client
        .get(format!("{url}/monitor/history/export"))
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), 200);
    assert!(
        download.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .contains("monitor-history.json")
    );
    let body: Value = download.json().await.unwrap();
    assert_eq!(body["records"][0], history["records"][0]);
    task.abort();
    drop(client);
    let _ = std::fs::remove_dir_all(path.with_extension("presets"));
}

#[tokio::test]
async fn control_audit_records_outcomes_without_request_secrets() {
    let (url, task, path) = start(true).await;
    let client = reqwest::Client::new();
    let state: Value = client
        .get(format!("{url}/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let action = json!({"protocol":1,"request_id":"audit","session":state["session"],"expected_revision":0,"action":{"type":"midi","input":{"device":"simulator","channel":1,"cc":21,"value":127}}});
    assert!(
        client
            .post(format!("{url}/commands"))
            .json(&action)
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    client
        .post(format!("{url}/device/network?password=PRIVATE_QUERY"))
        .json(&json!({"password":"PRIVATE_BODY","ssid":"PRIVATE_NETWORK"}))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{url}/audio"))
        .header("Origin", "https://untrusted.invalid")
        .body("PRIVATE_ORIGIN")
        .send()
        .await
        .unwrap();
    let mut history = json!(null);
    for _ in 0..100 {
        history = client
            .get(format!("{url}/audit"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if history["records"].as_array().unwrap().len() == 3 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let records = history["records"].as_array().unwrap();
    assert_eq!(records.len(), 3, "{history}");
    assert_eq!(records[0]["outcome"], "rejected");
    assert_eq!(records[0]["http_status"], 403);
    assert_eq!(records[1]["operation"], "network");
    assert_eq!(records[2]["outcome"], "accepted");
    let response = client
        .get(format!("{url}/audit/export"))
        .send()
        .await
        .unwrap();
    assert!(
        response.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .contains("control-audit.json")
    );
    let exported = response.text().await.unwrap();
    assert!(!exported.contains("PRIVATE"));
    assert!(!exported.contains("password"));
    assert!(!exported.contains("request_id"));
    assert_eq!(serde_json::from_str::<Value>(&exported).unwrap(), history);
    task.abort();
    let _ = std::fs::remove_dir_all(path.with_extension("presets"));
}

#[tokio::test]
async fn model_artwork_is_source_bound_and_metadata_only() {
    use oxidal_presets::{ModelAsset, ModelStore};
    use sha2::{Digest, Sha256};
    let (url, task, path) = start(false).await;
    let root = path.with_extension("presets");
    let store = ModelStore::new(root.join("audition-models"));
    let bytes = b"inert-test-model";
    let asset = ModelAsset {
        schema: 1,
        tone_id: 10,
        model_id: 20,
        title: "Replacement cab".into(),
        name: "Cab".into(),
        format: "nam".into(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        tone: json!({"id":10,"gear":"cab","images":["https://example.com/cab.png"]}),
    };
    let id = store.stage(&asset, bytes).unwrap();
    // Artwork need not read large inference weights, and is not a playback admission.
    std::fs::remove_file(root.join("audition-models").join(&id).join("model.nam")).unwrap();
    assert!(store.read(&id).is_err());
    let client = reqwest::Client::new();
    let base = format!("{url}/models/{id}/artwork");
    let response = client.get(&base).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let rows: Value = response.json().await.unwrap();
    assert_eq!(rows[0]["title"], "Replacement cab");
    assert_eq!(rows[0]["gear"], "cab");
    assert_eq!(rows[0]["cached"], false);
    assert!(!rows.to_string().contains("example.com"));
    let image_key = rows[0]["key"].as_str().unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let png = png.into_inner();
    let mut cache = Sha256::digest(&png).to_vec();
    cache.extend_from_slice(&png);
    std::fs::create_dir_all(root.join("artwork")).unwrap();
    std::fs::write(
        root.join("artwork").join(format!("{image_key}.cache")),
        cache,
    )
    .unwrap();
    let image = client
        .get(format!("{base}/{image_key}"))
        .send()
        .await
        .unwrap();
    assert_eq!(image.status(), 200);
    assert_eq!(image.bytes().await.unwrap().as_ref(), png);
    // Already cached artwork is usable without an internet request.
    assert_eq!(
        client
            .post(format!("{base}/{image_key}"))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    let wrong = "f".repeat(64);
    assert_eq!(
        client
            .post(format!("{base}/{wrong}"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        client
            .get(format!("{base}/{wrong}"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    std::fs::write(
        root.join("audition-models").join(&id).join("metadata.json"),
        b"{}",
    )
    .unwrap();
    assert_eq!(client.get(&base).send().await.unwrap().status(), 404);
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn permanent_removal_rechecks_preview_and_preserves_shared_models_and_other_entries() {
    use oxidal_presets::{ModelAsset, ModelStore};
    use sha2::{Digest, Sha256};
    let (url, task, path) = start(false).await;
    let root = path.with_extension("presets");
    let client = reqwest::Client::new();
    let mut ids = Vec::new();
    for bytes in [CURRENT_PRESET, LEGACY_PRESET] {
        let response = client
            .post(format!("{url}/presets"))
            .body(bytes.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let body: Value = response.json().await.unwrap();
        ids.push(body["sha256"].as_str().unwrap().to_owned());
    }
    let payload = [0, 1, 127, 128, 255];
    let model = ModelStore::new(root.join("audition-models"))
        .stage(
            &ModelAsset {
                schema: 1,
                tone_id: 1,
                model_id: 1,
                title: "Shared fixture".into(),
                name: "Shared fixture".into(),
                format: "nam".into(),
                sha256: format!("{:x}", Sha256::digest(payload)),
                tone: json!({"id":1}),
            },
            &payload,
        )
        .unwrap();
    let preview_url = format!("{url}/presets/removal?kind=original&id={}", ids[0]);
    let preview: Value = client
        .get(&preview_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(preview["models"].as_array().unwrap().len(), 1);
    assert_eq!(
        preview["models"][0]["protected_by"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let request = json!({"entry_kind":"original","id":ids[0],"expected_preview":preview["token"],"delete_models":true});
    assert_eq!(
        client
            .post(format!("{url}/presets/removal"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let mut request = request;
    request["delete_models"] = false.into();
    // Any intervening catalog mutation requires a new confirmation.
    let catalog: Value = client
        .get(format!("{url}/presets/catalog"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(client.post(format!("{url}/presets/catalog")).json(&json!({"expected_revision":catalog["revision"],"entry_kind":"original","id":ids[0],"action":{"kind":"rename","name":"Renamed fixture"}})).send().await.unwrap().status(),200);
    assert_eq!(
        client
            .post(format!("{url}/presets/removal"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert!(root.join(format!("{}.t3kpreset", ids[0])).exists());
    let preview: Value = client
        .get(&preview_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    request["expected_preview"] = preview["token"].clone();
    let deleted = client
        .post(format!("{url}/presets/removal"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), 200);
    let deleted: Value = deleted.json().await.unwrap();
    assert_eq!(deleted["model_files_deleted"], 0);
    assert_eq!(deleted["cleanup_pending"], false);
    assert!(!root.join(format!("{}.t3kpreset", ids[0])).exists());
    assert_eq!(
        std::fs::read(root.join(format!("{}.t3kpreset", ids[1]))).unwrap(),
        LEGACY_PRESET
    );
    assert!(root.join("audition-models").join(model).exists());
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn permanent_removal_clears_stopped_resume_and_boot_without_recreating_recovery_on_shutdown()
{
    let root = std::env::temp_dir().join(format!(
        "oxidal-delete-resume-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let id = oxidal_presets::Store::new(root.clone())
        .import(CURRENT_PRESET)
        .unwrap()
        .sha256;
    let input = json!({"endpoint":"hw:CARD=Test,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
    let mut output = input.clone();
    output["direction"] = "playback".into();
    let settings = json!({"preset_id":id,"owned":false,"draft":false,"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]}});
    let recovery = json!({"schema":1,"settings":settings,"controls":null,"models":[],"eq":null});
    std::fs::write(
        root.join("last-audio-session.json"),
        serde_json::to_vec(&recovery).unwrap(),
    )
    .unwrap();
    std::fs::write(root.join("boot-audio.json"),serde_json::to_vec(&json!({"schema":2,"choice":{"kind":"native","settings":settings,"controls":null,"models":[],"eq":null}})).unwrap()).unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = oxidal_api::router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: Some(signal),
        simulator: false,
        mapping_path: root.join("mapping.json"),
        preset_dir: root.clone(),
        ui_dir: root.join("ui"),
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    let before: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(before["configured"]["preset_id"], id);
    assert_eq!(before["start_on_boot"], true);
    let preview: Value = client
        .get(format!("{url}/presets/removal?kind=original&id={id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(preview["blocked"], Value::Null);
    assert_eq!(preview["remembered_files"], 2);
    let result = client.post(format!("{url}/presets/removal")).json(&json!({"entry_kind":"original","id":id,"expected_preview":preview["token"],"delete_models":false})).send().await.unwrap();
    assert_eq!(result.status(), 200);
    let result: Value = result.json().await.unwrap();
    assert_eq!(result["cleanup_pending"], false);
    let after: Value = client
        .get(format!("{url}/audio"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after["configured"], Value::Null);
    assert_eq!(after["start_on_boot"], false);
    shutdown.send_replace(true);
    tokio::time::timeout(std::time::Duration::from_secs(3), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(!root.join("last-audio-session.json").exists());
    assert!(!root.join("boot-audio.json").exists());
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn set_list_moves_across_native_kinds_appends_new_files_and_keeps_payloads_unchanged() {
    let (url, task, path) = start(false).await;
    let root = path.with_extension("presets");
    let client = reqwest::Client::new();
    let imported: Value = client
        .post(format!("{url}/presets"))
        .body(LEGACY_PRESET.to_vec())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let owned = oxidal_presets::OwnedStore::new(root.join("owned"))
        .save_created(CURRENT_PRESET)
        .unwrap();
    let endpoint = format!("{url}/presets/catalog");
    let catalog: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(catalog["items"][0]["kind"], "owned");
    let moved=client.post(&endpoint).json(&json!({"expected_revision":catalog["revision"],"entry_kind":"original","id":imported["sha256"],"action":{"kind":"place","before":{"kind":"owned","id":owned.id}}})).send().await.unwrap();
    assert_eq!(moved.status(), 200);
    let moved: Value = moved.json().await.unwrap();
    assert_eq!(moved["items"][0]["kind"], "original");
    let mut bytes = LEGACY_PRESET.to_vec();
    let index = bytes.windows(7).position(|w| w == b"Fixture").unwrap();
    bytes[index..index + 7].copy_from_slice(b"AAA new");
    let added: Value = client
        .post(format!("{url}/presets"))
        .body(bytes.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let after: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        after["items"].as_array().unwrap().last().unwrap()["id"],
        added["sha256"]
    );
    let hidden:Value=client.post(&endpoint).json(&json!({"expected_revision":after["revision"],"entry_kind":"original","id":imported["sha256"],"action":{"kind":"visibility","archived":true}})).send().await.unwrap().json().await.unwrap();
    assert_eq!(hidden["items"][0]["archived"], true);
    let restored:Value=client.post(&endpoint).json(&json!({"expected_revision":hidden["revision"],"entry_kind":"original","id":imported["sha256"],"action":{"kind":"visibility","archived":false}})).send().await.unwrap().json().await.unwrap();
    assert_eq!(restored["items"][0]["id"], imported["sha256"]);
    assert_eq!(
        std::fs::read(root.join(format!(
            "{}.t3kpreset",
            imported["sha256"].as_str().unwrap()
        )))
        .unwrap(),
        LEGACY_PRESET
    );
    assert_eq!(
        oxidal_presets::OwnedStore::new(root.join("owned"))
            .read(&owned.id)
            .unwrap()
            .1,
        CURRENT_PRESET
    );
    let file: Value =
        serde_json::from_slice(&std::fs::read(root.join("library.json")).unwrap()).unwrap();
    assert_eq!(file["order"].as_array().unwrap().len(), 3);
    assert_eq!(
        file["order"][0],
        format!("original:{}", imported["sha256"].as_str().unwrap())
    );
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn details_are_revision_bound_plain_metadata_and_invalidate_deletion_preview() {
    let (url, task, path) = start(false).await;
    let client = reqwest::Client::new();
    let bytes = include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
    let imported: Value = client
        .post(format!("{url}/presets"))
        .body(bytes.to_vec())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = imported["sha256"].as_str().unwrap();
    let endpoint = format!("{url}/presets/details");
    let initial: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let preview: Value = client
        .get(format!("{url}/presets/removal?kind=original&id={id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let edit = json!({"expected_revision":initial["revision"],"entry_kind":"original","id":id,"description":"Warm clean\nUse the neck pickup.","categories":[" Clean ","clean","Ambient"]});
    let saved = client.post(&endpoint).json(&edit).send().await.unwrap();
    assert!(saved.status().is_success());
    let saved: Value = saved.json().await.unwrap();
    assert_eq!(
        saved["entries"][0]["details"]["categories"],
        json!(["Clean", "Ambient"])
    );
    assert_eq!(
        client
            .post(&endpoint)
            .json(&edit)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let stale_delete = client.post(format!("{url}/presets/removal")).json(&json!({"entry_kind":"original","id":id,"expected_preview":preview["token"],"delete_models":false})).send().await.unwrap();
    assert_eq!(stale_delete.status(), 409);
    let root = path.with_extension("presets");
    assert_eq!(
        std::fs::read(root.join(format!("{id}.t3kpreset"))).unwrap(),
        bytes
    );
    let invalid = client.post(&endpoint).json(&json!({"expected_revision":saved["revision"],"entry_kind":"owned","id":"f".repeat(64),"description":"orphan","categories":[]})).send().await.unwrap();
    assert_eq!(invalid.status(), 422);
    let preview: Value = client
        .get(format!("{url}/presets/removal?kind=original&id={id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(client.post(format!("{url}/presets/removal")).json(&json!({"entry_kind":"original","id":id,"expected_preview":preview["token"],"delete_models":false})).send().await.unwrap().status().is_success());
    let remaining: Value = client
        .get(&endpoint)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(remaining["entries"], json!([]));
    task.abort();
    let _ = std::fs::remove_dir_all(root);
    let _ = std::fs::remove_file(path);
}
