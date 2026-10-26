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

These tests do not qualify physical audio, real-time deadlines, reverb, TONE3000 LV2 preset parity, whole-graph replacement/trails, or physical MIDI devices. The existing native TONE3000 playback worker is a separate implementation; this library is not yet connected to its PCM loop or the web application.

## Prepared graph and control bridge

`PreparedGraph` validates a bounded DAG (up to 64 nodes and 128 edges), then instantiates explicitly bound LV2 nodes and prepares stereo buffers. Input/output nodes and LV2 nodes are supported; conceptual NAM/delay/reverb nodes are not silently replaced with plugins. Every node's legacy `level` field must be unity; gain comes from explicit plugin controls. Fan-in sums paths at unity without automatic normalization or clipping. Choose gains accordingly. Nonfinite sums or plugin output silence the block and require graph recreation.

The graph uses `oxidal-control` for normalized parameters, revisions, owned preview/commit/cancel, expiry, MIDI pickup/relative values and feedback. Native input port values are read back after integer/toggle quantization; confirmed normalized values and MIDI feedback follow that readback. MIDI here means injected, validated control messages; it does not imply physical USB/DIN transport or LV2 Atom MIDI support.

Commands and edit expiry run **between blocks on the same owner**, outside the real-time callback. They allocate and are not an audio-thread command queue. Successful block processing uses prepared buffers. Routing edits may change edges between the same ordered nodes while retaining plugin histories. Node addition/removal/replacement requires a newly prepared graph and is rejected by the live edge-edit path. Rejected commands leave the current revision, routing and controls unchanged; unexpected native write failure poisons the graph rather than publishing partial success.

Global bypass returns dry input while processing silence through the effects, draining their histories silently. It is not a wet-tail preservation or gapless preset-switching implementation. There is no gain smoothing or sample-accurate control scheduling yet. A caller must poll edit expiry between blocks; it is not tied to an autonomous timer in this library.

`pnpm lv2:check` also covers serial/parallel rendered outputs, route edits with retained histories, failed replacement preparation, shared MIDI/web ownership and stale revisions, edit expiry, dry bypass, discrete native readback/feedback, nonfinite-output containment, and mapped MIDI gain changes through the independently installed SWH amplifier. This is control-to-DSP integration coverage; browser E2E still exercises the separate simulated graph and native saved-preset authoring/playback flows.

Next integration steps are a bounded control-to-audio handoff and isolated graph worker, daemon/UI graph ownership, plugin state/assets, smoothing/switching/trails and physical MIDI/audio qualification. No hardware availability flag is enabled by this library.
