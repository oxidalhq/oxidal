# Owned native/LV2 graph core

`oxidal-engine/native` prepares a single-owner stereo DAG from already prepared
native and LV2 processors. It is an integration core, not yet a daemon playback
worker or browser authoring mode. Native handles and LV2 instances remain non-Send
and non-Sync; discovery, loading, readiness waits, controls and teardown stay on
that owner. Construction must happen before streaming. The owner must service native
message-pump/control work between processing calls; the graph does not dispatch
message-loop callbacks inside its process method.

The graph distinguishes intact native presets (`native`), paired native amp (`nam`)
and cab (`cabinet`) roles, and supported LV2 processors (`lv2`). It verifies each
node's role, rate and frame count and waits for native asset readiness before admission. There is no implicit node gain:
use actual processor controls. Mono native input selection remains part of the
native processor; the host does not pretend a mono stage preserves stereo input.

Both this core and the existing LV2 host use `oxidal-graph::PreparedRouting` for
validated signal order. Each node owns preallocated stereo buffers. Parallel inputs
sum at unity; there is no automatic normalization or limiter. Rerouting accepts
only the same node identities/order and retains every instance/history. Invalid
routes leave the previous route installed. Processor failures silence output and
latch the graph failed; invalid input buffers are rejected and cleared.

The maintained Linux `pnpm native:check` includes the mixed engine example after
creating the real A2 fixture. It compares two native instances plus an installed
SWH LV2 amplifier against explicit reference processing, changes gain, rejects a
cycle, then changes parallel routing to serial without resetting histories. This
checks actual sound and retained state rather than only graph serialization. The
existing LV2 gate also exercises the shared routing scheduler. Linux native checks
therefore require `liblilv-dev`, `lv2-dev` and `swh-lv2` alongside native prerequisites.

The current integration boundary remains explicit:

- Portable manifest validation and immutable expanded-bundle storage now live in
  `oxidal-presets`; see [preset format](presets/format.md). They preserve native
  payloads and roles, routing, LV2 declarations and opaque resources. The mixed
  worker/HTTP/browser lifecycle and actual DSP restoration are not connected yet.
- No callback-safe structural admission, independent preparation thread, atomic
  swap, latency compensation or Preserve/Fade/Cut tails. Rerouting can cause an
  audible discontinuity and is not a gapless switch.
- Native stages may lock/allocate internally. Preallocated host buffers do not
  establish real-time safety or physical audio acceptance.
- Split amp/cab roles require 48 kHz until a shared resampling boundary exists.
  Whole-native processors retain their existing rate support. Paths with unequal
  latency are not compensated; the qualified fixture uses zero-latency paths.
- Existing graph validation bounds (64 nodes / 128 edges) remain. This is not the
  requested resource-limited unrestricted-NAM implementation.
- Native scalar access and LV2 port access remain typed backend controls. A common
  transaction/descriptor layer and durable hybrid save/replay are still required.

## Portable scalar-port execution

`PreparedPorts` accepts an integrity-checked `Bundle` and processors prepared from
that same revision by a trusted caller. It checks channel counts against discovered
LV2 ports, applies complete native-value LV2 controls, validates backend roles and
rate/frame configuration, and compiles scalar routing before processing. It does
not instantiate plugins or qualify a native compatibility profile from a manifest
string; a worker loader must perform those checks before supplying its bindings.

Split nodes explicitly copy a scalar port. Merge nodes apply their declared gains,
without implicit normalization. Host bypass retains the processor and declaration.
The buffer allocation is precomputed and admitted against a caller-supplied byte
budget, with no fixed graph-node count in this executor. This accounts for host
buffers only; native/plugin memory and compute still require resource monitoring.
The existing worker/stereo graph bounds remain until integration.

`Plugin::new_ports` uses exactly one instance for a discovered mono LV2 plugin and
`process_mono` handles its one signal. Stereo plugins use the stereo method.
The older `Plugin::new` API retains independent left/right copies of mono plugins
for the existing stereo host. The stereo `PreparedRig` rejects a mono port instance
before processing rather than silently assigning it a second audio channel.

The maintained mixed example now persists a real native A2 payload and explicit
mono LV2 branches, removes its temporary input file, reopens the complete bundle,
and compares weighted parallel rendering with separate reference processors.
It also exercises bypass, invalid-input recovery, resource-budget rejection,
unsupported Preserve policy and 162-node explicit routing with overload latching.
The current qualified DSP scope is whole native plus scalar-only LV2; portable
opaque LV2 state/assets, required-feature admission, mono native stage restoration,
latency compensation and live worker/browser Save still need integration.

Startup samples are explicitly outside the settled-render comparison. Native
`wait_ready` pumps and processes a variable number of silent blocks while assets
load. The regression records an initial difference and then compares after the
same 400-block prewarm window used by existing native graph qualification; the
saved routing matches exactly in that scoped settled fixture. Asset readiness is
not deterministic initial DSP state or proof of a gapless transition. A live
prepared-switch implementation must qualify startup/prewarm and continuous output
rather than reuse this offline comparison as its acceptance test.
