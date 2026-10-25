# Architecture and control contract

The Rust workspace starts with four crates that have concrete jobs: `oxidal-graph` validates routing, `oxidal-control` owns commands/state/MIDI mappings, `oxidal-api` serves HTTP/SSE and the daemon, and `oxidal-nam` owns bounded inference. Asset/catalog storage and native ALSA/LV2 hosting are later layers; no empty crates imply they exist today.

Rust serde/schemars wire types generate JSON Schema and TypeScript. Browser payloads are runtime-validated with Ajv; `pnpm contract:check` fails if regenerated files differ. The transport is versioned JSON commands plus SSE snapshots for the first slice. SSE is adequate for daemon-to-browser state; WebSocket remains available when a measured bidirectional-stream need arises.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/health` | Protocol/build version, audio unavailable, MIDI simulator enabled/disabled |
| `GET /api/v1/state` | Authoritative session/revision snapshot, parameters/actions, rig, mappings, latest feedback |
| `GET /api/v1/events` | SSE `state` snapshots, including a fresh snapshot on reconnect; bounded watch channel coalesces intermediate revisions |
| `POST /api/v1/commands` | Typed command envelope: protocol, session, request ID, expected revision or null, action |
| `POST /api/v1/rig/validate` | Bounded generic graph validation; does not instantiate a plugin or run sound |

All commands require the current daemon session. Structural changes (routing, mappings, preset selection) require a matching revision; continuous changes are serialized and may omit it. Relative edits operate on current state. A daemon restart creates a new session, so a stale edit cannot accidentally match a reset revision. Browser controls render confirmed state and disable on disconnect. Failed commands do not change state. Routing application currently accepts the PoC block identities; generic validation does not imply arbitrary audio layouts are hosted.

MIDI is currently a typed simulator transport, enabled explicitly with `OXIDAL_SIMULATOR=1`. It supports absolute CC, configured two's-complement relative CC, range/linear or logarithmic scaling, pickup, bypass, two example presets, learn, and optional feedback. The web editor currently replaces one mapping; the API persists up to 32. Input and feedback use distinct route identities (`simulator` / `simulator:feedback`) and feedback routes cannot be ingested as input. This proves simulator loop isolation, not that a real controller's echo behavior has been qualified. PC, notes, DIN/USB byte parsing, device profiles, and physical feedback remain hardware work.

MIDI mappings persist with atomic file replacement. Rig/parameter/bypass state resets on restart in this PoC. Power-loss durability, migration, catalog storage, and backups remain appliance work. Storage/HTTP/JSON happen in the control plane, not an audio callback; no real-time audio thread exists yet.

The service accepts loopback listeners and loopback browser origins only. It does not expose LAN writes, provider login, arbitrary privileged commands, or a physical MIDI port. Pairing/authorization and target-device permissions must be designed before LAN/hardware operation. The staged systemd unit is not enabled by the OS recipe.

Public package licensing and namespace checks are pending owner/release decisions. Cargo packages are unpublished; third-party Rust licenses/advisories are checked without assigning a new license to the owner's code.

## Preset interchange contract

The [draft preset format](presets/format.md) defines a versioned JSON manifest, preserved native TONE3000 payloads and separate Oxidal/LV2 state. [Its JSON Schema](presets/manifest.schema.json) and examples are checked with `pnpm presets:check`. This is a draft design contract; native decoding, export/sync eligibility, conversion and audio fidelity are not implemented by the schema checks.
