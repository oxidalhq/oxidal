# Architecture and control contract

The Rust workspace has five crates with concrete jobs: `oxidal-graph` validates routing, `oxidal-control` owns commands/state/MIDI mappings, `oxidal-api` serves HTTP/SSE and the daemon, `oxidal-nam` owns bounded inference, and `oxidal-presets` inspects and stores immutable native preset originals. Full asset/catalog management and native ALSA/LV2 hosting are later layers; no empty crates imply they exist today.

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

MIDI mappings persist with atomic file replacement. Rig/parameter/bypass state resets on restart in this PoC. Power-loss durability, migration, catalog storage, and backups remain appliance work. Storage/HTTP/JSON happen in the control plane, not an audio callback; no real-time audio thread exists yet.

The service accepts loopback listeners and loopback browser origins only. It does not expose LAN writes, provider login, arbitrary privileged commands, or a physical MIDI port. Pairing/authorization and target-device permissions must be designed before LAN/hardware operation. The staged systemd unit is not enabled by the OS recipe.

Public package licensing and namespace checks are pending owner/release decisions. Cargo packages are unpublished; third-party Rust licenses/advisories are checked without assigning a new license to the owner's code.

## Owned control previews

`Action::Edit` provides `begin`, `preview`, `commit` and `cancel` for the current PoC numeric controls. Begin requires the current session and revision, a fresh token and an editor owner ID. One target can be previewed at a time. Ownership IDs prevent accidental cross-client edits; they are not authentication and do not authorize LAN exposure. The token is not broadcast in snapshots. `Snapshot.edit` exposes the owner/target so other editors can disable conflicting controls.

Preview/commit requests carry strictly increasing sequence numbers. A terminal commit sends the exact final value, independent of dropped/coalesced intermediate previews. The browser queue retains at most one in-flight request and one replacement preview. Cancellation waits behind in-flight work and restores only that target's baseline; other parameter changes survive. The daemon retains 32 terminal receipts: identical repeated commits and late cancels leave revision/state unchanged, while changed or stale terminal requests fail. Tokens must never be reused. No automatic retry/replay of failed edits occurs.

Ordinary web writes to an owned target are rejected. MIDI mapped to that target supersedes the preview; routing/preset replacement also cancels it before applying the new state. Old commits/cancels cannot overwrite that new state. Unrelated controls remain available. Mapping changes retain their existing revision/persistence rules.

A 30-second monotonic idle lease rolls back abandoned previews, refreshes MIDI feedback and publishes an SSE snapshot. The daemon checks expiration before commands and every 250 ms. Navigation requests cancellation; a lost tab/network cannot strand ownership indefinitely. A surviving editor retains its local draft after disconnect/expiry but requires explicit reopening rather than replay. Snapshot/status reads remain available during edits.

This ports transaction policy into the shared control plane, **not native TONE3000 block DSP or opaque-state capture**. No editable imported preset or audio processing is implied. The future native adapter must bind these semantics to instance/rig identity and readiness, capture final state once, keep model-size changes staged, and qualify native failure/rollback. These are remaining integration gates, not behaviours supplied by this UI alone.

## Preset interchange contract

The [draft preset format](presets/format.md) defines a versioned JSON manifest, preserved native TONE3000 payloads and separate Oxidal/LV2 state. [Its JSON Schema](presets/manifest.schema.json) and examples are checked with `pnpm presets:check`. This is a draft design contract; the runtime now provides bounded structural native inspection and immutable original storage, but `.oxpreset` authoring, export/sync eligibility, conversion and audio fidelity remain unimplemented.

## Native original library

`oxidal-presets` reads legacy `T3KB` and current `T3KH` JUCE ValueTree framing. It validates schema 1, header/body identity, unique sections/parameter/block IDs, finite numbers and bounded binary structure. It rejects trailing data and malformed/truncated lengths. Unknown native fields remain in the untouched original, not in a lossy reconstructed file. Successful inspection is **not** semantic qualification of unknown DSP settings or embedded models. `playback_available` is always false; import and download cannot mutate the active rig.

Parsing and filesystem operations run on blocking workers behind a separate store mutex, never the control-state mutex or an audio callback. The store admits 32 MiB per file, 128 originals and 256 MiB total. Structural limits are 64 nesting levels, 65,536 nodes/values per tree and 1 MiB strings; identifiers have tighter limits. Files use full lowercase SHA-256 names, never upload names or user paths. Each read checks regular-file status, framing and content hash. Corrupt entries fail visibly rather than disappearing from the list. A private, daemon-owned storage directory is required; this is not a defense against another process concurrently altering that directory.

A successful write syncs a temporary file and publishes it through a same-filesystem, no-clobber hard link. Reimporting identical bytes retains one original; failure does not overwrite an existing original. This has process-restart coverage, but directory sync/power-loss durability, multi-daemon writers, deletion and library migrations remain unqualified. Local filesystems must support hard links. Interrupted temporary files are excluded from listings. The service retains its loopback/origin restrictions; no provider credentials or cloud submission are involved.
