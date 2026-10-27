# Native TONE3000 adapter qualification

`oxidal-tone3000` provides an **optional offline native editor** connected to the daemon through a dedicated worker process. It calls the real pinned TONE3000 processor through a bounded C ABI. The adapter itself is not an ALSA driver, LV2 host, real-time-qualified callback implementation, complete settings editor or shipping audio engine. The same offline adapter builds on macOS and Linux. Native execution has been qualified on macOS ARM64 and Debian Bookworm ARM64 without a display server; a separate experimental Linux playback worker now uses this adapter with ALSA; see [audio lifecycle](audio.md). Physical-device and real-time qualification remain required.

## Build and repeat the qualification

Install CMake 3.24 or newer, the platform C++ SDK and the repository's pinned Rust/Node toolchains, then run:

```sh
pnpm native:check
```

For Debian/Ubuntu Linux builds, install the development packages below. No X server or desktop login is needed to run the offline worker; JUCE still has graphics/font library build dependencies. Qualify the dependency closure for a shipping image separately.

```sh
sudo apt-get install cmake build-essential pkg-config libasound2-dev libfreetype-dev libfontconfig1-dev libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev libxcomposite-dev libxi-dev
```

Linux builds default to `.local/tone3000/build-linux/liboxidal_tone3000.so`; macOS builds retain `.local/tone3000/build/liboxidal_tone3000.dylib`. An absolute `OXIDAL_TONE3000_LIB_DIR` can select an isolated output directory for the builder and Rust/tools together. Never reuse one CMake directory across operating systems. Tooling also honours `CARGO_TARGET_DIR` when launching daemon/worker executables. `python3 native/tone3000/build.py --prepare-only` verifies and prepares source without compiling; it is not a qualification pass.

The native builder clones exact revisions and recursive dependencies into `.local/tone3000/source`, verifies them, applies hash-checked native-stage/isolation patches and builds a shared library. It never edits an installed plugin or external checkout. Downloads require network access on the first run. To reuse an already downloaded checkout at the pinned revision, copy it through the build command once:

```sh
python3 native/tone3000/build.py --seed /absolute/path/to/pinned-checkout
pnpm native:check
```

The seed must include the pinned recursive submodules and JUCE checkout under `libs/juce`. Only the new private copy is reset and patched. Existing generated source changes outside the reviewed overlay fail the build. Delete/recreate a disposable build cache explicitly if its inputs need replacement; the builder does not reset an existing source tree to conceal drift.

`pnpm native:check` is part of the existing tooling entry point: build, native-feature Clippy, and the Rust `qualify` example on the process main thread. The example uses assertions as a bounded integration test, rather than a GUI demo. Main-thread execution owns JUCE's message dispatch; an ordinary parallel Rust test function is unsuitable for that lifecycle. It checks all 43 native parameter descriptors against the source inventory, 36 tone parameters, four machine-default parameters, invalid calls, dry-path rendering, captured-state restoration, rejection of a project-authored non-A2 local file and loading a hash-pinned upstream A2 test model. The native local loader is A2-only at this pin; the adapter preserves that behavior. It destroys/recreates the native processor, removes the temporary input copy, moves its isolated model stash aside, and restores embedded model state. Rendered A2 output before/after restore must agree within 1e-5; this is native restore consistency, not independent cross-engine audio parity. The empty-path comparison includes the processor’s 5 Hz DC blocker. Readiness polling is bounded and inspects native load/failure flags; audio settling and numeric checks are separate.

The same gate also verifies that block output gain changes rendered audio, tests all five block controls with preview/cancel/commit and exact-toggle rejection, qualifies staged size rejection/cancel/commit/persistence on the pinned A2 model, rejects size changes on unsupported factory blocks, and checks block readback across eight factory preset round trips. It also exercises tone-preset load/save, owned-copy provenance, preview/cancel/commit, device-setting preservation, storage failure and recreation from disk. It runs the existing desktop/mobile Playwright suite against the real native worker, including revision/owner conflicts, duplicate requests and abandoned-edit rollback. This does not use a simulated native backend.

To review the editor locally after building the native library:

```sh
OXIDAL_NATIVE_EDITOR=1 pnpm preview
```

Open Library, import a `.t3kpreset`, select it under Native preset editor and load it. The 14 qualified global controls are input/output level, bass/mid/treble, tone-EQ enable, gate enable/threshold/release/hold/range, input calibration, oversampling enable and factor. The server annotates all 43 native descriptors with separate `writable` and `staged` capabilities; native automation support alone never authorizes an edit. The UI derives its control list, names, tone/device grouping and toggle behavior from these descriptors. Unsupported descriptors remain available for inspection but are not offered as editable controls. Each native tone block also exposes enable, normalise, input gain, output gain and mix, identified by block and left/right lane. Global and block toggles accept exactly 0 or 1; gain and mix use normalized 0–1 values. Loaded engines that explicitly report slimmable-model support also expose requested NAM size as a commit-only control. No size control is inferred from a filename or title, and the bridge independently rechecks support before mutation. The native engine reports the requested value; effective model size/CPU savings are not asserted. Block EQ, model selection and other settings remain unqualified. A staged control accepts a final commit only; previews cannot trigger repeated reloads. The UI shows authoritative native values and an explicit normalized 0–1 edit value. Editing is silent and does not change a separate playback session. Save a copy and start that saved preset to hear changes when experimental Linux playback is enabled.

The draft supports removing a selected native tone block and undo/redo for committed scalar, staged and removal edits. Commands retain the same session/revision checks and reject structural/history changes while a gesture is active. Removal invalidates the old block's control targets; Undo restores its native identity and controls. Restore/prepare failures roll back to the committed draft. History retains at most eight checkpoints and 64 MiB combined, independently of active model capacity. Successful load or save starts a new history; history is not persisted across worker restarts. This is offline authoring only, not live structural switching or a complete native operation surface.

Owned copies use fresh `oxidal-` identities and preserve the source SHA-256 in metadata. Each copy is an immutable snapshot in the library's `owned/` directory; saving the same name again makes another copy. Atomic directory publication keeps metadata and native bytes together. Files are bounded and integrity checked again on reload. This internal whole-tone representation is not the final mixed `.oxpreset` format or a provider export/sync endpoint. The original file is never passed to native save or rewritten.

Calibration and oversampling survive tone loads and are excluded from saved tones. The preview starts a fresh isolated native settings directory each time; durable device profiles are still future work. Owned copies persist in `.local/presets/owned`. Native preset selection itself is not restored automatically on daemon restart.

The normal `pnpm check` invokes this gate on macOS or Linux when the native dependency cache is prepared; otherwise it explicitly reports native qualification as not run. Platform-independent checks and configured Linux CI do not imply that this optional native gate ran. The `native` Cargo feature must be enabled explicitly and requires the built library directory; there is no simulated native fallback.

## State, threads and bounds

- Each Rust wrapper owns one native handle, is neither `Send` nor `Sync`, and uses exclusive mutable borrows. Multiple independent handles may coexist on the same process owner. The first native construction fixes that owner for the process lifetime; construction from a different thread is rejected, and calls/destruction still check the handle owner. This permits prepared stages to coexist, not background engine construction or a real-time handoff.
- All native exports catch C++ exceptions. Input sample-rate, block-size, parameter-value, string and buffer bounds are validated. Audio is stereo, at most 2048 frames, with finite input/output checks. Control JSON is bounded to 256 KiB and captured state to 32 MiB.
- `State` can only be constructed from a native capture. Arbitrary imported bytes are not accepted through that safe Rust type. Complete native session state is different from a tone preset: this gate does not replace the bounded `.t3kpreset` importer or establish its audio fidelity.
- Native settings, logs, model stash and preset discovery use a newly created `OXIDAL_QUALIFICATION_DATA` directory. Required isolation patches redirect macOS/Linux JUCE special folders and factory discovery. Linux uses `user/.config` inside the isolated root; macOS uses `user/Library`. This remains an experimental isolated adapter, not a production plugin. The private first-boot appliance bundle uses the same isolation: the daemon creates separate native-editor and playback roots under its state directory. It does not modify the official standalone application’s user data. No environment changes are made to `HOME` or the installed TONE3000 data.
- The native worker owns JUCE on its process main thread. A one-slot input queue lets it continue pumping and expire edits while idle. The daemon serializes bounded IPC, rejects contention, and kills/disables the worker on a protocol failure or 25-second timeout. It does not replay uncertain operations or restart silently. A fresh worker session invalidates stale commands. Native startup supplies JUCE's rate/block metadata before `prepareToPlay`, including for EQ coefficient calculations.
- Edit requests carry session/revision, owner/token, sequence and request ID. Preview changes never capture full state; final commit captures once. Cancel/30-second inactivity restores the committed native state. Only one native gesture exists at a time. Successful request IDs retain 32 exact fingerprints for replay safety; changed payloads with the same ID fail. This coarse offline editor is separate from the generic MIDI/control preview; the future live graph must unify those paths and add live per-block stage operations. Offline block targets come from a native catalog capped at 32 blocks, with five allowlisted controls per block and an optional staged NAM size; unknown targets, nonfinite/out-of-range values and fractional toggles are rejected. A load with an unrepresentable catalog rolls back before committing.
- Message pumping, model loading, capture and restore are non-real-time operations. The native processor's existing locks/threads have not been audited into an Oxidal real-time guarantee. Streaming ALSA, graph swaps, physical MIDI, per-block stage-command dispatch and full settings bindings remain pending.

## Dependency and patch provenance

`sources.json` pins TONE3000 v0.0.12, JUCE 9.0.3 and recursive AudioDSPTools/NAM dependencies. `patches/` retains the existing native stage extension and platform-specific qualification filesystem changes. The AudioDSPTools overlay qualifies a `LanczosResampler` alias with its namespace so GCC can compile the unchanged underlying type; no DSP algorithm is altered. Dependency edits remain restricted to exact before/after hashes. The standard Python suite checks repeat preparation, patch/artifact tampering, unreviewed dependency edits and external Git pointers. Stage-addon comments reference this public document instead of private development notes; code semantics are preserved. Patch inputs, outputs and addons are hashed. The original LV2 JUCE readback correction is not compiled by this direct-processor bridge: F18/F31 still require a real LV2-host test and cannot be inferred from direct parameter access.

TONE3000 and the contributed stage bridge are MIT-licensed; accompanying notices are retained. JUCE and recursive dependencies retain their upstream licensing in the downloaded trees. JUCE licensing and complete distribution notices must be settled before publishing a native artifact; no binary publication is part of this spike. The non-A2 rejection fixture is project-authored. The A2 qualification model remains in the pinned upstream checkout and is hash-verified; no factory/model weights are copied into this repository.

The native build record `qualification-build.json` in the selected output directory identifies host OS/architecture, source pins, overlay digest and library hash. Do not treat a successful build or finite audio as full TONE3000 compatibility. The full settings/operation inventory, exhaustive native preset/setting parity, real-time/physical Linux qualification and existing state/readiness regressions remain delivery gates.

## Experimental amp/cab partition

The adapter ports PiPedal's guarded amp/cab partition and optional pitch extraction
into `Engine::split_amp_cab`. It returns two opaque instance states without changing
the source. Explicit amp-head confirmation, mono unbranched routing, matching
embedded NAM metadata and a short mono PCM/float WAV are required. Combined
captures, extra effects, stereo/branch routing, unsupported WAV encodings and
conflicting metadata are rejected. No assets are silently converted or discarded.

Input gain/gate/calibration remain with the amp; output EQ/level remain with the
cab. Extracting pitch returns its controls and disables internal pitch; it does
not instantiate an external pitch effect. The native qualification suite checks
all 43 control assignments, source preservation, embedded-asset restore and
rejection paths using an explicitly authored factory-amp/mono-IR rig. Original
factory files remain unchanged.

`SplitStages::prepare` creates the paired amp/cab processors on the same owner and
waits for assets. The amp omits the final DC blocker; the cab applies it once before
output EQ/level, matching the whole-preset ordering. Stage roles are host-owned and
are not encoded in exported native presets. Restoring both opaque stage states with
ordinary `Engine::new` would apply the filter twice and is not the composition API.

The maintained rendered comparison checks the whole chain against this paired path
at 48 kHz with 128- and 64-frame blocks, including different input selection,
gain and tone-stack settings. A deliberately naive whole-processor pair must fail equivalence,
so the test detects the duplicated filter rather than merely checking finite output.
The fixture is a real factory amp with an authored mono multi-tap IR; it does not
prove all cabinets, active pitch extraction, spatial routing or structural transitions.

Split preparation currently rejects rates other than 48 kHz. At other rates the
native processor wraps each chain in its own resampling boundary; two instances
would therefore resample twice. A rendered 44.1 kHz comparison exposed this mismatch.
A shared graph boundary is required before admitting other split-stage rates.
Whole-preset playback retains its existing rate support.

This API is control-thread preparation only. The [mixed worker](mixed-engine.md)
now restores paired derivation recipes and scalar Save/recall at 48 kHz. Whole-native, saved-source amp/cab
and LV2 composition have a browser lifecycle; unsaved whole-rig conversion and live
structural replacement remain open. Preparing processors waits for model loads; it is not
a streaming callback operation or a latency, real-time or gapless claim.
Attribution is in [NOTICE-split.md](../native/tone3000/NOTICE-split.md).

## Prepared model audition boundary

`Engine::prepare_model` parses and prewarms one verified NAM/IR asset on a
background thread while retaining the current block. The owner polls readiness,
then explicitly commits or cancels. Missing targets, failed preparation and stale
block/settings snapshots reject the candidate without replacing the previous
model. Target settings are compared directly because native revision increments
can be coalesced during continuous gestures. Existing block identity and controls
survive replacement; insertion requires an exact existing insert slot.

The commit currently uses the native wet-mute transition. It is **not gapless**
and has not been qualified against physical audio deadlines. The adapter retains
old engines until preparation disposal; allocation, retirement and native locks
still need real-time review. Model preparation cancellation does not interrupt
an already-running parser, but prevents its result from being committed.

The maintained native qualification example covers invalid targets, failed
parsing, cancellation, stale edits, replacement, exact-slot insertion and
embedded offline recall after deleting the input asset. The sounding worker now uses this boundary for existing-block replacement,
with browser selection, confirmed assignment recovery and isolated offline Save.
See [the live audition path](audio.md#live-nam-audition-and-offline-copies).
Insertion remains an adapter capability rather than a browser authoring workflow.

The build can migrate explicitly hash-pinned previous overlays in its owned
source cache. Unknown local changes still fail; reference checkouts are never
rewritten by that migration.

### Empty native creation foundation

The isolated native preparation API can reset to an empty chain using the pinned
processor's preset defaults while retaining machine/device calibration scope. The
maintained qualification verifies restoring the previous captured session, serializing
an empty working base and reloading its exact insert-slot identities. Filling an insert
slot retains that block identity; native saved recall verifies the inserted model.
This whole-chain reset is intended for preparation owners and must not run on active PCM.

Owned copies now distinguish imported lineage (a source SHA-256) from a rig authored
from scratch (`source_sha256: null`). Existing string metadata remains readable, and
load/save of a created copy preserves its source-free origin. These are preparation and
persistence foundations. The playback `create` action accepts an audio stream and name,
prepares a verified empty base in the private `working-native` store, then opens audio.
It does not add an imported original or a named library copy. Stop/Resume retain the
working base; Save produces a source-free owned copy that recalls without the draft.
Boot playback requires explicitly saving and recalling that copy. Library → New preset
can now start this flow by selecting NAM model in Add effect. The sounding rig exposes
Add NAM for the next available left-lane insert slot. Preparation, cancellation and
revision checks use the same path as replacement. Slot identities and insertion order
are recorded for replay; replacing an inserted model preserves its original position
in that replay sequence. The maintained HTTP test fills beyond the initial slot count,
replaces an early insertion, restarts, then recalls a saved copy with both working and
audition stores hidden. Browser coverage creates, inserts, auditions and saves on all
six device profiles. Native/LV2 mixing, general routing, full authoring and gapless
switching remain separate work.

## IR selection and embedded recall

The same preparation transaction accepts an IR descriptor and verified WAV bytes. The
browser provides Cab / IR in the provider picker and Add IR on the sounding rig; a New
preset may start with either NAM or IR. IR model listing omits the NAM architecture
filter, matching the pinned native client's format distinction. Download identity and
native decoding remain separately checked; a filename is not proof a WAV is supported.

The maintained native qualification stages a project-authored mono PCM impulse, inserts
it into an empty rig, renders nonzero output, embeds it in a saved tone, deletes the
original input and compares rendered output after reload within 1e-5. The HTTP test adds
an IR after multiple NAM blocks and recalls the saved rig with both temporary stores
hidden. The browser scenario selects the IR via the real transaction and saves the
combined working rig. This does not qualify every WAV encoding, stereo convolution,
physical audio, gapless transitions or mixed LV2 hosting.

## Coexisting native processors

The bridge permits independently owned processor handles on its single JUCE owner.
Upstream TONE3000 already keeps DSP state per processor; shared logger/settings
initialization is not treated as permission to share mutable audio state. Each handle
retains its own processor, prepared models, buffers, capture storage and unique preset
staging directory. That directory is removed only after its processor has been destroyed. The existing
Rust `!Send`/`!Sync` boundary and native thread checks remain in force.

The maintained qualifier compares isolated A2 rendering with interleaved rendering
from two live handles running at different rates, changes one handle's gain, checks
staging isolation/cleanup, and destroys/recreates peers while
the other remains usable. A foreign-thread construction probe must fail. These checks
are prerequisites for native stages in a mixed graph. Construction/loading still runs
on the owner and may block; no concurrent DSP, background engine transfer, crossfade,
continuous-stream swap, latency alignment, overload admission or gapless behavior is
provided by this change. The current daemon still uses its existing separate workers.

## Reported processing delay

`Engine::latency_samples` exposes the native processor's host-rate algorithmic
latency after readiness and message pumping. The native qualifier checks the
48 kHz direct path, 44.1/96 kHz rate boundary, all four pitch windows, disable and
captured-state restoration. This is not hardware or round-trip latency. The pitch
processor reports a nominal mean delay; its moving tap and transient resynchronization
cannot be phase-corrected by a fixed host delay.

Portable mixed routing uses this report to prepare its path alignment and preserve
the declared delay while bypassed. Changing a processor's reported latency after
preparation requires a new graph; current live scalar controls exclude those
settings. This readback does not implement prepared switching or qualify timing.

`Engine::prepare_stream` is a separate, destructive-to-history preparation operation:
it waits for loaded assets and released native edit holds, then re-runs the native
processing preparation at the same rate/block size. Mixed graph construction uses
it before PCM to establish a defined resampling clock origin. It preserves controls
and loaded models but resets DSP histories; never use it on a sounding instance.
Asset-only `wait_ready` remains available for workflows that must retain state.

The pinned processor overlay adds an owner-only rate-boundary reset for this path.
The dependency's same-rate `Reset` clears sample buffers while retaining Lanczos
phase counters; simply re-running native preparation left repeated 44.1 kHz
comparisons timing-dependent. Recreating that boundary before preparation gives
both graphs a common phase origin. Original reference sources remain unchanged;
the builder accepts only recorded original/current/previous-overlay hashes.
