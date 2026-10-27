# Linux LV2 host

The optional `oxidal-lv2/native` feature uses Lilv to discover and instantiate installed LV2 bundles. Default workspace builds remain portable and do not link Lilv. Native builds require Linux, a C compiler, pkg-config, liblilv-dev and lv2-dev; cross compilation is not yet supported.

## Supported boundary

- Fixed power-of-two blocks of 1–2048 frames at 8–192 kHz.
- Mono input/output plugins use two independent instances to preserve stereo histories. Stereo input/output plugins use one instance.
- Bounded scalar input controls retain native ranges, integer/toggle properties and logarithmic scaling. Finite scalar outputs can be read back.
- Stable URID map/unmap, sample-rate and block-size options are delivered during instantiation. Required unknown features/options fail before instantiation.
- Unsupported ports, asymmetric channel layouts, reported latency, missing control ranges, Atom/CV, worker scheduling and opaque plugin state fail closed. This is a deliberately limited general plugin host, not full LV2 compatibility.
- Instances and their discovery world have one thread owner. Port metadata is immutable after preparation. Buffers are prepared before processing; the successful host processing path does not allocate. Plugin allocation and real-time safety still require individual qualification.
- Nonfinite plugin audio silences the block and poisons the instance until recreation. Native plugin crashes are not contained by this library: installed plugins are trusted code. A separate process boundary is required before exposing arbitrary plugins to playback.
- Plugin ports that require reactivation or other lifecycle actions are not qualified by scalar readback alone.

Feature behavior follows the LV2 [buffer-size](https://lv2plug.in/ns/ext/buf-size), [options](https://lv2plug.in/ns/ext/options) and [URID](https://lv2plug.in/ns/ext/urid) specifications.

## Repeatable qualification

On Debian/Ubuntu install `liblilv-dev lv2-dev swh-lv2`, then run `pnpm lv2:check`. Linux CI runs the same command. `OXIDAL_LV2_EXTERNAL_DIR` can override the default `/usr/lib/lv2` external bundle directory. Missing external fixtures fail the test rather than silently skipping it.

The suite checks feature delivery with a project-authored contract plugin and renders the independently installed SWH amplifier and delay. It verifies native gain, exact impulse delay and separate left/right histories, invalid ports/values, feature rejection, world lifetime and nonfinite-output containment. The contract plugin is infrastructure evidence, not musical-effect fidelity evidence.

These tests do not qualify physical audio, real-time deadlines, reverb, TONE3000 LV2 preset parity, whole-graph replacement/trails, or physical MIDI devices. The existing native TONE3000 playback worker remains separate. The graph worker below connects this library to its own PCM loop and daemon API; the browser installed-effects flow controls the real graph worker; the development simulator remains separate.

## Prepared graph and control bridge

`PreparedGraph` validates a bounded DAG (up to 64 nodes and 128 edges), then instantiates explicitly bound LV2 nodes and prepares stereo buffers. Input/output nodes and LV2 nodes are supported; conceptual NAM/delay/reverb nodes are not silently replaced with plugins. Every node's legacy `level` field must be unity; gain comes from explicit plugin controls. Fan-in sums paths at unity without automatic normalization or clipping. Choose gains accordingly. Nonfinite sums or plugin output silence the block and require graph recreation.

The graph uses `oxidal-control` for normalized parameters, revisions, owned preview/commit/cancel, expiry, MIDI pickup/relative values and feedback. Native input port values are read back after integer/toggle quantization; confirmed normalized values and MIDI feedback follow that readback. MIDI here means injected, validated control messages; it does not imply physical USB/DIN transport or LV2 Atom MIDI support.

Commands and edit expiry run **between blocks on the same owner**, outside the real-time callback. They allocate and are not an audio-thread command queue. Successful block processing uses prepared buffers. Routing edits may change edges between the same ordered nodes while retaining plugin histories. Node addition/removal/replacement requires a newly prepared graph and is rejected by the live edge-edit path. Rejected commands leave the current revision, routing and controls unchanged; unexpected native write failure poisons the graph rather than publishing partial success.

Global bypass returns dry input while processing silence through the effects, draining their histories silently. It is not a wet-tail preservation or gapless preset-switching implementation. There is no gain smoothing or sample-accurate control scheduling yet. A caller must poll edit expiry between blocks; it is not tied to an autonomous timer in this library.

`pnpm lv2:check` also covers serial/parallel rendered outputs, route edits with retained histories, failed replacement preparation, shared MIDI/web ownership and stale revisions, edit expiry, dry bypass, discrete native readback/feedback, nonfinite-output containment, and mapped MIDI gain changes through the independently installed SWH amplifier. This is control-to-DSP integration coverage; browser E2E also exercises real installed-effect creation, audible-worker adjustments and saved graph recall. The same qualification command also runs the real graph-worker HTTP/ALSA-null tests described below.

Next integration steps are a real-time-safe control handoff, plugin state/assets, smoothing/switching/trails and physical MIDI/audio qualification. No hardware availability flag is enabled by this library.

## Isolated experimental graph playback

Build `cargo build --locked -p oxidal-lv2 --features worker --bin oxidal-graph-worker` on Linux. Build the daemon with `--features oxidal-api/alsa`, set `OXIDAL_GRAPH_WORKER` to the absolute worker executable, and run `oxidald`. The daemon links only the portable graph protocol; Lilv and plugin libraries load in the child process. Discovery uses the worker's installed LV2 search path (`LV2_PATH` when configured by the operator), never a client-supplied bundle path. Native plugins remain trusted code: process isolation contains crashes, not arbitrary filesystem/system access.

`GET /api/v1/graph-audio` reports lifecycle session/revision, phase, configured graph, current worker control snapshot, native input values, processed frame count and device ownership. `POST` accepts a `GraphAudioCommand` from the generated contract:

- `start` carries `settings`: an exact `stream` configuration, validated `rig` with input/LV2/output nodes, and one `{node, uri}` binding per LV2 node. Start acknowledges after PCM has processed the priming blocks.
- `control` carries the ordinary `Command`, using the worker control snapshot's session/revision. Set/adjust, owned editing, mappings, injected MIDI, bypass and edge-only routing execute in that worker. Injected MIDI is permitted only when the daemon simulator capability is enabled; physical MIDI transport remains pending.
- `stop` closes worker input, requests EOF shutdown, and acknowledges only after the child has been reaped and the shared audio-device permit released. A timeout escalates to process termination while retaining ownership until reaping.
- `restart` reopens the last confirmed graph with its scalar values, global bypass, MIDI mappings and routes, using a fresh control session. Settled edits survive without Save. An unfinished gesture is excluded from restart recall. Stop retains the last readback for inspection; stopped graph controls cannot be edited through the playback API yet. Plugin delay/reverb histories and opaque state are not restored. Changed/missing controls reject recall before PCM opens.

Every lifecycle request includes the outer lifecycle session and expected revision. Control snapshots have their own revision, so periodic frame-count updates do not invalidate otherwise current commands. Failed commands never automatically retry. A timeout or malformed/closed worker reply terminates and reaps the worker before restart is allowed. HTTP disconnect does not cancel an already accepted operation. Playback, saved-preset playback and audio probing share one semaphore; competing device operations reject before spawning/opening another stream. Graph failure or Stop leaves the library, simulated rig, HTTP service and separate native authoring process available.

IPC uses newline-delimited JSON, bounded to 64 KiB requests and 256 KiB replies. Reader/writer threads have single-slot queues. Control and expiry run on the graph owner between transport steps, outside the DSP callback; commands may allocate and the owner loop is **not real-time qualified**. Worker status is polled by its daemon actor every 200 ms, without a request backlog. PCM no-progress, IPC timeout, process exit and malformed replies fail closed. Browser controls use this versioned API with serial status polling and session/revision checks; graph SSE is not implemented.

`pnpm lv2:check` builds a separate `qualification` feature with explicit ALSA-null access and runs `crates/oxidal-api/tests/graph_playback.rs`. It checks actual processing progress, scalar/native readback, injected MIDI feedback, owned cancel and autonomous expiry, edge routing, stale revisions, malformed input, HTTP disconnect, competing device ownership, stop/restart, forced child death and daemon shutdown/reaping. It uses the installed SWH amplifier, with no physical output. Ordinary `worker` builds cannot enable the null fixture. The null path is a test fixture, not an audio-quality or physical-device result.

## Installed effects catalog

`GET /api/v1/plugins/lv2?sample_rate=48000` rescans the configured graph worker's
standard Lilv search paths. Use the actual session sample rate: sample-rate-dependent
port ranges are resolved at discovery. Installing an LV2 package with the system
package manager is followed by another scan; the daemon need not restart.

The response contains plugin names, stable URIs, port metadata and an `unsupported`
reason when the same host admission checks reject a plugin. It is metadata admission,
not proof of successful instantiation, state recall or real-time performance. Optional
features and opaque plugin state still require explicit host support/qualification.
No browser-supplied bundle path or executable is accepted.

Discovery runs in a disposable process without acquiring PCM or instantiating plugins.
One scan can run at a time. Responses are limited to 4 MiB and discovery to ten seconds;
failed workers are killed/reaped, including after the requesting browser disconnects.
Unavailable/failed discovery returns an error rather than an empty successful catalog.
The maintained `pnpm lv2:check` verifies real installed SWH names/ranges/admission and
rescanning while the graph worker continues processing. The browser uses this catalog in New preset; persistent mixed-native/LV2 rigs remain separate work.

## Graph snapshots

While graph audio is running, `save_copy` with a name stores the authoritative
settled graph, plugin URIs, normalized control values, global bypass and MIDI mappings.
It does not require a native original or stop audio. An active adjustment must finish
before Save; disk work runs off the audio process. `GET /api/v1/presets/graphs` lists
these immutable, content-addressed documents. Recall passes their rig, bindings and
recall fields to graph Start with an explicitly selected device configuration.

The document records the original sample rate; changing it can change the meaning of
sample-rate-dependent controls. This version captures scalar-only LV2 rigs, including
empty input-to-output rigs. It does not embed installed plugin binaries, opaque plugin
state or file assets, and does not claim TONE3000-compatible export or mixed NAM/LV2
support. Snapshot validation and exact port-readback checks reject incompatible recall
rather than silently omitting controls. The browser can create and recall these documents through Library → New preset.

## Browser authoring

In Settings → Audio setup, select and probe the input/output device, then choose
**Use for new rigs**. This configures a stopped graph without opening audio or requiring
an imported preset. Configuration currently survives within the daemon session only.

Library → New preset creates an empty input-to-output draft. Add effect scans installed
plugins and explains unsupported entries. Repeated effects have numbered control groups.
Audition starts the real graph worker; tapping a parameter previews it immediately, Done
keeps the adjustment, and Cancel restores its opening value. Save preset stores a named
copy without interrupting processing. Saved rigs can be recalled after a browser reload.
The Rig view shows these actual controls and the measured resource strip.

LV2 structural additions are currently made while stopped. Live LV2 node insertion, removal
and reordering, mixed graphs and TONE3000 export remain unfinished. Native New preset and
NAM insertion use the separate playback path described in [audio lifecycle](audio.md).
The native preset audition path remains separately available; the UI prevents both workers
from acquiring the audio device at once. No switch between these workers is gapless.

`pnpm lv2:check` includes this create → audition → preview/cancel/commit → save → reload
journey against the actual worker and SWH plugin on desktop, mobile, XR WebKit, Fold cover,
Fold open and BOOX profiles. It captures portrait/landscape picker and live-control views,
checks tap targets/overflow, and waits for real metadata and monitoring before captures.

## Native-value touch editing

The installed-effects editor accepts exact native port values rather than requiring a
percentage conversion. Its drag axis remains logarithmic for logarithmic ports. Plus,
minus and arrow keys move one native integer for integer ports and between endpoints
for toggles; continuous controls use a 0.001 normalized increment. Reset/Cancel retain
the existing owned-edit behavior and confirmed native readback remains authoritative.
Missing or unusable port metadata falls back to explicitly labelled percentage entry.
Enumeration labels/scale points and native unit metadata are not exposed yet.

Unit/component coverage checks every integer in a 1–200 range with both tapers and
actual touch-button/keyboard dispatch. The maintained Linux browser scenario enters a
native amplifier value, observes actual worker readback, cancels, commits, saves and
recalls it on all six profiles. This is control mapping evidence, not physical audio
or real-time timing qualification.
