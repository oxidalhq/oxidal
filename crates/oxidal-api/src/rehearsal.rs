//! Offline rehearsal checks read the same saved references and device policy as recall.
use crate::{Shared, midi_recall, plugins, presets, set_order};
use axum::{
    Json,
    extract::State,
    response::{IntoResponse, Response},
};
use oxidal_presets::{BundleStore, EntrySettings, LibraryKind, OwnedStore, ResolvedOccurrence};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(rename = "RehearsalReport")]
pub struct Report {
    revision: String,
    entries: Vec<Entry>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(rename = "RehearsalEntry")]
struct Entry {
    id: String,
    name: String,
    status: Status,
    sound: Vec<String>,
    accompaniment: Vec<String>,
    sheet: Vec<String>,
}
#[derive(Debug, Copy, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[schemars(rename = "RehearsalStatus")]
enum Status {
    Prepared,
    LoadsOnRecall,
    Blocked,
}

fn sound_files(
    shared: &Shared,
    row: &ResolvedOccurrence,
    installed: &Result<oxidal_lv2::PluginCatalog, String>,
) -> Vec<String> {
    let root = &shared.config.preset_dir;
    let mut issues = vec![];
    if row.entry.preset.kind == LibraryKind::Owned {
        if let Err(error) = OwnedStore::new(root.join("owned")).read(&row.content) {
            issues.push(format!("Native preset or capture unavailable: {error}"));
        }
        return issues;
    }
    let store = BundleStore::new(root.join("bundles"));
    let manifest = match store.manifest(&row.content) {
        Ok(manifest) => manifest,
        Err(error) => return vec![format!("Saved rig unavailable: {error}")],
    };
    if let Err(error) = manifest.check_required_extensions() {
        issues.push(error.to_string());
    }
    if let Err(error) = store.read(&row.content) {
        let missing = store
            .unavailable_resources(&row.content)
            .unwrap_or_default();
        if missing.is_empty() {
            issues.push(format!("Required rig files failed verification: {error}"));
        } else {
            use oxidal_presets::manifest::ResourceKind;
            for file in missing {
                let kind = match file.kind {
                    ResourceKind::Tone3000Preset => "Native preset",
                    ResourceKind::Tone3000Source => "Native source",
                    ResourceKind::Lv2State => "Plugin state",
                    ResourceKind::Lv2Asset => "Plugin asset",
                };
                issues.push(format!("{kind} unavailable: {}", file.path));
            }
        }
    }
    for effect in manifest.oxidal.iter().flat_map(|host| &host.lv2) {
        let detail = match installed {
            Err(reason) => Some(format!("Could not check {}: {reason}", effect.plugin_uri)),
            Ok(catalog) => match catalog.plugins.iter().find(|p| p.uri == effect.plugin_uri) {
                None => Some(format!("Missing plugin: {}", effect.plugin_uri)),
                Some(plugin) => plugin
                    .unsupported
                    .as_ref()
                    .map(|reason| format!("{}: {reason}", plugin.name)),
            },
        };
        if let Some(detail) = detail
            && !issues.contains(&detail)
        {
            issues.push(detail);
        }
    }
    issues
}
pub(super) async fn read(State(shared): State<Arc<Shared>>) -> Response {
    let stream = midi_recall::stream(&shared);
    let rate = stream.as_ref().map_or(48000, |s| s.input.sample_rate);
    let installed = plugins::installed(&shared, rate)
        .await
        .map_err(|(_, reason)| reason);
    let worker = shared.clone();
    presets::job(shared, move |_| {
        let order = set_order::current(&worker)?;
        let mut entries = Vec::with_capacity(order.entries.len());
        let mut checked = BTreeMap::new();
        for row in &order.entries {
            let kind = row.entry.preset.kind;
            let mut sound = checked
                .entry((kind, row.content.clone()))
                .or_insert_with(|| sound_files(&worker, row, &installed))
                .clone();
            let check = |settings: EntrySettings| {
                set_order::validate(
                    &worker,
                    &worker.config.preset_dir,
                    kind,
                    &row.content,
                    &settings,
                )
                .err()
                .map(|e| e.to_string())
                .into_iter()
                .collect::<Vec<_>>()
            };
            let settings = &row.entry.settings;
            sound.extend(check(EntrySettings {
                scene: settings.scene.clone(),
                ..Default::default()
            }));
            let accompaniment = check(EntrySettings {
                track: settings.track.clone(),
                mix: settings.mix.clone(),
                ..Default::default()
            });
            let sheet = check(EntrySettings {
                sheet: settings.sheet.clone(),
                ..Default::default()
            });
            let policy = if kind == LibraryKind::Rig {
                midi_recall::rig_recall_policy(&worker, &row.content).map(|p| match p {
                    midi_recall::RigRecallPolicy::Current
                    | midi_recall::RigRecallPolicy::Prepared => Status::Prepared,
                    midi_recall::RigRecallPolicy::Loads => Status::LoadsOnRecall,
                })
            } else if stream.is_none() {
                Err("Choose an audio interface before recall".to_owned())
            } else if worker.protect.on() {
                Err("Protect allows only prepared switches".to_owned())
            } else {
                Ok(Status::LoadsOnRecall)
            };
            let status = policy.unwrap_or_else(|reason| {
                sound.push(reason);
                Status::Blocked
            });
            let status = if sound.is_empty() && accompaniment.is_empty() && sheet.is_empty() {
                status
            } else {
                Status::Blocked
            };
            entries.push(Entry {
                id: row.entry.id.clone(),
                name: row.name.clone(),
                status,
                sound,
                accompaniment,
                sheet,
            });
        }
        Ok(Json(Report {
            revision: order.revision,
            entries,
        })
        .into_response())
    })
    .await
}
