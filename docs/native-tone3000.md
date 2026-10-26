# Native TONE3000 adapter qualification

`oxidal-tone3000` provides an **optional offline native editor** connected to the daemon through a dedicated worker process. It calls the real pinned TONE3000 processor through a bounded C ABI. The adapter itself is not an ALSA driver, LV2 host, real-time-qualified callback implementation, complete settings editor or shipping audio engine. The same offline adapter builds on macOS and Linux. Native execution has been qualified on macOS ARM64 and Debian Bookworm ARM64 without a display server; A separate experimental Linux playback worker now uses this adapter with ALSA; see [audio lifecycle](audio.md). Physical-device and real-time qualification remain required.

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

The same gate also exercises tone-preset load/save, owned-copy provenance, preview/cancel/commit, device-setting preservation, storage failure and recreation from disk. It runs the existing desktop/mobile Playwright suite against the real native worker, including revision/owner conflicts, duplicate requests and abandoned-edit rollback. This does not use a simulated native backend.

To review the editor locally after building the native library:

```sh
OXIDAL_NATIVE_EDITOR=1 pnpm preview
```

Open Library, import a `.t3kpreset`, select it under Native preset editor and load it. The supported controls in this first slice are bass, output level, input calibration, oversampling enable and factor. Other settings remain unqualified. A staged control accepts a final commit only; previews cannot trigger repeated reloads. The UI shows authoritative native values and an explicit normalized 0–1 edit value. Live audio stays unavailable.

Owned copies use fresh `oxidal-` identities and preserve the source SHA-256 in metadata. Each copy is an immutable snapshot in the library's `owned/` directory; saving the same name again makes another copy. Atomic directory publication keeps metadata and native bytes together. Files are bounded and integrity checked again on reload. This internal whole-tone representation is not the final mixed `.oxpreset` format or a provider export/sync endpoint. The original file is never passed to native save or rewritten.

Calibration and oversampling survive tone loads and are excluded from saved tones. The preview starts a fresh isolated native settings directory each time; durable device profiles are still future work. Owned copies persist in `.local/presets/owned`. Native preset selection itself is not restored automatically on daemon restart.

The normal `pnpm check` invokes this gate on macOS or Linux when the native dependency cache is prepared; otherwise it explicitly reports native qualification as not run. Platform-independent checks and configured Linux CI do not imply that this optional native gate ran. The `native` Cargo feature must be enabled explicitly and requires the built library directory; there is no simulated native fallback.

## State, threads and bounds

- The Rust wrapper owns one native handle, is neither `Send` nor `Sync`, and uses exclusive mutable borrows. The native bridge additionally checks the owning thread and rejects a second concurrent instance. This is a temporary qualification limit, not the intended multi-instance host architecture.
- All native exports catch C++ exceptions. Input sample-rate, block-size, parameter-value, string and buffer bounds are validated. Audio is stereo, at most 2048 frames, with finite input/output checks. Control JSON is bounded to 256 KiB and captured state to 32 MiB.
- `State` can only be constructed from a native capture. Arbitrary imported bytes are not accepted through that safe Rust type. Complete native session state is different from a tone preset: this gate does not replace the bounded `.t3kpreset` importer or establish its audio fidelity.
- Native settings, logs, model stash and preset discovery use a newly created `OXIDAL_QUALIFICATION_DATA` directory. Required isolation patches redirect macOS/Linux JUCE special folders and factory discovery. Linux uses `user/.config` inside the isolated root; macOS uses `user/Library`. This is explicitly test-only filesystem behavior; do not ship this library as a production plugin. No environment changes are made to `HOME` or the installed TONE3000 data.
- The native worker owns JUCE on its process main thread. A one-slot input queue lets it continue pumping and expire edits while idle. The daemon serializes bounded IPC, rejects contention, and kills/disables the worker on a protocol failure or 25-second timeout. It does not replay uncertain operations or restart silently. A fresh worker session invalidates stale commands. Native startup supplies JUCE's rate/block metadata before `prepareToPlay`, including for EQ coefficient calculations.
- Edit requests carry session/revision, owner/token, sequence and request ID. Preview changes never capture full state; final commit captures once. Cancel/30-second inactivity restores the committed native state. Only one native gesture exists at a time. Successful request IDs retain 32 exact fingerprints for replay safety; changed payloads with the same ID fail. This coarse offline editor is separate from the generic MIDI/control preview; the future live graph must unify those paths and add per-block stage operations.
- Message pumping, model loading, capture and restore are non-real-time operations. The native processor's existing locks/threads have not been audited into an Oxidal real-time guarantee. Streaming ALSA, graph swaps, physical MIDI, per-block stage-command dispatch and full settings bindings remain pending.

## Dependency and patch provenance

`sources.json` pins TONE3000 v0.0.12, JUCE 9.0.3 and recursive AudioDSPTools/NAM dependencies. `patches/` retains the existing native stage extension and platform-specific qualification filesystem changes. The AudioDSPTools overlay qualifies a `LanczosResampler` alias with its namespace so GCC can compile the unchanged underlying type; no DSP algorithm is altered. Dependency edits remain restricted to exact before/after hashes. The standard Python suite checks repeat preparation, patch/artifact tampering, unreviewed dependency edits and external Git pointers. Stage-addon comments reference this public document instead of private development notes; code semantics are preserved. Patch inputs, outputs and addons are hashed. The original LV2 JUCE readback correction is not compiled by this direct-processor bridge: F18/F31 still require a real LV2-host test and cannot be inferred from direct parameter access.

TONE3000 and the contributed stage bridge are MIT-licensed; accompanying notices are retained. JUCE and recursive dependencies retain their upstream licensing in the downloaded trees. JUCE licensing and complete distribution notices must be settled before publishing a native artifact; no binary publication is part of this spike. The non-A2 rejection fixture is project-authored. The A2 qualification model remains in the pinned upstream checkout and is hash-verified; no factory/model weights are copied into this repository.

The native build record `qualification-build.json` in the selected output directory identifies host OS/architecture, source pins, overlay digest and library hash. Do not treat a successful build or finite audio as full TONE3000 compatibility. The full settings/operation inventory, exhaustive native preset/setting parity, real-time/physical Linux qualification and existing state/readiness regressions remain delivery gates.
