//! Read-only Debian metadata used by pack details and LV2 discovery.
use super::{SPECS, installed_version};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::AsyncReadExt;

const MAX_PACKAGE_OUTPUT: usize = 1024 * 1024;
const MAX_COPYRIGHT_BYTES: u64 = 64 * 1024;

pub(super) async fn query(args: &[&str], limit: usize) -> Option<String> {
    let mut child = tokio::process::Command::new("/usr/bin/dpkg-query")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let result = tokio::time::timeout(Duration::from_secs(2), async {
        let mut bytes = Vec::new();
        child
            .stdout
            .take()?
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .ok()?;
        if bytes.len() > limit || !child.wait().await.ok()?.success() {
            return None;
        }
        String::from_utf8(bytes).ok()
    })
    .await
    .ok()
    .flatten();
    if result.is_none() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    result
}

/// One fresh index of manifests listed by the installed allowlisted packages.
#[derive(Debug, Default)]
pub struct ManifestOwners(BTreeMap<PathBuf, Option<&'static str>>);
impl ManifestOwners {
    pub async fn scan() -> Self {
        let Some(status) = query(
            &["-W", "-f=${Package}\t${db:Status-Status}\n"],
            MAX_PACKAGE_OUTPUT,
        )
        .await
        else {
            return Self::default();
        };
        let mut installed = BTreeSet::new();
        for row in status.lines() {
            let Some((package, state)) = row.split_once('\t') else {
                return Self::default();
            };
            if state == "installed"
                && SPECS.iter().any(|spec| spec.package == package)
                && !installed.insert(package)
            {
                return Self::default(); // Multiple installed architectures make the owner unclear.
            }
        }
        let mut jobs = tokio::task::JoinSet::new();
        for spec in SPECS.iter().filter(|spec| installed.contains(spec.package)) {
            jobs.spawn(async move {
                let paths = query(&["-L", "--", spec.package], MAX_PACKAGE_OUTPUT).await?;
                Some((spec.id, paths))
            });
        }
        let mut owners = Self::default();
        while let Some(result) = jobs.join_next().await {
            let Ok(Some((id, paths))) = result else {
                return Self::default(); // An incomplete index cannot prove unique ownership.
            };
            owners.add_listing(id, &paths);
        }
        owners
    }
    fn add_listing(&mut self, id: &'static str, paths: &str) {
        for path in paths.lines().filter(|line| line.len() <= 4096) {
            let path = Path::new(path);
            if !path.is_absolute() || path.file_name().is_none_or(|file| file != "manifest.ttl") {
                continue;
            }
            let Some(bundle) = path
                .parent()
                .filter(|p| p.extension().is_some_and(|ext| ext == "lv2"))
            else {
                continue;
            };
            if let Some(manifest) = canonical_manifest(bundle) {
                self.0
                    .entry(manifest)
                    .and_modify(|owner| {
                        if *owner != Some(id) {
                            *owner = None;
                        }
                    })
                    .or_insert(Some(id));
            }
        }
    }
    pub fn pack_for(&self, bundle: &Path) -> Option<&'static str> {
        self.0.get(&canonical_manifest(bundle)?).copied().flatten()
    }
}

fn canonical_manifest(bundle: &Path) -> Option<PathBuf> {
    let manifest = bundle.canonicalize().ok()?.join("manifest.ttl");
    let metadata = fs::symlink_metadata(&manifest).ok()?;
    metadata.is_file().then_some(manifest)
}

/// Obtain the current packaged copyright text for this exact allowlist ID.
pub async fn copyright(id: &str) -> Option<String> {
    let pack = SPECS.iter().find(|spec| spec.id == id)?;
    installed_version(pack.package).await?;
    package_copyright(pack.package.into()).await
}

pub(super) async fn package_copyright(package: String) -> Option<String> {
    tokio::task::spawn_blocking(move || read_copyright(Path::new("/usr/share/doc"), &package))
        .await
        .ok()
        .flatten()
}

fn read_copyright(root: &Path, package: &str) -> Option<String> {
    let root = root.canonicalize().ok()?;
    let path = root.join(package).join("copyright").canonicalize().ok()?;
    if !path.starts_with(&root) {
        return None;
    }
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_COPYRIGHT_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_COPYRIGHT_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_COPYRIGHT_BYTES {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    if text.trim().is_empty()
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
    {
        return None;
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("oxidal-{name}-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn manifest_owner_requires_the_exact_bundle_and_unique_listing() {
        let root = fixture("pack-owner");
        let bundle = root.join("system/example.lv2");
        let shadow = root.join("user/example.lv2");
        for dir in [&bundle, &shadow] {
            fs::create_dir_all(dir).unwrap();
        }
        let manifest = bundle.join("manifest.ttl");
        fs::write(&manifest, b"manifest").unwrap();
        let mut owners = ManifestOwners::default();
        owners.add_listing(
            "swh",
            &format!("/usr/lib/lv2/unlisted.lv2\n{}\n", manifest.display()),
        );
        assert_eq!(owners.pack_for(&bundle), Some("swh"));
        assert_eq!(owners.pack_for(&shadow), None);
        let shadow_manifest = shadow.join("manifest.ttl");
        symlink(&manifest, &shadow_manifest).unwrap();
        assert_eq!(owners.pack_for(&shadow), None);
        fs::remove_file(&shadow_manifest).unwrap();
        fs::write(&shadow_manifest, b"manifest").unwrap();
        assert_eq!(owners.pack_for(&shadow), None);
        owners.add_listing("fomp", manifest.to_str().unwrap());
        owners.add_listing("swh", manifest.to_str().unwrap());
        assert_eq!(owners.pack_for(&bundle), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copyright_requires_regular_bounded_utf8_inside_the_doc_root() {
        let root = fixture("pack-copyright");
        let docs = root.join("doc");
        let pack = docs.join("swh-lv2");
        fs::create_dir_all(&pack).unwrap();
        let copyright = pack.join("copyright");

        assert_eq!(read_copyright(&docs, "swh-lv2"), None);
        fs::create_dir(&copyright).unwrap();
        assert_eq!(read_copyright(&docs, "swh-lv2"), None);
        fs::remove_dir(&copyright).unwrap();
        let outside = root.join("outside");
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, &copyright).unwrap();
        assert_eq!(read_copyright(&docs, "swh-lv2"), None);
        fs::remove_file(&copyright).unwrap();

        let valid = "Files: *\nCopyright: Renée\nLicence: GPL-2+\n";
        for bad in [
            &[0xff][..],
            &[b'x', 0],
            &vec![b'a'; MAX_COPYRIGHT_BYTES as usize + 1],
        ] {
            fs::write(&copyright, bad).unwrap();
            assert_eq!(read_copyright(&docs, "swh-lv2"), None);
        }
        fs::write(&copyright, valid).unwrap();
        assert_eq!(read_copyright(&docs, "swh-lv2").as_deref(), Some(valid));
        fs::remove_dir_all(root).unwrap();
    }
}
