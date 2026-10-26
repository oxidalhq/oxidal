use oxidal_api::{Config, router};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
async fn start(simulator: bool) -> (String, tokio::task::JoinHandle<()>, PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "oxidal-test-{}-{}.json",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let app = router(Config {
        device_socket: None,
        graph_worker: None,
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
        device_socket: None,
        graph_worker: None,
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
            device_socket: None,
            graph_worker: None,
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
    assert_eq!(library, after_library);
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
