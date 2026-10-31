//! Stream a bounded-surface library backup without duplicating large assets on disk.
use crate::{Shared, failure};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncReadExt, process::Command};

#[derive(Debug)]
struct TemporaryDirectory(PathBuf);
impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn backup_root(shared: &Shared) -> Result<(PathBuf, bool), &'static str> {
    backup_layout(&shared.config.preset_dir, &shared.config.mapping_path)
}

fn backup_layout(
    presets: &std::path::Path,
    mappings: &std::path::Path,
) -> Result<(PathBuf, bool), &'static str> {
    let root = presets.parent().ok_or("Library backup is unavailable")?;
    if presets.file_name().and_then(|v| v.to_str()) != Some("presets")
        || mappings.parent() != Some(root)
        || mappings.file_name().and_then(|v| v.to_str()) != Some("mappings.json")
    {
        return Err("Library backup requires the standard private data layout");
    }
    // systemd DynamicUser exposes StateDirectory through a root-owned symlink
    // (/var/lib/oxidal -> /var/lib/private/oxidal). Resolve that configured root,
    // while still rejecting a substituted presets directory or mappings file.
    let root = fs::canonicalize(root).map_err(|_| "Library backup is unavailable")?;
    let presets = root.join("presets");
    let mappings = root.join("mappings.json");
    for path in [root.as_path(), presets.as_path()] {
        let metadata = fs::symlink_metadata(path).map_err(|_| "Library backup is unavailable")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Library backup requires the standard private data layout");
        }
    }
    let mappings_exist = match fs::symlink_metadata(&mappings) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => true,
        Ok(_) => return Err("Library mappings are not a regular file"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err("Library mappings could not be inspected"),
    };
    Ok((root, mappings_exist))
}

fn manifest() -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::json!({
        "format": 1,
        "content": "Oxidal library backup",
        "includes": ["presets", "mappings.json"],
        "excludes": ["TONE3000 account tokens", "control audit", "monitor history"],
        "version": env!("CARGO_PKG_VERSION")
    }))
    .expect("static backup manifest is serializable")
}

fn temporary_manifest() -> Result<TemporaryDirectory, &'static str> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Cannot create backup manifest")?
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "oxidal-library-backup-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir(&directory).map_err(|_| "Cannot create backup manifest")?;
    let path = directory.join("manifest.json");
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(&manifest())?;
        file.write_all(b"\n")?;
        file.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&directory);
        return Err("Cannot create backup manifest");
    }
    Ok(TemporaryDirectory(directory))
}

pub(super) async fn library(State(shared): State<Arc<Shared>>) -> Response {
    let permit = match shared.bundle_work.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return failure(
                StatusCode::CONFLICT,
                "Another library bundle is in progress",
            );
        }
    };
    let access = shared.library_access.clone().write_owned().await;
    let (root, mappings_exist) = match backup_root(&shared) {
        Ok(layout) => layout,
        Err(error) => return failure(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let temporary = match temporary_manifest() {
        Ok(temporary) => temporary,
        Err(error) => return failure(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let mut command = Command::new("/usr/bin/tar");
    command.args([
        "-cf",
        "-",
        "--exclude=presets/accounts",
        "--exclude=presets/control-audit",
        "--exclude=presets/monitor-history",
        "-C",
    ]);
    command.arg(&temporary.0).args(["manifest.json", "-C"]);
    command.arg(&root).arg("presets");
    if mappings_exist {
        command.arg("mappings.json");
    }
    let mut child = match command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            return failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cannot start library backup",
            );
        }
    };
    let mut output = child.stdout.take().expect("piped tar output");
    let stream = async_stream::stream! {
        let _permit = permit;
        let _access = access;
        let _temporary = temporary;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            match output.read(&mut buffer).await {
                Ok(0) => break,
                Ok(length) => yield Ok::<Bytes, std::io::Error>(Bytes::copy_from_slice(&buffer[..length])),
                Err(error) => {
                    yield Err(error);
                    return;
                }
            }
        }
        match child.wait().await {
            Ok(status) if status.success() => (),
            Ok(_) => yield Err(std::io::Error::other("Library backup failed")),
            Err(error) => yield Err(error),
        }
    };
    (
        [
            (header::CONTENT_TYPE, "application/x-tar"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"oxidal-library-backup-v1.tar\"",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn dynamic_user_state_directory_is_backed_up_but_child_symlinks_are_rejected() {
        let base =
            std::env::temp_dir().join(format!("oxidal-backup-layout-{}", std::process::id()));
        let private = base.join("private");
        fs::create_dir_all(private.join("presets")).unwrap();
        let visible = base.join("visible");
        std::os::unix::fs::symlink(&private, &visible).unwrap();
        let (root, mappings) =
            backup_layout(&visible.join("presets"), &visible.join("mappings.json")).unwrap();
        assert_eq!(root, private.canonicalize().unwrap());
        assert!(!mappings);
        fs::write(private.join("mappings.json"), b"{}").unwrap();
        assert!(
            backup_layout(&visible.join("presets"), &visible.join("mappings.json"))
                .unwrap()
                .1
        );
        fs::remove_dir(private.join("presets")).unwrap();
        fs::create_dir(base.join("other")).unwrap();
        std::os::unix::fs::symlink(base.join("other"), private.join("presets")).unwrap();
        assert!(backup_layout(&visible.join("presets"), &visible.join("mappings.json")).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn standard_layout_and_manifest_exclude_private_sessions() {
        let bytes = manifest();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["format"], 1);
        assert!(
            value["includes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "presets")
        );
        assert!(
            value["excludes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "TONE3000 account tokens")
        );
    }
}
