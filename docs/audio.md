# Audio devices and playback lifecycle

`oxidal-audio` implements hardware discovery and exact, short-lived ALSA configuration probes. It is not yet a streaming audio engine. The Jogg is one qualification interface; there is no vendor whitelist. USB, built-in and board devices are discovered through Linux ALSA card/PCM enumeration. The library forbids unsafe code and uses the safe `alsa` crate around libasound.

## Run and inspect

On Linux, install `libasound2-dev` and `pkg-config` (Debian/Ubuntu package names). Normal `pnpm dev`, `pnpm preview`, `pnpm check` and artifact builds enable `oxidal-api/alsa` on Linux. Raw Cargo builds require `--features oxidal-api/alsa` to enable discovery. Other platforms return an explicit unavailable result; the optional feature keeps portable/ARM cross-compilation independent of an ALSA sysroot. A portable ARM check is not an ALSA-feature check.

Open **Settings → Audio devices → Refresh audio devices**. Select a hardware endpoint/direction and check a proposed rate, channel count, sample format, period length and period count. The check opens the PCM nonblocking, applies exact settings without resampling, reads them back and closes the handle. It never starts a stream or reads/writes samples. A busy, missing or unsupported device fails visibly without changing the rig. Input/output are checked separately; individual success does not prove simultaneous duplex or independent-clock operation.

- `GET /api/v1/audio/devices`: hardware IDs, names and capture/playback directions, plus discovery warnings. Enumeration does not open PCM streams. IDs use ALSA card names and PCM indices, not hard-coded card numbers. They are not USB serial identities and are not persisted yet.
- `POST /api/v1/audio/probe`: the generated `AudioProbe` contract; bounds are 8–192 kHz, 1–64 channels, 16–8192 frames/period and 2–8 periods. These are probe bounds, not supported live-engine limits. Formats cover signed 16-bit, 24-bit in 32-bit containers, packed 24-bit, signed 32-bit and float32 in native byte order.
- Probe requests must match a freshly enumerated hardware endpoint and direction. Arbitrary ALSA PCM expressions, file plugins, `default` and `null` are rejected by the public path. No browser-supplied command is executed.
- Blocking ALSA work runs outside the async control state. One shared permit limits simultaneous discovery/probes, including after a requesting client disconnects. The probe retains no interface, settings or audio buffers. Hardware driver calls are not given a hard cancellation guarantee.
- Both responses keep `streaming_available: false`; service health continues reporting `audio_available: false`. Offline native editing and library access remain independent.

Enumeration is bounded to 64 cards and 64 PCM devices per card. It covers hardware PCM subdevice zero; virtual PipeWire/JACK routes, subdevice selection and topology-dependent channel maps remain future work. Capability ranges, format recommendations, duplex negotiation, device identity persistence, live channel routing, reconnect and xrun recovery remain unimplemented. Discovery alone is not PiPedal audio parity.

## Playback and authoring modes

The intended normal operation stops **the audio engine**, not `oxidald`. Keep HTTP/SSE, the library, parameter editing and preset saving available while the interface is released. The offline editor must not need to own audio hardware. When streaming is introduced, probes and device changes must share the engine's ownership gate; never probe/reconfigure its active PCM independently.

Planned controls:

- **Stop audio / Start audio:** release or reacquire the configured interface while retaining the editor and current draft. Start validates the graph/device before making output active.
- **Restart audio:** recover the audio worker without restarting the web/control service; show failure rather than silently changing devices.
- **Use TONE3000:** preflight desktop/app availability, resolve pending edits, stop/release Oxidal audio, and launch the configured standalone app. A failed stop must not launch another audio owner. Keep Oxidal authoring open.
- **Return to Oxidal:** release the managed standalone audio session, explicitly choose whether to import an exported preset, then resume the validated Oxidal rig. Do not automatically terminate unrelated app instances or overwrite edits.
- **Audio devices:** refresh/inspect now; saved input/output, channels, rate/buffer selection and transactional Apply follow with the live engine.
- **Full service shutdown/restart:** separate advanced maintenance, clearly labelled as disconnecting the UI; recovery must exist outside the stopped service.

These lifecycle controls are requirements, not working buttons in the current inspection-only build. Engine state will distinguish unavailable, stopped, starting, running, stopping, external-app ownership and failure. Stop must acknowledge actual audio-handle release, not just update a flag. Authoring while stopped is silent; changes take effect only when a validated rig is started. Native singleton/offline worker constraints must be resolved before concurrent editor/playback ownership is claimed.

Use narrowly authorized lifecycle operations and configured executables. Avoid automatic restart races and preserve an explicit user choice after app exit/failure. The browser must not acquire arbitrary service-manager or shell permissions.

## Repeatable verification

The normal Rust workspace tests cover bounds, unlisted PCM rejection, real HTTP discovery/probe failure and unchanged rig/library availability. On Linux with the ALSA feature they also configure/release libasound's own `null` PCM in both directions across all five formats and check missing-device failure. The null plugin is internal to those tests and cannot be selected through the public API. It establishes library integration, not real device, latency, xrun or audible output qualification.

```sh
cargo test --locked --workspace --features oxidal-api/alsa
cargo clippy --locked --workspace --all-targets --features oxidal-api/alsa -- -D warnings
```

Use the pinned toolchain described in [core](core.md). These commands run in a normal Linux checkout or disposable Linux container with libasound installed; no separate test runner or physical device is required. Existing Playwright coverage checks that inspecting devices keeps the authoring UI connected. Physical acceptance must additionally cover actual USB/built-in devices, negotiated duplex settings, reconnect, channel routing, sustained streaming and performance.
