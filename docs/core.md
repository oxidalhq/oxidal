# Oxidal core

Oxidal's Rust workspace provides routing validation, shared control state, the
HTTP/event service, preset storage, project-owned NAM inference, Linux audio-device
support and isolated native/LV2 workers. The daemon remains the control plane; a
supervised worker owns live audio and reports confirmed state back to the browser.

Run from the repository root:

```sh
node scripts/tooling.mjs core-check
pnpm contract:generate
pnpm dev
```

The root commands select Rust 1.95.0 explicitly, including when Homebrew Rust
precedes rustup on `PATH`. Dependencies are locked in `Cargo.lock`. Use
`cargo +1.95.0` directly only with a rustup-proxy installation, or select the pinned
toolchain first. Portable control, storage, NAM and audio crates forbid unsafe code.
The `oxidal-tone3000` crate isolates the reviewed native FFI boundary; see the
[native adapter](native-tone3000.md).

`oxidald` binds `127.0.0.1:3210` by default. Environment: `OXIDAL_ADDR` (loopback only), `OXIDAL_SIMULATOR=1` (opt in), `OXIDAL_MAPPING_PATH`, `OXIDAL_PRESET_DIR`, `OXIDAL_UI_DIR`. It serves built web assets as well as `/api/v1/*`, so a production asset build needs no Vite process. The page and client routes are sent with `Cache-Control: no-cache` so a deployed UI replaces the previous one; hashed `/assets/*` files are `immutable`. SIGINT/SIGTERM close active event subscriptions and stop the listener.

See [architecture and control contract](architecture.md). All product crates and
their generated contracts are tracked in this repository.

See [audio inspection and lifecycle](audio.md) for ALSA feature dependencies and the distinction between stopping audio and stopping the editor service.
