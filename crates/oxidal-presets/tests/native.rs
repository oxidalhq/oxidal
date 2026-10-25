use oxidal_presets::{Framing, inspect};
const CURRENT: &[u8] = include_bytes!("fixtures/authored-current.t3kpreset");
const LEGACY: &[u8] = include_bytes!("fixtures/authored-legacy.t3kpreset");
#[test]
fn independent_juce_fixtures_decode_and_keep_distinct_originals() {
    let current = inspect(CURRENT).unwrap();
    let legacy = inspect(LEGACY).unwrap();
    assert_eq!(current.name, "Fixture – Δ");
    assert_eq!(current.name, legacy.name);
    assert_eq!(current.source_id, legacy.source_id);
    assert_ne!(current.sha256, legacy.sha256);
    assert_eq!(current.framing, Framing::Current);
    assert_eq!(legacy.framing, Framing::Legacy);
    assert_eq!(current.embedded_bytes, 5);
    assert!(!current.playback_available);
}
#[test]
fn every_truncation_and_trailing_byte_is_rejected() {
    for original in [CURRENT, LEGACY] {
        for length in 0..original.len() {
            assert!(inspect(&original[..length]).is_err(), "length {length}");
        }
        let mut extra = original.to_vec();
        extra.push(0);
        assert!(inspect(&extra).is_err());
    }
}
#[test]
fn inconsistent_identity_future_schema_and_invalid_counts_fail_closed() {
    let mut mismatch = CURRENT.to_vec();
    let id = b"oxidal-native-framing-fixture";
    let offset = mismatch.windows(id.len()).position(|w| w == id).unwrap();
    mismatch[offset] = b'x';
    assert!(inspect(&mismatch).is_err());
    let mut future = LEGACY.to_vec();
    let key = b"schemaVersion\0";
    let offset = future.windows(key.len()).position(|w| w == key).unwrap() + key.len();
    // compressed value length (two bytes), integer tag, int32 little-endian
    future[offset + 3] = 2;
    assert!(inspect(&future).is_err());
    for invalid in [0u32, 65537, u32::MAX] {
        let mut bytes = CURRENT.to_vec();
        bytes[4..8].copy_from_slice(&invalid.to_le_bytes());
        assert!(inspect(&bytes).is_err());
    }
    let mut count = LEGACY.to_vec();
    let offset = 4 + b"T3KPreset\0".len();
    count[offset] = 0x81;
    assert!(inspect(&count).is_err());
}
#[test]
fn non_finite_numbers_and_malformed_utf8_are_rejected() {
    let mut invalid = LEGACY.to_vec();
    let key = b"futureDouble\0";
    let pos = invalid.windows(key.len()).position(|w| w == key).unwrap() + key.len() + 3;
    invalid[pos..pos + 8].copy_from_slice(&f64::NAN.to_le_bytes());
    assert!(inspect(&invalid).is_err());
    let mut invalid = LEGACY.to_vec();
    invalid[4] = 0xff;
    assert!(inspect(&invalid).is_err());
}
#[test]
fn adversarial_mutations_do_not_panic() {
    // Deterministic mutation corpus supplements the independently authored golden files.
    for index in 0..CURRENT.len() {
        for value in [0, 0x7f, 0x80, 0xff] {
            let mut bytes = CURRENT.to_vec();
            bytes[index] = value;
            let _ = inspect(&bytes);
        }
    }
}

#[test]
fn nesting_and_aggregate_budgets_are_enforced() {
    // A structurally valid chain of one-child trees, beyond the admission depth.
    let mut nested = b"T3KB".to_vec();
    for _ in 0..66 {
        nested.extend_from_slice(b"Node\0\0\x01\x01");
    }
    nested.extend_from_slice(b"Leaf\0\0\0");
    assert_eq!(
        inspect(&nested).unwrap_err().to_string(),
        "Native nesting limit exceeded"
    );
    // 65,536 leaf children plus the root exceed the aggregate node/value budget.
    let mut wide = b"T3KBRoot\0\0\x03\x00\x00\x01".to_vec();
    for _ in 0..65536 {
        wide.extend_from_slice(b"Leaf\0\0\0");
    }
    assert_eq!(
        inspect(&wide).unwrap_err().to_string(),
        "Native structure limit exceeded"
    );
    let duplicate = b"T3KBRoot\0\x01\x02key\0\0key\0\0\0";
    assert_eq!(
        inspect(duplicate).unwrap_err().to_string(),
        "Invalid or duplicate native property"
    );
}

#[test]
#[ignore = "requires separately obtained pinned upstream factory assets; see fixtures/README.md"]
fn pinned_external_factory_corpus() {
    use oxidal_presets::Store;
    use std::{fs, path::PathBuf};
    let root = PathBuf::from(
        std::env::var_os("OXIDAL_TONE3000_FACTORY_DIR").expect("set OXIDAL_TONE3000_FACTORY_DIR"),
    );
    let expected = [
        (
            "Ampeg Bass Drive",
            "9cda7807c7d8889681c5a1ba81614fe903d0574267a2f58d3dbba1442c676b7f",
        ),
        (
            "Bogner Fullstack",
            "ee4d24b07fb70738b59911f4ca4f3acd83756425fd84671ca873adc0c45fc1d8",
        ),
        (
            "Dumble Spread",
            "a3f281b03f2de5870dba862e478fb2bcd3a9e8fddc258f580573903e5348a8cc",
        ),
        (
            "Marshall Bluesbreaker",
            "97783d6cfec23121e6320ba04fdbc4c6bf7ceb2662e7643793b441923121f2c7",
        ),
        (
            "Matchless Crunch",
            "9f9b7ce70daf41667c8f32d1d4452f6fa3aa589e59d691cd50789a34dd855669",
        ),
        (
            "Mesa Pitch Shift",
            "94a891c40bdffd5c488a4a5b8a6ff2efa2816e44c4be93f5828c552e5c9433fa",
        ),
        (
            "Stereo Crunch Verb",
            "7fbd53ae302127960166e76999c725c6ebf56b89a96d21e4126319dcce2fe09f",
        ),
        (
            "Stereo Fuzz",
            "0490c10231489e9a9a701135bd67cdbce2c48dacdeaa6bc83403f120b28cd31b",
        ),
    ];
    let storage =
        std::env::temp_dir().join(format!("oxidal-factory-corpus-{}", std::process::id()));
    fs::create_dir(&storage).unwrap();
    let mut store = Store::new(storage.clone());
    for (name, digest) in expected {
        let original = fs::read(root.join(format!("{name}.t3kpreset"))).unwrap();
        let info = store
            .import(&original)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(info.sha256, digest, "{name}: source pin changed");
        assert_eq!(info.name, name);
        assert!(info.parameter_count > 0 && info.block_count > 0 && info.embedded_bytes > 0);
        assert!(!info.playback_available);
        assert_eq!(store.original(digest).unwrap(), original);
        eprintln!(
            "{name}: {} parameters, {} blocks, {} embedded bytes",
            info.parameter_count, info.block_count, info.embedded_bytes
        );
    }
    assert_eq!(Store::new(storage.clone()).list().unwrap().presets.len(), 8);
    fs::remove_dir_all(storage).unwrap();
}
