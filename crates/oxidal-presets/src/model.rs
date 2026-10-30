//! Verified temporary audition assets. A staged asset is not a saved rig.
use crate::{Error, MAX_FILE_BYTES, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelAsset {
    pub schema: u32,
    pub tone_id: u64,
    pub model_id: u64,
    pub title: String,
    pub name: String,
    pub format: String,
    pub sha256: String,
    /// Creator, license, artwork sources and one model descriptor, without credentials or signed URLs.
    pub tone: serde_json::Value,
}
impl ModelAsset {
    fn validate(&self) -> Result<()> {
        let local = self.tone["local"].as_bool() == Some(true);
        if self.schema != 1
            || if local {
                self.tone_id != 0
            } else {
                self.tone_id == 0
            }
            || self.model_id == 0
            || !matches!(self.format.as_str(), "nam" | "ir")
            || !hash(&self.sha256)
            || self.title.is_empty()
            || self.title.len() > 512
            || self.name.is_empty()
            || self.name.len() > 512
            || self
                .title
                .chars()
                .chain(self.name.chars())
                .any(char::is_control)
            || !self.tone.is_object()
            || self.tone["id"].as_u64() != Some(self.tone_id)
        {
            return Err(Error::Invalid("Invalid model metadata"));
        }
        if local
            && (self.tone["format"].as_str() != Some(self.format.as_str())
                || self.tone["models"].as_array().is_none_or(|m| {
                    m.is_empty() || !m.iter().any(|m| m["id"].as_u64() == Some(self.model_id))
                }))
        {
            return Err(Error::Invalid("Invalid local model identity"));
        }
        Ok(())
    }
    pub fn filename(&self) -> &'static str {
        if self.format == "nam" {
            "model.nam"
        } else {
            "model.wav"
        }
    }
}
fn hash(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read(path: &Path, max: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() > max as u64 {
        return Err(Error::Invalid("Invalid model cache file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(Error::Invalid("Model cache file exceeds limit"));
    }
    Ok(bytes)
}
fn natural_name(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (start_i, start_j) = (i, j);
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let (mut x, mut y) = (start_i, start_j);
            while x < i && a[x] == b'0' {
                x += 1;
            }
            while y < j && b[y] == b'0' {
                y += 1;
            }
            let order = (i - x).cmp(&(j - y)).then_with(|| a[x..i].cmp(&b[y..j]));
            if !order.is_eq() {
                return order;
            }
        } else {
            let order = a[i].cmp(&b[j]);
            if !order.is_eq() {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    a.len().cmp(&b.len())
}
fn directory(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(Error::Invalid("Invalid model cache directory"));
    }
    Ok(())
}
/// A bounded page of local metadata plus its next immutable identity cursor.
pub type LocalAssetPage = (Vec<(String, ModelAsset)>, Option<String>);
#[derive(Debug)]
pub struct ModelStore {
    root: PathBuf,
}
impl ModelStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    /// Browser uploads are inert content-addressed assets, not provider identities.
    /// Native preparation remains the authority for model/IR compatibility.
    pub fn stage_local(&self, name: &str, bytes: &[u8]) -> Result<(String, ModelAsset)> {
        if name.is_empty()
            || name.len() > 200
            || name.contains(['/', '\\'])
            || name.chars().any(char::is_control)
        {
            return Err(Error::Invalid("Choose a file name without a path"));
        }
        let path = Path::new(name);
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let format = match extension.as_str() {
            "nam" => "nam",
            "wav" => "ir",
            _ => return Err(Error::Invalid("Choose a .nam or .wav file")),
        };
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err(Error::Invalid("Model file must contain 1 byte to 32 MiB"));
        }
        if format == "nam" {
            let model: serde_json::Value = serde_json::from_slice(bytes)
                .map_err(|_| Error::Invalid("NAM file is not valid JSON"))?;
            if !model.is_object() || !model["architecture"].is_string() {
                return Err(Error::Invalid("NAM file has no architecture"));
            }
        } else if bytes.len() < 12
            || !matches!(&bytes[..4], b"RIFF" | b"RF64")
            || &bytes[8..12] != b"WAVE"
        {
            return Err(Error::Invalid("IR file is not a WAV file"));
        }
        let sha256 = digest(bytes);
        // Like the reference local loader, a positive content-stable model key
        // is scoped to its block. Tone id zero + local=true is never a catalog id.
        let model_id = u64::from(
            u32::from_str_radix(&sha256[..8], 16)
                .map_err(|_| Error::Invalid("Invalid content hash"))?
                % 0x7ffffffe
                + 1,
        );
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(name)
            .to_owned();
        let tone = serde_json::json!({"id":0,"local":true,"title":title,"format":format,"models":[{"id":model_id,"name":title,"model_url":format!("oxidal-model://{sha256}/{}",if format=="nam"{"model.nam"}else{"model.wav"})}]});
        let asset = ModelAsset {
            schema: 1,
            tone_id: 0,
            model_id,
            title,
            name: name.into(),
            format: format.into(),
            sha256,
            tone,
        };
        let id = self.stage(&asset, bytes)?;
        Ok((id, asset))
    }
    /// One local block with naturally ordered variants. All bytes are verified
    /// before publication; member ids address immutable individual assets only.
    pub fn collection(&self, ids: &[String]) -> Result<(String, ModelAsset)> {
        if ids.is_empty() || ids.len() > 1024 {
            return Err(Error::Invalid("Choose local model files"));
        }
        let mut members = Vec::new();
        let mut total = 0usize;
        for id in ids {
            let (asset, path) = self.read(id)?;
            if asset.tone_id != 0 || asset.tone["oxidal_collection"].is_array() {
                return Err(Error::Invalid("Collections require individual local files"));
            }
            if members
                .iter()
                .any(|(_, a, _): &(String, ModelAsset, PathBuf)| a.sha256 == asset.sha256)
            {
                continue;
            }
            if members.iter().any(|(_, a, _)| a.model_id == asset.model_id) {
                return Err(Error::Invalid(
                    "Local model identities collide; choose another collection",
                ));
            }
            total = total
                .checked_add(fs::metadata(&path)?.len() as usize)
                .ok_or(Error::Invalid("Collection size overflow"))?;
            if total > MAX_FILE_BYTES {
                return Err(Error::Invalid(
                    "Collection exceeds the 32 MiB embedded-state budget",
                ));
            }
            members.push((id.clone(), asset, path));
        }
        members.sort_by(|a, b| natural_name(&a.1.name, &b.1.name).then_with(|| a.0.cmp(&b.0)));
        let (_, first, path) = &members[0];
        if members.iter().any(|(_, a, _)| a.format != first.format) {
            return Err(Error::Invalid(
                "Choose only NAM files or only IR files for one collection",
            ));
        }
        let mut asset = first.clone();
        let mut models = Vec::new();
        for (_, member, _) in &members {
            models.push(member.tone["models"][0].clone());
        }
        asset.title = if members.len() == 1 {
            first.title.clone()
        } else {
            format!("{} files", members.len())
        };
        asset.tone["title"] = asset.title.clone().into();
        asset.tone["models"] = models.into();
        asset.tone["oxidal_collection"] = members
            .iter()
            .map(|(id, _, _)| id.clone())
            .collect::<Vec<_>>()
            .into();
        let bytes = read(path, MAX_FILE_BYTES)?;
        let id = self.stage(&asset, &bytes)?;
        Ok((id, asset))
    }
    /// Verify every collection member off the PCM owner. No caller-supplied paths.
    pub fn preparation(&self, id: &str) -> Result<(ModelAsset, Vec<(u64, PathBuf)>)> {
        let (asset, path) = self.read(id)?;
        let Some(ids) = asset.tone["oxidal_collection"].as_array() else {
            return Ok((asset.clone(), vec![(asset.model_id, path)]));
        };
        let models = asset.tone["models"]
            .as_array()
            .ok_or(Error::Invalid("Missing collection models"))?;
        if ids.is_empty() || ids.len() > 1024 || ids.len() != models.len() {
            return Err(Error::Invalid("Invalid collection members"));
        }
        let mut files = Vec::new();
        let mut total = 0u64;
        for (id, model) in ids.iter().zip(models) {
            let (member, path) = self.read(
                id.as_str()
                    .ok_or(Error::Invalid("Invalid collection identity"))?,
            )?;
            if member.tone_id != 0
                || member.format != asset.format
                || member.tone["oxidal_collection"].is_array()
                || model != &member.tone["models"][0]
                || files.iter().any(|(id, _)| *id == member.model_id)
            {
                return Err(Error::Invalid(
                    "Collection member differs from verified metadata",
                ));
            }
            total = total
                .checked_add(fs::metadata(&path)?.len())
                .ok_or(Error::Invalid("Collection size overflow"))?;
            if total > MAX_FILE_BYTES as u64 {
                return Err(Error::Invalid("Collection exceeds embedded-state budget"));
            }
            files.push((member.model_id, path));
        }
        Ok((asset, files))
    }
    /// Metadata listing is bounded per page; payload bytes are verified on use.
    pub fn local_page(&self, after: Option<&str>) -> Result<LocalAssetPage> {
        self.page(after, false)
    }
    /// Every model kept on this unit: local files and, with `downloads`,
    /// models fetched from TONE3000 too.
    pub fn page(&self, after: Option<&str>, downloads: bool) -> Result<LocalAssetPage> {
        if after.is_some_and(|s| !hash(s)) {
            return Err(Error::Invalid("Invalid local model cursor"));
        }
        let entries = match fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((vec![], None)),
            Err(e) => return Err(e.into()),
        };
        let mut ids = Vec::new();
        for entry in entries {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if hash(&id) && after.is_none_or(|a| id.as_str() > a) {
                ids.push(id);
            }
        }
        ids.sort();
        let mut rows = Vec::new();
        let mut next = None;
        for id in ids {
            directory(&self.root.join(&id))?;
            let bytes = read(&self.root.join(&id).join("metadata.json"), 32768)?;
            if digest(&bytes) != id {
                return Err(Error::Invalid("Model metadata integrity failed"));
            }
            let asset: ModelAsset = serde_json::from_slice(&bytes)
                .map_err(|_| Error::Invalid("Invalid model metadata"))?;
            asset.validate()?;
            if asset.tone_id != 0 && !downloads {
                continue;
            }
            if rows.len() == 64 {
                next = rows.last().map(|(id, _): &(String, ModelAsset)| id.clone());
                break;
            }
            rows.push((id, asset));
        }
        Ok((rows, next))
    }
    /// Verified display metadata only. This does not establish model-byte integrity
    /// or authorize playback; audio consumers must continue using `read`.
    pub fn metadata(&self, id: &str) -> Result<ModelAsset> {
        if !hash(id) {
            return Err(Error::Invalid("Invalid model asset identifier"));
        }
        directory(&self.root)?;
        let path = self.root.join(id);
        directory(&path)?;
        let metadata = read(&path.join("metadata.json"), 32768)?;
        if digest(&metadata) != id {
            return Err(Error::Invalid("Model metadata integrity failed"));
        }
        let asset: ModelAsset = serde_json::from_slice(&metadata)
            .map_err(|_| Error::Invalid("Invalid model metadata"))?;
        asset.validate()?;
        Ok(asset)
    }
    pub fn read(&self, id: &str) -> Result<(ModelAsset, PathBuf)> {
        let asset = self.metadata(id)?;
        let model = self.root.join(id).join(asset.filename());
        let bytes = read(&model, MAX_FILE_BYTES)?;
        if bytes.is_empty() || digest(&bytes) != asset.sha256 {
            return Err(Error::Invalid("Model content integrity failed"));
        }
        Ok((asset, fs::canonicalize(model)?))
    }
    pub fn stage(&self, asset: &ModelAsset, bytes: &[u8]) -> Result<String> {
        asset.validate()?;
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES || digest(bytes) != asset.sha256 {
            return Err(Error::Invalid("Invalid model content"));
        }
        let metadata =
            serde_json::to_vec(asset).map_err(|_| Error::Invalid("Invalid model metadata"))?;
        if metadata.len() > 32768 {
            return Err(Error::Invalid("Model metadata exceeds limit"));
        }
        let id = digest(&metadata);
        fs::create_dir_all(&self.root)?;
        directory(&self.root)?;
        let destination = self.root.join(&id);
        if destination.try_exists()? {
            self.read(&id)?;
            return Ok(id);
        }
        let temporary = self.root.join(format!(
            ".stage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir(&temporary)?;
        let result = (|| {
            for (name, data) in [
                (asset.filename(), bytes),
                ("metadata.json", metadata.as_slice()),
            ] {
                let mut options = fs::OpenOptions::new();
                options.create_new(true).write(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options.open(temporary.join(name))?;
                file.write_all(data)?;
                file.sync_all()?;
            }
            fs::File::open(&temporary)?.sync_all()?;
            if let Err(error) = fs::rename(&temporary, &destination) {
                if destination.exists() {
                    self.read(&id)?;
                } else {
                    return Err(error.into());
                }
            }
            fs::File::open(&self.root)?.sync_all()?;
            Ok(id)
        })();
        let _ = fs::remove_dir_all(temporary);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn collections_sort_deduplicate_verify_members_and_reject_mixed_formats() {
        let root = std::env::temp_dir().join(format!("oxidal-collection-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let store = ModelStore::new(root.clone());
        let a = store
            .stage_local("Gain 10.nam", br#"{"architecture":"Linear","weights":[1]}"#)
            .unwrap();
        let b = store
            .stage_local(
                "Gain 2.nam",
                br#"{"architecture":"Linear","weights":[0.5]}"#,
            )
            .unwrap();
        let (id, collection) = store
            .collection(&[a.0.clone(), b.0.clone(), a.0.clone()])
            .unwrap();
        assert_eq!(collection.model_id, b.1.model_id);
        assert_eq!(collection.tone["models"].as_array().unwrap().len(), 2);
        assert_eq!(collection.tone["models"][0]["name"], "Gain 2");
        let (_, files) = store.preparation(&id).unwrap();
        assert_eq!(
            files.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
            vec![b.1.model_id, a.1.model_id]
        );
        assert!(
            store.collection(std::slice::from_ref(&id)).is_err(),
            "No recursively nested asset references"
        );
        let wav = store.stage_local("Cab.wav", b"RIFF0000WAVE").unwrap();
        assert!(store.collection(&[a.0.clone(), wav.0]).is_err());
        fs::write(store.read(&a.0).unwrap().1, b"tampered").unwrap();
        assert!(
            store.preparation(&id).is_err(),
            "Every member is checked, including unheard variants"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn local_files_keep_native_local_identity_and_page_without_provider_data() {
        let root = std::env::temp_dir().join(format!(
            "oxidal-local-files-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = ModelStore::new(root.clone());
        let bytes = br#"{"architecture":"Linear","weights":[1]}"#;
        let (first, asset) = store.stage_local("Stage lead.NAM", bytes).unwrap();
        assert_eq!(asset.tone_id, 0);
        assert_eq!(asset.tone["local"], true);
        assert!(asset.model_id > 0 && asset.model_id <= i32::MAX as u64);
        assert_eq!(store.stage_local("Stage lead.NAM", bytes).unwrap().0, first);
        assert_eq!(std::fs::read(store.read(&first).unwrap().1).unwrap(), bytes);
        for name in ["../unsafe.nam", "unsafe\\path.nam", "empty.nam", "no.txt"] {
            assert!(
                store
                    .stage_local(name, if name == "empty.nam" { &[] } else { bytes })
                    .is_err()
            );
        }
        assert!(store.stage_local("invalid.nam", b"broken").is_err());
        assert!(store.stage_local("invalid.wav", bytes).is_err());
        for i in 0..70 {
            store.stage_local(&format!("Local {i}.nam"), bytes).unwrap();
        }
        let (page, next) = store.local_page(None).unwrap();
        assert_eq!(page.len(), 64);
        assert!(page.iter().all(|(_, a)| a.tone_id == 0));
        let (last, done) = store.local_page(next.as_deref()).unwrap();
        assert_eq!(last.len(), 7);
        assert!(done.is_none());
        assert!(
            page.iter()
                .all(|(id, _)| last.iter().all(|(other, _)| id != other))
        );
        assert!(store.local_page(Some("../bad")).is_err());
        std::fs::write(root.join(&page[0].0).join("metadata.json"), b"{}").unwrap();
        assert!(store.local_page(None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn staged_model_survives_restart_and_rejects_tampering_and_traversal() {
        let root = std::env::temp_dir().join(format!("oxidal-model-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let bytes = br#"{"architecture":"Linear","weights":[1]}"#;
        let asset = ModelAsset {
            schema: 1,
            tone_id: 7,
            model_id: 9,
            title: "Amp".into(),
            name: "Crunch".into(),
            format: "nam".into(),
            sha256: digest(bytes),
            tone: serde_json::json!({"id":7,"title":"Amp","license":"test"}),
        };
        let id = ModelStore::new(root.clone()).stage(&asset, bytes).unwrap();
        let store = ModelStore::new(root.clone());
        let (loaded, path) = store.read(&id).unwrap();
        assert_eq!(loaded.model_id, 9);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(store.stage(&asset, bytes).unwrap(), id);
        assert!(store.read("../outside").is_err());
        fs::write(&path, b"corrupt").unwrap();
        assert!(store.read(&id).is_err());
        assert!(store.stage(&asset, bytes).is_err());
        fs::write(&path, bytes).unwrap();
        fs::write(root.join(&id).join("metadata.json"), b"{}").unwrap();
        assert!(store.read(&id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
