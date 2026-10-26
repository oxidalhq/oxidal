//! Linux NetworkManager adapter. Only fixed binaries/arguments and owned keyfiles.
//! A checkpoint and durable journal restore the old link after timeout or helper restart.
use crate::{AccessPoint, Command, Interface, NetworkState, Pending, SavedNetwork};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{io::AsyncReadExt, process::Command as Process};

type Result<T> = std::result::Result<T, &'static str>;
const CONNECTIONS: &str = "/etc/NetworkManager/system-connections";
const STATE: &str = "/var/lib/oxidal-device";

// stderr may contain an SSID or a secret; never forward it into a response/log.
async fn run(program: &str, args: &[&str]) -> Result<String> {
    #[cfg(test)]
    if let Ok(result) = tests::COMMANDS.try_with(|commands| {
        let mut commands = commands.borrow_mut();
        let (expected, result) = commands.pop_front().expect("Unexpected device command");
        assert!(
            format!("{program} {}", args.join(" ")).contains(&expected),
            "Expected {expected}, got {program} {args:?}"
        );
        result.map(str::to_owned)
    }) {
        return result;
    }
    let mut child = Process::new(program)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Device command unavailable")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Device command unavailable")?
        .take(65537);
    let mut bytes = Vec::new();
    let outcome = tokio::time::timeout(Duration::from_secs(18), async {
        output
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Device read failed")?;
        if bytes.len() > 65536 {
            return Err("Device output limit exceeded");
        }
        if !child
            .wait()
            .await
            .map_err(|_| "Device process failed")?
            .success()
        {
            return Err("NetworkManager could not complete the operation");
        }
        String::from_utf8(bytes).map_err(|_| "Invalid device output")
    })
    .await
    .map_err(|_| "NetworkManager operation timed out")?;
    if outcome.is_err() {
        let _ = child.kill().await;
    }
    outcome
}
async fn nm(args: &[&str]) -> Result<String> {
    let mut all = vec!["--wait", "12", "--terse", "--escape", "yes"];
    all.extend_from_slice(args);
    run("/usr/bin/nmcli", &all).await
}
async fn checkpoint(method: &str, signature: &str, args: &[&str]) -> Result<String> {
    let mut all = vec![
        "--system",
        "--json=short",
        "call",
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager",
        method,
        signature,
    ];
    all.extend_from_slice(args);
    run("/usr/bin/busctl", &all).await
}
/// nmcli escapes delimiters and backslashes; SSIDs are not shell snippets.
pub fn fields(line: &str) -> Vec<String> {
    let mut result = vec![String::new()];
    let mut escaped = false;
    for ch in line.chars() {
        if escaped {
            result.last_mut().unwrap().push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == ':' {
            result.push(String::new());
        } else {
            result.last_mut().unwrap().push(ch);
        }
    }
    if escaped {
        result.last_mut().unwrap().push('\\');
    }
    result
}
fn key(value: &str) -> String {
    value.replace('\\', "\\\\").replace(' ', "\\s")
}
fn token() -> Result<String> {
    let mut bytes = [0u8; 16];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|_| "Cannot create device transaction")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn uuid(ssid: &str) -> String {
    let hash = format!("{:x}", Sha256::digest(ssid.as_bytes()));
    format!(
        "{}-{}-4{}-8{}-{}",
        &hash[..8],
        &hash[8..12],
        &hash[13..16],
        &hash[17..20],
        &hash[20..32]
    )
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", token()?));
    // Parent directories are root-owned; exclusive create refuses symlinks/stale partial files.
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|_| "Cannot stage device settings")?;
    let result = (|| {
        file.write_all(bytes)
            .map_err(|_| "Cannot write device settings")?;
        file.sync_all().map_err(|_| "Cannot sync device settings")?;
        fs::rename(&tmp, path).map_err(|_| "Cannot save device settings")?;
        fs::File::open(path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(|_| "Cannot sync settings directory")
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
fn profile(interface: &str, ssid: &str, password: &str, ap: bool, uuid: &str) -> String {
    let ssid_bytes = ssid.bytes().map(|b| format!("{b};")).collect::<String>();
    format!(
        "[connection]\nid={}\nuuid={uuid}\ntype=wifi\ninterface-name={interface}\nautoconnect=false\nautoconnect-priority={}\n[wifi]\nmode={}\nssid={ssid_bytes}\n{}[wifi-security]\nkey-mgmt=wpa-psk\nproto=rsn\npsk={}\n[ipv4]\nmethod={}\n{}[ipv6]\nmethod=disabled\n",
        if ap { "oxidal-hotspot" } else { "oxidal-wifi" },
        if ap { -100 } else { 100 },
        if ap { "ap" } else { "infrastructure" },
        if ap { "band=bg\n" } else { "" },
        key(password),
        if ap { "shared" } else { "auto" },
        if ap { "address1=10.42.0.1/24\n" } else { "" }
    )
}
#[derive(Serialize, Deserialize)]
struct Journal {
    file: String,
    previous: Option<Vec<u8>>,
    uuid: String,
    checkpoint: String,
    #[serde(default)]
    policy_change: bool,
    #[serde(default)]
    previous_policy: Option<Vec<u8>>,
}
struct Transaction {
    id: String,
    started: Instant,
    phase: String,
    journal: Journal,
}
impl std::fmt::Debug for Transaction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Transaction [redacted]")
    }
}
#[derive(Debug)]
pub struct Network {
    connections: PathBuf,
    state_dir: PathBuf,
    pending: Option<Transaction>,
    message: String,
    policy_checked: Instant,
    policy_candidate: Option<bool>,
}
impl Default for Network {
    fn default() -> Self {
        Self {
            connections: CONNECTIONS.into(),
            state_dir: STATE.into(),
            pending: None,
            message: String::new(),
            policy_checked: Instant::now(),
            policy_candidate: None,
        }
    }
}
impl Network {
    pub async fn recover(&mut self) -> Result<()> {
        fs::create_dir_all(&self.state_dir).map_err(|_| "Device state unavailable")?;
        fs::set_permissions(&self.state_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Device state unavailable")?;
        match fs::read(self.state_dir.as_path().join("pending.json")) {
            Ok(bytes) => {
                let journal: Journal =
                    serde_json::from_slice(&bytes).map_err(|_| "Invalid recovery journal")?;
                self.rollback(journal).await?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot read recovery journal"),
        }
        Ok(())
    }
    async fn rollback(&mut self, journal: Journal) -> Result<()> {
        if journal.file != "oxidal.nmconnection"
            && journal.file != format!("oxidal-{}.nmconnection", journal.uuid)
        {
            return Err("Invalid recovery profile");
        }
        if journal.policy_change {
            let path = self.state_dir.join("policy.json");
            match &journal.previous_policy {
                Some(bytes) => atomic(&path, bytes)?,
                None if path.exists() => {
                    fs::remove_file(path).map_err(|_| "Cannot restore hotspot policy")?
                }
                None => {}
            }
            self.policy_checked = Instant::now();
            self.policy_candidate = None;
        }
        let path = self.connections.as_path().join(&journal.file);
        if let Some(bytes) = journal.previous {
            atomic(&path, &bytes)?;
            nm(&["connection", "load", path.to_str().unwrap()]).await?;
        } else {
            let _ = nm(&["connection", "delete", "uuid", &journal.uuid]).await;
            if path.exists() {
                fs::remove_file(path).map_err(|_| "Cannot remove trial profile")?;
            }
        }
        let _ = checkpoint("CheckpointRollback", "o", &[&journal.checkpoint]).await;
        let _ = checkpoint("CheckpointDestroy", "o", &[&journal.checkpoint]).await;
        // Reloading a keyfile alone does not change an already active AP's SSID/PSK.
        // Reapply restored AP settings even when the old checkpoint already expired.
        if journal.file == "oxidal.nmconnection" {
            nm(&["connection", "up", "id", "oxidal-hotspot"]).await?;
        }
        // Re-establish the known recovery AP if no usable Wi-Fi connection returned.
        let connected = nm(&["--fields", "TYPE,STATE", "device", "status"]).await?;
        if !connected.lines().any(|line| {
            let f = fields(line);
            f.first().is_some_and(|s| s == "wifi") && f.get(1).is_some_and(|s| s == "connected")
        }) {
            nm(&["radio", "wifi", "on"]).await?;
            nm(&["connection", "up", "id", "oxidal-hotspot"]).await?;
        }
        fs::remove_file(self.state_dir.as_path().join("pending.json"))
            .map_err(|_| "Cannot clear recovery journal")?;
        self.message = "Previous network restored".into();
        Ok(())
    }
    fn policy(&self) -> Result<Option<crate::policy::Settings>> {
        match fs::read(self.state_dir.join("policy.json")) {
            Ok(bytes) => {
                let settings: crate::policy::Settings =
                    serde_json::from_slice(&bytes).map_err(|_| "Invalid hotspot policy")?;
                settings.validate()?;
                Ok(Some(settings))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("Cannot read hotspot policy"),
        }
    }
    async fn reconcile_policy(&mut self, immediate: bool) -> Result<()> {
        let Some(settings) = self.policy()? else {
            return Ok(());
        };
        // Never take over arbitrary Linux installations or change a different radio.
        if !self.connections.join("oxidal.nmconnection").is_file() {
            return Err("Recovery hotspot is unavailable");
        }
        let state = self.status(true).await?;
        let radio = state
            .interfaces
            .iter()
            .find(|d| d.name == settings.interface && d.kind == "wifi")
            .ok_or("Wireless interface is unavailable")?;
        let ethernet = state
            .interfaces
            .iter()
            .any(|d| d.kind == "ethernet" && d.state == "connected");
        let home = state.networks.iter().any(|n| n.ssid == settings.home_ssid);
        let mut visible = Vec::new();
        for saved in state.saved.iter().filter(|s| s.managed).take(32) {
            let ssid = nm(&[
                "--escape",
                "no",
                "--get-values",
                "802-11-wireless.ssid",
                "connection",
                "show",
                "uuid",
                &saved.uuid,
            ])
            .await?;
            if state
                .networks
                .iter()
                .any(|n| n.ssid == ssid.trim_end_matches('\n'))
            {
                visible.push(saved.uuid.clone());
            }
        }
        let wanted = settings.wants_hotspot(ethernet, home, !visible.is_empty());
        let previous = self.policy_candidate.replace(wanted);
        // Two observations spaced 30 seconds apart avoid flapping at the edge of coverage.
        if !immediate && previous != Some(wanted) {
            return Ok(());
        }
        let ap = radio.state == "connected" && radio.connection == "oxidal-hotspot";
        if wanted && !ap {
            nm(&["radio", "wifi", "on"]).await?;
            nm(&[
                "connection",
                "up",
                "id",
                "oxidal-hotspot",
                "ifname",
                &settings.interface,
            ])
            .await?;
        } else if !wanted && (ap || radio.state != "connected") {
            for id in visible {
                if nm(&[
                    "connection",
                    "up",
                    "uuid",
                    &id,
                    "ifname",
                    &settings.interface,
                ])
                .await
                .is_ok()
                {
                    return Ok(());
                }
            }
            if ethernet || settings.mode == crate::policy::Mode::Never {
                if ap {
                    nm(&["connection", "down", "id", "oxidal-hotspot"]).await?;
                }
            } else {
                // A visible router with a failed authentication must not strand the owner.
                nm(&[
                    "connection",
                    "up",
                    "id",
                    "oxidal-hotspot",
                    "ifname",
                    &settings.interface,
                ])
                .await?;
                self.message =
                    "Remembered Wi-Fi could not connect; recovery hotspot remains available".into();
            }
        }
        Ok(())
    }
    pub async fn tick(&mut self) {
        if self.pending.is_none() && self.state_dir.join("pending.json").exists() {
            if self.recover().await.is_err() {
                self.message = "Network recovery is retrying".into();
            }
            return;
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.started.elapsed() >= Duration::from_secs(90))
        {
            let old = self.pending.take().unwrap();
            if self.rollback(old.journal).await.is_err() {
                self.message =
                    "Network recovery needs attention; recovery will retry after service restart"
                        .into();
            }
        }
        if self.pending.is_none()
            && !self.state_dir.join("pending.json").exists()
            && self.policy_checked.elapsed() >= Duration::from_secs(30)
        {
            self.policy_checked = Instant::now();
            if self.reconcile_policy(false).await.is_err() {
                self.message = "Automatic hotspot check will retry".into();
            }
        }
    }
    pub async fn status(&self, scan: bool) -> Result<NetworkState> {
        let devices = nm(&[
            "--fields",
            "DEVICE,TYPE,STATE,CONNECTION",
            "device",
            "status",
        ])
        .await?;
        let interfaces = devices
            .lines()
            .filter_map(|line| {
                let f = fields(line);
                if f.len() != 4 {
                    return None;
                }
                Some(Interface {
                    name: f[0].clone(),
                    kind: f[1].clone(),
                    state: f[2].clone(),
                    connection: f[3].clone(),
                })
            })
            .collect();
        let wireless_enabled = nm(&["radio", "wifi"]).await?.trim() == "enabled";
        let aps = nm(&[
            "--fields",
            "IN-USE,SSID,SIGNAL,SECURITY",
            "device",
            "wifi",
            "list",
            "--rescan",
            if scan { "yes" } else { "no" },
        ])
        .await?;
        let mut networks: Vec<AccessPoint> = Vec::new();
        for line in aps.lines() {
            let f = fields(line);
            if f.len() != 4 || f[1].is_empty() {
                continue;
            }
            let point = AccessPoint {
                ssid: f[1].clone(),
                signal: f[2].parse::<u8>().unwrap_or(0).min(100),
                security: f[3].clone(),
                active: f[0] == "*",
            };
            if let Some(existing) = networks
                .iter_mut()
                .find(|p| p.ssid == point.ssid && p.security == point.security)
            {
                if point.signal > existing.signal {
                    *existing = point;
                }
            } else if networks.len() < 128 {
                networks.push(point);
            }
        }
        networks.sort_by_key(|p| std::cmp::Reverse(p.signal));
        let saved = nm(&["--fields", "UUID,NAME,TYPE,DEVICE", "connection", "show"])
            .await?
            .lines()
            .filter_map(|line| {
                let f = fields(line);
                if f.len() != 4 || f[2] != "802-11-wireless" {
                    return None;
                }
                Some(SavedNetwork {
                    uuid: f[0].clone(),
                    name: f[1].clone(),
                    active: !f[3].is_empty() && f[3] != "--",
                    managed: self
                        .connections
                        .as_path()
                        .join(format!("oxidal-{}.nmconnection", f[0]))
                        .is_file(),
                })
            })
            .collect();
        Ok(NetworkState {
            available: true,
            wireless_enabled,
            policy: self.policy()?,
            interfaces,
            networks,
            saved,
            pending: self.pending.as_ref().map(|p| Pending {
                transaction: p.id.clone(),
                seconds_remaining: 90u64.saturating_sub(p.started.elapsed().as_secs()),
                phase: p.phase.clone(),
            }),
            message: self.message.clone(),
        })
    }
    pub async fn begin(&mut self, command: &Command) -> Result<NetworkState> {
        command.validate()?;
        if self.pending.is_some() || self.state_dir.as_path().join("pending.json").exists() {
            return Err("A network change or recovery is already pending");
        }
        let policy_settings = match command {
            Command::Policy { settings } => Some(settings),
            _ => None,
        };
        let empty = String::new();
        let (interface, ssid, password, ap) = match command {
            Command::Policy { settings } => (&settings.interface, &empty, &empty, true),
            Command::Join {
                interface,
                ssid,
                password,
            } => (interface, ssid, password, false),
            Command::Hotspot {
                interface,
                ssid,
                password,
            } => (interface, ssid, password, true),
            _ => return Err("Not a network change"),
        };
        let mut state = self.status(false).await?;
        if !state
            .interfaces
            .iter()
            .any(|d| d.name == *interface && d.kind == "wifi")
        {
            return Err("Selected wireless interface is unavailable");
        }
        // Existing AP is the recovery anchor; do not modify arbitrary host installations.
        let ap_path = self.connections.as_path().join("oxidal.nmconnection");
        if !ap_path.is_file() {
            return Err("Configure the appliance recovery hotspot before making wireless changes");
        }
        let uuid = if ap {
            let value = nm(&[
                "--get-values",
                "connection.uuid",
                "connection",
                "show",
                "id",
                "oxidal-hotspot",
            ])
            .await?;
            value.trim().to_string()
        } else {
            uuid(ssid)
        };
        Command::Forget { uuid: uuid.clone() }.validate()?;
        let file = if ap {
            "oxidal.nmconnection".into()
        } else {
            format!("oxidal-{uuid}.nmconnection")
        };
        let path = self.connections.as_path().join(&file);
        let previous = match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Cannot read network profile"),
        };
        let dev = nm(&[
            "--get-values",
            "GENERAL.DBUS-PATH",
            "device",
            "show",
            interface,
        ])
        .await?;
        let result = checkpoint("CheckpointCreate", "aouu", &["1", dev.trim(), "90", "2"]).await?;
        let json: serde_json::Value =
            serde_json::from_str(&result).map_err(|_| "Invalid NetworkManager checkpoint")?;
        let checkpoint = json["data"][0]
            .as_str()
            .filter(|s| s.starts_with("/org/freedesktop/NetworkManager/Checkpoint/"))
            .ok_or("Invalid NetworkManager checkpoint")?
            .to_string();
        let journal = Journal {
            file,
            previous,
            uuid,
            checkpoint,
            policy_change: policy_settings.is_some(),
            previous_policy: if policy_settings.is_some() {
                match fs::read(self.state_dir.join("policy.json")) {
                    Ok(bytes) => Some(bytes),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(_) => return Err("Cannot read previous policy"),
                }
            } else {
                None
            },
        };
        let transaction = token()?;
        atomic(
            &self.state_dir.as_path().join("pending.json"),
            &serde_json::to_vec(&journal).map_err(|_| "Cannot save recovery journal")?,
        )?;
        let write = if let Some(settings) = policy_settings {
            atomic(
                &self.state_dir.join("policy.json"),
                &serde_json::to_vec(settings).map_err(|_| "Cannot encode hotspot policy")?,
            )
        } else {
            atomic(
                &path,
                profile(interface, ssid, password, ap, &journal.uuid).as_bytes(),
            )
        };
        if let Err(error) = write {
            self.rollback(journal).await?;
            return Err(error);
        }
        self.pending = Some(Transaction {
            id: transaction.clone(),
            started: Instant::now(),
            phase: "connecting".into(),
            journal,
        });
        state.pending = Some(Pending {
            transaction,
            seconds_remaining: 90,
            phase: "connecting".into(),
        });
        state.message="Reconnect your browser and confirm within 90 seconds, otherwise the previous network returns".into();
        Ok(state)
    }
    pub async fn activate(&mut self) {
        let Some(pending) = &self.pending else { return };
        let path = self.connections.clone().join(&pending.journal.file);
        let uuid = pending.journal.uuid.clone();
        let policy_change = pending.journal.policy_change;
        let result = if policy_change {
            // Automatic decisions belong to this helper; do not let NM immediately
            // autoconnect the AP again after a deliberate policy-driven disconnect.
            match nm(&[
                "connection",
                "modify",
                "id",
                "oxidal-hotspot",
                "connection.autoconnect",
                "no",
            ])
            .await
            {
                Ok(_) => self.reconcile_policy(true).await.map(|()| String::new()),
                Err(error) => Err(error),
            }
        } else {
            async {
                nm(&["connection", "load", path.to_str().unwrap()]).await?;
                nm(&["radio", "wifi", "on"]).await?;
                nm(&["connection", "up", "uuid", &uuid]).await
            }
            .await
        };
        if result.is_ok() {
            self.pending.as_mut().unwrap().phase = "awaiting_confirmation".into();
        } else {
            let old = self.pending.take().unwrap();
            if self.rollback(old.journal).await.is_err() {
                self.message = "Connection failed; recovery needs attention".into();
            } else {
                self.message = "Connection failed; previous network restored".into();
            }
        }
    }
    pub async fn command(&mut self, command: Command) -> Result<NetworkState> {
        command.validate()?;
        let cancel = matches!(&command, Command::Cancel { .. });
        match command {
            Command::Status {} => {}
            Command::Scan {} => return self.status(true).await,
            Command::Confirm { transaction } | Command::Cancel { transaction } => {
                let Some(pending) = &self.pending else {
                    return Err("No network change is pending");
                };
                if pending.id != transaction || pending.started.elapsed() >= Duration::from_secs(90)
                {
                    return Err("Network transaction expired or changed");
                }
                if cancel {
                    let old = self.pending.take().unwrap();
                    self.rollback(old.journal).await?;
                } else {
                    if pending.phase != "awaiting_confirmation" {
                        return Err("Network connection is not ready");
                    }
                    if pending.journal.policy_change {
                        let state = self.status(false).await?;
                        if !state.interfaces.iter().any(|d| {
                            (d.kind == "wifi" || d.kind == "ethernet") && d.state == "connected"
                        }) {
                            return Err("No active network connection");
                        }
                    } else {
                        let state = nm(&[
                            "--get-values",
                            "GENERAL.STATE",
                            "connection",
                            "show",
                            "uuid",
                            &pending.journal.uuid,
                        ])
                        .await?;
                        if state.trim() != "activated" {
                            return Err("Network connection is no longer active");
                        }
                        nm(&[
                            "connection",
                            "modify",
                            "uuid",
                            &pending.journal.uuid,
                            "connection.autoconnect",
                            "yes",
                        ])
                        .await?;
                    }
                    checkpoint("CheckpointDestroy", "o", &[&pending.journal.checkpoint]).await?;
                    fs::remove_file(self.state_dir.as_path().join("pending.json"))
                        .map_err(|_| "Cannot finalize network settings")?;
                    self.pending = None;
                    self.message = "Network settings saved".into();
                }
            }
            Command::Forget { uuid } => {
                if self.pending.is_some() {
                    return Err("Finish the pending network change first");
                }
                let state = self.status(false).await?;
                if !state
                    .saved
                    .iter()
                    .any(|p| p.uuid == uuid && p.managed && !p.active)
                {
                    return Err("Only inactive Oxidal-managed client networks can be forgotten");
                }
                nm(&["connection", "delete", "uuid", &uuid]).await?;
                self.message = "Saved network removed".into();
            }
            _ => return Err("Network changes must be started as a transaction"),
        }
        self.status(false).await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque};
    type Responses = VecDeque<(String, Result<&'static str>)>;
    tokio::task_local! { pub static COMMANDS: RefCell<Responses>; }
    fn responses(items: &[(&str, Result<&'static str>)]) -> Responses {
        items.iter().map(|(a, b)| (a.to_string(), *b)).collect()
    }
    fn status() -> Responses {
        responses(&[
            (
                "DEVICE,TYPE,STATE,CONNECTION",
                Ok("wlan0:wifi:connected:oxidal-hotspot\n"),
            ),
            ("radio wifi", Ok("enabled\n")),
            ("IN-USE,SSID,SIGNAL,SECURITY", Ok(":Studio:75:WPA2\n")),
            ("UUID,NAME,TYPE,DEVICE", Ok("")),
        ])
    }
    fn begin() -> Responses {
        let mut out = status();
        out.extend(responses(&[
            (
                "GENERAL.DBUS-PATH",
                Ok("/org/freedesktop/NetworkManager/Devices/2\n"),
            ),
            (
                "CheckpointCreate aouu 1",
                Ok(r#"{"type":"o","data":["/org/freedesktop/NetworkManager/Checkpoint/1"]}"#),
            ),
        ]));
        out
    }
    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("oxidal-device-{}", token().unwrap()));
            fs::create_dir_all(root.join("connections")).unwrap();
            fs::create_dir_all(root.join("state")).unwrap();
            fs::write(
                root.join("connections/oxidal.nmconnection"),
                b"original recovery AP",
            )
            .unwrap();
            Self { root }
        }
        fn network(&self) -> Network {
            Network {
                connections: self.root.join("connections"),
                state_dir: self.root.join("state"),
                ..Default::default()
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn join() -> Command {
        Command::Join {
            interface: "wlan0".into(),
            ssid: "Studio".into(),
            password: "private-test-pass".into(),
        }
    }
    #[tokio::test]
    async fn join_confirmation_persists_only_after_active_readback() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        let mut commands = begin();
        commands.extend(responses(&[
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            ("connection up uuid", Ok("")),
            ("GENERAL.STATE", Ok("activated\n")),
            ("connection modify uuid", Ok("")),
            ("CheckpointDestroy", Ok("")),
        ]));
        commands.extend(status());
        COMMANDS
            .scope(RefCell::new(commands), async {
                let first = network.begin(&join()).await.unwrap();
                let id = first.pending.unwrap().transaction;
                let profile = fs::read_to_string(fixture.root.join(format!(
                    "connections/oxidal-{}.nmconnection",
                    uuid("Studio")
                )))
                .unwrap();
                assert!(profile.contains("autoconnect=false"));
                assert_eq!(
                    fs::metadata(fixture.root.join("state/pending.json"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
                assert!(network.begin(&join()).await.is_err());
                assert!(
                    network
                        .command(Command::Confirm {
                            transaction: "0".repeat(32)
                        })
                        .await
                        .is_err()
                );
                network.activate().await;
                let state = network
                    .command(Command::Confirm { transaction: id })
                    .await
                    .unwrap();
                assert!(state.pending.is_none());
                assert!(!fixture.root.join("state/pending.json").exists());
                assert!(
                    !serde_json::to_string(&state)
                        .unwrap()
                        .contains("private-test-pass")
                );
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn failed_join_restores_recovery_ap_and_removes_trial() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        let mut commands = begin();
        commands.extend(responses(&[
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            ("connection up uuid", Err("Wrong password")),
            ("connection delete uuid", Ok("")),
            ("CheckpointRollback", Ok("")),
            ("CheckpointDestroy", Ok("")),
            ("TYPE,STATE", Ok("wlan0:disconnected\n")),
            ("radio wifi on", Ok("")),
            ("connection up id oxidal-hotspot", Ok("")),
        ]));
        COMMANDS
            .scope(RefCell::new(commands), async {
                network.begin(&join()).await.unwrap();
                network.activate().await;
                assert!(network.pending.is_none());
                assert!(!fixture.root.join("state/pending.json").exists());
                assert_eq!(
                    fs::read_dir(fixture.root.join("connections"))
                        .unwrap()
                        .count(),
                    1
                );
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn helper_restart_rolls_back_unconfirmed_hotspot_and_preserves_old_password() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        let mut commands = status();
        commands.push_back((
            "connection.uuid".into(),
            Ok("12345678-1234-4234-8234-123456789012"),
        ));
        commands.extend(begin().into_iter().skip(4));
        commands.extend(responses(&[
            ("connection load", Ok("")),
            ("CheckpointRollback", Err("Checkpoint already expired")),
            ("CheckpointDestroy", Err("Checkpoint already expired")),
            ("connection up id oxidal-hotspot", Ok("")),
            ("TYPE,STATE", Ok("wifi:disconnected\n")),
            ("radio wifi on", Ok("")),
            ("connection up id oxidal-hotspot", Ok("")),
        ]));
        COMMANDS
            .scope(RefCell::new(commands), async {
                network
                    .begin(&Command::Hotspot {
                        interface: "wlan0".into(),
                        ssid: "New AP".into(),
                        password: "new-password".into(),
                    })
                    .await
                    .unwrap();
                drop(network);
                let mut restarted = fixture.network();
                restarted.recover().await.unwrap();
                assert_eq!(
                    fs::read(fixture.root.join("connections/oxidal.nmconnection")).unwrap(),
                    b"original recovery AP"
                );
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn expiration_rolls_back_even_without_a_browser() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        let mut commands = begin();
        commands.extend(responses(&[
            ("connection delete uuid", Ok("")),
            ("CheckpointRollback", Ok("")),
            ("CheckpointDestroy", Ok("")),
            ("TYPE,STATE", Ok("wifi:connected\n")),
        ]));
        COMMANDS
            .scope(RefCell::new(commands), async {
                network.begin(&join()).await.unwrap();
                network.pending.as_mut().unwrap().started =
                    Instant::now() - Duration::from_secs(91);
                network.tick().await;
                assert!(network.pending.is_none());
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }

    #[tokio::test]
    async fn policy_expiry_restores_previous_settings_and_keyfile() {
        let fixture = Fixture::new();
        let old = crate::policy::Settings {
            interface: "wlan0".into(),
            mode: crate::policy::Mode::Always,
            home_ssid: String::new(),
        };
        atomic(
            &fixture.root.join("state/policy.json"),
            &serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let mut network = fixture.network();
        let mut commands = status();
        commands.push_back((
            "connection.uuid".into(),
            Ok("12345678-1234-4234-8234-123456789012"),
        ));
        commands.extend(begin().into_iter().skip(4));
        commands.extend(responses(&[
            ("connection load", Ok("")),
            ("CheckpointRollback", Ok("")),
            ("CheckpointDestroy", Ok("")),
            ("connection up id oxidal-hotspot", Ok("")),
            ("TYPE,STATE", Ok("wifi:connected\n")),
        ]));
        COMMANDS
            .scope(RefCell::new(commands), async {
                network
                    .begin(&Command::Policy {
                        settings: crate::policy::Settings {
                            mode: crate::policy::Mode::Never,
                            ..old.clone()
                        },
                    })
                    .await
                    .unwrap();
                assert_eq!(
                    network.policy().unwrap().unwrap().mode,
                    crate::policy::Mode::Never
                );
                network.pending.as_mut().unwrap().started =
                    Instant::now() - Duration::from_secs(91);
                network.tick().await;
                assert_eq!(network.policy().unwrap().unwrap(), old);
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn automatic_policy_waits_for_two_observations() {
        let fixture = Fixture::new();
        let settings = crate::policy::Settings {
            interface: "wlan0".into(),
            mode: crate::policy::Mode::Never,
            home_ssid: String::new(),
        };
        atomic(
            &fixture.root.join("state/policy.json"),
            &serde_json::to_vec(&settings).unwrap(),
        )
        .unwrap();
        let mut network = fixture.network();
        let mut commands = status();
        commands.extend(status());
        commands.extend(responses(&[("connection down id oxidal-hotspot", Ok(""))]));
        COMMANDS
            .scope(RefCell::new(commands), async {
                network.reconcile_policy(false).await.unwrap();
                network.reconcile_policy(false).await.unwrap();
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    #[ignore = "requires root and NetworkManager in explicitly disposable Linux"]
    async fn real_networkmanager_keyfile_roundtrip() {
        assert_eq!(std::env::var("OXIDAL_TEST_DEVICE").as_deref(), Ok("1"));
        let directory = PathBuf::from(CONNECTIONS);
        fs::create_dir_all(&directory).unwrap();
        let id = uuid(&token().unwrap());
        let path = directory.join(format!("oxidal-qualification-{id}.nmconnection"));
        let ssid = "Studio:one\\two";
        let password = " test-only\\pass ";
        atomic(
            &path,
            profile("wlan-test", ssid, password, false, &id).as_bytes(),
        )
        .unwrap();
        let loaded = nm(&["connection", "load", path.to_str().unwrap()]).await;
        assert!(
            loaded.is_ok(),
            "NetworkManager rejected the generated keyfile"
        );
        let result = nm(&[
            "--escape",
            "no",
            "--show-secrets",
            "--get-values",
            "802-11-wireless.ssid,802-11-wireless-security.psk",
            "connection",
            "show",
            "uuid",
            &id,
        ])
        .await;
        let cleanup = nm(&["connection", "delete", "uuid", &id]).await;
        if path.exists() {
            fs::remove_file(path).unwrap();
        }
        assert!(
            cleanup.is_ok(),
            "NetworkManager did not register the profile"
        );
        assert_eq!(
            result.unwrap().lines().collect::<Vec<_>>(),
            [ssid, password]
        );
        // Create/destroy without changing any links: verifies busctl's checkpoint wire format.
        let raw = checkpoint("CheckpointCreate", "aouu", &["0", "10", "2"])
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let checkpoint_path = value["data"][0].as_str().unwrap();
        assert!(checkpoint_path.starts_with("/org/freedesktop/NetworkManager/Checkpoint/"));
        checkpoint("CheckpointDestroy", "o", &[checkpoint_path])
            .await
            .unwrap();
    }
    #[test]
    fn escaped_fields_and_keyfiles() {
        assert_eq!(
            fields(r"*:Studio\: one\\two:75:WPA2"),
            vec!["*", "Studio: one\\two", "75", "WPA2"]
        );
        let text = profile(
            "wlan0",
            "Studio:one",
            " pass\\word ",
            false,
            &uuid("Studio:one"),
        );
        assert!(text.contains("psk=\\spass\\\\word\\s\n"));
        assert!(text.contains("ssid=83;116;117;100;105;111;58;111;110;101;\n"));
        assert!(text.contains("autoconnect=false"));
        assert!(
            Command::Forget {
                uuid: uuid("Studio:one")
            }
            .validate()
            .is_ok()
        );
    }
}
