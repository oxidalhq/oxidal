//! Download a TONE3000 capture on the player's request and turn it into a usable
//! one-model native preset, in an isolated worker. Nothing here plays audio or
//! changes the sounding rig. The device remembers which owned preset holds each
//! capture, so a second request reuses it instead of downloading again.
//! @see docs/factory-collection.md
use super::download::StageModel;
use crate::{
    Shared, failure,
    rig_library::{ResourceSource, RigNativeSource},
};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::OwnedStore;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

const FILE: &str = "voice-captures.json";
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 2000;

/// One serialised voice download at a time: it is also the rate limit.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceRequest {
    pub tone_id: u64,
    pub model_id: u64,
    /// The name the player sees in their library, normally the capture's own title.
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceCapture {
    pub tone_id: u64,
    pub model_id: u64,
    pub source: RigNativeSource,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceReady {
    pub capture: VoiceCapture,
    /// False when the device already held this capture and nothing was downloaded.
    pub downloaded: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceList {
    pub captures: Vec<VoiceCapture>,
}

/// `tone:model` to owned preset id, kept beside the library.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Captures(BTreeMap<String, String>);

fn key(tone: u64, model: u64) -> String {
    format!("{tone}:{model}")
}

impl Captures {
    fn load(root: &Path) -> Result<Self, &'static str> {
        let path = root.join(FILE);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(_) => return Err("Cannot read the downloaded-capture list"),
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_FILE_BYTES {
            return Err("The downloaded-capture list is invalid");
        }
        let bytes = std::fs::read(&path).map_err(|_| "Cannot read the downloaded-capture list")?;
        serde_json::from_slice(&bytes).map_err(|_| "The downloaded-capture list is invalid")
    }
    fn save(&self, root: &Path) -> Result<(), &'static str> {
        use std::io::Write;
        if self.0.len() > MAX_ENTRIES {
            return Err("Too many downloaded captures");
        }
        let bytes =
            serde_json::to_vec(self).map_err(|_| "Cannot write the downloaded-capture list")?;
        let temporary = root.join(format!("{FILE}.{}.tmp", std::process::id()));
        let result = (|| -> std::io::Result<()> {
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            std::fs::rename(&temporary, root.join(FILE))?;
            std::fs::File::open(root)?.sync_all()
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map_err(|_| "Cannot write the downloaded-capture list")
    }
}

fn source(root: &Path, id: &str) -> Option<RigNativeSource> {
    let (info, _) = OwnedStore::new(root.join("owned")).read(id).ok()?;
    Some(RigNativeSource {
        preset: info.preset,
        source: ResourceSource::Owned { preset: info.id },
    })
}

/// Captures already on this device whose owned preset still exists.
fn present(root: &Path) -> Result<Vec<VoiceCapture>, &'static str> {
    Ok(Captures::load(root)?
        .0
        .iter()
        .filter_map(|(entry, id)| {
            let (tone, model) = entry.split_once(':')?;
            Some(VoiceCapture {
                tone_id: tone.parse().ok()?,
                model_id: model.parse().ok()?,
                source: source(root, id)?,
            })
        })
        .collect())
}

pub(crate) async fn list(State(shared): State<Arc<Shared>>) -> Response {
    let root = shared.config.preset_dir.clone();
    match tokio::task::spawn_blocking(move || present(&root)).await {
        Ok(Ok(captures)) => Json(VoiceList { captures }).into_response(),
        Ok(Err(error)) => failure(StatusCode::INTERNAL_SERVER_ERROR, error),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Capture list stopped"),
    }
}

pub(crate) async fn create(
    State(shared): State<Arc<Shared>>,
    Json(request): Json<VoiceRequest>,
) -> Response {
    let name = request.name.trim().to_owned();
    if request.tone_id == 0
        || request.model_id == 0
        || !oxidal_audio::lifecycle::valid_preset_name(&name)
    {
        return failure(StatusCode::BAD_REQUEST, "Choose a capture and a valid name");
    }
    let Some(worker) = shared.config.native_worker.clone() else {
        return failure(StatusCode::SERVICE_UNAVAILABLE, "Native worker unavailable");
    };
    let _one = ONE_AT_A_TIME.lock().await;
    let root = shared.config.preset_dir.clone();
    // A capture that is already here is reused, never downloaded twice.
    let existing = {
        let (root, tone, model) = (root.clone(), request.tone_id, request.model_id);
        tokio::task::spawn_blocking(move || {
            let captures = Captures::load(&root)?;
            Ok::<_, &'static str>(
                captures
                    .0
                    .get(&key(tone, model))
                    .and_then(|id| source(&root, id)),
            )
        })
        .await
    };
    match existing {
        Ok(Ok(Some(source))) => {
            return Json(VoiceReady {
                capture: VoiceCapture {
                    tone_id: request.tone_id,
                    model_id: request.model_id,
                    source,
                },
                downloaded: false,
            })
            .into_response();
        }
        Ok(Ok(None)) => (),
        Ok(Err(error)) => return failure(StatusCode::INTERNAL_SERVER_ERROR, error),
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "Capture check stopped"),
    }
    let staged = match shared
        .account
        .stage_model(
            StageModel {
                tone_id: request.tone_id,
                model_id: request.model_id,
            },
            root.join("audition-models"),
            Some(shared.library_access.clone()),
        )
        .await
    {
        Ok(staged) => staged,
        Err(error) => return failure(StatusCode::BAD_GATEWAY, error),
    };
    let _library = shared.library_access.read().await;
    let id = match run_worker(&worker, &root, &name, &staged.id).await {
        Ok(id) => id,
        Err(error) => return failure(StatusCode::BAD_GATEWAY, &error),
    };
    let (tone, model) = (request.tone_id, request.model_id);
    let saved = {
        let root = root.clone();
        tokio::task::spawn_blocking(move || {
            let mut captures = Captures::load(&root)?;
            captures.0.insert(key(tone, model), id.clone());
            captures.save(&root)?;
            source(&root, &id).ok_or("The new preset could not be read back")
        })
        .await
    };
    match saved {
        Ok(Ok(source)) => Json(VoiceReady {
            capture: VoiceCapture {
                tone_id: tone,
                model_id: model,
                source,
            },
            downloaded: true,
        })
        .into_response(),
        Ok(Err(error)) => failure(StatusCode::INTERNAL_SERVER_ERROR, error),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Saving the capture stopped",
        ),
    }
}

/// The one-shot worker prints the new owned preset id on one line.
async fn run_worker(
    worker: &PathBuf,
    root: &Path,
    name: &str,
    asset: &str,
) -> Result<String, String> {
    if !worker.is_absolute() || !worker.is_file() {
        return Err("Native worker unavailable".into());
    }
    let root = std::fs::canonicalize(root).map_err(|_| "Library unavailable".to_owned())?;
    let mut request = serde_json::to_vec(&serde_json::json!({"name": name, "asset": asset}))
        .map_err(|_| "Invalid preset request".to_owned())?;
    request.push(b'\n');
    let mut child = Command::new(worker)
        .arg("--create-from-model")
        .env("OXIDAL_PRESET_DIR", &root)
        .env("OXIDAL_QUALIFICATION_DATA", root.join("create-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Cannot start the native worker".to_owned())?;
    std::fs::create_dir_all(root.join("create-runtime"))
        .map_err(|_| "Library unavailable".to_owned())?;
    let result = tokio::time::timeout(Duration::from_secs(60), async {
        let mut input = child.stdin.take().ok_or("Worker input unavailable")?;
        input
            .write_all(&request)
            .await
            .map_err(|_| "Worker input failed")?;
        drop(input);
        let mut output = vec![];
        child
            .stdout
            .take()
            .ok_or("Worker output unavailable")?
            .take(256)
            .read_to_end(&mut output)
            .await
            .map_err(|_| "Worker output failed")?;
        let status = child.wait().await.map_err(|_| "Worker stopped")?;
        let line = String::from_utf8(output).map_err(|_| "Invalid worker reply")?;
        let id = line.trim_end_matches('\n');
        if !status.success()
            || id.is_empty()
            || id.len() > 128
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("The preset could not be created from this capture");
        }
        Ok::<_, &'static str>(id.to_owned())
    })
    .await;
    match result {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            let _ = child.start_kill();
            Err("Creating the preset timed out".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("oxidal-voice-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_capture_list_round_trips_and_ignores_missing_presets() {
        let root = temp("list");
        assert!(Captures::load(&root).unwrap().0.is_empty());
        let mut captures = Captures::default();
        captures
            .0
            .insert(key(65227, 385845), "missing-owned-id".into());
        captures.save(&root).unwrap();
        let loaded = Captures::load(&root).unwrap();
        assert_eq!(loaded.0.get("65227:385845").unwrap(), "missing-owned-id");
        // The owned preset does not exist, so it is not reported as present.
        assert!(present(&root).unwrap().is_empty());
        assert!(!std::fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn an_oversized_or_corrupt_list_is_rejected() {
        let root = temp("bad");
        std::fs::write(root.join(FILE), b"not json").unwrap();
        assert!(Captures::load(&root).is_err());
        std::fs::write(root.join(FILE), vec![b' '; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(Captures::load(&root).is_err());
    }

    /// Runs only where the real native worker and a test model are provided.
    #[tokio::test]
    async fn the_real_worker_turns_a_staged_model_into_a_one_model_preset() {
        let (Some(worker), Some(model)) = (
            std::env::var_os("OXIDAL_TEST_NATIVE_WORKER"),
            std::env::var_os("OXIDAL_TONE3000_TEST_MODEL"),
        ) else {
            return;
        };
        let root = temp("real");
        let bytes = std::fs::read(model).unwrap();
        let sha256 = {
            use sha2::{Digest, Sha256};
            format!("{:x}", Sha256::digest(&bytes))
        };
        let asset = oxidal_presets::ModelStore::new(root.join("audition-models"))
            .stage(
                &oxidal_presets::ModelAsset {
                    schema: 1,
                    tone_id: 21,
                    model_id: 23,
                    title: "Voice fixture".into(),
                    name: "Voice A2".into(),
                    format: "nam".into(),
                    sha256,
                    tone: serde_json::json!({"id":21,"title":"Voice fixture","format":"nam",
                        "gear":"amp-cab","models":[{"id":23,"name":"Voice A2",
                        "model_url":"oxidal-model://fixture/model.nam"}]}),
                },
                &bytes,
            )
            .unwrap();
        let id = run_worker(&PathBuf::from(worker), &root, "Voice fixture", &asset)
            .await
            .unwrap();
        let found = source(&root, &id).expect("owned preset readable");
        assert_eq!(found.preset.name, "Voice fixture");
        assert!(matches!(found.source, ResourceSource::Owned { .. }));
        // An unknown asset fails cleanly and adds nothing.
        assert!(
            run_worker(
                &PathBuf::from(std::env::var_os("OXIDAL_TEST_NATIVE_WORKER").unwrap()),
                &root,
                "Missing",
                &"0".repeat(64)
            )
            .await
            .is_err()
        );
        assert_eq!(OwnedStore::new(root.join("owned")).list().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_worker_must_be_a_real_file_and_reply_with_one_id() {
        let root = temp("worker");
        assert!(
            run_worker(&root.join("nope"), &root, "Name", &"a".repeat(64))
                .await
                .is_err()
        );
        let script = root.join("worker.sh");
        std::fs::write(&script, "#!/bin/sh\ncat >/dev/null\necho abc-123\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let id = run_worker(&script, &root, "Name", &"a".repeat(64))
            .await
            .unwrap();
        assert_eq!(id, "abc-123");
        std::fs::write(&script, "#!/bin/sh\ncat >/dev/null\necho 'bad id'\n").unwrap();
        assert!(
            run_worker(&script, &root, "Name", &"a".repeat(64))
                .await
                .is_err()
        );
        std::fs::write(&script, "#!/bin/sh\ncat >/dev/null\nexit 1\n").unwrap();
        assert!(
            run_worker(&script, &root, "Name", &"a".repeat(64))
                .await
                .is_err()
        );
    }
}
