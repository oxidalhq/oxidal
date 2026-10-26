# CLAUDE.md — Oxidal

Oxidal is a software monorepo containing Rust crates (`crates/`), a React/TypeScript web interface (`apps/web/`), OS recipes (`os/`), and shared tooling (`scripts/`). Product architecture is documented in `docs/architecture.md`; setup and commands are in README.md and `docs/development.md`.

The daemon provides loopback HTTP/SSE control, rig validation, simulated MIDI synchronization, owned numeric preview/commit/cancel transactions, and immutable native preset import/list/download. The optional native worker supports offline preset loading, five controls, owned-copy save and reload; live playback remains unavailable. NAM Linear/LSTM inference has independent parity/allocation tests. Live audio, LV2 hosting, physical MIDI and WaveNet/A2 in the owned NAM crate are not implemented; the optional TONE3000 worker does exercise native A2.

Commands from this repository root: `pnpm bootstrap`, `pnpm hooks:install`, `pnpm dev`, `pnpm preview`, `pnpm check`, `pnpm guardrails:prove`, `pnpm release:dry-run`. Check toolchain pins before running. Browser tests require free ports 3210 and 5173.

Generated API types/schema are derived from Rust: use `pnpm contract:generate`; CI verifies with `pnpm contract:check`. Commit messages are title-only Conventional Commits. Cargo/npm publication is disabled. No private workspace, planning or reference checkout is required for normal builds and checks.

An optional `oxidal-tone3000` crate isolates native FFI for offline macOS qualification (`pnpm native:check`). Its dedicated main-thread worker connects to the daemon with bounded IPC when explicitly enabled. See `docs/native-tone3000.md`; native Linux/audio and full settings/preset behavior remain pending.
