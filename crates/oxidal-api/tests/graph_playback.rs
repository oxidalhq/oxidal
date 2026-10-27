//! Repeatable HTTP -> isolated LV2 worker -> ALSA-null integration. No hardware required.
use oxidal_api::{Config, router_with_shutdown};
use reqwest::Client;
use serde_json::{Value, json};
use std::time::Duration;

async fn get(c: &Client, url: &str, path: &str) -> Value {
    let r = c.get(format!("{url}/{path}")).send().await.unwrap();
    assert!(r.status().is_success());
    r.json().await.unwrap()
}
async fn send(c: &Client, url: &str, state: &Value, action: Value) -> reqwest::Response {
    c.post(format!("{url}/graph-audio")).json(&json!({"session":state["session"],"expected_revision":state["revision"],"action":action})).send().await.unwrap()
}
async fn apply(c: &Client, url: &str, state: &mut Value, action: Value) -> Value {
    let r = send(c, url, state, action).await;
    let status = r.status();
    let body: Value = r.json().await.unwrap();
    assert!(status.is_success(), "{status}: {body}");
    *state = body.clone();
    body
}
fn control(s: &Value, action: Value) -> Value {
    json!({"kind":"control","command":{"session":s["control"]["session"],"protocol":1,"request_id":"test","expected_revision":s["control"]["revision"],"action":action}})
}
async fn wait(c: &Client, url: &str, phase: &str) -> Value {
    for _ in 0..150 {
        let s = get(c, url, "graph-audio").await;
        if s["phase"] == phase {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    panic!("graph never reached {phase}");
}
fn settings() -> Value {
    let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
    let mut output = input.clone();
    output["direction"] = json!("playback");
    json!({"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},"rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"amp","kind":"lv2","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"amp"},{"from":"amp","to":"out"}]},"bindings":[{"node":"amp","uri":"http://plugin.org.uk/swh-plugins/amp"}]})
}
#[tokio::test]
#[ignore = "pnpm lv2:check runs this with the actual Linux graph worker and ALSA null"]
async fn graph_worker_controls_crash_recovery_and_shutdown_keep_daemon_alive() {
    let executable =
        std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_GRAPH_WORKER").unwrap());
    assert_eq!(std::env::var("OXIDAL_GRAPH_QUALIFY_NULL").unwrap(), "1");
    let root = std::env::temp_dir().join(format!("oxidal-graph-http-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let config = Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: Some(executable.clone()),
        rig_worker: None,
        audio_worker: Some(executable.clone()),
        native_worker: None,
        simulator: true,
        mapping_path: root.join("mappings.json"),
        preset_dir: root.join("presets"),
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    };
    let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let c = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap();
    for path in ["plugins/lv2", "plugins/lv2?sample_rate=48000&path=/tmp"] {
        assert_eq!(
            c.get(format!("{url}/{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    assert_eq!(
        c.get(format!("{url}/plugins/lv2?sample_rate=1"))
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let catalog = get(&c, &url, "plugins/lv2?sample_rate=48000").await;
    assert_eq!(catalog["sample_rate"], 48000);
    let plugins = catalog["plugins"].as_array().unwrap();
    let amp = plugins
        .iter()
        .find(|p| p["uri"] == "http://plugin.org.uk/swh-plugins/amp")
        .unwrap();
    assert_eq!(amp["name"], "Simple amplifier");
    assert!(amp["unsupported"].is_null());
    assert_eq!(amp["ports"][0]["symbol"], "gain");
    assert_eq!(amp["ports"][0]["minimum"], -70.0);
    let gverb = plugins
        .iter()
        .find(|p| p["uri"] == "http://plugin.org.uk/swh-plugins/gverb")
        .unwrap();
    assert!(gverb["unsupported"].is_string());
    let original = get(&c, &url, "state").await;
    let mut s = get(&c, &url, "graph-audio").await;
    assert_eq!(s["phase"], "stopped");
    assert_eq!(
        send(&c, &url, &s, json!({"kind":"set_boot","enabled":true}))
            .await
            .status(),
        409
    );
    let mut missing = settings();
    missing["bindings"][0]["uri"] = json!("urn:oxidal:missing");
    assert_eq!(
        send(&c, &url, &s, json!({"kind":"start","settings":missing}))
            .await
            .status(),
        409
    );
    s = wait(&c, &url, "failed").await;
    assert_eq!(s["device_owned"], false);
    // Cancellation of an HTTP request cannot discard an already accepted device operation.
    let cc = c.clone();
    let target = url.clone();
    let state = s.clone();
    let pending = tokio::spawn(async move {
        send(
            &cc,
            &target,
            &state,
            json!({"kind":"start","settings":settings()}),
        )
        .await
    });
    for _ in 0..100 {
        s = get(&c, &url, "graph-audio").await;
        if s["phase"] == "starting" || s["phase"] == "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(s["phase"] == "starting" || s["phase"] == "running");
    pending.abort();
    s = wait(&c, &url, "running").await;
    assert_eq!(s["device_owned"], true);
    assert!(s["processed_frames"].as_u64().unwrap() > 0);
    assert!(s["telemetry"]["frames"].as_u64().unwrap() > 0);
    assert!(s["telemetry"]["deadline_us"].as_f64().unwrap() > 0.0);
    // A fresh scan (also used after apt installation) does not take the device,
    // stop playback, change controls or open any plugin instance.
    let rescanned = get(&c, &url, "plugins/lv2?sample_rate=96000").await;
    assert_eq!(rescanned["sample_rate"], 96000);
    let after_scan = get(&c, &url, "graph-audio").await;
    assert_eq!(after_scan["phase"], "running");
    assert_eq!(after_scan["control"], s["control"]);
    assert!(
        after_scan["processed_frames"].as_u64().unwrap() >= s["processed_frames"].as_u64().unwrap()
    );
    let session = s["control"]["session"].clone();
    let action = control(&s, json!({"type":"set","target":"amp.gain","value":0.25}));
    apply(&c, &url, &mut s, action.clone()).await;
    assert_eq!(s["native_values"][0]["value"], -35.0);
    assert_eq!(send(&c, &url, &s, action).await.status(), 409); // Old control revision.
    let mut stale = s.clone();
    stale["session"] = json!("previous-process");
    assert_eq!(
        send(&c, &url, &stale, json!({"kind":"stop"}))
            .await
            .status(),
        409
    );
    assert_eq!(
        c.post(format!("{url}/audio/probe"))
            .json(&settings()["stream"]["input"])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    // The saved-preset supervisor shares the same device permit, before spawning its executable.
    let audio = get(&c, &url, "audio").await;
    assert_eq!(c.post(format!("{url}/audio")).json(&json!({"session":audio["session"],"expected_revision":audio["revision"],"action":{"kind":"start","settings":{"stream":settings()["stream"],"preset_id":"0".repeat(64),"owned":false}}})).send().await.unwrap().status(),409);
    let action = control(
        &s,
        json!({"type":"mappings","file":{"version":1,"mappings":[{"id":"gain","device":"injected","channel":1,"cc":21,"target":"amp.gain","mode":"absolute","pickup":false,"feedback":true,"min":0.0,"max":1.0,"curve":"linear"}]}}),
    );
    apply(&c, &url, &mut s, action).await;
    let action = control(
        &s,
        json!({"type":"midi","input":{"device":"injected","channel":1,"cc":21,"value":127}}),
    );
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["native_values"][0]["value"], 70.0);
    assert_eq!(s["control"]["feedback"][0]["value"], 127);
    let action = control(
        &s,
        json!({"type":"edit","edit":{"phase":"begin","owner":"web","token":"preview","target":"amp.gain"}}),
    );
    apply(&c, &url, &mut s, action).await;
    let action = control(
        &s,
        json!({"type":"edit","edit":{"phase":"preview","owner":"web","token":"preview","sequence":1,"value":0.5}}),
    );
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["native_values"][0]["value"], 0.0);
    assert_eq!(
        send(&c, &url, &s, json!({"kind":"set_boot","enabled":true}))
            .await
            .status(),
        409
    );
    let action = control(
        &s,
        json!({"type":"edit","edit":{"phase":"cancel","owner":"web","token":"preview"}}),
    );
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["native_values"][0]["value"], 70.0);
    // Autonomous expiry reaches the worker even with no control requests or browsers open.
    let action = control(
        &s,
        json!({"type":"edit","edit":{"phase":"begin","owner":"web","token":"expiry","target":"amp.gain"}}),
    );
    apply(&c, &url, &mut s, action).await;
    let action = control(
        &s,
        json!({"type":"edit","edit":{"phase":"preview","owner":"web","token":"expiry","sequence":1,"value":0.5}}),
    );
    apply(&c, &url, &mut s, action).await;
    tokio::time::sleep(Duration::from_secs(31)).await;
    s = get(&c, &url, "graph-audio").await;
    assert!(s["control"]["edit"].is_null());
    assert_eq!(s["native_values"][0]["value"], 70.0);
    // An edge-only live edit reaches the prepared worker, preserving explicit instance IDs.
    let mut routed = settings()["rig"].clone();
    routed["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({"from":"in","to":"out"}));
    let action = control(&s, json!({"type":"routing","rig":routed.clone()}));
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["control"]["rig"]["edges"].as_array().unwrap().len(), 3);
    assert_eq!(
        c.post(format!("{url}/graph-audio"))
            .header("content-type", "application/json")
            .body("x".repeat(70000))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    apply(
        &c,
        &url,
        &mut s,
        json!({"kind":"save_copy","name":"Authored LV2 rig"}),
    )
    .await;
    let saved_id = s["saved_copy"].clone();
    let saved = get(&c, &url, "presets/graphs").await;
    assert_eq!(saved.as_array().unwrap().len(), 1);
    assert_eq!(saved[0]["id"], saved_id);
    assert_eq!(saved[0]["preset"]["rig"], routed);
    assert_eq!(saved[0]["preset"]["recall"]["values"][0]["normalized"], 1.0);
    let frames = s["processed_frames"].as_u64().unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    s = get(&c, &url, "graph-audio").await;
    assert!(s["processed_frames"].as_u64().unwrap() > frames);
    apply(&c, &url, &mut s, json!({"kind":"stop"})).await;
    assert_eq!(s["device_owned"], false);
    assert_eq!(get(&c, &url, "state").await, original);
    apply(&c, &url, &mut s, json!({"kind":"restart"})).await;
    assert_ne!(s["control"]["session"], session);
    // Restart preserves confirmed values, routing, and mappings before Save.
    assert_eq!(s["native_values"][0]["value"], 70.0);
    assert_eq!(s["control"]["rig"], routed);
    assert_eq!(
        s["control"]["mappings"]["mappings"][0]["target"],
        "amp.gain"
    );
    // Reopen the durable document through a fresh Start, not retained worker state.
    apply(&c, &url, &mut s, json!({"kind":"stop"})).await;
    let mut recalled = settings();
    for key in ["name", "rig", "bindings", "recall"] {
        recalled[key] = saved[0]["preset"][key].clone();
    }
    apply(
        &c,
        &url,
        &mut s,
        json!({"kind":"start","settings":recalled}),
    )
    .await;
    assert_eq!(s["native_values"][0]["value"], 70.0);
    assert_eq!(s["control"]["rig"], routed);
    // Kill only our direct child with the verified graph-worker executable. No user processes.
    let pid = worker_pid(&executable);
    assert!(
        std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status()
            .unwrap()
            .success()
    );
    s = wait(&c, &url, "failed").await;
    assert_eq!(s["device_owned"], false);
    assert_eq!(get(&c, &url, "state").await, original);
    apply(&c, &url, &mut s, json!({"kind":"restart"})).await;
    // Device Apply retains the actual confirmed controls, routes and mappings.
    let before = s["configured"].clone();
    let mut stream = before["stream"].clone();
    stream["input"]["sample_rate"] = json!(44100);
    stream["output"]["sample_rate"] = json!(44100);
    stream["input"]["period_frames"] = json!(256);
    stream["output"]["period_frames"] = json!(256);
    apply(
        &c,
        &url,
        &mut s,
        json!({"kind":"reconfigure","stream":stream}),
    )
    .await;
    assert_eq!(s["phase"], "running");
    assert_eq!(s["configured"]["stream"], stream);
    assert_eq!(s["configured"]["recall"], before["recall"]);
    assert_eq!(s["control"]["rig"], routed);
    assert_eq!(s["native_values"][0]["value"], 70.0);
    let mut invalid = stream.clone();
    invalid["input"]["endpoint"] = json!("hw:CARD=Missing,DEV=0");
    invalid["output"]["endpoint"] = json!("hw:CARD=Missing,DEV=0");
    assert_eq!(
        send(&c, &url, &s, json!({"kind":"reconfigure","stream":invalid}))
            .await
            .status(),
        409
    );
    s = wait(&c, &url, "running").await;
    assert!(
        s["error"]
            .as_str()
            .unwrap()
            .contains("previous session restored")
    );
    assert_eq!(s["configured"]["stream"], stream);
    assert_eq!(s["configured"]["recall"], before["recall"]);
    assert_eq!(s["native_values"][0]["value"], 70.0);
    // Apply on a stopped session means Apply and resume, matching the UI.
    apply(&c, &url, &mut s, json!({"kind":"stop"})).await;
    apply(
        &c,
        &url,
        &mut s,
        json!({"kind":"reconfigure","stream":stream}),
    )
    .await;
    assert_eq!(s["phase"], "running");
    assert_eq!(s["configured"]["recall"], before["recall"]);
    let action = control(&s, json!({"type":"set","target":"rig.bypass","value":1.0}));
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["control"]["bypassed"], true);
    // Failed persistence leaves the live sound and prior preference intact.
    let boot_path = root.join("presets/boot-audio.json");
    std::fs::create_dir(boot_path.with_extension("tmp")).unwrap();
    assert_eq!(
        send(&c, &url, &s, json!({"kind":"set_boot","enabled":true}))
            .await
            .status(),
        409
    );
    assert!(!boot_path.exists());
    assert_eq!(get(&c, &url, "graph-audio").await["phase"], "running");
    std::fs::remove_dir(boot_path.with_extension("tmp")).unwrap();
    apply(&c, &url, &mut s, json!({"kind":"set_boot","enabled":true})).await;
    let captured = s["configured"].clone();
    assert_eq!(captured["name"], "Authored LV2 rig");
    assert_eq!(s["start_on_boot"], true);
    let audio = get(&c, &url, "audio").await;
    assert_eq!(audio["start_on_boot"], false);
    assert!(c.post(format!("{url}/audio")).json(&json!({"session":audio["session"],"expected_revision":audio["revision"],"action":{"kind":"set_boot","enabled":false}})).send().await.unwrap().status().is_success());
    assert_eq!(get(&c, &url, "graph-audio").await["start_on_boot"], true);
    let action = control(&s, json!({"type":"set","target":"amp.gain","value":0.25}));
    apply(&c, &url, &mut s, action).await;
    assert_eq!(s["native_values"][0]["value"], -35.0);
    let pid = worker_pid(&executable);
    shutdown.send_replace(true);
    tokio::time::timeout(Duration::from_secs(5), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    for _ in 0..100 {
        if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(
        !std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "shutdown must reap graph worker"
    );
    // A separate non-streaming probe now reaches backend validation, proving permit release.
    assert_ne!(
        c.post(format!("{url}/audio/probe"))
            .json(&settings()["stream"]["input"])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    server.abort();
    // A new daemon automatically restores the captured session, not later edits.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let mut config = config;
    config.shutdown = Some(signal);
    let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut s = wait(&c, &url, "running").await;
    assert_eq!(s["start_on_boot"], true);
    assert_eq!(s["configured"], captured);
    assert_eq!(s["control"]["bypassed"], true);
    assert_eq!(s["native_values"][0]["value"], 70.0);
    assert_eq!(s["device_owned"], true);
    let audio = get(&c, &url, "audio").await;
    assert_eq!(audio["phase"], "stopped");
    assert_eq!(audio["device_owned"], false);
    assert_eq!(get(&c, &url, "rig-audio").await["device_owned"], false);
    let control = s["control"].clone();
    apply(&c, &url, &mut s, json!({"kind":"set_boot","enabled":false})).await;
    assert!(!boot_path.exists());
    assert_eq!(s["control"], control);
    assert_eq!(s["phase"], "running");
    apply(&c, &url, &mut s, json!({"kind":"set_boot","enabled":true})).await;
    shutdown.send_replace(true);
    tokio::time::timeout(Duration::from_secs(5), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    server.abort();
    // A missing worker must not make the selected preference impossible to disable.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    config.shutdown = Some(signal);
    config.graph_worker = None;
    let (app, stopped) = router_with_shutdown(config).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut s = wait(&c, &url, "unavailable").await;
    assert_eq!(s["start_on_boot"], true);
    apply(&c, &url, &mut s, json!({"kind":"set_boot","enabled":false})).await;
    assert_eq!(s["phase"], "unavailable");
    assert_eq!(s["start_on_boot"], false);
    assert!(!boot_path.exists());
    assert_eq!(get(&c, &url, "presets/graphs").await[0]["id"], saved_id);
    shutdown.send_replace(true);
    tokio::time::timeout(Duration::from_secs(5), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}
fn worker_pid(executable: &std::path::Path) -> u32 {
    let expected = executable.canonicalize().unwrap();
    for task in std::fs::read_dir(format!("/proc/{}/task", std::process::id()))
        .unwrap()
        .flatten()
    {
        let children = std::fs::read_to_string(task.path().join("children")).unwrap_or_default();
        for id in children.split_whitespace() {
            if std::fs::read_link(format!("/proc/{id}/exe")).is_ok_and(|p| p == expected) {
                return id.parse().unwrap();
            }
        }
    }
    panic!("expected direct graph worker child");
}

#[tokio::test]
#[ignore = "pnpm lv2:check verifies the actual worker framing boundary"]
async fn graph_worker_rejects_malformed_or_oversized_startup() {
    use tokio::io::AsyncWriteExt;
    let executable = std::env::var_os("OXIDAL_TEST_GRAPH_WORKER").unwrap();
    for bytes in [b"{}\n".to_vec(), b"not-json\n".to_vec(), vec![b'x'; 65537]] {
        let mut child = tokio::process::Command::new(&executable)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        let _ = input.write_all(&bytes).await;
        drop(input);
        let result = tokio::time::timeout(Duration::from_secs(3), child.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
}
