//! Privileged, local-only device helper. No shell, arbitrary commands or user paths.
#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use oxidal_device::{Command, Reply, SOCKET, ipc, network::Network, packs::Manager};
    use std::{fs, os::unix::fs::PermissionsExt, time::Duration};
    use tokio::{net::UnixListener, process::Command as Process};
    if !cfg!(target_os = "linux") {
        return Err("Device helper requires Linux".into());
    }
    let mut network = Network::default();
    let mut packs = Manager::default();
    network.recover().await?;
    // /run/oxidal-device is created by systemd, root-owned with a restricted group.
    match fs::remove_file(SOCKET) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(SOCKET)?;
    fs::set_permissions(SOCKET, fs::Permissions::from_mode(0o660))?;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _=tick.tick()=>network.tick().await,
            accepted=listener.accept()=>{
                let (mut stream,_)=accepted?;
                let uid=stream.peer_cred()?.uid();
                // DynamicUser is resolved through systemd's NSS provider on each connection.
                let expected=tokio::time::timeout(Duration::from_secs(2),Process::new("/usr/bin/id").args(["-u","oxidald"]).kill_on_drop(true).output()).await;
                let allowed=match expected {Ok(Ok(output)) if output.status.success()=>String::from_utf8_lossy(&output.stdout).trim().parse::<u32>().ok()==Some(uid),_=>false};
                if uid!=0 && !allowed {continue;}
                let input=tokio::time::timeout(Duration::from_secs(3),ipc::read(&mut stream)).await;
                let command=match input {Ok(Ok(bytes))=>serde_json::from_slice::<Command>(&bytes).ok(),_=>None};
                if let Some(Command::Power { action }) = &command {
                    let action=*action;
                    let reply=match network.status(false).await {
                        Ok(state) if state.pending.is_none()=>Reply{state:Some(oxidal_device::NetworkState{message:"System power request accepted; unsaved edits will be lost".into(),..state}),packs:None,error:None},
                        _=>Reply{state:None,packs:None,error:Some("Finish network recovery before a system power request".into())}
                    };
                    let accepted=reply.error.is_none();
                    let sent=tokio::time::timeout(Duration::from_secs(2),ipc::write(&mut stream,&serde_json::to_vec(&reply)?)).await;
                    if accepted && matches!(sent,Ok(Ok(()))) {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        if oxidal_device::power::request(action).await.is_err() { eprintln!("System power request failed"); }
                    }
                    continue;
                }
                let changing=matches!(&command,Some(Command::Join{..}|Command::Hotspot{..}|Command::Policy{..}));
                if matches!(&command,Some(Command::Packs{}|Command::Pack{..})) {
                    let result=match command {
                        Some(Command::Packs{})=>Ok(()),
                        Some(Command::Pack{id,action})=>packs.start(&id,action).await,
                        _=>unreachable!(),
                    };
                    let reply=match result {
                        Ok(())=>Reply{state:None,packs:Some(packs.state().await),error:None},
                        Err(error)=>Reply{state:None,packs:None,error:Some(error.into())},
                    };
                    let bytes=serde_json::to_vec(&reply)?;
                    let _=tokio::time::timeout(Duration::from_secs(2),ipc::write(&mut stream,&bytes)).await;
                    continue;
                }
                let result=match command {
                    Some(command) if changing=>network.begin(&command).await,
                    Some(command)=>network.command(command).await,
                    None=>Err("Invalid device request"),
                };
                let activate=changing && result.is_ok();
                let reply=match result {Ok(state)=>Reply{state:Some(state),packs:None,error:None},Err(error)=>Reply{state:None,packs:None,error:Some(error.into())}};
                let bytes=serde_json::to_vec(&reply)?;
                let _=tokio::time::timeout(Duration::from_secs(2),ipc::write(&mut stream,&bytes)).await;
                if activate {
                    // Let the browser receive instructions before changing its network link.
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    network.activate().await;
                }
            }
        }
    }
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Device helper requires Linux");
    std::process::exit(1);
}
