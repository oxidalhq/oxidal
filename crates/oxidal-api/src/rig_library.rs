//! Portable authoring publishes immutable declarations and verified local resources.
//! It never starts a plugin, stops PCM or labels a document runtime-compatible.
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::{
    Bundle, BundleStore, Error, OwnedStore, Store,
    manifest::{Manifest, ResourceKind},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

// A 1 MiB exact JSON manifest may expand when escaped as a JSON string.
pub const PUBLISH_LIMIT: usize = 7 * 1024 * 1024;
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigDocument {
    pub revision: String,
    pub manifest: Manifest,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigEntry {
    pub revision: String,
    pub id: String,
    pub name: String,
    pub native_instances: usize,
    pub lv2_instances: usize,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigPage {
    pub presets: Vec<RigEntry>,
    pub next: Option<String>,
    pub native_profile: String,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResourceSource {
    Original { preset: String },
    Owned { preset: String },
    Bundle { revision: String, resource: String },
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigPublish {
    /// Exact manifest JSON: strict parsing also rejects duplicate keys in metadata.
    pub manifest_json: String,
    /// Each declared resource maps to an existing verified local payload.
    pub resources: BTreeMap<String, ResourceSource>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    after: Option<String>,
}
fn valid_revision(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
async fn job<F, T>(shared: Arc<Shared>, operation: F) -> Response
where
    F: FnOnce(PathBuf) -> Result<T, Error> + Send + 'static,
    T: Serialize + Send + 'static,
{
    let Ok(permit) = shared.bundle_work.clone().try_acquire_owned() else {
        return failure(
            StatusCode::CONFLICT,
            "Preset library operation already in progress",
        );
    };
    let root = shared.config.preset_dir.clone();
    // The blocking task retains admission if the requester disconnects. No file
    // reads/parsing/fsync execute on the async or audio threads.
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        operation(root)
    })
    .await
    {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(error)) => {
            let status = match &error {
                Error::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
                Error::Io(e) if e.kind() == std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            failure(status, &error.to_string())
        }
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Rig library operation failed",
        ),
    }
}
pub async fn list(
    State(shared): State<Arc<Shared>>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(StatusCode::BAD_REQUEST, "Invalid rig page query");
    };
    if query.after.as_ref().is_some_and(|v| !valid_revision(v)) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "Invalid rig page cursor");
    }
    job(shared, move |root| {
        let store = BundleStore::new(root.join("bundles"));
        let revisions: Vec<_> = store
            .list()?
            .into_iter()
            .filter(|r| query.after.as_ref().is_none_or(|after| r > after))
            .take(21)
            .collect();
        let mut presets = Vec::new();
        for revision in revisions.iter().take(20) {
            let m = store.manifest(revision)?;
            presets.push(RigEntry {
                revision: revision.clone(),
                id: m.id,
                name: m.name,
                native_instances: m.tone3000.instances.len(),
                lv2_instances: m.oxidal.as_ref().map_or(0, |h| h.lv2.len()),
            });
        }
        Ok(RigPage {
            next: (revisions.len() > 20).then(|| revisions[19].clone()),
            presets,
            native_profile: oxidal_engine::native_profile_id()
                .map_err(|_| Error::Invalid("Missing native profile"))?,
        })
    })
    .await
}
pub async fn read(State(shared): State<Arc<Shared>>, Path(revision): Path<String>) -> Response {
    job(shared, move |root| {
        let b = BundleStore::new(root.join("bundles")).read(&revision)?;
        Ok(RigDocument {
            revision,
            manifest: b.manifest().clone(),
        })
    })
    .await
}
pub async fn publish(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<RigPublish>, JsonRejection>,
) -> Response {
    let request = match body {
        Ok(Json(r)) => r,
        Err(e) => return failure(e.status(), "Invalid rig publication request"),
    };
    job(shared, move |root| {
        let manifest = Manifest::parse(request.manifest_json.as_bytes())?;
        manifest.check_required_extensions()?;
        if manifest.resources.len() != request.resources.len() {
            return Err(Error::Invalid("Resource bindings must match the manifest"));
        }
        let store = BundleStore::new(root.join("bundles"));
        let mut payloads = BTreeMap::new();
        // Load one source bundle at a time, never retain N complete source rigs.
        // Repeated references to the same revision are grouped to avoid repeated reads.
        let mut bundled: BTreeMap<String, Vec<(String, String, ResourceKind)>> = BTreeMap::new();
        for resource in &manifest.resources {
            let source = request
                .resources
                .get(&resource.id)
                .ok_or(Error::Invalid("Missing resource binding"))?;
            match source {
                ResourceSource::Bundle {
                    revision,
                    resource: id,
                } => bundled.entry(revision.clone()).or_default().push((
                    resource.id.clone(),
                    id.clone(),
                    resource.kind,
                )),
                source => {
                    if !matches!(
                        resource.kind,
                        ResourceKind::Tone3000Preset | ResourceKind::Tone3000Source
                    ) {
                        return Err(Error::Invalid(
                            "Native source requires a native resource kind",
                        ));
                    }
                    let bytes = match source {
                        ResourceSource::Original { preset } => {
                            Store::new(root.clone()).original(preset)?
                        }
                        ResourceSource::Owned { preset } => {
                            OwnedStore::new(root.join("owned")).read(preset)?.1
                        }
                        _ => unreachable!(),
                    };
                    // Verify before retaining/cloning: a forged small declaration
                    // must not accumulate large source payloads beyond its budget.
                    if bytes.len() as u64 != resource.bytes
                        || format!("{:x}", Sha256::digest(&bytes)) != resource.sha256
                    {
                        return Err(Error::Invalid("Resource binding integrity failed"));
                    }
                    payloads.insert(resource.id.clone(), bytes);
                }
            }
        }
        for (revision, bindings) in bundled {
            let source = store.read(&revision)?;
            for (target, id, kind) in bindings {
                let declaration = source
                    .manifest()
                    .resources
                    .iter()
                    .find(|r| r.id == id)
                    .ok_or(Error::Invalid("Missing source resource"))?;
                if declaration.kind != kind {
                    return Err(Error::Invalid("Cannot relabel stored resource kind"));
                }
                let expected = manifest
                    .resources
                    .iter()
                    .find(|r| r.id == target)
                    .ok_or(Error::Invalid("Missing target declaration"))?;
                if declaration.bytes != expected.bytes || declaration.sha256 != expected.sha256 {
                    return Err(Error::Invalid("Resource binding integrity failed"));
                }
                payloads.insert(
                    target,
                    source
                        .resource(&id)
                        .ok_or(Error::Invalid("Missing source payload"))?
                        .to_vec(),
                );
            }
        }
        let bundle = Bundle::from_parts(request.manifest_json.into_bytes(), payloads)?;
        let revision = store.save(&bundle)?;
        Ok(RigDocument { revision, manifest })
    })
    .await
}
