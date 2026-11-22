//! Maintained native:check path: actual mixed HTTP/worker/null-ALSA lifecycle.
use oxidal_api::{Config, router_with_shutdown};
use oxidal_presets::BundleStore;
use reqwest::Client;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

// The lifecycle test counts all rig worker children of this test executable.
static WORKER_TEST: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
        if matches!(
            action["kind"].as_str(),
            Some("start" | "restart" | "reconfigure" | "discard_changes")
        ) {
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
    json!({"input":input,"output":output,"input_map":[0,1],"output_map":[0,1],"hear_yourself":true})
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
#[ignore = "pnpm native:check supplies the actual Linux mixed worker and ALSA null"]
async fn scene_bypass_survives_mixed_worker_restart_and_independent_save() {
    use oxidal_presets::{
        Bundle,
        manifest::{SCENES_BYPASS_EXTENSION, STOMP_GROUPS_EXTENSION},
    };
    let _worker_test = WORKER_TEST.lock().await;
    let executable = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    assert_eq!(std::env::var("OXIDAL_RIG_QUALIFY_NULL").unwrap(), "1");
    let root =
        std::env::temp_dir().join(format!("oxidal-scene-bypass-http-{}", std::process::id()));
    let store = BundleStore::new(root.join("presets/bundles"));
    let edge = |a, ap, b, bp| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let manifest = json!({
        "format":"oxidal.preset","formatVersion":1,"id":"9496ae91-9955-477a-ad67-5f0ffa6a049a",
        "name":"Scene bypass","tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[SCENES_BYPASS_EXTENSION,STOMP_GROUPS_EXTENSION],
        "extensions":{SCENES_BYPASS_EXTENSION:{"fade_ms":40,"scenes":[
            {"id":"wet","name":"Wet","gains":[],"bypass":[{"node":"amp","value":false}]},
            {"id":"dry","name":"Dry","gains":[],"bypass":[{"node":"amp","value":true}]}
        ]},STOMP_GROUPS_EXTENSION:{"groups":[{"id":"amp-toggle","name":"Amp switch","nodes":["amp"]}]}},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"amp","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"amp","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"amp",0),edge("amp",0,"out",0),edge("in",1,"out",1)]},
            "lv2":[{"id":"amp","pluginUri":"http://plugin.org.uk/swh-plugins/amp",
                "controls":{"gain":-6},"assets":[],"requiredFeatures":[]}],
            "recall":{"tails":"cut"}}
    });
    let bundle =
        Bundle::from_parts(serde_json::to_vec(&manifest).unwrap(), Default::default()).unwrap();
    let revision = store.save(&bundle).unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: None,
        graph_worker: None,
        rig_worker: Some(executable),
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: None,
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let running = apply(
        &client,
        &url,
        json!({"kind":"start","settings":{
            "revision":revision,"stream":stream(),"recall":null
        }}),
    )
    .await;
    let bypass = json!({"kind":"bypass","node":"amp"});
    assert_eq!(control(&running, &bypass), 0.0);
    assert_eq!(running["control"]["scene"], "wet");
    assert_eq!(running["control"]["stomp_groups"][0]["enabled"], true);
    let with_midi = apply(&client, &url, json!({"kind":"midi","settings":{
        "input":"hw:Fixture,0,0","channel":1,"bindings":[],"branch_bindings":[],
        "parameter_bindings":[{"controller":41,"mode":"toggle","target":{"kind":"stomp_group","group":"amp-toggle"}}]
    }})).await;
    let set_protect = |on| {
        client
            .post(format!("{url}/protect"))
            .json(&json!({"on": on}))
            .send()
    };
    assert!(set_protect(true).await.unwrap().status().is_success());
    let action = json!({"kind":"stomp_group","command":{
        "session":with_midi["control"]["session"],"expected_revision":with_midi["control"]["revision"],"group":"amp-toggle"
    }});
    let toggled = apply(&client, &url, action.clone()).await;
    assert_eq!(toggled["control"]["stomp_scene"], "wet");
    assert_eq!(control(&toggled, &bypass), 1.0);
    assert_eq!(toggled["control"]["stomp_groups"][0]["enabled"], false);
    let current = get(&client, &url, "rig-audio").await;
    let stale = post(&client, &url, &current, action).await;
    assert_eq!(stale.status(), 409);
    let current = get(&client, &url, "rig-audio").await;
    assert_eq!(
        current["control"]["revision"],
        toggled["control"]["revision"]
    );
    assert_eq!(control(&current, &bypass), 1.0);
    assert!(set_protect(false).await.unwrap().status().is_success());
    let toggled_by_midi = apply(
        &client,
        &url,
        json!({"kind":"midi_test","message":{
            "kind":"control","channel":1,"controller":41,"value":127
        }}),
    )
    .await;
    assert_eq!(control(&toggled_by_midi, &bypass), 0.0);
    assert_eq!(
        toggled_by_midi["control"]["stomp_groups"][0]["enabled"],
        true
    );
    let wet_session = toggled_by_midi["control"]["session"].clone();
    let selected = apply(
        &client,
        &url,
        json!({"kind":"scene","command":{
            "session":wet_session,"expected_revision":toggled_by_midi["control"]["revision"],"scene":"dry"
        }}),
    )
    .await;
    assert_eq!(selected["control"]["session"], wet_session);
    assert_eq!(selected["control"]["scene"], "dry");
    assert_eq!(control(&selected, &bypass), 1.0);
    let restarted = apply(&client, &url, json!({"kind":"restart"})).await;
    assert_ne!(restarted["control"]["session"], wet_session);
    assert_eq!(restarted["control"]["scene"], "dry");
    assert_eq!(control(&restarted, &bypass), 1.0);
    assert_eq!(
        restarted["configured"]["midi"]["parameter_bindings"][0]["target"]["group"],
        "amp-toggle"
    );

    apply(
        &client,
        &url,
        json!({"kind":"save","name":"Saved scene bypass"}),
    )
    .await;
    let mut saved = None;
    for _ in 0..200 {
        let receipt = get(&client, &url, "rig-audio").await;
        if receipt["save"]["running"] == false {
            saved = Some(
                receipt["save"]["saved_revision"]
                    .as_str()
                    .expect("save failed")
                    .to_owned(),
            );
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let saved = saved.expect("save timed out");
    assert_eq!(
        store.read(&saved).unwrap().manifest().scenes().unwrap(),
        bundle.manifest().scenes().unwrap()
    );
    apply(&client, &url, json!({"kind":"stop"})).await;
    let reopened = apply(
        &client,
        &url,
        json!({"kind":"start","settings":{
            "revision":saved,"stream":stream(),"recall":null
        }}),
    )
    .await;
    assert_eq!(reopened["control"]["scene"], "dry");
    assert_eq!(control(&reopened, &bypass), 1.0);
    assert_eq!(reopened["control"]["stomp_groups"][0]["id"], "amp-toggle");
    assert_eq!(
        reopened["configured"]["midi"]["parameter_bindings"],
        json!([]),
        "an independent Save copy keeps the portable group and starts without a device mapping"
    );
    let copy_id = "0123456789abcdef0123456789abcdef";
    apply(
        &client,
        &url,
        json!({"kind":"copy_playing","name":"Independent encore","copy_id":copy_id}),
    )
    .await;
    let copy = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let snapshot = get(&client, &url, "rig-audio").await;
            let receipt = &snapshot["save"];
            assert_eq!(receipt["copy_id"], copy_id);
            assert_eq!(
                snapshot["control"]["session"],
                reopened["control"]["session"]
            );
            if receipt["running"] == false {
                assert_eq!(receipt["error"], Value::Null, "{receipt}");
                break receipt["saved_revision"].as_str().unwrap().to_owned();
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let copied = store.read(&copy).unwrap();
    assert_ne!(
        copied.manifest().id,
        store.read(&saved).unwrap().manifest().id
    );
    assert_eq!(
        copied.manifest().scenes().unwrap(),
        bundle.manifest().scenes().unwrap()
    );
    let versions = format!("presets/catalog/rig/{saved}/versions");
    let family = get(&client, &url, &versions).await;
    apply(&client,&url,json!({"kind":"save_version","name":"Sounding scene revision","target":{
        "first": saved, "expected_content": saved, "expected_revision":family["catalog_revision"],
        "version":"main","request_id":"mixed-scene-save"}
    })).await;
    let mut published = None;
    for _ in 0..200 {
        let state = get(&client, &url, "rig-audio").await;
        if state["save"]["running"] == false {
            assert_eq!(state["save"]["error"], Value::Null, "{state}");
            assert_eq!(state["control"]["session"], reopened["control"]["session"]);
            published = state["save"]["saved_revision"].as_str().map(str::to_owned);
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let published = published.expect("named mixed Save timed out");
    assert_eq!(
        get(&client, &url, &versions).await["preset"]["versions"][0]["content"],
        published
    );
    assert_eq!(
        store.read(&published).unwrap().manifest().name,
        "Sounding scene revision"
    );
    let gain = json!({"kind":"lv2","node":"amp","symbol":"gain"});
    let before_edit = get(&client, &url, "rig-audio").await;
    let edited = apply(&client, &url, set(&before_edit, gain.clone(), -15.0)).await;
    assert_eq!(control(&edited, &gain), -15.0);
    assert_eq!(
        post(
            &client,
            &url,
            &before_edit,
            json!({"kind":"discard_changes"})
        )
        .await
        .status(),
        409
    );
    let restored = apply(&client, &url, json!({"kind":"discard_changes"})).await;
    assert_eq!(control(&restored, &gain), -6.0);
    assert_eq!(control(&restored, &bypass), 1.0);
    assert_eq!(restored["control"]["modified"], false);
    assert_eq!(restored["control"]["source_revision"], saved);
    assert_ne!(restored["control"]["session"], edited["control"]["session"]);
    assert_eq!(restored["configured"]["midi"], edited["configured"]["midi"]);
    let mut revision_manifest = manifest;
    revision_manifest["name"] = json!("Same rig with a changed name");
    let revised = client
        .post(format!("{url}/presets/rigs"))
        .json(&json!({
            "manifest_json": revision_manifest.to_string(),
            "resources": {},
            "source": {"kind":"rig","id":revision}
        }))
        .send()
        .await
        .unwrap();
    assert!(revised.status().is_success(), "{revised:?}");
    let revised = revised.json::<Value>().await.unwrap();
    let map = get(&client, &url, "midi/map").await;
    let mappings = map["entries"].as_array().unwrap();
    assert_eq!(mappings.len(), 1);
    assert_eq!(mappings[0]["entry"]["id"], revised["revision"]);
    assert_eq!(
        mappings[0]["parameter_bindings"][0]["target"]["group"],
        "amp-toggle"
    );
    shutdown.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(5), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "pnpm native:check supplies the actual Linux mixed worker and embedded fixture"]
async fn mixed_worker_http_controls_export_restart_exclusion_and_recovery() {
    let _worker_test = WORKER_TEST.lock().await;
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
    let config = Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: Some(executable.clone()),
        graph_worker: Some(executable.clone()),
        rig_worker: Some(executable.clone()),
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: None,
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
    let host_controls = s["control"]["controls"].clone();
    let host_modified = s["control"]["modified"].clone();
    let worker_before = pids(&executable);
    for command in [
        json!({"kind":"hear_yourself","enabled":false}),
        json!({"kind":"test_tone"}),
        json!({"kind":"stop_test_tone"}),
    ] {
        s = apply(&c, &url, json!({"kind":"host_utility","command":command})).await;
        assert_eq!(s["configured"]["stream"]["hear_yourself"], false);
        assert_eq!(s["control"]["controls"], host_controls);
        assert_eq!(s["control"]["modified"], host_modified);
        assert_eq!(pids(&executable), worker_before);
    }
    s = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(s["configured"]["stream"]["hear_yourself"], false);
    s = apply(
        &c,
        &url,
        json!({"kind":"host_utility","command":{"kind":"hear_yourself","enabled":true}}),
    )
    .await;
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
    // The real worker admits structural transactions before Save, preserving peer LV2 state.
    let original_layout = s["control"]["authoring"][0]["status"]["layout"].clone();
    let block = original_layout["left"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["insert"] == false)
        .unwrap()["id"]
        .clone();
    let author = |s: &Value, action: Value| json!({"kind":"authoring","command":{"session":s["control"]["session"],"expected_revision":s["control"]["revision"],"node":"tone","action":action}});
    s = apply(
        &c,
        &url,
        author(
            &s,
            json!({"kind":"utility","command":{"kind":"tuner","enabled":true}}),
        ),
    )
    .await;
    let tuner_revision = s["revision"].clone();
    let tuner_control = s["control"]["revision"].clone();
    tokio::time::sleep(Duration::from_millis(450)).await;
    let polled = get(&c, &url, "rig-audio").await;
    assert_eq!(polled["revision"], tuner_revision);
    assert_eq!(polled["control"]["revision"], tuner_control);
    assert!(polled["control"]["authoring"][0]["status"]["tools"]["tuner"].is_object());
    s = apply(
        &c,
        &url,
        author(
            &s,
            json!({"kind":"utility","command":{"kind":"tuner","enabled":false}}),
        ),
    )
    .await;
    let before_copy = s["control"]["working"].clone();
    s = apply(
        &c,
        &url,
        author(&s, json!({"kind":"copy","block_id":block})),
    )
    .await;
    assert_eq!(s["control"]["working"], before_copy);
    assert_eq!(s["control"]["authoring"][0]["status"]["can_paste"], true);
    s = apply(
        &c,
        &url,
        author(
            &s,
            json!({"kind":"edit","edit":{"kind":"paste","lane":"left","index":0}}),
        ),
    )
    .await;
    assert_ne!(
        s["control"]["authoring"][0]["status"]["layout"],
        original_layout
    );
    s = apply(&c, &url, author(&s, json!({"kind":"undo"}))).await;
    assert_eq!(
        s["control"]["authoring"][0]["status"]["layout"],
        original_layout
    );
    let duplicate = author(
        &s,
        json!({"kind":"edit","edit":{"kind":"duplicate","block_id":block,"lane":"left","index":0}}),
    );
    s = apply(&c, &url, duplicate.clone()).await;
    let expanded = s["control"]["authoring"][0]["status"]["layout"].clone();
    assert_ne!(expanded, original_layout);
    assert_eq!(s["control"]["working"].as_array().unwrap().len(), 1);
    assert_eq!(post(&c, &url, &s, duplicate).await.status(), 409);
    s = apply(&c, &url, author(&s, json!({"kind":"undo"}))).await;
    assert_eq!(
        s["control"]["authoring"][0]["status"]["layout"],
        original_layout
    );
    s = apply(&c, &url, author(&s, json!({"kind":"redo"}))).await;
    assert_eq!(s["control"]["authoring"][0]["status"]["layout"], expanded);
    assert_eq!(control(&s, &gain), -3.0);
    // Prepared settings rebuild graph compensation and restore all confirmed peer controls.
    for (parameter, value) in [
        ("osEnabled", 0.0),
        ("osFactor", 0.5),
        ("pitchEnabled", 0.0),
        ("pitchWindow", 0.6),
        ("inputCalibrationLevel", 0.4),
        ("calibrateInput", 1.0),
        ("targetLoudness", 0.3),
    ] {
        s = apply(
            &c,
            &url,
            author(
                &s,
                json!({"kind":"parameter","parameter":parameter,"value":value}),
            ),
        )
        .await;
        assert_eq!(s["phase"], "starting");
        s = phase(&c, &url, "running").await;
        let setting = s["control"]["authoring"][0]["status"]["settings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["target"] == parameter)
            .unwrap();
        let expected = if parameter == "pitchWindow" {
            2.0 / 3.0
        } else {
            value
        };
        assert!(
            (setting["value"].as_f64().unwrap() - expected).abs() < 1e-5,
            "{parameter}: {setting}"
        );
        assert_eq!(control(&s, &gain), -3.0);
        assert!((control(&s, &native) - 0.6).abs() < 1e-5);
        assert_eq!(s["control"]["authoring"][0]["status"]["layout"], expanded);
    }
    let size = s["control"]["authoring"][0]["status"]["settings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["target"].as_str().unwrap().ends_with(":slimSize"))
        .expect("A2 size capability")["target"]
        .clone();
    s = apply(
        &c,
        &url,
        author(&s, json!({"kind":"parameter","parameter":size,"value":0.6})),
    )
    .await;
    assert_eq!(s["phase"], "starting");
    s = phase(&c, &url, "running").await;
    assert!(
        (s["control"]["authoring"][0]["status"]["settings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["target"] == size)
            .unwrap()["value"]
            .as_f64()
            .unwrap()
            - 0.6)
            .abs()
            < 1e-5
    );
    // Daemon-owned polling must finish alignment with no browser utility polls.
    let mono = s["control"]["authoring"][0]["status"]["layout"].clone();
    s = apply(
        &c,
        &url,
        author(
            &s,
            json!({"kind":"edit","edit":{"kind":"stereo","enabled":true}}),
        ),
    )
    .await;
    s = apply(
        &c,
        &url,
        author(&s, json!({"kind":"utility","command":{"kind":"align"}})),
    )
    .await;
    let frames = s["processed_frames"].as_u64().unwrap();
    let mut measured = false;
    for _ in 0..100 {
        s = get(&c, &url, "rig-audio").await;
        let phase = s["control"]["authoring"][0]["status"]["tools"]["alignment"]["state"]
            .as_str()
            .unwrap();
        if phase == "done" || phase == "timeout" {
            measured = phase == "done";
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        matches!(
            s["control"]["authoring"][0]["status"]["tools"]["alignment"]["state"].as_str(),
            Some("done" | "timeout")
        ),
        "{s}"
    );
    assert!(s["processed_frames"].as_u64().unwrap() > frames);
    if measured {
        s = apply(&c, &url, author(&s, json!({"kind":"undo"}))).await;
    }
    s = apply(&c, &url, author(&s, json!({"kind":"undo"}))).await;
    assert_eq!(s["control"]["authoring"][0]["status"]["layout"], mono);
    let row = s["control"]["eq"][0].clone();
    let eq_action = json!({"kind":"eq", "command": {
        "session":s["control"]["session"], "expected_revision":s["control"]["revision"],
        "node":row["node"], "block_id":row["blocks"][0]["block_id"],
        "edit":{"kind":"pre", "value":!row["blocks"][0]["eq"]["pre"].as_bool().unwrap()}
    }});
    s = apply(&c, &url, eq_action).await;
    let confirmed_eq = s["control"]["eq"].clone();
    assert_ne!(confirmed_eq[0], row);
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
    let saved_settings = store
        .read(&saved)
        .unwrap()
        .manifest()
        .native_settings()
        .unwrap()
        .unwrap();
    assert!(
        saved_settings
            .instances
            .values()
            .all(|s| s.parameters.len() == 7
                && s.parameters.keys().all(|id| !id.starts_with("block:"))),
        "tone-local model size must not pollute instance settings"
    );

    assert_eq!(control(&get(&c, &url, "rig-audio").await, &gain), -9.0);
    let before_frames = s["processed_frames"].as_u64().unwrap();
    let s = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(control(&s, &gain), -9.0);
    assert_eq!(s["control"]["eq"], confirmed_eq);
    assert!(
        (s["control"]["authoring"][0]["status"]["settings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["target"] == size)
            .unwrap()["value"]
            .as_f64()
            .unwrap()
            - 0.6)
            .abs()
            < 1e-5,
        "hybrid model size survives restart"
    );

    assert!((control(&s, &native) - 0.6).abs() < 1e-5);
    // Rate/buffer changes reconstruct the confirmed unsaved controls.
    let mut updated_stream = stream();
    updated_stream["input"]["sample_rate"] = json!(44100);
    updated_stream["output"]["sample_rate"] = json!(44100);
    updated_stream["input"]["period_frames"] = json!(256);
    updated_stream["output"]["period_frames"] = json!(256);
    let s = apply(
        &c,
        &url,
        json!({"kind":"reconfigure","stream":updated_stream}),
    )
    .await;
    assert_eq!(s["configured"]["stream"], updated_stream);
    assert!(s["control"]["latency_frames"].as_u64().unwrap() > 0);
    assert_eq!(control(&s, &gain), -9.0);
    assert!((control(&s, &native) - 0.6).abs() < 1e-5);
    assert_eq!(pids(&executable).len(), 1);
    let stable_session = s["control"]["session"].clone();
    let mut invalid = updated_stream.clone();
    invalid["input"]["period_frames"] = json!(129);
    invalid["output"]["period_frames"] = json!(129);
    assert_eq!(
        post(&c, &url, &s, json!({"kind":"reconfigure","stream":invalid}))
            .await
            .status(),
        409
    );
    assert_eq!(
        get(&c, &url, "rig-audio").await["control"]["session"],
        stable_session
    );
    // A valid but unavailable device fails in preparation and rolls back once.
    let mut unavailable = updated_stream.clone();
    unavailable["input"]["endpoint"] = json!("hw:CARD=MissingDevice,DEV=0");
    unavailable["output"]["endpoint"] = json!("hw:CARD=MissingDevice,DEV=0");
    let restored = apply(&c, &url, json!({"kind":"reconfigure","stream":unavailable})).await;
    assert_eq!(restored["configured"]["stream"], updated_stream);
    assert_eq!(restored["control"]["eq"], confirmed_eq);
    assert_eq!(
        restored["control"]["latency_frames"],
        s["control"]["latency_frames"]
    );
    assert_eq!(control(&restored, &gain), -9.0);
    assert!((control(&restored, &native) - 0.6).abs() < 1e-5);
    assert!(
        restored["error"]
            .as_str()
            .unwrap()
            .contains("previous settings restored")
    );
    assert_eq!(pids(&executable).len(), 1);
    // A deliberate restart clears the old warning, retaining the recovered rig.
    apply(&c, &url, json!({"kind":"restart"})).await;
    // Monitoring is decimated independently of the lifecycle response. Require
    // a newly sampled status, not the prior recovered session's warning.
    let monitor_sequence = get(&c, &url, "monitor").await["sequence"].as_u64().unwrap();
    let mut monitored = false;
    for _ in 0..100 {
        let m = get(&c, &url, "monitor").await;
        if m["source"] == "Mixed rig" && m["sequence"].as_u64().unwrap() > monitor_sequence {
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
    // The monitor sends lifecycle invalidations immediately, not every meter sample.
    // This is the same stream used to bypass BOOX's five-second polling interval.
    let mut events = c.get(format!("{url}/monitor/events")).send().await.unwrap();
    assert!(events.status().is_success());
    assert!(
        events.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/event-stream")
    );
    let first = events.chunk().await.unwrap().unwrap();
    assert!(
        std::str::from_utf8(&first)
            .unwrap()
            .contains("event: lifecycle")
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(1100), events.chunk())
            .await
            .is_err(),
        "steady meters must not wake e-paper"
    );
    apply(&c, &url, json!({"kind":"stop"})).await;
    let changed = tokio::time::timeout(Duration::from_millis(750), events.chunk())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        std::str::from_utf8(&changed)
            .unwrap()
            .contains("event: lifecycle")
    );
    let monitor = get(&c, &url, "monitor").await;
    assert!(matches!(
        monitor["rig_phase"].as_str(),
        Some("stopping" | "stopped")
    ));
    assert!(monitor["audio"].is_null());
    drop(events);
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
    // A lost running session restarts itself once the device is available again.
    let resumed = phase(&c, &url, "running").await;
    assert_eq!(resumed["device_owned"], true);
    assert_eq!(pids(&executable).len(), 1);
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
    // A checkpoint failure must not stop PCM or invalidate confirmed commands.
    apply(&c, &url, json!({"kind":"stop"})).await;
    let recovery_path = root.join("presets/last-rig-session.json");
    let recovery_tmp = recovery_path.with_extension("tmp");
    let previous_bytes = std::fs::read(&recovery_path).unwrap();
    std::fs::create_dir(&recovery_tmp).unwrap();
    let state = apply(&c, &url, json!({"kind":"restart"})).await;
    let edited = apply(&c, &url, set(&state, native.clone(), 0.37)).await;
    let edited = apply(&c, &url, set(&edited, gain.clone(), -11.0)).await;
    let mut observed = false;
    for _ in 0..100 {
        let state = get(&c, &url, "rig-audio").await;
        if state["recovery_error"]
            .as_str()
            .is_some_and(|e| e.contains("could not be saved"))
        {
            assert_eq!(state["phase"], "running");
            assert_eq!(state["revision"], edited["revision"]);
            assert_eq!(state["control"], edited["control"]);
            assert!(
                state["processed_frames"].as_u64().unwrap()
                    > edited["processed_frames"].as_u64().unwrap()
            );
            observed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(observed, "checkpoint failure must be reported");
    assert_eq!(std::fs::read(&recovery_path).unwrap(), previous_bytes);
    std::fs::remove_dir(&recovery_tmp).unwrap();
    let mut repaired = false;
    for _ in 0..140 {
        let state = get(&c, &url, "rig-audio").await;
        if state["recovery_error"].is_null() {
            assert_eq!(state["revision"], edited["revision"]);
            assert_eq!(state["control"], edited["control"]);
            repaired = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(repaired, "checkpoint retry did not recover");
    // Shutdown flushes another unsaved edit before the two-second coalescing timer.
    let last = apply(&c, &url, set(&edited, native.clone(), 0.43)).await;
    let confirmed = last["configured"].clone();
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
    let checkpoint: Value =
        serde_json::from_slice(&std::fs::read(&recovery_path).unwrap()).unwrap();
    assert_eq!(checkpoint["settings"], confirmed);
    // A new daemon restores metadata but never starts unrequested audio.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let recovered = get(&c, &url, "rig-audio").await;
    assert_eq!(recovered["phase"], "stopped");
    assert_eq!(recovered["device_owned"], false);
    assert!(recovered["control"].is_null());
    assert!(recovered["recovery_error"].is_null());
    assert_eq!(recovered["configured"], confirmed);
    assert!(pids(&executable).is_empty());
    let resumed = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(control(&resumed, &gain), -11.0);
    assert!((control(&resumed, &native) - 0.43).abs() < 1e-5);
    apply(&c, &url, json!({"kind":"stop"})).await;
    let durable = std::fs::read(&recovery_path).unwrap();
    // A valid declaration with an absent bundle must not replace recovery.
    let mut missing = confirmed.clone();
    missing["revision"] = json!("f".repeat(64));
    missing["recall"] = Value::Null;
    let state = get(&c, &url, "rig-audio").await;
    assert_eq!(
        post(&c, &url, &state, json!({"kind":"start","settings":missing}))
            .await
            .status(),
        200
    );
    let failed = phase(&c, &url, "failed").await;
    assert_eq!(failed["configured"], confirmed);
    assert_eq!(std::fs::read(&recovery_path).unwrap(), durable);
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    assert_eq!(std::fs::read(&recovery_path).unwrap(), durable);
    // Failed preparation did not poison the next daemon's explicit Resume.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    assert_eq!(get(&c, &url, "rig-audio").await["configured"], confirmed);
    let resumed = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(control(&resumed, &gain), -11.0);
    assert!((control(&resumed, &native) - 0.43).abs() < 1e-5);
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    // A corrupt checkpoint is an observable warning, not a daemon/library outage.
    std::fs::write(&recovery_path, b"interrupted record").unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let invalid = get(&c, &url, "rig-audio").await;
    assert_eq!(invalid["phase"], "stopped");
    assert_eq!(invalid["device_owned"], false);
    assert!(invalid["configured"].is_null());
    assert!(
        invalid["recovery_error"]
            .as_str()
            .unwrap()
            .contains("Invalid mixed recovery")
    );
    get(&c, &url, "presets/rigs").await;
    apply(&c, &url, json!({"kind":"start","settings":confirmed})).await;
    let repaired = apply(&c, &url, json!({"kind":"stop"})).await;
    assert!(repaired["recovery_error"].is_null());
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    // An explicit boot snapshot is independent from the later recovery checkpoint.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let state = get(&c, &url, "rig-audio").await;
    assert_eq!(
        post(&c, &url, &state, json!({"kind":"set_boot","enabled":true}))
            .await
            .status(),
        409
    );
    let state = apply(&c, &url, json!({"kind":"restart"})).await;
    let boot_path = root.join("presets/boot-audio.json");
    std::fs::create_dir(boot_path.with_extension("tmp")).unwrap();
    assert_eq!(
        post(&c, &url, &state, json!({"kind":"set_boot","enabled":true}))
            .await
            .status(),
        409
    );
    let running = get(&c, &url, "rig-audio").await;
    assert_eq!(running["phase"], "running");
    assert_eq!(running["control"], state["control"]);
    assert_eq!(running["start_on_boot"], false);
    std::fs::remove_dir(boot_path.with_extension("tmp")).unwrap();
    let selected = apply(&c, &url, json!({"kind":"set_boot","enabled":true})).await;
    assert_eq!(selected["start_on_boot"], true);
    assert_eq!(selected["control"], state["control"]);
    let boot_bytes = std::fs::read(&boot_path).unwrap();
    // The startup preset cannot be deleted while it is the startup sound (7.25).
    let startup = selected["configured"]["revision"].as_str().unwrap();
    let preview: serde_json::Value = c
        .get(format!("{url}/presets/removal?kind=rig&id={startup}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        preview["blocked"]
            .as_str()
            .is_some_and(|reason| reason.contains("at startup")),
        "{preview}"
    );
    let other = get(&c, &url, "audio").await;
    assert_eq!(other["start_on_boot"], false);
    let response=c.post(format!("{url}/audio")).json(&json!({"session":other["session"],"expected_revision":other["revision"],"action":{"kind":"set_boot","enabled":false}})).send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(std::fs::read(&boot_path).unwrap(), boot_bytes);
    apply(&c, &url, set(&selected, native.clone(), 0.67)).await;
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let booted = phase(&c, &url, "running").await;
    assert_eq!(booted["start_on_boot"], true);
    assert_eq!(booted["control"]["eq"], selected["control"]["eq"]);
    assert_eq!(control(&booted, &gain), -11.0);
    assert!((control(&booted, &native) - 0.43).abs() < 1e-5);
    assert_eq!(pids(&executable).len(), 1);
    let other = get(&c, &url, "audio").await;
    assert_eq!(other["phase"], "stopped");
    assert_eq!(other["device_owned"], false);
    assert_eq!(other["start_on_boot"], false);
    let disabled = apply(&c, &url, json!({"kind":"set_boot","enabled":false})).await;
    assert_eq!(disabled["phase"], "running");
    assert_eq!(disabled["start_on_boot"], false);
    assert_eq!(disabled["control"], booted["control"]);
    assert!(!boot_path.exists());
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    // Disabled boot is metadata-only again, with no stray process/device permit.
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config.clone()
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let state = get(&c, &url, "rig-audio").await;
    assert_eq!(state["phase"], "stopped");
    assert_eq!(state["start_on_boot"], false);
    assert!(pids(&executable).is_empty());
    // Prepare both sessions before opening one continuous PCM owner. Switching
    // changes neither the worker PID nor transport progress, and each bank keeps edits.
    let first = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{"revision":revision,"stream":stream(),"recall":null,
        "prepared":[{"revision":saved,"recall":null}]}}),
    )
    .await;
    assert_eq!(first["control"]["prepared"].as_array().unwrap().len(), 1);
    let resident_pid = pids(&executable);
    let first = apply(&c, &url, set(&first, native.clone(), 0.39)).await;
    let first_session = first["control"]["session"].clone();
    let first = apply(
        &c,
        &url,
        json!({"kind":"save","name":"Resident source copy"}),
    )
    .await;
    let switch = |s: &Value, target: &str| {
        json!({"kind":"switch","command":{"session":s["control"]["session"],
        "expected_revision":s["control"]["revision"],"revision":target,"fade_frames":480}})
    };
    let second = apply(&c, &url, switch(&first, &saved)).await;
    assert_eq!(second["phase"], "running");
    assert_eq!(second["configured"]["revision"], saved);
    assert_ne!(second["control"]["session"], first_session);
    assert!(
        second["processed_frames"].as_u64().unwrap() > first["processed_frames"].as_u64().unwrap()
    );
    assert!(pids(&executable).contains(&resident_pid[0]));
    for _ in 0..200 {
        if get(&c, &url, "rig-audio").await["save"]["running"] == false {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let receipt = get(&c, &url, "rig-audio").await;
    assert_eq!(receipt["save"]["source_session"], first_session);
    assert_eq!(receipt["save"]["running"], false);
    assert!(receipt["save"]["saved_revision"].as_str().is_some());
    assert!(receipt["save"]["error"].is_null());
    assert_eq!(pids(&executable), resident_pid);
    let second = apply(&c, &url, set(&second, gain.clone(), -9.0)).await;
    let returned = apply(&c, &url, switch(&second, &revision)).await;
    assert_eq!(returned["control"]["session"], first_session);
    assert!((control(&returned, &native) - 0.39).abs() < 1e-5);
    assert_eq!(pids(&executable), resident_pid);
    let mut stale = switch(&returned, &saved);
    stale["command"]["expected_revision"] =
        json!(returned["control"]["revision"].as_u64().unwrap() + 1);
    assert_eq!(post(&c, &url, &returned, stale).await.status(), 409);
    let unchanged = get(&c, &url, "rig-audio").await;
    assert_eq!(unchanged["control"]["session"], first_session);
    assert_eq!(unchanged["phase"], "running");
    assert_eq!(pids(&executable), resident_pid);
    let restored = apply(&c, &url, json!({"kind":"restart"})).await;
    assert!((control(&restored, &native) - 0.39).abs() < 1e-5);
    let second = apply(&c, &url, switch(&restored, &saved)).await;
    assert_eq!(control(&second, &gain), -9.0);
    assert_eq!(second["configured"]["prepared"][0]["revision"], revision);
    assert_eq!(pids(&executable).len(), 1);
    // Hybrid model editing uses the same verified cache as the standalone path.
    use sha2::{Digest, Sha256};
    let model_bytes = std::fs::read(
        std::env::var_os("OXIDAL_TONE3000_TEST_MODEL").expect("native model fixture"),
    )
    .unwrap();
    let asset = oxidal_presets::ModelAsset {
        schema: 1,
        tone_id: 2701,
        model_id: 2901,
        title: "HTTP hybrid NAM".into(),
        name: "NAM fixture".into(),
        format: "nam".into(),
        sha256: format!("{:x}", Sha256::digest(&model_bytes)),
        tone: json!({"id":2701,"title":"HTTP hybrid NAM","format":"nam","gear":"amp","models":[{"id":2901,"name":"NAM fixture","model_url":"oxidal-model://fixture/model.nam"}]}),
    };
    let asset = oxidal_presets::ModelStore::new(root.join("presets/audition-models"))
        .stage(&asset, &model_bytes)
        .unwrap();
    let node = second["control"]["eq"][0]["node"].as_str().unwrap();
    let target = second["control"]["eq"][0]["blocks"][0]["block_id"]
        .as_str()
        .unwrap();
    let before_models = second["control"].clone();
    let pid = pids(&executable);
    let loading=apply(&c,&url,json!({"kind":"model","command":{"session":second["control"]["session"],"expected_revision":second["control"]["revision"],
        "node":node,"operation":{"kind":"prepare","assignment":{"target":target,"asset":asset}}}})).await;
    assert_eq!(loading["phase"], "running");
    let mut modeled = loading;
    for _ in 0..200 {
        if modeled["control"]["model_change"]["progress"]["phase"] == "applied" {
            break;
        }
        assert_eq!(modeled["phase"], "running");
        assert_ne!(
            modeled["control"]["model_change"]["progress"]["phase"], "failed",
            "{modeled}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
        modeled = get(&c, &url, "rig-audio").await;
    }
    assert_eq!(
        modeled["control"]["model_change"]["progress"]["phase"],
        "applied"
    );
    assert_eq!(
        modeled["control"]["models"][0]["assignments"][0]["asset"],
        asset
    );
    assert_eq!(modeled["control"]["eq"], before_models["eq"]);
    assert_eq!(control(&modeled, &gain), -9.0);
    assert_eq!(pids(&executable), pid);
    let restored = apply(&c, &url, json!({"kind":"restart"})).await;
    assert_eq!(restored["control"]["models"], modeled["control"]["models"]);
    assert_eq!(restored["control"]["eq"], modeled["control"]["eq"]);
    let selected = apply(&c, &url, json!({"kind":"set_boot","enabled":true})).await;
    assert_eq!(selected["start_on_boot"], true);
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        shutdown: Some(signal),
        ..config
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let booted = phase(&c, &url, "running").await;
    assert_eq!(booted["start_on_boot"], true);
    assert_eq!(booted["control"]["models"], modeled["control"]["models"]);
    assert_eq!(booted["control"]["eq"], modeled["control"]["eq"]);
    assert_eq!(control(&booted, &gain), -9.0);
    let saving = apply(
        &c,
        &url,
        json!({"kind":"save","name":"Offline hybrid model"}),
    )
    .await;
    let mut exported = saving;
    for _ in 0..400 {
        if exported["save"]["running"] == false {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
        exported = get(&c, &url, "rig-audio").await;
    }
    let saved_model = exported["save"]["saved_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(exported["save"]["error"].is_null(), "{exported}");
    apply(&c, &url, json!({"kind":"set_boot","enabled":false})).await;
    apply(&c, &url, json!({"kind":"stop"})).await;
    std::fs::remove_dir_all(root.join("presets/audition-models")).unwrap();
    let offline = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{"revision":saved_model,"stream":stream(),"recall":null}}),
    )
    .await;
    assert!(offline["control"]["models"].as_array().unwrap().is_empty());
    assert_eq!(offline["control"]["eq"], modeled["control"]["eq"]);
    assert_eq!(control(&offline, &gain), -9.0);
    assert!(
        offline["control"]["controls"]
            .to_string()
            .contains("HTTP hybrid NAM")
    );
    assert_eq!(pids(&executable).len(), 1);
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires a real Linux Mixed null worker and warm scene5 bundle"]
async fn warm_native_candidate_refusal_keeps_pcm_and_valid_edit_rearms() {
    let _worker_test = WORKER_TEST.lock().await;
    let executable = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    assert_eq!(std::env::var("OXIDAL_RIG_QUALIFY_NULL").unwrap(), "1");
    let source = BundleStore::new(std::env::var_os("OXIDAL_TEST_BUNDLE_ROOT").unwrap().into());
    let revision =
        std::fs::read_to_string(std::env::var_os("OXIDAL_TEST_RIG_REVISION_FILE").unwrap())
            .unwrap();
    let bundle = source.read(revision.trim()).unwrap();
    let root = std::env::temp_dir().join(format!("oxidal-warm-rearm-http-{}", std::process::id()));
    let store = BundleStore::new(root.join("presets/bundles"));
    store.save(&bundle).unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: None,
        graph_worker: None,
        rig_worker: Some(executable.clone()),
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: None,
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let c = Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .unwrap();
    let legacy = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{
            "revision":bundle.revision(),"stream":stream(),"recall":null
        }}),
    )
    .await;
    let node = legacy["control"]["authoring"][0]["node"].as_str().unwrap();
    let row = legacy["control"]["controls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| {
            row["target"]["node"] == node
                && row["target"]["parameter"]
                    .as_str()
                    .is_some_and(|p| p.starts_with("block:") && p.ends_with(":enabled"))
        })
        .unwrap();
    let block = row["target"]["parameter"]
        .as_str()
        .unwrap()
        .strip_prefix("block:")
        .unwrap()
        .strip_suffix(":enabled")
        .unwrap();
    let expected_oversampling = if legacy["control"]["authoring"][0]["status"]["settings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|setting| setting["target"] == "osEnabled" && setting["value"] == 1.0)
    {
        0.0
    } else {
        1.0
    };
    apply(&c, &url, json!({"kind":"stop"})).await;
    let mut manifest = serde_json::to_value(bundle.manifest()).unwrap();
    let key = oxidal_presets::manifest::SCENES_INNER_BYPASS_EXTENSION;
    manifest["extensions"]
        .as_object_mut()
        .unwrap()
        .retain(|name, _| !name.starts_with("urn:oxidal:scenes:"));
    let extensions = manifest["requiredExtensions"].as_array_mut().unwrap();
    extensions.retain(|name| !name.as_str().unwrap().starts_with("urn:oxidal:scenes:"));
    extensions.push(json!(key));
    let scene = |id, off| {
        json!({"id":id,"name":id,"gains":[],
        "native_bypass":[{"node":node,"block":block,"value":off}]})
    };
    manifest["extensions"][key] = json!({"fade_ms":25,"initial_scene":"dry",
        "scenes":[scene("dry",true),scene("wet",false)]});
    let bundle = oxidal_presets::Bundle::from_parts(
        serde_json::to_vec(&manifest).unwrap(),
        bundle
            .manifest()
            .resources
            .iter()
            .map(|r| (r.id.clone(), bundle.resource(&r.id).unwrap().to_owned()))
            .collect(),
    )
    .unwrap();
    let revision = store.save(&bundle).unwrap();
    let before = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{
            "revision":revision,"stream":stream(),"recall":null
        }}),
    )
    .await;
    let armed = before["control"]["native_bypass_armed"].clone();
    let first = &armed.as_array().unwrap()[0];
    let author = |state: &Value, action: Value| {
        json!({"kind":"authoring","command":{
            "node":first["node"],"session":state["control"]["session"],
            "expected_revision":state["control"]["revision"],"action":action
        }})
    };
    let old_pid = pids(&executable);
    assert_eq!(old_pid.len(), 1);
    let rejected = post(
        &c,
        &url,
        &before,
        author(&before, json!({"kind":"remove","block_id":first["block"]})),
    )
    .await;
    assert_eq!(rejected.status(), 409);
    let still_running = get(&c, &url, "rig-audio").await;
    assert_eq!(pids(&executable), old_pid);
    assert_eq!(
        still_running["control"]["session"],
        before["control"]["session"]
    );
    assert_eq!(
        still_running["control"]["revision"],
        before["control"]["revision"]
    );
    assert_eq!(
        still_running["control"]["working"],
        before["control"]["working"]
    );
    assert_eq!(still_running["control"]["native_bypass_armed"], armed);

    let accepted = apply(
        &c,
        &url,
        author(
            &still_running,
            json!({"kind":"parameter","parameter":"osEnabled","value":expected_oversampling}),
        ),
    )
    .await;
    assert_eq!(accepted["phase"], "starting");
    let rearmed = phase(&c, &url, "running").await;
    assert_ne!(rearmed["control"]["session"], before["control"]["session"]);
    assert_eq!(rearmed["control"]["native_bypass_armed"], armed);
    assert_eq!(
        rearmed["control"]["native_bypass_defaults"],
        before["control"]["native_bypass_defaults"]
    );
    assert_eq!(rearmed["control"]["working"].as_array().unwrap().len(), 1);
    let settings = rearmed["control"]["authoring"][0]["status"]["settings"]
        .as_array()
        .unwrap();
    assert!(settings.iter().any(
        |setting| setting["target"] == "osEnabled" && setting["value"] == expected_oversampling
    ));
    let selected = apply(&c, &url, json!({"kind":"scene","command":{
        "session":rearmed["control"]["session"],"expected_revision":rearmed["control"]["revision"],"scene":"wet",
    }})).await;
    assert_eq!(selected["control"]["scene"], "wet");

    shutdown.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(8), stopped.wait())
        .await
        .unwrap()
        .unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "uses a real qualification Mixed worker, null PCM and the maintained LV2 tail fixture"]
async fn repeated_set_entry_confirms_its_scene_before_replacing_the_playing_rig() {
    use oxidal_presets::{
        Bundle,
        manifest::{GAIN_EXTENSION, SCENES_CONTROLS_EXTENSION},
    };
    let _worker_test = WORKER_TEST.lock().await;
    let executable = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    assert_eq!(std::env::var("OXIDAL_RIG_QUALIFY_NULL").unwrap(), "1");
    let root =
        std::env::temp_dir().join(format!("oxidal-occurrence-recall-{}", std::process::id()));
    let store = BundleStore::new(root.join("presets/bundles"));
    let edge = |a, ap, b, bp| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let save = |id: &str, name: &str, alternate_gain: u8| {
        let scene = |id, gain, effect_gain| {
            json!({"id":id,"name":id,
            "gains":[{"node":"level","port":0,"value":gain}],
            "controls":[{"node":"fx","symbol":"gain","value":effect_gain}]})
        };
        let manifest = json!({
            "format":"oxidal.preset","formatVersion":1,"id":id,"name":name,
            "tone3000":{"instances":[]},"resources":[],
            "requiredExtensions":[GAIN_EXTENSION,SCENES_CONTROLS_EXTENSION],
            "extensions":{GAIN_EXTENSION:{},SCENES_CONTROLS_EXTENSION:{"fade_ms":30,
                "scenes":[scene("a",1.0,1),scene("b",0.5,alternate_gain)]}},
            "oxidal":{"graph":{"nodes":[
                {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
                {"id":"fx","kind":"lv2","instance":"fx","bypassed":false,"audioInputs":2,"audioOutputs":2},
                {"id":"level","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[1]},
                {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}
            ],"edges":[edge("in",0,"fx",0),edge("fx",0,"level",0),edge("level",0,"out",0),edge("in",1,"fx",1),edge("fx",1,"out",1)]},
            "lv2":[{"id":"fx","pluginUri":"urn:oxidal:test:sleep-tail","controls":{"gain":1,"feedback":0},
                "assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}
        });
        let bundle =
            Bundle::from_parts(serde_json::to_vec(&manifest).unwrap(), Default::default()).unwrap();
        store.save(&bundle).unwrap()
    };
    let old = save("68448a6d-0168-4fc8-b337-c12959165271", "Sounding", 1);
    let prepared = save("68448a6d-0168-4fc8-b337-c12959165272", "Repeated", 1);
    // Gain 2 is accepted as a scalar. Its first DSP block produces NaN,
    // which must fail the candidate while it is still inaudible.
    let bad = save(
        "68448a6d-0168-4fc8-b337-c12959165273",
        "Prepared refusal",
        2,
    );
    let cold_bad = save("68448a6d-0168-4fc8-b337-c12959165274", "Cold refusal", 2);
    let cold_ok = save("68448a6d-0168-4fc8-b337-c12959165275", "Cold success", 1);
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        simulator: false,
        native_worker: None,
        audio_worker: None,
        graph_worker: None,
        rig_worker: Some(executable.clone()),
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: None,
        ui_dir: root.join("ui"),
        shutdown: Some(signal),
    })
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let c = Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .unwrap();
    let write = |path: String, body: Value| c.post(format!("{url}/{path}")).json(&body).send();
    for id in [&old, &prepared, &bad, &cold_bad, &cold_ok] {
        let cat = get(&c, &url, "presets/catalog").await;
        let response = write(
            "presets/catalog".into(),
            json!({
                "expected_revision":cat["revision"],"entry_kind":"rig","id":id,
                "action":{"kind":"set_list","member":true}
            }),
        )
        .await
        .unwrap();
        assert!(
            response.status().is_success(),
            "{}",
            response.text().await.unwrap()
        );
    }
    let mut order = get(&c, &url, "presets/set-list").await;
    let occurrence = |order: &Value, digest: &str| {
        order["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["content"] == digest)
            .unwrap()["entry"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let first = occurrence(&order, &prepared);
    let bad_id = occurrence(&order, &bad);
    let cold_bad_id = occurrence(&order, &cold_bad);
    let cold_ok_id = occurrence(&order, &cold_ok);
    let response = write("presets/set-list".into(), json!({
        "expected_revision":order["revision"],"entry":first,"action":{"kind":"repeat","new_id":"repeat"}
    })).await.unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().await.unwrap()
    );
    order = response.json().await.unwrap();
    for (id, scene) in [
        (&*first, "b"),
        ("repeat", "a"),
        (&*bad_id, "b"),
        (&*cold_bad_id, "b"),
        (&*cold_ok_id, "b"),
    ] {
        let response = write("presets/set-list".into(), json!({
            "expected_revision":order["revision"],"entry":id,"action":{"kind":"change","settings":{"scene":scene}}
        })).await.unwrap();
        assert!(
            response.status().is_success(),
            "{}",
            response.text().await.unwrap()
        );
        order = response.json().await.unwrap();
    }
    // Membership order is independent of fixture publication. Put the
    // deliberately failing entry right after the repeated occurrence.
    let entries = order["entries"].as_array().unwrap();
    let repeat_index = entries
        .iter()
        .position(|row| row["entry"]["id"] == "repeat")
        .unwrap();
    let successor = entries
        .get(repeat_index + 1)
        .and_then(|row| row["entry"]["id"].as_str());
    if successor != Some(bad_id.as_str()) {
        let response = write(
            "presets/set-list".into(),
            json!({
                "expected_revision":order["revision"],"entry":bad_id,
                "action":{"kind":"place","before":successor}
            }),
        )
        .await
        .unwrap();
        assert!(
            response.status().is_success(),
            "{}",
            response.text().await.unwrap()
        );
        order = response.json().await.unwrap();
    }
    apply(
        &c,
        &url,
        json!({"kind":"start","settings":{
            "revision":old,"stream":stream(),"recall":null,
            "prepared":[{"revision":prepared,"recall":null},{"revision":bad,"recall":null}]
        }}),
    )
    .await;
    let tap = || write("tempo".into(), json!({"kind":"tap"}));
    tap().await.unwrap().error_for_status().unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let tempo: Value = tap()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(tempo["source"], "tap");
    assert!(tempo["bpm"].as_f64().is_some(), "{tempo}");
    let protect = |on| write("protect".into(), json!({"on":on}));
    protect(true).await.unwrap().error_for_status().unwrap();
    let jump = |id: &str| {
        write(
            format!("presets/set-list/{id}/recall"),
            json!({"expected_revision":order["revision"]}),
        )
    };
    let response = jump(&first).await.unwrap();
    assert_eq!(response.status(), 204, "{}", response.text().await.unwrap());
    let first_state = get(&c, &url, "rig-audio").await;
    assert_eq!(first_state["configured"]["revision"], prepared);
    assert_eq!(first_state["control"]["scene"], "b");
    assert_eq!(first_state["control"]["scene_transitioning"], false);
    assert_eq!(
        control(
            &first_state,
            &json!({"kind":"merge","node":"level","port":0})
        ),
        0.5
    );

    let response = write("midi/navigate".into(), json!({"direction":"next"}))
        .await
        .unwrap();
    assert_eq!(response.status(), 204, "{}", response.text().await.unwrap());
    let previous = get(&c, &url, "rig-audio").await;
    assert_eq!(previous["control"]["scene"], "a");
    assert_eq!(
        previous["control"]["session"],
        first_state["control"]["session"]
    );
    assert_eq!(get(&c, &url, "tempo").await, tempo);
    write(
        "player/commands".into(),
        json!({"requestId":"stop-for-tempo","origin":"api","command":{"kind":"stop"}}),
    )
    .await
    .unwrap()
    .error_for_status()
    .unwrap();
    let after_stop = get(&c, &url, "rig-audio").await;
    assert_eq!(after_stop["phase"], "running");
    assert_eq!(
        after_stop["control"]["session"],
        previous["control"]["session"]
    );
    assert_eq!(get(&c, &url, "tempo").await, tempo);
    let previous_pid = pids(&executable);
    assert_eq!(previous_pid.len(), 1);
    for (index, id) in [&bad_id, &cold_bad_id].into_iter().enumerate() {
        if index == 1 {
            let protected = jump(id).await.unwrap();
            assert_eq!(protected.status(), 409);
            assert!(protected.text().await.unwrap().contains("Protect"));
            protect(false).await.unwrap().error_for_status().unwrap();
        }
        let response = jump(id).await.unwrap();
        assert_eq!(response.status(), 409, "{}", response.text().await.unwrap());
        assert!(
            response
                .text()
                .await
                .unwrap()
                .to_lowercase()
                .contains("nonfinite")
        );
        let after = get(&c, &url, "rig-audio").await;
        assert_eq!(after["control"]["session"], previous["control"]["session"]);
        assert_eq!(after["control"]["scene"], "a");
        assert_eq!(after["configured"]["revision"], prepared);
        assert!(
            after["processed_frames"].as_u64().unwrap()
                > previous["processed_frames"].as_u64().unwrap()
        );
        assert_eq!(pids(&executable), previous_pid);
        assert_eq!(
            get(&c, &url, "midi/position").await["occurrence"]["entry"]["id"],
            "repeat"
        );
    }
    let response = write("midi/navigate".into(), json!({"direction":"next"}))
        .await
        .unwrap();
    assert_eq!(response.status(), 409, "{}", response.text().await.unwrap());
    assert_eq!(
        get(&c, &url, "midi/position").await["occurrence"]["entry"]["id"],
        "repeat"
    );
    let response = jump(&cold_ok_id).await.unwrap();
    assert_eq!(response.status(), 204, "{}", response.text().await.unwrap());
    let current = get(&c, &url, "rig-audio").await;
    assert_eq!(current["control"]["scene"], "b");
    assert_eq!(current["control"]["scene_transitioning"], false);
    assert_eq!(current["configured"]["revision"], cold_ok);
    assert_eq!(
        get(&c, &url, "midi/position").await["occurrence"]["entry"]["id"],
        cold_ok_id
    );

    apply(&c, &url, json!({"kind":"stop"})).await;
    let stopped_position = get(&c, &url, "midi/position").await;
    assert!(stopped_position["index"].is_null());
    assert!(stopped_position["occurrence"].is_null());
    let already_playing = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{
            "revision":bad,"stream":stream(),"recall":null
        }}),
    )
    .await;
    assert_eq!(already_playing["control"]["scene"], "a");
    let same_pid = pids(&executable);
    let response = jump(&bad_id).await.unwrap();
    assert_eq!(response.status(), 409, "{}", response.text().await.unwrap());
    let refused = get(&c, &url, "rig-audio").await;
    assert_eq!(refused["phase"], "running");
    assert_eq!(
        refused["control"]["session"],
        already_playing["control"]["session"]
    );
    assert_eq!(refused["control"]["scene"], "a");
    assert_eq!(pids(&executable), same_pid);

    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires isolated Native and Mixed workers, real NAM fixtures, and shipped Echo/Bloom"]
async fn builds_four_capture_scenes_offline_and_reopens_with_a_conditional_cabinet() {
    use oxidal_presets::{Bundle, ModelStore};
    use tower::ServiceExt;
    let _worker_test = WORKER_TEST.lock().await;
    let rig = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_RIG_WORKER").unwrap());
    let native = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_NATIVE_WORKER").unwrap());
    let graph = std::path::PathBuf::from(std::env::var_os("OXIDAL_TEST_GRAPH_WORKER").unwrap());
    let root = std::env::temp_dir().join(format!("oxidal-four-capture-{}", std::process::id()));
    let presets = root.join("presets");
    let store = BundleStore::new(presets.join("bundles"));
    let models = ModelStore::new(presets.join("audition-models"));
    let a2 = std::fs::read(std::env::var_os("OXIDAL_TONE3000_TEST_MODEL").unwrap()).unwrap();
    let lstm = std::fs::read(std::env::var_os("OXIDAL_TONE3000_TEST_LSTM").unwrap()).unwrap();
    let (clean, _) = models.stage_local("clean.nam", &a2).unwrap();
    let (crunch, _) = models.stage_local("crunch.nam", &lstm).unwrap();
    let two = |payload: &[u8], spaces: &[u8], name| {
        let mut bytes = payload.to_vec();
        bytes.extend_from_slice(spaces);
        models.stage_local(name, &bytes).unwrap().0
    };
    let extra = |env, name| {
        let bytes = std::fs::read(std::env::var_os(env).unwrap()).unwrap();
        models.stage_local(name, &bytes).unwrap().0
    };
    let lead = extra("OXIDAL_TONE3000_TEST_WAVENET", "lead.nam");
    let dirt = extra("OXIDAL_TONE3000_TEST_FULL_RIG", "dirt.nam");
    let bad = two(&a2, b"\n ", "damaged.nam");
    let (_, bad_path) = models.read(&bad).unwrap();
    std::fs::write(&bad_path, b"integrity mismatch").unwrap();
    let frames = 512u32;
    let mut ir = b"RIFF".to_vec();
    ir.extend((36 + frames * 2).to_le_bytes());
    ir.extend(b"WAVEfmt ");
    ir.extend(16u32.to_le_bytes());
    ir.extend([1, 0, 1, 0]);
    ir.extend(48000u32.to_le_bytes());
    ir.extend(96000u32.to_le_bytes());
    ir.extend([2, 0, 16, 0]);
    ir.extend(b"data");
    ir.extend((frames * 2).to_le_bytes());
    for i in 0..frames {
        let sample = match i {
            16 => 16000i16,
            31 => -4400,
            107 => 2300,
            _ => 0,
        };
        ir.extend(sample.to_le_bytes());
    }
    let (cab, _) = models.stage_local("cabinet.wav", &ir).unwrap();
    let stale = json!({
        "format":"oxidal.preset","formatVersion":1,"id":"68448a6d-0168-4fc8-b337-c12959165271",
        "name":"Previous dry rig","tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}
        ],"edges":[{"from":{"node":"in","port":0},"to":{"node":"out","port":0}},
            {"from":{"node":"in","port":1},"to":{"node":"out","port":1}}
        ]},"lv2":[],"recall":{"tails":"cut"}}
    });
    let old = Bundle::from_parts(stale.to_string().into_bytes(), Default::default()).unwrap();
    let old = store.save(&old).unwrap();
    let (shutdown, signal) = tokio::sync::watch::channel(false);
    let (app, stopped) = router_with_shutdown(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: Some(graph),
        audio_worker: None,
        native_worker: Some(native),
        rig_worker: Some(rig.clone()),
        shutdown: Some(signal),
        simulator: false,
        mapping_path: root.join("mapping.json"),
        preset_dir: presets.clone(),
        media_dir: None,
        ui_dir: root.join("ui"),
    })
    .unwrap();
    let cancel_app = app.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let c = Client::builder()
        .timeout(Duration::from_secs(100))
        .build()
        .unwrap();
    let playing = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{"revision":old,"stream":stream()}}),
    )
    .await;
    let previous_pid = pids(&rig);
    assert_eq!(previous_pid.len(), 1);
    let request = json!({"name":"Four capture scenes","request_id":"builder-05",
        "captures":[{"asset":clean,"role":"amp"},{"asset":crunch,"role":"full_rig"},
            {"asset":lead,"role":"full_rig"},{"asset":dirt,"role":"full_rig"}],"cabinet":cab});
    let build = |body: &Value| {
        c.post(format!("{url}/presets/rigs/from-captures"))
            .json(body)
            .send()
    };
    let cancellation = tokio::spawn(
        cancel_app.oneshot(
            axum::http::Request::post("/api/v1/presets/rigs/from-captures")
                .header("host", "127.0.0.1")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(request.to_string()))
                .unwrap(),
        ),
    );
    let builds = presets.join("capture-builds");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if std::fs::read_dir(&builds).is_ok_and(|mut files| {
                files.any(|entry| {
                    entry.is_ok_and(|entry| entry.file_name().to_string_lossy().starts_with('.'))
                })
            }) {
                break;
            }
            assert!(
                !cancellation.is_finished(),
                "Build completed before cancellation"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("The isolated build reached preparation");
    cancellation.abort();
    assert!(cancellation.await.unwrap_err().is_cancelled());
    assert_eq!(std::fs::read_dir(&builds).unwrap().count(), 0);
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(pids(&rig), previous_pid);

    let mut failure = request.clone();
    failure["captures"][0]["asset"] = json!(bad);
    let response = build(&failure).await.unwrap();
    assert_eq!(response.status(), 422, "{}", response.text().await.unwrap());
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(
        get(&c, &url, "rig-audio").await["control"]["session"],
        playing["control"]["session"]
    );
    assert_eq!(pids(&rig), previous_pid);

    let response = build(&request).await.unwrap();
    let code = response.status();
    let built: Value = response.json().await.unwrap();
    assert_eq!(code, 200, "{built}");
    let revision = built["revision"].as_str().unwrap();
    assert_eq!(store.list().unwrap().len(), 2);
    assert_eq!(
        built,
        get(&c, &url, &format!("presets/rigs/{revision}")).await
    );
    let retried: Value = build(&request)
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(retried, built);
    let mut changed = request.clone();
    changed["name"] = json!("Conflicting retry");
    assert_eq!(build(&changed).await.unwrap().status(), 409);
    assert_eq!(
        get(&c, &url, "rig-audio").await["control"]["session"],
        playing["control"]["session"]
    );
    assert_eq!(pids(&rig), previous_pid);
    assert!(
        get(&c, &url, "rig-audio").await["processed_frames"]
            .as_u64()
            .unwrap()
            > playing["processed_frames"].as_u64().unwrap()
    );

    let bundle = store.read(revision).unwrap();
    assert_eq!(bundle.manifest().tone3000.instances.len(), 5);
    assert!(!presets.join("owned").exists());
    let host = bundle.manifest().oxidal.as_ref().unwrap();
    assert!(
        host.graph
            .edges
            .iter()
            .filter(|edge| edge.to.node == "cabinet")
            .all(|edge| edge.from.node.starts_with("amp-return"))
    );
    assert!(
        host.graph
            .edges
            .iter()
            .filter(|edge| edge.from.node == "crunch")
            .all(|edge| edge.to.node.starts_with("full-rig-return"))
    );
    assert!(
        host.graph
            .edges
            .iter()
            .any(|edge| edge.from.node == "echo" && edge.to.node == "bloom")
    );

    // A completed bundle owns the exact native payloads it needs.
    std::fs::rename(
        presets.join("audition-models"),
        root.join("detached-fixtures"),
    )
    .unwrap();
    apply(&c, &url, json!({"kind":"stop"})).await;
    let mut active = apply(
        &c,
        &url,
        json!({"kind":"start","settings":{"revision":revision,"stream":stream()}}),
    )
    .await;
    assert_eq!(active["control"]["scene"], "clean");
    for scene in ["crunch", "lead", "dirt", "clean"] {
        let command = json!({"kind":"scene","command":{"scene":scene,
            "session":active["control"]["session"],"expected_revision":active["control"]["revision"]}});
        active = apply(&c, &url, command).await;
        assert_eq!(active["control"]["scene"], scene);
        assert_eq!(active["phase"], "running");
        for _ in 0..100 {
            if active["control"]["scene_transitioning"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
            active = get(&c, &url, "rig-audio").await;
        }
        assert_eq!(active["control"]["scene"], scene);
        assert_eq!(active["control"]["scene_transitioning"], false);
    }
    shutdown.send_replace(true);
    stopped.wait().await.unwrap();
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}
