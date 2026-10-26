//! Runs as a fixed non-root account; systemd owns all session descendants.
#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_debug::terminal::{Command, Reply, Terminal, endpoint};
    use std::{
        os::unix::fs::PermissionsExt,
        time::{Duration, Instant},
    };
    use tokio::{net::UnixListener, process::Command as Process};
    if !cfg!(target_os = "linux") {
        return Err("Terminal service requires Linux/systemd".into());
    }
    let mode = std::env::args().nth(1).ok_or("Missing terminal mode")?;
    let (socket, account) = endpoint(&mode).ok_or("Invalid terminal mode")?;
    let name = Process::new("/usr/bin/id").arg("-un").output().await?;
    if String::from_utf8_lossy(&name.stdout).trim() != account {
        return Err("Unexpected terminal account".into());
    }
    let directory = if mode == "admin" {
        "/home/oxidal-admin"
    } else {
        "/run/oxidal-terminal"
    };
    let mut terminal = Terminal::new(directory.into(), account.into());
    match std::fs::remove_file(socket) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o660))?;
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    let mut finished = None;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if terminal.finished()
                    && finished.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(2)
                {
                    break;
                }
            }
            accepted = listener.accept() => {
                let (mut stream, _) = accepted?;
                let peer = stream.peer_cred()?.uid();
                let expected = tokio::task::spawn_blocking(|| nix::unistd::User::from_name("oxidald")).await;
                let allowed = matches!(expected, Ok(Ok(Some(user))) if user.uid.as_raw() == peer);
                if peer != 0 && !allowed {
                    continue;
                }
                let input = tokio::time::timeout(Duration::from_secs(2), oxidal_device::ipc::read(&mut stream)).await;
                let command = match input {
                    Ok(Ok(bytes)) => serde_json::from_slice::<Command>(&bytes).ok(),
                    _ => None,
                };
                let end = matches!(command, Some(Command::End { .. }));
                let result = command.ok_or("Invalid terminal command").and_then(|c| terminal.command(c));
                let ended = end && result.is_ok();
                let reply = match result {
                    Ok(state) => Reply { state: Some(state), error: None },
                    Err(error) => Reply { state: None, error: Some(error.into()) },
                };
                let _ = tokio::time::timeout(Duration::from_secs(2), oxidal_device::ipc::write(&mut stream, &serde_json::to_vec(&reply)?)).await;
                if ended {
                    break;
                }
            }
        }
    }
    // Exiting recycles this service and kills its complete cgroup, including setsid children.
    Ok(())
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Terminal requires Linux");
    std::process::exit(1);
}
