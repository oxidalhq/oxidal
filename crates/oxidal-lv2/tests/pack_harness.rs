#![cfg(all(target_os = "linux", feature = "native"))]
//! Actual child-process probes of the maintained LV2 fixture.
//! @see docs/lv2.md
use std::process::Command;
#[test]
fn pack_report_distinguishes_metadata_rejection_from_executed_audio() {
    let out = Command::new(env!("CARGO_BIN_EXE_oxidal-plugin-check"))
        .args([
            "--bundle",
            env!("OXIDAL_LV2_FIXTURE"),
            "--pack",
            "fixture",
            "--frames",
            "64",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["pack"], "fixture");
    assert_eq!(report["sample_rate"], 48000);
    let rows = report["plugins"].as_array().unwrap();
    assert_eq!(rows.len(), 13);
    let good = rows
        .iter()
        .find(|p| p["uri"] == "urn:oxidal:test:contract")
        .unwrap();
    assert_eq!(good["status"], "usable");
    assert_eq!(good["frames_processed"], 48000);
    assert!(good["peak"].as_f64().unwrap() > 0.0);
    let rejected = rows
        .iter()
        .find(|p| p["uri"] == "urn:oxidal:test:unsupported")
        .unwrap();
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["frames_processed"], 0);
    assert!(rejected["reason"].is_string());
}
