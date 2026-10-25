# Oxidal core

Native Rust control foundation. Five working crates: routing validation, shared control state, HTTP/SSE service, project-owned NAM inference, and bounded native preset inspection/storage. The daemon currently processes no live audio.

Run from the repository root:

```sh
node scripts/tooling.mjs core-check
pnpm contract:generate
pnpm dev
```

The root commands select Rust 1.95.0 explicitly, including when Homebrew Rust precedes rustup on PATH. Dependencies are locked in `Cargo.lock`. Use `cargo +1.95.0` directly only with a rustup-proxy installation, or set the toolchain bin directory first. All initial crates forbid unsafe code; future native FFI must be isolated and reviewed.

`oxidald` binds `127.0.0.1:3210` by default. Environment: `OXIDAL_ADDR` (loopback only), `OXIDAL_SIMULATOR=1` (opt in), `OXIDAL_MAPPING_PATH`, `OXIDAL_PRESET_DIR`, `OXIDAL_UI_DIR`. It serves built web assets as well as `/api/v1/*`, so a production asset build needs no Vite process. SIGINT/SIGTERM close active event subscriptions and stop the listener.

See [architecture and control contract](architecture.md). All five crates are tracked in this monorepo.
