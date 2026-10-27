# AGENTS.md — Oxidal

Oxidal is a software monorepo containing Rust crates (`crates/`), a React/TypeScript web interface (`apps/web/`), OS recipes (`os/`), and shared tooling (`scripts/`). Product architecture is documented in `docs/architecture.md`; setup and commands are in README.md and `docs/development.md`.

The daemon provides loopback HTTP/SSE control, rig validation, simulated MIDI synchronization, owned numeric preview/commit/cancel transactions, and immutable native preset import/list/download. The optional native worker supports offline preset loading, 14 qualified global controls, five per-block controls and capability-gated staged NAM size, owned-copy save and reload; physical playback remains unqualified. NAM Linear/LSTM inference has independent parity/allocation tests. The `oxidal-audio` crate and Settings inspector provide hardware discovery and exact non-streaming probes on Linux with the ALSA feature; see docs/audio.md. The optional Linux LV2/graph core is qualified separately below; live graph structural replacement, physical MIDI and WaveNet/A2 in the owned NAM crate are not implemented; the optional TONE3000 worker does exercise native A2.

Commands from this repository root: `pnpm bootstrap`, `pnpm hooks:install`, `pnpm dev`, `pnpm preview`, `pnpm check`, `pnpm guardrails:prove`, `pnpm release:dry-run`. Check toolchain pins before running. Browser tests require free ports 3210 and 5173.

Generated API types/schema are derived from Rust: use `pnpm contract:generate`; CI verifies with `pnpm contract:check`. Commit messages are title-only Conventional Commits. Cargo/npm publication is disabled. No private workspace, planning or reference checkout is required for normal builds and checks.

An optional `oxidal-tone3000` crate isolates native FFI for offline macOS/Linux qualification (`pnpm native:check`). Its dedicated main-thread worker connects to the daemon with bounded IPC when explicitly enabled. See `docs/native-tone3000.md`; physical Linux audio and full settings/preset behavior remain pending.

Experimental Linux saved-preset playback now has its own process and Start/Stop/Restart API/UI; authoring survives audio stop. `pnpm native:check` runs real worker/ALSA-null lifecycle tests on Linux. General LV2 compatibility, physical audio, real-time performance and managed desktop handoff remain unqualified. See docs/audio.md for the current boundary.

An optional `oxidal-lv2/native` crate now discovers and hosts bounded mono/stereo audio/control plugins on Linux. Its prepared DAG uses shared normalized controls and injected MIDI, with actual DSP/readback tests through `pnpm lv2:check` (Linux CI). See docs/lv2.md for supported features and explicit limits. An isolated graph worker now has its own `/api/v1/graph-audio` daemon lifecycle/control API and shares the device permit with saved-preset playback. The installed-effects browser flow now controls the real graph worker, with new scalar-only rigs and offline save/recall; physical MIDI, plugin state, real-time handoff and full LV2 compatibility remain pending. `pnpm lv2:check` includes actual HTTP/worker/ALSA-null lifecycle and live-control tests.

Experimental Pi image assembly now packages all workers and web assets, enables an unprivileged service, provides per-device authenticated HTTPS/hotspot access, and runs installed-runtime qualification. The API itself remains loopback-only. Native saved-session boot playback is explicitly opt-in in Settings. See os/README.md for image construction, disposable QEMU boot tests, credentials and recovery. Physical Pi/audio/Wi-Fi acceptance and the x64 package lifecycle remain unqualified.

The optional `oxidal-device` helper exposes browser Wi-Fi scan/join, hotspot credentials/country/channel, five automatic hotspot policies, inactive managed-network removal, confirmed rollback and separate system Reboot/Shut down. It remains separate from the unprivileged daemon and uses a root-verified, UID-restricted Unix socket. See docs/device-service.md for recovery tests and the remaining physical radio/power requirements. Real native/LV2 stereo meters and Linux host history are described in docs/monitoring.md. Settings → Maintenance offers persistent unprivileged and password-sudo administrator interactive PTYs and a separate bounded diagnostic command runner through isolated systemd services; see docs/debug-console.md. None of these features establishes physical audio or real-time qualification.

Native playback now has session/revision-checked scalar controls and confirmed
readback. The rig page shows actual sounding blocks while that worker runs and never falls back to
the silent example chain. Example controls require an explicit development URL and
server simulator capability. A separate export worker saves verified named copies of
confirmed scalar settings without changing audio/editor state; full native authoring,
prepared switching and physical timing remain unqualified. The adapter also ports
guarded amp/cab partitioning as an offline preparation API; see docs/native-tone3000.md.

The experimental `oxidal-engine` mixed worker now restores verified portable
bundles containing whole native presets and qualified scalar LV2 plugins. Its
`/api/v1/rig-audio` actor shares device exclusion with existing playback, confirms
live native/LV2/bypass/merge controls, and exports immutable revisions in a separate
process. `pnpm native:check` includes actual mixed worker and HTTP/ALSA-null tests.
See docs/mixed-engine.md for byte/resource admission, startup limits and qualification.
The browser exposes confirmed mixed controls and isolated Save/recall with actual-worker
XR, Fold and BOOX regression checks. Structural composition, complete native controls,
extracted-stage persistence, opaque LV2 state, prepared replacement and gapless/physical
acceptance remain open.
