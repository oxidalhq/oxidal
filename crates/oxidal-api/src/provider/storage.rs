//! Atomic owner-only account state. Not included in presets, exports or image fixtures.
use super::{Tokens, valid_client, valid_token};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Saved {
    schema: u32,
    pub client_id: String,
    pub tokens: Option<Tokens>,
}
const MAX: usize = 32 * 1024;
pub(super) fn load(root: &Path) -> Result<Option<Saved>, &'static str> {
    let path = root.join("tone3000-account.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read saved account. Check device storage."),
    };
    if !metadata.is_file() || metadata.len() > MAX as u64 {
        return Err("Saved account is invalid. Disconnect to reset it.");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Saved account permissions are unsafe. Disconnect to reset it.");
        }
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take((MAX + 1) as u64).read_to_end(&mut bytes))
        .map_err(|_| "Cannot read saved account")?;
    if bytes.len() > MAX {
        return Err("Saved account is too large");
    }
    let saved: Saved = serde_json::from_slice(&bytes)
        .map_err(|_| "Saved account is invalid. Disconnect to reset it.")?;
    if saved.schema != 1
        || !valid_client(&saved.client_id)
        || saved.tokens.as_ref().is_some_and(|t| {
            !valid_token(&t.access_token) || !valid_token(&t.refresh_token) || t.expires_at == 0
        })
    {
        return Err("Saved account is invalid. Disconnect to reset it.");
    }
    Ok(Some(saved))
}
pub(super) fn save(
    root: &Path,
    client_id: Option<&str>,
    tokens: Option<&Tokens>,
) -> Result<(), &'static str> {
    let result = || -> std::io::Result<()> {
        fs::create_dir_all(root)?;
        let path = root.join("tone3000-account.json");
        if client_id.is_none() {
            match fs::remove_file(&path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e),
            }
            return fs::File::open(root)?.sync_all();
        }
        #[derive(Serialize)]
        struct Record<'a> {
            schema: u32,
            client_id: &'a str,
            tokens: Option<&'a Tokens>,
        }
        let bytes = serde_json::to_vec(&Record {
            schema: 1,
            client_id: client_id.unwrap(),
            tokens,
        })?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temp = root.join(format!(".account-{}-{nonce}.tmp", std::process::id()));
        // create_new refuses a pre-existing file/symlink, never truncating another target.
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        let write = (|| {
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temp, &path)?;
            fs::File::open(root)?.sync_all()
        })();
        if write.is_err() {
            let _ = fs::remove_file(temp);
        }
        write
    };
    result().map_err(|_| "Account could not be saved. Check device storage before retrying.")
}
