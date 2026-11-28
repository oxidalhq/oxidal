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
use oxidal_audio::lifecycle::VersionTarget;
use oxidal_presets::{
    Bundle, BundleStore, Error, OwnedStore, Store,
    manifest::{Graph, Manifest, NodeKind, ResourceKind, RigSleepPlan},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
};

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
    pub origin: oxidal_presets::LibraryOrigin,
    pub native_instances: usize,
    pub lv2_instances: usize,
    pub topology: RigTopology,
    /// Scene names in pad order; empty for a preset without scenes.
    #[serde(default)]
    pub scenes: Vec<String>,
    /// Distinct LV2 plugin URIs the preset needs, so Effects can tell which
    /// presets an effect-pack removal would leave unplayable (7.17).
    #[serde(default)]
    pub lv2_plugins: Vec<String>,
    /// The preset's blocks in signal order (each path in turn after a split),
    /// so a list can draw the chain without opening the preset. A client
    /// names effects from the plugin URI with its own plugin catalog.
    #[serde(default)]
    pub blocks: Vec<RigBlock>,
}
/// One block of a saved preset, as a library list shows it.
#[derive(Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RigBlock {
    pub kind: RigBlockKind,
    /// The effect's LV2 plugin URI; absent for a capture (TONE3000) block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_uri: Option<String>,
    /// Saved turned off.
    #[serde(default)]
    pub bypassed: bool,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RigBlockKind {
    Tone3000,
    Lv2,
}
/// Blocks in signal order: a node comes after every node that feeds it, and
/// nodes that become ready together keep the order their edges are listed in,
/// so the paths of a split come one after another before what follows them.
fn chain_blocks(m: &Manifest) -> Vec<RigBlock> {
    let Some(host) = m.oxidal.as_ref() else {
        return Vec::new();
    };
    let graph = &host.graph;
    let mut waiting: BTreeMap<&str, usize> = BTreeMap::new();
    for edge in &graph.edges {
        *waiting.entry(edge.to.node.as_str()).or_default() += 1;
    }
    let mut ready: std::collections::VecDeque<&str> = graph
        .nodes
        .iter()
        .filter(|n| !waiting.contains_key(n.id.as_str()))
        .map(|n| n.id.as_str())
        .collect();
    let mut seen = BTreeSet::new();
    let mut blocks = Vec::new();
    while let Some(id) = ready.pop_front() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(node) = graph.nodes.iter().find(|n| n.id == id) {
            let bypassed = node.bypassed.unwrap_or(false);
            match node.kind {
                NodeKind::Tone3000 => blocks.push(RigBlock {
                    kind: RigBlockKind::Tone3000,
                    plugin_uri: None,
                    bypassed,
                }),
                NodeKind::Lv2 => blocks.push(RigBlock {
                    kind: RigBlockKind::Lv2,
                    plugin_uri: node.instance.as_ref().and_then(|instance| {
                        host.lv2
                            .iter()
                            .find(|i| &i.id == instance)
                            .map(|i| i.plugin_uri.clone())
                    }),
                    bypassed,
                }),
                _ => {}
            }
        }
        for edge in graph.edges.iter().filter(|e| e.from.node == id) {
            let to = edge.to.node.as_str();
            if let Some(count) = waiting.get_mut(to) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    ready.push_back(to);
                }
            }
        }
    }
    blocks
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RigTopology {
    Serial,
    Parallel,
    Scenes,
}
fn graph_has_parallel_paths(graph: &Graph) -> bool {
    let mut incoming: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut outgoing: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for edge in &graph.edges {
        outgoing
            .entry(&edge.from.node)
            .or_default()
            .insert(&edge.to.node);
        incoming
            .entry(&edge.to.node)
            .or_default()
            .insert(&edge.from.node);
    }
    incoming
        .values()
        .chain(outgoing.values())
        .any(|peers| peers.len() > 1)
}
#[cfg(test)]
mod topology_tests {
    use super::*;
    use oxidal_presets::manifest::{Edge, Endpoint};

    fn edge(from: &str, from_port: u8, to: &str, to_port: u8) -> Edge {
        Edge {
            from: Endpoint {
                node: from.into(),
                port: from_port,
            },
            to: Endpoint {
                node: to.into(),
                port: to_port,
            },
        }
    }
    fn graph(edges: Vec<Edge>) -> Graph {
        Graph {
            nodes: Vec::new(),
            edges,
        }
    }

    #[test]
    fn channel_adapters_remain_serial_but_distinct_branches_are_parallel() {
        let serial = graph(vec![
            edge("input", 0, "merge", 0),
            edge("input", 1, "merge", 1),
            edge("merge", 0, "effect", 0),
            edge("effect", 0, "split", 0),
            edge("split", 0, "output", 0),
            edge("split", 1, "output", 1),
        ]);
        assert!(!graph_has_parallel_paths(&serial));
        let parallel = graph(vec![
            edge("split", 0, "clean", 0),
            edge("split", 1, "heavy", 0),
            edge("clean", 0, "merge", 0),
            edge("heavy", 0, "merge", 1),
        ]);
        assert!(graph_has_parallel_paths(&parallel));
    }
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
pub struct RigNativeSource {
    pub preset: oxidal_presets::Inspection,
    pub source: ResourceSource,
}
pub async fn native_sources(State(shared): State<Arc<Shared>>) -> Response {
    job(shared, true, move |root| {
        let catalog = oxidal_presets::CatalogStore::open(root.clone())?;
        let originals = Store::new(root.clone())
            .list()?
            .presets
            .into_iter()
            .map(|preset| RigNativeSource {
                source: ResourceSource::Original {
                    preset: preset.sha256.clone(),
                },
                preset,
            });
        let owned = OwnedStore::new(root.join("owned"))
            .list()?
            .into_iter()
            .map(|p| RigNativeSource {
                preset: p.preset,
                source: ResourceSource::Owned { preset: p.id },
            });
        let mut visible = Vec::new();
        for mut source in originals.chain(owned) {
            let kind = match &source.source {
                ResourceSource::Original { .. } => oxidal_presets::LibraryKind::Original,
                _ => oxidal_presets::LibraryKind::Owned,
            };
            if catalog.visible(kind, &source.preset.sha256)? {
                source.preset.name = catalog
                    .label(kind, &source.preset.sha256, &source.preset.name)?
                    .into();
                visible.push(source);
            }
        }
        visible.sort_by_key(|s| {
            let kind = match &s.source {
                ResourceSource::Original { .. } => oxidal_presets::LibraryKind::Original,
                _ => oxidal_presets::LibraryKind::Owned,
            };
            catalog
                .position(kind, &s.preset.sha256)
                .unwrap_or(usize::MAX)
        });
        Ok(visible)
    })
    .await
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigPublish {
    /// Explicitly derive and publish verified closed sleep sends on this graph.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub prepare_sleep_branches: bool,
    /// Saving an explicit named version binds the edit to the catalog and source bytes.
    #[serde(default)]
    pub version_target: Option<VersionTarget>,
    /// Exact manifest JSON: strict parsing also rejects duplicate keys in metadata.
    pub manifest_json: String,
    /// Each declared resource maps to an existing verified local payload.
    pub resources: BTreeMap<String, ResourceSource>,
    /// Existing rig whose description, categories and copy credit follow this
    /// immutable revision. The source itself is never changed.
    #[serde(default)]
    pub source: Option<oxidal_presets::LibraryReference>,
    /// An edit of a preset that is not in Mine: the new revision is its
    /// unsaved working copy, hidden from the Library and the set list until
    /// the player keeps it. Needs `source`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub working: bool,
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
pub(crate) async fn job<F, T>(shared: Arc<Shared>, read_only: bool, operation: F) -> Response
where
    F: FnOnce(PathBuf) -> Result<T, Error> + Send + 'static,
    T: Serialize + Send + 'static,
{
    // Reads may overlap during navigation/React remounts. Queue their lightweight
    // declarations briefly; publication still refuses a competing large request.
    let permit = if read_only {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            shared.bundle_work.clone().acquire_owned(),
        )
        .await
        .ok()
        .and_then(Result::ok)
    } else {
        shared.bundle_work.clone().try_acquire_owned().ok()
    };
    let Some(permit) = permit else {
        return failure(
            StatusCode::CONFLICT,
            "Preset library operation already in progress",
        );
    };
    let root = shared.config.preset_dir.clone();
    // The blocking task retains admission if the requester disconnects. No file
    // reads/parsing/fsync execute on the async or audio threads.
    let access = shared.library_access.clone().read_owned().await;
    match tokio::task::spawn_blocking(move || {
        let _access = access;
        let _permit = permit;
        operation(root)
    })
    .await
    {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(error)) => {
            let status = match &error {
                Error::Conflict(_) => StatusCode::CONFLICT,
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
    job(shared, true, move |root| {
        let store = BundleStore::new(root.join("bundles"));
        let mut presets = Vec::new();
        for revision in store.list()? {
            let m = store.manifest(&revision)?;
            if m.extensions
                .get("urn:oxidal:authoring")
                .and_then(|a| a.get("draft"))
                == Some(&serde_json::Value::Bool(true))
            {
                continue;
            }
            let scenes: Vec<String> = m
                .scenes()
                .ok()
                .flatten()
                .map(|s| s.scenes.into_iter().map(|scene| scene.name).collect())
                .unwrap_or_default();
            let origin = oxidal_presets::LibraryOrigin::from_manifest(&m)?;
            let topology = if !scenes.is_empty() {
                RigTopology::Scenes
            } else if m
                .oxidal
                .as_ref()
                .is_some_and(|host| graph_has_parallel_paths(&host.graph))
            {
                RigTopology::Parallel
            } else {
                RigTopology::Serial
            };
            let blocks = chain_blocks(&m);
            presets.push(RigEntry {
                blocks,
                revision,
                id: m.id,
                name: m.name,
                origin,
                native_instances: m.tone3000.instances.len(),
                lv2_instances: m.oxidal.as_ref().map_or(0, |h| h.lv2.len()),
                lv2_plugins: m
                    .oxidal
                    .as_ref()
                    .map(|h| {
                        h.lv2
                            .iter()
                            .map(|i| i.plugin_uri.clone())
                            .collect::<BTreeSet<_>>()
                            .into_iter()
                            .collect()
                    })
                    .unwrap_or_default(),
                topology,
                scenes,
            });
        }
        let catalog = oxidal_presets::CatalogStore::open(root.clone())?;
        let kind = oxidal_presets::LibraryKind::Rig;
        let mut visible = Vec::new();
        for mut p in presets {
            if catalog.visible(kind, &p.revision)? {
                p.name = catalog.label(kind, &p.revision, &p.name)?.into();
                visible.push(p);
            }
        }
        visible.sort_by_key(|p| catalog.position(kind, &p.revision).unwrap_or(usize::MAX));
        let offset = match query.after {
            Some(id) => {
                visible
                    .iter()
                    .position(|p| p.revision == id)
                    .ok_or(Error::Invalid("Rig page changed; refresh the library"))?
                    + 1
            }
            None => 0,
        };
        let mut presets = visible
            .into_iter()
            .skip(offset)
            .take(21)
            .collect::<Vec<_>>();
        let next = if presets.len() > 20 {
            presets.pop();
            presets.last().map(|p| p.revision.clone())
        } else {
            None
        };
        Ok(RigPage {
            next,
            presets,
            native_profile: oxidal_engine::native_profile_id()
                .map_err(|_| Error::Invalid("Missing native profile"))?,
        })
    })
    .await
}
/// Copies one TONE3000 preset file of a saved rig into the originals library,
/// so the native editor can open it and save edited settings as an owned copy
/// (7.3). The rig itself is unchanged; the same bytes import once.
pub async fn import_resource(
    State(shared): State<Arc<Shared>>,
    Path((revision, resource)): Path<(String, String)>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason);
    }
    if !valid_revision(&revision) || resource.is_empty() || resource.len() > 128 {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "Invalid preset resource");
    }
    let presets = shared.presets.clone();
    job(shared, true, move |root| {
        let bundle = BundleStore::new(root.join("bundles")).read(&revision)?;
        let declared = bundle
            .manifest()
            .resources
            .iter()
            .find(|r| r.id == resource)
            .ok_or(Error::Invalid("Unknown preset resource"))?;
        if declared.kind != oxidal_presets::manifest::ResourceKind::Tone3000Preset {
            return Err(Error::Invalid(
                "Only TONE3000 preset resources can be edited",
            ));
        }
        let bytes = bundle
            .resource(&resource)
            .ok_or(Error::Invalid("Unknown preset resource"))?
            .to_vec();
        let mut store = presets
            .lock()
            .map_err(|_| Error::Io(std::io::Error::other("store lock failed")))?;
        store.import(&bytes)
    })
    .await
}
pub async fn read(State(shared): State<Arc<Shared>>, Path(revision): Path<String>) -> Response {
    job(shared, true, move |root| {
        let b = BundleStore::new(root.join("bundles")).read(&revision)?;
        Ok(RigDocument {
            revision,
            manifest: b.manifest().clone(),
        })
    })
    .await
}
pub async fn sleep_plan(
    State(shared): State<Arc<Shared>>,
    Path(revision): Path<String>,
) -> Response {
    if !valid_revision(&revision) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "Invalid rig revision");
    }
    job(shared, true, move |root| {
        let manifest = BundleStore::new(root.join("bundles")).manifest(&revision)?;
        manifest.check_required_extensions()?;
        Ok::<RigSleepPlan, Error>(manifest.preview_sleep_branches())
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
    if request.prepare_sleep_branches
        && let Some(reason) = shared.protect.refuse(false)
    {
        return crate::protect::locked(reason);
    }
    job(shared, false, move |root| {
        if request.working && (request.source.is_none() || request.version_target.is_some()) {
            return Err(Error::Invalid("A working copy names its source"));
        }
        let mut manifest = Manifest::parse(request.manifest_json.as_bytes())?;
        manifest.check_required_extensions()?;
        let manifest_bytes = if request.prepare_sleep_branches {
            manifest.prepare_sleep_branches()?;
            manifest.encode()?
        } else {
            request.manifest_json.into_bytes()
        };
        if let Some(source) = &request.source {
            if source.kind != oxidal_presets::LibraryKind::Rig {
                return Err(Error::Invalid("A rig copy must name a rig source"));
            }
            BundleStore::new(root.join("bundles")).manifest(&source.id)?;
        }
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
        // Saving your own preset again keeps its identity (manifest id) and its
        // place: the new revision replaces the earlier one in the set list.
        let mine = |m: &Manifest| {
            oxidal_presets::LibraryOrigin::from_manifest(m)
                .is_ok_and(|o| o == oxidal_presets::LibraryOrigin::Mine)
        };
        let replaces = match &request.source {
            Some(source) => {
                let earlier = store.manifest(&source.id)?;
                earlier.id == manifest.id && mine(&earlier) && mine(&manifest)
            }
            None => false,
        };
        let bundle = Bundle::from_parts(manifest_bytes, payloads)?;
        if let Some(target) = request.version_target {
            if !replaces || request.source.as_ref().is_none_or(|source| source.id != target.expected_content) {
                return Err(Error::Invalid("Save a named version from its current owned source"));
            }
            let kind = oxidal_presets::LibraryKind::Rig;
            let revision = bundle.revision().to_owned();
            let source = request.source.as_ref().ok_or(Error::Invalid("Missing version source"))?;
            let dest = oxidal_presets::LibraryReference { kind, id: revision.clone() };
            // Prepare copies before exposing the target, leaving other versions' data intact.
            oxidal_presets::CatalogStore::publish_version(&root,kind,&source.id,target,&revision,|| {
                store.save(&bundle)?;
                oxidal_presets::MidiMapStore::new(root.clone()).follow_rig(&manifest, source, &dest, true)?;
                oxidal_presets::DetailsStore::new(root.clone()).inherit(dest.clone(), source.clone())?;
                Ok(())
            })?;
            return Ok(RigDocument { revision, manifest });
        }
        // Another browser saved this preset since this edit began: refuse
        // before writing, so the newer save is never silently replaced (C1).
        // Publishes are serialized by `bundle_work`, so the check cannot race.
        if replaces && let Some(source) = &request.source {
            let catalog = oxidal_presets::CatalogStore::open(root.clone())?;
            let rig = oxidal_presets::LibraryKind::Rig;
            if catalog.is_superseded(rig, &source.id)? {
                // The same save arriving again after a lost reply produces the
                // same revision, already stored and current: answer it as the
                // first time without repeating any library change (7.24).
                if store.read(bundle.revision()).is_ok()
                    && !catalog.is_superseded(rig, bundle.revision())?
                {
                    return Ok(RigDocument {
                        revision: bundle.revision().to_owned(),
                        manifest,
                    });
                }
                return Err(Error::Conflict(
                    "This preset was saved again from another screen. Reopen it to see the latest version, then make your change again.",
                ));
            }
        }
        let revision = store.save(&bundle)?;
        if let Some(source) = &request.source
            && replaces
        {
            oxidal_presets::CatalogStore::open(root.clone())?.supersede(
                oxidal_presets::LibraryKind::Rig,
                &source.id,
                &revision,
            )?;
            // MIDI assignments follow the saved preset; scene bindings follow
            // the scene id, so renaming or reordering scenes keeps them.
            // Assignments of a removed scene, path or block are dropped, and
            // the map moves so the earlier revision keeps no copy.
            oxidal_presets::MidiMapStore::new(root.clone()).follow_rig(&manifest, source, &oxidal_presets::LibraryReference { kind: oxidal_presets::LibraryKind::Rig, id: revision.clone() }, false)?;
        }
        let working = request.working;
        let working_source = request.source.as_ref().map(|source| source.id.clone());
        if let Some(source) = request.source {
            oxidal_presets::DetailsStore::new(root.clone()).inherit(
                oxidal_presets::LibraryReference {
                    kind: oxidal_presets::LibraryKind::Rig,
                    id: revision.clone(),
                },
                source,
            )?;
        }
        if working && !replaces {
            if let Some(source) = working_source {
                oxidal_presets::CatalogStore::open(root.clone())?.mark_working(
                    oxidal_presets::LibraryKind::Rig,
                    &revision,
                    &source,
                )?;
            }
        }
        if !replaces && oxidal_presets::LibraryOrigin::from_manifest(&manifest)?
            == oxidal_presets::LibraryOrigin::Mine
        {
            oxidal_presets::MidiMapStore::new(root).inherit_template(
                oxidal_presets::LibraryReference {
                    kind: oxidal_presets::LibraryKind::Rig,
                    id: revision.clone(),
                },
                &oxidal_presets::MidiTemplateTargets::from_manifest(&manifest)?,
            )?;
        }
        Ok(RigDocument { revision, manifest })
    })
    .await
}

/// The copy Duplicate makes: same scenes, routing, resources and levels as the
/// source, a new preset identity and name, always in Mine.
pub(crate) struct Duplicated {
    pub revision: String,
    pub source_id: String,
    pub id: String,
}
/// Saves "Name copy" of a published preset with scenes. The source revision
/// is never changed. Caller holds `bundle_work` and the library read lock.
pub(crate) fn duplicate(
    root: &std::path::Path,
    revision: &str,
    name: &str,
) -> Result<Duplicated, Error> {
    let store = BundleStore::new(root.join("bundles"));
    let source = store.read(revision)?;
    let mut manifest = source.manifest().clone();
    let source_id = manifest.id.clone();
    // A new stable identity: levels, MIDI and Keep ready follow it separately.
    let hex = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "oxidal-duplicate:{revision}:{}:{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| Error::Invalid("Invalid system clock"))?
                    .as_nanos()
            )
            .as_bytes()
        )
    );
    manifest.id = format!(
        "{}-{}-4{}-8{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[13..16],
        &hex[17..20],
        &hex[20..32]
    );
    manifest.name = name.to_owned();
    let authoring = manifest
        .extensions
        .entry("urn:oxidal:authoring".into())
        .or_default();
    authoring.insert("origin".into(), serde_json::Value::String("mine".into()));
    authoring.remove("draft");
    let bytes =
        serde_json::to_vec(&manifest).map_err(|_| Error::Invalid("Invalid preset manifest"))?;
    let payloads = manifest
        .resources
        .iter()
        .map(|resource| {
            source
                .resource(&resource.id)
                .map(|bytes| (resource.id.clone(), bytes.to_vec()))
                .ok_or(Error::Invalid("Missing source payload"))
        })
        .collect::<Result<BTreeMap<_, _>, Error>>()?;
    let bundle = Bundle::from_parts(bytes, payloads)?;
    let revision = store.save(&bundle)?;
    Ok(Duplicated {
        revision,
        source_id,
        id: manifest.id,
    })
}

#[cfg(test)]
mod chain_block_tests {
    use super::*;
    use serde_json::json;

    /// in → split → (a | b, off) → merge → c → out lists a, b, then c.
    #[test]
    fn lists_blocks_path_by_path_in_signal_order() {
        let node = |id: &str, kind: &str, instance: Option<&str>| {
            let mut n = json!({"id": id, "kind": kind, "audioInputs": 1, "audioOutputs": 1});
            if let Some(i) = instance {
                n["instance"] = json!(i);
            }
            n
        };
        let edge = |from: &str, to: &str| json!({"from": {"node": from, "port": 0}, "to": {"node": to, "port": 0}});
        let mut b = node("b", "lv2", Some("verb"));
        b["bypassed"] = json!(true);
        let m: Manifest = serde_json::from_value(json!({
            "format": "oxidal.preset", "formatVersion": 1,
            "id": "21915afb-b95b-4b74-a88c-537f06d3594a", "name": "Paths",
            "tone3000": {"instances": []},
            "oxidal": {
                "graph": {
                    // Listed out of order on purpose: the walk follows the wires.
                    "nodes": [
                        node("c", "lv2", Some("echo")), node("out", "output", None),
                        node("merge", "merge", None), b, node("a", "lv2", Some("drive")),
                        node("split", "split", None), node("in", "input", None),
                    ],
                    "edges": [
                        edge("in", "split"), edge("split", "a"), edge("split", "b"),
                        edge("a", "merge"), edge("b", "merge"), edge("merge", "c"),
                        edge("c", "out"),
                    ],
                },
                "lv2": [
                    {"id": "drive", "pluginUri": "urn:drive", "controls": {}, "assets": [], "requiredFeatures": []},
                    {"id": "verb", "pluginUri": "urn:verb", "controls": {}, "assets": [], "requiredFeatures": []},
                    {"id": "echo", "pluginUri": "urn:echo", "controls": {}, "assets": [], "requiredFeatures": []},
                ],
                "recall": {"tails": "cut"},
            },
            "resources": [], "extensions": {}, "requiredExtensions": [],
        }))
        .unwrap();
        let uris: Vec<_> = chain_blocks(&m)
            .into_iter()
            .map(|b| (b.plugin_uri.unwrap(), b.bypassed))
            .collect();
        assert_eq!(
            uris,
            [
                ("urn:drive".to_string(), false),
                ("urn:verb".to_string(), true),
                ("urn:echo".to_string(), false),
            ]
        );
    }
}
