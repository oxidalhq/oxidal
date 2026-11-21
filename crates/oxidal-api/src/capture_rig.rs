//! Offline construction of a four-capture rig from verified Library models.
//! @see docs/mixed-engine.md
use crate::{Shared, failure, rig_library::RigDocument};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use oxidal_presets::Error;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaptureRole {
    Amp,
    FullRig,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RigCapture {
    pub asset: String,
    pub role: CaptureRole,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CaptureRigRequest {
    pub name: String,
    pub request_id: String,
    /// Clean, Crunch, Lead and Dirt, in that order.
    pub captures: [RigCapture; 4],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cabinet: Option<String>,
}

pub(super) async fn build(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<CaptureRigRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Send four captures with their confirmed roles",
        );
    };
    match create(shared, request).await {
        Ok(document) => Json(document).into_response(),
        Err(error) => match &error {
            Error::Conflict(_) => failure(StatusCode::CONFLICT, &error.to_string()),
            Error::Invalid(_) => failure(StatusCode::UNPROCESSABLE_ENTITY, &error.to_string()),
            Error::Io(reason) => {
                eprintln!("Offline capture build failed: {reason}");
                failure(StatusCode::SERVICE_UNAVAILABLE, &error.to_string())
            }
        },
    }
}

use oxidal_engine::protocol::StartRig;
use oxidal_presets::{
    Bundle, BundleStore, ModelStore,
    manifest::{
        Edge, Endpoint, GAIN_EXTENSION, Graph, Lv2Instance, NATIVE_SETTINGS_EXTENSION,
        NativeSettings, Node, NodeKind, Resource, ResourceKind, SCENES_EXTENSION, SceneGain,
    },
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const SCENES: [(&str, &str); 4] = [
    ("clean", "Clean"),
    ("crunch", "Crunch"),
    ("lead", "Lead"),
    ("dirt", "Dirt"),
];
const PREPARATION_LIMIT: Duration = Duration::from_secs(45);

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    request: String,
    revision: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn asset_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl CaptureRigRequest {
    fn validate(&mut self) -> Result<(), Error> {
        self.name = self.name.trim().to_owned();
        if !oxidal_audio::lifecycle::valid_preset_name(&self.name) {
            return Err(Error::Invalid("Enter a rig name"));
        }
        if !(1..=128).contains(&self.request_id.len())
            || !self
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(Error::Invalid("Invalid build request ID"));
        }
        if self.captures.iter().any(|row| !asset_id(&row.asset))
            || self.cabinet.as_deref().is_some_and(|id| !asset_id(id))
        {
            return Err(Error::Invalid("Choose verified local Library assets"));
        }
        if self.cabinet.is_some() && !self.captures.iter().any(|row| row.role == CaptureRole::Amp) {
            return Err(Error::Invalid(
                "A separate cabinet needs at least one amp capture",
            ));
        }
        Ok(())
    }

    fn verify_assets(&self, root: &Path) -> Result<(), Error> {
        let models = ModelStore::new(root.join("audition-models"));
        for capture in &self.captures {
            let asset = models
                .metadata(&capture.asset)
                .map_err(|_| Error::Invalid("A selected capture is unavailable"))?;
            if asset.format != "nam" {
                return Err(Error::Invalid("Scene captures must be NAM files"));
            }
            let known_role = match asset.tone["gear"].as_str() {
                Some("amp") => Some(CaptureRole::Amp),
                Some("amp-cab" | "full-rig") => Some(CaptureRole::FullRig),
                Some("pedal" | "cab" | "outboard" | "space") => {
                    return Err(Error::Invalid("Choose an amp or full-rig capture"));
                }
                _ => None,
            };
            if known_role.is_some_and(|role| role != capture.role) {
                return Err(Error::Invalid(
                    "The selected role conflicts with the saved capture type",
                ));
            }
        }
        if let Some(id) = &self.cabinet {
            let cabinet = models
                .metadata(id)
                .map_err(|_| Error::Invalid("The cabinet is unavailable"))?;
            if cabinet.format != "ir" {
                return Err(Error::Invalid("Choose a WAV cabinet response"));
            }
        }
        Ok(())
    }
}

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

async fn create(shared: Arc<Shared>, mut request: CaptureRigRequest) -> Result<RigDocument, Error> {
    request.validate()?;
    let permit = shared
        .bundle_work
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error::Conflict("A preset library operation is already in progress"))?;
    let library = shared.library_access.clone().read_owned().await;
    let root = fs::canonicalize(&shared.config.preset_dir)?;
    let work = root.join("capture-builds");
    fs::create_dir_all(&work)?;
    let key = digest(request.request_id.as_bytes());
    let fingerprint = digest(&serde_json::to_vec(&request).map_err(io::Error::other)?);
    let receipt_path = work.join(format!("{key}.json"));
    let prepared = work.join(format!("{key}.prepared"));
    let visible = BundleStore::new(root.join("bundles"));
    if let Some(receipt) = read_receipt(&receipt_path)? {
        if receipt.request != fingerprint {
            return Err(Error::Conflict(
                "The build request ID was already used for a different rig",
            ));
        }
        return tokio::task::spawn_blocking(move || {
            let (_permit, _library) = (permit, library);
            if let Ok(bundle) = visible.read(&receipt.revision) {
                return Ok(document(&bundle));
            }
            if !prepared.is_dir() {
                return Err(Error::Conflict(
                    "The rig made by this request is no longer available",
                ));
            }
            let bundle = visible.publish_prepared(
                &BundleStore::new(prepared.join("bundles")),
                &receipt.revision,
            )?;
            let _ = fs::remove_dir_all(prepared);
            Ok(document(&bundle))
        })
        .await
        .map_err(io::Error::other)?;
    }
    request.verify_assets(&root)?;
    let native = executable(shared.config.native_worker.as_deref())?;
    let rig = executable(shared.config.rig_worker.as_deref())?;
    let catalog = crate::plugins::installed(&shared, 48000)
        .await
        .map_err(|(_, reason)| io::Error::other(reason))?;
    let wet = wet_chain(&catalog)?;
    // Known incomplete directories are never visible in the Library. A
    // verified receipt is written before moving the final immutable payload.
    if prepared.exists() {
        fs::remove_dir_all(&prepared)?;
    }
    let mut nonce = [0; 16];
    getrandom::getrandom(&mut nonce)
        .map_err(|_| io::Error::other("Cannot create an isolated build directory"))?;
    let scratch = Scratch(work.join(format!(".{}", digest(&nonce))));
    fs::create_dir(&scratch.0)?;
    let runtime = scratch.0.join("runtime");
    fs::create_dir(&runtime)?;
    let mut payloads = BTreeMap::new();
    for ((id, name), capture) in SCENES.into_iter().zip(&request.captures) {
        let data = render_model(native, &root, &runtime, name, &capture.asset).await?;
        payloads.insert(id.to_owned(), data);
    }
    if let Some(asset) = &request.cabinet {
        payloads.insert(
            "cabinet".into(),
            render_model(native, &root, &runtime, "Cabinet", asset).await?,
        );
    }
    let staged = scratch.0.join("bundles");
    let (scratch, bundle) = tokio::task::spawn_blocking({
        let staged = staged.clone();
        move || {
            let bundle = make_bundle(&request, &key, payloads, wet)?;
            BundleStore::new(staged).save(&bundle)?;
            Ok::<_, Error>((scratch, bundle))
        }
    })
    .await
    .map_err(io::Error::other)??;
    let revision = bundle.revision().to_owned();
    drop(bundle);
    check_rig(rig, &root, &staged, &runtime, &revision).await?;

    // A reply lost after the receipt can finish publication of the identical
    // verified payload. Once published, the receipt cannot rebuild deleted bytes.
    tokio::task::spawn_blocking(move || {
        let (_permit, _library) = (permit, library);
        fs::rename(&scratch.0, &prepared)?;
        sync_dir(&work)?;
        let receipt = Receipt {
            request: fingerprint,
            revision,
        };
        crate::media::write_atomic(
            &receipt_path,
            &serde_json::to_vec(&receipt).map_err(io::Error::other)?,
        )?;
        let bundle = visible.publish_prepared(
            &BundleStore::new(prepared.join("bundles")),
            &receipt.revision,
        )?;
        let _ = fs::remove_dir_all(prepared);
        Ok(document(&bundle))
    })
    .await
    .map_err(io::Error::other)?
}

fn sync_dir(root: &Path) -> io::Result<()> {
    match fs::File::open(root)?.sync_all() {
        result if cfg!(target_os = "linux") => result,
        _ => Ok(()),
    }
}

fn document(bundle: &Bundle) -> RigDocument {
    RigDocument {
        revision: bundle.revision().to_owned(),
        manifest: bundle.manifest().clone(),
    }
}

fn read_receipt(path: &Path) -> Result<Option<Receipt>, Error> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(1025).read_to_end(&mut bytes)?;
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    if bytes.len() > 1024 || !asset_id(&receipt.request) || !asset_id(&receipt.revision) {
        return Err(Error::Invalid("Invalid build receipt"));
    }
    Ok(Some(receipt))
}

fn executable(path: Option<&Path>) -> Result<&Path, Error> {
    path.filter(|path| path.is_absolute() && path.is_file())
        .ok_or_else(|| io::Error::other("Isolated rig preparation is unavailable").into())
}

async fn worker(
    executable: &Path,
    mode: &str,
    root: &Path,
    runtime: &Path,
    store: Option<&Path>,
    request: &impl Serialize,
    limit: usize,
) -> Result<Vec<u8>, Error> {
    let mut request = serde_json::to_vec(request).map_err(io::Error::other)?;
    request.push(b'\n');
    let mut process = tokio::process::Command::new(executable);
    process
        .arg(mode)
        .env("OXIDAL_PRESET_DIR", root)
        .env("OXIDAL_QUALIFICATION_DATA", runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    if let Some(store) = store {
        process.env("OXIDAL_BUNDLE_STORE", store);
    }
    let mut child = process.spawn()?;
    let result = tokio::time::timeout(PREPARATION_LIMIT, async {
        let mut input = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("Missing preparation input"))?;
        input.write_all(&request).await?;
        drop(input);
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("Missing preparation output"))?
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.is_empty() || bytes.len() > limit || !child.wait().await?.success() {
            return Err(Error::Invalid("A capture or effect could not be prepared"));
        }
        Ok(bytes)
    })
    .await
    .unwrap_or_else(|_| {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "Isolated rig preparation timed out",
        )
        .into())
    });
    if result.is_err() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    result
}

async fn render_model(
    native: &Path,
    root: &Path,
    runtime: &Path,
    name: &str,
    asset: &str,
) -> Result<Vec<u8>, Error> {
    worker(
        native,
        "--render-model",
        root,
        runtime,
        None,
        &json!({"name":name,"asset":asset}),
        oxidal_presets::MAX_FILE_BYTES,
    )
    .await
}

async fn check_rig(
    rig: &Path,
    root: &Path,
    store: &Path,
    runtime: &Path,
    revision: &str,
) -> Result<(), Error> {
    let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture",
        "sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
    let mut output = input.clone();
    output["direction"] = json!("playback");
    let settings: StartRig = serde_json::from_value(json!({
        "revision":revision,"recall":null,
        "stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1],"hear_yourself":false}
    })).map_err(io::Error::other)?;
    let result = worker(
        rig,
        "--check-built-rig",
        root,
        runtime,
        Some(store),
        &settings,
        4096,
    )
    .await?;
    serde_json::from_slice::<Result<(), String>>(&result)
        .map_err(io::Error::other)?
        .map_err(|reason| {
            eprintln!("Offline capture rig did not prepare: {reason}");
            Error::Invalid("The four-scene rig could not be prepared")
        })
}

fn node(
    id: &str,
    kind: NodeKind,
    audio_inputs: u8,
    audio_outputs: u8,
    instance: bool,
    gains: Option<Vec<f64>>,
) -> Node {
    Node {
        id: id.into(),
        kind,
        audio_inputs,
        audio_outputs,
        instance: instance.then(|| id.into()),
        bypassed: instance.then_some(false),
        input_gains: gains,
    }
}

fn route(graph: &mut Graph, from: &str, from_port: u8, to: &str, to_port: u8) {
    graph.edges.push(Edge {
        from: Endpoint {
            node: from.into(),
            port: from_port,
        },
        to: Endpoint {
            node: to.into(),
            port: to_port,
        },
    });
}

fn stereo(node: &str) -> [Endpoint; 2] {
    [0, 1].map(|port| Endpoint {
        node: node.into(),
        port,
    })
}

fn feed(graph: &mut Graph, outputs: &[Endpoint; 2], to: &str) {
    for (port, from) in outputs.iter().enumerate() {
        route(graph, &from.node, from.port, to, port as u8);
    }
}

fn scene_returns(
    graph: &mut Graph,
    bus: &str,
    captures: &[usize],
    gains: &mut [Vec<SceneGain>; 4],
) -> [Endpoint; 2] {
    std::array::from_fn(|channel| {
        let id = format!("{bus}-{}", if channel == 0 { "left" } else { "right" });
        let kind = if captures.len() == 1 {
            NodeKind::Gain
        } else {
            NodeKind::Merge
        };
        let initial = captures
            .iter()
            .map(|&capture| f64::from(u8::from(capture == 0)))
            .collect();
        graph.nodes.push(node(
            &id,
            kind,
            captures.len() as u8,
            1,
            false,
            Some(initial),
        ));
        for (port, &capture) in captures.iter().enumerate() {
            let port = port as u8;
            route(graph, SCENES[capture].0, channel as u8, &id, port);
            gains[capture].push(SceneGain {
                node: id.clone(),
                port,
                value: 1.0,
            });
        }
        Endpoint { node: id, port: 0 }
    })
}

fn join_returns(graph: &mut Graph, a: &[Endpoint; 2], b: &[Endpoint; 2]) -> [Endpoint; 2] {
    std::array::from_fn(|channel| {
        let id = format!("combined-{channel}");
        graph.nodes.push(node(
            &id,
            NodeKind::Merge,
            2,
            1,
            false,
            Some(vec![1.0, 1.0]),
        ));
        for (port, from) in [&a[channel], &b[channel]].into_iter().enumerate() {
            route(graph, &from.node, from.port, &id, port as u8);
        }
        Endpoint { node: id, port: 0 }
    })
}

fn effect_recipe() -> [Lv2Instance; 2] {
    [
        (
            "echo",
            "urn:oxidal:plugin:echo#stereo",
            BTreeMap::from([
                ("mix".into(), 18.0),
                ("time".into(), 350.0),
                ("feedback".into(), 27.0),
            ]),
        ),
        (
            "bloom",
            "urn:oxidal:plugin:bloom#stereo",
            BTreeMap::from([("mix".into(), 12.0)]),
        ),
    ]
    .map(|(id, uri, controls)| Lv2Instance {
        id: id.into(),
        plugin_uri: uri.into(),
        controls,
        state: None,
        assets: vec![],
        required_features: vec![],
    })
}

fn wet_chain(catalog: &oxidal_lv2::PluginCatalog) -> Result<[Lv2Instance; 2], Error> {
    let mut chain = effect_recipe();
    for effect in &mut chain {
        let plugin = catalog
            .plugins
            .iter()
            .find(|plugin| plugin.uri == effect.plugin_uri && plugin.unsupported.is_none())
            .ok_or(Error::Invalid(
                "Install the stereo Oxidal Echo and Bloom effects",
            ))?;
        let overrides = std::mem::take(&mut effect.controls);
        for port in plugin
            .ports
            .iter()
            .filter(|port| port.input && port.control)
        {
            let value = overrides
                .get(&port.symbol)
                .copied()
                .or_else(|| port.default.map(f64::from))
                .ok_or(Error::Invalid(
                    "An installed effect has no portable default",
                ))?;
            effect.controls.insert(port.symbol.clone(), value);
        }
        if overrides
            .keys()
            .any(|key| !effect.controls.contains_key(key))
        {
            return Err(Error::Invalid(
                "An installed effect has changed its controls",
            ));
        }
    }
    Ok(chain)
}

fn make_bundle(
    request: &CaptureRigRequest,
    key: &str,
    payloads: BTreeMap<String, Vec<u8>>,
    wet: [Lv2Instance; 2],
) -> Result<Bundle, Error> {
    let profile = oxidal_engine::native_profile_id().map_err(io::Error::other)?;
    let id = format!(
        "{}-{}-4{}-a{}-{}",
        &key[..8],
        &key[8..12],
        &key[13..16],
        &key[17..20],
        &key[20..32]
    );
    let mut graph = Graph {
        nodes: vec![node("input", NodeKind::Input, 0, 2, false, None)],
        edges: Vec::new(),
    };
    for (channel, id) in ["split-left", "split-right"].into_iter().enumerate() {
        graph
            .nodes
            .push(node(id, NodeKind::Split, 1, 4, false, None));
        route(&mut graph, "input", channel as u8, id, 0);
    }
    let mut names = BTreeMap::new();
    for (index, (id, name)) in SCENES.into_iter().enumerate() {
        names.insert(id, name);
        graph
            .nodes
            .push(node(id, NodeKind::Tone3000, 2, 2, true, None));
        route(&mut graph, "split-left", index as u8, id, 0);
        route(&mut graph, "split-right", index as u8, id, 1);
    }
    let mut gains: [Vec<SceneGain>; 4] = std::array::from_fn(|_| Vec::new());
    let returns = if request.cabinet.is_some() {
        let (amps, full): (Vec<_>, Vec<_>) =
            (0..4).partition(|&i| request.captures[i].role == CaptureRole::Amp);
        let amp = scene_returns(&mut graph, "amp-return", &amps, &mut gains);
        graph
            .nodes
            .push(node("cabinet", NodeKind::Tone3000, 2, 2, true, None));
        feed(&mut graph, &amp, "cabinet");
        names.insert("cabinet", "Shared cabinet");
        let cabinet = stereo("cabinet");
        if full.is_empty() {
            cabinet
        } else {
            let full = scene_returns(&mut graph, "full-rig-return", &full, &mut gains);
            join_returns(&mut graph, &cabinet, &full)
        }
    } else {
        scene_returns(&mut graph, "capture-return", &[0, 1, 2, 3], &mut gains)
    };
    for (id, name) in [("echo", "Oxidal Echo"), ("bloom", "Oxidal Bloom")] {
        names.insert(id, name);
        graph.nodes.push(node(id, NodeKind::Lv2, 2, 2, true, None));
    }
    graph
        .nodes
        .push(node("output", NodeKind::Output, 2, 0, false, None));
    feed(&mut graph, &returns, "echo");
    feed(&mut graph, &stereo("echo"), "bloom");
    feed(&mut graph, &stereo("bloom"), "output");

    let mut targets: Vec<_> = gains.iter().flatten().cloned().collect();
    targets.sort_by(|a, b| (&a.node, a.port).cmp(&(&b.node, b.port)));
    let scenes = SCENES
        .into_iter()
        .zip(&gains)
        .map(|((id, name), selected)| {
            let mut all = targets.clone();
            for gain in &mut all {
                gain.value = f64::from(u8::from(selected.contains(gain)));
            }
            json!({"id":id,"name":name,"gains":all})
        })
        .collect::<Vec<_>>();
    let branches = SCENES
        .into_iter()
        .zip(&gains)
        .map(|((id, name), gains)| json!({"id":id,"name":name,"gains":gains}))
        .collect::<Vec<_>>();
    let declarations: Vec<_> = payloads
        .iter()
        .map(|(id, data)| Resource {
            id: id.clone(),
            path: format!("native/{id}.t3kpreset"),
            kind: ResourceKind::Tone3000Preset,
            sha256: digest(data),
            bytes: data.len() as u64,
        })
        .collect();
    let instances: Vec<_> = payloads
        .keys()
        .map(|id| json!({"id":id,"preset":id,"profile":profile}))
        .collect();
    // These one-capture branches start with a fixed 1× native processing
    // setup, independent of the machine defaults for a standalone preset.
    let settings = NativeSettings {
        input_mode: oxidal_audio::structure::InputMode::Stereo,
        parameters: BTreeMap::from([
            ("osEnabled".into(), 0.0),
            ("osFactor".into(), 0.0),
            ("pitchEnabled".into(), 0.0),
            ("pitchWindow".into(), 1.0 / 3.0),
            ("inputCalibrationLevel".into(), 0.6),
            ("calibrateInput".into(), 0.0),
            ("targetLoudness".into(), 0.7),
        ]),
    };
    let settings = payloads
        .keys()
        .map(|id| (id, &settings))
        .collect::<BTreeMap<_, _>>();
    let mut manifest = json!({
        "format":"oxidal.preset","formatVersion":1,"id":id,"name":request.name,
        "tone3000":{"instances":instances},"resources":declarations,
        "requiredExtensions":[SCENES_EXTENSION,NATIVE_SETTINGS_EXTENSION],
        "extensions":{
            SCENES_EXTENSION:{"fade_ms":30,"scenes":scenes,"branches":branches},
            NATIVE_SETTINGS_EXTENSION:{"instances":settings},
            "urn:oxidal:authoring":{"origin":"mine","labels":names}
        },
        "oxidal":{"graph":graph,"lv2":wet,"recall":{"tails":"cut"}}

    });
    if graph.nodes.iter().any(|node| node.kind == NodeKind::Gain) {
        manifest["requiredExtensions"]
            .as_array_mut()
            .unwrap()
            .push(json!(GAIN_EXTENSION));
        manifest["extensions"][GAIN_EXTENSION] = json!({});
    }
    Bundle::from_parts(
        serde_json::to_vec(&manifest).map_err(io::Error::other)?,
        payloads,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_amp_returns_reach_the_single_shared_cabinet_for_every_supported_partition() {
        let bytes =
            include_bytes!("../../oxidal-presets/tests/fixtures/authored-current.t3kpreset");
        for amp_count in 0..=4 {
            let mut request = CaptureRigRequest {
                name: "Four scenes".into(),
                request_id: "fixture".into(),
                captures: std::array::from_fn(|index| RigCapture {
                    asset: "a".repeat(64),
                    role: if index < amp_count {
                        CaptureRole::Amp
                    } else {
                        CaptureRole::FullRig
                    },
                }),
                cabinet: (amp_count != 0).then(|| "b".repeat(64)),
            };
            request.validate().unwrap();
            let mut payloads: BTreeMap<_, _> = SCENES
                .into_iter()
                .map(|(id, _)| (id.to_owned(), bytes.to_vec()))
                .collect();
            if request.cabinet.is_some() {
                payloads.insert("cabinet".into(), bytes.to_vec());
            }
            let bundle = make_bundle(&request, &"e".repeat(64), payloads, effect_recipe()).unwrap();
            let manifest = bundle.manifest();
            let graph = &manifest.oxidal.as_ref().unwrap().graph;
            let scenes = manifest.scenes().unwrap().unwrap();
            let reaches = |from: &str, goal| {
                let mut pending = vec![from];
                let mut visited = std::collections::BTreeSet::new();
                while let Some(node) = pending.pop() {
                    if node == goal {
                        return true;
                    }
                    if visited.insert(node) {
                        pending.extend(
                            graph
                                .edges
                                .iter()
                                .filter(|edge| edge.from.node == node)
                                .map(|edge| edge.to.node.as_str()),
                        );
                    }
                }
                false
            };
            for (index, (id, name)) in SCENES.into_iter().enumerate() {
                assert_eq!(scenes.scenes[index].id, id);
                assert_eq!(scenes.scenes[index].name, name);
                let audible: Vec<_> = scenes.scenes[index]
                    .gains
                    .iter()
                    .filter(|gain| gain.value == 1.0)
                    .collect();
                assert_eq!(audible.len(), 2);
                assert_eq!(
                    audible,
                    scenes.branches[index].gains.iter().collect::<Vec<_>>()
                );
                assert_eq!(reaches(id, "cabinet"), index < amp_count);
                assert!(reaches(id, "echo") && reaches(id, "bloom"));
            }
        }
    }
}
