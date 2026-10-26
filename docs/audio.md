# Audio devices and playback lifecycle

`oxidal-audio` implements hardware discovery and exact, short-lived ALSA configuration probes. An opt-in experimental duplex transport and isolated native playback worker are also implemented; physical audio is not yet qualified. The Jogg is one qualification interface; there is no vendor whitelist. USB, built-in and board devices are discovered through Linux ALSA card/PCM enumeration. The library forbids unsafe code and uses the safe `alsa` crate around libasound.

## Run and inspect

On Linux, install `libasound2-dev` and `pkg-config` (Debian/Ubuntu package names). Normal `pnpm dev`, `pnpm preview`, `pnpm check` and artifact builds enable `oxidal-api/alsa` on Linux. Raw Cargo builds require `--features oxidal-api/alsa` to enable discovery. Other platforms return an explicit unavailable result; the optional feature keeps portable/ARM cross-compilation independent of an ALSA sysroot. A portable ARM check is not an ALSA-feature check.

Open **Settings → Audio devices → Refresh audio devices**. Select a hardware endpoint/direction and check a proposed rate, channel count, sample format, period length and period count. The check opens the PCM nonblocking, applies exact settings without resampling, reads them back and closes the handle. It never starts a stream or reads/writes samples. A busy, missing or unsupported device fails visibly without changing the rig. Input/output are checked separately; individual success does not prove simultaneous duplex or independent-clock operation.

- `GET /api/v1/audio/devices`: hardware IDs, names and capture/playback directions, plus discovery warnings. Enumeration does not open PCM streams. IDs use ALSA card names and PCM indices, not hard-coded card numbers. They are not USB serial identities and are not persisted yet.
- `POST /api/v1/audio/probe`: the generated `AudioProbe` contract; bounds are 8–192 kHz, 1–64 channels, 16–8192 frames/period and 2–8 periods. These are probe bounds, not supported live-engine limits. Formats cover signed 16-bit, 24-bit in 32-bit containers, packed 24-bit, signed 32-bit and float32 in native byte order.
- Probe requests must match a freshly enumerated hardware endpoint and direction. Arbitrary ALSA PCM expressions, file plugins, `default` and `null` are rejected by the public path. No browser-supplied command is executed.
- Blocking ALSA work runs outside the async control state. One shared permit limits simultaneous discovery/probes, including after a requesting client disconnects. The playback supervisor retains this same permit until its worker is reaped. The probe retains no interface, settings or audio buffers. Hardware driver calls are not given a hard cancellation guarantee.
- Both responses keep `streaming_available: false`; service health continues reporting `audio_available: false`. Offline native editing and library access remain independent.

Enumeration is bounded to 64 cards and 64 PCM devices per card. It covers hardware PCM subdevice zero; virtual PipeWire/JACK routes, subdevice selection and topology-dependent channel maps remain future work. Capability ranges, format recommendations, automatic duplex negotiation, device identity persistence, independent-device clock compensation, reconnect and xrun recovery remain unimplemented. Discovery alone is not PiPedal audio parity.

## Playback and authoring modes

Normal playback control stops **the audio engine**, not `oxidald`. Keep HTTP/SSE, the library, parameter editing and preset saving available while the interface is released. The offline editor must not need to own audio hardware. The supervisor and probes share one ownership gate; probing an active playback interface returns a conflict.

Controls and remaining handoff scope:

- **Stop audio / Start audio:** release or reacquire the configured interface while retaining the editor and current draft. The experimental implementation starts one explicitly selected, immutable native preset, validates device settings and waits for native readiness. It does not start the generic rig graph.
- **Restart audio:** recover the audio worker without restarting the web/control service; show failure rather than silently changing devices.
- **Use TONE3000:** preflight desktop/app availability, resolve pending edits, stop/release Oxidal audio, and launch the configured standalone app. A failed stop must not launch another audio owner. Keep Oxidal authoring open.
- **Return to Oxidal:** release the managed standalone audio session, explicitly choose whether to import an exported preset, then resume the validated Oxidal rig. Do not automatically terminate unrelated app instances or overwrite edits.
- **Audio devices:** refresh/inspect now; saved input/output, channels, rate/buffer selection and transactional Apply follow with the live engine.
- **Full service shutdown/restart:** separate advanced maintenance, clearly labelled as disconnecting the UI; recovery must exist outside the stopped service.

Start, Stop, Restart and Resume saved session now work through `/api/v1/audio` and Settings when the experimental worker is enabled. States distinguish unavailable, stopped, starting, running, stopping and failed. Session/revision checks reject stale commands. The supervisor owns accepted commands even if an HTTP client disconnects. Stop closes worker stdin, waits up to two seconds, then requests termination and waits again; it acknowledges release only after reaping the child. A failed stop retains ownership and blocks new probes/starts. A startup error, xrun, disconnect, nonfinite sample or two seconds without block progress fails closed without automatic fallback/restart.

The native editor and playback use separate processes, owner threads and native data roots. Playback loads one saved original/owned preset; changes to the draft or generic rig/MIDI controls do not affect it. Stop does not destroy the editor session. Resume uses the last session settings within this daemon lifetime. **Use this session on boot** explicitly saves a successfully running immutable preset and exact device configuration; the daemon makes one startup attempt on later launches. Disable boot playback to remove that preference. Subsequent session changes do not overwrite the saved boot session; disable and enable again to replace it. Missing devices, missing presets and corrupt boot settings leave the web/editor reachable with an audio error. Stop releases audio but retains the boot preference. Use TONE3000/Return to Oxidal app launching and tracking remain planned. For now, stop and wait for `stopped`, then launch the external app manually; release its interface before resuming.

Use narrowly authorized lifecycle operations and configured executables. Avoid automatic restart races and preserve an explicit user choice after app exit/failure. The browser must not acquire arbitrary service-manager or shell permissions.

## Experimental Linux playback

After the native build is available, opt in explicitly on Linux:

```sh
OXIDAL_NATIVE_EDITOR=1 OXIDAL_EXPERIMENTAL_AUDIO=1 pnpm preview
```

Open Settings, refresh devices, check the capture and playback configurations, then select a saved preset and channel numbers in Audio playback. Hardware is re-enumerated at start. Only the same duplex hardware endpoint is accepted initially; both directions must use the same rate and period length, with at most 2048 frames per block. Channel maps are zero-based in the API and one-based in the UI. Repeated input indexes duplicate mono; repeated output indexes mix L/R equally. Unselected output channels are zeroed. Different channel counts/formats per direction are allowed only if the hardware accepts both exact configurations.

`Duplex` preallocates interleaved PCM and stereo processing buffers, handles partial transfers/EAGAIN, and primes a small playback queue before starting. Its normal conversion/transport path allocates no buffers per block. This is not proof of allocation-free native DSP, scheduling deadlines, low latency or safe live performance. The native bridge remains a qualification adapter with one engine per process, not the planned general LV2 host. There is no automatic device selection or live preset switching. Boot playback is opt-in after a session has started successfully.

For a direct daemon launch, `OXIDAL_AUDIO_WORKER` must be the absolute path to a binary built with `oxidal-tone3000/audio-worker`. The daemon provisions its editor’s `native-runtime` directory itself; no development-launcher environment is required. The supervisor uses a separate `audio-runtime` folder under its preset directory for native data. That directory and the editor's isolated root are daemon-owned. HTTP clients cannot supply executables, shell commands, arbitrary PCM plugins or file paths. The public discovery/probe and health fields deliberately retain their unqualified playback flags; the separate audio lifecycle state reports experimental worker activity.

## Repeatable verification

The normal Rust workspace tests cover bounds, unlisted PCM rejection, real HTTP discovery/probe failure and unchanged rig/library availability. On Linux with the ALSA feature they also configure/release libasound's own `null` PCM in both directions across all five formats and check missing-device failure. The null plugin is internal to those tests and cannot be selected through the public API. It establishes library integration, not real device, latency, xrun or audible output qualification.

```sh
cargo test --locked --workspace --features oxidal-api/alsa
cargo clippy --locked --workspace --all-targets --features oxidal-api/alsa -- -D warnings
```

Use the pinned toolchain described in [core](core.md). These commands run in a normal Linux checkout or disposable Linux container with libasound installed; no separate test runner or physical device is required. Existing Playwright coverage checks that inspecting devices keeps the authoring UI connected. Physical acceptance must additionally cover actual USB/built-in devices, negotiated duplex settings, reconnect, channel routing, sustained streaming and performance.

On Linux, `pnpm native:check` additionally builds the `audio-qualification` worker and runs `crates/oxidal-api/tests/playback.rs`, then existing Playwright native/playback cases. The qualification feature and `OXIDAL_AUDIO_QUALIFY_NULL=1` together select ALSA null inside the test worker; neither an API request nor an ordinary `audio-worker` build can enable it. The tool only enables this override for the E2E server. The real HTTP test covers missing assets, cancelled startup clients, exclusive probe ownership, stale commands, restart/reopen, and native preset saving after stop. The browser test covers the same controls and continued authoring on desktop/mobile. Null does not model a real device clock, hotplug, buffer pressure, xruns or audible output. Hardware tests must cover those separately.

## Experimental sounding controls

The native playback worker now returns its actual preset name, tone blocks and a
bounded control catalog. The rig page shows this sounding session while it runs;
the silent example chain is hidden. Input/output level, tone stack and gate controls,
plus each loaded block's bypass, normalization, gains and mix, can be changed through
`AudioAction::SetControl`. Labels/readbacks use native values and physical gain/gate
units. Routing, model size, oversampling and pitch latency changes are excluded.

Every request uses the playback session and revision. The supervisor serializes
accepted commands, waits for matching worker readback, and rejects stale requests.
Lost replies are refreshed in the browser, never replayed. Invalid requests leave
the stream unchanged; ambiguous worker failures stop/reap the worker before giving
up its device permit. Meter updates remain independent of command acknowledgements.

These changes affect audio. `AudioAction::SaveCopy` captures the confirmed scalar
catalog and reconstructs a named native copy in a separate, non-PCM process. It
verifies the complete catalog against the source, reopens the export on a fresh
engine, checks every captured scalar, then publishes an immutable owned copy with
original-source provenance. The sounding engine and offline editor remain unchanged,
including when export/storage fails. The accepted command survives browser disconnect;
refresh its `saved_copy` identity or check Library rather than replaying a lost write.
Export has a 25-second process deadline and a bounded reply. It consumes additional
CPU/RAM; physical scheduling/overload behavior during export remains unqualified.

Saving does not change playback settings or the boot selection. Restart still loads
the starting preset; choose the new owned copy in playback settings to use it next.
Pending unapplied browser adjustments must be applied or discarded before saving.
This persists the supported scalar state of the complete native preset, not delay
buffers, arbitrary graph edits or unimplemented settings. Full settings authoring,
physical MIDI and prepared switching remain pending. Control/catalog work between
PCM steps can allocate; this is not a real-time or gapless qualification claim.

`pnpm native:check` covers actual DSP gain changes, readback and rejected mutations,
HTTP/ALSA-null session conflicts and lifecycle, and the sounding panel across the
target browser profiles, including BOOX e-paper. It also covers rendered-audio reconstruction, failed storage preserving playback, immutable originals, owned provenance and exact control reload in a new playback worker. It does not establish physical latency or xrun behavior.
