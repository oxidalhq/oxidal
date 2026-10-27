use super::*;
use serde_json::{Value, json};
const CURRENT: &[u8] = include_bytes!("../../tests/fixtures/authored-current.t3kpreset");
const SOURCE: &[u8] = include_bytes!("../../tests/fixtures/authored-legacy.t3kpreset");
struct Temporary(PathBuf);
impl Temporary {
    fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "oxidal-bundle-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn parts(mixed: bool) -> (Vec<u8>, BTreeMap<String, Vec<u8>>) {
    let mut manifest: Value = serde_json::from_str(if mixed {
        include_str!("../../../../docs/presets/examples/mixed-delay.json")
    } else {
        include_str!("../../../../docs/presets/examples/pure-edited.json")
    })
    .unwrap();
    let mut resources = BTreeMap::from([
        ("currentTone3000Preset".into(), CURRENT.to_vec()),
        ("sourceTone3000Preset".into(), SOURCE.to_vec()),
    ]);
    if mixed {
        resources.insert(
            "delayState".into(),
            b"# Stored opaque fixture, no plugin restoration claim.\n".to_vec(),
        );
    }
    for resource in manifest["resources"].as_array_mut().unwrap() {
        let bytes = &resources[resource["id"].as_str().unwrap()];
        resource["sha256"] = json!(digest(bytes));
        resource["bytes"] = json!(bytes.len());
    }
    (serde_json::to_vec_pretty(&manifest).unwrap(), resources)
}
fn bundle(mixed: bool) -> Bundle {
    let (manifest, resources) = parts(mixed);
    Bundle::from_parts(manifest, resources).unwrap()
}
#[test]
fn mixed_and_native_revisions_preserve_exact_bytes_roles_and_offline_identity() {
    let temp = Temporary::new();
    for mixed in [false, true] {
        let store = BundleStore::new(temp.0.join(if mixed { "mixed" } else { "native" }));
        let initial = bundle(mixed);
        let revision = store.save(&initial).unwrap();
        assert_eq!(store.save(&initial).unwrap(), revision);
        let reopened = BundleStore::new(store.root.clone())
            .read(&revision)
            .unwrap();
        assert_eq!(reopened.manifest_bytes(), initial.manifest_bytes());
        assert_eq!(reopened.resource("currentTone3000Preset"), Some(CURRENT));
        assert_eq!(reopened.resource("sourceTone3000Preset"), Some(SOURCE));
        assert_eq!(reopened.manifest(), initial.manifest());
        let mut changed = initial.manifest.clone();
        changed.name = "Edited copy".into();
        if mixed {
            changed.tone3000.instances[0].processing_role =
                Some(crate::manifest::ProcessingRole::Amp);
        }
        let changed =
            Bundle::from_parts(changed.encode().unwrap(), initial.resources.clone()).unwrap();
        let second = store.save(&changed).unwrap();
        assert_ne!(second, revision);
        assert_eq!(
            store.read(&second).unwrap().manifest().id,
            initial.manifest().id
        );
        assert_eq!(
            store.read(&revision).unwrap().manifest_bytes(),
            initial.manifest_bytes()
        );
        assert_eq!(store.list().unwrap().len(), 2);
    }
}
#[test]
fn integrity_rejects_missing_extra_corrupt_or_invalid_native_payloads() {
    let (manifest, resources) = parts(true);
    let mut missing = resources.clone();
    missing.remove("delayState");
    assert!(Bundle::from_parts(manifest.clone(), missing).is_err());
    let mut extra = resources.clone();
    extra.insert("unknown".into(), vec![1]);
    assert!(Bundle::from_parts(manifest.clone(), extra).is_err());
    let mut corrupt = resources.clone();
    corrupt.get_mut("currentTone3000Preset").unwrap()[0] ^= 1;
    assert!(Bundle::from_parts(manifest.clone(), corrupt).is_err());
    // Matching size/hash is not enough for the native structural decoder.
    let mut invalid = resources;
    invalid.insert(
        "currentTone3000Preset".into(),
        b"not a native preset".to_vec(),
    );
    let mut declarations: Value = serde_json::from_slice(&manifest).unwrap();
    declarations["resources"][0]["bytes"] = json!(invalid["currentTone3000Preset"].len());
    declarations["resources"][0]["sha256"] = json!(digest(&invalid["currentTone3000Preset"]));
    assert!(Bundle::from_parts(serde_json::to_vec(&declarations).unwrap(), invalid).is_err());
}
#[test]
fn failed_publication_preserves_prior_revision_and_partial_saves_are_invisible() {
    let temp = Temporary::new();
    let store = BundleStore::new(temp.0.join("library"));
    let initial = bundle(false);
    let previous = store.save(&initial).unwrap();
    let changed = bundle(true);
    assert!(
        store
            .save_with(&changed, || Err(Error::Invalid(
                "Injected interruption before publish"
            )))
            .is_err()
    );
    assert_eq!(store.list().unwrap(), vec![previous.clone()]);
    assert_eq!(
        store.read(&previous).unwrap().manifest_bytes(),
        initial.manifest_bytes()
    );
    assert_eq!(fs::read_dir(&store.root).unwrap().count(), 1);
    fs::create_dir(store.root.join(".save-interrupted")).unwrap();
    fs::write(
        store.root.join(".save-interrupted/manifest.json"),
        b"partial",
    )
    .unwrap();
    assert_eq!(store.list().unwrap(), vec![previous]);
    assert!(store.read(".save-interrupted").is_err());
}
#[test]
fn read_refuses_unlisted_entries_and_manifest_or_payload_changes() {
    let temp = Temporary::new();
    let store = BundleStore::new(temp.0.join("library"));
    let initial = bundle(true);
    let id = store.save(&initial).unwrap();
    let root = store.path(&id).unwrap();
    fs::write(root.join("unlisted"), b"extra").unwrap();
    assert!(store.read(&id).is_err());
    fs::remove_file(root.join("unlisted")).unwrap();
    fs::write(root.join("lv2/delay/state.ttl"), b"changed").unwrap();
    assert!(store.read(&id).is_err());
    fs::write(
        root.join("lv2/delay/state.ttl"),
        initial.resource("delayState").unwrap(),
    )
    .unwrap();
    fs::write(root.join("manifest.json"), b"{}").unwrap();
    assert!(store.read(&id).is_err());
    assert!(store.save(&initial).is_err()); // never mask a corrupt existing revision
    assert!(store.read("../outside").is_err());
}
#[cfg(unix)]
#[test]
fn read_refuses_payload_and_directory_symlinks() {
    use std::os::unix::fs::symlink;
    let temp = Temporary::new();
    let store = BundleStore::new(temp.0.join("library"));
    let initial = bundle(false);
    let id = store.save(&initial).unwrap();
    let root = store.path(&id).unwrap();
    let outside = temp.0.join("outside");
    fs::write(&outside, CURRENT).unwrap();
    fs::remove_file(root.join("tone3000/current.t3kpreset")).unwrap();
    symlink(&outside, root.join("tone3000/current.t3kpreset")).unwrap();
    assert!(store.read(&id).is_err());
    fs::remove_file(root.join("tone3000/current.t3kpreset")).unwrap();
    fs::remove_dir(root.join("tone3000")).unwrap();
    let outside_directory = temp.0.join("external");
    fs::create_dir(&outside_directory).unwrap();
    fs::write(outside_directory.join("current.t3kpreset"), CURRENT).unwrap();
    symlink(&outside_directory, root.join("tone3000")).unwrap();
    assert!(store.read(&id).is_err());
}
#[test]
fn scalar_only_bundle_survives_restart_without_fake_native_assets() {
    let temp = Temporary::new();
    let store = BundleStore::new(temp.0.join("library"));
    let manifest = Manifest::parse(include_bytes!(
        "../../../../docs/presets/examples/lv2-only.json"
    ))
    .unwrap();
    let initial = Bundle::from_parts(manifest.encode().unwrap(), BTreeMap::new()).unwrap();
    let id = store.save(&initial).unwrap();
    assert!(
        store
            .read(&id)
            .unwrap()
            .manifest()
            .tone3000
            .instances
            .is_empty()
    );
}
