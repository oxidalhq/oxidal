# Oxidal splitter dependencies

Oxidal invokes the Rust `demucs-onnx` runner as a local CPU process. The
runner loads ONNX Runtime and reads one Demucs graph and its JSON sidecar.
Oxidal handles MP3 decoding, job control and stem storage.
See [local splitter runtime](../../docs/media.md#local-splitter-runtime).

| Path           | Contents                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demucs-onnx/` | MIT-licensed Rust runner source from [commit 757ab9f](https://github.com/HRSadeghi/demucs-onnx/commit/757ab9face37c20edd2e08ac82410da82320763b), with its licence and locked dependencies.               |
| `onnxruntime/` | Unmodified Linux ARM64 CPU libraries from [ONNX Runtime 1.23.2](https://github.com/microsoft/onnxruntime/releases/tag/v1.23.2), with Microsoft's MIT licence, third-party notices and SHA-256 checksums. |
| `bin/`         | Launcher for the installed runtime layout.                                                                                                                                                               |
| `models/`      | Locally supplied model graphs and JSON sidecars. `SHA256SUMS.models` pins the four files used for Sprint 14.                                                                                             |

The runner uses `ort` 2.0.0-rc.13 with `load-dynamic`, `api-17` and `std`.
Oxidal changed the upstream Cargo feature selection to load the packaged
library, made the vendored crate a standalone Cargo workspace and omitted the
upstream README reference from its manifest. The runner source is byte-for-byte
upstream. Cargo resolves the Rust dependencies from the lockfile.

The upstream ONNX Runtime archive
`onnxruntime-linux-aarch64-1.23.2.tgz` has SHA-256
`7c63c73560ed76b1fac6cff8204ffe34fe180e70d6582b5332ec094810241e5c`.
The two shared libraries used by Oxidal are pinned in
[onnxruntime/SHA256SUMS](onnxruntime/SHA256SUMS).
Keep the software licence and dependency notices with any distributed runtime.

## Deploy to a development Pi

Place the four model files from `SHA256SUMS.models` in `models/` (or point
`OXIDAL_SPLITTER_MODELS` at them), then run `pnpm deploy:local splitter` from the
repository root. It checks the runtime and model checksums, builds the runner
for Linux ARM64 in Docker, packs `bin/`, `lib/`, `models/` and `notices/`, and
installs the release under `/var/lib/oxidal-splitter/releases/` with
`/opt/oxidal/splitter/current` pointing at it. Audio keeps running and the
daemon needs no restart. See the [OS image notes](../../os/README.md).

For a host test, point `OXIDAL_SPLITTER_RUNNER` at a runner built for the host
and `OXIDAL_SPLITTER_MODELS` at the models, as described in
[local splitter runtime](../../docs/media.md#local-splitter-runtime).

## Model weights

The [model card](https://huggingface.co/HRSadeghi/demucs-onnx#licence) describes
CC BY-NC 4.0 terms for the weights, while its metadata says MIT. The original
[Demucs maintainer statement](https://github.com/facebookresearch/demucs/issues/327)
also distinguishes the weights from the MIT source licence. Public
redistribution for these exact pinned exports is unresolved.
`models/` is Git-ignored for private evaluation.
See [model source and licence](model-source-and-licence.txt).
