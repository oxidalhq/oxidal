//! A device-local, profile-checked clipboard; no opaque payload or path from a browser.
use super::*;
const SOURCE: &str = "native-clipboard:v1";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Clipboard {
    schema: u8,
    profile: String,
    receipt: String,
    block_id: String,
}
fn pointer(root: &Path) -> Result<Clipboard, String> {
    if !root.is_absolute() {
        return Err("Clipboard store must be absolute".into());
    }
    let mut bytes = vec![];
    std::fs::File::open(root.join("native-clipboard.json"))
        .map_err(|e| e.to_string())?
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 4096 {
        return Err("Clipboard metadata exceeds budget".into());
    }
    let entry: Clipboard =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid native clipboard metadata")?;
    if entry.schema != 1
        || entry.profile != profile()
        || !valid_receipt(&entry.receipt)
        || entry.block_id.is_empty()
        || entry.block_id.len() > 128
        || entry.block_id.chars().any(char::is_control)
    {
        return Err("Native clipboard profile/identity differs".into());
    }
    let metadata = std::fs::symlink_metadata(directory(root).join(&entry.receipt))
        .map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_STATE as u64 + 4096 {
        return Err("Native clipboard payload unavailable".into());
    }
    Ok(entry)
}
pub(super) fn available(root: &Path) -> bool {
    pointer(root).is_ok()
}
pub(super) fn copy(engine: &mut Engine, root: &Path, block_id: &str) -> Result<(), String> {
    if !root.is_absolute() {
        return Err("Clipboard store must be absolute".into());
    }
    engine.copy_block(block_id).map_err(|e| e.to_string())?;
    let state = engine.capture().map_err(|e| e.to_string())?;
    let entry = Clipboard {
        schema: 1,
        profile: profile(),
        receipt: write(root, SOURCE, &state)?,
        block_id: block_id.into(),
    };
    let bytes = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    let temporary = root.join(format!(
        ".clipboard-{}-{}.pending",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, root.join("native-clipboard.json"))
            .map_err(|e| e.to_string())?;
        std::fs::File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
/// Scratch restore is contained by the calling authoring transaction. It may reset
/// histories/allocate, like Paste itself; it is not a real-time clipboard transfer.
pub(super) fn load_into(engine: &mut Engine, root: &Path) -> Result<(), String> {
    let entry = pointer(root)?;
    let source = read(root, &entry.receipt, SOURCE)?;
    let target = engine.capture().map_err(|e| e.to_string())?;
    let copied = engine
        .restore(&source)
        .and_then(|_| engine.wait_ready())
        .and_then(|_| engine.copy_block(&entry.block_id));
    // Restore the target regardless of a missing/broken copied block. The caller's
    // outer transaction also rolls back or fails closed if this restoration fails.
    engine
        .restore(&target)
        .and_then(|_| engine.wait_ready())
        .map_err(|e| format!("Clipboard target restore failed: {e}"))?;
    copied.map_err(|e| e.to_string())
}
