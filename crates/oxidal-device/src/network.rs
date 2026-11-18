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
const NETWORK_TRIAL: Duration = Duration::from_secs(90);

// stderr may contain an SSID or a secret; never forward it into a response/log.
async fn run(program: &str, args: &[&str]) -> Result<String> {
    #[cfg(test)]
    if let Ok((stall, result)) = tests::COMMANDS.try_with(|commands| {
        let mut commands = commands.borrow_mut();
        let (expected, result) = commands.pop_front().expect("Unexpected device command");
        let (stall, expected) = expected
            .strip_prefix("stall ")
            .map_or((false, expected.as_str()), |expected| (true, expected));
        assert!(
            format!("{program} {}", args.join(" ")).contains(expected),
            "Expected {expected}, got {program} {args:?}"
        );
        (stall, result.map(str::to_owned))
    }) {
        if stall {
            std::future::pending::<()>().await;
        }
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
enum ProfileMode<'a> {
    Wpa2 { password: &'a str, hotspot: bool },
    Open,
}
fn profile(interface: &str, ssid: &str, password: &str, ap: bool, uuid: &str) -> String {
    network_profile(
        interface,
        ssid,
        ProfileMode::Wpa2 {
            password,
            hotspot: ap,
        },
        uuid,
    )
}
fn network_profile(interface: &str, ssid: &str, mode: ProfileMode<'_>, uuid: &str) -> String {
    let (ap, security) = match mode {
        ProfileMode::Wpa2 { password, hotspot } => (
            hotspot,
            format!(
                "[wifi-security]\nkey-mgmt=wpa-psk\nproto=rsn\npsk={}\n",
                key(password)
            ),
        ),
        ProfileMode::Open => (false, String::new()),
    };
    let ssid_bytes = ssid.bytes().map(|b| format!("{b};")).collect::<String>();
    format!(
        "[connection]\nid={}\nuuid={uuid}\ntype=wifi\ninterface-name={interface}\nautoconnect=false\nautoconnect-priority={}\n[wifi]\nmode={}\nssid={ssid_bytes}\n{}{security}[ipv4]\nmethod={}\n{}[ipv6]\nmethod=disabled\n",
        if ap { "oxidal-hotspot" } else { "oxidal-wifi" },
        if ap { -100 } else { 100 },
        if ap { "ap" } else { "infrastructure" },
        if ap { "band=bg\n" } else { "" },
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
    #[serde(default)]
    previous_region: Option<Vec<u8>>,
    #[serde(default)]
    radio_interface: Option<String>,
    #[serde(default)]
    channel: Option<u8>,
    #[serde(default)]
    saved_connect: bool,
    #[serde(default)]
    radio_only: bool,
    #[serde(default)]
    activation_interface: Option<String>,
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
    region: PathBuf,
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
            region: "/etc/default/oxidal-wireless".into(),
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
        if let Some(bytes) = &journal.previous_region {
            atomic(&self.region, bytes)?;
            self.apply_region().await?;
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
    async fn apply_region(&self) -> Result<()> {
        let value = fs::read_to_string(&self.region)
            .ok()
            .and_then(|v| crate::radio::country(&v))
            .ok_or("Wireless country is unavailable")?;
        run("/usr/sbin/iw", &["reg", "set", &value]).await?;
        for _ in 0..5 {
            let actual = run("/usr/sbin/iw", &["reg", "get"]).await?;
            if actual
                .lines()
                .find_map(|line| line.trim().strip_prefix("country "))
                .is_some_and(|line| line.starts_with(&format!("{value}:")))
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err("Kernel did not accept the requested wireless country")
    }
    async fn radio(&self, interface: &str) -> Result<crate::radio::Radio> {
        let country = fs::read_to_string(&self.region)
            .ok()
            .and_then(|v| crate::radio::country(&v))
            .ok_or("Wireless country is unavailable")?;
        let info = run("/usr/sbin/iw", &["dev", interface, "info"]).await?;
        let phy = info
            .lines()
            .find_map(|line| line.trim().strip_prefix("wiphy "))
            .and_then(|s| s.parse::<u16>().ok())
            .ok_or("Wireless PHY is unavailable")?;
        let caps = run("/usr/sbin/iw", &["phy", &format!("phy{phy}"), "info"]).await?;
        Ok(crate::radio::Radio {
            country,
            channels: crate::radio::channels(&caps),
        })
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
            .is_some_and(|p| p.started.elapsed() >= NETWORK_TRIAL)
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
        let interfaces: Vec<Interface> = devices
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
                    addresses: Vec::new(),
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
                    ssid: None,
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
        let radio = if self.region.is_file() {
            if let Some(interface) = interfaces.iter().find(|d| d.kind == "wifi") {
                self.radio(&interface.name).await.ok()
            } else {
                None
            }
        } else {
            None
        };
        Ok(NetworkState {
            available: true,
            radio,
            wireless_enabled,
            policy: self.policy()?,
            interfaces,
            address_message: None,
            hotspot: None,
            hotspot_message: None,
            saved_message: None,
            capabilities: None,
            capabilities_message: None,
            networks,
            saved,
            pending: self.pending.as_ref().map(|p| Pending {
                transaction: p.id.clone(),
                seconds_remaining: NETWORK_TRIAL
                    .as_secs()
                    .saturating_sub(p.started.elapsed().as_secs()),
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
        let saved_connect = matches!(command, Command::Connect { .. });
        let radio_only = matches!(command, Command::HotspotRadio { .. });
        let open_join = matches!(command, Command::JoinOpen { .. });
        let empty = String::new();
        let (interface, ssid, password, ap) = match command {
            Command::Policy { settings } => (&settings.interface, &empty, &empty, true),
            Command::Connect { interface, .. } => (interface, &empty, &empty, false),
            Command::JoinOpen { interface, ssid } => (interface, ssid, &empty, false),
            Command::HotspotRadio { interface, .. } => (interface, &empty, &empty, true),
            Command::Join {
                interface,
                ssid,
                password,
            } => (interface, ssid, password, false),
            Command::Hotspot {
                interface,
                ssid,
                password,
                ..
            } => (interface, ssid, password, true),
            _ => return Err("Not a network change"),
        };
        let (country, channel) = match command {
            Command::Hotspot {
                country, channel, ..
            } => (country.as_ref(), *channel),
            Command::HotspotRadio {
                country, channel, ..
            } => (Some(country), Some(*channel)),
            _ => (None, None),
        };
        let previous_region = if let Some(country) = country {
            let known = fs::read_to_string("/usr/share/zoneinfo/iso3166.tab")
                .map_err(|_| "Country database is unavailable")?;
            if !known
                .lines()
                .any(|line| line.starts_with(&format!("{country}\t")))
            {
                return Err("Unknown wireless country");
            }
            Some(fs::read(&self.region).map_err(|_| "Managed wireless country is unavailable")?)
        } else {
            None
        };
        let mut state = self.status(false).await?;
        if !state
            .interfaces
            .iter()
            .any(|d| d.name == *interface && d.kind == "wifi")
        {
            return Err("Selected wireless interface is unavailable");
        }
        if open_join {
            let matching = state
                .networks
                .iter()
                .filter(|network| network.ssid == *ssid)
                .collect::<Vec<_>>();
            if matching.is_empty()
                || matching
                    .iter()
                    .any(|network| !network.security.is_empty() && network.security != "--")
            {
                return Err(
                    "Choose an advertised open network without a secured network of the same name",
                );
            }
        }
        if let Command::Connect { uuid, .. } = command
            && !state
                .saved
                .iter()
                .any(|profile| profile.uuid == *uuid && profile.managed && !profile.active)
        {
            return Err("Only inactive Oxidal-managed client networks can be connected");
        }
        // Existing AP is the recovery anchor; do not modify arbitrary host installations.
        let ap_path = self.connections.as_path().join("oxidal.nmconnection");
        if !ap_path.is_file() {
            return Err("Configure the appliance recovery hotspot before making wireless changes");
        }
        let uuid = if let Command::Connect { uuid, .. } = command {
            uuid.clone()
        } else if ap {
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
        if open_join && previous.is_some() {
            return Err("Use the saved connection or forget it before choosing an open network");
        }
        if (saved_connect || radio_only) && previous.is_none() {
            return Err("Saved network profile is unavailable");
        }
        let dev = nm(&[
            "--get-values",
            "GENERAL.DBUS-PATH",
            "device",
            "show",
            interface,
        ])
        .await?;
        let started = Instant::now();
        let result = checkpoint("CheckpointCreate", "aouu", &["1", dev.trim(), "90", "2"]).await?;
        let json: serde_json::Value =
            serde_json::from_str(&result).map_err(|_| "Invalid NetworkManager checkpoint")?;
        let checkpoint = json["data"][0]
            .as_str()
            .filter(|s| s.starts_with("/org/freedesktop/NetworkManager/Checkpoint/"))
            .ok_or("Invalid NetworkManager checkpoint")?
            .to_string();
        let journal = Journal {
            saved_connect,
            radio_only,
            activation_interface: (saved_connect || radio_only || open_join)
                .then(|| interface.clone()),
            file,
            previous,
            uuid,
            checkpoint,
            previous_region,
            radio_interface: if country.is_some() || channel.is_some() {
                Some(interface.clone())
            } else {
                None
            },
            channel,
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
        if let Some(country) = country
            && let Err(error) = atomic(&self.region, format!("COUNTRY={country}\n").as_bytes())
        {
            self.rollback(journal).await?;
            return Err(error);
        }
        let write = if saved_connect || radio_only {
            Ok(())
        } else if let Some(settings) = policy_settings {
            atomic(
                &self.state_dir.join("policy.json"),
                &serde_json::to_vec(settings).map_err(|_| "Cannot encode hotspot policy")?,
            )
        } else {
            let mut candidate = if open_join {
                network_profile(interface, ssid, ProfileMode::Open, &journal.uuid)
            } else {
                profile(interface, ssid, password, ap, &journal.uuid)
            };
            if let Some(channel) = channel
                && channel > 0
            {
                candidate =
                    candidate.replace("band=bg\n", &format!("band=bg\nchannel={channel}\n"));
            }
            atomic(&path, candidate.as_bytes())
        };
        if let Err(error) = write {
            self.rollback(journal).await?;
            return Err(error);
        }
        if started.elapsed() >= NETWORK_TRIAL {
            self.rollback(journal).await?;
            return Err("Network change expired during preparation");
        }
        self.pending = Some(Transaction {
            id: transaction.clone(),
            started,
            phase: "connecting".into(),
            journal,
        });
        state.pending = Some(Pending {
            transaction,
            seconds_remaining: NETWORK_TRIAL
                .as_secs()
                .saturating_sub(started.elapsed().as_secs()),
            phase: "connecting".into(),
        });
        state.message="Reconnect your browser and confirm within 90 seconds, otherwise the previous network returns".into();
        Ok(state)
    }
    pub async fn activate(&mut self) {
        let Some(pending) = &self.pending else { return };
        let started = pending.started;
        let remaining = NETWORK_TRIAL.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            self.tick().await;
            return;
        }
        let path = self.connections.clone().join(&pending.journal.file);
        let uuid = pending.journal.uuid.clone();
        let policy_change = pending.journal.policy_change;
        let saved_connect = pending.journal.saved_connect;
        let radio_only = pending.journal.radio_only;
        let activation_interface = pending.journal.activation_interface.clone();
        let region_changed = pending.journal.previous_region.is_some();
        let radio_interface = pending.journal.radio_interface.clone();
        let channel = pending.journal.channel;
        let result = tokio::time::timeout(remaining, async {
            if policy_change {
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
                    if region_changed {
                        self.apply_region().await?;
                    }
                    if let Some(interface) = radio_interface {
                        let radio = self.radio(&interface).await?;
                        if let Some(channel) = channel
                            && channel != 0
                            && !radio.channels.contains(&channel)
                        {
                            return Err("Channel is not allowed by this radio and country");
                        }
                    }
                    if saved_connect || radio_only {
                        nm(&[
                            "connection",
                            "modify",
                            "uuid",
                            &uuid,
                            "connection.autoconnect",
                            "no",
                        ])
                        .await?;
                    }
                    if radio_only {
                        let channel = channel
                            .ok_or("Configured hotspot channel is unavailable")?
                            .to_string();
                        nm(&[
                            "connection",
                            "modify",
                            "uuid",
                            &uuid,
                            "802-11-wireless.band",
                            "bg",
                            "802-11-wireless.channel",
                            &channel,
                        ])
                        .await?;
                    }
                    nm(&["connection", "load", path.to_str().unwrap()]).await?;
                    nm(&["radio", "wifi", "on"]).await?;
                    if let Some(interface) = activation_interface {
                        nm(&["connection", "up", "uuid", &uuid, "ifname", &interface]).await
                    } else {
                        nm(&["connection", "up", "uuid", &uuid]).await
                    }
                }
                .await
            }
        })
        .await
        .unwrap_or(Err("Network change expired"));
        if result.is_ok() && started.elapsed() < NETWORK_TRIAL {
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
            Command::NetworkCapabilities {} => {
                return Ok(NetworkState {
                    capabilities: Some(crate::NetworkCapabilities {
                        schema_version: 1,
                        saved_connect: true,
                        open_join: true,
                        hotspot_radio: true,
                    }),
                    ..Default::default()
                });
            }
            Command::Status {} => {}
            Command::Scan {} => return self.status(true).await,
            Command::Confirm { transaction } | Command::Cancel { transaction } => {
                let Some(pending) = &self.pending else {
                    return Err("No network change is pending");
                };
                if pending.id != transaction || pending.started.elapsed() >= NETWORK_TRIAL {
                    return Err("Network transaction expired or changed");
                }
                if cancel {
                    let old = self.pending.take().unwrap();
                    self.rollback(old.journal).await?;
                } else {
                    if pending.phase != "awaiting_confirmation" {
                        return Err("Network connection is not ready");
                    }
                    let remaining = NETWORK_TRIAL.saturating_sub(pending.started.elapsed());
                    let confirmed = tokio::time::timeout(remaining, async {
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
                            if let Some(interface) = &pending.journal.activation_interface {
                                let devices = nm(&[
                                    "--get-values",
                                    "GENERAL.DEVICES",
                                    "connection",
                                    "show",
                                    "uuid",
                                    &pending.journal.uuid,
                                ])
                                .await?;
                                if devices.trim() != interface {
                                    return Err(
                                        "Saved network is not active on the selected interface",
                                    );
                                }
                            }
                            nm(&[
                                "connection",
                                "modify",
                                "uuid",
                                &pending.journal.uuid,
                                "connection.autoconnect",
                                if pending.journal.file == "oxidal.nmconnection"
                                    && self.policy()?.is_some()
                                {
                                    "no"
                                } else {
                                    "yes"
                                },
                            ])
                            .await?;
                        }
                        checkpoint("CheckpointDestroy", "o", &[&pending.journal.checkpoint])
                            .await?;
                        Ok(())
                    })
                    .await;
                    match confirmed {
                        Ok(result) => result?,
                        Err(_) => {
                            let old = self.pending.take().unwrap();
                            self.rollback(old.journal).await?;
                            return Err("Network transaction expired");
                        }
                    }
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
                region: self.root.join("region"),
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
    const SAVED_UUID: &str = "11111111-1111-1111-1111-111111111111";
    fn connect() -> Command {
        Command::Connect {
            interface: "wlan0".into(),
            uuid: SAVED_UUID.into(),
        }
    }
    fn saved_status(active: bool) -> Responses {
        let mut commands = status();
        commands.back_mut().unwrap().1 = Ok(if active {
            "11111111-1111-1111-1111-111111111111:oxidal-wifi:802-11-wireless:wlan0\n"
        } else {
            "11111111-1111-1111-1111-111111111111:oxidal-wifi:802-11-wireless:--\n"
        });
        commands
    }
    fn saved_begin() -> Responses {
        let mut commands = saved_status(false);
        commands.extend(begin().into_iter().skip(4));
        commands
    }
    fn save_client(fixture: &Fixture) -> (PathBuf, Vec<u8>) {
        let path = fixture
            .root
            .join(format!("connections/oxidal-{SAVED_UUID}.nmconnection"));
        let original = profile(
            "wlan0",
            "Saved studio",
            "existing-private-password",
            false,
            SAVED_UUID,
        )
        .replace("autoconnect=false", "autoconnect=true")
        .into_bytes();
        fs::write(&path, &original).unwrap();
        (path, original)
    }
    fn saved_rollback() -> Responses {
        responses(&[
            ("connection load", Ok("")),
            ("CheckpointRollback", Ok("")),
            ("CheckpointDestroy", Ok("")),
            ("TYPE,STATE", Ok("wifi:connected\n")),
        ])
    }
    #[tokio::test]
    async fn capability_read_has_no_network_operation_and_status_stays_legacy_compatible() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        COMMANDS
            .scope(RefCell::new(status()), async {
                let capabilities = network
                    .command(Command::NetworkCapabilities {})
                    .await
                    .unwrap();
                assert_eq!(
                    capabilities.capabilities.as_ref().unwrap().schema_version,
                    1
                );
                let flags = capabilities.capabilities.unwrap();
                assert!(flags.saved_connect && flags.open_join && flags.hotspot_radio);
                let ordinary = network.command(Command::Status {}).await.unwrap();
                assert!(ordinary.capabilities.is_none());
                assert!(
                    serde_json::to_value(ordinary)
                        .unwrap()
                        .get("capabilities")
                        .is_none()
                );
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn saved_connect_keeps_credentials_and_confirms_only_the_selected_interface() {
        let fixture = Fixture::new();
        let (path, original) = save_client(&fixture);
        let mut network = fixture.network();
        let mut commands = saved_begin();
        commands.extend(responses(&[
            ("connection.autoconnect no", Ok("")),
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            (
                "up uuid 11111111-1111-1111-1111-111111111111 ifname wlan0",
                Ok(""),
            ),
            ("GENERAL.STATE", Ok("deactivated\n")),
            ("GENERAL.STATE", Ok("activated\n")),
            ("GENERAL.DEVICES", Ok("wlan1\n")),
            ("GENERAL.STATE", Ok("activated\n")),
            ("GENERAL.DEVICES", Ok("wlan0\n")),
            ("connection.autoconnect yes", Ok("")),
            ("CheckpointDestroy", Ok("")),
        ]));
        commands.extend(saved_status(true));
        COMMANDS
            .scope(RefCell::new(commands), async {
                let state = network.begin(&connect()).await.unwrap();
                let transaction = state.pending.unwrap().transaction;
                assert_eq!(fs::read(&path).unwrap(), original);
                assert!(
                    !serde_json::to_string(&state.saved)
                        .unwrap()
                        .contains("existing-private-password")
                );
                let journal: Journal = serde_json::from_slice(
                    &fs::read(fixture.root.join("state/pending.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(journal.previous.as_ref().unwrap(), &original);
                assert!(journal.saved_connect);
                assert_eq!(journal.activation_interface.as_deref(), Some("wlan0"));
                let mut legacy = serde_json::to_value(&journal).unwrap();
                legacy.as_object_mut().unwrap().remove("saved_connect");
                legacy.as_object_mut().unwrap().remove("radio_only");
                legacy
                    .as_object_mut()
                    .unwrap()
                    .remove("activation_interface");
                let restored: Journal = serde_json::from_value(legacy).unwrap();
                assert!(
                    !restored.saved_connect
                        && !restored.radio_only
                        && restored.activation_interface.is_none()
                );
                assert!(network.begin(&connect()).await.is_err());
                assert!(
                    network
                        .command(Command::Confirm {
                            transaction: "0".repeat(32)
                        })
                        .await
                        .is_err()
                );
                network.activate().await;
                for _ in 0..2 {
                    assert!(
                        network
                            .command(Command::Confirm {
                                transaction: transaction.clone()
                            })
                            .await
                            .is_err()
                    );
                    assert!(network.pending.is_some());
                }
                let state = network
                    .command(Command::Confirm { transaction })
                    .await
                    .unwrap();
                assert!(state.pending.is_none());
                assert_eq!(fs::read(path).unwrap(), original);
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn saved_connect_rejects_unknown_active_or_unmanaged_profiles_before_checkpoint() {
        for scenario in ["unknown", "active", "unmanaged", "interface"] {
            let fixture = Fixture::new();
            if scenario != "unmanaged" {
                save_client(&fixture);
            }
            let mut network = fixture.network();
            let command = Command::Connect {
                interface: if scenario == "interface" {
                    "wlan9"
                } else {
                    "wlan0"
                }
                .into(),
                uuid: if scenario == "unknown" {
                    "22222222-2222-2222-2222-222222222222"
                } else {
                    SAVED_UUID
                }
                .into(),
            };
            COMMANDS
                .scope(RefCell::new(saved_status(scenario == "active")), async {
                    assert!(network.begin(&command).await.is_err(), "{scenario}");
                    assert!(!fixture.root.join("state/pending.json").exists());
                    assert!(network.pending.is_none());
                    COMMANDS.with(|q| assert!(q.borrow().is_empty()));
                })
                .await;
        }
    }
    #[tokio::test]
    async fn saved_connect_failed_activation_restores_original_profile_and_credentials() {
        let fixture = Fixture::new();
        let (path, original) = save_client(&fixture);
        let mut network = fixture.network();
        let mut commands = saved_begin();
        commands.extend(responses(&[
            ("connection.autoconnect no", Ok("")),
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            (
                "up uuid 11111111-1111-1111-1111-111111111111 ifname wlan0",
                Err("Connection failed"),
            ),
        ]));
        commands.extend(saved_rollback());
        COMMANDS
            .scope(RefCell::new(commands), async {
                network.begin(&connect()).await.unwrap();
                fs::write(
                    &path,
                    b"simulated trial profile after NM autoconnect change",
                )
                .unwrap();
                network.activate().await;
                assert!(network.pending.is_none());
                assert_eq!(fs::read(path).unwrap(), original);
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn saved_connect_cancel_expiry_and_restart_restore_exact_original_credentials() {
        for ending in ["cancel", "expiry", "restart"] {
            let fixture = Fixture::new();
            let (path, original) = save_client(&fixture);
            let mut network = fixture.network();
            let mut commands = saved_begin();
            commands.extend(saved_rollback());
            if ending == "cancel" {
                commands.extend(saved_status(false));
            }
            COMMANDS
                .scope(RefCell::new(commands), async {
                    let transaction = network
                        .begin(&connect())
                        .await
                        .unwrap()
                        .pending
                        .unwrap()
                        .transaction;
                    fs::write(&path, b"simulated changed autoconnect setting").unwrap();
                    if ending == "cancel" {
                        network
                            .command(Command::Cancel { transaction })
                            .await
                            .unwrap();
                    } else if ending == "restart" {
                        drop(network);
                        fixture.network().recover().await.unwrap();
                    } else {
                        network.pending.as_mut().unwrap().started =
                            Instant::now() - Duration::from_secs(91);
                        network.tick().await;
                        assert!(network.pending.is_none());
                    }
                    assert_eq!(fs::read(path).unwrap(), original);
                    assert!(!fixture.root.join("state/pending.json").exists());
                    COMMANDS.with(|q| assert!(q.borrow().is_empty()));
                })
                .await;
        }
    }

    #[tokio::test]
    async fn expired_preparation_rolls_back_without_activating_saved_credentials() {
        let fixture = Fixture::new();
        let (path, original) = save_client(&fixture);
        let mut network = fixture.network();
        let mut commands = saved_begin();
        commands.extend(saved_rollback());
        COMMANDS
            .scope(RefCell::new(commands), async {
                let state = network.begin(&connect()).await.unwrap();
                assert!(state.pending.unwrap().seconds_remaining <= NETWORK_TRIAL.as_secs());
                network.pending.as_mut().unwrap().started = Instant::now() - NETWORK_TRIAL;
                network.activate().await;
                assert!(network.pending.is_none());
                assert_eq!(fs::read(path).unwrap(), original);
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }

    #[tokio::test]
    async fn stalled_confirmation_rolls_back_without_persisting_after_the_trial() {
        let fixture = Fixture::new();
        let (path, original) = save_client(&fixture);
        let mut network = fixture.network();
        let mut commands = saved_begin();
        commands.extend(responses(&[
            ("connection.autoconnect no", Ok("")),
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            ("up uuid", Ok("")),
            ("stall GENERAL.STATE", Ok("activated\n")),
        ]));
        commands.extend(saved_rollback());
        COMMANDS
            .scope(RefCell::new(commands), async {
                let transaction = network
                    .begin(&connect())
                    .await
                    .unwrap()
                    .pending
                    .unwrap()
                    .transaction;
                network.activate().await;
                network.pending.as_mut().unwrap().started =
                    Instant::now() - Duration::from_secs(89);
                assert_eq!(
                    network
                        .command(Command::Confirm { transaction })
                        .await
                        .unwrap_err(),
                    "Network transaction expired"
                );
                assert!(network.pending.is_none());
                assert_eq!(fs::read(path).unwrap(), original);
                assert!(!fixture.root.join("state/pending.json").exists());
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }

    fn open_status(scan: &'static str) -> Responses {
        let mut commands = status();
        commands
            .iter_mut()
            .find(|(name, _)| name == "IN-USE,SSID,SIGNAL,SECURITY")
            .unwrap()
            .1 = Ok(scan);
        commands
    }
    fn open_begin() -> Responses {
        let mut commands = open_status(":Guest:55:--\n");
        commands.extend(begin().into_iter().skip(4));
        commands
    }
    #[tokio::test]
    async fn explicit_open_join_creates_only_an_open_client_and_checks_its_interface() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        let mut commands = open_begin();
        commands.extend(responses(&[
            ("connection load", Ok("")),
            ("radio wifi on", Ok("")),
            ("ifname wlan0", Ok("")),
            ("GENERAL.STATE", Ok("activated\n")),
            ("GENERAL.DEVICES", Ok("wlan0\n")),
            ("connection.autoconnect yes", Ok("")),
            ("CheckpointDestroy", Ok("")),
        ]));
        commands.extend(status());
        COMMANDS
            .scope(RefCell::new(commands), async {
                let state = network
                    .begin(&Command::JoinOpen {
                        interface: "wlan0".into(),
                        ssid: "Guest".into(),
                    })
                    .await
                    .unwrap();
                let path = fixture
                    .root
                    .join(format!("connections/oxidal-{}.nmconnection", uuid("Guest")));
                let profile = fs::read_to_string(path).unwrap();
                assert!(
                    profile.contains("mode=infrastructure\n")
                        && profile.contains("autoconnect=false\n")
                );
                assert!(
                    !profile.contains("wifi-security")
                        && !profile.contains("psk=")
                        && !profile.contains("method=shared")
                );
                network.activate().await;
                network
                    .command(Command::Confirm {
                        transaction: state.pending.unwrap().transaction,
                    })
                    .await
                    .unwrap();
                assert!(network.pending.is_none());
                assert_eq!(
                    fs::read(fixture.root.join("connections/oxidal.nmconnection")).unwrap(),
                    b"original recovery AP"
                );
                COMMANDS.with(|q| assert!(q.borrow().is_empty()));
            })
            .await;
    }
    #[tokio::test]
    async fn open_join_refuses_unknown_secured_ambiguous_or_existing_profiles_before_checkpoint() {
        for scan in [
            "",
            ":Guest:55:WPA2\n",
            ":Guest:55:--\n:Guest:50:WPA2\n",
            ":Guest:55:--\n",
        ] {
            let fixture = Fixture::new();
            if scan == ":Guest:55:--\n" {
                fs::write(
                    fixture
                        .root
                        .join(format!("connections/oxidal-{}.nmconnection", uuid("Guest"))),
                    b"existing saved credentials",
                )
                .unwrap();
            }
            let mut network = fixture.network();
            COMMANDS
                .scope(RefCell::new(open_status(scan)), async {
                    assert!(
                        network
                            .begin(&Command::JoinOpen {
                                interface: "wlan0".into(),
                                ssid: "Guest".into()
                            })
                            .await
                            .is_err()
                    );
                    assert!(network.pending.is_none());
                    assert!(!fixture.root.join("state/pending.json").exists());
                    COMMANDS.with(|q| assert!(q.borrow().is_empty()));
                })
                .await;
        }
    }
    fn radio_readback() -> Responses {
        responses(&[
            ("iw dev wlan0 info", Ok("Interface wlan0\n wiphy 0\n")),
            ("iw phy phy0 info", Ok("* 2437 MHz [6] (20.0 dBm)\n")),
        ])
    }
    #[tokio::test]
    async fn radio_only_changes_preserve_hotspot_credentials_and_restore_country_on_failure() {
        for failure in [false, true] {
            let fixture = Fixture::new();
            let mut network = fixture.network();
            fs::write(&network.region, b"COUNTRY=NZ\n").unwrap();
            let original = profile(
                "wlan0",
                "Original hotspot",
                "existing-private-password",
                true,
                SAVED_UUID,
            )
            .into_bytes();
            let path = fixture.root.join("connections/oxidal.nmconnection");
            fs::write(&path, &original).unwrap();
            let mut commands = status();
            commands.extend(radio_readback());
            commands.extend(responses(&[
                (
                    "connection.uuid",
                    Ok("11111111-1111-1111-1111-111111111111\n"),
                ),
                (
                    "GENERAL.DBUS-PATH",
                    Ok("/org/freedesktop/NetworkManager/Devices/2\n"),
                ),
                (
                    "CheckpointCreate",
                    Ok(r#"{"data":["/org/freedesktop/NetworkManager/Checkpoint/1"]}"#),
                ),
                ("iw reg set AU", Ok("")),
                ("iw reg get", Ok("global\ncountry AU: DFS-ETSI\n")),
            ]));
            commands.extend(radio_readback());
            commands.extend(responses(&[
                ("connection.autoconnect no", Ok("")),
                ("802-11-wireless.band bg 802-11-wireless.channel 6", Ok("")),
                ("connection load", Ok("")),
                ("radio wifi on", Ok("")),
                (
                    "ifname wlan0",
                    if failure {
                        Err("Activation failed")
                    } else {
                        Ok("")
                    },
                ),
            ]));
            if failure {
                commands.extend(responses(&[
                    ("iw reg set NZ", Ok("")),
                    ("iw reg get", Ok("global\ncountry NZ: DFS-ETSI\n")),
                    ("connection load", Ok("")),
                    ("CheckpointRollback", Ok("")),
                    ("CheckpointDestroy", Ok("")),
                    ("connection up id oxidal-hotspot", Ok("")),
                    ("TYPE,STATE", Ok("wifi:connected\n")),
                ]));
            } else {
                commands.extend(responses(&[
                    ("GENERAL.STATE", Ok("activated\n")),
                    ("GENERAL.DEVICES", Ok("wlan0\n")),
                    ("connection.autoconnect yes", Ok("")),
                    ("CheckpointDestroy", Ok("")),
                ]));
                commands.extend(status());
                commands.extend(radio_readback());
            }
            COMMANDS
                .scope(RefCell::new(commands), async {
                    let state = network
                        .begin(&Command::HotspotRadio {
                            interface: "wlan0".into(),
                            country: "AU".into(),
                            channel: 6,
                        })
                        .await
                        .unwrap();
                    assert_eq!(
                        fs::read(&path).unwrap(),
                        original,
                        "Preparing radio settings must not regenerate credentials"
                    );
                    let journal: Journal = serde_json::from_slice(
                        &fs::read(fixture.root.join("state/pending.json")).unwrap(),
                    )
                    .unwrap();
                    assert!(journal.radio_only);
                    assert_eq!(journal.previous.as_ref().unwrap(), &original);
                    network.activate().await;
                    if !failure {
                        network
                            .command(Command::Confirm {
                                transaction: state.pending.unwrap().transaction,
                            })
                            .await
                            .unwrap();
                    }
                    assert!(network.pending.is_none());
                    assert_eq!(fs::read(&path).unwrap(), original);
                    assert_eq!(
                        fs::read(&network.region).unwrap(),
                        if failure {
                            b"COUNTRY=NZ\n"
                        } else {
                            b"COUNTRY=AU\n"
                        }
                    );
                    assert!(!fixture.root.join("state/pending.json").exists());
                    COMMANDS.with(|q| assert!(q.borrow().is_empty()));
                })
                .await;
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
                        country: None,
                        channel: None,
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
    async fn rollback_restores_persisted_country_before_reactivating_hotspot() {
        let fixture = Fixture::new();
        let mut network = fixture.network();
        atomic(&network.region, b"COUNTRY=AU\n").unwrap();
        let journal = Journal {
            saved_connect: false,
            radio_only: false,
            activation_interface: None,
            file: "oxidal.nmconnection".into(),
            previous: Some(b"old hotspot".to_vec()),
            uuid: "12345678-1234-4234-8234-123456789012".into(),
            checkpoint: "/org/freedesktop/NetworkManager/Checkpoint/1".into(),
            policy_change: false,
            previous_policy: None,
            previous_region: Some(b"COUNTRY=NZ\n".to_vec()),
            radio_interface: Some("wlan0".into()),
            channel: Some(6),
        };
        atomic(
            &network.state_dir.join("pending.json"),
            &serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        let commands = responses(&[
            ("iw reg set NZ", Ok("")),
            ("iw reg get", Ok("global\ncountry NZ: DFS-ETSI\n")),
            ("connection load", Ok("")),
            ("CheckpointRollback", Ok("")),
            ("CheckpointDestroy", Ok("")),
            ("connection up id oxidal-hotspot", Ok("")),
            ("TYPE,STATE", Ok("wifi:connected\n")),
        ]);
        COMMANDS
            .scope(RefCell::new(commands), async {
                network.rollback(journal).await.unwrap();
                assert_eq!(fs::read_to_string(&network.region).unwrap(), "COUNTRY=NZ\n");
                assert!(!network.state_dir.join("pending.json").exists());
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
