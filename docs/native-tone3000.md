# Native TONE3000 adapter qualification

`oxidal-tone3000` is an **offline integration spike**, separate from the current daemon's control preview. It calls the real pinned TONE3000 processor through a bounded C ABI. It is not an ALSA driver, LV2 host, real-time-safe callback implementation, complete preset editor or shipping audio engine. Its first supported qualification host is macOS; Linux native integration remains required.

## Build and repeat the qualification

Install CMake, the platform C++ SDK and the repository's pinned Rust/Node toolchains, then run:

```sh
pnpm native:check
```

The native builder clones exact revisions and recursive dependencies into `.local/tone3000/source`, verifies them, applies hash-checked native-stage/isolation patches and builds a shared library. It never edits an installed plugin or external checkout. Downloads require network access on the first run. To reuse an already downloaded checkout at the pinned revision, copy it through the build command once:

```sh
python3 native/tone3000/build.py --seed /absolute/path/to/pinned-checkout
pnpm native:check
```

The seed must include the pinned recursive submodules and JUCE checkout under `libs/juce`. Only the new private copy is reset and patched. Existing generated source changes outside the reviewed overlay fail the build. Delete/recreate a disposable build cache explicitly if its inputs need replacement; the builder does not reset an existing source tree to conceal drift.

`pnpm native:check` is part of the existing tooling entry point: build, native-feature Clippy, and the Rust `qualify` example on the process main thread. The example uses assertions as a bounded integration test, rather than a GUI demo. Main-thread execution owns JUCE's message dispatch; an ordinary parallel Rust test function is unsuitable for that lifecycle. It checks all 43 native parameter descriptors against the source inventory, 36 tone parameters, four machine-default parameters, invalid calls, dry-path rendering, captured-state restoration, rejection of a project-authored non-A2 local file and loading a hash-pinned upstream A2 test model. The native local loader is A2-only at this pin; the adapter preserves that behavior. It destroys/recreates the native processor, removes the temporary input copy, moves its isolated model stash aside, and restores embedded model state. Rendered A2 output before/after restore must agree within 1e-5; this is native restore consistency, not independent cross-engine audio parity. The empty-path comparison includes the processor’s 5 Hz DC blocker. Readiness polling is bounded and inspects native load/failure flags; audio settling and numeric checks are separate.

The normal `pnpm check` invokes this gate on macOS when the native dependency cache is prepared; otherwise it explicitly reports native qualification as not run. Platform-independent checks and configured Linux CI do not imply that this optional native gate ran. The `native` Cargo feature must be enabled explicitly and requires the built library directory; there is no simulated native fallback.

## State, threads and bounds

- The Rust wrapper owns one native handle, is neither `Send` nor `Sync`, and uses exclusive mutable borrows. The native bridge additionally checks the owning thread and rejects a second concurrent instance. This is a temporary qualification limit, not the intended multi-instance host architecture.
- All native exports catch C++ exceptions. Input sample-rate, block-size, parameter-value, string and buffer bounds are validated. Audio is stereo, at most 2048 frames, with finite input/output checks. Control JSON is bounded to 256 KiB and captured state to 32 MiB.
- `State` can only be constructed from a native capture. Arbitrary imported bytes are not accepted through that safe Rust type. Complete native session state is different from a tone preset: this gate does not replace the bounded `.t3kpreset` importer or establish its audio fidelity.
- Native settings, logs, model stash and preset discovery use a newly created `OXIDAL_QUALIFICATION_DATA` directory. A required isolation patch redirects macOS JUCE special folders and factory discovery. This is explicitly test-only filesystem behavior; do not ship this library as a production plugin. No environment changes are made to `HOME` or the installed TONE3000 data.
- Message pumping, model loading, capture and restore are non-real-time operations. The native processor's existing locks/threads have not been audited into an Oxidal real-time guarantee. Streaming ALSA, graph swaps, Linux isolation, physical MIDI, stage-command dispatch and full settings bindings remain pending.

## Dependency and patch provenance

`sources.json` pins TONE3000 v0.0.12, JUCE 9.0.3 and recursive AudioDSPTools/NAM dependencies. `patches/` retains the existing native stage extension and two qualification filesystem changes. Stage-addon comments reference this public document instead of private development notes; code semantics are preserved. Patch inputs, outputs and addons are hashed. The original LV2 JUCE readback correction is not compiled by this direct-processor bridge: F18/F31 still require a real LV2-host test and cannot be inferred from direct parameter access.

TONE3000 and the contributed stage bridge are MIT-licensed; accompanying notices are retained. JUCE and recursive dependencies retain their upstream licensing in the downloaded trees. JUCE licensing and complete distribution notices must be settled before publishing a native artifact; no binary publication is part of this spike. The non-A2 rejection fixture is project-authored. The A2 qualification model remains in the pinned upstream checkout and is hash-verified; no factory/model weights are copied into this repository.

The native build record in `.local/tone3000/build/qualification-build.json` identifies source pins, overlay digest and library hash. Do not treat a successful build or finite audio as full TONE3000 compatibility. The full settings/operation inventory, native preset load/edit/save parity, real-time/Linux qualification and existing state/readiness regressions remain delivery gates.
