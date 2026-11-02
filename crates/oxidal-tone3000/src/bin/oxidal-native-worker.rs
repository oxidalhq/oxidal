//! Native process main thread owns JUCE. A bounded reader queue leaves the owner free to pump/expire.
use oxidal_tone3000::{
    editor::Editor,
    protocol::{WorkerReply, WorkerRequest},
};
use std::{
    io::{BufRead, Write},
    sync::mpsc,
    time::Duration,
};
/// One-shot, non-PCM creation of a preset from a staged model.
fn create_from_model() -> Result<(), Box<dyn std::error::Error>> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Request {
        name: String,
        asset: String,
    }
    let mut bytes = vec![];
    std::io::Read::take(std::io::stdin().lock(), 4097).read_until(b'\n', &mut bytes)?;
    if bytes.len() > 4096 || bytes.last() != Some(&b'\n') {
        return Err("Invalid model preset request".into());
    }
    let request: Request = serde_json::from_slice(&bytes)?;
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let id = oxidal_tone3000::factory_voice::create(&root, &request.name, &request.asset)?;
    println!("{id}");
    std::io::stdout().flush()?;
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).as_deref() == Some("--create-from-model") {
        return create_from_model();
    }
    let root = std::path::PathBuf::from(std::env::var("OXIDAL_PRESET_DIR")?);
    let mut editor = Editor::new(root)?;
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let mut bytes = vec![];
            // Take limits line allocation even if the sender does not terminate a malformed frame.
            let mut limited = std::io::Read::take(&mut input, 65537);
            match limited.read_until(b'\n', &mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(_) if bytes.len() > 65536 || bytes.last() != Some(&b'\n') => break,
                Ok(_) => {
                    if tx
                        .send(serde_json::from_slice::<WorkerRequest>(&bytes))
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });
    let mut output = std::io::stdout().lock();
    loop {
        editor.tick()?;
        let request = match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(r) => r,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let result = match request {
            Ok(WorkerRequest::State) => editor.snapshot(),
            Ok(WorkerRequest::Command { command }) => editor.command(command),
            Err(_) => Err("Invalid native request".into()),
        };
        let reply = match result {
            Ok(s) => WorkerReply::State(Box::new(s)),
            Err(error) => WorkerReply::Error { error },
        };
        serde_json::to_writer(&mut output, &reply)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
