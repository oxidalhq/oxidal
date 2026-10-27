//! Maintained native:check path: actual mixed HTTP/worker/null-ALSA lifecycle.
use oxidal_api::{Config, router_with_shutdown};
use oxidal_presets::BundleStore;
use reqwest::Client;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
async fn get(c: &Client, url: &str, path: &str) -> Value {
    let r = c.get(format!("{url}/{path}")).send().await.unwrap();
    assert!(r.status().is_success());
    r.json().await.unwrap()
}
async fn post(c: &Client, url: &str, state: &Value, action: Value) -> reqwest::Response {
    c.post(format!("{url}/rig-audio")).json(&json!({"session":state["session"],"expected_revision":state["revision"],"action":action})).send().await.unwrap()
}
async fn apply(c: &Client, url: &str, action: Value) -> Value {
    for _ in 0..4 {
        let s = get(c, url, "rig-audio").await;
        let r = post(c, url, &s, action.clone()).await;
        let status = r.status();
        let body: Value = r.json().await.unwrap();
        if body["error"]
            .as_str()
            .is_some_and(|e| e.starts_with("rig_audio_state_conflict"))
        {
            continue;
        }
        assert!(status.is_success(), "{status}: {body}");
        if matches!(action["kind"].as_str(), Some("start" | "restart")) {
            assert_eq!(body["phase"], "starting");
            return phase(c, url, "running").await;
        }
        return body;
    }
    panic!("revision changed repeatedly");
}
async fn phase(c: &Client, url: &str, target: &str) -> Value {
    for _ in 0..200 {
        let s = get(c, url, "rig-audio").await;
        if s["phase"] == target {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("phase not reached {target}");
}
fn stream() -> Value {
    let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
    let mut output = input.clone();
    output["direction"] = json!("playback");
    json!({"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]})
}
fn set(s: &Value, target: Value, value: f64) -> Value {
    json!({"kind":"control","command":{"session":s["control"]["session"],"expected_revision":s["control"]["revision"],"target":target,"value":value}})
}
fn control(s: &Value, target: &Value) -> f64 {
    s["control"]["controls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| &v["target"] == target)
        .unwrap()["value"]
        .as_f64()
        .unwrap()
}
fn pids(executable: &Path) -> Vec<u32> {
    let expected = executable.canonicalize().unwrap();
    let mut ids = vec![];
    for task in std::fs::read_dir(format!("/proc/{}/task", std::process::id()))
        .unwrap()
        .flatten()
    {
        for id in std::fs::read_to_string(task.path().join("children"))
            .unwrap_or_default()
            .split_whitespace()
        {
            if std::fs::read_link(format!("/proc/{id}/exe")).is_ok_and(|p| p == expected) {
                ids.push(id.parse().unwrap());
            }
        }
    }
    ids
}
#[tokio::test]
#[ignore = "pnpm native:check supplies the actual Linux mixed worker and embedded fixture"]
async fn mixed_worker_http_controls_export_restart_exclusion_and_recovery() {
    let executable = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    assert_eq!(std::env::var("OXIDAL_RIG_QUALIFY_NULL").unwrap(), "1");
    let source = BundleStore::new(std::env::var_os("OXIDAL_TEST_BUNDLE_ROOT").unwrap().into());
    let revision =
        std::fs::read_to_string(std::env::var_os("OXIDAL_TEST_RIG_REVISION_FILE").unwrap())
            .unwrap();
    let bundle = source.read(revision.trim()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-rig-http-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let store = BundleStore::new(root.join("presets/bundles"));
    let revision = bundle.revision().to_owned();
    let settings = json!({"revision":revision,"stream":stream(),"recall":null});
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: Some(executable.clone()),
        graph_worker: Some(executable.clone()),
        rig_worker: Some(executable.clone()),
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let c = Client::builder()
        .timeout(Duration::from_secs(70))
        .build()
        .unwrap();
    // Enter through the public authoring boundary, not by installing an already
    // assembled fixture behind the daemon. Every payload is a verified import.
    let mut bindings = serde_json::Map::new();
    for resource in &bundle.manifest().resources {
        let response = c
            .post(format!("{url}/presets"))
            .body(bundle.resource(&resource.id).unwrap().to_vec())
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let imported: Value = response.json().await.unwrap();
        bindings.insert(
            resource.id.clone(),
            json!({"kind":"original","preset":imported["sha256"]}),
        );
    }
    let response=c.post(format!("{url}/presets/rigs")).json(&json!({"manifest_json":std::str::from_utf8(bundle.manifest_bytes()).unwrap(),"resources":bindings})).send().await.unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().await.unwrap_or_default()
    );
    let published: Value = response.json().await.unwrap();
    assert_eq!(published["revision"], revision);
    assert_eq!(store.read(&revision).unwrap().manifest(), bundle.manifest());
    let initial = get(&c, &url, "state").await;
    // Leave a failed inactive legacy worker behind. It must not poison live
    // mixed monitoring after its process has been reaped and released the device.
    let legacy = get(&c, &url, "graph-audio").await;
    let bare = json!({"stream":stream(),"rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},"bindings":[],"recall":null});
    let rejected=c.post(format!("{url}/graph-audio")).json(&json!({"session":legacy["session"],"expected_revision":legacy["revision"],"action":{"kind":"start","settings":bare}})).send().await.unwrap();
    assert_eq!(rejected.status(), 409);
    assert_eq!(get(&c, &url, "graph-audio").await["phase"], "failed");

    let mut s = get(&c, &url, "rig-audio").await;
    assert_eq!(s["phase"], "stopped");
    let mut bad = settings.clone();
    bad["revision"] = json!("../other");
    assert_eq!(
        post(&c, &url, &s, json!({"kind":"start","settings":bad}))
            .await
            .status(),
        409
    );
    bad["revision"] = json!("a".repeat(64));
    assert_eq!(
        post(&c, &url, &s, json!({"kind":"start","settings":bad}))
            .await
            .status(),
        200
    );
    s = phase(&c, &url, "failed").await;
    assert_eq!(s["device_owned"], false);
    s = apply(&c, &url, json!({"kind":"start","settings":settings})).await;
    assert_eq!(s["device_owned"], true);
    assert_eq!(
        c.post(format!("{url}/audio/probe"))
            .json(&stream()["input"])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    // Competing playback owners must reject before spawning their configured executable.
    let g = get(&c, &url, "graph-audio").await;
    let competing = json!({"stream":stream(),"rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},"bindings":[],"recall":null});
    let r=c.post(format!("{url}/graph-audio")).json(&json!({"session":g["session"],"expected_revision":g["revision"],"action":{"kind":"start","settings":competing}})).send().await.unwrap();
    assert_eq!(r.status(), 409);
    assert_eq!(pids(&executable).len(), 1);
    let gain = json!({"kind":"lv2","node":"fx_l","symbol":"gain"});
    let native = json!({"kind":"native","node":"tone","parameter":"outputLevel"});
    let stale = set(&s, gain.clone(), -1.0);
    s = apply(&c, &url, set(&s, gain.clone(), -3.0)).await;
    assert_eq!(control(&s, &gain), -3.0);
    assert_eq!(post(&c, &url, &s, stale).await.status(), 409);
    assert_eq!(get(&c, &url, "rig-audio").await["control"], s["control"]);
    assert_eq!(
        post(&c, &url, &s, set(&s, gain.clone(), 9999.0))
            .await
            .status(),
        409
    );
    s = apply(&c, &url, set(&s, native.clone(), 0.6)).await;
    let saving = apply(
        &c,
        &url,
        json!({"kind":"save","name":"HTTP mixed snapshot"}),
    )
    .await;
    assert_eq!(saving["save"]["running"], true);
    assert_eq!(
        saving["save"]["source_control_revision"],
        s["control"]["revision"]
    );
    // Save owns a captured revision, while subsequent live controls remain usable.
    s = apply(&c, &url, set(&s, gain.clone(), -9.0)).await;
    let mut saved = None;
    for _ in 0..300 {
        let v = get(&c, &url, "rig-audio").await;
        if v["save"]["running"] == false {
            assert!(v["save"]["error"].is_null(), "{}", v["save"]);
            saved = Some(v["save"]["saved_revision"].as_str().unwrap().to_owned());
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let saved = saved.expect("save did not finish");
    // Asynchronous export completion must not invalidate the last audio readback.
    assert_eq!(get(&c, &url, "rig-audio").await["revision"], s["revision"]);
    assert_ne!(saved, revision);
    assert_eq!(control(&get(&c, &url, "rig-audio").await, &gain), -9.0);
    let before_frames = s["processed_frames"].as_u64().unwrap();
    let s = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(control(&s, &gain), -9.0);
    assert!((control(&s, &native) - 0.6).abs() < 1e-5);
    let mut monitored = false;
    for _ in 0..100 {
        let m = get(&c, &url, "monitor").await;
        if m["source"] == "Mixed rig" {
            assert_eq!(m["rig_phase"], "running");
            assert!(m["error"].is_null());
            assert!(m["audio"]["frames"].as_u64().unwrap() > 0);
            monitored = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(monitored);
    assert!(before_frames > 0);
    apply(&c, &url, json!({"kind":"stop"})).await;
    assert_ne!(
        c.post(format!("{url}/audio/probe"))
            .json(&stream()["input"])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let s = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{"revision":saved,"stream":stream(),"recall":null}}),
    )
    .await;
    assert_eq!(control(&s, &gain), -3.0);
    assert!((control(&s, &native) - 0.6).abs() < 1e-5);
    assert_eq!(get(&c, &url, "state").await, initial);
    // Kill only our own direct playback child; confirm reaping and restart recovery.
    let children = pids(&executable);
    assert_eq!(children.len(), 1);
    assert!(
        std::process::Command::new("kill")
            .args(["-KILL", &children[0].to_string()])
            .status()
            .unwrap()
            .success()
    );
    let failed = phase(&c, &url, "failed").await;
    assert_eq!(failed["device_owned"], false);
    apply(&c, &url, json!({"kind":"restart"})).await;
    // A disconnected HTTP client does not own or cancel an accepted restart.
    apply(&c, &url, json!({"kind":"stop"})).await;
    let stopped_state = get(&c, &url, "rig-audio").await;
    let body=serde_json::to_vec(&json!({"session":stopped_state["session"],"expected_revision":stopped_state["revision"],"action":{"kind":"restart"}})).unwrap();
    let address = url
        .strip_prefix("http://")
        .unwrap()
        .strip_suffix("/api/v1")
        .unwrap();
    let mut connection = tokio::net::TcpStream::connect(address).await.unwrap();
    use tokio::io::AsyncWriteExt;
    connection.write_all(format!("POST /api/v1/rig-audio HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",body.len()).as_bytes()).await.unwrap();
    connection.write_all(&body).await.unwrap();
    for _ in 0..100 {
        let s = get(&c, &url, "rig-audio").await;
        if s["phase"] == "starting" || s["phase"] == "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    drop(connection);
    phase(&c, &url, "running").await;
    apply(
        &c,
        &url,
        json!({"kind":"save","name":"Shutdown during export"}),
    )
    .await;
    let children = pids(&executable);
    assert!(!children.is_empty());
    shutdown.send_replace(true);
    tokio::time::timeout(Duration::from_secs(8), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    for id in children {
        assert!(!Path::new(&format!("/proc/{id}")).exists());
    }
    assert_ne!(
        c.post(format!("{url}/audio/probe"))
            .json(&stream()["input"])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}
