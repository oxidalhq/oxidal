# Architecture and control contract

Oxidal separates its browser and control plane from the process that owns the audio
interface. `oxidal-api` serves the web application and versioned API; the graph,
control, preset, NAM and audio crates provide reusable routing, state, storage,
inference and device services. Blocking storage and device work stays outside the
audio callback.

`oxidal-engine` owns native and LV2 processors in one prepared directed graph. The
daemon supervises it through the isolated rig-audio worker, and the browser uses
confirmed worker state for live authoring, scenes, MIDI, levels and recovery. See
[mixed engine boundaries](mixed-engine.md) for DSP qualification, preserved effect
histories and the remaining compatibility work.

`oxidal-tone3000` contains the single-owner native FFI boundary and supports native
preset inspection, editing and playback. `oxidal-lv2` provides the bounded plugin
host used by effect-only and mixed rigs. Both integrations have pinned inputs and
their own qualification gates. Physical device coverage and real-time scheduling
across supported hardware remain active work.

Rust serde/schemars wire types generate JSON Schema and TypeScript. Browser payloads are runtime-validated with Ajv; `pnpm contract:check` fails if regenerated files differ. The transport is versioned JSON commands plus SSE snapshots for the first slice. SSE is adequate for daemon-to-browser state; WebSocket remains available when a measured bidirectional-stream need arises.

| Endpoint                                | Behavior                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                    | Protocol/build version, audio unavailable, MIDI simulator enabled/disabled                                             |
| `GET /api/v1/state`                     | Authoritative session/revision snapshot, parameters/actions, rig, mappings, latest feedback                            |
| `GET /api/v1/events`                    | SSE `state` snapshots, including a fresh snapshot on reconnect; bounded watch channel coalesces intermediate revisions |
| `POST /api/v1/commands`                 | Typed command envelope: protocol, session, request ID, expected revision or null, action                               |
| `GET /api/v1/presets`                   | List structurally inspected originals; does not assert playback compatibility                                          |
| `POST /api/v1/presets`                  | Import raw native preset bytes, up to 32 MiB; deduplicate by SHA-256                                                   |
| `GET /api/v1/presets/{sha256}/original` | Download the byte-exact original as an attachment                                                                      |
| `POST /api/v1/rig/validate`             | Bounded generic graph validation; does not instantiate a plugin or run sound                                           |

All commands require the current daemon session. Structural changes (routing, mappings, preset selection) require a matching revision; continuous changes are serialized and may omit it. Relative edits operate on current state. A daemon restart creates a new session, so a stale edit cannot accidentally match a reset revision. Browser controls render confirmed state and disable on disconnect. Failed commands do not change state. Routing application currently accepts the PoC block identities; generic validation does not imply arbitrary audio layouts are hosted.

MIDI is currently a typed simulator transport, enabled explicitly with `OXIDAL_SIMULATOR=1`. It supports absolute CC, configured two's-complement relative CC, range/linear or logarithmic scaling, pickup, bypass, two example presets, learn, and optional feedback. The web editor currently replaces one mapping; the API persists up to 32. Input and feedback use distinct route identities (`simulator` / `simulator:feedback`) and feedback routes cannot be ingested as input. This proves simulator loop isolation, not that a real controller's echo behavior has been qualified. PC, notes, DIN/USB byte parsing, device profiles, and physical feedback remain hardware work.

MIDI mappings persist with atomic file replacement. Rig/parameter/bypass state resets on restart in this PoC. Power-loss durability, migration, catalog storage, and backups remain appliance work. Storage/HTTP/JSON happen in the control plane, not an audio callback; the experimental playback process owns its synchronous PCM loop, without a real-time scheduling guarantee.

The daemon accepts loopback listeners and loopback browser origins only. The experimental appliance puts nginx in front of it with per-device HTTPS and password authentication on every UI/API/event request, plus an explicit external Host/Origin allowlist before forwarding. The personal CA key remains outside the image. The image builder enables an unprivileged systemd daemon with audio-group access; staging alone does not activate services. See [OS build and access](../os/README.md). Provider device-code login and explicitly enabled maintenance PTYs use separate service boundaries; physical MIDI remains unqualified. This prototype uses generated device credentials rather than a browser pairing/revocation flow.

Public package licensing and namespace checks are pending owner/release decisions. Cargo packages are unpublished; third-party Rust licenses/advisories are checked without assigning a new license to the owner's code.

## Owned control previews

`Action::Edit` provides `begin`, `preview`, `commit` and `cancel` for the current PoC numeric controls. Begin requires the current session and revision, a fresh token and an editor owner ID. One target can be previewed at a time. Ownership IDs prevent accidental cross-client edits; they are not authentication and do not authorize LAN exposure. The token is not broadcast in snapshots. `Snapshot.edit` exposes the owner/target so other editors can disable conflicting controls.

Preview/commit requests carry strictly increasing sequence numbers. A terminal commit sends the exact final value, independent of dropped/coalesced intermediate previews. The browser queue retains at most one in-flight request and one replacement preview. Cancellation waits behind in-flight work and restores only that target's baseline; other parameter changes survive. The daemon retains 32 terminal receipts: identical repeated commits and late cancels leave revision/state unchanged, while changed or stale terminal requests fail. Tokens must never be reused. No automatic retry/replay of failed edits occurs.

Ordinary web writes to an owned target are rejected. MIDI mapped to that target supersedes the preview; routing/preset replacement also cancels it before applying the new state. Old commits/cancels cannot overwrite that new state. Unrelated controls remain available. Mapping changes retain their existing revision/persistence rules.

A 30-second monotonic idle lease rolls back abandoned previews, refreshes MIDI feedback and publishes an SSE snapshot. The daemon checks expiration before commands and every 250 ms. Navigation requests cancellation; a lost tab/network cannot strand ownership indefinitely. A surviving editor retains its local draft after disconnect/expiry but requires explicit reopening rather than replay. Snapshot/status reads remain available during edits.

This generic control path is separate from native TONE3000 block DSP. The optional native editor below now captures native state on final commit, restores it on cancel/expiry, and checks native readiness. Unifying physical MIDI, per-block gestures and model-size staging with the live graph remains required; the generic UI alone does not provide that integration.

## Preset interchange contract

The [draft preset format](presets/format.md) defines a versioned JSON manifest, preserved native TONE3000 payloads and separate Oxidal/LV2 state. [Its JSON Schema](presets/manifest.schema.json) and examples are checked with `pnpm presets:check`. This is a draft design contract; the runtime now provides bounded structural native inspection and immutable original storage, but `.oxpreset` authoring, export/sync eligibility, conversion and audio fidelity remain unimplemented.

## Native original library

`oxidal-presets` reads legacy `T3KB` and current `T3KH` JUCE ValueTree framing. It validates schema 1, header/body identity, unique sections/parameter/block IDs, finite numbers and bounded binary structure. It rejects trailing data and malformed/truncated lengths. Unknown native fields remain in the untouched original, not in a lossy reconstructed file. Successful inspection is **not** semantic qualification of unknown DSP settings or embedded models. `playback_available` is always false; import and download cannot mutate the active rig.

Parsing and filesystem operations run on blocking workers behind a separate store mutex, never the control-state mutex or an audio callback. The store admits 32 MiB per file, 128 originals and 256 MiB total. Structural limits are 64 nesting levels, 65,536 nodes/values per tree and 1 MiB strings; identifiers have tighter limits. Files use full lowercase SHA-256 names, never upload names or user paths. Each read checks regular-file status, framing and content hash. Corrupt entries fail visibly rather than disappearing from the list. A private, daemon-owned storage directory is required; this is not a defense against another process concurrently altering that directory.

A successful write syncs a temporary file and publishes it through a same-filesystem, no-clobber hard link. Reimporting identical bytes retains one original; failure does not overwrite an existing original. This has process-restart coverage, but directory sync/power-loss durability, multi-daemon writers, deletion and library migrations remain unqualified. Local filesystems must support hard links. Interrupted temporary files are excluded from listings. The service retains its loopback/origin restrictions; no provider credentials or cloud submission are involved.

## Optional native preset editor

`GET /api/v1/native` reads the worker snapshot; `POST /api/v1/native` accepts the generated `EditorCommand` contract. Both return 503 when the optional worker is unavailable. Health includes `native_editor`; `audio_available` stays false. The worker is enabled explicitly with an absolute `OXIDAL_NATIVE_WORKER` executable and an isolated native data directory. `OXIDAL_NATIVE_EDITOR=1 pnpm preview` configures both for local review.

The [native editor lifecycle](native-tone3000.md) keeps JUCE on the worker main thread, bounds IPC, validates original bytes before native loading, gates readiness, preserves global settings and saves immutable owned tone copies. A failed/unknown IPC outcome disables the worker without replay. Source originals retain their exact bytes. This workflow is independent of the existing simulated rig/MIDI controls; five native per-block controls and capability-gated commit-only NAM size now share offline ownership/rollback/persistence, while physical MIDI, full settings parity, mixed rigs and live graph editing remain explicit integration work.

## Audio-device inspection

The optional Linux ALSA backend adds hardware discovery and exact non-streaming configuration checks through `/api/v1/audio/devices` and `/api/v1/audio/probe`. Their types belong to the generated contract. Blocking work is serialized outside the async control state; health still reports audio unavailable. See [audio devices and lifecycle](audio.md), including implemented experimental engine stop/start independent of the web/editor service. `GET /api/v1/audio` reports lifecycle state and `POST /api/v1/audio` accepts typed Start/Stop/Restart commands. One actor owns the worker and shared device permit; browser cancellation does not release ownership. The generic rig and imported-preset capability flags remain unqualified, even when the separate experimental session is running.

## Experimental graph playback API

`GET/POST /api/v1/graph-audio` controls the optional isolated LV2 worker. Its lifecycle session/revision is separate from the worker's shared-control snapshot; native values and processed frame counts come from the worker. The saved-preset player, graph player and hardware probes share one device permit, held until reaping. The browser `/state` and `/commands` remain the simulator; they do not silently retarget an audible graph. See [LV2 hosting](lv2.md) for commands, restart defaults, isolation limits and the repeatable Linux HTTP/PCM test gate.

## Device administration

The optional `oxidal-device` crate owns bounded Unix IPC and recoverable NetworkManager operations, separated from the unprivileged HTTP/audio service. See [device service](device-service.md) for the implemented network workflow, privilege boundary, tests and remaining v1 requirements.

The native player's `AudioAction::SetControl` now reaches the sounding worker and
returns confirmed controls through `AudioState`. The main rig view uses those real
blocks while native playback runs. The generic `/state` simulator and offline editor
retain separate identities; their commands do not target live audio. See
[audio controls](audio.md#experimental-sounding-controls) for the supported scalar
controls, failure policy and remaining authoring/real-time limits.

`AudioAction::SaveCopy` reconstructs the immutable source plus the confirmed scalar
catalog in a separate export process. It never sends export/file work into the
sounding processor and never loads over the offline editor's draft. Fresh-engine
reload validates the native copy before atomic owned-store publication. The playback
actor serializes the capture against controls; save failure does not mark audio
failed or change its device ownership. See the audio document for process deadlines,
resource overhead, lost-response recovery and the explicit restart/boot-selection boundary.
