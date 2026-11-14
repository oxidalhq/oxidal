//! Duplicate of a TONE3000 chain saved in Mine, and republishing an earlier
//! revision of a preset (the rig canvas's Undo and Redo).
use oxidal_api::{Config, router};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
const CURRENT: &[u8] =
    include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
const LEGACY: &[u8] =
    include_bytes!("../../oxidal-presets/tests/fixtures/authored-legacy.t3kpreset");

async fn start() -> (String, tokio::task::JoinHandle<()>, PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "oxidal-duplicate-{}-{}.json",
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
        simulator: true,
        mapping_path: path.clone(),
        preset_dir: path.with_extension("presets"),
        media_dir: None,
        ui_dir: PathBuf::from("nonexistent"),
    })
    .unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, task, path)
}

async fn get(client: &reqwest::Client, url: String) -> Value {
    client.get(url).send().await.unwrap().json().await.unwrap()
}

async fn post(client: &reqwest::Client, url: String, body: Value) -> (u16, Value) {
    let response = client.post(url).json(&body).send().await.unwrap();
    let status = response.status().as_u16();
    let text = response.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

fn row(catalog: &Value, kind: &str, id: &str) -> Option<Value> {
    catalog["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["kind"] == kind && i["id"] == id)
        .cloned()
}

fn midi_entry(map: &Value, kind: &str, id: &str) -> Option<Value> {
    map["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["entry"]["kind"] == kind && e["entry"]["id"] == id)
        .cloned()
}

#[tokio::test]
async fn duplicating_an_owned_tone3000_chain_saves_name_copy_in_mine_outside_the_set_list() {
    let (url, task, mapping) = start().await;
    let root = mapping.with_extension("presets");
    let client = reqwest::Client::new();
    let owned_store = oxidal_presets::OwnedStore::new(root.join("owned"));
    let owned = owned_store.save_created(CURRENT).unwrap();
    // A saved switch assignment comes along with the copy.
    let map = get(&client, format!("{url}/midi/map")).await;
    let (status, body) = post(
        &client,
        format!("{url}/midi/map"),
        json!({
            "expected_revision": map["revision"],
            "input": null,
            "channel": 1,
            "entries": [{
                "entry": {"kind": "owned", "id": owned.id},
                "bindings": [],
                "branch_bindings": [],
                "parameter_bindings": [{
                    "target": {"kind": "native", "node": "native", "parameter": "inputLevel"},
                    "controller": 21
                }]
            }]
        }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let catalog = get(&client, format!("{url}/presets/catalog")).await;
    let source = row(&catalog, "owned", &owned.id).unwrap();
    let (status, duplicated) = post(
        &client,
        format!("{url}/presets/catalog"),
        json!({
            "expected_revision": catalog["revision"],
            "entry_kind": "owned",
            "id": owned.id,
            "action": {"kind": "duplicate"}
        }),
    )
    .await;
    assert_eq!(status, 200, "{duplicated}");
    assert_eq!(duplicated["created"]["kind"], "owned");
    let copy = duplicated["created"]["id"].as_str().unwrap().to_owned();
    assert_ne!(copy, owned.id);
    let made = row(&duplicated, "owned", &copy).unwrap();
    assert_eq!(
        made["name"],
        format!("{} copy", source["name"].as_str().unwrap())
    );
    assert_eq!(made["origin"], "mine");
    assert_eq!(made["in_set_list"], false);
    assert_eq!(
        row(&duplicated, "owned", &owned.id).unwrap()["in_set_list"],
        source["in_set_list"]
    );
    // The copy is a complete, valid chain; the source bytes are untouched.
    let (info, bytes) = owned_store.read(&copy).unwrap();
    assert_eq!(info.preset.name, "Fixture – Δ copy");
    assert_eq!(info.preset.block_count, owned.preset.block_count);
    assert_eq!(info.preset.parameter_count, owned.preset.parameter_count);
    assert_eq!(info.preset.embedded_bytes, owned.preset.embedded_bytes);
    assert_ne!(info.preset.source_id, owned.preset.source_id);
    assert_eq!(
        oxidal_presets::embedded_digests(&bytes).unwrap(),
        oxidal_presets::embedded_digests(CURRENT).unwrap()
    );
    assert_eq!(owned_store.read(&owned.id).unwrap().1, CURRENT);
    let map = get(&client, format!("{url}/midi/map")).await;
    assert_eq!(
        midi_entry(&map, "owned", &copy).unwrap()["parameter_bindings"],
        midi_entry(&map, "owned", &owned.id).unwrap()["parameter_bindings"]
    );
    // A second copy takes the next free name.
    let (status, again) = post(
        &client,
        format!("{url}/presets/catalog"),
        json!({
            "expected_revision": duplicated["revision"],
            "entry_kind": "owned",
            "id": owned.id,
            "action": {"kind": "duplicate"}
        }),
    )
    .await;
    assert_eq!(status, 200, "{again}");
    let second = again["created"]["id"].as_str().unwrap();
    assert_eq!(
        row(&again, "owned", second).unwrap()["name"],
        "Fixture – Δ copy 2"
    );
    task.abort();
    let _ = std::fs::remove_file(&mapping);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn a_tone3000_original_is_not_duplicated_and_the_reason_is_given() {
    let (url, task, mapping) = start().await;
    let client = reqwest::Client::new();
    let imported: Value = client
        .post(format!("{url}/presets"))
        .body(LEGACY.to_vec())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let catalog = get(&client, format!("{url}/presets/catalog")).await;
    let (status, body) = post(
        &client,
        format!("{url}/presets/catalog"),
        json!({
            "expected_revision": catalog["revision"],
            "entry_kind": "original",
            "id": imported["sha256"],
            "action": {"kind": "duplicate"}
        }),
    )
    .await;
    assert_eq!(status, 422, "{body}");
    assert!(body.to_string().contains("Save copy"), "{body}");
    task.abort();
    let _ = std::fs::remove_file(&mapping);
    let _ = std::fs::remove_dir_all(mapping.with_extension("presets"));
}

/// Undo on the rig canvas republishes the earlier revision's manifest with the
/// current revision as its source. The same bytes give back the same revision:
/// it returns to its place in the library, and MIDI moves back with it.
#[tokio::test]
async fn republishing_an_earlier_revision_restores_it_and_moves_midi_back() {
    let (url, task, mapping) = start().await;
    let client = reqwest::Client::new();
    let manifest = |gain: f64| {
        json!({
            "format": "oxidal.preset",
            "formatVersion": 1,
            "id": "7c1e2f3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b",
            "name": "Undo",
            "tone3000": {"instances": []},
            "oxidal": {
                "graph": {
                    "nodes": [
                        {"id":"in","kind":"input","audioInputs":0,"audioOutputs":1},
                        {"id":"scene-gain","kind":"gain","audioInputs":1,"audioOutputs":1,"inputGains":[gain]},
                        {"id":"out","kind":"output","audioInputs":1,"audioOutputs":0}
                    ],
                    "edges": [
                        {"from":{"node":"in","port":0},"to":{"node":"scene-gain","port":0}},
                        {"from":{"node":"scene-gain","port":0},"to":{"node":"out","port":0}}
                    ]
                },
                "lv2": [],
                "recall": {"tails":"cut"}
            },
            "resources": [],
            "extensions": {
                "urn:oxidal:gain:1": {},
                "urn:oxidal:scenes:1": {"fade_ms": 10, "scenes": [
                    {"id": "clean", "name": "Clean", "gains": [{"node":"scene-gain","port":0,"value":gain}]}
                ]}
            },
            "requiredExtensions": ["urn:oxidal:gain:1", "urn:oxidal:scenes:1"]
        })
        .to_string()
    };
    let publish = |manifest: String, source: Option<&str>| {
        let (client, url) = (client.clone(), format!("{url}/presets/rigs"));
        let body = json!({
            "manifest_json": manifest,
            "resources": {},
            "source": source.map(|id| json!({"kind": "rig", "id": id}))
        });
        async move {
            let (status, body) = post(&client, url, body).await;
            assert_eq!(status, 200, "{body}");
            body["revision"].as_str().unwrap().to_owned()
        }
    };
    let first_manifest = manifest(1.0);
    let first = publish(first_manifest.clone(), None).await;
    let map = get(&client, format!("{url}/midi/map")).await;
    let (status, body) = post(
        &client,
        format!("{url}/midi/map"),
        json!({
            "expected_revision": map["revision"],
            "input": null,
            "channel": 1,
            "entries": [{
                "entry": {"kind": "rig", "id": first},
                "bindings": [{"scene": "clean", "program": 4, "controller": null}],
                "branch_bindings": [],
                "parameter_bindings": []
            }]
        }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // An edit: the second revision takes the first one's place and its MIDI.
    let second = publish(manifest(0.5), Some(&first)).await;
    let catalog = get(&client, format!("{url}/presets/catalog")).await;
    assert!(row(&catalog, "rig", &first).is_none_or(|r| r["superseded"] == true));
    assert!(row(&catalog, "rig", &second).is_some());
    let map = get(&client, format!("{url}/midi/map")).await;
    assert!(midi_entry(&map, "rig", &first).is_none());
    assert!(midi_entry(&map, "rig", &second).is_some());
    // Undo: the first revision's exact manifest, with the second as source.
    let undone = publish(first_manifest, Some(&second)).await;
    assert_eq!(undone, first);
    let catalog = get(&client, format!("{url}/presets/catalog")).await;
    let restored = row(&catalog, "rig", &first).unwrap();
    assert_ne!(restored["superseded"], true);
    assert!(row(&catalog, "rig", &second).is_none_or(|r| r["superseded"] == true));
    let map = get(&client, format!("{url}/midi/map")).await;
    assert_eq!(
        midi_entry(&map, "rig", &first).unwrap()["bindings"][0]["program"],
        4
    );
    // No copy of the map is left behind on the revision undone.
    assert!(midi_entry(&map, "rig", &second).is_none());
    // Redo: the second revision again, with the first as source.
    let redone = publish(manifest(0.5), Some(&first)).await;
    assert_eq!(redone, second);
    let map = get(&client, format!("{url}/midi/map")).await;
    assert!(midi_entry(&map, "rig", &second).is_some());
    assert!(midi_entry(&map, "rig", &first).is_none());
    task.abort();
    let _ = std::fs::remove_file(&mapping);
    let _ = std::fs::remove_dir_all(mapping.with_extension("presets"));
}
