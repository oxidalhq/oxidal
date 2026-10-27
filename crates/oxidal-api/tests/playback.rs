//! Real HTTP/process regression. Native qualification uses ALSA null, never a physical output.
use oxidal_api::{Config, router_with_shutdown};
use serde_json::{Value, json};

#[tokio::test]
#[ignore = "run by Linux native qualification with the actual audio/editor workers and preset fixture"]
async fn playback_stop_restart_failure_and_client_disconnect_preserve_authoring() {
    let audio_worker = std::env::var_os("OXIDAL_TEST_AUDIO_WORKER").expect("audio worker");
    let native_worker = std::env::var_os("OXIDAL_TEST_NATIVE_WORKER").expect("editor worker");
    assert_eq!(std::env::var("OXIDAL_AUDIO_QUALIFY_NULL").unwrap(), "1");
    let bytes =
        std::fs::read(std::env::var_os("OXIDAL_NATIVE_TEST_PRESET").expect("preset")).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-playback-test-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let preset = oxidal_presets::Store::new(root.join("presets"))
        .import(&bytes)
        .unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let config = Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        audio_worker: Some(audio_worker.into()),
        native_worker: Some(native_worker.into()),
        shutdown: Some(signal),
        simulator: true,
        mapping_path: root.join("mappings.json"),
        preset_dir: root.join("presets"),
        ui_dir: root.join("ui"),
    };
    let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    let initial = get(&client, &url, "state").await;
    let editor = get(&client, &url, "native").await;
    let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0", "direction":"capture", "sample_rate":48000, "channels":2, "format":"s16", "period_frames":128, "periods":3});
    let mut output = input.clone();
    output["direction"] = json!("playback");
    let settings = json!({"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},"preset_id":preset.sha256,"owned":false});
    let mut state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "stopped");
    // Missing immutable asset fails before PCM ownership and leaves the HTTP/native sessions intact.
    let mut missing = settings.clone();
    missing["preset_id"] = json!("0".repeat(64));
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"start","settings":missing})
        )
        .await
        .status(),
        409
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "failed");
    assert_eq!(state["device_owned"], false);
    let request = json!({"session":state["session"],"expected_revision":state["revision"],"action":{"kind":"start","settings":settings}});
    let starting_client = client.clone();
    let target = format!("{url}/audio");
    let pending =
        tokio::spawn(async move { starting_client.post(target).json(&request).send().await });
    for _ in 0..150 {
        state = get(&client, &url, "audio").await;
        if state["phase"] == "starting" || state["phase"] == "running" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(state["phase"] == "starting" || state["phase"] == "running");
    pending.abort(); // Accepted command remains owned by the supervisor, not the disconnected HTTP task.
    state = wait_phase(&client, &url, "running").await;
    assert_eq!(state["device_owned"], true);
    assert!(!state["controls"].as_array().unwrap().is_empty());
    let stopped_revision = state.clone();
    let result = send(
        &client,
        &url,
        &state,
        json!({"kind":"set_control", "target":"outputLevel", "value":0.23}),
    )
    .await;
    assert_eq!(result.status(), 200);
    state = result.json().await.unwrap();
    let level = state["controls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["target"] == "outputLevel")
        .unwrap();
    assert!((level["value"].as_f64().unwrap() - 0.23).abs() < 0.001);
    assert_eq!(state["modified"], true);
    assert_eq!(state["phase"], "running");
    assert_eq!(
        send(
            &client,
            &url,
            &stopped_revision,
            json!({"kind":"set_control", "target":"outputLevel", "value":0.8})
        )
        .await
        .status(),
        409
    );
    for action in [
        json!({"kind":"set_control", "target":"osEnabled", "value":1.0}),
        json!({"kind":"set_control", "target":"gateEnabled", "value":0.5}),
    ] {
        assert_eq!(send(&client, &url, &state, action).await.status(), 409);
        assert_eq!(
            get(&client, &url, "audio").await["revision"],
            state["revision"]
        );
    }
    let mut measured = false;
    for _ in 0..30 {
        let m = get(&client, &url, "monitor").await;
        if m["audio"]["frames"].as_u64().is_some_and(|f| f > 0) {
            assert_eq!(m["source"], "Saved preset");
            assert!(m["audio"]["process_us_max"].as_f64().unwrap().is_finite());
            assert!(m["audio_age_ms"].as_u64().unwrap() < 3000);
            measured = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(
        measured,
        "Actual audio worker must deliver measurements to HTTP"
    );
    // Export failure must leave the sounding revision, controls and editor intact.
    let controls_before_save = state["controls"].clone();
    std::fs::write(root.join("presets/owned"), b"not a directory").unwrap();
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"save_copy","name":"Sounding copy"})
        )
        .await
        .status(),
        409
    );
    assert_eq!(get(&client, &url, "audio").await, state);
    std::fs::remove_file(root.join("presets/owned")).unwrap();
    let saved = send(
        &client,
        &url,
        &state,
        json!({"kind":"save_copy","name":"Sounding copy"}),
    )
    .await;
    assert_eq!(
        saved.status(),
        200,
        "{}",
        saved.text().await.unwrap_or_default()
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "running");
    assert_eq!(state["controls"], controls_before_save);
    let saved_id = state["saved_copy"].as_str().unwrap().to_owned();
    let saved_info = oxidal_presets::OwnedStore::new(root.join("presets/owned"))
        .read(&saved_id)
        .unwrap()
        .0;
    assert_eq!(saved_info.source_sha256, preset.sha256);
    assert_eq!(saved_info.preset.name, "Sounding copy");
    assert_eq!(
        oxidal_presets::Store::new(root.join("presets"))
            .original(&preset.sha256)
            .unwrap(),
        bytes
    );
    assert_eq!(
        get(&client, &url, "native").await["session"],
        editor["session"]
    );
    assert_eq!(
        client
            .post(format!("{url}/audio/probe"))
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let mut stale = state.clone();
    stale["session"] = json!("previous-boot");
    assert_eq!(
        send(&client, &url, &stale, json!({"kind":"stop"}))
            .await
            .status(),
        409
    );
    assert_eq!(get(&client, &url, "audio").await["phase"], "running");
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"start","settings":settings})
        )
        .await
        .status(),
        409
    );
    assert_eq!(get(&client, &url, "audio").await["phase"], "running");
    assert!(
        send(&client, &url, &state, json!({"kind":"restart"}))
            .await
            .status()
            .is_success()
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "running");
    assert_eq!(
        state["controls"], controls_before_save,
        "restart must keep unsaved live controls"
    );
    assert_eq!(state["modified"], true);
    assert_eq!(
        send(&client, &url, &state, json!({"kind":"resume"}))
            .await
            .status(),
        409
    );
    assert!(
        send(&client, &url, &state, json!({"kind":"stop"}))
            .await
            .status()
            .is_success()
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "stopped");
    assert_eq!(state["device_owned"], false);
    let resumed = send(&client, &url, &state, json!({"kind":"resume"})).await;
    assert_eq!(resumed.status(), 200);
    state = resumed.json().await.unwrap();
    assert_eq!(
        state["controls"], controls_before_save,
        "stop/resume must restore before worker readiness"
    );
    assert_eq!(state["modified"], true);
    assert_eq!(
        send(&client, &url, &state, json!({"kind":"stop"}))
            .await
            .status(),
        200
    );
    state = get(&client, &url, "audio").await;
    // Reopen the copy in the real PCM worker; every normalized control must match.
    let mut saved_settings = settings.clone();
    saved_settings["preset_id"] = json!(saved_id);
    saved_settings["owned"] = json!(true);
    let reopened = send(
        &client,
        &url,
        &state,
        json!({"kind":"start","settings":saved_settings}),
    )
    .await;
    assert_eq!(reopened.status(), 200);
    state = reopened.json().await.unwrap();
    assert_eq!(state["controls"], controls_before_save);
    assert_eq!(state["preset_name"], "Sounding copy");
    assert_eq!(
        state["modified"], false,
        "explicit new session starts from its saved source"
    );
    assert_eq!(
        send(&client, &url, &state, json!({"kind":"stop"}))
            .await
            .status(),
        200
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(get(&client, &url, "state").await, initial);
    assert_eq!(
        get(&client, &url, "presets").await["presets"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Load, edit and save through the real native worker after playback has stopped.
    let mut editor_after = get(&client, &url, "native").await;
    assert_eq!(editor_after["session"], editor["session"]);
    for (id, action) in [
        (
            "load",
            json!({"kind":"load","id":preset.sha256,"owned":false}),
        ),
        ("save", json!({"kind":"save","name":"After stopping audio"})),
    ] {
        let response = client.post(format!("{url}/native")).json(&json!({"session":editor_after["session"],"expected_revision":editor_after["revision"],"request_id":id,"action":action})).send().await.unwrap();
        assert!(
            response.status().is_success(),
            "{id}: {:?}",
            response.text().await.unwrap()
        );
        editor_after = get(&client, &url, "native").await;
    }
    assert_eq!(editor_after["owned"].as_array().unwrap().len(), 2);
    assert!(root.join("presets/audio-runtime").is_dir());
    // Another actual open/close proves that the completed stop did not retain the global permit.
    assert!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"start","settings":settings})
        )
        .await
        .status()
        .is_success()
    );
    state = get(&client, &url, "audio").await;
    assert!(!state["start_on_boot"].as_bool().unwrap());
    assert!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"set_boot","enabled":true})
        )
        .await
        .status()
        .is_success()
    );
    state = get(&client, &url, "audio").await;
    assert_eq!(state["start_on_boot"], true);
    assert!(root.join("presets/boot-audio.json").is_file());
    assert!(
        send(&client, &url, &state, json!({"kind":"stop"}))
            .await
            .status()
            .is_success()
    );
    shutdown.send_replace(true);
    task.abort();
    stopped.wait().await.unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    state = wait_phase(&client, &url, "running").await;
    assert_eq!(state["start_on_boot"], true);
    assert_eq!(state["configured"], settings);
    assert!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"set_boot","enabled":false})
        )
        .await
        .status()
        .is_success()
    );
    assert!(!root.join("presets/boot-audio.json").exists());
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "running"); // Preference changes do not interrupt the live worker.
    shutdown.send_replace(true);
    task.abort();
    stopped.wait().await.unwrap();
    // Corrupt persistence must leave the library/authoring reachable, without silently starting audio.
    std::fs::write(root.join("presets/boot-audio.json"), b"invalid").unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        shutdown: Some(signal),
        ..config
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    for _ in 0..100 {
        state = get(&client, &url, "audio").await;
        if state["phase"] == "failed" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(state["phase"], "failed");
    assert_eq!(state["device_owned"], false);
    assert!(get(&client, &url, "native").await["session"].is_string());
    assert!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"set_boot","enabled":false})
        )
        .await
        .status()
        .is_success()
    );
    shutdown.send_replace(true);
    task.abort();
    stopped.wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
async fn get(client: &reqwest::Client, url: &str, path: &str) -> Value {
    let response = client.get(format!("{url}/{path}")).send().await.unwrap();
    assert!(response.status().is_success());
    response.json().await.unwrap()
}
async fn send(
    client: &reqwest::Client,
    url: &str,
    state: &Value,
    action: Value,
) -> reqwest::Response {
    client.post(format!("{url}/audio")).json(&json!({"session":state["session"],"expected_revision":state["revision"],"action":action})).send().await.unwrap()
}
async fn wait_phase(client: &reqwest::Client, url: &str, phase: &str) -> Value {
    for _ in 0..250 {
        let state = get(client, url, "audio").await;
        if state["phase"] == phase {
            return state;
        }
        assert_ne!(state["phase"], "failed", "{state}");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("audio never reached {phase}");
}
