# Safe LV2 shortlist

This folder is the catalogue and licence gate for third-party LV2 bundles that
Oxidal may bundle. Only a bundle with a reviewed upstream licence, source
revision, checksums and notices is eligible for release. Safe first choices are
MIT, 0BSD, ISC, BSD-2-Clause, BSD-3-Clause and Apache-2.0.

| Candidate                   | Licence | Status           | Why it is on the list                                                                    |
| --------------------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------- |
| LittleFly.lv2               | 0BSD    | shortlist        | Small overdrive/distortion family and a permissive licence.                              |
| Airwindows selected effects | MIT     | shortlist        | Useful colour effects; pin each source revision and build only selected plugins.         |
| DPF selected plugins        | ISC     | audit per plugin | Good LV2 build framework, but each plugin's own licence and assets still need a receipt. |

ToobAmp remains qualification-only until its model and impulse-response asset
licences are clear. GPL and unclear-licence projects remain qualification-only;
they are not silently bundled. The actual bundle must carry its upstream
`LICENSE`/`NOTICE`, source URL and revision beside the packaged files.

Oxidal's own Fuzz and Wah are not third-party ports: they are original Rust
effects in `crates/oxidal-fuzz` and `crates/oxidal-wah`.

LittleFly is pinned in `littlefly/` at upstream commit
`d1d30aeb97de2134e44101eee89ab3f5697fb74f`, with its 0BSD licence retained.
Oxidal ships its DSP bundle without the optional X11 UI so the Pi host has no
GUI dependency.
