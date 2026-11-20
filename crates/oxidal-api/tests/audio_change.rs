use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
    response::Response,
};
use oxidal_api::{Config, router_with_shutdown};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::watch;
use tower::ServiceExt;

async fn request(app: &Router, method: &str, path: &str, body: Option<Value>) -> Response {
    let request = Request::builder()
        .method(method)
        .uri(format!("/api/v1/{path}"))
        .header("host", "127.0.0.1")
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap();
    app.clone().oneshot(request).await.unwrap()
}

async fn value(response: Response, status: u16) -> Value {
    let actual = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(actual, status, "{}", String::from_utf8_lossy(&bytes));
    serde_json::from_slice(&bytes).unwrap()
}

async fn get(app: &Router, path: &str) -> Value {
    value(request(app, "GET", path, None).await, 200).await
}

async fn phase(app: &Router, path: &str, wanted: &str) -> Value {
    let expires = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let state = get(app, path).await;
        if state["phase"] == wanted {
            return state;
        }
        assert!(
            state["phase"] != "failed" && tokio::time::Instant::now() < expires,
            "{path}: {state}"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

fn stream(frames: u32) -> Value {
    let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":frames,"periods":3});
    let mut output = input.clone();
    output["direction"] = json!("playback");
    json!({"input":input,"output":output,"input_map":[0,1],"output_map":[0,1],"hear_yourself":false})
}

fn apply(owner: &str, state: &Value, stream: &Value) -> Value {
    json!({"kind":"apply","owner":owner,"session":state["session"],"expected_revision":state["revision"],
        "input":stream["input"],"output":stream["output"],"input_map":stream["input_map"],"output_map":stream["output_map"]})
}

async fn command(app: &Router, role: &str, action: Value, expected: u16) -> Value {
    let state = get(app, role).await;
    value(request(app,"POST",role,Some(json!({"session":state["session"],"expected_revision":state["revision"],"action":action}))).await, expected).await
}

fn native_fixture() -> Vec<u8> {
    let file = std::env::var_os("OXIDAL_NATIVE_TEST_PRESET").expect("qualified Native preset");
    std::fs::read(file).unwrap()
}

fn undo_action(owner: &str, state: &Value, action: Value) -> Value {
    if owner == "native" {
        json!({"kind":"authoring","action":action})
    } else {
        json!({"kind":"authoring","command":{"session":state["control"]["session"],
            "expected_revision":state["control"]["revision"],"node":"tone","action":action}})
    }
}

fn edit_status<'a>(owner: &str, state: &'a Value) -> &'a Value {
    if owner == "native" {
        &state["authoring"]
    } else {
        &state["control"]["authoring"][0]["status"]
    }
}

fn scalar_action(owner: &str, state: &Value, change: bool) -> Value {
    match owner {
        "native" => {
            json!({"kind":"set_control","target":"outputLevel","value": if change { 0.31 } else { 0.62 }})
        }
        "mixed" => json!({"kind":"control","command":{"session":state["control"]["session"],
            "expected_revision":state["control"]["revision"],"target":{"kind":"lv2","node":"amp","symbol":"gain"},
            "value": if change { -9 } else { -20 }}}),
        "effects" => graph_action(
            state,
            if change { "set-before" } else { "set-during" },
            json!({"type":"set","target":"amp.gain","value": if change { 0.25 } else { 0.75 }}),
        ),
        _ => unreachable!(),
    }
}

fn graph_action(state: &Value, id: &str, action: Value) -> Value {
    json!({"kind":"control","command":{"protocol":1,"session":state["control"]["session"],
        "request_id":id,"expected_revision":state["control"]["revision"],"action":action}})
}

fn working_state(owner: &str, state: &Value) -> Value {
    if owner == "effects" {
        return json!({"rig":state["control"]["rig"],"native_values":state["native_values"],
            "parameters":state["control"]["parameters"],"edit":state["control"]["edit"]});
    }
    let status = edit_status(owner, state);
    let values = if owner == "native" {
        &state["controls"]
    } else {
        &state["control"]["controls"]
    };
    json!({"layout":status["layout"],"working":status["working"],
        "can_undo":status["can_undo"],"can_redo":status["can_redo"],"values":values})
}

fn settings(owner: &str, root: &Path) -> Value {
    match owner {
        "native" => {
            let bytes = native_fixture();
            let preset = oxidal_presets::Store::new(root.join("presets"))
                .import(&bytes)
                .unwrap();
            json!({"stream":stream(128),"preset_id":preset.sha256,"owned":false,"draft":false})
        }
        "mixed" => {
            let bytes = native_fixture();
            let inspection = oxidal_presets::inspect(&bytes).unwrap();
            let manifest = json!({
                "format":"oxidal.preset","formatVersion":1,"id":"9496ae91-9955-477a-ad67-5f0ffa6a049a",
                "name":"Audio change fixture",
                "tone3000":{"instances":[{"id":"native","preset":"current","profile":oxidal_engine::native_profile_id().unwrap()}]},
                "resources":[{"id":"current","path":"native/current.t3kpreset","kind":"tone3000-preset","bytes":bytes.len(),"sha256":inspection.sha256}],
                "extensions":{},"requiredExtensions":[],
                "oxidal":{"graph":{"nodes":[
                    {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
                    {"id":"tone","kind":"tone3000","audioInputs":2,"audioOutputs":2,"instance":"native","bypassed":false},
                    {"id":"amp","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"amp","bypassed":false},
                    {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
                    "edges":[
                        {"from":{"node":"in","port":0},"to":{"node":"tone","port":0}},
                        {"from":{"node":"in","port":1},"to":{"node":"tone","port":1}},
                        {"from":{"node":"tone","port":0},"to":{"node":"amp","port":0}},
                        {"from":{"node":"amp","port":0},"to":{"node":"out","port":0}},
                        {"from":{"node":"tone","port":1},"to":{"node":"out","port":1}}]},
                    "lv2":[{"id":"amp","pluginUri":"http://plugin.org.uk/swh-plugins/amp","controls":{"gain":-6},"assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}
            });
            let bundle = oxidal_presets::Bundle::from_parts(
                serde_json::to_vec(&manifest).unwrap(),
                [("current".to_owned(), bytes)].into(),
            )
            .unwrap();
            let revision = oxidal_presets::BundleStore::new(root.join("presets/bundles"))
                .save(&bundle)
                .unwrap();
            json!({"stream":stream(128),"revision":revision})
        }
        "effects" => {
            json!({"stream":stream(128),"bindings":[{"node":"amp","uri":"http://plugin.org.uk/swh-plugins/amp"}],"rig":{
                "nodes":[{"id":"in","kind":"input","level":1.0},{"id":"amp","kind":"lv2","level":1.0},{"id":"out","kind":"output","level":1.0}],
                "edges":[{"from":"in","to":"amp"},{"from":"amp","to":"out"}]
            }})
        }
        _ => unreachable!(),
    }
}

#[tokio::test]
#[ignore = "requires the actual Native, Mixed and Effects workers and ALSA null"]
async fn audio_change_keep_revert_timeout_and_resume_use_real_workers() {
    let root = std::env::temp_dir().join(format!("oxidal-audio-change-{}", std::process::id()));
    for (owner, path, variable, recovery) in [
        (
            "native",
            "audio",
            "OXIDAL_TEST_AUDIO_WORKER",
            "last-audio-session.json",
        ),
        (
            "mixed",
            "rig-audio",
            "OXIDAL_TEST_RIG_WORKER",
            "last-rig-session.json",
        ),
        (
            "effects",
            "graph-audio",
            "OXIDAL_TEST_GRAPH_WORKER",
            "last-graph-session.json",
        ),
    ] {
        let dir = root.join(owner);
        std::fs::create_dir_all(&dir).unwrap();
        let settings = settings(owner, &dir);
        let executable = PathBuf::from(std::env::var_os(variable).expect(variable));
        use std::os::unix::fs::PermissionsExt;
        let launch_delay = dir.join("delay-worker");
        let wrapper = dir.join("delayed-worker");
        assert!(!executable.as_os_str().to_string_lossy().contains('\''));
        assert!(!launch_delay.as_os_str().to_string_lossy().contains('\''));
        let ordinary_delay = if owner == "native" { "sleep 0.35" } else { ":" };
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nif [ \"$#\" -eq 0 ]; then\n  if [ -e '{}' ]; then sleep 1; else {ordinary_delay}; fi\nfi\nexec '{}' \"$@\"\n",
                launch_delay.display(),
                executable.display(),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        let executable = wrapper;
        let (shutdown, signal) = watch::channel(false);
        let mut config = Config {
            debug_socket: None,
            device_socket: None,
            native_worker: None,
            simulator: false,
            media_dir: None,
            audio_worker: (owner == "native").then(|| executable.clone()),
            rig_worker: (owner == "mixed").then(|| executable.clone()),
            graph_worker: (owner == "effects").then(|| executable.clone()),
            mapping_path: dir.join("mappings.json"),
            preset_dir: dir.join("presets"),
            ui_dir: dir.join("ui"),
            shutdown: Some(signal),
        };
        let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
        command(&app, path, json!({"kind":"start","settings":settings}), 200).await;
        let running = phase(&app, path, "running").await;
        let running = if owner == "native" {
            let saved = command(
                &app,
                path,
                json!({"kind":"save_copy","name":"Audio change working fixture"}),
                200,
            )
            .await;
            command(
                &app,
                path,
                json!({"kind":"load_preset","preset_id":saved["saved_copy"],"owned":true}),
                200,
            )
            .await
        } else {
            running
        };
        let original_layout = edit_status(owner, &running)["layout"].clone();
        let edit = if owner == "effects" {
            None
        } else {
            let block = original_layout["left"]
                .as_array()
                .unwrap()
                .iter()
                .find(|block| block["insert"] == false)
                .unwrap()["id"]
                .clone();
            let edit = json!({"kind":"edit","edit":{"kind":"duplicate","block_id":block,"lane":"left","index":0}});
            let begin = undo_action(
                owner,
                &running,
                json!({
                    "kind":"gesture","edit":{"phase":"begin","owner":"fixture","token":"knob","target":"inputLevel"}
                }),
            );
            let begun = command(&app, path, begin, 200).await;
            let commit = undo_action(
                owner,
                &begun,
                json!({
                    "kind":"gesture","edit":{"phase":"commit","owner":"fixture","token":"knob","sequence":1,"value":0.71}
                }),
            );
            let changed = command(&app, path, commit, 200).await;
            assert_eq!(edit_status(owner, &changed)["can_undo"], true, "{owner}");
            Some(edit)
        };
        let settled = get(&app, path).await;
        let running = command(&app, path, scalar_action(owner, &settled, true), 200).await;
        let mut pretrial = working_state(owner, &running);
        let running = if owner == "native" {
            let started = value(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(apply(owner, &running, &stream(96))),
                )
                .await,
                202,
            )
            .await;
            phase(&app, path, "starting").await;
            assert_eq!(get(&app, "audio/change").await["phase"], "restarting");
            assert_eq!(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"keep","id":started["id"]}))
                )
                .await
                .status(),
                409
            );
            let viewer = app.clone();
            let revert = tokio::spawn(async move {
                request(
                    &viewer,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"revert","id":started["id"]})),
                )
                .await
            });
            tokio::time::sleep(Duration::from_millis(40)).await;
            assert!(
                !revert.is_finished(),
                "Revert completed before the old worker was ready"
            );
            let result = value(revert.await.unwrap(), 200).await;
            assert_eq!(result["phase"], "reverted");
            let restored = phase(&app, path, "running").await;
            assert_eq!(
                restored["configured"]["stream"]["input"]["period_frames"],
                128
            );
            // Immediate Apply flushes the in-flight gesture receipt before it closes PCM.
            let settled = working_state(owner, &restored);
            assert!(settled["working"].is_string());
            if pretrial["working"].is_null() {
                pretrial["working"] = settled["working"].clone();
            }
            assert_eq!(settled, pretrial);
            restored
        } else {
            running
        };
        let mut unavailable = stream(96);
        unavailable["input"]["endpoint"] = json!("hw:CARD=Missing,DEV=0");
        unavailable["output"]["endpoint"] = unavailable["input"]["endpoint"].clone();
        value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(apply(owner, &running, &unavailable)),
            )
            .await,
            202,
        )
        .await;
        let rejected = phase(&app, "audio/change", "reverted").await;
        assert!(rejected["message"].as_str().is_some());
        let running = phase(&app, path, "running").await;
        assert_eq!(
            running["configured"]["stream"]["input"]["period_frames"],
            128
        );
        if owner == "mixed" {
            let settled = working_state(owner, &running);
            assert!(settled["working"].is_string());
            if pretrial["working"].is_null() {
                pretrial["working"] = settled["working"].clone();
            }
            assert_eq!(settled, pretrial);
        }
        let candidate = apply(owner, &running, &stream(96));
        let started = value(
            request(&app, "POST", "audio/change", Some(candidate.clone())).await,
            202,
        )
        .await;
        let id = started["id"].as_str().unwrap();
        let proving = phase(&app, "audio/change", "proving").await;
        assert!(proving["remaining_ms"].as_u64().unwrap() <= 15_000);
        assert_eq!(proving["previous"]["input"]["period_frames"], 128);
        assert_eq!(proving["candidate"]["input"]["period_frames"], 96);
        assert_eq!(
            get(&app, path).await["configured"]["stream"]["hear_yourself"],
            false
        );
        assert_eq!(
            request(&app, "POST", "audio/change", Some(candidate))
                .await
                .status(),
            409
        );
        command(
            &app,
            path,
            json!({"kind":"reconfigure","stream":stream(192)}),
            409,
        )
        .await;
        assert_eq!(
            request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"keep","id":"stale"}))
            )
            .await
            .status(),
            409
        );
        let live = get(&app, path).await;
        let before_refusals = working_state(owner, &live);
        assert_eq!(
            before_refusals, pretrial,
            "{owner} lost working state on Apply"
        );
        let mut refused = vec![scalar_action(owner, &live, false)];
        if owner != "native" {
            refused.push(plugin_defaults(&live, "amp"));
        }
        if let Some(edit) = &edit {
            refused.push(undo_action(owner, &live, json!({"kind":"undo"})));
            refused.push(undo_action(owner, &live, edit.clone()));
            if owner == "native" || owner == "mixed" {
                refused.push(json!({"kind":"midi_test","message":{"kind":"control","channel":1,"controller":21,"value":30}}));
            }
        } else {
            let mut route = live["control"]["rig"].clone();
            route["nodes"][0]["level"] = json!(0.5);
            refused.push(graph_action(
                &live,
                "route-during",
                json!({"type":"routing","rig":route}),
            ));
        }
        for action in refused {
            let failure = command(&app, path, action, 409).await;
            assert!(
                failure["error"]
                    .as_str()
                    .unwrap()
                    .contains("audio settings change"),
                "{failure}"
            );
        }
        let unchanged = get(&app, path).await;
        assert_eq!(unchanged["revision"], live["revision"]);
        assert_eq!(
            unchanged["control"]["revision"],
            live["control"]["revision"]
        );
        assert_eq!(working_state(owner, &unchanged), before_refusals);
        let durable: Value =
            serde_json::from_slice(&std::fs::read(config.preset_dir.join(recovery)).unwrap())
                .unwrap();
        assert_eq!(durable["settings"]["stream"]["input"]["period_frames"], 128);

        if owner == "effects" {
            // No client polls or keeps the change while the device deadline runs.
            tokio::time::sleep(Duration::from_secs(16)).await;
            phase(&app, "audio/change", "reverted").await;
            assert_eq!(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"keep","id":id}))
                )
                .await
                .status(),
                409
            );
        } else {
            assert_eq!(
                request(&app, "POST", "protect", Some(json!({"on":true})))
                    .await
                    .status(),
                200
            );
            assert_eq!(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"keep","id":id}))
                )
                .await
                .status(),
                423
            );
            let reverted = value(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"revert","id":id})),
                )
                .await,
                200,
            )
            .await;
            assert_eq!(reverted["phase"], "reverted");
            assert_eq!(
                request(&app, "POST", "protect", Some(json!({"on":false})))
                    .await
                    .status(),
                200
            );
        }
        let restored = phase(&app, path, "running").await;
        assert_eq!(
            restored["configured"]["stream"]["input"]["period_frames"],
            128
        );
        assert_eq!(
            working_state(owner, &restored),
            pretrial,
            "{owner} lost working state after Revert"
        );
        let restored = if edit.is_some() {
            let undone = command(
                &app,
                path,
                undo_action(owner, &restored, json!({"kind":"undo"})),
                200,
            )
            .await;
            assert_eq!(edit_status(owner, &undone)["layout"], original_layout);
            assert_eq!(edit_status(owner, &undone)["can_redo"], true);
            undone
        } else {
            restored
        };
        value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(apply(owner, &restored, &stream(96))),
            )
            .await,
            202,
        )
        .await;
        let proving = phase(&app, "audio/change", "proving").await;
        let kept = value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"keep","id":proving["id"]})),
            )
            .await,
            200,
        )
        .await;
        assert_eq!(kept["phase"], "kept");
        assert!(!config.preset_dir.join("pending-audio-change.json").exists());

        let running = phase(&app, path, "running").await;
        value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(apply(owner, &running, &stream(192))),
            )
            .await,
            202,
        )
        .await;
        phase(&app, "audio/change", "proving").await;
        command(&app, path, json!({"kind":"stop"}), 200).await;
        phase(&app, "audio/change", "reverted").await;
        let stopped_state = phase(&app, path, "stopped").await;
        assert_eq!(
            stopped_state["configured"]["stream"]["input"]["period_frames"],
            96
        );

        shutdown.send_replace(true);
        tokio::time::timeout(Duration::from_secs(8), stopped.wait())
            .await
            .unwrap()
            .unwrap();
        drop(app);
        let (shutdown, signal) = watch::channel(false);
        config.shutdown = Some(signal);
        let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
        let after = get(&app, path).await;
        assert_eq!(after["phase"], "stopped");
        assert_eq!(after["configured"]["stream"]["input"]["period_frames"], 96);
        assert_eq!(after["start_on_boot"], false);
        let resume = if owner == "native" {
            "resume"
        } else {
            "restart"
        };
        command(&app, path, json!({"kind":resume}), 200).await;
        let running = phase(&app, path, "running").await;
        value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(apply(owner, &running, &stream(192))),
            )
            .await,
            202,
        )
        .await;
        phase(&app, "audio/change", "proving").await;
        // Shutdown with a live unkept candidate. Startup must read the old hardware.
        shutdown.send_replace(true);
        tokio::time::timeout(Duration::from_secs(8), stopped.wait())
            .await
            .unwrap()
            .unwrap();
        drop(app);
        let (shutdown, signal) = watch::channel(false);
        config.shutdown = Some(signal);
        let (app, stopped) = router_with_shutdown(config.clone()).unwrap();
        let recovered = get(&app, path).await;
        assert_eq!(recovered["phase"], "stopped");
        assert_eq!(
            recovered["configured"]["stream"]["input"]["period_frames"],
            96
        );
        assert_eq!(get(&app, "audio/change").await["phase"], "reverted");
        assert!(!config.preset_dir.join("pending-audio-change.json").exists());

        let mut earlier_trial = None;
        for when in ["preparing", "restoring", "keep"] {
            command(&app, path, json!({"kind":resume}), 200).await;
            let running = phase(&app, path, "running").await;
            if when == "preparing" {
                std::fs::write(&launch_delay, []).unwrap();
            }
            let trial = value(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(apply(owner, &running, &stream(192))),
                )
                .await,
                202,
            )
            .await;
            let stop = json!({"kind":"stop","id":trial["id"]});
            let stale = json!({"kind":"stop","id":earlier_trial.replace(trial["id"].clone()).unwrap_or(json!("foreign"))});
            assert_eq!(
                request(&app, "POST", "audio/change", Some(stale))
                    .await
                    .status(),
                409
            );
            let mut rollback = None;
            let mut library_backup = None;
            match when {
                "preparing" => {
                    phase(&app, path, "starting").await;
                    assert_eq!(get(&app, "audio/change").await["phase"], "restarting");
                }
                "restoring" => {
                    phase(&app, "audio/change", "proving").await;
                    assert_eq!(
                        request(&app, "POST", "protect", Some(json!({"on":true})))
                            .await
                            .status(),
                        200
                    );
                    let backup = request(&app, "GET", "backup/library", None).await;
                    assert_eq!(backup.status(), 200);
                    // The stream owns the exclusive Library guard until its
                    // body is drained or dropped.
                    library_backup = Some(backup);
                    std::fs::write(&launch_delay, []).unwrap();
                    let viewer = app.clone();
                    let revert = json!({"kind":"revert","id":trial["id"]});
                    rollback = Some(tokio::spawn(async move {
                        request(&viewer, "POST", "audio/change", Some(revert)).await
                    }));
                    phase(&app, "audio/change", "reverting").await;
                    phase(&app, path, "starting").await;
                }
                _ => {
                    phase(&app, "audio/change", "proving").await;
                }
            }
            let receipt = if when == "keep" {
                let keep = json!({"kind":"keep","id":trial["id"]});
                let (keep, stop) = tokio::join!(
                    biased;
                    request(&app, "POST", "audio/change", Some(keep)),
                    request(&app, "POST", "audio/change", Some(stop.clone()))
                );
                assert_eq!(
                    keep.status(),
                    409,
                    "{owner} Keep should not outrun accepted Stop"
                );
                stop
            } else {
                request(&app, "POST", "audio/change", Some(stop.clone())).await
            };
            let receipt = value(receipt, 202).await;
            assert_eq!(receipt["phase"], "reverting");
            // The request has completed. The daemon still owns the release.
            if let Some(rollback) = rollback {
                let rollback = value(rollback.await.unwrap(), 200).await;
                assert_eq!(rollback["phase"], "reverted");
            }
            phase(&app, "audio/change", "reverted").await;
            drop(library_backup);
            let stopped = get(&app, path).await;
            assert_eq!(stopped["phase"], "stopped", "{owner} {when}");
            assert_eq!(stopped["device_owned"], false, "{owner} {when}");
            assert_eq!(
                stopped["configured"]["stream"]["input"]["period_frames"],
                96
            );
            assert!(!config.preset_dir.join("pending-audio-change.json").exists());
            if when == "restoring" {
                assert_eq!(
                    request(&app, "POST", "protect", Some(json!({"on":false})))
                        .await
                        .status(),
                    200
                );
            }
            if when != "keep" {
                std::fs::remove_file(&launch_delay).unwrap();
            }
            command(&app, path, json!({"kind":resume}), 200).await;
            let replacement = phase(&app, path, "running").await;
            assert_eq!(
                request(&app, "POST", "audio/change", Some(stop))
                    .await
                    .status(),
                409
            );
            assert_eq!(get(&app, path).await["session"], replacement["session"]);
            command(&app, path, json!({"kind":"stop"}), 200).await;
        }

        if owner == "native" {
            command(&app, path, json!({"kind":resume}), 200).await;
            let running = phase(&app, path, "running").await;
            value(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(apply(owner, &running, &stream(192))),
                )
                .await,
                202,
            )
            .await;
            let trial = phase(&app, "audio/change", "proving").await;
            // Lose the underlying source after the new worker has opened it.
            // Rollback cannot prepare any worker, so it must not reopen the candidate.
            let preset = running["configured"]["preset_id"].as_str().unwrap();
            let original = config.preset_dir.join("owned").join(preset);
            let unavailable = config.preset_dir.join("temporarily-unavailable");
            std::fs::rename(&original, &unavailable).unwrap();
            let failure = value(
                request(
                    &app,
                    "POST",
                    "audio/change",
                    Some(json!({"kind":"revert","id":trial["id"]})),
                )
                .await,
                200,
            )
            .await;
            assert_eq!(failure["phase"], "failed");
            let audio = get(&app, path).await;
            assert_eq!(audio["phase"], "failed");
            assert_eq!(audio["device_owned"], false);
            assert_eq!(audio["configured"]["stream"]["input"]["period_frames"], 96);
            std::fs::rename(unavailable, original).unwrap();
            command(&app, path, json!({"kind":resume}), 200).await;
            phase(&app, path, "running").await;
        }
        shutdown.send_replace(true);
        tokio::time::timeout(Duration::from_secs(8), stopped.wait())
            .await
            .unwrap()
            .unwrap();
    }
    std::fs::remove_dir_all(root).unwrap();
}

fn plugin_defaults(state: &Value, node: &str) -> Value {
    json!({"kind":"restore_plugin_defaults","command":{
        "session":state["control"]["session"],"expected_revision":state["control"]["revision"],"node":node}})
}

fn moment_and_amp_settings(owner: &str, root: &Path) -> Value {
    let uri = "urn:oxidal:plugin:moment#stereo";
    let amp = "http://plugin.org.uk/swh-plugins/amp";
    // Moment's opening Listen controls in Caught Moments (OX-43).
    let values = json!({"catch":0,"route":0,"loopmode":0,"move":71,"wetmode":0,"clock":100,
        "grit":0,"direct":0,"length":100,"time":35,"shape":60,"tone":65,"balance":50,"width":40,
        "freeze":0,"mix":50,"steps":1,"overdub":0,"fade":100,"wet":1,"chance":100,
        "link":0,"bpm":120,"division":2});
    if owner == "effects" {
        let vectors = [
            ("route", 0.0),
            ("time", 0.35),
            ("shape", 0.60),
            ("tone", 0.65),
            ("width", 0.40),
            ("amp.gain", 0.6),
        ];
        let recall: Vec<_> = vectors
            .iter()
            .map(|(key, normalized)| {
                json!({
                    "target":if key.contains('.') {key.to_string()} else {format!("moment.{key}")},
                    "normalized":normalized,
                })
            })
            .collect();
        return json!({"stream":stream(128),"bindings":[{"node":"moment","uri":uri},{"node":"amp","uri":amp}],
            "rig":{"nodes":[
                {"id":"in","kind":"input","level":1.0},
                {"id":"moment","kind":"lv2","level":1.0},
                {"id":"amp","kind":"lv2","level":1.0},
                {"id":"out","kind":"output","level":1.0}],
                "edges":[{"from":"in","to":"moment"},{"from":"moment","to":"amp"},{"from":"amp","to":"out"}]},
            "recall":{"bypassed":false,"values":recall,"mappings":{"version":1,"mappings":[]}}});
    }
    let extension = oxidal_presets::manifest::SCENES_BYPASS_EXTENSION;
    let edge = |from, a, to, b| json!({"from":{"node":from,"port":a},"to":{"node":to,"port":b}});
    let manifest = json!({
        "format":"oxidal.preset","formatVersion":1,"id":"777bee33-09db-4d82-8ed1-ac41390c495b",
        "name":"Caught Moments","tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[extension],
        "extensions":{extension:{"fade_ms":400,"scenes":[
            {"id":"listen","name":"Listen","gains":[],"bypass":[{"node":"moment","value":false}],"controls":[{"node":"moment","symbol":"time","value":35}]},
            {"id":"lead","name":"Lead","gains":[],"bypass":[{"node":"moment","value":false}],"controls":[{"node":"moment","symbol":"time","value":52}]}
        ]}},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"moment","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"moment","bypassed":false},
            {"id":"amp","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"amp","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"moment",0),edge("in",1,"moment",1),edge("moment",0,"amp",0),
                edge("amp",0,"out",0),edge("moment",1,"out",1)]},
            "lv2":[{"id":"moment","pluginUri":uri,"controls":values,"assets":[],"requiredFeatures":[]},
                   {"id":"amp","pluginUri":amp,"controls":{"gain":-6},"assets":[],"requiredFeatures":[]}],
            "recall":{"tails":"cut"}}
    });
    let bundle = oxidal_presets::Bundle::from_parts(
        serde_json::to_vec(&manifest).unwrap(),
        Default::default(),
    )
    .unwrap();
    let revision = oxidal_presets::BundleStore::new(root.join("presets/bundles"))
        .save(&bundle)
        .unwrap();
    json!({"stream":stream(128),"revision":revision})
}

fn plugin_values(
    owner: &str,
    state: &Value,
    node: &str,
) -> std::collections::BTreeMap<String, f32> {
    if owner == "effects" {
        let prefix = format!("{node}.");
        state["native_values"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| {
                let symbol = row["target"].as_str()?.strip_prefix(&prefix)?;
                Some((symbol.to_owned(), row["value"].as_f64()? as f32))
            })
            .collect()
    } else {
        state["control"]["controls"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| {
                let target = &row["target"];
                if target["kind"] != "lv2" || target["node"] != node {
                    return None;
                }
                Some((
                    target["symbol"].as_str()?.to_owned(),
                    row["value"].as_f64()? as f32,
                ))
            })
            .collect()
    }
}

#[tokio::test]
#[ignore = "requires the actual Mixed and Effects workers, Moment LV2 and ALSA null"]
async fn plugin_defaults_restore_one_instance_through_worker_save_and_reopen() {
    let root = std::env::temp_dir().join(format!("oxidal-plugin-defaults-{}", std::process::id()));
    for (owner, path, variable) in [
        ("mixed", "rig-audio", "OXIDAL_TEST_RIG_WORKER"),
        ("effects", "graph-audio", "OXIDAL_TEST_GRAPH_WORKER"),
    ] {
        let dir = root.join(owner);
        let mut settings = moment_and_amp_settings(owner, &dir);
        let executable = PathBuf::from(std::env::var_os(variable).expect(variable));
        let (shutdown, signal) = watch::channel(false);
        let (app, stopped) = router_with_shutdown(Config {
            debug_socket: None,
            device_socket: None,
            native_worker: None,
            audio_worker: None,
            simulator: false,
            media_dir: None,
            rig_worker: (owner == "mixed").then(|| executable.clone()),
            graph_worker: (owner == "effects").then_some(executable),
            mapping_path: dir.join("mappings.json"),
            preset_dir: dir.join("presets"),
            ui_dir: dir.join("ui"),
            shutdown: Some(signal),
        })
        .unwrap();
        let cold = get(&app, path).await;
        let mut attempted = plugin_defaults(&cold, "moment");
        attempted["command"]["session"] = json!("offline");
        attempted["command"]["expected_revision"] = json!(0);
        command(&app, path, attempted, 409).await;
        assert_eq!(get(&app, path).await["revision"], cold["revision"]);
        assert_eq!(get(&app, path).await["device_owned"], false);

        if owner == "effects" {
            // Legacy Effects recall requires the complete worker control set.
            // Start an unedited instance to obtain the exact rate-qualified targets.
            let mut factory = settings.clone();
            factory["recall"] = Value::Null;
            command(&app, path, json!({"kind":"start","settings":factory}), 200).await;
            let worker = phase(&app, path, "running").await;
            let overrides = settings["recall"]["values"].as_array().unwrap();
            let values: Vec<_> = worker["control"]["parameters"]
                .as_array()
                .unwrap()
                .iter()
                .map(|port| {
                    overrides
                        .iter()
                        .find(|value| value["target"] == port["id"])
                        .cloned()
                        .unwrap_or_else(|| json!({"target":port["id"],"normalized":port["value"]}))
                })
                .collect();
            settings["recall"]["values"] = json!(values);
            let saved = oxidal_presets::GraphStore::new(dir.join("presets/graphs")).save(
                serde_json::from_value(json!({
                    "version":1,"name":"Caught Moments","sample_rate":48000,"rig":settings["rig"],
                    "bindings":settings["bindings"],"recall":settings["recall"],
                })).unwrap()
            ).unwrap();
            settings["library_id"] = json!(saved.id);
            settings["name"] = json!(saved.preset.name);
            command(&app, path, json!({"kind":"stop"}), 200).await;
        }
        command(
            &app,
            path,
            json!({"kind":"start","settings":settings.clone()}),
            200,
        )
        .await;
        let opening = phase(&app, path, "running").await;
        let opening_values = plugin_values(owner, &opening, "moment");
        assert_eq!(opening_values["route"], 0.0);
        assert_eq!(opening_values["time"], 35.0);
        assert_eq!(opening_values["width"], 40.0);
        assert_eq!(
            opening["control"]["modified"],
            if owner == "mixed" {
                json!(false)
            } else {
                Value::Null
            }
        );
        let amp = plugin_values(owner, &opening, "amp");
        let request_body = plugin_defaults(&opening, "moment");
        let stale_outer = json!({"session":opening["session"],"expected_revision":0,"action":request_body.clone()});
        assert_eq!(
            request(&app, "POST", path, Some(stale_outer))
                .await
                .status(),
            409
        );
        let mut stale_worker = request_body.clone();
        stale_worker["command"]["session"] = json!("former-worker");
        command(&app, path, stale_worker, 409).await;
        command(
            &app,
            path,
            plugin_defaults(&opening, "Oxidal Moment (Stereo)"),
            409,
        )
        .await;
        command(&app, path, plugin_defaults(&opening, "out"), 409).await;
        assert_eq!(get(&app, path).await["revision"], opening["revision"]);

        assert_eq!(
            request(&app, "POST", "protect", Some(json!({"on":true})))
                .await
                .status(),
            200
        );
        command(&app, path, request_body.clone(), 423).await;
        assert_eq!(
            request(&app, "POST", "protect", Some(json!({"on":false})))
                .await
                .status(),
            200
        );
        if owner == "mixed" {
            let active = get(&app, path).await;
            let fading = command(&app, path, json!({"kind":"scene","command":{
                "session":active["control"]["session"],"expected_revision":active["control"]["revision"],
                "scene":"lead"}}), 200).await;
            assert_eq!(fading["control"]["scene_transitioning"], true);
            command(&app, path, plugin_defaults(&fading, "moment"), 409).await;
            tokio::time::timeout(Duration::from_secs(3), async {
                while get(&app, path).await["control"]["scene_transitioning"] != false {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("Moment scene ramp settled");
        } else {
            let gesture = graph_action(
                &opening,
                "prepare-effect-edit",
                json!({
                    "type":"edit","edit":{"phase":"begin","owner":"fixture","token":"knob","target":"moment.time"}
                }),
            );
            let editing = command(&app, path, gesture, 200).await;
            command(&app, path, plugin_defaults(&editing, "moment"), 409).await;
            let cancel = graph_action(
                &editing,
                "cancel-effect-edit",
                json!({
                    "type":"edit","edit":{"phase":"cancel","owner":"fixture","token":"knob"}
                }),
            );
            command(&app, path, cancel, 200).await;
        }
        let active = get(&app, path).await;
        let restored = command(&app, path, plugin_defaults(&active, "moment"), 200).await;
        assert_eq!(
            restored["revision"].as_u64(),
            active["revision"].as_u64().map(|n| n + 1)
        );
        assert_eq!(
            restored["control"]["revision"].as_u64(),
            active["control"]["revision"].as_u64().map(|n| n + 1)
        );
        assert_eq!(restored["control"]["session"], active["control"]["session"]);
        assert_eq!(plugin_values(owner, &restored, "amp"), amp);
        let expected = [
            ("clock", 100.),
            ("steps", 1.),
            ("grit", 0.),
            ("route", 1.),
            ("balance", 50.),
            ("catch", 0.),
            ("loopmode", 0.),
            ("length", 100.),
            ("move", 71.),
            ("overdub", 0.),
            ("fade", 100.),
            ("direct", 0.),
            ("wet", 1.),
            ("wetmode", 0.),
            ("time", 50.),
            ("shape", 50.),
            ("tone", 70.),
            ("chance", 100.),
            ("freeze", 0.),
            ("link", 0.),
            ("bpm", 120.),
            ("division", 2.),
            ("width", 0.),
            ("mix", 50.),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect();
        assert_eq!(plugin_values(owner, &restored, "moment"), expected);
        command(&app, path, plugin_defaults(&active, "moment"), 409).await;
        let mut saved_settings = settings.clone();
        if owner == "mixed" {
            assert_eq!(restored["control"]["modified"], true);
            command(
                &app,
                path,
                json!({"kind":"save","name":"Moment factory defaults"}),
                200,
            )
            .await;
            for _ in 0..200 {
                let state = get(&app, path).await;
                if state["save"]["running"] == false {
                    saved_settings["revision"] = state["save"]["saved_revision"].clone();
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            assert_ne!(saved_settings["revision"], settings["revision"]);
            assert!(saved_settings["revision"].is_string());
        } else {
            let saved = command(
                &app,
                path,
                json!({"kind":"save_copy","name":"Moment factory defaults"}),
                200,
            )
            .await;
            let entry = oxidal_presets::GraphStore::new(dir.join("presets/graphs"))
                .read(saved["saved_copy"].as_str().unwrap())
                .unwrap();
            saved_settings["name"] = json!(entry.preset.name);
            saved_settings["library_id"] = json!(entry.id);
            saved_settings["recall"] = json!(entry.preset.recall);
        }
        command(&app, path, json!({"kind":"stop"}), 200).await;
        command(
            &app,
            path,
            json!({"kind":"start","settings":saved_settings}),
            200,
        )
        .await;
        let reopened = phase(&app, path, "running").await;
        assert_eq!(plugin_values(owner, &reopened, "moment"), expected);
        if owner == "mixed" {
            assert_eq!(reopened["control"]["modified"], false);
        }
        command(&app, path, json!({"kind":"stop"}), 200).await;
        command(&app, path, json!({"kind":"start","settings":settings}), 200).await;
        let original = phase(&app, path, "running").await;
        assert_eq!(plugin_values(owner, &original, "moment"), opening_values);
        shutdown.send_replace(true);
        tokio::time::timeout(Duration::from_secs(8), stopped.wait())
            .await
            .unwrap()
            .unwrap();
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires the actual Mixed worker, ALSA null and the authored LV2 latency fixture"]
async fn plugin_defaults_unverified_rollback_releases_the_worker() {
    let root = std::env::temp_dir().join(format!(
        "oxidal-plugin-defaults-fault-{}",
        std::process::id()
    ));
    let executable = PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    let store = oxidal_presets::BundleStore::new(root.join("presets/bundles"));
    let edge = |from, a, to, b| json!({"from":{"node":from,"port":a},"to":{"node":to,"port":b}});
    let manifest = json!({
        "format":"oxidal.preset","formatVersion":1,"id":"777bee33-09db-4d82-8ed1-ac41390c495b",
        "name":"Rollback fault fixture","tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[],"extensions":{},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"latent","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"latent","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"latent",0),edge("latent",0,"out",0),edge("in",1,"out",1)]},
            "lv2":[{"id":"latent","pluginUri":"urn:oxidal:test:latency","controls":{"delay":13,"mode":9},
                    "assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}
    });
    let bundle = oxidal_presets::Bundle::from_parts(
        serde_json::to_vec(&manifest).unwrap(),
        Default::default(),
    )
    .unwrap();
    let revision = store.save(&bundle).unwrap();
    let (shutdown, signal) = watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        native_worker: None,
        audio_worker: None,
        simulator: false,
        media_dir: None,
        rig_worker: Some(executable),
        graph_worker: None,
        mapping_path: root.join("mappings.json"),
        preset_dir: root.join("presets"),
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    })
    .unwrap();
    let path = "rig-audio";
    command(
        &app,
        path,
        json!({"kind":"start","settings":{"revision":revision,"stream":stream(128)}}),
        200,
    )
    .await;
    let running = phase(&app, path, "running").await;
    let error = command(&app, path, plugin_defaults(&running, "latent"), 409).await;
    assert!(
        error["error"]
            .as_str()
            .unwrap()
            .contains("could not be confirmed")
    );
    let failed = phase(&app, path, "failed").await;
    assert_eq!(failed["device_owned"], false);
    assert_eq!(failed["waiting_for_device"], false);
    assert_eq!(
        failed["control"]["revision"],
        running["control"]["revision"]
    );
    assert_eq!(failed["control"]["modified"], false);
    assert_eq!(plugin_values("mixed", &failed, "latent")["mode"], 9.0);
    shutdown.send_replace(true);
    tokio::time::timeout(Duration::from_secs(8), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires real Native, Mixed and Effects workers, ALSA null and one minute per owner"]
async fn buffer_finder_measures_without_viewers_and_restores_all_real_owners() {
    let root = std::env::temp_dir().join(format!("oxidal-buffer-finder-{}", std::process::id()));
    let mut full_clean_minute = false;
    for (owner, path, variable) in [
        ("native", "audio", "OXIDAL_TEST_AUDIO_WORKER"),
        ("mixed", "rig-audio", "OXIDAL_TEST_RIG_WORKER"),
        ("effects", "graph-audio", "OXIDAL_TEST_GRAPH_WORKER"),
    ] {
        let dir = root.join(owner);
        std::fs::create_dir_all(&dir).unwrap();
        let mut settings = settings(owner, &dir);
        settings["stream"] = stream(2048);
        settings["stream"]["input"]["periods"] = json!(2);
        settings["stream"]["output"]["periods"] = json!(2);
        let executable = PathBuf::from(std::env::var_os(variable).expect(variable));
        let (shutdown, signal) = watch::channel(false);
        let config = Config {
            debug_socket: None,
            device_socket: None,
            native_worker: None,
            simulator: false,
            media_dir: None,
            audio_worker: (owner == "native").then(|| executable.clone()),
            rig_worker: (owner == "mixed").then(|| executable.clone()),
            graph_worker: (owner == "effects").then(|| executable.clone()),
            mapping_path: dir.join("mappings.json"),
            preset_dir: dir.join("presets"),
            ui_dir: dir.join("ui"),
            shutdown: Some(signal),
        };
        let (app, stopped) = router_with_shutdown(config).unwrap();
        command(&app, path, json!({"kind":"start","settings":settings}), 200).await;
        phase(&app, path, "running").await;
        if owner == "native" {
            let saved = command(
                &app,
                path,
                json!({"kind":"save_copy","name":"Finder working values"}),
                200,
            )
            .await;
            command(
                &app,
                path,
                json!({"kind":"load_preset","preset_id":saved["saved_copy"],"owned":true}),
                200,
            )
            .await;
        }
        let state = get(&app, path).await;
        let edited = command(&app, path, scalar_action(owner, &state, true), 200).await;
        let before = working_state(owner, &edited);
        let find = |state: &Value| json!({"kind":"find_buffer","owner":owner,"session":state["session"],"expected_revision":state["revision"]});
        let mut stale = find(&edited);
        stale["expected_revision"] = json!(u64::MAX);
        assert_eq!(
            request(&app, "POST", "audio/change", Some(stale))
                .await
                .status(),
            409
        );
        let started = value(
            request(&app, "POST", "audio/change", Some(find(&edited))).await,
            202,
        )
        .await;
        let id = started["id"].clone();
        assert_eq!(started["finder"]["state"], "running");
        let proving = phase(&app, "audio/change", "proving").await;
        assert!(proving["observed"]["frames"].as_u64().unwrap() > 0);
        assert_eq!(
            request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"keep","id":id}))
            )
            .await
            .status(),
            409
        );
        assert_eq!(
            request(&app, "POST", "audio/change", Some(find(&edited)))
                .await
                .status(),
            409
        );
        let busy = get(&app, path).await;
        command(&app, path, scalar_action(owner, &busy, false), 409).await;
        eprintln!("{owner}: leaving the device finder without GETs or browsers for 63 seconds");
        tokio::time::sleep(Duration::from_secs(63)).await;
        let measured = get(&app, "audio/change").await;
        let baseline = &measured["finder"]["trials"][0];
        if baseline["outcome"] == "clean" {
            assert!(
                baseline["elapsed_ms"].as_u64().unwrap() >= 60000,
                "{owner}: {baseline}"
            );
            assert_eq!(baseline["xruns"], 0);
            assert_eq!(baseline["deadline_misses"], 0);
            assert_eq!(baseline["invalid_samples"], 0);
            full_clean_minute = true;
        } else {
            // A real deadline failure under host load must remain a refusal, not a fake clean result.
            assert_eq!(baseline["outcome"], "failed", "{owner}: {measured}");
            assert!(
                ["xruns", "deadline_misses", "invalid_samples"]
                    .iter()
                    .any(|key| baseline[*key].as_u64().is_some_and(|value| value > 0)),
                "{owner}: {baseline}"
            );
            assert!(
                measured["finder"]["recommended"].is_null(),
                "{owner}: {measured}"
            );
        }
        if measured["finder"]["state"] == "running" {
            let response = request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"revert","id":id})),
            )
            .await;
            if response.status() == 409 {
                assert_eq!(get(&app, "audio/change").await["finder"]["state"], "done");
            } else {
                value(response, 202).await;
            }
        }
        phase(&app, "audio/change", "reverted").await;
        let until = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let view = get(&app, "audio/change").await;
            if view["finder"]["state"] == "cancelled"
                || view["finder"]["state"] == "done"
                || view["finder"]["state"] == "failed"
            {
                break;
            }
            assert!(tokio::time::Instant::now() < until, "{owner}: {view}");
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        let restored = phase(&app, path, "running").await;
        assert_eq!(
            restored["configured"]["stream"]["input"]["period_frames"],
            2048
        );
        assert_eq!(restored["configured"]["stream"]["input"]["periods"], 2);
        assert_eq!(
            working_state(owner, &restored),
            before,
            "{owner}: finder lost working values"
        );
        assert!(!dir.join("presets/pending-audio-change.json").exists());

        // Protect cancels the job without turning a tested candidate into a durable Keep.
        let started = value(
            request(&app, "POST", "audio/change", Some(find(&restored))).await,
            202,
        )
        .await;
        assert_eq!(
            request(&app, "POST", "protect", Some(json!({"on":true})))
                .await
                .status(),
            200
        );
        phase(&app, "audio/change", "reverted").await;
        let until = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let view = get(&app, "audio/change").await;
            if view["finder"]["state"] == "cancelled" {
                break;
            }
            assert!(tokio::time::Instant::now() < until, "{view}");
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        assert_eq!(
            get(&app, path).await["configured"]["stream"]["input"]["period_frames"],
            2048
        );
        assert_eq!(
            request(&app, "POST", "protect", Some(json!({"on":false})))
                .await
                .status(),
            200
        );
        assert_eq!(
            request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"keep","id":started["id"]}))
            )
            .await
            .status(),
            409
        );

        // Stop is ID-bound and must fence any subsequent candidate launch.
        let current = get(&app, path).await;
        let started = value(
            request(&app, "POST", "audio/change", Some(find(&current))).await,
            202,
        )
        .await;
        value(
            request(
                &app,
                "POST",
                "audio/change",
                Some(json!({"kind":"stop","id":started["id"]})),
            )
            .await,
            202,
        )
        .await;
        phase(&app, "audio/change", "reverted").await;
        let current = get(&app, path).await;
        assert_eq!(current["device_owned"], false, "{owner}");
        assert_eq!(current["phase"], "stopped", "{owner}");
        tokio::time::sleep(Duration::from_millis(350)).await;
        assert_eq!(
            get(&app, path).await["device_owned"],
            false,
            "{owner}: late finder launch"
        );
        eprintln!(
            "{owner}: truthful measurement result, retained values, cancellation, Protect and Stop passed"
        );
        shutdown.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(10), stopped.wait())
            .await
            .unwrap()
            .unwrap();
    }
    assert!(
        full_clean_minute,
        "No actual worker completed a clean full minute; repeat on an idle qualification host"
    );
    std::fs::remove_dir_all(root).unwrap();
}
