//! This process must run as the dedicated unprivileged systemd service account.
#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_debug::{Command, Reply, SOCKET, runner::Runner};
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        time::{Duration, Instant},
    };
    use tokio::{net::UnixListener, process::Command as Process};
    if !cfg!(target_os = "linux") {
        return Err("Debug service requires Linux/systemd containment".into());
    }
    let uid = Process::new("/usr/bin/id").arg("-u").output().await?;
    if String::from_utf8_lossy(&uid.stdout).trim() == "0" {
        return Err("Refusing to run a debug shell as root".into());
    }
    let name = Process::new("/usr/bin/id").arg("-un").output().await?;
    if String::from_utf8_lossy(&name.stdout).trim() != "oxidal-debug" {
        return Err("Use the isolated oxidal-debug service account".into());
    }
    let mut runner = Runner::new(
        "/run/oxidal-debug".into(),
        format!(
            "oxidal-debug (uid {})",
            String::from_utf8_lossy(&uid.stdout).trim()
        ),
    );
    match fs::remove_file(SOCKET) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(SOCKET)?;
    fs::set_permissions(SOCKET, fs::Permissions::from_mode(0o660))?;
    let mut terminal = None;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            _=tick.tick()=>{if runner.terminal(){let since=terminal.get_or_insert_with(Instant::now);if since.elapsed()>Duration::from_secs(2){break;}}},
            accepted=listener.accept()=>{
                let(mut stream,_)=accepted?;let peer=stream.peer_cred()?.uid();
                let expected=tokio::time::timeout(Duration::from_secs(2),Process::new("/usr/bin/id").args(["-u","oxidald"]).kill_on_drop(true).output()).await;
                let allowed=match expected{Ok(Ok(v)) if v.status.success()=>String::from_utf8_lossy(&v.stdout).trim().parse::<u32>().ok()==Some(peer),_=>false};
                if peer!=0 && !allowed {continue;}
                let input=tokio::time::timeout(Duration::from_secs(2),oxidal_device::ipc::read(&mut stream)).await;
                let command=match input{Ok(Ok(bytes))=>serde_json::from_slice::<Command>(&bytes).ok(),_=>None};
                let result=command.ok_or("Invalid debug request").and_then(|c|runner.command(c));
                let reply=match result{Ok(state)=>Reply{state:Some(state),error:None},Err(error)=>Reply{state:None,error:Some(error.into())}};
                let delivered_terminal=reply.state.as_ref().is_some_and(|s|s.job.as_ref().is_some_and(|j|j.phase!="running"));
                let sent=tokio::time::timeout(Duration::from_secs(2),oxidal_device::ipc::write(&mut stream,&serde_json::to_vec(&reply)?)).await;
                if delivered_terminal && matches!(sent,Ok(Ok(()))){break;}
            }
        }
    }
    // Normal main-process exit triggers KillMode=control-group before systemd restarts us.
    Ok(())
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Debug service requires Linux");
    std::process::exit(1);
}
