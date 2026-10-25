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
        shutdown: None,
        simulator,
        mapping_path: path.clone(),
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
        shutdown: None,
        simulator: false,
        mapping_path: path.clone(),
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
            shutdown: None,
            simulator: false,
            mapping_path: path.clone(),
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
