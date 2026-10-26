use oxidal_api::{Config, router, validate_address};
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
        shutdown: Some(shutdown),
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
    axum::serve(listener, router(config)?)
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
    Ok(())
}
