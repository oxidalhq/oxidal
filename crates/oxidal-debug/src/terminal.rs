//! Persistent PTY sessions. Output has a bounded replay window, never a command cutoff.
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
};
const REPLAY: usize = 256 * 1024;
const PAGE: usize = 8192;
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[schemars(rename = "TerminalCommand")]
pub enum Command {
    Read {
        id: Option<String>,
        cursor: u64,
    },
    Start {
        id: String,
        cols: u16,
        rows: u16,
    },
    Input {
        id: String,
        sequence: u64,
        bytes: Vec<u8>,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
    End {
        id: String,
    },
}
impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Terminal command [content omitted]")
    }
}
impl Command {
    pub fn validate(&self) -> Result<(), &'static str> {
        let id = match self {
            Self::Read { id, .. } => id.as_ref(),
            Self::Start { id, .. }
            | Self::Input { id, .. }
            | Self::Resize { id, .. }
            | Self::End { id } => Some(id),
        };
        if id.is_some_and(|s| s.len() != 32 || !s.bytes().all(|b| b.is_ascii_hexdigit())) {
            return Err("Invalid terminal session");
        }
        if let Self::Start { cols, rows, .. } | Self::Resize { cols, rows, .. } = self
            && (!(10..=300).contains(cols) || !(2..=150).contains(rows))
        {
            return Err("Invalid terminal dimensions");
        }
        if let Self::Input { bytes, .. } = self
            && (bytes.is_empty() || bytes.len() > 8192)
        {
            return Err("Terminal input packet must contain 1–8192 bytes");
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "TerminalSession")]
pub struct Session {
    pub id: String,
    pub running: bool,
    pub exit_code: Option<u32>,
    pub next_input: u64,
    pub start: u64,
    pub cursor: u64,
    pub dropped: bool,
    pub bytes: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "TerminalState")]
pub struct State {
    pub available: bool,
    pub identity: String,
    pub directory: String,
    pub session: Option<Session>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Reply {
    pub state: Option<State>,
    pub error: Option<String>,
}
#[derive(Debug, Default)]
struct Output {
    bytes: VecDeque<u8>,
    end: u64,
    running: bool,
    exit_code: Option<u32>,
}
impl Output {
    fn append(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        self.bytes.extend(bytes);
        let remove = self.bytes.len().saturating_sub(REPLAY);
        self.bytes.drain(..remove);
    }
    fn page(&self, id: String, next_input: u64, cursor: u64) -> Session {
        let oldest = self.end - self.bytes.len() as u64;
        let start = cursor.max(oldest).min(self.end);
        let bytes: Vec<u8> = self
            .bytes
            .iter()
            .skip((start - oldest) as usize)
            .take(PAGE)
            .copied()
            .collect();
        Session {
            id,
            running: self.running,
            exit_code: self.exit_code,
            next_input,
            start,
            cursor: start + bytes.len() as u64,
            dropped: cursor < oldest || cursor > self.end,
            bytes,
        }
    }
}
struct Active {
    id: String,
    next_input: u64,
    master: Box<dyn MasterPty + Send>,
    input: mpsc::SyncSender<Vec<u8>>,
    output: Arc<Mutex<Output>>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}
impl Drop for Active {
    fn drop(&mut self) {
        let _ = self.killer.kill();
    }
}
pub struct Terminal {
    active: Option<Active>,
    directory: PathBuf,
    identity: String,
}
impl std::fmt::Debug for Terminal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Terminal")
            .field("identity", &self.identity)
            .finish_non_exhaustive()
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}
impl Terminal {
    pub fn new(directory: PathBuf, identity: String) -> Self {
        Self {
            active: None,
            directory,
            identity,
        }
    }
    pub fn finished(&self) -> bool {
        self.active
            .as_ref()
            .is_some_and(|a| !a.output.lock().unwrap().running)
    }
    fn state(&self, cursor: u64) -> State {
        State {
            available: true,
            identity: self.identity.clone(),
            directory: self.directory.display().to_string(),
            session: self.active.as_ref().map(|a| {
                a.output
                    .lock()
                    .unwrap()
                    .page(a.id.clone(), a.next_input, cursor)
            }),
        }
    }
    pub fn command(&mut self, command: Command) -> Result<State, &'static str> {
        command.validate()?;
        if let Command::Start { id, cols, rows } = &command {
            if let Some(a) = &self.active {
                if a.id == *id {
                    return Ok(self.state(0));
                }
                return Err("A terminal session is already open; reconnect or end it first");
            }
            let pair = native_pty_system()
                .openpty(size(*cols, *rows))
                .map_err(|_| "Cannot allocate terminal")?;
            let mut shell = CommandBuilder::new("/bin/bash");
            shell.args(["--noprofile", "--norc", "-i"]);
            shell.cwd(&self.directory);
            shell.env_clear();
            for (k, v) in [
                (
                    "PATH",
                    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                ),
                ("TERM", "xterm-256color"),
                ("LANG", "C.UTF-8"),
                ("HISTFILE", "/dev/null"),
                ("HISTSIZE", "0"),
                ("PS1", "oxidal:\\w\\$ "),
            ] {
                shell.env(k, v);
            }
            shell.env("HOME", &self.directory);
            let mut reader = pair
                .master
                .try_clone_reader()
                .map_err(|_| "Cannot read terminal")?;
            let mut writer = pair
                .master
                .take_writer()
                .map_err(|_| "Cannot write terminal")?;
            let mut child = pair
                .slave
                .spawn_command(shell)
                .map_err(|_| "Cannot start terminal shell")?;
            drop(pair.slave);
            let killer = child.clone_killer();
            let output = Arc::new(Mutex::new(Output {
                running: true,
                ..Default::default()
            }));
            let copy = output.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    copy.lock().unwrap().append(&buf[..n]);
                }
            });
            let copy = output.clone();
            std::thread::spawn(move || {
                let status = child.wait();
                let mut o = copy.lock().unwrap();
                o.running = false;
                o.exit_code = status.ok().map(|s| s.exit_code());
            });
            let (input, recv) = mpsc::sync_channel::<Vec<u8>>(8);
            std::thread::spawn(move || {
                while let Ok(bytes) = recv.recv() {
                    if writer.write_all(&bytes).is_err() {
                        break;
                    }
                }
            });
            self.active = Some(Active {
                id: id.clone(),
                next_input: 0,
                master: pair.master,
                input,
                output,
                killer,
            });
            return Ok(self.state(0));
        }
        let (id, cursor) = match &command {
            Command::Read { id, cursor } => (id.as_ref(), *cursor),
            Command::Input { id, .. } | Command::Resize { id, .. } | Command::End { id } => {
                (Some(id), 0)
            }
            Command::Start { .. } => unreachable!(),
        };
        if let Some(id) = id
            && self.active.as_ref().is_none_or(|a| a.id != *id)
        {
            return Err("Terminal session changed; reconnect without replaying input");
        }
        match command {
            Command::Input {
                sequence, bytes, ..
            } => {
                let a = self.active.as_mut().ok_or("No terminal session")?;
                if sequence != a.next_input {
                    return Err("Input sequence changed; input was not replayed");
                }
                if !a.output.lock().unwrap().running {
                    return Err("Terminal has exited");
                }
                a.input
                    .try_send(bytes)
                    .map_err(|_| "Terminal input is busy; input was not accepted")?;
                a.next_input += 1;
            }
            Command::Resize { cols, rows, .. } => self
                .active
                .as_mut()
                .ok_or("No terminal session")?
                .master
                .resize(size(cols, rows))
                .map_err(|_| "Terminal resize failed")?,
            Command::End { .. } => {
                let a = self.active.as_mut().ok_or("No terminal session")?;
                a.killer.kill().map_err(|_| "Terminal shutdown failed")?;
                a.output.lock().unwrap().running = false;
            }
            _ => {}
        }
        Ok(self.state(cursor))
    }
}
/// Fixed account/socket mapping; no user-supplied path, executable or identity.
pub fn endpoint(mode: &str) -> Option<(&'static str, &'static str)> {
    match mode {
        "unprivileged" => Some(("/run/oxidal-terminal/control.sock", "oxidal-debug")),
        "admin" => Some(("/run/oxidal-admin-terminal/control.sock", "oxidal-admin")),
        _ => None,
    }
}
pub async fn request(mode: &str, command: Command) -> Result<State, &'static str> {
    use tokio::net::UnixStream;
    command.validate()?;
    let (path, account) = endpoint(mode).ok_or("Unknown terminal mode")?;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let uid = tokio::task::spawn_blocking(move || nix::unistd::User::from_name(account))
            .await
            .map_err(|_| "Terminal account unavailable")?
            .map_err(|_| "Terminal account unavailable")?
            .ok_or("Terminal account unavailable")?
            .uid
            .as_raw();
        if uid == 0 {
            return Err("Terminal service must not run as root");
        }
        let mut stream = UnixStream::connect(path)
            .await
            .map_err(|_| "Terminal service unavailable")?;
        if stream
            .peer_cred()
            .map_err(|_| "Terminal peer unavailable")?
            .uid()
            != uid
        {
            return Err("Unexpected terminal service identity");
        }
        oxidal_device::ipc::write(
            &mut stream,
            &serde_json::to_vec(&command).map_err(|_| "Invalid terminal request")?,
        )
        .await
        .map_err(|_| "Terminal request failed")?;
        let bytes = oxidal_device::ipc::read(&mut stream)
            .await
            .map_err(|_| "Terminal response failed")?;
        let reply: Reply =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid terminal response")?;
        reply.state.ok_or("Terminal command rejected").map_err(|_| {
            reply
                .error
                .map(|_| "Terminal command rejected; reconnect before typing again")
                .unwrap_or("Invalid terminal response")
        })
    })
    .await
    .map_err(|_| "Terminal response timed out; reconnect without replaying input")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    fn input(t: &mut Terminal, id: &str, sequence: u64, bytes: &[u8]) {
        t.command(Command::Input {
            id: id.into(),
            sequence,
            bytes: bytes.to_vec(),
        })
        .unwrap();
    }
    fn until(t: &mut Terminal, cursor: &mut u64, needle: &str, seconds: u64) -> String {
        let start = Instant::now();
        let mut text = String::new();
        while start.elapsed() < Duration::from_secs(seconds) {
            let session = t
                .command(Command::Read {
                    id: None,
                    cursor: *cursor,
                })
                .unwrap()
                .session
                .unwrap();
            *cursor = session.cursor;
            text.push_str(&String::from_utf8_lossy(&session.bytes));
            if text.contains(needle) {
                return text;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("Expected terminal marker {needle:?}, got {text:?}");
    }
    #[test]
    fn replay_window_and_protocol_boundaries() {
        let mut out = Output::default();
        out.append(&vec![b'x'; REPLAY + 100]);
        let page = out.page("a".repeat(32), 2, 0);
        assert!(page.dropped);
        assert_eq!(page.start, 100);
        assert_eq!(page.bytes.len(), PAGE);
        assert_eq!(out.bytes.len(), REPLAY);
        assert!(
            Command::Start {
                id: "a".repeat(32),
                cols: 0,
                rows: 24
            }
            .validate()
            .is_err()
        );
        assert!(
            Command::Input {
                id: "a".repeat(32),
                sequence: 0,
                bytes: vec![0; 8193]
            }
            .validate()
            .is_err()
        );
        assert_eq!(endpoint("admin").unwrap().1, "oxidal-admin");
        assert!(endpoint("../../root").is_none());
    }
    #[test]
    fn real_pty_input_resize_reconnect_interrupt_and_unbounded_command() {
        let id = "a".repeat(32);
        let mut terminal = Terminal::new(std::env::temp_dir(), "test identity".into());
        terminal
            .command(Command::Start {
                id: id.clone(),
                cols: 80,
                rows: 24,
            })
            .unwrap();
        let mut cursor = 0;
        input(
            &mut terminal,
            &id,
            0,
            b"cd /tmp; export OXIDAL_PTY_TEST=retained; printf 'READY_%s\\n' done\r",
        );
        until(&mut terminal, &mut cursor, "READY_done", 3);
        assert!(
            terminal
                .command(Command::Input {
                    id: id.clone(),
                    sequence: 0,
                    bytes: b"exit\r".to_vec()
                })
                .is_err()
        );
        assert!(
            terminal
                .command(Command::End { id: "b".repeat(32) })
                .is_err()
        );
        terminal
            .command(Command::Resize {
                id: id.clone(),
                cols: 93,
                rows: 27,
            })
            .unwrap();
        input(
            &mut terminal,
            &id,
            1,
            b"stty size; printf 'STATE_%s\\n' \"$OXIDAL_PTY_TEST\"; pwd\r",
        );
        let text = until(&mut terminal, &mut cursor, "STATE_retained", 3);
        assert!(text.contains("27 93"));
        // New read cursor/client attaches without resetting shell cwd/environment or replaying input.
        assert_eq!(
            terminal
                .command(Command::Read {
                    id: None,
                    cursor: 0
                })
                .unwrap()
                .session
                .unwrap()
                .id,
            id
        );
        input(
            &mut terminal,
            &id,
            2,
            b"head -c 20000 /dev/zero | tr '\\0' x; printf '\\nFLOOD_%s\\n' done\r",
        );
        let text = until(&mut terminal, &mut cursor, "FLOOD_done", 5);
        assert!(text.len() > 8192);
        input(&mut terminal, &id, 3, b"sleep 60\r");
        std::thread::sleep(Duration::from_millis(100));
        input(&mut terminal, &id, 4, &[3]);
        input(&mut terminal, &id, 5, b"printf 'INTERRUPT_%s\\n' done\r");
        until(&mut terminal, &mut cursor, "INTERRUPT_done", 3);
        input(
            &mut terminal,
            &id,
            6,
            b"sleep 31; printf 'LONG_%s\\n' done\r",
        );
        until(&mut terminal, &mut cursor, "LONG_done", 36);
        assert!(
            terminal
                .command(Command::Read { id: None, cursor })
                .unwrap()
                .session
                .unwrap()
                .running
        );
        terminal.command(Command::End { id }).unwrap();
        assert!(terminal.finished());
    }
}
