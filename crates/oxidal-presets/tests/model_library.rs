use oxidal_presets::ModelStore;
use std::collections::BTreeSet;
#[test]
fn formats_and_search_are_filtered_before_bounded_metadata_pages() {
    let root = std::env::temp_dir().join(format!("oxidal-model-library-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let store = ModelStore::new(root.clone());
    let nam = br#"{"architecture":"Linear","weights":[1]}"#;
    let wav = b"RIFF\x04\x00\x00\x00WAVE";
    for i in 0..70 {
        store.stage_local(&format!("Amp {i}.nam"), nam).unwrap();
        store.stage_local(&format!("Cab {i}.wav"), wav).unwrap();
    }
    let (first, next) = store.filtered_page(None, true, Some("ir"), "").unwrap();
    assert_eq!(first.len(), 64);
    assert_eq!(first[0].1.name, "Cab 0.wav");
    assert_eq!(first[2].1.name, "Cab 2.wav");
    assert_eq!(first[63].1.name, "Cab 63.wav");
    assert!(first.iter().all(|(_, a)| a.format == "ir"));
    let (second, end) = store
        .filtered_page(next.as_deref(), true, Some("ir"), "")
        .unwrap();
    assert_eq!(second.len(), 6);
    assert_eq!(second[0].1.name, "Cab 64.wav");
    assert!(end.is_none());
    let all = first
        .iter()
        .chain(&second)
        .map(|(id, _)| id)
        .collect::<BTreeSet<_>>();
    assert_eq!(all.len(), 70);
    let found = store
        .filtered_page(None, true, Some("ir"), "CAB 69.WAV")
        .unwrap();
    assert_eq!(found.0.len(), 1);
    assert_eq!(found.0[0].1.name, "Cab 69.wav");
    assert!(
        store
            .filtered_page(None, true, Some("nam"), "Cab")
            .unwrap()
            .0
            .is_empty()
    );
    assert!(store.filtered_page(None, true, Some("wrong"), "").is_err());
    let (folder_id, _) = store
        .stage_local_in_folder("Studio.wav", Some("My IRs/Studio cabs"), wav)
        .unwrap();
    let folder = store
        .filtered_page(None, true, Some("ir"), "STUDIO CABS")
        .unwrap();
    assert_eq!(folder.0.len(), 1);
    assert_eq!(folder.0[0].0, folder_id);
    assert_eq!(folder.0[0].1.tone["oxidal_folder"], "My IRs/Studio cabs");
    assert!(
        store
            .stage_local_in_folder("bad.wav", Some("../escape"), wav)
            .is_err()
    );
    assert!(
        store
            .filtered_page(None, true, None, &"x".repeat(257))
            .is_err()
    );
    // Listing must not read GB-sized model payloads: corrupt a payload while
    // keeping its signed-by-hash metadata intact; playback read still rejects it.
    let id = &found.0[0].0;
    std::fs::write(root.join(id).join("model.wav"), b"corrupt").unwrap();
    assert_eq!(
        store
            .filtered_page(None, true, Some("ir"), "Cab 69.wav")
            .unwrap()
            .0
            .len(),
        1
    );
    assert!(store.read(id).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
