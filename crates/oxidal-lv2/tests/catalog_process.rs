#![cfg(all(target_os = "linux", feature = "worker"))]
//! Metadata discovery must not acquire the playback worker's scheduling policy.
//! @see docs/lv2.md
use oxidal_lv2::PluginCatalog;
use std::{path::Path, process::Command};

#[test]
fn catalog_runs_without_realtime_or_locked_memory_permissions() {
    let output = Command::new("prlimit")
        .args(["--memlock=0:0", "--rtprio=0:0", "--"])
        .arg(env!("CARGO_BIN_EXE_oxidal-graph-worker"))
        .args(["--catalog", "48000"])
        .env(
            "LV2_PATH",
            Path::new(env!("OXIDAL_LV2_FIXTURE")).parent().unwrap(),
        )
        .output()
        .expect("Linux qualification requires util-linux prlimit");
    assert!(output.status.success(), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("realtime:"), "{stderr}");
    let catalog: PluginCatalog = serde_json::from_slice(&output.stdout).unwrap();
    catalog.validate().unwrap();
    assert_eq!(catalog.sample_rate, 48000);
    assert!(
        catalog
            .plugins
            .iter()
            .any(|p| p.uri == "urn:oxidal:test:contract")
    );
}

#[test]
fn artwork_mode_returns_exact_bytes_or_empty_output_without_audio_permissions() {
    let fixture = Path::new(env!("OXIDAL_LV2_METADATA_FIXTURE"));
    let expected = include_bytes!("fixtures/metadata/thumbnail.png");
    for (uri, bytes) in [
        ("urn:oxidal:test:metadata-rich", &expected[..]),
        ("urn:oxidal:test:artwork-escape", &[][..]),
        ("urn:oxidal:test:unknown", &[][..]),
    ] {
        let output = Command::new("prlimit")
            .args(["--memlock=0:0", "--rtprio=0:0", "--"])
            .arg(env!("CARGO_BIN_EXE_oxidal-graph-worker"))
            .args(["--artwork", uri])
            .env("LV2_PATH", fixture.parent().unwrap())
            .output()
            .expect("Linux qualification requires util-linux prlimit");
        assert!(output.status.success(), "{output:?}");
        assert!(!String::from_utf8_lossy(&output.stderr).contains("realtime:"));
        assert_eq!(output.stdout, bytes, "{uri}");
    }
}

#[test]
#[ignore = "requires the Debian swh-lv2 package"]
fn installed_pack_ownership_follows_lilvs_selected_manifest() {
    const URI: &str = "http://plugin.org.uk/swh-plugins/amp";
    let catalog = |path: &Path| {
        let output = Command::new(env!("CARGO_BIN_EXE_oxidal-graph-worker"))
            .args(["--catalog", "48000"])
            .env("LV2_PATH", path)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let catalog: PluginCatalog = serde_json::from_slice(&output.stdout).unwrap();
        catalog.validate().unwrap();
        catalog
            .plugins
            .into_iter()
            .find(|plugin| plugin.uri == URI)
            .unwrap()
    };

    let installed = catalog(Path::new("/usr/lib/lv2"));
    assert_eq!(installed.pack_id.as_deref(), Some("swh"));

    let root = std::env::temp_dir().join(format!("oxidal-shadow-pack-{}", std::process::id()));
    let bundle = root.join("amp-swh.lv2");
    std::fs::create_dir_all(&bundle).unwrap();
    std::fs::write(
        bundle.join("manifest.ttl"),
        format!("@prefix lv2: <http://lv2plug.in/ns/lv2core#> .\n@prefix doap: <http://usefulinc.com/ns/doap#> .\n<{URI}> a lv2:Plugin ; doap:name \"Shadow amp\" .\n"),
    )
    .unwrap();
    let shadow = catalog(&root);
    assert_eq!(shadow.name, "Shadow amp");
    assert!(shadow.pack_id.is_none());
    std::fs::remove_dir_all(root).unwrap();
}
