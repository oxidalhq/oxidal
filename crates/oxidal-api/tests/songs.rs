use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    http::{Request, StatusCode},
};
use oxidal_api::{Config, router};
use oxidal_splitter::SplitMode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::{path::PathBuf, time::Duration};
use tower::ServiceExt;

async fn request(app: &Router, method: &str, uri: &str, body: Body) -> (StatusCode, Bytes) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{uri}"))
                .header("Host", "127.0.0.1")
                .header("Content-Type", "application/json")
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    (
        status,
        to_bytes(response.into_body(), 16 << 20).await.unwrap(),
    )
}

async fn json_request(app: &Router, method: &str, uri: &str, value: Value) -> (u16, Value) {
    let body = if value.is_null() {
        Body::empty()
    } else {
        Body::from(value.to_string())
    };
    let (status, bytes) = request(app, method, uri, body).await;
    let result = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status.as_u16(), result)
}

fn little16(bytes: &[u8], offset: usize) -> usize {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()) as usize
}

fn little32(bytes: &[u8], offset: usize) -> usize {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize
}

fn verify_archive(zip: &[u8], mode: SplitMode, wav: &[u8]) {
    let mut offset = 0;
    for role in mode.roles() {
        assert_eq!(little32(zip, offset), 0x0403_4b50);
        assert_eq!(little16(zip, offset + 8), 0); // STORED
        assert_eq!(little32(zip, offset + 14), crc32fast::hash(wav) as usize);
        let data_size = little32(zip, offset + 18);
        let name_size = little16(zip, offset + 26);
        let start = offset + 30 + name_size + little16(zip, offset + 28);
        assert_eq!(
            &zip[offset + 30..offset + 30 + name_size],
            format!("{}.wav", role.name()).as_bytes()
        );
        assert_eq!(&zip[start..start + data_size], wav);
        offset = start + data_size;
    }
    let end = zip.len() - 22;
    assert_eq!(little32(zip, offset), 0x0201_4b50);
    assert_eq!(little32(zip, end), 0x0605_4b50);
    assert_eq!(little16(zip, end + 10), mode.roles().len());
    assert_eq!(little32(zip, end + 16), offset);
}

fn saved_rig(preset_dir: &std::path::Path) -> String {
    let mut manifest: Value = serde_json::from_str(include_str!(
        "../../../docs/presets/examples/pure-edited.json"
    ))
    .unwrap();
    let resources = BTreeMap::from([
        (
            "currentTone3000Preset".into(),
            include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset")
                .to_vec(),
        ),
        (
            "sourceTone3000Preset".into(),
            include_bytes!("../../oxidal-presets/tests/fixtures/authored-legacy.t3kpreset")
                .to_vec(),
        ),
    ]);
    for resource in manifest["resources"].as_array_mut().unwrap() {
        let payload = &resources[resource["id"].as_str().unwrap()];
        resource["sha256"] = format!("{:x}", Sha256::digest(payload)).into();
        resource["bytes"] = payload.len().into();
    }
    let bundle =
        oxidal_presets::Bundle::from_parts(serde_json::to_vec(&manifest).unwrap(), resources)
            .unwrap();
    oxidal_presets::BundleStore::new(preset_dir.join("bundles"))
        .save(&bundle)
        .unwrap()
}

#[tokio::test]
async fn imported_mp3_and_wav_make_one_editable_song_without_a_model() {
    let root = std::env::temp_dir().join(format!("oxidal-import-stems-{}", std::process::id()));
    let media = root.join("media");
    let config = Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator: true,
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: Some(media.clone()),
        ui_dir: PathBuf::from("nonexistent"),
    };
    let app = router(config.clone()).unwrap();
    let mp3 = include_bytes!("fixtures/media/tone-44k-mono-vbr.mp3");
    // A shorter 48 kHz mono PCM WAV checks rate conversion, channel expansion
    // and shared song length with the actual 44.1 kHz MP3 fixture.
    let samples = 2400u32;
    let mut wav = b"RIFF".to_vec();
    wav.extend((36 + samples * 2).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend([1, 0, 1, 0]); // PCM, mono
    wav.extend(48_000u32.to_le_bytes());
    wav.extend(96_000u32.to_le_bytes());
    wav.extend([2, 0, 16, 0]);
    wav.extend(b"data");
    wav.extend((samples * 2).to_le_bytes());
    wav.extend(4096i16.to_le_bytes().repeat(samples as usize));

    let mut stems = Vec::new();
    for (role, name, data) in [
        ("bass", "bass.mp3", mp3.as_slice()),
        ("guitar", "guitar.wav", &wav),
    ] {
        let (status, upload) = json_request(
            &app,
            "POST",
            "/media/uploads",
            json!({"name":name,"size":data.len(),"stem":true}),
        )
        .await;
        assert_eq!(status, 201, "{upload}");
        let id = upload["id"].as_str().unwrap();
        let (status, state) = request(
            &app,
            "PUT",
            &format!("/media/uploads/{id}?offset=0"),
            Body::from(data.to_vec()),
        )
        .await;
        assert_eq!(status, 200);
        let state: Value = serde_json::from_slice(&state).unwrap();
        assert_eq!(state["complete"], true);
        stems.push(json!({"role":role, "upload":id}));
    }
    let (_, before) = json_request(&app, "GET", "/media", Value::Null).await;
    assert_eq!(before["assets"], json!([]));
    let import = "/media/songs/import-stems";
    let invalid = json!({"title":"Duplicate role","stems":[stems[0], stems[0]]});
    assert_eq!(json_request(&app, "POST", import, invalid).await.0, 422);
    let payload = json!({"title":"Mac session", "stems":stems});
    let (status, song) = json_request(&app, "POST", import, payload.clone()).await;
    assert_eq!(status, 201, "{song}");
    let source = song["id"].as_str().unwrap();
    assert_eq!(song["title"], "Mac session");
    let (_, library) = json_request(&app, "GET", "/media", Value::Null).await;
    assert_eq!(library["assets"].as_array().unwrap().len(), 1);
    let (_, same) = json_request(&app, "POST", import, payload).await;
    assert_eq!(same["id"], source);
    assert_eq!(
        std::fs::read_dir(media.join("incoming")).unwrap().count(),
        0
    );
    drop(app);
    let app = router(config).unwrap();
    let song_path = format!("/media/songs/{source}");
    let (status, view) = json_request(&app, "GET", &song_path, Value::Null).await;
    assert_eq!(status, 200, "{view}");
    let split = &view["splits"][0];
    assert_eq!(split["importedRoles"], json!(["bass", "guitar"]));
    assert_eq!(split["mode"], "six");
    let frames = split["frames"].as_u64().unwrap() as usize;
    let base = format!("{song_path}/splits/{source}");
    let (status, guitar) = request(
        &app,
        "GET",
        &format!("{base}/stems/guitar/wav"),
        Body::empty(),
    )
    .await;
    assert_eq!(status, 200);
    let pcm = &guitar[guitar.len() - frames * 8..];
    assert_eq!(&pcm[..8], &0.125f32.to_le_bytes().repeat(2));
    assert!(pcm[2400 * 8..].iter().all(|&byte| byte == 0));
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}/stems/piano/wav"),
            Body::empty()
        )
        .await
        .0,
        404
    );
    let (status, zip) = request(&app, "GET", &format!("{base}/stems.zip"), Body::empty()).await;
    assert_eq!(status, 200);
    assert_eq!(little16(&zip, zip.len() - 12), 2);
    let levels = json!({"gain_tenths_db":0,"muted":false,"solo":false});
    let mixes = format!("{song_path}/mixes");
    let (status, mix) = json_request(&app, "POST", &mixes, json!({
        "title":"Guitar practice", "split":source,
        "recipe":{"mode":"six","vocals":levels,"drums":levels,"bass":levels,
            "other":levels,"piano":levels,"guitar":{"gain_tenths_db":0,"muted":true,"solo":false}}
    })).await;
    assert_eq!(status, 200, "{mix}");
    let asset_path = format!("/media/assets/{source}");
    assert_eq!(
        json_request(&app, "DELETE", &asset_path, Value::Null)
            .await
            .0,
        422
    );
    let revision = json!({"id":mix["id"],"revision":mix["revision"]});
    assert_eq!(json_request(&app, "DELETE", &mixes, revision).await.0, 204);
    assert_eq!(
        json_request(&app, "DELETE", &asset_path, Value::Null)
            .await
            .0,
        204
    );
    assert!(!media.join("assets").join(source).exists());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn prepared_song_mixes_save_reopen_cue_and_export_both_stem_counts() {
    let root = std::env::temp_dir().join(format!("oxidal-song-test-{}", std::process::id()));
    let media = root.join("media");
    let config = Config {
        debug_socket: None,
        device_socket: None,
        graph_worker: None,
        rig_worker: None,
        audio_worker: None,
        native_worker: None,
        shutdown: None,
        simulator: true,
        mapping_path: root.join("mapping.json"),
        preset_dir: root.join("presets"),
        media_dir: Some(media.clone()),
        ui_dir: PathBuf::from("nonexistent"),
    };
    let mut app = router(config.clone()).unwrap();
    let mp3 = include_bytes!("fixtures/media/tone-48k-stereo-cbr192.mp3");
    let (status, upload) = json_request(
        &app,
        "POST",
        "/media/uploads",
        json!({
            "name":"Band take.mp3", "size":mp3.len(),
        }),
    )
    .await;
    assert_eq!(status, 201, "{upload}");
    let upload_path = format!("/media/uploads/{}", upload["id"].as_str().unwrap());
    let (status, _) = request(
        &app,
        "PUT",
        &format!("{upload_path}?offset=0"),
        Body::from(mp3.as_slice()),
    )
    .await;
    assert!(status.is_success());
    let source = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let (_, state) = json_request(&app, "GET", &upload_path, Value::Null).await;
            let import = &state["import"];
            if let Some(id) = import["asset"].as_str() {
                break id.to_owned();
            }
            assert_ne!(import["state"], "failed", "{import}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let (_, library) = json_request(&app, "GET", "/media", Value::Null).await;
    let original = &library["assets"][0];
    let frames = original["renders"][0]["frames"].as_u64().unwrap();
    let sample = [0.125f32.to_le_bytes(), (-0.125f32).to_le_bytes()].concat();
    let stem_data = sample.repeat(frames as usize);
    let song_path = format!("/media/songs/{source}");
    let mix_path = format!("{song_path}/mixes");
    let levels = json!({"gain_tenths_db":0,"muted":false,"solo":false});
    let mut saved_last = None;
    for (mode, id) in [
        (SplitMode::Four, "01JD2W8T3N8M4K6V0P7Q9R1S2T"),
        (SplitMode::Six, "01JD2W8T3N8M4K6V0P7Q9R1S2V"),
    ] {
        let dir = media.join("songs").join(&source).join("splits").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        for role in mode.roles() {
            std::fs::write(dir.join(format!("{}.f32", role.name())), &stem_data).unwrap();
        }
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&json!({
                "id":id, "sourceSha256":original["source"]["sha256"], "modelSha256":"a".repeat(64),
                "mode":mode, "rate":48_000, "frames":frames,
            }))
            .unwrap(),
        )
        .unwrap();
        let path = format!("{song_path}/splits/{id}");
        let (status, wav) = request(
            &app,
            "GET",
            &format!("{path}/stems/vocals/wav"),
            Body::empty(),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(wav.len() as u64, 58 + frames * 8);
        assert_eq!(&wav[58..], stem_data.as_slice());
        let (status, zip) = request(&app, "GET", &format!("{path}/stems.zip"), Body::empty()).await;
        assert_eq!(status, 200);
        verify_archive(&zip, mode, &wav);
        let mut recipe =
            json!({"mode":mode,"vocals":levels,"drums":levels,"bass":levels,"other":levels});
        if mode == SplitMode::Six {
            recipe["guitar"] = levels.clone();
            recipe["guitar"]["muted"] = true.into();
            recipe["piano"] = levels.clone();
        }
        recipe["vocals"]["gain_tenths_db"] = 20.into();
        let body = json!({"title":"Rehearsal mix","split":id,"recipe":recipe});
        let (status, saved) = json_request(&app, "POST", &mix_path, body.clone()).await;
        assert_eq!(status, 200, "{saved}");
        assert_eq!(saved["recipe"], recipe);
        saved_last = Some((body, saved));
    }
    drop(app);
    let rig = saved_rig(&config.preset_dir);
    app = router(config.clone()).unwrap();
    let (mut body, old) = saved_last.unwrap();
    let (status, reopened) = json_request(&app, "GET", &song_path, Value::Null).await;
    assert_eq!(status, 200, "{reopened}");
    assert_eq!(reopened["mixes"].as_array().unwrap().len(), 2);
    assert!(reopened["mixes"].as_array().unwrap().contains(&old));
    let targets = [
        json!({"scope":"rig","preset":{"kind":"rig","id":rig}}),
        json!({"scope":"set_list","preset":{"kind":"rig","id":rig}}),
    ];
    let mut links = json_request(&app, "GET", "/media/song-links", Value::Null)
        .await
        .1;
    for target in &targets {
        let (status, result) = json_request(&app, "POST", "/media/song-links", json!({
            "expected":links["revision"], "target":target, "mix":{"source":source,"mix":old["id"]},
        })).await;
        assert_eq!(status, 200, "{result}");
        links = result;
    }
    body["replace"] = json!({"id":old["id"],"revision":old["revision"]});
    body["title"] = "Stage mix".into();
    let (status, saved) = json_request(&app, "POST", &mix_path, body.clone()).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["id"], old["id"]);
    assert_ne!(saved["asset"], old["asset"]);
    assert_eq!(json_request(&app, "POST", &mix_path, body).await.0, 409);
    let asset = saved["asset"].as_str().unwrap();
    let (_, latest_links) = json_request(&app, "GET", "/media/song-links", Value::Null).await;
    assert_eq!(latest_links["links"].as_array().unwrap().len(), 2);
    assert!(
        latest_links["links"]
            .as_array()
            .unwrap()
            .iter()
            .all(|link| link["asset"] == asset)
    );
    let (status, mix) = request(
        &app,
        "GET",
        &format!("/media/assets/{asset}/wav"),
        Body::empty(),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(mix.len() as u64, 44 + frames * 6);
    assert_eq!(
        json_request(
            &app,
            "DELETE",
            &format!("/media/assets/{asset}"),
            Value::Null
        )
        .await
        .0,
        422
    );
    let (status, player) = json_request(
        &app,
        "POST",
        "/player/commands",
        json!({
            "requestId":"song-cue","origin":"api","command":{"kind":"cue","asset":asset},
        }),
    )
    .await;
    assert_eq!(status, 200, "{player}");
    assert_eq!(player["track"]["id"], asset);
    // A saved mix plays its stems live, with the saved settings.
    assert_eq!(player["stems"]["split"], "01JD2W8T3N8M4K6V0P7Q9R1S2V");
    assert_eq!(player["stems"]["roles"].as_array().unwrap().len(), 6);
    assert_eq!(player["stems"]["recipe"]["guitar"]["muted"], true);
    let mut live = player["stems"]["recipe"].clone();
    live["guitar"]["muted"] = false.into();
    live["drums"]["solo"] = true.into();
    let (status, state) = json_request(
        &app,
        "POST",
        "/player/commands",
        json!({
            "requestId":"live-mix", "origin":"api", "expectedCue":asset,
            "command":{"kind":"set_stem_mix","recipe":live},
        }),
    )
    .await;
    assert_eq!(status, 200, "{state}");
    assert_eq!(state["stems"]["recipe"], live);
    let split = player["stems"]["split"].clone();
    for (id, command, part) in [
        (
            "perform-mute",
            json!({"kind":"set_muted_part","split":split,"part":"guitar"}),
            json!("guitar"),
        ),
        (
            "other-viewer",
            json!({"kind":"edit_stem","split":split,"role":"bass","edit":{"field":"gain","value":-35}}),
            json!("guitar"),
        ),
        (
            "perform-clear",
            json!({"kind":"set_muted_part","split":split,"part":null}),
            Value::Null,
        ),
    ] {
        let (status, result) = json_request(
            &app,
            "POST",
            "/player/commands",
            json!({
                "requestId":id,"origin":"ui","expectedCue":asset,"command":command
            }),
        )
        .await;
        assert_eq!(status, 200, "{result}");
        if id == "other-viewer" {
            live["bass"]["gain_tenths_db"] = (-35).into();
        }
        assert_eq!(result["stems"]["recipe"], live);
        assert_eq!(result["stems"]["mutedPart"], part);
    }
    let (_, replay) = json_request(
        &app,
        "POST",
        "/player/commands",
        json!({
            "requestId":"perform-clear","origin":"ui","expectedCue":asset,
            "command":{"kind":"set_muted_part","split":split,"part":null}
        }),
    )
    .await;
    let (_, current) = json_request(&app, "GET", "/player", Value::Null).await;
    assert_eq!(replay["revision"], current["revision"]);
    let (status, _) = json_request(&app, "POST", "/player/commands", json!({
        "requestId":"outdated-editor","origin":"ui","expectedCue":asset,
        "command":{"kind":"set_stem_mix","recipe":live,"expected":player["stems"]["recipe"],"split":split}
    })).await;
    assert_eq!(status, 409);
    let four = json!({"mode":"four","vocals":levels,"drums":levels,"bass":levels,"other":levels});
    let (status, refused) = json_request(
        &app,
        "POST",
        "/player/commands",
        json!({
            "requestId":"live-wrong-mode", "origin":"api",
            "command":{"kind":"set_stem_mix","recipe":four},
        }),
    )
    .await;
    assert_eq!(status, 400, "{refused}");
    // The original song's other split plays live from the editor.
    let (status, state) = json_request(&app, "POST", "/player/commands", json!({
        "requestId":"live-four", "origin":"api",
        "command":{"kind":"cue_stems","source":source,"split":"01JD2W8T3N8M4K6V0P7Q9R1S2T","recipe":four},
    })).await;
    assert_eq!(status, 200, "{state}");
    assert_eq!(state["stems"]["roles"].as_array().unwrap().len(), 4);
    assert_eq!(state["track"]["id"], asset);
    let (status, idle) = json_request(&app, "GET", "/media/split-job", Value::Null).await;
    assert_eq!((status, idle), (200, Value::Null));
    let (status, list) = json_request(&app, "GET", "/media/songs", Value::Null).await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(list["songs"][0]["source"], source);
    assert_eq!(list["songs"][0]["splits"].as_array().unwrap().len(), 2);
    let (status, recued) = json_request(
        &app,
        "POST",
        "/player/commands",
        json!({
            "requestId":"song-recue", "origin":"api", "command":{"kind":"cue","asset":asset},
        }),
    )
    .await;
    assert_eq!(status, 200, "{recued}");
    // After a restart the restored mix plays its stems live again.
    drop(app);
    app = router(config.clone()).unwrap();
    let (_, restored) = json_request(&app, "GET", "/player", Value::Null).await;
    assert_eq!(restored["track"]["id"], asset);
    assert_eq!(restored["stems"]["split"], "01JD2W8T3N8M4K6V0P7Q9R1S2V");
    let (_, timing) = json_request(
        &app,
        "POST",
        &format!("/media/assets/{asset}/timing"),
        Value::Null,
    )
    .await;
    assert_eq!(timing["source"], source);
    assert_eq!(timing["peaks"].as_array().unwrap().len(), 240);
    for (index, command) in [
        json!({"kind":"set_practice_range","range":{"a":0,"b":6000}}),
        json!({"kind":"set_speed","percent":75}),
        json!({"kind":"set_click","click":{"kind":"manual","bpm_tenths":1200,"first_frame":0,"level_db":-18}}),
    ].into_iter().enumerate() {
        let (status, state) = json_request(&app, "POST", "/player/commands", json!({
            "requestId":format!("practice-{index}"), "origin":"api", "expectedCue":asset, "command":command,
        })).await;
        assert_eq!(status, 200, "{state}");
        assert_eq!(state["range"]["b"], 6000);
        if index >= 1 { assert_eq!(state["speedPercent"], 75) }
        if index == 2 { assert_eq!(state["click"]["kind"], "manual") }
    }
    let reference = json!({"id":saved["id"],"revision":saved["revision"]});
    assert_eq!(
        json_request(&app, "DELETE", &mix_path, reference.clone())
            .await
            .0,
        422
    );
    let mut latest = latest_links;
    for target in &targets {
        let (status, result) = json_request(
            &app,
            "POST",
            "/media/song-links",
            json!({
                "expected":latest["revision"], "target":target, "mix":null,
            }),
        )
        .await;
        assert_eq!(status, 200, "{result}");
        latest = result;
    }
    assert_eq!(
        json_request(&app, "DELETE", &mix_path, reference).await.0,
        204
    );
    let (_, remaining) = json_request(&app, "GET", &song_path, Value::Null).await;
    assert_eq!(remaining["mixes"].as_array().unwrap().len(), 1);
    assert_eq!(
        std::fs::read_dir(media.join("incoming")).unwrap().count(),
        0
    );
    drop(app);
    std::fs::remove_dir_all(root).unwrap();
}
