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
fn main() -> Result<(), Box<dyn std::error::Error>> {
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
            Ok(s) => WorkerReply::State(s),
            Err(error) => WorkerReply::Error { error },
        };
        serde_json::to_writer(&mut output, &reply)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
