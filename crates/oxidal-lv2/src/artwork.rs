//! MOD GUI thumbnails are local PNG data only. The embedded GUI is never loaded.
pub const MAX_BYTES: usize = 256 * 1024;

pub fn admitted_png(data: &[u8]) -> bool {
    if !(33..=MAX_BYTES).contains(&data.len()) || &data[..16] != b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" {
        return false;
    }
    let dimension = |at| u32::from_be_bytes(data[at..at + 4].try_into().unwrap());
    (1..=1024).contains(&dimension(16)) && (1..=1024).contains(&dimension(20))
}

#[cfg(any(feature = "native", test))]
pub(crate) fn read(bundle: &std::path::Path, path: &std::path::Path) -> Option<Vec<u8>> {
    use std::{fs, io::Read, path::Component};
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return None;
    }
    let bundle = fs::canonicalize(bundle).ok()?;
    let path = fs::canonicalize(path).ok()?;
    if !path.starts_with(&bundle) {
        return None;
    }
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    admitted_png(&bytes).then_some(bytes)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_bounded_bundle_png() {
        use std::{fs, os::unix::fs::symlink};
        let root = std::env::temp_dir().join(format!("oxidal-lv2-image-{}", std::process::id()));
        let bundle = root.join("plugin.lv2");
        fs::create_dir_all(&bundle).unwrap();
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x02\0\0\0\x03".to_vec();
        png.resize(33, 0);
        let file = bundle.join("picture.png");
        fs::write(&file, &png).unwrap();
        assert_eq!(read(&bundle, &file), Some(png.clone()));
        symlink("picture.png", bundle.join("inside")).unwrap();
        assert_eq!(read(&bundle, &bundle.join("inside")), Some(png.clone()));
        fs::write(root.join("outside"), &png).unwrap();
        symlink(root.join("outside"), bundle.join("link")).unwrap();
        for bad in [
            "../outside",
            "../plugin.lv2/picture.png",
            "link",
            "missing",
            ".",
        ] {
            assert!(read(&bundle, &bundle.join(bad)).is_none());
        }
        png[16..20].copy_from_slice(&1024u32.to_be_bytes());
        assert!(admitted_png(&png));
        for dimension in [0u32, 1025] {
            png[20..24].copy_from_slice(&dimension.to_be_bytes());
            assert!(!admitted_png(&png));
        }
        assert!(!admitted_png(b"not a PNG"));
        fs::write(&file, vec![0; MAX_BYTES + 1]).unwrap();
        assert!(read(&bundle, &file).is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
