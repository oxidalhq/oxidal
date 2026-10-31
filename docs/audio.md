# Audio devices and playback lifecycle

`oxidal-audio` implements hardware discovery and exact, short-lived ALSA configuration probes. An opt-in experimental duplex transport and isolated native playback worker are also implemented; physical audio is not yet qualified. The Jogg is one qualification interface; there is no vendor whitelist. USB, built-in and board devices are discovered through Linux ALSA card/PCM enumeration. The library forbids unsafe code and uses the safe `alsa` crate around libasound.

## Run and inspect

On Linux, install `libasound2-dev` and `pkg-config` (Debian/Ubuntu package names). Normal `pnpm dev`, `pnpm preview`, `pnpm check` and artifact builds enable `oxidal-api/alsa` on Linux. Raw Cargo builds require `--features oxidal-api/alsa` to enable discovery. Other platforms return an explicit unavailable result; the optional feature keeps portable/ARM cross-compilation independent of an ALSA sysroot. A portable ARM check is not an ALSA-feature check.

Open **Settings → Audio → Audio devices → Refresh audio devices**. Select a hardware endpoint/direction and check a proposed rate, channel count, sample format, period length and period count. The check opens the PCM nonblocking, applies exact settings without resampling, reads them back and closes the handle. It never starts a stream or reads/writes samples. A busy, missing or unsupported device fails visibly without changing the rig. Input/output are checked separately; individual success does not prove simultaneous duplex or independent-clock operation.

- `GET /api/v1/audio/devices`: hardware IDs, names and capture/playback directions, plus discovery warnings. Enumeration does not open PCM streams. IDs use ALSA card names and PCM indices, not hard-coded card numbers. They are not USB serial identities and are not persisted yet.
- `POST /api/v1/audio/probe`: the generated `AudioProbe` contract; bounds are 8–192 kHz, 1–64 channels, 16–8192 frames/period and 2–8 periods. These are probe bounds, not supported live-engine limits. Formats cover signed 16-bit, 24-bit in 32-bit containers, packed 24-bit, signed 32-bit and float32 in native byte order.
- Probe requests must match a freshly enumerated hardware endpoint and direction. Arbitrary ALSA PCM expressions, file plugins, `default` and `null` are rejected by the public path. No browser-supplied command is executed.
- Blocking ALSA work runs outside the async control state. Read-only audio/MIDI enumeration shares a discovery permit and stays available during playback. Exact PCM probes use a separate ownership permit, retained by the playback supervisor until its worker is reaped. A disconnected requester does not release either permit while its blocking driver call is still running. The probe retains no interface, settings or audio buffers. Hardware driver calls are not given a hard cancellation guarantee.
- Both responses keep `streaming_available: false`; service health continues reporting `audio_available: false`. Offline native editing and library access remain independent.

Enumeration is bounded to 64 cards and 64 PCM devices per card. It covers hardware PCM subdevice zero; virtual PipeWire/JACK routes, subdevice selection and topology-dependent channel maps remain future work. Capability ranges, format recommendations, automatic duplex negotiation, device identity persistence, independent-device clock compensation, reconnect and suspend recovery remain unimplemented. Discovery alone is not PiPedal audio parity.

## Playback and authoring modes

Normal playback control stops **the audio engine**, not `oxidald`. Keep HTTP/SSE, the library, parameter editing and preset saving available while the interface is released. The offline editor must not need to own audio hardware. The supervisor and probes share one ownership gate; probing an active playback interface returns a conflict.

Controls and remaining handoff scope:

- **Stop audio / Start audio:** release or reacquire the configured interface while retaining the editor and current draft. The experimental implementation starts one explicitly selected, immutable native preset, validates device settings and waits for native readiness. It does not start the generic rig graph.
- **Restart audio:** recover the audio worker without restarting the web/control service; show failure rather than silently changing devices.
- **Use TONE3000:** preflight desktop/app availability, resolve pending edits, stop/release Oxidal audio, and launch the configured standalone app. A failed stop must not launch another audio owner. Keep Oxidal authoring open.
- **Return to Oxidal:** release the managed standalone audio session, explicitly choose whether to import an exported preset, then resume the validated Oxidal rig. Do not automatically terminate unrelated app instances or overwrite edits.
- **Audio devices:** inspect and check endpoints; apply input/output, channel maps and rate/buffer settings to the current saved-preset session with an explicit audio restart. Confirmed scalar adjustments are retained. The buffer is shown in milliseconds (period × periods at the session rate; converters and USB add a little more). Buffer sizes include 48 and 96 as well as powers of two: USB full-speed interfaces transfer in 1 ms packets, and the owner's Hotone Jogg refuses periods below 48 frames. **Find lowest stable buffer** (TONE3000, hybrid and effects sessions) steps the size down through that list, then tries fewer periods at the best size. It listens 20 seconds per step for new xruns on the shared monitor feed and reapplies the last clean setting after a dropout, a refusal or Stop test. With TONE3000 audio on its own realtime thread, the owner's Pi runs 48 × 3 (3.0 ms) cleanly at about 25% DSP; 48 × 2 collapses. It restarts audio at every step and is only ever started by the player. Capability negotiation and reconnect handling remain pending.
- **Full service shutdown/restart:** separate advanced maintenance, clearly labelled as disconnecting the UI; recovery must exist outside the stopped service.

Start, Stop, Restart and Resume saved session now work through `/api/v1/audio` and Settings when the experimental worker is enabled. States distinguish unavailable, stopped, starting, running, stopping and failed. Session/revision checks reject stale commands. The supervisor owns accepted commands even if an HTTP client disconnects. Stop closes worker stdin, waits up to two seconds, then requests termination and waits again; it acknowledges release only after reaping the child. A failed stop retains ownership and blocks new probes/starts. A startup error, disconnect, nonfinite sample or two seconds without block progress fails closed without automatic fallback/restart. Recoverable ALSA EPIPE overruns/underruns re-prime both PCM handles, discard partial transport buffers and retain DSP state and controls. Failed recovery and other device errors still fail closed. Recovery counts are written to the worker journal and exposed in monitoring and the persistent UI resource strip. The count starts at zero for each worker lifetime; unavailable telemetry shows an em dash, not zero. This recovery can produce an audible interruption and does not establish gapless playback. Native authoring/checkpoint work still shares the processing thread and must move off that path to avoid these stalls.

The native editor and playback use separate processes, owner threads and native data roots. Playback loads one saved original/owned preset; changes to the draft or generic rig/MIDI controls do not affect it. Stop does not destroy the editor session. Resume uses the last confirmed device settings and scalar adjustments. Recovery is checkpointed separately from boot playback; when boot playback is disabled, daemon startup restores the configuration without opening the interface and Resume is explicit. **Use this session on boot** captures the successfully running native, mixed or scalar-LV2 session, its confirmed scalar/model edits and exact device configuration; the daemon makes one startup attempt on later launches. One shared boot choice prevents competing owners. Disable boot playback to remove that preference. Subsequent session changes do not overwrite the saved boot session; disable and enable again to replace it. Missing devices or presets leave the web/editor reachable with an audio error; corrupt boot settings are reported separately and start no audio. Stop releases audio but retains the boot preference. Use TONE3000/Return to Oxidal app launching and tracking remain planned. For now, stop and wait for `stopped`, then launch the external app manually; release its interface before resuming.

Use narrowly authorized lifecycle operations and configured executables. Avoid automatic restart races and preserve an explicit user choice after app exit/failure. The browser must not acquire arbitrary service-manager or shell permissions.

## Experimental Linux playback

After the native build is available, opt in explicitly on Linux:

```sh
OXIDAL_NATIVE_EDITOR=1 OXIDAL_EXPERIMENTAL_AUDIO=1 pnpm preview
```

Open Settings, refresh devices, check the capture and playback configurations, then select a saved preset and channel numbers in Audio playback. Hardware is re-enumerated at start. Only the same duplex hardware endpoint is accepted initially; both directions must use the same rate and period length, with at most 2048 frames per block. Channel maps are zero-based in the API and one-based in the UI. Repeated input indexes duplicate mono; repeated output indexes mix L/R equally. Unselected output channels are zeroed. Different channel counts/formats per direction are allowed only if the hardware accepts both exact configurations.

`Duplex` preallocates interleaved PCM and stereo processing buffers, handles partial transfers/EAGAIN, and primes a small playback queue before starting. Its normal conversion/transport path allocates no buffers per block. This is not proof of allocation-free native DSP, scheduling deadlines, low latency or safe live performance. The native bridge remains a qualification adapter: independent engines can coexist on one process owner, and the [mixed worker](mixed-engine.md) now has its own isolated playback/control lifecycle; continuous-stream swaps remain unimplemented. There is no automatic device selection or live preset switching. Boot playback is opt-in after a session has started successfully.

For a direct daemon launch, `OXIDAL_AUDIO_WORKER` must be the absolute path to a binary built with `oxidal-tone3000/audio-worker`. The daemon provisions its editor’s `native-runtime` directory itself; no development-launcher environment is required. The supervisor uses a separate `audio-runtime` folder under its preset directory for native data. That directory and the editor's isolated root are daemon-owned. HTTP clients cannot supply executables, shell commands, arbitrary PCM plugins or file paths. The public discovery/probe and health fields deliberately retain their unqualified playback flags; the separate audio lifecycle state reports experimental worker activity.

## Callback timing

`process_us_p50`, `process_us_p95` and `process_us_max` describe the most recent
128 callbacks. `process_us_peak` and `deadline_misses` accumulate over the stream's
lifetime and reset only with a new stream. A miss means processing took at least
one audio period; it is separate from an ALSA xrun, since queued playback can
absorb an occasional late callback. Measurements include DSP and its internal
waits but exclude device I/O. Low average host CPU does not prove deadline headroom.

The resource strip shows current p95 and the retained session peak. Monitor also
shows the cumulative miss count. These fields remain unavailable when reading older
worker snapshots; qualification tools require the updated worker counters rather
than inferring lifetime performance from sparse rolling-window samples.

## Repeatable verification

The normal Rust workspace tests cover bounds, unlisted PCM rejection, real HTTP discovery/probe failure and unchanged rig/library availability. On Linux with the ALSA feature they also configure/release libasound's own `null` PCM in both directions across all five formats and check missing-device failure. An injected EPIPE regression also verifies capture/playback and wait recovery, discarded partial buffers, retained processing state and rejection of other device errors. The null plugin is internal to those tests and cannot be selected through the public API. It establishes library integration, not real device, latency, xrun or audible output qualification.

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

Saving does not change playback settings or the boot selection. Restart reconstructs
the starting preset with the confirmed live scalar adjustments. Choose a saved copy
explicitly to make it the immutable starting preset.
Pending unapplied browser adjustments must be applied or discarded before saving.
This persists the supported scalar state of the complete native preset, not delay
buffers, arbitrary graph edits or unimplemented settings. Full settings authoring,
physical MIDI and prepared switching remain pending. Control/catalog work between
PCM steps can allocate; this is not a real-time or gapless qualification claim.

`pnpm native:check` covers actual DSP gain changes, readback and rejected mutations,
HTTP/ALSA-null session conflicts and lifecycle, and the sounding panel across the
target browser profiles, including BOOX e-paper. It also covers rendered-audio reconstruction, failed storage preserving playback, immutable originals, owned provenance and exact control reload in a new playback worker. It does not establish physical latency or xrun behavior.

## Live adjustment and audio setup

Sounding scalar controls audition each adjustment immediately through serialized,
revision-checked worker commands. The browser coalesces drag updates to one active
request and one latest pending value. Done closes the adjustment; Save copy is
separate persistence. Cancel restores the opening value only if this client still
owns the confirmed revision. Another client's edit, stopped/recalled audio, or an
uncertain reply must never be refreshed and replayed as an overwrite. Navigating
away retains the latest audible adjustment. These controls remain limited to the
qualified scalar catalog; offline structural authoring does not yet audition in
the sounding session, and prepared model/chain transitions remain unfinished.

Settings labels expose buffer size in samples per period and buffer period count.
The checked and last playback configurations include sample rate, channel count,
format and total buffer capacity. Changing a candidate configuration, a failed
check, or device refresh invalidates the relevant prior check before a new session
can start. Those checks do not measure round-trip latency or qualify hotplug.

Confirmed scalar adjustments survive Stop → Resume and Restart during the daemon's
lifetime. A supervisor-owned startup envelope restores the complete validated
control catalog before the replacement worker opens PCM and reports readiness.
Stale/incomplete catalogs fail explicitly; there is no silent fallback to the
original sound. An explicitly selected new playback session starts from its saved
preset. Checkpointed scalar recovery also survives daemon restart as described below;
this is not full structural state restoration, boot autosave, or gapless switching. Boot selection captures a separate confirmed snapshot as documented above.

## Last-session recovery

The supervisor writes `last-audio-session.json` atomically after successful startup and confirmed scalar changes. Updates are coalesced into at most one checkpoint per two seconds during normal adjustment, with flushes on Stop and orderly daemon shutdown. The same checkpoint also rewrites the current preset's working copy in `rig-sessions/`, which a later recall of that preset restores, so edits made since the last preset switch survive a restart or power loss as well as a switch. A sudden loss of power can lose the most recent uncheckpointed changes. This file stores an immutable starting preset identity, exact device/channel/buffer configuration, model assignments and optional scalar overrides; it is not complete opaque graph state.

With boot playback disabled, startup reads and validates recovery metadata but does not open a device. Resume reconstructs the last confirmed scalar session before PCM opens. Explicit boot playback restores the confirmed snapshot captured when enabled, including native model assignments, and may establish a new last session. Failed replacements retain the previous recovery settings. Corrupt recovery is surfaced while authoring remains available; checkpoint failures keep current sound and state in memory and retry after five seconds. A failed checkpoint is never reported as a failed audio worker.

The maintained API unit tests cover bounded input, duplicate-control rejection and atomic publication. The real HTTP/process playback test additionally covers failed replacement, disk-error isolation, clean-daemon restart and explicit Resume without boot autoplay. Physical power-loss/device timing remains a hardware gate.

## Apply device settings to the current tone

Settings → Audio → Current device & buffers exposes the existing session's sample
rate, buffer size/periods and channel routing. **Apply & restart audio** interrupts
the stream, reopens it with the proposed settings and restores confirmed scalar
edits before reporting readiness. It does not recall another preset or overwrite
the offline draft. After stopping to check another duplex interface, **Use checked
interface** copies those checks into this candidate and **Apply & resume audio**
starts the same tone on it. Invalid input is rejected before releasing audio.

`AudioAction::Reconfigure` is revision-checked and supervisor-owned across browser
disconnects. A failed preparation retains the previous configuration and controls;
if the old stream was running, the supervisor attempts to restore it. A failed
rollback stays visibly failed with explicit Resume available. Successful changes
are checkpointed by session recovery; the separate opt-in boot preference is not
rewritten. This is an interrupting reconfiguration, not prepared/gapless switching.
No capability range negotiation, clock compensation or automatic fallback device
is implied. Physical device support and dropout/latency behavior remain unqualified.

## Live NAM audition and offline copies

With native playback running, each tone block offers **Change model**. The provider
picker lists entitled TONE3000 libraries with separate NAM and Cab / IR choices. NAM
model queries use architecture 2; IR queries omit that provider filter. Downloading stages
an integrity-checked asset; it does not change the sound. Closing during download
prevents that selection from being applied. The selection retains its opening
audio revision, so another client's changes cannot be overwritten silently.

The audio owner verifies cached bytes on a separate thread, then prepares the
native engine off-thread. Its supervisor polls readiness and commits to the exact
existing block. Failed preparation preserves the previous model and PCM stream.
Cancellation identifies the exact selection within its audio session. Progress
and errors appear beside the sounding controls. Add NAM and Add IR use the same preparation
path for a current insertion slot, including rigs created from Library → New preset. Both selected NAM and IR bytes are
embedded by Save; neither an active provider account nor the audition cache is needed
for the saved copy.
The supervisor supplies the exact slot position; replay preserves insertion chronology
even after replacing an earlier model. Arbitrary routing and mixed native/LV2 structural
authoring remain separate work.
The current transition uses native wet muting, **not gapless switching**.

Confirmed model assignments and scalar controls survive Stop/Resume/Restart,
current-session device Apply and daemon recovery. Save is unavailable while a
model change is pending. The isolated save worker reconstructs those assignments
before applying controls, embeds their assets, and reloads the result to verify
model identities and control values. The saved copy opens without the audition
cache or provider login. Saving a copy does not rewrite the imported original or
change the running session's configured source.

The maintained Linux native gate exercises failed/missing candidates, exact
selection cancellation, live readback, configuration/restart recovery and saved
recall after removing the audition cache. The browser scenario uses provider
transport fixtures with an actual verified asset and actual native worker; it
captures the picker across target device orientations. Real provider downloading
is checked separately. Physical audio deadlines, gapless transitions, unrestricted
model counts and artwork for newly assigned models remain separate gates.

## Shared boot selection

Native, mixed and scalar-LV2 Audio settings expose the same boot control. Enabling captures a
confirmed running session; a native working draft must first be saved and recalled.
Only one owner is selected. Stop does not disable it, later edits do not overwrite
it, and disabling it does not interrupt current audio. The control remains reachable
when another session is selected or the audio worker is unavailable. Invalid stored
settings can be cleared from the browser without opening an audio device.

`boot-audio.json` schema 2 contains one native, mixed or effects choice. Schema 1 native
records remain readable and are upgraded only on an explicit new selection. Writes
are validated, byte-bounded, atomically replaced and synced. Rejected writes preserve
the preceding published choice; policy failures are independent of playing PCM.
Daemon startup launches only the selected owner. A failed startup leaves the UI
available and does not silently select a different worker. This is session restoration,
not gapless switching, hardware hotplug negotiation or opaque LV2 state recovery.

The scalar-only LV2 owner captures settled controls, edge routing, bypass and MIDI
mappings. An active preview must finish before boot selection or device Apply.
Settings follows the sounding owner and retains it after Stop. Rate/buffer/channel
Apply reconstructs the confirmed effects session; failed preparation attempts to
restore the previous setup while retaining exclusive device ownership. If that
also fails, the previous configuration remains available for recovery and the
error is explicit. Apply on a stopped session resumes it. These operations restart
PCM and do not implement prepared or gapless replacement.

The maintained Linux LV2 gate covers real worker Apply/rollback, boot capture,
later-edit isolation, daemon restart, wrong-owner disable and unavailable-worker
recovery. Its browser scenario exercises the actual settings controls on XR,
Fold and BOOX in both orientations. Physical boot/device timing remains open.

## Direct native preset recall

Library preset buttons send `load_preset` through the audio owner, reusing the configured device, format and MIDI setup. Original and owned presets are supported. The owner retains confirmed working controls, models, EQ and captures per preset before switching, and restores them when returning. Missing sources are rejected before stopping audio; failed target startup attempts to restore the previous running session. Initial audio configuration is still required. This path restarts the native worker and is not gapless. When a preset with scenes is playing, the interface first stops that engine and waits for the device (see Presets and scenes).

## Presets and scenes

The interface uses two words. A **preset** is anything you load: one TONE3000 chain, or several running in parallel. A **scene** is a variation inside a preset (Clean, Crunch, Heavy), switched by the pads on Rig and never listed with presets. "Rig" is only the page name.

- **One list:** the Rig picker, Perform pads and Library show every preset. Presets with scenes come first and carry their scene count; `GET /api/v1/presets/rigs` returns each entry's `scenes` names in pad order.
- **One tap:** choosing a preset stops whichever engine holds the interface, waits until it is released, then starts the right one with the unit's audio setup (`apps/web/src/presetChoices.ts`). A preset with scenes that is kept ready switches without stopping.
- **Gaps:** changing scene never interrupts audio; changing preset briefly does, unless both presets with scenes are kept ready.

## Unit levels

Two unit-wide gains wrap every engine (saved preset, hybrid and effects): an input trim before the rig (−24 to +24 dB, for evening out guitars) and a master output level after it (−60 dB, which is off, to +12 dB). They live in the shared host stage (`HostSignal`), next to Hear yourself and the test tone, so no engine needs its own copy. Changes glide over about 10 ms so moves never click.

- **Store:** `unit-levels.json` in the preset directory, never in a preset. The daemon writes the stored values into the stream settings of every start, restart and recovery, so a preset switch, an engine change or a reboot keeps them.
- **API:** `GET /api/v1/levels` returns `{input_trim_db, output_level_db}`. `POST` validates the range (422 outside it, 400 for unknown fields), sends the levels to whichever engine is running through its host-utility command, then stores them. A stopped unit just stores them for the next start.
- **UI:** the Level fader sits under the preset picker on Rig (TONE3000 and hybrid), on Perform and in Settings → Audio. Its taper gives the lower quarter to −60 to −30 dB and the rest to −30 to +12 dB, in 0.5 dB steps. Arrow keys move 1 dB. While a request is in flight only the newest value waits. A daemon without levels hides the fader.

## Scene change: trails or blend

Presets with scenes feed each lane through its own input gate and keep every lane's output open at the merge, so a scene change normally **trails**: the outgoing lane stops getting guitar at once while its delay and reverb ring out over the new scene.

- **Blend:** the Scene change control in the scene pads heading switches a preset to blend. The incoming scene still opens at the preset's own short fade; gains that close ramp over the blend time instead (0.5–10 s), so the whole outgoing scene fades out. `SceneCommand.release_ms` carries the release; the engine rejects more than 10 s.
- **Store and API:** `blends.json` in the preset directory, by the preset's stable id. `GET`/`POST /api/v1/scene-blends {preset, blend_ms}` (0 returns the preset to trails). The daemon adds the playing preset's blend to every scene command it forwards that does not set its own release.
- **Not yet:** MIDI scene changes inside the worker use the preset's own fade until physical MIDI forwards through the daemon; a hard cut that also silences the outgoing tails.

## Even out all

One button (Library → Even out all) brings every preset and every scene to the same loudness, so switching never jumps.

- **Reference riff:** the host stage plays a built-in riff (Karplus–Strong plucked strings: power chords, palm-muted chugs and single notes, four seconds, identical on every unit) into the rig in place of the guitar, at the reference guitar's measured strum peak plus its trim, or −12 dBFS when no guitar is measured. Trim and gate are skipped: the riff stands for a guitar after its trim.
- **Measurement:** ITU-R BS.1770 K-weighted loudness of the rig's output, before Level, Boost and Mono, over three seconds after one settling second. The host mutes its output while the riff plays, so a run is silent.
- **Run:** the daemon lists visible originals, saved copies, every scene of every preset with scenes and every preset with effects as a whole, skips anything whose content (original or copy hash, scene preset revision) was already measured, and loads and measures the rest one by one (about four seconds each). A preset that fails to load or play is reported and skipped. Afterwards it restarts exactly what was playing, including a scene preset's unsaved edits and its scene.
- **Offsets:** the target is the median of all measurements, so the unit stays about as loud as before; each preset or scene gets target − measured, in 0.5 dB steps within ±12 dB. Offsets are stored in `calibration.json` and applied at the host output with the boost (`boost_db` = offset + boost, within ±24 dB).
- **API:** `GET /api/v1/calibration` (target, entries with offsets, progress); `POST {action}` with `run`, `run_all`, `cancel` or `reset`.
- **Not yet:** recording your own riff instead of the built-in one, and rendering faster than real time.

## Boost

A boost is deliberate extra level for a solo preset or scene, on top of the evened-out level: −12 to +12 dB in 0.5 dB steps. It is set from the **Boost** button beside Level on Rig, with one row for the preset and, for a preset with scenes, one for the sounding scene; they add up.

- **Store and API:** `boosts.json` in the preset directory, never inside presets, so originals stay untouched. Keys: `tone3000:original:<sha256>`, `tone3000:copy:<id>`, `scenes:<preset id>` and `scenes:<preset id>#<scene id>` (the preset id is stable across saved revisions). `GET /api/v1/boosts` returns the boosts, the playing keys and the applied total; `POST {key, boost_db}` sets one (0 removes it).
- **Applying:** after every confirmed TONE3000 or scenes command (preset load, start, switch, scene), the daemon works out what is playing and sends the total as `boost_db` in the unit levels. The host output applies Level + boost through the same 10 ms glide, so a scene change and its boost land together without a click. Commands answer with the state after the boost, so views never hold a stale revision.
- **Ownership:** views cannot set `boost_db` through `POST /api/v1/levels`; the daemon keeps the playing preset's value.

## Guitar profiles

Guitars with different pickups hit the rig at different levels, which changes both loudness and how hard a capture is driven. Each guitar profile stores a plain input trim (`trim_db`, −24 to +24 dB in 0.5 dB steps) applied before every rig when that guitar is chosen, for example +4 dB for a guitar with quieter pickups.

- **Trim:** Guitars → Trim opens − / + buttons and a slider; changes apply live to the guitar that is playing.
- **Measure strum (optional):** listens for six seconds on the shared monitor feed, using the raw input meter (which reads before the trim). The first guitar measured becomes the reference; later guitars get trim = reference peak + reference trim − this peak. Silence below −60 dBFS is refused; a peak above −1 dBFS warns about interface clipping.
- **Pickups:** a profile is per guitar because the unit cannot see the pickup selector. Set the trim on the pickup played most and measure noise on the noisiest one. A guitar whose positions differ a lot can have one profile per position (for example "Jericho · neck").
- **Switch:** Perform shows one button per guitar once two exist. MIDI and footswitch selection wait for physical MIDI.
- **Store and API:** `guitars.json` in the preset directory, never in presets. `GET`/`POST /api/v1/guitars` (up to 16 guitars, names of 1–40 characters). Saving applies the active guitar's trim and gate to a running engine and stores them in the unit levels. Files from before per-guitar trims (reference peak and character) are converted on load to the trims they produced.
- **Noise gate:** Guitars → Gate → Measure noise listens for six seconds with the strings muted and stores the raw noise peak (`noise_dbfs`). Anything above −30 dBFS is refused as playing. The guitar's gate then opens at noise + trim + 6 dB (rounded, clamped to −96…−20 dBFS) and closes 6 dB lower, after the trim and before every engine. It opens within about 1 ms, holds 50 ms and fades over about 80 ms; Gate on/off turns it off per guitar. It is sent as `gate_db` in the unit levels and adds nothing to the rig's own gate.
- **Ownership:** while a guitar is active, the guitar store owns `input_trim_db` and `gate_db`. A `POST /api/v1/levels` from a view holding older levels changes the master level and Mono only.
- **Not yet:** tone tilt per guitar.

## Preset level matching

TONE3000 blocks already normalise each capture (Normalize on), but a whole preset's loudness still depends on block gains, EQ and IRs. **Preset actions → Match level…** evens out presets:

1. Play the way you would on stage for eight seconds. Readings count only while the raw input peaks above −50 dBFS.
2. Oxidal averages the output RMS as power (not dB) and removes the master Level, so the fader position never skews the match.
3. It proposes the preset's own Output level so the preset averages −18 dBFS. Apply commits it like any edit; Save keeps it in the preset.

Output level covers ±24 dB; a preset beyond that is set as close as it goes and says so. Hybrid and effects rigs have no rig-wide output control yet, so matching is TONE3000-only for now. The order of gain staging is: interface gain set once → guitar profile → capture normalise → preset match → Level.

## Mono output and performance knobs

**Mono** beside Level sums left and right after the Level, as a mono PA would. Use it to check that a wide rig (Spread, Alignment, panned chains) does not thin out or cancel in mono, or leave it on for a mono rig. It is stored with the unit levels (`mono` in `unit-levels.json`), so it survives presets and restarts. A warning for rigs that lose level in mono needs a measured correlation and is not built yet.

The Rig and Perform views show five performance knobs above the chain for TONE3000 rigs: Gain (rig Input level), Bass, Mid and Treble (the rig tone stack, marked inactive while Tone stack is off) and Amount (the selected block's mix). Tap a knob to adjust it in the slider dialog, where the value is large enough to read on a phone. These five save with the preset; Level and Mono below them are unit-wide.

## Realtime scheduling

Each audio worker calls `oxidal_audio::realtime::enter()` first in `main`: `mlockall` plus `SCHED_RR` priority 90 for the audio thread, the setup PiPedal uses. Threads the native engine starts afterwards inherit it; the JSON and pipe helper threads drop back to normal priority with `leave()`. The worker journal records the outcome (`realtime: SCHED_RR 90; memory: locked`, or which service limit is missing). The service grants `LimitRTPRIO=95` and `LimitMEMLOCK=infinity`, and sets every CPU to the `performance` governor before starting (an `ExecStartPre=+` step), so clock ramping cannot delay a block. Without these, audio runs at normal priority and small buffers xrun under ordinary load. On the owner's Pi, 64 × 4 showed 383 xruns at normal priority, where PiPedal runs 16 × 4.

The mixed worker polls and reconnects MIDI devices outside the shared rig lock.
Only dispatching an actual MIDI message takes that lock. Enumerating an absent
controller can take several milliseconds every two seconds; holding the rig
during those retries can starve PCM even when average CPU and RAM use are low.
Qualification must include a configured but disconnected controller alongside
large scene rigs, with unchanged buffer settings and separate startup, steady
playback and scene-transition xrun counts.

Worker requests (state readback, authoring, EQ, model steps) run between blocks on the same realtime thread. Two rules keep them inside a period. First, the daemon polls an open adjustment once a second (its expiry is 120 s); only the tuner and measurements poll every 100 ms. Second, the TONE3000 worker caches the control catalog, slots and EQ: quiet polls and inspections reuse them, previews re-read controls only, and any edit, model step or MIDI CC invalidates them. A request that takes longer than one period logs `Slow <kind> request on the audio thread`. On the owner's Pi, an open adjustment previously caused 10 xruns per second at 64 × 4.

Knob adjustments (gestures) keep their undo checkpoint off the audio thread. Commit captures the engine state, then a normal-priority `oxidal-history` thread hashes, writes and fsyncs it; the worker adopts the receipt before its next request. A failed background write keeps the adjustment and reports a history error. Synchronous checkpoints (structural edits, Undo/Redo, measurements, model splices) wait for pending background writes first, so receipts stay in order. Cancel puts back only the adjusted control, and gesture begin reads the control list once. Measured at 64 × 4 on the owner's Pi: a real commit dropped from 118 ms to about 6 ms. Begin, cancel and commit each still cost about 5–6 ms (native control list about 1.5 ms, parameter catalog about 1.7 ms, state capture about 1.1 ms), one xrun each at 64 × 4. Undo stays synchronous at about 280 ms. Removing the rest needs the realtime handoff: audio processing on its own thread while the JUCE owner thread serves control and state calls (see native-tone3000.md, "State, threads and bounds").
