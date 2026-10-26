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

These tests do not qualify physical audio, real-time deadlines, reverb, TONE3000 LV2 preset parity, graph switching/trails, or physical MIDI devices. The existing native TONE3000 playback worker is a separate implementation; this library is not yet connected to its PCM loop or the web application.
