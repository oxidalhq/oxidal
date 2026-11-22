# Oxidal Fuzz

Oxidal Fuzz is an original Rust LV2 effect for a bounded, responsive fuzz
voice. It has Drive, Tone, Mix and Level controls, with mono and stereo
bundles. It is safe to place before an amp or capture and every control can be
stored in a mixed-rig scene.

- **Bundle:** `oxidal-fuzz.lv2`; binary `oxidal_fuzz.so`; no added latency.
- **URIs:** `urn:oxidal:plugin:fuzz#mono` and `#stereo`.
- **Source:** `crates/oxidal-fuzz`; original code and no third-party DSP.
