# Owned native/LV2 graph core

`oxidal-engine/native` prepares a single-owner stereo DAG from already prepared
native and LV2 processors. It also has an isolated worker and daemon lifecycle, described below; the mixed
browser supports confirmed controls, offline recall and scoped serial composition. Native handles and LV2 instances remain non-Send
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

The older stereo `PreparedRig` integration boundary remains explicit (the portable
executor below has separate admission and delay alignment):

- Portable manifest validation and immutable expanded-bundle storage now live in
  `oxidal-presets`; see [preset format](presets/format.md). They preserve native
  payloads and roles, routing, LV2 declarations and opaque resources. The browser composes whole-native/scalar-LV2 rigs and the guarded paired-stage subset described below.
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
The older stereo graph retains its fixed bounds; the mixed worker uses this portable executor.

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
The current qualified DSP scope is whole native or guarded paired amp/cab plus scalar LV2 and explicitly declared portable LV2 state/assets. Browser state/file authoring, required-feature admission, one-port native stage layouts,
complete LV2 feature support and live prepared replacement still need integration.

The older saved-render comparison retains its 400-block prewarm window because
its reference uses asset-only `wait_ready`, which advances silent DSP by a variable
number of blocks. Prepared processors now use `prepare_stream`: wait for assets and
the asynchronous edit hold, then reset processing/resampling histories before
admission. Its rate boundary is recreated explicitly because the dependency's
same-rate reset retains fractional phase. This fixes a timing-sensitive 44.1 kHz
comparison failure. The separate
alignment fixture below prepares both sides at the same clock origin and compares
from the first sample. Neither fixture establishes continuous switching or physical
real-time timing; the old prewarmed comparison alone cannot qualify those claims.

## Reported-delay alignment

The portable executor reads each prepared native or LV2 processor's reported delay and
computes cumulative latency in topological order. Preallocated per-edge delay lines
align inputs before merges, stereo processing and final output. Per-channel dry
histories keep host bypass at the same declared latency without reallocating or
changing downstream alignment. Bypassed processors retain their state but do not
advance their wet histories; bypass/resume still has no crossfade or tails guarantee.

Routing and delay histories share the host-buffer budget. Overflow and insufficient
memory reject preparation before streaming. Snapshot `latency_frames` reports the
resulting graph delay, excluding audio-device and transport buffering. The scalar LV2 profile accepts one valid latency output and queries it without
consuming audio after restoring saved controls. Latency-changing scalar edits require
a new graph; a verified rollback preserves the preceding control revision and audio.
Failed rollback invalidates the session. If any prepared processor reports a different
latency during processing, output is cleared and failure latched instead of using
an invalid alignment plan. Complete prepared replacement/recovery remains required.

The maintained mixed example compares a 44.1 kHz native branch and shorter mono
LV2 paths against separate native/plugin rendering and independent input histories.
It also exercises a native pitch-enabled fixture whose reported delay spans multiple
blocks, live bypass/resume, budget rejection and changed latency failure. The alignment comparison includes the first prepared sample as well as a zero-input
prewarm and signal/bypass blocks. Native
pitch reports nominal mean delay; fixed alignment does not remove its moving-tap
phase variation. The older stereo executor remains uncompensated.

## Verified bundle loading

`PreparedPorts::from_bundle` preflights every native profile, installed LV2 URI,
audio-port declaration, complete control set and host buffer budget before creating
processors. Unknown required extensions, unsupported features and Preserve tails are rejected. It loads exact verified native payloads
and instantiates installed LV2 libraries; clients cannot supply library paths.

The native codec baseline is derived from the pinned adapter source revision by
`native_profile_id`. This identifier is not a binary signature or evidence of full
upstream field/settings fidelity; installed-library identity remains a build/image
qualification responsibility. Extracted amp/cab roles require the versioned paired
derivation recipe described below. Role labels alone cannot authorize an arbitrary
native state.

Whole-native blocks receive explicit Stereo input mode; paired stages retain
the recipe's explicit mono input and validated downstream allocation. Hardware channel selection stays
in `StreamConfig.input_map`; a single capture channel can be mapped to both inputs.
Native mono chains perform their own fold, while native stereo chains retain their
two lanes. The loader does not silently inherit the native Left input default.

The maintained mixed qualification now uses this loader to reopen the persisted
fixture. It rejects mismatched profiles, extracted roles without a qualified recipe and unsupported installed
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
Ordinary builds cannot open the null qualification route. The daemon lifecycle below connects device ownership and HTTP control. Browser readback/recall and serial composition are described below; live structural replacement remains open.

## Daemon ownership and HTTP lifecycle

Set `OXIDAL_RIG_WORKER` to the absolute installed worker executable. The daemon
uses `preset_dir/bundles` for verified revisions and separate `rig-runtime/playback`
and `rig-runtime/export` scratch roots. `GET /api/v1/rig-audio` reports the lifecycle
and confirmed controls. POST accepts `RigAudioCommand` with its current owner
session/revision and one of Start, Stop, Restart, Reconfigure, Control or Save. Start references
a saved bundle revision; no request may select an executable or library path.

The actor holds the same `audio::PROBE` permit as native saved playback, LV2 graph
playback and device inspection. Stop/crash recovery release it only after reaping
the child. An accepted HTTP command belongs to the actor even if its connection
disappears. Restart restores the complete confirmed scalar recall; it is an
interrupting stop/start, not gapless switching. Startup currently waits up to
60 seconds for preparation. Start/Restart acknowledge `starting` before waiting for
readiness; clients poll until `running` or `failed`. Stop and shutdown cancel the
pending startup exchange, close its pipes and reap the child before releasing the
device permit. A late readiness reply cannot revive the cancelled session. The
maintained slow-worker test covers cancellation and shutdown before readiness.
A terminal failure frame preserves a bounded native preparation error even before
a valid snapshot exists; it never fabricates controls or telemetry for a rejected
candidate. Malformed failure messages remain protocol errors.

Reconfigure applies a new duplex device/rate/buffer/channel-map configuration to the
same rig and its confirmed unsaved scalar controls. Invalid declarations fail before
interrupting audio. Preparation errors restore the previous configuration once; if
restoration also fails, the actor reports failure rather than retrying indefinitely.
Cancel during preparation stops the worker and retains the previous configuration
for a deliberate Resume. The actor keeps the device permit across normal restart,
reconfiguration and rollback child replacement; if the replacement cannot spawn,
restoration may fail if another owner acquired the released permit. These changes
interrupt audio and do not establish seamless switching. Confirmed recovery and shared boot capture are described below.

Settings → Audio follows the actual mixed owner and exposes the shared current
session editor for rate, power-of-two buffers, periods and channel mapping. A checked
interface can be applied after the current audio is stopped for device inspection.
When all owners are stopped and more than one has a remembered configuration, this
prototype settings view prefers the mixed session; each Rig view remains explicit
about the owner it resumes. A unified persisted active-session selection remains open.

Save acknowledges a captured control revision and runs independently of subsequent
control commands. `save.source_session` and `source_control_revision` identify what
was saved; completion must not mark later edits clean. Status exposes progress,
the published revision or an error. Export completion does not advance the audio
command revision, so an otherwise valid Stop/control is not rejected while a save
finishes. A failed export never stops the separate PCM
child. Daemon shutdown reaps both children. Publication may complete before a lost
reply/timeout, so inspect stored revisions before retrying an uncertain export.

Monitoring includes the mixed worker's actual stereo telemetry, running/failed
phase and sample progress. The persistent resource strip recognizes this sounding
path. This does not add an xrun recovery counter or measured physical latency.

The maintained `pnpm native:check` also runs `oxidal-api/tests/rig_playback.rs`
against the real mixed child and ALSA null: missing/invalid revision rejection,
shared device exclusion, confirmed native/LV2 edits, stale commands, independent
Save versus later edits, restart/offline recall, monitoring, client disconnect,
crash recovery and shutdown during export. The existing native/LV2 paths remain
available until their authoring workflows are migrated; this endpoint alone does
not claim full authoring, model audition in mixed graphs or gapless transitions.

## Portable rig authoring API

`GET /api/v1/presets/rigs` returns at most 20 immutable revisions plus an optional
`next` cursor (`?after=<revision>`). It includes the pinned native profile for new
declarations. Catalog entries check manifest integrity; they do not claim installed
plugin compatibility or validate every resource. `GET /api/v1/presets/rigs/{revision}`
verifies all payloads before returning the typed document.

`POST /api/v1/presets/rigs` accepts `manifest_json` (the exact format-1 JSON string)
and `resources`, a map from each declared resource ID to a local source:

- `{ "kind": "original", "preset": "<native import hash>" }`
- `{ "kind": "owned", "preset": "<saved native copy hash>" }`
- `{ "kind": "bundle", "revision": "<rig revision>", "resource": "<source resource ID>" }`

The last form supports composing multiple existing revisions without changing their
native bytes or assets. Empty/LV2-only rigs need no resource bindings. Clients create
a new UUID for a new preset and retain it for later revisions. Publication verifies
strict manifest JSON, graph semantics, binding kinds, sizes and payload hashes;
unknown optional metadata survives. Required extensions remain capability-gated.
Original imports, previous revisions and the current audible session are unchanged.
There are no arbitrary file paths or embedded executables in these requests.

One blocking library operation is admitted at a time, including after a client
disconnect; work is outside audio/async threads. Read requests can wait up to five seconds
for that permit; competing publication requests are rejected without automatic retry. The manifest remains capped at
1 MiB (the request permits JSON-string escaping). Resource byte budgets apply before
retaining payload copies. The typed response contains the immutable revision and
manifest, not an assertion that it plays. Start uses `/rig-audio` and performs actual
backend admission. Publishing alone does not apply structural edits live, save DSP
histories or provide gapless switching. The maintained HTTP suite covers persistence
and integrity; `native:check` now publishes its mixed fixture through this boundary
before actual worker/control/export/offline-recall qualification.

## Browser readback and offline recall

When the configured mixed worker is active, Rig shows its verified processor
nodes and current controls. Selecting a processor exposes its actual qualified
controls; no delay/reverb or example parameters are inserted. Native, LV2, host
bypass and merge values use confirmed session/revision-checked readback. The shared
relative touch dialog coalesces previews, supports fine adjustment and cancel, and
does not replay an uncertain command against refreshed state. This is optimistic
revision ownership, not yet a server-side touch lease or physical MIDI path.

The worker's `modified` flag compares actual scalar values with the source bundle;
returning a gesture to its baseline does not remain dirty solely because revisions
advanced. Save runs independently, identifies its captured control revision and
leaves newer edits unsaved. Library lists portable revisions and can recall them
using the configured audio endpoints. Until prepared replacement is implemented,
playing a different saved rig requires stopping current audio; the UI reports
this constraint rather than interrupting an unrelated session automatically.

Selection survives visits to Settings and orientation changes within the same
revision. The maintained mixed browser case in `presets.spec.ts` runs through
`native:check` on Linux for desktop, XR/WebKit, Fold cover/open and BOOX. It publishes
a verified mixed fixture via HTTP, then tests actual touch/readback, cancel, Save
while PCM continues, library recall, reload and both orientations. BOOX uses e-paper
mode and non-colour state cues. This does not implement live structural replacement,
model insertion into the mixed worker, a full visual routing editor, complete native
parameter fidelity, server-side gesture leases or gapless replacement. The image
recipe still needs the mixed-worker packaging and boot qualification step.

## Serial composition from saved tones

Library → New preset → Add saved tone opens a serial composer. It retains compatible
LV2 draft controls, permits multiple original/owned native tones and installed scalar
LV2 effects, and supports reordering/removal before Play. Existing model-first native
creation remains available; direct NAM/IR insertion inside a mixed rig is still open.
Legacy drafts with non-serial routing, global bypass, MIDI bindings or a different
sample rate are rejected instead of losing that intent during conversion.

`GET /api/v1/presets/rig-sources` lists original and owned native payload identities
without requiring the native editor service. Publication verifies each selected
payload through the existing binding contract. Repeated native instances can share
unchanged bytes but keep independent processor identities and later controls.

Every mono LV2 effect has an explicit Left, Right or averaged L+R input choice. The
manifest contains a two-input weighted merge, one mono processor and a split to
identical L/R outputs. Stereo effects keep both ports. The composer never duplicates
a mono processor behind the user's back or implies that its output retains stereo.
It does not yet author parallel routing; imported port graphs retain their topology.

The optional `urn:oxidal:authoring` metadata holds node labels and a boolean `draft`.
Audition revisions are immutable and addressable but hidden from saved-library pages
when `draft` is exactly true. The isolated Save worker removes that marker while
retaining labels and unrelated metadata. Play does not represent an audition as a
named Save. Old audition revisions remain stored; automatic garbage collection is
not implemented. Playing a draft currently requires current audio to be stopped.

The maintained browser scenario composes and reorders actual native/LV2 processors,
checks explicit mono routing and hidden draft status, saves while running, and recalls
the named revision. It covers both orientations on XR, Fold and BOOX. Portable schema
checks exercise empty routing, repeated native instances and all mono-input policies.

## Separate amp/cab authoring

In the serial composer, **Separate amp & cab** selects classified amp and cab blocks
from an immutable imported/owned native tone. Metadata identifies candidates only;
the player confirms an amp-head capture without a baked-in cabinet and explicitly
chooses Left or Right input. Actual native preparation reruns every guard. A classified
label alone does not make a combined capture separable.

The two draft stages share source identity and a versioned recipe. Effects can be
moved between stages; the composer keeps the amp before its matching cab and removes
both when removing a pair. The original preset remains unchanged. Qualified stage
controls adjust live after Play, and Save captures them in the portable recipe for
independent offline recall. These host stages cannot be exported as standalone
TONE3000 presets.

Preparation requires 48 kHz; the browser reports an incompatible configured rate
instead of silently changing the audio device. A rejected candidate leaves the draft
open for correction. Play changes views only after confirmed running state, and a
pending preparation has a Cancel action. Publication and successful HTTP Start alone
are not treated as audible readiness. Navigation away does not revoke an already
accepted daemon command.

The maintained mixed browser gate uses the native qualifier's authored mono-IR
fixture after its cache-independent worker proof. It covers confirmation/cancel,
rotations, effects between stages, real native rejection of a forged block ID with
draft retention, live stage-specific controls, source hash preservation and fresh
saved recall on XR, Fold and BOOX. This is saved-source derivation: unsaved whole-rig
conversion, independent amp/cab source pairing, mixed model audition, other rates and
continuous structural replacement remain open.

## Confirmed session recovery

The daemon checkpoints the last worker-confirmed mixed bundle revision, stream
settings and complete scalar recall to `last-rig-session.json`. Touch changes are
coalesced over two seconds; Stop and clean shutdown flush pending confirmed edits.
The record is bounded, validated and atomically replaced. A failed or cancelled
candidate never replaces the previous confirmed checkpoint or Resume configuration.
The bundle itself remains immutable; recovery does not create a named preset copy.

Daemon startup restores configuration without opening audio. Resume explicitly
re-verifies the bundle/assets and restores native, LV2, bypass and merge controls.
Recovery write errors appear separately from audio errors and are retried while
PCM continues; they do not change control revision authority. Abrupt power loss
may lose edits newer than the last successful checkpoint. Corrupt records report
an error while library/authoring remain available.

The maintained API test exercises actual mixed DSP/ALSA-null playback during a
checkpoint failure, retry, unsaved edits flushed at shutdown, a new daemon's
explicit Resume and failed-bundle preservation. Unit tests cover interrupted,
oversized, malformed and invalid records. This is scalar recovery for the supported
profile, not opaque plugin state or DSP tail history. The checkpoint does not
itself enable automatic playback; explicit boot selection is described below.

### Explicit boot playback

Audio settings can capture the confirmed mixed revision, controls and device setup
for automatic playback on the next daemon start. The shared boot record selects
one native, mixed or scalar-LV2 session, never competing owners. Later edits keep updating recovery but
do not change the boot snapshot. Disable and enable boot playback again to replace
it. Stop retains the preference. Corrupt boot records remain recoverable in the web
interface. See [audio lifecycle](audio.md#shared-boot-selection).

The maintained HTTP suite proves failed writes leave PCM and the preceding policy
intact, native disable cannot clear a mixed selection, captured edits restore after a
daemon restart, exactly one worker owns audio, and disabling returns startup to
metadata-only recovery. Browser tests exercise the shared control on XR, Fold and
BOOX layouts. Physical boot/audio acceptance and opaque plugin state remain open.

## Persistent paired amp/cab derivation

An extracted native instance can carry the versioned `partition` recipe in the
[preset format](presets/format.md#native-processing-roles). Two declared roles share
one exact source preset; restoration reruns the guarded native partition rather
than decoding imported opaque instance bytes. The amp omits the final DC blocker,
and the cab applies it once. Input selection and per-stage scalar catalogs are
explicit. Sources and embedded assets stay unchanged through scalar Save.

The mixed qualifier compares the reopened pair with whole-native rendering for
left and right input at 48 kHz, and separately checks actual LV2 gain between the
stages, live input/output edits, isolated Save and fresh recall. Unknown/incomplete
controls, wrong-stage controls, invalid pair declarations and other sample rates
are rejected. This extends the existing native suite; generated private fixtures
contain the model assets and are not committed.

This is not browser conversion or live structural replacement. The source is a
saved preset, not arbitrary unsaved native machine state. Pitch remains internal
to the amp. General cab formats, browser LV2 state authoring, non-48-kHz split stages,
prepared switching, trails and physical timing remain unqualified.

Atom effects require an explicit portable state resource; scalar-only browser composition still excludes them. Live typed-message/file authoring remains pending.

## Portable LV2 state and assets

An LV2 instance can declare a version-1 `PluginState` JSON resource and exclusively
owned asset resources. Verified asset bytes are materialized in a private directory
before restore; the resource paths serve as portable aliases. Plugins finish
cleanup and background work before the directory is removed, including failed
preparation. Source filesystem paths are never needed for recall. State JSON is
bounded to 8 MiB, with the LV2 library's property and payload budgets applied too.

Isolated Save reconstructs the source and confirmed scalar edits, captures each
declared state, updates its content hash, and verifies fresh restore and recapture
before publishing the revision. This preserves imported resource state; it does
not capture unconfirmed Atom messages or DSP history from the playing worker.
Plugin-created files, nested Atom state and arbitrary required features remain
unsupported. The browser picker stays scalar-only until typed resource authoring
is integrated.

The existing native qualification runner tests source-file removal, a missing
alias with an unaffected existing session, isolated Save and fresh rendered recall.
These tests establish offline persistence, not gapless transitions or physical
real-time performance.

## Native EQ authoring

Native graph nodes expose stable inner-block six-band EQ through the shared touch panel. Edits reach the sounding worker immediately with both actor and DSP session/revision checks. Invalid bands, missing targets and stale revisions leave the confirmed session unchanged; ambiguous native readback fails the worker closed. Cancel restores the opening value through the same queue.

Confirmed EQ is part of mixed recovery and explicit boot capture. Legacy records without EQ retain their source preset values. Reconfiguration and isolated export replay EQ only on prepared, non-sounding candidates. Save detects EQ-only changes, verifies fresh native recall, and keeps unchanged native resources byte-identical. The maintained mixed worker/HTTP/browser suites exercise these paths.

Guarded extracted amp/cab stages expose their own EQ through the same panel.
Save captures a version-2 derivation recipe with exact EQ and scalar state, keeps
the source preset unchanged, and verifies fresh derivation and audio equivalence.
Version-1 recipes remain readable. The exact older recovery catalog omitting all
stage EQ retains the derived defaults; partial omissions are rejected. Repeated
recovery after a version-2 recall is covered to prevent native stage-token reuse.
This does not add live structural replacement, automatic alignment, gapless
switching or physical real-time acceptance.

## Resident prepared preset switching

Saved portable rigs can be selected with **Library → Rigs → Prepare set** before
starting audio. The worker prepares every selected native/LV2 session before
opening one PCM stream. The live chain then offers direct buttons for the prepared
alternatives; selecting a prepared rig in the library uses the same switch path.
Each resident retains its confirmed unsaved scalar/EQ controls. Restart, recovery
and explicit boot settings retain the set and the per-resident recall records.
An independent Save receipt remains bound to its source resident during switches.

`StartRig.prepared` carries immutable revision/optional recall pairs. `switch`
commands require both actor and active DSP authority, an admitted resident and a
bounded fade length. The sounding revision changes only after the worker confirms
the completed transition. The worker PID, PCM device and processed-frame counter
continue across the switch. Invalid/stale targets retain the sounding session;
reported candidate DSP/pump failures make that alternative unavailable while the
active path continues. Native/plugin process crashes still fail the worker closed.

Output paths share the greatest reported graph delay in the set. Candidate input
is primed for that delay plus one block, then a sample-counted linear crossfade
moves between the aligned outputs. Live priming plus fading is bounded to one
second before admission, leaving the control response deadline headroom. The web
uses a ten-millisecond fade. All resident graphs process (inactive inputs receive
silence), so the measured processing cost and RAM include the entire set. Host
routing/scratch/delay allocations share the existing byte budget; plugin/native
internal allocations remain separate. No plugin is instantiated, transferred or
destroyed inside the process closure.

The maintained latency suite checks unequal-delay PCM continuity, repeated
switches, retained controls, candidate failure and buffer rejection. Actual
HTTP/worker tests check stable PID, continued frames, stale rejection, independent
edits, Save receipts and reconstruction. Browser tests exercise the library and
live controls on XR, Fold and BOOX. This is resident switching with **Cut** tails;
background creation of new residents during playback, Preserve/Fade tails, physical
MIDI selection, native standalone-worker unification and physical deadline/xrun
acceptance remain open. Ordinary Start/Restart/reconfigure still interrupt audio.

## Live whole-native model transactions

Whole-native nodes expose their current inner block identities and insertion slots.
The mixed session accepts revision-checked `Model` operations using verified local
asset IDs; it derives insertion coordinates from the sounding node. Clients cannot
choose a file path or impersonate another node's insertion slot. Provider selection
uses the existing browser picker and model cache, with NAM and IR audition applied
before named Save.

Asset verification runs off the PCM owner thread. The owner pumps the shared native
preparation state and refreshes controls, EQ and slots after confirmed application.
Failed preparation retains the previous sound. Scalar/EQ edits, prepared switching,
Audio Apply, named Save and boot capture wait for pending model preparation; Stop
remains available. A reported-delay change invalidates the old graph alignment and
requires fresh preparation rather than silently accepting an incorrect delay plan.
This path does not establish a physical no-dropout guarantee.

Confirmed assignments belong to the inner native node and are included in unsaved
session recovery, per-resident recall and explicit boot capture. Recovery verifies
all asset IDs before preparing an isolated candidate. Named Save reconstructs the
confirmed model/scalar/EQ state in a separate process, embeds the native payload,
and verifies a fresh load, including model identities. The saved bundle no longer
needs the temporary download cache. The original source bundle remains immutable.
Extracted amp/cab nodes permit replacement of their existing capture/IR only.
They reject insertion and cross-role formats. Cab preparation verifies short mono
WAV content off the processing thread before committing the replacement.

The maintained mixed DSP/worker and HTTP suites cover replacement, NAM/IR insertion,
failed-candidate retention, recovery, boot capture and cache-free saved recall. The
browser suite uses fixture provider transport with verified real assets and the
actual daemon/worker on XR, Fold and BOOX layouts. These tests qualify the stated
software path; physical audio timing and complete native authoring remain open.

### Model-edited extracted stages

Stage Save replays confirmed replacements into an isolated copy of the pair's
whole-native source, reruns the guarded amp/cab partition and embeds the resulting
source preset. Both roles refer to that same replacement source. The original exact
source remains a provenance resource; subsequent saves retain that original origin.
The existing version-2 recipes retain stage-local scalar/EQ overrides. No opaque
host-role state or additional recipe format is needed.

Fresh derivation verifies model identities, controls and EQ. The maintained DSP
regression compares unsaved restored stages against the cache-free saved bundle
from the first sample; it also rejects forged stage insertion coordinates and
wrong-role assets. Isolated restoration settles terminal model preparations and
resets native histories and host delay buffers before the first input. This reset
is for startup/export candidates; it is never applied to the sounding session.
Live model replacement still uses the native wet-mute splice; it is not the
resident crossfade path or a physical gapless guarantee. Non-48-kHz stage processing,
unsaved whole-node split conversion and full authoring remain open.

## Preloaded scenes and shared effects

The simple composer offers Serial chain or Scenes. Scenes takes 2–64 whole saved native tones for its current one-level stereo selector layout, prepares each independently and places qualified scalar LV2 effects after the selector. Shared source bytes do not share DSP state. This composer port-layout bound is not a NAM inference limit; lower-level graphs can use more nodes within manifest, IPC and buffer budgets. All ready branches continue processing, including muted ones, so capacity must be measured on the deployment device.

`urn:oxidal:scenes:1` is a required sonic extension. Its `fade_ms` (1–1000) and named `scenes` specify complete merge input gains. IDs are unique; every scene must address the same full set of selected merge inputs. Missing, partial, duplicate, foreign and invalid targets fail validation. Original graph gains determine initial selection. Saving and restoring confirmed scalar gains retains the selected scene without serializing device/session identifiers into the portable document.

`RigAudioAction::Scene` carries the running control session, expected control revision and scene ID. The worker validates the complete selection before mutation. It ramps all selected gains over the same sample count from their current audible values, including rapid retargeting. Readback exposes the target scene and whether its ramp is still running; command acknowledgment alone is not proof that a PCM period has elapsed. Linear gain ramps avoid the correlated-signal boost of an equal-power crossfade. No processors are loaded, reconstructed or discarded during selection. Prepared graph delay alignment remains in force.

The composer exposes two scene-tail layouts. **Keep branch trails** (the new composition default) uses explicit mono input gates and a unity output sum: deselecting a branch ramps down new input while that same prepared processor keeps draining its existing sound. **Cut branch tails** retains output selectors and mutes the outgoing branch output. Shared downstream effects retain their histories in both layouts. Stored graphs define the behavior; changing it requires preparing a new graph, not hot-rerouting the active one.

Input gates use the required `urn:oxidal:gain:1` capability, with one input/output and one declared linear gain. Their sample ramps use the same validated host path as existing scene selectors. Internal gates/sums are omitted from the main effect controls, while audible native/LV2 processors remain visible. Overlapping trails can add level; use the existing branch/output controls and clipping meters to balance the rig.

All branches continue processing, including after their tails drain. There is no tail detector, branch CPU suspension, arbitrary scene structure mutation or whole-preset dynamic gapless claim. Physical MIDI and Pi deadlines/capacity require their own qualification.

The maintained `latency` integration suite renders opposite constant signals and verifies every ramp sample, rapid retargeting, retained shared delay history and stale/invalid commands. Its input-gate case preserves an outgoing delayed impulse after deselection, checks constant-signal transitions with unequal reported latency, drains a disabled branch and restores the exact branch mix. Real independent A2 branches exercise both layouts through the child worker and isolated Save/recall. The mixed qualifier additionally runs independent native A2 branches, the real child worker and isolated Save/fresh reopen. Its focused invocation reuses the normal native fixture environment:

```sh
cargo run -p oxidal-engine --features native --example qualify_mixed -- --scenes
```

The full `pnpm native:check` also includes these scene checks. Browser composition coverage exercises both layouts, actual-worker selection, Save/recall, accessibility and portrait/landscape sizing on the maintained target device projects. Neither ALSA-null transport nor browser emulation establishes physical timing acceptance.

### Device MIDI control

For a running mixed rig, expand **MIDI controls**, scan and choose a hardware input, select a channel (or All channels), and assign each scene a Program Change or CC press. Programs are displayed as 1–128 and stored as wire values 0–127. CC numbers remain 0–127; values 64–127 select the scene and releases are ignored. Duplicate triggers and unknown scene IDs are rejected before configuration changes. Repeated selection of the current target does not restart its ramp.

The mixed worker opens only explicitly selected ALSA raw MIDI hardware inputs. Discovery includes a strict hardware-hint fallback for input-only controllers. The decoder handles partial reads, running status, interleaved real-time bytes and canceled status across SysEx/system-common messages. One bounded non-blocking read runs outside PCM per owner tick. Missing/disconnected hardware reports a separate MIDI error and retries every two seconds while PCM continues. Disable MIDI and Stop release the port. A whole-resident switch disables the previous rig's mappings instead of silently applying them to different scene IDs.

Device-local input/channel/bindings live in `StartRig.midi`, not the portable preset. They survive Restart, Resume, audio reconfiguration and explicit boot capture through the existing checkpoint policy. Starting a different library rig requires selecting its MIDI configuration; portable Save does not export hardware identifiers. Connection state, event count and last PC/CC arrive in confirmed worker readback. This path selects scenes, controls declared independent branches and maps confirmed native/LV2/host scalar controls. Hardware feedback output remains separate work.

The maintained byte/binding tests and actual worker unavailable-device test cover parsing, trigger admission, configuration rollback, continuing PCM and disabling. Browser scene coverage changes channel/PC/CC settings through the actual daemon/worker, deliberately presents an unavailable discovery entry and proves audio keeps running. Portrait/landscape screenshots cover the open panel. Real USB input, unplug/reconnect behavior, controller feedback and scheduling deadlines still require the physical Pi session; emulated discovery does not qualify hardware.

### Independent parallel branches

Scene documents may additionally declare `branches`: unique named, disjoint gain groups covering the scene selector inputs. Each group declares its positive On levels. The composer emits one stereo group per saved native tone. Old scene-only documents remain valid. Duplicate, missing, zero-level or foreign branch targets fail validation.

Touch **On/Off** on a scene branch to fade just that branch's selector gains. Other branch targets are unchanged, so several NAM branches can sound together or all can be muted. Internal selector nodes are omitted from the main chain controls. A named scene still replaces the whole selected mix; a custom combination has no falsely selected scene. Readback reports each branch's enabled/partial state from actual confirmed gains. Named Save and recovery retain custom combinations through the existing scalar path, including a fresh isolated worker reopen.

Under MIDI controls → Independent branches, map a CC and select **Toggle on press** or **Follow CC on/off**. Toggle accepts each high CC message and ignores releases. Gate maps values 64–127 to On and 0–63 to Off. Channel selection applies to both. Collisions with scene CCs or other branch CCs are rejected. The hardware reader and the maintained decoder-to-DSP test call the same engine dispatch method, which uses current owner state and the same branch/scene transactions as the UI.

Mixing adds branch signals without automatic normalization or limiting; use the native output controls and always-visible resource/clipping strip. Muting keeps processors ready and does not free their CPU. Exact-sample DSP tests cover independent fades and unchanged peer gains. Real native/LV2 worker tests and browser Save/reopen retain multiple enabled branches. This establishes the software path, not physical controller or Pi timing acceptance.

### Whole-native authoring and portable instance settings

The selected whole-native node exposes the shared **Chain actions** controls:
copy/paste, duplicate, remove, reorder, move between lanes, swap/reset, mono/stereo, input mode and bounded
structural undo/redo. Commands require both the daemon cursor and the DSP session
cursor. Guarded extracted amp/cab stages retain their existing editing contract;
this does not provide a host-topology or complex parallel-branch editor.

Successful native changes produce immutable local working checkpoints bound to
the bundle revision, node and native profile. Reconfigure, Restart, Resume and
opted-in boot restore the checkpoint before admitting graph buffers and reported
latency, then restore later scalar, EQ and model edits. Failed checkpoint storage
rolls back the native edit; inconsistent post-edit readback fails the session closed.
History is session-local and structural, not a persistent scalar gesture history.
These control-owner structural operations may allocate and reset native histories;
they are not real-time or gapless editing guarantees.

**DSP settings** prepares the seven native instance settings in an isolated child
while the current rig continues playing. Successful preparation then restarts the
whole graph with fresh latency compensation; admission failure restores the previous
configuration. Settings are applied before user Save. This operation interrupts
audio and is separate from sample-ramped preloaded scenes.

An independently saved hybrid bundle embeds its edited native tone resources and
requires `urn:oxidal:native-settings:1` when retaining native instance settings. The
extension contains `instances`, keyed by whole-native instance ID, each with an
`input_mode` and complete normalized `parameters`: `osEnabled`, `osFactor`,
`pitchEnabled`, `pitchWindow`, `inputCalibrationLevel`, `calibrateInput` and
`targetLoudness`. Unknown, missing, out-of-range or fractional toggle values fail
admission. The required-extension declaration prevents older readers silently
ignoring sound-affecting settings. Native descriptor readback governs quantization.
Portable bundles never reference temporary working receipts; native instance scope
remains separate from standalone `.t3kpreset` exports.

The maintained mixed qualifier checks structural history, source immutability,
peer LV2 controls, cache-independent Save/reopen and deterministic rendered PCM.
The actual HTTP/worker suite exercises all seven prepared settings and subsequent
Save, configuration changes and recovery. A focused desktop browser workflow covers
the shared control wiring; this is not a new physical-device UI qualification.

Whole-native nodes also share the [native tuner and matching tools](native-tone3000.md#tuner-and-automatic-matching).
The mixed daemon polls active tools independently of the web client. Progress/pitch
updates preserve the graph control revision; an applied result advances it and
absorbs the edited node's model assignments into its verified working checkpoint.
Other nodes' controls remain intact. Measurement rejects conflicting sound edits;
the existing rollback, isolated Save and recovery paths retain successful results.

### Generic MIDI parameter mappings

MIDI controls → Parameters maps a CC to an actual native parameter, LV2 symbol,
processor bypass or host gain. Serial rigs do not need scene definitions to use
these mappings. Numeric controls use their confirmed ranges, including logarithmic
LV2 ranges and integer ports. Absolute switches use the midpoint threshold; toggle
switches respond only to values 64–127. Relative encoders support two’s-complement
(0 neutral) and offset-64 (64 neutral) conventions. Relative switch mappings,
unknown controls, invalid input/channel and colliding CC assignments are rejected.

Learn CC listens to fresh PC/CC telemetry from the already configured, connected
input. Only a new CC on the selected channel is accepted; existing events, Program
Changes and other channels cannot assign a mapping. Learning changes the local
mapping draft once and requires Apply MIDI. Cancel, closing the panel or removing
the mapping stops learning. Configure the input manually before learning; this
slice does not open an unmapped controller just for discovery.

The shared decoder routes mapped values through the existing session control owner,
including gesture/model guards and live latency admission. Invalid latency-changing
edits retain confirmed sound. The UI reads back the same actual controls; no second
MIDI value cache impersonates the DSP. Device-local mappings remain outside portable
presets and survive existing Restart/Resume/boot capture. Standalone native-worker
hardware MIDI and controller output feedback are not implemented by this path.

Maintained tests cover raw bytes to actual LV2/host controls, A2 native readback,
missing-controller PCM progress, boot/recovery settings, learned-message freshness
and cancellation, and the actual browser/daemon/worker mapping flow. These software
checks do not establish physical USB input or real-time deadlines.
