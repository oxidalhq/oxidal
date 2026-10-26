//! Explicit private-development library preparation; never invoked by release packaging.
use oxidal_presets::{MAX_FILE_BYTES, Store, inspect};
use std::{fs, io::Read, path::PathBuf};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 || args[0] != "--development-only" {
        return Err(
            "Usage: oxidal-preset-seed --development-only SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY"
                .into(),
        );
    }
    let source = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    if output.exists() {
        return Err("Choose a new output directory; existing libraries are not overwritten".into());
    }
    let mut files = Vec::new();
    let mut total = 0;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("t3kpreset") {
            continue;
        }
        if !entry.file_type()?.is_file() {
            return Err("Preset source must be a regular file, not a symlink".into());
        }
        if files.len() >= 128 || entry.metadata()?.len() > MAX_FILE_BYTES as u64 {
            return Err("Development seed limits exceeded".into());
        }
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        total += bytes.len();
        if total > 256 * 1024 * 1024 {
            return Err("Development seed exceeds 256 MiB".into());
        }
        let info = inspect(&bytes)?;
        files.push((bytes, info));
    }
    if files.is_empty() {
        return Err("No native presets found".into());
    }
    // Validate every source before creating output; preserve byte-identical originals.
    fs::create_dir_all(&output)?;
    let mut store = Store::new(output.join("presets"));
    let mut entries = Vec::new();
    for (bytes, info) in files {
        store.import(&bytes)?;
        entries
            .push(serde_json::json!({"name":info.name,"sha256":info.sha256,"bytes":bytes.len()}));
    }
    entries.sort_by(|a, b| a["sha256"].as_str().cmp(&b["sha256"].as_str()));
    entries.dedup_by(|a, b| a["sha256"] == b["sha256"]);
    let manifest = serde_json::json!({"schema":1,"development_only":true,"redistribution_reviewed":false,"files":entries});
    fs::write(
        output.join("development-presets.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    println!(
        "Prepared {} private development originals; redistribution is not enabled",
        manifest["files"].as_array().unwrap().len()
    );
    Ok(())
}
