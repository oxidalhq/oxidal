//! Next-boot storage mode. The fixed boot command line is the only mutable target.
//! Locked mode depends on the separate appliance data layout; ordinary Linux hosts
//! and pre-layout images report the control as unavailable.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const CMDLINE: &str = "/boot/firmware/cmdline.txt";
pub const LAYOUT_MARKER: &str = "/usr/share/oxidal/storage-layout-v1";
const MOUNTINFO: &str = "/proc/self/mountinfo";
const MAX_CMDLINE: usize = 4096;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    Unlocked,
    Locked,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StorageState {
    pub available: bool,
    pub current: Option<StorageMode>,
    pub next_boot: Option<StorageMode>,
    pub reboot_required: bool,
    pub message: String,
}

#[derive(Debug)]
pub struct Manager {
    cmdline: PathBuf,
    mountinfo: PathBuf,
    layout_marker: PathBuf,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            cmdline: CMDLINE.into(),
            mountinfo: MOUNTINFO.into(),
            layout_marker: LAYOUT_MARKER.into(),
        }
    }
}

impl Manager {
    pub fn state(&self) -> StorageState {
        let current = current_from(&self.mountinfo).ok();
        let next_boot = fs::read(&self.cmdline)
            .ok()
            .and_then(|bytes| parse_cmdline(&bytes).ok().map(|(_, mode)| mode));
        let layout = self.layout_marker.is_file();
        let available = layout && current.is_some() && next_boot.is_some();
        let reboot_required = matches!((current, next_boot), (Some(a), Some(b)) if a != b);
        StorageState {
            available,
            current,
            next_boot,
            reboot_required,
            message: if !layout {
                "Storage lock requires the appliance writable-data layout".into()
            } else if current.is_none() {
                "Cannot determine the current root-filesystem mode".into()
            } else if next_boot.is_none() {
                "Boot storage settings are invalid; no change was made".into()
            } else if reboot_required {
                "Storage mode changes at the next restart".into()
            } else {
                String::new()
            },
        }
    }

    pub fn set(&self, mode: StorageMode) -> Result<StorageState, &'static str> {
        let before = self.state();
        if !before.available {
            return Err("Storage lock is unavailable on this installation");
        }
        let bytes = fs::read(&self.cmdline).map_err(|_| "Cannot read boot storage settings")?;
        let (mut tokens, _) = parse_cmdline(&bytes)?;
        tokens.retain(|token| {
            token != "ro"
                && token != "rw"
                && token != "systemd.volatile=state"
                && !token.starts_with("oxidal.storage=")
        });
        match mode {
            StorageMode::Unlocked => {
                tokens.push("rw".into());
                tokens.push("oxidal.storage=unlocked".into());
            }
            StorageMode::Locked => {
                tokens.push("ro".into());
                tokens.push("systemd.volatile=state".into());
                tokens.push("oxidal.storage=locked".into());
            }
        }
        let next = tokens.join(" ") + "\n";
        if next.len() > MAX_CMDLINE {
            return Err("Boot storage settings are too large");
        }
        replace(&self.cmdline, next.as_bytes())?;
        let state = self.state();
        if state.next_boot != Some(mode) {
            return Err("Boot storage settings did not verify");
        }
        Ok(state)
    }
}

pub fn current_mode() -> Result<StorageMode, &'static str> {
    current_from(Path::new(MOUNTINFO))
}

fn current_from(path: &Path) -> Result<StorageMode, &'static str> {
    let text = fs::read_to_string(path).map_err(|_| "Cannot read root mount state")?;
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let mountpoint = fields.nth(4).ok_or("Invalid root mount state")?;
        let options = fields.next().ok_or("Invalid root mount state")?;
        if mountpoint == "/" {
            let mut ro = false;
            let mut rw = false;
            for option in options.split(',') {
                ro |= option == "ro";
                rw |= option == "rw";
            }
            return match (ro, rw) {
                (true, false) => Ok(StorageMode::Locked),
                (false, true) => Ok(StorageMode::Unlocked),
                _ => Err("Ambiguous root mount state"),
            };
        }
    }
    Err("Root mount state is missing")
}

fn parse_cmdline(bytes: &[u8]) -> Result<(Vec<String>, StorageMode), &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_CMDLINE || bytes.contains(&0) {
        return Err("Invalid boot storage settings");
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid boot storage settings")?;
    if text.trim().is_empty() || text.trim().lines().count() != 1 {
        return Err("Invalid boot storage settings");
    }
    let tokens: Vec<String> = text.split_whitespace().map(str::to_owned).collect();
    if !tokens.iter().any(|token| token.starts_with("root=")) {
        return Err("Boot root device is missing");
    }
    let ro = tokens.iter().filter(|token| token.as_str() == "ro").count();
    let rw = tokens.iter().filter(|token| token.as_str() == "rw").count();
    let volatile = tokens
        .iter()
        .filter(|token| token.as_str() == "systemd.volatile=state")
        .count();
    let declared: Vec<&str> = tokens
        .iter()
        .filter_map(|token| token.strip_prefix("oxidal.storage="))
        .collect();
    if ro > 1 || rw > 1 || volatile > 1 || declared.len() > 1 || (ro > 0 && rw > 0) {
        return Err("Ambiguous boot storage settings");
    }
    let mode = match declared.first().copied() {
        Some("locked") if ro == 1 && volatile == 1 => StorageMode::Locked,
        Some("unlocked") if rw == 1 && volatile == 0 => StorageMode::Unlocked,
        Some(_) => return Err("Invalid boot storage mode"),
        None if ro == 1 && volatile == 1 => StorageMode::Locked,
        None if rw == 1 && volatile == 0 => StorageMode::Unlocked,
        _ => return Err("Boot storage mode is incomplete"),
    };
    Ok((tokens, mode))
}

fn replace(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let parent = path.parent().ok_or("Invalid boot storage path")?;
    let temporary = parent.join(".oxidal-cmdline-next");
    if temporary.exists() || temporary.is_symlink() || path.is_symlink() {
        return Err("Unsafe boot storage path");
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Cannot stage boot storage settings")?;
    let result = (|| {
        file.write_all(bytes)
            .map_err(|_| "Cannot write boot storage settings")?;
        file.sync_all()
            .map_err(|_| "Cannot sync boot storage settings")?;
        fs::rename(&temporary, path).map_err(|_| "Cannot publish boot storage settings")?;
        let directory = fs::File::open(parent).map_err(|_| "Cannot open boot storage directory")?;
        directory
            .sync_all()
            .map_err(|_| "Cannot sync boot storage directory")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, Manager) {
        let root = std::env::temp_dir().join(format!(
            "oxidal-storage-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("cmdline.txt"),
            "console=tty1 root=PARTUUID=123-02 rootwait rw\n",
        )
        .unwrap();
        fs::write(
            root.join("mountinfo"),
            "29 1 8:2 / / rw,relatime - ext4 /dev/root rw\n",
        )
        .unwrap();
        fs::write(root.join("layout"), "1\n").unwrap();
        let manager = Manager {
            cmdline: root.join("cmdline.txt"),
            mountinfo: root.join("mountinfo"),
            layout_marker: root.join("layout"),
        };
        (root, manager)
    }

    #[test]
    fn schedules_both_modes_without_remounting() {
        let (root, manager) = fixture();
        let initial = manager.state();
        assert_eq!(initial.current, Some(StorageMode::Unlocked));
        assert_eq!(initial.next_boot, Some(StorageMode::Unlocked));
        assert!(!initial.reboot_required);
        let locked = manager.set(StorageMode::Locked).unwrap();
        assert_eq!(locked.current, Some(StorageMode::Unlocked));
        assert_eq!(locked.next_boot, Some(StorageMode::Locked));
        assert!(locked.reboot_required);
        let command = fs::read_to_string(root.join("cmdline.txt")).unwrap();
        assert!(command.contains(" ro "));
        assert!(command.contains("systemd.volatile=state"));
        assert!(!command.contains(" rw "));
        let unlocked = manager.set(StorageMode::Unlocked).unwrap();
        assert_eq!(unlocked.next_boot, Some(StorageMode::Unlocked));
        assert!(!unlocked.reboot_required);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fails_closed_without_layout_or_with_ambiguous_boot_flags() {
        let (root, manager) = fixture();
        fs::remove_file(root.join("layout")).unwrap();
        assert!(!manager.state().available);
        assert!(manager.set(StorageMode::Locked).is_err());
        fs::write(
            root.join("cmdline.txt"),
            "root=PARTUUID=123-02 rw ro oxidal.storage=locked\n",
        )
        .unwrap();
        fs::write(root.join("layout"), "1\n").unwrap();
        assert!(!manager.state().available);
        assert!(manager.set(StorageMode::Locked).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
