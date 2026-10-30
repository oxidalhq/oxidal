# Oxidal core

Native Rust control foundation. Six portable crates: routing validation, shared control state, HTTP/SSE service, project-owned NAM inference, bounded native preset inspection/storage, and audio-device inspection with an optional Linux ALSA backend. The daemon currently processes no live audio.

Run from the repository root:

```sh
node scripts/tooling.mjs core-check
pnpm contract:generate
pnpm dev
```

The root commands select Rust 1.95.0 explicitly, including when Homebrew Rust precedes rustup on PATH. Dependencies are locked in `Cargo.lock`. Use `cargo +1.95.0` directly only with a rustup-proxy installation, or set the toolchain bin directory first. The six control/storage/NAM/audio crates forbid unsafe code. The separate optional `oxidal-tone3000` crate isolates a reviewed unsafe FFI boundary for offline native qualification; see [native adapter](native-tone3000.md). Its optional main-thread worker connects offline preset editing to the daemon; live audio remains unavailable.

`oxidald` binds `127.0.0.1:3210` by default. Environment: `OXIDAL_ADDR` (loopback only), `OXIDAL_SIMULATOR=1` (opt in), `OXIDAL_MAPPING_PATH`, `OXIDAL_PRESET_DIR`, `OXIDAL_UI_DIR`. It serves built web assets as well as `/api/v1/*`, so a production asset build needs no Vite process. The page and client routes are sent with `Cache-Control: no-cache` so a deployed UI replaces the previous one; hashed `/assets/*` files are `immutable`. SIGINT/SIGTERM close active event subscriptions and stop the listener.

See [architecture and control contract](architecture.md). All seven crates, including the optional offline adapter, are tracked in this monorepo.

See [audio inspection and lifecycle](audio.md) for ALSA feature dependencies and the distinction between stopping audio and stopping the editor service.
