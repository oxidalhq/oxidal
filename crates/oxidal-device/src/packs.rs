//! Fixed Debian effect-pack administration. Browser input never becomes a package name.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{process::Stdio, time::Duration};
use tokio::{process::Command, task::JoinHandle};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackAction {
    Install,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectPack {
    pub id: String,
    pub name: String,
    pub package: String,
    pub size_mib: u16,
    pub usable_plugins: u16,
    pub installed: bool,
    pub version: Option<String>,
    pub qualification: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PackJob {
    pub pack: String,
    pub action: PackAction,
    pub phase: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PackState {
    pub available: bool,
    pub audio_running: bool,
    pub packs: Vec<EffectPack>,
    pub job: Option<PackJob>,
    pub message: String,
}

#[derive(Clone, Copy)]
struct Spec {
    id: &'static str,
    name: &'static str,
    package: &'static str,
    size_mib: u16,
    usable_plugins: u16,
    qualification: &'static str,
}

const SPECS: [Spec; 8] = [
    Spec {
        id: "guitarix",
        name: "Guitarix",
        package: "guitarix-lv2",
        size_mib: 20,
        usable_plugins: 70,
        qualification: "ARM64 harness; two isolated exceptions",
    },
    Spec {
        id: "dragonfly",
        name: "Dragonfly Reverb",
        package: "dragonfly-reverb-lv2",
        size_mib: 9,
        usable_plugins: 4,
        qualification: "ARM64 harness",
    },
    Spec {
        id: "calf",
        name: "Calf",
        package: "calf-plugins",
        size_mib: 23,
        usable_plugins: 37,
        qualification: "ARM64 harness",
    },
    Spec {
        id: "invada",
        name: "Invada Studio",
        package: "invada-studio-plugins-lv2",
        size_mib: 3,
        usable_plugins: 14,
        qualification: "ARM64 harness",
    },
    Spec {
        id: "x42",
        name: "x42",
        package: "x42-plugins",
        size_mib: 10,
        usable_plugins: 44,
        qualification: "ARM64 harness; resource effects excluded",
    },
    Spec {
        id: "mda",
        name: "MDA",
        package: "mda-lv2",
        size_mib: 5,
        usable_plugins: 31,
        qualification: "ARM64 harness",
    },
    Spec {
        id: "swh",
        name: "SWH",
        package: "swh-lv2",
        size_mib: 3,
        usable_plugins: 78,
        qualification: "ARM64 harness and this Pi",
    },
    Spec {
        id: "fomp",
        name: "FOMP",
        package: "fomp",
        size_mib: 2,
        usable_plugins: 4,
        qualification: "ARM64 harness",
    },
];

pub fn known(id: &str) -> bool {
    SPECS.iter().any(|spec| spec.id == id)
}

pub fn catalog() -> Vec<EffectPack> {
    SPECS
        .iter()
        .map(|spec| EffectPack {
            id: spec.id.into(),
            name: spec.name.into(),
            package: spec.package.into(),
            size_mib: spec.size_mib,
            usable_plugins: spec.usable_plugins,
            installed: false,
            version: None,
            qualification: spec.qualification.into(),
        })
        .collect()
}

#[derive(Debug)]
struct Active {
    pack: &'static str,
    action: PackAction,
    task: JoinHandle<Result<(), &'static str>>,
}

#[derive(Debug, Default)]
pub struct Manager {
    active: Option<Active>,
    message: String,
}

impl Manager {
    pub async fn start(&mut self, id: &str, action: PackAction) -> Result<(), &'static str> {
        self.finish().await;
        if self.active.is_some() {
            return Err("Another effect-pack change is already running");
        }
        let spec = SPECS
            .iter()
            .find(|spec| spec.id == id)
            .ok_or("Unknown effect pack")?;
        let package = spec.package;
        self.message = match action {
            PackAction::Install => format!("Installing {}", spec.name),
            PackAction::Remove => format!("Removing {}", spec.name),
        };
        self.active = Some(Active {
            pack: spec.id,
            action,
            task: tokio::spawn(async move { change(package, action).await }),
        });
        Ok(())
    }

    pub async fn state(&mut self) -> PackState {
        self.finish().await;
        let available = cfg!(target_os = "linux")
            && std::path::Path::new("/usr/bin/apt-get").is_file()
            && std::path::Path::new("/usr/bin/dpkg-query").is_file();
        let mut packs = catalog();
        for pack in &mut packs {
            pack.version = installed_version(&pack.package).await;
            pack.installed = pack.version.is_some();
        }
        PackState {
            available,
            audio_running: false,
            packs,
            job: self.active.as_ref().map(|active| PackJob {
                pack: active.pack.into(),
                action: active.action,
                phase: "running".into(),
            }),
            message: if available {
                self.message.clone()
            } else {
                "Effect-pack administration is unavailable on this host".into()
            },
        }
    }

    async fn finish(&mut self) {
        if !self
            .active
            .as_ref()
            .is_some_and(|active| active.task.is_finished())
        {
            return;
        }
        let active = self.active.take().expect("finished task exists");
        self.message = match active.task.await {
            Ok(Ok(())) => match active.action {
                PackAction::Install => "Effect pack installed".into(),
                PackAction::Remove => "Effect pack removed".into(),
            },
            Ok(Err(error)) => error.into(),
            Err(_) => "Effect-pack job failed".into(),
        };
    }
}

async fn installed_version(package: &str) -> Option<String> {
    let output = Command::new("/usr/bin/dpkg-query")
        .args(["-W", "-f=${db:Status-Status} ${Version}", package])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    value.trim().strip_prefix("installed ").map(str::to_owned)
}

async fn change(package: &str, action: PackAction) -> Result<(), &'static str> {
    let verb = match action {
        PackAction::Install => "install",
        PackAction::Remove => "remove",
    };
    let mut child = Command::new("/usr/bin/nice")
        .args([
            "-n",
            "19",
            "/usr/bin/ionice",
            "-c",
            "3",
            "/usr/bin/apt-get",
            verb,
            "-y",
            "--no-install-recommends",
            package,
        ])
        .env("DEBIAN_FRONTEND", "noninteractive")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Cannot start the package manager")?;
    let status = tokio::time::timeout(Duration::from_secs(30 * 60), child.wait())
        .await
        .map_err(|_| "Effect-pack change timed out")?
        .map_err(|_| "Package manager failed")?;
    if status.success() {
        Ok(())
    } else {
        Err("Effect-pack change failed; check the network and package service")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_has_only_qualified_nonempty_packs() {
        assert_eq!(SPECS.len(), 8);
        assert!(SPECS.iter().all(|pack| pack.usable_plugins > 0));
        assert!(known("swh"));
        assert!(!known("lsp"));
        assert!(!known("../swh-lv2"));
    }

    #[tokio::test]
    #[cfg(target_os = "linux")]
    #[ignore = "requires root, apt and an explicitly disposable Debian host"]
    async fn disposable_fomp_install_remove_roundtrip() {
        assert_eq!(std::env::var("OXIDAL_TEST_PACKS").as_deref(), Ok("1"));
        assert!(installed_version("fomp").await.is_none());
        change("fomp", PackAction::Install).await.unwrap();
        assert!(installed_version("fomp").await.is_some());
        change("fomp", PackAction::Remove).await.unwrap();
        assert!(installed_version("fomp").await.is_none());
    }
}
