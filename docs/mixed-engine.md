# Owned native/LV2 graph core

`oxidal-engine/native` prepares a single-owner stereo DAG from already prepared
native and LV2 processors. It now also has the isolated worker described below; daemon/browser integration
remains separate from this process-level qualification. Native handles and LV2 instances remain non-Send
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
  worker/HTTP/browser lifecycle is not connected yet; the portable loader below
  now restores the qualified whole-native/scalar-LV2 subset.
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
not itself instantiate plugins or qualify a native compatibility profile. The
`from_bundle` entry point performs preparation from verified stored resources.

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

## Verified bundle loading

`PreparedPorts::from_bundle` preflights every native profile, installed LV2 URI,
audio-port declaration, complete control set and host buffer budget before creating
processors. Unknown required extensions, opaque LV2 state/assets, unsupported
features and Preserve tails are rejected. It loads exact verified native payloads
and instantiates installed LV2 libraries; clients cannot supply library paths.

The native codec baseline is derived from the pinned adapter source revision by
`native_profile_id`. This identifier is not a binary signature or evidence of full
upstream field/settings fidelity; installed-library identity remains a build/image
qualification responsibility. Extracted amp/cab roles are rejected by this loader
until paired state restoration is implemented. The lower-level prepared-binding
API continues to exercise the separately qualified paired-stage adapter.

Native blocks receive explicit Stereo input mode. Hardware channel selection stays
in `StreamConfig.input_map`; a single capture channel can be mapped to both inputs.
Native mono chains perform their own fold, while native stereo chains retain their
two lanes. The loader does not silently inherit the native Left input default.

The maintained mixed qualification now uses this loader to reopen the persisted
fixture. It rejects mismatched profiles, extracted roles and unsupported installed
plugin declarations before playback. Loading, readiness waits and plugin discovery
remain owner-thread preparation operations, never concurrent with the same plugin
library's running callback. This is not live replacement or gapless switching.

## Mixed worker and confirmed scalar Save

Build `cargo build --locked -p oxidal-engine --features worker --bin oxidal-rig-worker`
on Linux with both native backends installed. `OXIDAL_BUNDLE_STORE` names the trusted
application-owned expanded-bundle directory. Startup accepts an immutable revision,
exact `StreamConfig` and an optional complete confirmed recall. Native scratch data
uses the existing isolated `OXIDAL_QUALIFICATION_DATA` root. No browser-supplied
filesystem or plugin-library path belongs in the protocol.

The worker owns native/LV2 instances and ALSA on its main thread. Bounded reader and
writer queues carry requests and replies; EOF ends PCM. It requires two logical
input/output ports, with hardware channels selected by the existing transport map.
Status includes actual native/LV2 controls, host bypass/merge gains, cumulative
processed frames, stereo telemetry and host routing-buffer bytes. Byte admission
limits IPC and host buffers rather than imposing a fixed instance count; this is
not complete native/plugin memory admission or a real-time performance claim.

Scalar commands require the current worker session and control revision. Invalid
values and stale commands leave sound intact; accepted changes use backend
readback and immediately affect processing. An ambiguous backend failure stops
the worker rather than publishing stale confirmed state. Native controls currently
cover the same qualified subset as saved-preset playback, not every upstream
parameter. Owned touch-preview leases, MIDI, full controls and structural live
changes remain pending for this session. Existing editor paths are unchanged.

A separate `oxidal-rig-worker --save-revision` process reconstructs a complete
confirmed scalar snapshot from its source bundle. It updates actual LV2 values,
host routing controls and modified native payloads, verifies native values in a
fresh engine, and atomically publishes another immutable revision. Unchanged native
payloads retain exact bytes; the first native edit retains original source bytes.
Instances sharing an initial native resource receive independent revised resources.
Saving must never run inside the playing session. This preserves current sound
and the original revision, but does not transfer transient delay/looper histories
or certify all native field fidelity.

`pnpm native:check` builds the qualification-only null-ALSA worker and extends the
existing mixed example with audible scalar changes, invalid/stale rejection, actual
worker control/readback, concurrent isolated export, independent shared native
resources, exact unchanged payloads, offline child recall and EOF teardown.
Ordinary builds cannot open the null qualification route. The daemon must still
connect this worker to the shared device permit, actor shutdown, HTTP contracts
and a single authoring UI before this becomes a user-facing mixed mode.
