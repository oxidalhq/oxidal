use oxidal_api::{Config, router_with_shutdown, validate_address};
use std::{net::SocketAddr, path::PathBuf};

/// Native local control daemon entry point.
/// @see docs/architecture.md
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = std::env::var("OXIDAL_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3210".into())
        .parse()?;
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let config = Config {
        debug_socket: std::env::var_os("OXIDAL_DEBUG_SOCKET").map(PathBuf::from),
        device_socket: std::env::var_os("OXIDAL_DEVICE_SOCKET").map(PathBuf::from),
        shutdown: Some(shutdown),
        graph_worker: std::env::var_os("OXIDAL_GRAPH_WORKER").map(PathBuf::from),
        rig_worker: std::env::var_os("OXIDAL_RIG_WORKER").map(PathBuf::from),
        audio_worker: std::env::var_os("OXIDAL_AUDIO_WORKER").map(PathBuf::from),
        native_worker: std::env::var_os("OXIDAL_NATIVE_WORKER").map(PathBuf::from),
        simulator: std::env::var("OXIDAL_SIMULATOR").is_ok_and(|v| v == "1"),
        mapping_path: PathBuf::from(
            std::env::var("OXIDAL_MAPPING_PATH").unwrap_or_else(|_| ".local/mappings.json".into()),
        ),
        preset_dir: PathBuf::from(
            std::env::var("OXIDAL_PRESET_DIR").unwrap_or_else(|_| ".local/presets".into()),
        ),
        ui_dir: PathBuf::from(
            std::env::var("OXIDAL_UI_DIR").unwrap_or_else(|_| "apps/web/dist".into()),
        ),
    };
    let listener = tokio::net::TcpListener::bind(validate_address(address)?).await?;
    println!(
        "Oxidal {} listening at http://{} (audio unavailable)",
        env!("CARGO_PKG_VERSION"),
        listener.local_addr()?
    );
    let (app, stopped) = router_with_shutdown(config)?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! { _=tokio::signal::ctrl_c()=>{}, _=term.recv()=>{} }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
            stop.send_replace(true);
        })
        .await?;
    stopped.wait().await?;
    Ok(())
}
