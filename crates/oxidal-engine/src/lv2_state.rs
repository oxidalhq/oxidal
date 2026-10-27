//! Verified bundle assets live until every plugin has finished cleanup.
use oxidal_lv2::{Plugin, PluginState, StatePath};
use oxidal_presets::{Bundle, manifest::Lv2Instance};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
const MAX_STATE_JSON: usize = 8 * 1024 * 1024;
#[derive(Debug, Default)]
pub(crate) struct Assets {
    root: Option<PathBuf>,
    paths: BTreeMap<String, Vec<StatePath>>,
}
impl Drop for Assets {
    fn drop(&mut self) {
        if let Some(root) = &self.root {
            let _ = fs::remove_dir_all(root);
        }
    }
}
impl Assets {
    pub fn new(bundle: &Bundle) -> Result<Self, String> {
        let mut assets = Self::default();
        let host = bundle
            .manifest()
            .oxidal
            .as_ref()
            .ok_or("Missing host graph")?;
        for instance in &host.lv2 {
            if instance.state.is_none() && !instance.assets.is_empty() {
                return Err("LV2 assets require a state resource".into());
            }
            let mut paths = Vec::new();
            for id in &instance.assets {
                if assets.root.is_none() {
                    for _ in 0..128 {
                        let root = std::env::temp_dir().join(format!(
                            "oxidal-state-{}-{}",
                            std::process::id(),
                            NEXT.fetch_add(1, Ordering::Relaxed)
                        ));
                        let mut builder = fs::DirBuilder::new();
                        #[cfg(unix)]
                        builder.mode(0o700);
                        match builder.create(&root) {
                            Ok(()) => {
                                assets.root = Some(root.clone());
                                assets.root = Some(root.canonicalize().map_err(|e| e.to_string())?);
                                break;
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                            Err(e) => return Err(e.to_string()),
                        }
                    }
                    if assets.root.is_none() {
                        return Err("Cannot allocate private LV2 asset directory".into());
                    }
                }
                let resource = bundle
                    .manifest()
                    .resources
                    .iter()
                    .find(|r| &r.id == id)
                    .ok_or("Missing LV2 asset declaration")?;
                let relative = std::path::Path::new(&resource.path);
                if !relative
                    .components()
                    .all(|c| matches!(c, Component::Normal(_)))
                {
                    return Err("Unsafe LV2 asset path".into());
                }
                let absolute = assets
                    .root
                    .as_ref()
                    .ok_or("Missing asset root")?
                    .join(relative);
                fs::create_dir_all(absolute.parent().ok_or("Invalid asset parent")?)
                    .map_err(|e| e.to_string())?;
                let mut options = fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options.open(&absolute).map_err(|e| e.to_string())?;
                file.write_all(bundle.resource(id).ok_or("Missing verified LV2 asset")?)
                    .map_err(|e| e.to_string())?;
                paths.push(StatePath {
                    absolute,
                    alias: resource.path.clone(),
                });
            }
            assets.paths.insert(instance.id.clone(), paths);
        }
        Ok(assets)
    }
    pub fn paths(&self, instance: &str) -> Result<&[StatePath], String> {
        self.paths
            .get(instance)
            .map(Vec::as_slice)
            .ok_or_else(|| "Missing LV2 instance asset ownership".into())
    }
    pub fn restore(
        &self,
        plugin: &mut Plugin,
        instance: &Lv2Instance,
        bundle: &Bundle,
    ) -> Result<(), String> {
        if let Some(id) = &instance.state {
            let bytes = bundle.resource(id).ok_or("Missing verified LV2 state")?;
            if bytes.len() > MAX_STATE_JSON {
                return Err("LV2 state JSON exceeds budget".into());
            }
            let state: PluginState =
                serde_json::from_slice(bytes).map_err(|_| "Invalid LV2 state document")?;
            plugin.restore_state(&state, self.paths(&instance.id)?)?;
        }
        Ok(())
    }
}
