# oxidal-nam

Project-owned pure Rust NAM inference, currently unpublished. This crate is not a wrapper around `nam-rs`, not an asset catalog, and not yet wired to the appliance audio path. Runtime dependencies are serde and serde_json; allocation-counter is test-only.

| Supported initial scope | Bounds                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| File version            | NAM 0.5.4 only                                                                                      |
| Linear                  | Mono causal FIR, 1–65,536 taps, optional bias                                                       |
| LSTM                    | Mono, input size 1, 1–4 layers, hidden size 1–64, serialized initial hidden/cell state, scalar head |
| Sample rate             | Exact model/training rate, 8–192 kHz; no automatic resampling                                       |
| Buffer                  | Caller-provided mono f32 slices, configured maximum 1–8192 samples                                  |
| Unsupported             | WaveNet, ConvNet, SlimmableContainer, TONE3000 A2, other versions/channel layouts                   |

Loading validates the bounded document, shapes, exact weight counts and finite weights. It allocates all inference state before processing. `reset()` restores serialized initial state/history. `warm_up(samples)` is explicit, bounded, and non-real-time; the loader does not silently choose readiness or calibration behavior. `process()` performs no parsing, resizing, locking, I/O, or allocation. Invalid input is rejected before advancing state; output is silenced on error, and numeric overflow resets state. Metadata loudness/calibration is not automatically applied.

```rust,ignore
let mut model = oxidal_nam::Model::from_json(&model_bytes, 48_000, 64)?;
model.warm_up(24_000)?; // Choose according to the qualified preparation policy.
model.process(&input, &mut output)?;
```

The public error types differ between loading/preparation and processing; handle them explicitly in a host. Passing these tests does not establish real-time Pi deadlines or audible equivalence across a model corpus.

Tests compare 768 samples from project-authored synthetic Linear and one/two-layer LSTM models to independently compiled C++ NAM, for cold and warmed state and block partitions 64/7. Absolute tolerance: `4e-6`; processing allocations: zero for the measured paths. Source pins are stored in `tests/fixtures/parity.json`. No downloaded amp captures are bundled. See `NOTICE` for upstream provenance.

Normal workspace checks consume committed reference vectors and do not require the reference checkout or C++ compiler. To independently recheck/regenerate with clean pinned source and the matching Eigen headers:

```sh
node scripts/nam-oracle.mjs /path/to/neural-amp-modeler-core /path/to/eigen-87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1
# Add --write only when deliberately updating the recorded reference output.
```

Run that from the repository root. Core source pin: `92fab9d826535f729da89778e2171ccc5e817595`; Eigen pin: `87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1`. The oracle uses f32, normal tanh/sigmoid, and no fast-math. A reference update requires deliberate fixture review, numerical regression checks, actual model coverage, and ARM/hardware qualification before broadening the support matrix.
