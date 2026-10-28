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
    let root = std::env::temp_dir().join(format!("oxidal-playback-test-{}-音", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let preset = oxidal_presets::Store::new(root.join("presets"))
        .import(&bytes)
        .unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let config = Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
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
    let settings = json!({"stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},"preset_id":preset.sha256,"owned":false,"draft":false});
    qualify_large_frames(config.audio_worker.as_ref().unwrap(), &root, &settings).await;
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
    state = qualify_models(&client, &url, state, &root).await;
    // Immediate EQ editing belongs to the audible session and survives independent export.
    let eq_block = state["eq"][0]["block_id"].as_str().unwrap().to_owned();
    let mut band = state["eq"][0]["eq"]["bands"][1].clone();
    band["freqHz"] = json!(1200.0);
    band["gainDb"] = json!(0.1);
    for edit in [
        json!({"kind":"enabled","value":true}),
        json!({"kind":"pre","value":true}),
        json!({"kind":"band","index":1,"band":band}),
    ] {
        let reply = send(
            &client,
            &url,
            &state,
            json!({"kind":"set_eq","block_id":eq_block,"edit":edit}),
        )
        .await;
        assert_eq!(
            reply.status(),
            200,
            "{}",
            reply.text().await.unwrap_or_default()
        );
        state = get(&client, &url, "audio").await;
    }
    let eq_before_save = state["eq"].clone();
    let before_invalid = state.clone();
    assert_eq!(send(&client,&url,&state,json!({"kind":"set_eq","block_id":eq_block,"edit":{"kind":"band","index":9,"band":band}})).await.status(),409);
    assert_eq!(get(&client, &url, "audio").await, before_invalid);
    // Apply keeps the immutable tone identity and unsaved controls. Invalid
    // candidates are rejected before releasing the currently running stream.
    let before_apply = state.clone();
    let mut stream = settings["stream"].clone();
    stream["input"]["sample_rate"] = json!(44100);
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"reconfigure", "stream":stream})
        )
        .await
        .status(),
        409
    );
    assert_eq!(get(&client, &url, "audio").await, before_apply);
    stream["output"]["sample_rate"] = json!(44100);
    stream["input"]["period_frames"] = json!(256);
    stream["output"]["period_frames"] = json!(256);
    stream["input_map"] = json!([0, 0]);
    let applied = send(
        &client,
        &url,
        &state,
        json!({"kind":"reconfigure", "stream":stream}),
    )
    .await;
    assert_eq!(applied.status(), 200);
    state = applied.json().await.unwrap();
    assert_eq!(state["phase"], "running");
    assert_eq!(state["configured"]["stream"], stream);
    assert_eq!(
        state["configured"]["preset_id"],
        before_apply["configured"]["preset_id"]
    );
    assert_eq!(state["controls"], before_apply["controls"]);
    assert_eq!(state["eq"], eq_before_save);
    assert_eq!(state["modified"], true);
    // Restore the fixture settings through the same real process path.
    let restored = send(
        &client,
        &url,
        &state,
        json!({"kind":"reconfigure", "stream":settings["stream"]}),
    )
    .await;
    assert_eq!(restored.status(), 200);
    state = restored.json().await.unwrap();
    // A missing source defeats both candidate preparation and rollback. Keep the
    // previous settings/edits for explicit recovery instead of accepting the candidate.
    let original_path = root
        .join("presets")
        .join(format!("{}.t3kpreset", preset.sha256));
    let displaced = root.join("displaced-preset");
    std::fs::rename(&original_path, &displaced).unwrap();
    let failed = send(
        &client,
        &url,
        &state,
        json!({"kind":"reconfigure", "stream":stream}),
    )
    .await;
    assert_eq!(failed.status(), 409);
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "failed");
    assert_eq!(state["device_owned"], false);
    assert_eq!(state["configured"], before_apply["configured"]);
    assert!(
        state["error"]
            .as_str()
            .unwrap()
            .contains("Previous session could not resume")
    );
    std::fs::rename(&displaced, &original_path).unwrap();
    let resumed = send(&client, &url, &state, json!({"kind":"resume"})).await;
    assert_eq!(resumed.status(), 200);
    state = resumed.json().await.unwrap();
    assert_eq!(state["controls"], before_apply["controls"]);
    assert_eq!(state["eq"], eq_before_save);
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
    assert_eq!(state["eq"], eq_before_save);
    let saved_id = state["saved_copy"].as_str().unwrap().to_owned();
    let saved_info = oxidal_presets::OwnedStore::new(root.join("presets/owned"))
        .read(&saved_id)
        .unwrap()
        .0;
    assert_eq!(
        saved_info.source_sha256.as_deref(),
        Some(preset.sha256.as_str())
    );
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
    assert_eq!(state["eq"], eq_before_save, "restart must retain EQ");
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
    let previous_settings = state["configured"].clone();
    let mut missing = previous_settings.clone();
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
    assert_eq!(
        state["configured"], previous_settings,
        "failed replacement retains the previous session"
    );
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
    // Remove the audition cache: the saved rig must contain the selected model itself.
    std::fs::rename(
        root.join("presets/audition-models"),
        root.join("offline-cache"),
    )
    .unwrap();
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
    assert_eq!(state["eq"], eq_before_save);
    assert_eq!(state["preset_name"], "Sounding copy");
    assert!(
        state["controls"].to_string().contains(&"音".repeat(32)),
        "block labels: {:?}",
        state["controls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["target"].as_str().unwrap().starts_with("block:"))
            .map(|c| c["label"].as_str().unwrap())
            .collect::<Vec<_>>()
    );
    std::fs::rename(
        root.join("offline-cache"),
        root.join("presets/audition-models"),
    )
    .unwrap();
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
    let edited = send(
        &client,
        &url,
        &state,
        json!({"kind":"set_control","target":"outputLevel","value":0.36}),
    )
    .await;
    assert_eq!(edited.status(), 200);
    state = edited.json().await.unwrap();
    let block = state["eq"][0]["block_id"].clone();
    let edited = send(
        &client,
        &url,
        &state,
        json!({"kind":"set_eq","block_id":block,"edit":{"kind":"enabled","value":true}}),
    )
    .await;
    assert_eq!(edited.status(), 200);
    state = edited.json().await.unwrap();
    let boot_eq = state["eq"].clone();
    let boot_controls = state["controls"].clone();

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
    let edited = send(
        &client,
        &url,
        &state,
        json!({"kind":"set_control","target":"outputLevel","value":0.47}),
    )
    .await;
    assert_eq!(edited.status(), 200);
    state = edited.json().await.unwrap();

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
    assert_eq!(state["controls"], boot_controls);
    assert_eq!(state["eq"], boot_eq);
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
    let changed = send(
        &client,
        &url,
        &state,
        json!({"kind":"set_control","target":"outputLevel","value":0.41}),
    )
    .await;
    assert_eq!(changed.status(), 200);
    state = changed.json().await.unwrap();
    state = qualify_models(&client, &url, state, &root).await;
    let recovery_models = state["models"].clone();
    let recovery_eq = state["eq"].clone();
    let recovery_controls = state["controls"].clone();
    // A disk failure is a recovery warning, never a reason to stop the audio worker.
    let recovery_path = root.join("presets/last-audio-session.json");
    if recovery_path.is_file() {
        std::fs::remove_file(&recovery_path).unwrap();
    }
    std::fs::create_dir(&recovery_path).unwrap();
    for _ in 0..60 {
        state = get(&client, &url, "audio").await;
        if state["error"]
            .as_str()
            .is_some_and(|e| e.contains("recovery could not be saved"))
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(state["phase"], "running");
    assert_eq!(state["controls"], recovery_controls);
    assert!(
        state["error"]
            .as_str()
            .unwrap()
            .contains("recovery could not be saved")
    );
    std::fs::remove_dir(&recovery_path).unwrap();
    for _ in 0..70 {
        state = get(&client, &url, "audio").await;
        if state["error"].is_null() && recovery_path.is_file() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(state["error"].is_null());
    assert!(recovery_path.is_file());
    shutdown.send_replace(true);
    task.abort();
    stopped.wait().await.unwrap();
    // With boot playback disabled, startup restores metadata only. Resume is explicit.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "stopped");
    assert_eq!(state["device_owned"], false);
    assert_eq!(state["start_on_boot"], false);
    assert_eq!(state["configured"], settings);
    assert!(state["controls"].as_array().unwrap().is_empty());
    let resumed = send(&client, &url, &state, json!({"kind":"resume"})).await;
    assert_eq!(resumed.status(), 200);
    state = resumed.json().await.unwrap();
    assert_eq!(
        state["controls"], recovery_controls,
        "daemon restart retains confirmed scalar changes"
    );
    assert_eq!(state["modified"], true);
    assert_eq!(state["models"], recovery_models);
    assert_eq!(state["eq"], recovery_eq);
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"set_boot","enabled":true})
        )
        .await
        .status(),
        200
    );
    shutdown.send_replace(true);
    task.abort();
    stopped.wait().await.unwrap();
    // Boot also restores confirmed NAM/IR assignments and their scalar controls.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
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
    assert_eq!(state["controls"], recovery_controls);
    assert_eq!(state["models"], recovery_models);
    assert_eq!(state["eq"], recovery_eq);
    assert_eq!(
        send(
            &client,
            &url,
            &state,
            json!({"kind":"set_boot","enabled":false})
        )
        .await
        .status(),
        200
    );
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
    state = get(&client, &url, "audio").await;
    assert_eq!(state["phase"], "stopped");
    assert!(state["boot_error"].is_string());
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
    assert!(get(&client, &url, "audio").await["boot_error"].is_null());
    qualify_created_rig(&client, &url, &settings["stream"], &root).await;
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

async fn qualify_models(
    client: &reqwest::Client,
    url: &str,
    mut state: Value,
    root: &std::path::Path,
) -> Value {
    use sha2::{Digest, Sha256};
    let target = state["controls"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|c| {
            c["target"]
                .as_str()?
                .strip_prefix("block:")?
                .strip_suffix(":enabled")
        })
        .unwrap()
        .to_owned();
    let bytes =
        std::fs::read(std::env::var_os("OXIDAL_TONE3000_TEST_MODEL").expect("qualified model"))
            .unwrap();
    let store = oxidal_presets::ModelStore::new(root.join("presets/audition-models"));
    let mut asset = oxidal_presets::ModelAsset {
        schema: 1,
        tone_id: 701,
        model_id: 901,
        title: "音".repeat(100),
        name: "A2 fixture".into(),
        format: "nam".into(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        tone: json!({"id":701,"title":"音".repeat(100),"format":"nam","gear":"amp", "models":[{"id":901,"name":"A2 fixture","model_url":"oxidal-model://fixture/model.nam"}]}),
    };
    let good = store.stage(&asset, &bytes).unwrap();
    asset.sha256 = format!("{:x}", Sha256::digest(b"invalid model"));
    let bad = store.stage(&asset, b"invalid model").unwrap();
    let original_controls = state["controls"].clone();
    let original_models = state["models"].clone();
    for id in ["0".repeat(64), bad] {
        let result = send(
            client,
            url,
            &state,
            json!({"kind":"replace_model","assignment":{"target":target,"asset":id}}),
        )
        .await;
        assert_eq!(result.status(), 200, "{}", result.text().await.unwrap());
        state = wait_model(client, url, "failed").await;
        assert_eq!(state["phase"], "running", "bad candidate must retain PCM");
        assert_eq!(state["controls"], original_controls);
        assert_eq!(state["models"], original_models);
    }
    // Cancellation is tied to this selection, not just the currently running tone.
    let prepared = send(
        client,
        url,
        &state,
        json!({"kind":"replace_model","assignment":{"target":target,"asset":good}}),
    )
    .await;
    assert_eq!(prepared.status(), 200);
    state = prepared.json().await.unwrap();
    let request_id = state["model_change"]["request"].clone();
    let wrong = send(
        client,
        url,
        &state,
        json!({"kind":"cancel_model","request":0}),
    )
    .await;
    assert_eq!(wrong.status(), 409);
    for _ in 0..10 {
        state = get(client, url, "audio").await;
        assert_eq!(state["model_change"]["request"], request_id);
        let cancelled = send(
            client,
            url,
            &state,
            json!({"kind":"cancel_model","request":request_id}),
        )
        .await;
        if cancelled.status() == 200 {
            state = cancelled.json().await.unwrap();
            break;
        }
    }
    assert_eq!(state["model_change"]["phase"], "cancelled");
    assert_eq!(state["models"], original_models);
    assert_eq!(state["controls"], original_controls);
    // A cancelled parser may finish in the background; it must never apply late.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    state = get(client, url, "audio").await;
    assert_eq!(state["models"], original_models);
    let result = send(
        client,
        url,
        &state,
        json!({"kind":"replace_model","assignment":{"target":target,"asset":good}}),
    )
    .await;
    assert_eq!(result.status(), 200, "{}", result.text().await.unwrap());
    state = wait_model(client, url, "applied").await;
    assert_eq!(state["phase"], "running");
    assert_eq!(
        state["models"],
        json!([{"target":target,"asset":good,"insertion":null}])
    );
    assert!(
        state["controls"].to_string().contains(&"音".repeat(32)),
        "block labels: {:?}",
        state["controls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["target"].as_str().unwrap().starts_with("block:"))
            .map(|c| c["label"].as_str().unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(state["saved_copy"], Value::Null, "audition precedes save");
    assert_eq!(state["modified"], true);
    state
}
async fn wait_model(client: &reqwest::Client, url: &str, phase: &str) -> Value {
    for _ in 0..250 {
        let state = get(client, url, "audio").await;
        assert_eq!(state["phase"], "running", "{state}");
        if state["model_change"]["phase"] == phase {
            return state;
        }
        if phase == "applied" {
            assert_ne!(state["model_change"]["phase"], "failed", "{state}");
        }
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
    panic!("model did not reach {phase}");
}

async fn qualify_created_rig(
    client: &reqwest::Client,
    url: &str,
    stream: &Value,
    root: &std::path::Path,
) {
    let originals = get(client, url, "presets").await;
    let owned = oxidal_presets::OwnedStore::new(root.join("presets/owned"));
    let count = owned.list().unwrap().len();
    let mut state = get(client, url, "audio").await;
    assert!(
        state["models"][0]["asset"].is_string(),
        "earlier A2 workflow staged a verified fixture"
    );
    // Use a real compact Linear NAM for index coverage; repeating the A2 fixture
    // 130 times exceeds the intentional 32 MiB native preset-file budget.
    use sha2::{Digest, Sha256};
    let bytes = br#"{"version":"0.5.4","architecture":"Linear","config":{"receptive_field":1,"bias":false},"sample_rate":48000,"weights":[1.0]}"#;
    let compact = oxidal_presets::ModelAsset {
        schema: 1,
        tone_id: 3701,
        model_id: 3901,
        title: "Replay index fixture".into(),
        name: "Linear unity".into(),
        format: "nam".into(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        tone: json!({"id":3701,"title":"Replay index fixture","format":"nam","gear":"amp","models":[{"id":3901,"name":"Linear unity","model_url":"oxidal-model://fixture/linear.nam"}]}),
    };
    let asset = oxidal_presets::ModelStore::new(root.join("presets/audition-models"))
        .stage(&compact, bytes)
        .unwrap();
    let response = send(
        client,
        url,
        &state,
        json!({"kind":"create","stream":stream,"name":"New native rig"}),
    )
    .await;
    let status = response.status();
    let body = response.text().await.unwrap();
    assert_eq!(status, 200, "{body}");
    state = serde_json::from_str(&body).unwrap();
    assert_eq!(state["phase"], "running");
    assert_eq!(state["configured"]["draft"], true);
    assert_eq!(state["modified"], true);
    assert_eq!(state["preset_name"], "New native rig");
    assert!(
        !state["controls"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["target"].as_str().unwrap().starts_with("block:"))
    );
    assert_eq!(get(client, url, "presets").await, originals);
    assert_eq!(
        owned.list().unwrap().len(),
        count,
        "New is not an implicit named Save"
    );
    for action in [
        json!({"kind":"create","stream":stream,"name":"Do not replace"}),
        json!({"kind":"set_boot","enabled":true}),
    ] {
        assert_eq!(send(client, url, &state, action).await.status(), 409);
        assert_eq!(
            get(client, url, "audio").await["revision"],
            state["revision"]
        );
    }
    let initial_slots = state["slots"].clone();
    let mut targets = vec![];
    let initial_count = initial_slots
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["position"]["lane"] == 0)
        .count();
    // Cross former fixed bounds: 32 assignments, 256 controls and native replay index 127.
    for _ in 0..130.max(initial_count + 1) {
        let slot = state["slots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["position"]["lane"] == 0)
            .unwrap()
            .clone();
        let result = send(
            client,
            url,
            &state,
            json!({"kind":"replace_model","assignment":{"target":slot["target"],"asset":asset}}),
        )
        .await;
        assert_eq!(result.status(), 200, "{}", result.text().await.unwrap());
        state = wait_model(client, url, "applied").await;
        assert!(
            state["controls"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["target"]
                    == format!("block:{}:enabled", slot["target"].as_str().unwrap()))
        );
        targets.push(slot["target"].clone());
    }
    assert!(
        !initial_slots
            .as_array()
            .unwrap()
            .iter()
            .any(|s| Some(&s["target"]) == targets.last()),
        "last insert was created after exhausting the immutable base slots"
    );
    assert!(state["models"].as_array().unwrap().len() > 32);
    assert!(state["controls"].as_array().unwrap().len() > 256);
    assert!(
        state["models"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["insertion"]["index"].as_u64().is_some_and(|i| i > 127))
    );
    // Replacing the first model must not move its replay behind the dependent second insert.
    let result = send(
        client,
        url,
        &state,
        json!({"kind":"replace_model","assignment":{"target":targets[0],"asset":asset}}),
    )
    .await;
    assert_eq!(result.status(), 200);
    state = wait_model(client, url, "applied").await;
    assert_eq!(state["models"][0]["target"], targets[0]);
    assert_eq!(state["models"][1]["target"], targets[1]);
    // Add an independently typed IR to the same working chain. Its bytes must also
    // survive the cache-independent Save/reload exercised below.
    let fixtures = oxidal_presets::ModelStore::new(std::path::PathBuf::from(
        std::env::var_os("OXIDAL_NATIVE_TEST_MODELS").unwrap(),
    ));
    let ir = std::fs::read_dir(std::env::var_os("OXIDAL_NATIVE_TEST_MODELS").unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|e| fixtures.read(&e.file_name().to_string_lossy()).ok())
        .find(|(m, _)| m.format == "ir")
        .expect("qualified IR fixture");
    let ir_asset = oxidal_presets::ModelStore::new(root.join("presets/audition-models"))
        .stage(&ir.0, &std::fs::read(ir.1).unwrap())
        .unwrap();
    let slot = state["slots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["position"]["lane"] == 0)
        .unwrap()["target"]
        .clone();
    let response = send(
        client,
        url,
        &state,
        json!({"kind":"replace_model","assignment":{"target":slot,"asset":ir_asset}}),
    )
    .await;
    assert_eq!(response.status(), 200);
    state = wait_model(client, url, "applied").await;
    assert_eq!(
        state["models"].as_array().unwrap().last().unwrap()["asset"],
        ir_asset
    );
    let edited = send(
        client,
        url,
        &state,
        json!({"kind":"set_control","target":"outputLevel","value":0.31}),
    )
    .await;
    assert_eq!(edited.status(), 200);
    state = edited.json().await.unwrap();
    let controls = state["controls"].clone();
    for action in [json!({"kind":"stop"}), json!({"kind":"resume"})] {
        let response = send(client, url, &state, action).await;
        assert_eq!(response.status(), 200, "{}", response.text().await.unwrap());
        state = response.json().await.unwrap();
    }
    assert_eq!(state["controls"], controls);
    let saved = send(
        client,
        url,
        &state,
        json!({"kind":"save_copy","name":"Created native copy"}),
    )
    .await;
    assert_eq!(saved.status(), 200);
    state = saved.json().await.unwrap();
    let id = state["saved_copy"].as_str().unwrap().to_owned();
    assert!(owned.read(&id).unwrap().0.source_sha256.is_none());
    assert_eq!(owned.list().unwrap().len(), count + 1);
    let stopped = send(client, url, &state, json!({"kind":"stop"})).await;
    state = stopped.json().await.unwrap();
    std::fs::rename(
        root.join("presets/working-native"),
        root.join("drafts-hidden-for-offline-test"),
    )
    .unwrap();
    std::fs::rename(
        root.join("presets/audition-models"),
        root.join("models-hidden-for-created-recall"),
    )
    .unwrap();
    let reopened = send(
        client,
        url,
        &state,
        json!({"kind":"start","settings":{"stream":stream,"preset_id":id,"owned":true}}),
    )
    .await;
    assert_eq!(reopened.status(), 200);
    state = reopened.json().await.unwrap();
    assert_eq!(state["controls"], controls);
    assert_eq!(state["configured"]["draft"], false);
    assert_eq!(get(client, url, "presets").await, originals);
    assert_eq!(
        send(client, url, &state, json!({"kind":"stop"}))
            .await
            .status(),
        200
    );
}

// Exercise actual startup and separate export framing above the former 64 KiB
// limit. Padding is valid JSON whitespace; dense state semantics are unit tested.
async fn qualify_large_frames(worker: &std::path::Path, root: &std::path::Path, settings: &Value) {
    use std::{process::Stdio, time::Duration};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let original = oxidal_presets::Store::new(root.join("presets"))
        .original(settings["preset_id"].as_str().unwrap())
        .unwrap();
    let isolated = root.join("large-frame-test");
    let root = isolated.as_path();
    oxidal_presets::Store::new(root.join("presets"))
        .import(&original)
        .unwrap();
    std::fs::create_dir_all(root.join("frame-runtime")).unwrap();
    std::fs::create_dir_all(root.join("frame-export-runtime")).unwrap();
    let mut child = tokio::process::Command::new(worker)
        .env("OXIDAL_PRESET_DIR", root.join("presets"))
        .env("OXIDAL_QUALIFICATION_DATA", root.join("frame-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut bytes =
        serde_json::to_vec(&json!({"settings": settings, "models":[],"controls":null,"eq":null}))
            .unwrap();
    bytes.extend(std::iter::repeat_n(b' ', 80 * 1024));
    bytes.push(b'\n');
    input.write_all(&bytes).await.unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let mut reply = String::new();
    tokio::time::timeout(Duration::from_secs(25), output.read_line(&mut reply))
        .await
        .unwrap()
        .unwrap();
    let ready: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(ready["kind"], "ready");
    drop(input);
    assert!(
        tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
    let mut child = tokio::process::Command::new(worker)
        .arg("--save-copy")
        .env("OXIDAL_PRESET_DIR", root.join("presets"))
        .env(
            "OXIDAL_QUALIFICATION_DATA",
            root.join("frame-export-runtime"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut bytes = serde_json::to_vec(&json!({"settings":settings,"models":[],"controls":ready["controls"],"eq":ready["eq"],"name":"Frame 音 regression"})).unwrap();
    bytes.extend(std::iter::repeat_n(b' ', 80 * 1024));
    bytes.push(b'\n');
    child.stdin.take().unwrap().write_all(&bytes).await.unwrap();
    let saved = tokio::time::timeout(Duration::from_secs(25), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(saved.status.success());
    let id = std::str::from_utf8(&saved.stdout).unwrap().trim();
    assert_eq!(id.len(), 64);
    let (info, _) = oxidal_presets::OwnedStore::new(root.join("presets/owned"))
        .read(id)
        .unwrap();
    assert_eq!(info.preset.name, "Frame 音 regression");
}
