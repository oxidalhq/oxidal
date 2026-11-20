//! Closed sends are previewed without changing the source or starting a worker.
use oxidal_api::{Config, router};
use serde_json::{Value, json};

fn authored() -> Value {
    let edge = |from: &str, from_port, to: &str, to_port| json!({"from":{"node":from,"port":from_port},"to":{"node":to,"port":to_port}});
    let scene = |id, a, b| {
        json!({"id":id,"name":id,"gains":[
            {"node":"mix","port":0,"value":a},{"node":"mix","port":1,"value":b}
        ]})
    };
    let block = |id| json!({"id":id,"kind":"lv2","instance":id,"bypassed":false,"audioInputs":1,"audioOutputs":1});
    let plugin = |id| json!({"id":id,"pluginUri":"urn:fixture:delay","controls":{},"assets":[],"requiredFeatures":[]});
    json!({
        "format":"oxidal.preset","formatVersion":1,"id":"68448a6d-0168-4fc8-b337-c12959165271",
        "name":"Old authored rig","tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":["urn:oxidal:scenes:1"],
        "extensions":{"urn:oxidal:scenes:1":{"fade_ms":4,
            "scenes":[scene("first",1,0),scene("second",0,1)],
            "branches":[
                {"id":"first","name":"First","gains":[{"node":"mix","port":0,"value":1}]},
                {"id":"second","name":"Second","gains":[{"node":"mix","port":1,"value":1}]}
            ]
        }},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            block("fx-a"),block("fx-b"),
            {"id":"mix","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1,0]},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}
        ],"edges":[edge("in",0,"split",0),edge("split",0,"fx-a",0),edge("split",1,"fx-b",0),
            edge("fx-a",0,"mix",0),edge("fx-b",0,"mix",1),edge("mix",0,"out",0),edge("in",1,"out",1)
        ]},"lv2":[plugin("fx-a"),plugin("fx-b")],"recall":{"tails":"cut"}}
    })
}

#[tokio::test]
async fn preview_is_read_only_and_publish_has_to_opt_in() {
    let root = std::env::temp_dir().join(format!(
        "oxidal-rig-sleep-plan-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap(),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://{}/api/v1/presets/rigs",
        listener.local_addr().unwrap()
    );
    let app = router(Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator: true,
        mapping_path: root.join("maps"),
        preset_dir: root.join("presets"),
        media_dir: None,
        ui_dir: root.join("ui"),
    })
    .unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let manifest = authored();
    let ordinary = json!({"manifest_json":manifest.to_string(),"resources":{}});
    let source: Value = client
        .post(&url)
        .json(&ordinary)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let source_id = source["revision"].as_str().unwrap();
    let preview: Value = client
        .get(format!("{url}/{source_id}/sleep-plan"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(preview["plan"]["enabled"], true);
    assert_eq!(
        preview["inserted_sends"][0],
        json!({"node":"sleep-send-1","from":{"node":"split","port":0},"to":{"node":"fx-a","port":0}})
    );
    let unaffected: Value = client
        .get(format!("{url}/{source_id}"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unaffected, source);
    let old_store = oxidal_presets::BundleStore::new(root.join("presets").join("bundles"));
    assert_eq!(
        old_store.read(source_id).unwrap().manifest_bytes(),
        manifest.to_string().as_bytes()
    );

    let mut publish = ordinary;
    publish["source"] = json!({"kind":"rig","id":source_id});
    publish["prepare_sleep_branches"] = json!(true);
    let saved: Value = client
        .post(&url)
        .json(&publish)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_ne!(saved["revision"], source["revision"]);
    assert_eq!(saved["manifest"]["id"], manifest["id"]);
    assert_eq!(
        saved["manifest"]["extensions"]["urn:oxidal:sleep-branches:1"],
        preview["plan"]
    );
    assert_eq!(
        saved["manifest"]["extensions"]["urn:oxidal:scenes:1"],
        manifest["extensions"]["urn:oxidal:scenes:1"]
    );
    let saved_id = saved["revision"].as_str().unwrap();
    let equipped: Value = client
        .get(format!("{url}/{saved_id}/sleep-plan"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(equipped["plan"], preview["plan"]);
    assert_eq!(equipped["inserted_sends"], json!([]));

    let mut leaky = manifest;
    let edges = leaky["oxidal"]["graph"]["edges"].as_array_mut().unwrap();
    // Also use fx-b as a feed to the right output. It cannot be slept.
    edges[6]["from"] = json!({"node":"fx-b","port":0});
    let rejected = client.post(&url).json(&json!({"manifest_json":leaky.to_string(),"resources":{},"prepare_sleep_branches":true})).send().await.unwrap();
    assert_eq!(rejected.status(), 422);
    task.abort();
    std::fs::remove_dir_all(root).unwrap();
}
