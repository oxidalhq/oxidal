//! One job, bounded output and lifetime. systemd cleans the entire service cgroup
//! after delivery of the terminal result, including descendants which changed sessions.
use crate::{Command, Job, OUTPUT_LIMIT, State};
use std::{
    io::Read,
    os::unix::process::CommandExt,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::{mpsc, watch},
};
#[derive(Debug)]
pub struct Runner {
    state: watch::Receiver<State>,
    updates: watch::Sender<State>,
    cancel: Option<watch::Sender<bool>>,
    directory: PathBuf,
}
fn token() -> Result<String, &'static str> {
    let mut b = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut b))
        .map_err(|_| "Cannot create debug job")?;
    Ok(b.iter().map(|v| format!("{v:02x}")).collect())
}
impl Runner {
    pub fn new(directory: PathBuf, identity: String) -> Self {
        let initial = State {
            available: true,
            identity,
            directory: directory.display().to_string(),
            message: "Debug commands are disabled until explicitly enabled in the web UI".into(),
            ..Default::default()
        };
        let (updates, state) = watch::channel(initial);
        Self {
            state,
            updates,
            cancel: None,
            directory,
        }
    }
    pub fn state(&self) -> State {
        self.state.borrow().clone()
    }
    pub fn terminal(&self) -> bool {
        self.state
            .borrow()
            .job
            .as_ref()
            .is_some_and(|j| j.phase != "running")
    }
    pub fn command(&mut self, command: Command) -> Result<State, &'static str> {
        command.validate()?;
        match command {
            Command::Status {} => {}
            Command::Run { command } => {
                if self.state.borrow().job.is_some() {
                    return Err("Debug service is completing its previous job; retry shortly");
                }
                let id = token()?;
                let (cancel, signal) = watch::channel(false);
                self.cancel = Some(cancel);
                self.updates.send_modify(|s| {
                    s.job = Some(Job {
                        id,
                        phase: "running".into(),
                        output: String::new(),
                        exit_code: None,
                        elapsed_ms: 0,
                    })
                });
                tokio::spawn(execute(
                    command,
                    self.directory.clone(),
                    self.updates.clone(),
                    signal,
                    Duration::from_secs(30),
                ));
            }
            Command::Cancel { id } => {
                if !self
                    .state
                    .borrow()
                    .job
                    .as_ref()
                    .is_some_and(|j| j.id == id && j.phase == "running")
                {
                    return Err("Debug job is no longer running");
                }
                if let Some(cancel) = &self.cancel {
                    cancel.send_replace(true);
                }
            }
            _ => return Err("Debug mode is controlled by the web daemon"),
        }
        Ok(self.state())
    }
}
impl Drop for Runner {
    fn drop(&mut self) {
        if let Some(cancel) = &self.cancel {
            cancel.send_replace(true);
        }
    }
}
async fn pump(mut reader: impl AsyncRead + Unpin, send: mpsc::Sender<Vec<u8>>) {
    loop {
        let mut bytes = vec![0; 1024];
        match reader.read(&mut bytes).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                bytes.truncate(n);
                if send.send(bytes).await.is_err() {
                    break;
                }
            }
        }
    }
}
async fn kill_group(pid: u32) {
    // Fixed executable and numeric process group only; never interpolate command content.
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new("/bin/kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await;
}
async fn execute(
    command: String,
    directory: PathBuf,
    updates: watch::Sender<State>,
    mut cancel: watch::Receiver<bool>,
    limit: Duration,
) {
    let started = Instant::now();
    let mut process = tokio::process::Command::new("/bin/sh");
    process
        .args(["-c", &command])
        .current_dir(&directory)
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", &directory)
        .env("LANG", "C.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    process.as_std_mut().process_group(0);
    let Ok(mut child) = process.spawn() else {
        updates.send_modify(|s| {
            let j = s.job.as_mut().unwrap();
            j.phase = "failed".into();
            j.output = "Cannot start the debug shell".into();
        });
        return;
    };
    let pid = child.id().unwrap();
    let (send, mut receive) = mpsc::channel(8);
    let stdout = tokio::spawn(pump(child.stdout.take().unwrap(), send.clone()));
    let stderr = tokio::spawn(pump(child.stderr.take().unwrap(), send));
    let mut output = Vec::new();
    let mut phase = "completed";
    let mut code = None;
    let mut streams_open = true;
    let deadline = tokio::time::sleep(limit);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            biased;
            _=cancel.changed()=>{phase="cancelled";break;},
            _=&mut deadline=>{phase="timed_out";break;},
            bytes=receive.recv(),if streams_open=>match bytes {
                Some(bytes)=>{let remaining=OUTPUT_LIMIT-output.len();output.extend_from_slice(&bytes[..bytes.len().min(remaining)]);updates.send_modify(|s|{let j=s.job.as_mut().unwrap();j.output=String::from_utf8_lossy(&output).into_owned();j.elapsed_ms=started.elapsed().as_millis() as u64;});if bytes.len()>remaining {phase="output_limit";break;}},
                None=>streams_open=false,
            },
            status=child.wait()=>{match status {Ok(status)=>code=status.code(),Err(_)=>phase="failed"};break;}
        }
    }
    kill_group(pid).await;
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    // Drain the finite trailing pipe data after ordinary exit, still under the same cap.
    let _ = tokio::time::timeout(Duration::from_millis(200), async {
        while let Some(bytes) = receive.recv().await {
            let remaining = OUTPUT_LIMIT - output.len();
            output.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
            if bytes.len() > remaining {
                phase = "output_limit";
                break;
            }
        }
    })
    .await;
    stdout.abort();
    stderr.abort();
    updates.send_modify(|s| {
        let j = s.job.as_mut().unwrap();
        j.phase = phase.into();
        j.output = String::from_utf8_lossy(&output).into_owned();
        j.exit_code = code;
        j.elapsed_ms = started.elapsed().as_millis() as u64;
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    async fn run(command: &str, limit: Duration, cancel_now: bool) -> Job {
        let initial = State {
            job: Some(Job {
                id: "a".repeat(32),
                phase: "running".into(),
                output: String::new(),
                exit_code: None,
                elapsed_ms: 0,
            }),
            ..Default::default()
        };
        let (updates, state) = watch::channel(initial);
        let (cancel, signal) = watch::channel(false);
        let task = tokio::spawn(execute(
            command.into(),
            std::env::temp_dir(),
            updates,
            signal,
            limit,
        ));
        if cancel_now {
            tokio::time::sleep(Duration::from_millis(30)).await;
            cancel.send_replace(true);
        }
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        state.borrow().job.clone().unwrap()
    }
    #[tokio::test]
    async fn output_exit_limits_timeout_and_cancellation() {
        let job = run(
            "printf hello; printf error >&2; exit 7",
            Duration::from_secs(2),
            false,
        )
        .await;
        assert_eq!(job.phase, "completed");
        assert_eq!(job.exit_code, Some(7));
        assert!(job.output.contains("hello") && job.output.contains("error"));
        let flood = run("yes flood", Duration::from_secs(2), false).await;
        assert_eq!(flood.phase, "output_limit");
        assert!(flood.output.len() <= OUTPUT_LIMIT);
        let timeout = run("sleep 60 & wait", Duration::from_millis(30), false).await;
        assert_eq!(timeout.phase, "timed_out");
        let cancel = run("sleep 60 & wait", Duration::from_secs(2), true).await;
        assert_eq!(cancel.phase, "cancelled");
    }
}
