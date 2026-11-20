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
