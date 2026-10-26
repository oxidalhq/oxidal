# Native preset fixtures

`authored-current.t3kpreset` (383 bytes) and `authored-legacy.t3kpreset` (301 bytes) are project-authored test data, independently serialized using JUCE 9.0.3 (`be29c81492b6151c8ea8d14c840e1311963b3a83`) and the TONE3000 v0.0.12 framing reader/writer baseline (`ab5e5ae4388753184687d67816815aa481f2cea9`). They contain no model weights or playable tone. They are shared by Rust reader/storage/HTTP tests and browser E2E tests.

Both encode `T3KPreset`, schema 1, name `Fixture – Δ`, ID `oxidal-native-framing-fixture`, an empty ChainSnapshot and Params, plus unknown/future typed values: int64 9007199254740991, double 0.125, true and binary bytes 0/1/127/128/255. The current file also has a matching `T3KPresetHeader`. The independent binary fixtures catch incorrect assumptions about JUCE integer widths, UTF-8, framing and opaque bytes; they do not establish audio fidelity.

- Current SHA-256: `452b9a1591f0c2165bfaac85305e5227ccc07ed83ea94b89ddcd56d0aa4473df`.
- Legacy SHA-256: `f163fa5a640904200e31c51fb372a9370ce563bb38b99c789f694a4e4c91a0b1`.

## Optional upstream factory corpus

The test `pinned_external_factory_corpus` uses the eight files from `resources/factory-presets` in the above TONE3000 revision. It pins every file hash, imports each into temporary storage, reads the exact original back and reloads the complete library. These upstream assets are not redistributed here and are not fetched by tests. Obtain them separately with appropriate rights, then run from the repository root with the pinned Rust toolchain selected:

```sh
OXIDAL_TONE3000_FACTORY_DIR=/path/to/factory-presets cargo test --locked -p oxidal-presets --test native pinned_external_factory_corpus -- --ignored --nocapture
```

Ordinary `cargo test` reports this test as ignored; it never silently reports a missing corpus as passed. Factory structural/storage success still does not imply DSP compatibility, edited round-trip fidelity or audio parity.

## Artwork metadata fixture

`authored-artwork.t3kpreset` is independently serialized project test data with
three blocks: amp, cab and space. The amp and cab deliberately share a title but
have different `artwork.example` image URLs; the space has no image. It contains
no model weights, third-party artwork or credentials. Rust tests use it to check
parent-block identity, offline cache restart/integrity and immutable originals.
No test contacts these example URLs. Browser presentation fixtures are separate
from the real HTTP/cache tests and do not claim provider connectivity.
