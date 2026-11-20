use super::{AudioChangeHardware, AudioChangeOwner, REQUEST_BYTES};
use crate::{media, playback_recovery, rig_recovery};
use oxidal_lv2::protocol::{REQUEST_LIMIT, StartGraph};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MARKER: &str = "pending-audio-change.json";
const GRAPH: &str = "last-graph-session.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Marker {
    schema: u32,
    pub id: String,
    pub owner: AudioChangeOwner,
    pub previous: AudioChangeHardware,
    pub candidate: AudioChangeHardware,
}

fn read<T: DeserializeOwned>(path: &Path, limit: usize) -> Result<Option<T>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.len() >= limit as u64 {
        return Err("Audio recovery is not a bounded regular file".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(limit as u64).read_to_end(&mut bytes))
        .map_err(|error| error.to_string())?;
    if bytes.len() >= limit {
        return Err("Audio recovery exceeds its byte limit".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn atomic(path: &Path, value: &impl Serialize, limit: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() >= limit {
        return Err("Audio recovery exceeds its byte limit".into());
    }
    let parent = path.parent().ok_or("Audio recovery directory missing")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".audio-recovery-{}.tmp", media::new_id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file.write_all(&bytes).and_then(|()| file.sync_all());
    drop(file);
    let result = written.and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
        .and_then(|()| media::sync_dir(parent))
        .map_err(|error| error.to_string())
}

fn marker_path(root: &Path) -> PathBuf {
    root.join(MARKER)
}

fn marker(root: &Path) -> Result<Option<Marker>, String> {
    let value = read::<Marker>(&marker_path(root), REQUEST_BYTES)?;
    if let Some(marker) = &value {
        if marker.schema != 1 || !media::valid_id(&marker.id) || marker.previous == marker.candidate
        {
            return Err("Invalid pending audio settings change".into());
        }
        for hardware in [&marker.previous, &marker.candidate] {
            hardware
                .validate()
                .map_err(|_| "Invalid pending audio hardware settings")?;
        }
    }
    Ok(value)
}

pub(super) fn write_marker(
    root: &Path,
    id: &str,
    owner: AudioChangeOwner,
    previous: &AudioChangeHardware,
    candidate: &AudioChangeHardware,
) -> Result<(), String> {
    if marker(root)?.is_some() {
        return Err("A previous audio settings change still needs recovery".into());
    }
    atomic(
        &marker_path(root),
        &Marker {
            schema: 1,
            id: id.into(),
            owner,
            previous: previous.clone(),
            candidate: candidate.clone(),
        },
        REQUEST_BYTES,
    )
}

pub(super) fn has_marker(root: &Path, id: &str) -> Result<bool, String> {
    Ok(marker(root)?.is_some_and(|marker| marker.id == id))
}

pub(super) fn clear_marker(root: &Path, id: &str) -> Result<(), String> {
    clear_marker_with(root, id, media::sync_dir)
}

fn clear_marker_with(
    root: &Path,
    id: &str,
    sync: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), String> {
    let marker = marker(root)?
        .filter(|marker| marker.id == id)
        .ok_or("Audio recovery marker changed")?;
    fs::remove_file(marker_path(root)).map_err(|error| error.to_string())?;
    if let Err(error) = sync(root) {
        // Keep is not confirmed until the directory update has been synced.
        let _ = atomic(&marker_path(root), &marker, REQUEST_BYTES);
        return Err(format!("Cannot confirm audio settings: {error}"));
    }
    Ok(())
}

pub(super) fn reconcile(root: &Path) -> Result<Option<Marker>, String> {
    let Some(marker) = marker(root)? else {
        return Ok(None);
    };
    match marker.owner {
        AudioChangeOwner::Native => {
            let path = root.join("last-audio-session.json");
            let mut record = playback_recovery::Recovery::read(&path)?
                .ok_or("Missing previous Native audio recovery")?;
            marker.previous.set(&mut record.settings.stream);
            record.write(&path)?;
        }
        AudioChangeOwner::Mixed => {
            let path = root.join("last-rig-session.json");
            let mut record = rig_recovery::Recovery::read(&path)?
                .ok_or("Missing previous Mixed audio recovery")?;
            marker.previous.set(&mut record.settings.stream);
            record.write(&path)?;
        }
        AudioChangeOwner::Effects => {
            let mut settings =
                read_graph(root)?.ok_or("Missing previous Effects audio recovery")?;
            marker.previous.set(&mut settings.stream);
            write_graph(root, &settings)?;
        }
    }
    clear_marker(root, &marker.id)?;
    Ok(Some(marker))
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct GraphRecovery {
    schema: u32,
    settings: StartGraph,
}

pub(crate) fn read_graph(root: &Path) -> Result<Option<StartGraph>, String> {
    let Some(record) = read::<GraphRecovery>(&root.join(GRAPH), REQUEST_LIMIT)? else {
        return Ok(None);
    };
    if record.schema != 1 || record.settings.recall.is_none() {
        return Err("Invalid Effects recovery record".into());
    }
    record.settings.validate()?;
    Ok(Some(record.settings))
}

pub(crate) fn write_graph(root: &Path, settings: &StartGraph) -> Result<(), String> {
    settings.validate()?;
    if settings.recall.is_none() {
        return Err("Missing confirmed Effects controls".into());
    }
    atomic(
        &root.join(GRAPH),
        &GraphRecovery {
            schema: 1,
            settings: settings.clone(),
        },
        REQUEST_LIMIT,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn restart_discards_unkept_hardware_after_candidate_checkpoint_and_retains_controls() {
        let root = std::env::temp_dir().join(format!("oxidal-audio-trial-{}", media::new_id()));
        let input = json!({"endpoint":"hw:CARD=Qualification,DEV=0","direction":"capture","sample_rate":48000,"channels":2,"format":"s16","period_frames":128,"periods":3});
        let mut output = input.clone();
        output["direction"] = json!("playback");
        let mut settings: StartGraph = serde_json::from_value(json!({
            "stream":{"input":input,"output":output,"input_map":[0,1],"output_map":[0,1]},
            "rig":{"nodes":[{"id":"in","kind":"input","level":1.0},{"id":"out","kind":"output","level":1.0}],"edges":[{"from":"in","to":"out"}]},
            "bindings":[],
            "recall":{"bypassed":false,"values":[],"mappings":{"version":1,"mappings":[]}}
        })).unwrap();
        let previous = AudioChangeHardware::from_stream(&settings.stream);
        let mut candidate = previous.clone();
        candidate.input.period_frames = 96;
        candidate.output.period_frames = 96;
        let id = media::new_id();
        write_graph(&root, &settings).unwrap();
        write_marker(&root, &id, AudioChangeOwner::Effects, &previous, &candidate).unwrap();
        candidate.set(&mut settings.stream);
        settings.stream.hear_yourself = false;
        write_graph(&root, &settings).unwrap();
        assert!(clear_marker(&root, &media::new_id()).is_err());
        assert!(
            clear_marker_with(&root, &id, |_| Err(io::ErrorKind::PermissionDenied.into())).is_err()
        );
        assert!(has_marker(&root, &id).unwrap());
        assert_eq!(reconcile(&root).unwrap().unwrap().id, id);
        let restored = read_graph(&root).unwrap().unwrap();
        assert_eq!(AudioChangeHardware::from_stream(&restored.stream), previous);
        assert!(!restored.stream.hear_yourself);
        assert!(!marker_path(&root).exists());

        write_marker(&root, &id, AudioChangeOwner::Effects, &previous, &candidate).unwrap();
        write_graph(&root, &settings).unwrap();
        clear_marker(&root, &id).unwrap();
        assert!(reconcile(&root).unwrap().is_none());
        assert_eq!(
            AudioChangeHardware::from_stream(&read_graph(&root).unwrap().unwrap().stream),
            candidate
        );
        fs::remove_dir_all(root).unwrap();
    }
}
