# Third-party licensing

The repository-level Apache License 2.0 covers Oxidal's original code and
documentation. It does not replace the licences of dependencies or grant rights to
presets, captures, models, impulse responses, artwork or trademarks.

## JUCE

Optional native components build against JUCE 9.0.3. JUCE is not covered by
Oxidal's Apache licence and is not vendored in this repository. JUCE offers AGPLv3
and commercial licensing paths.

Oxidal intends to use an appropriate commercial JUCE licence for distributing
non-AGPL JUCE-linked binaries. Until that licence is in place, the project does not
publish those binaries. Anyone building or distributing a JUCE-linked component
must independently select and comply with an applicable JUCE licensing path.

The JUCE-linked boundary currently includes the native TONE3000 adapter and native
pitch component. See [`native/tone3000`](native/tone3000) and
[`native/pitch`](native/pitch) for their build-specific notices.

The repository includes patches with excerpts of JUCE source. Those excerpts
remain subject to the applicable [JUCE licensing terms](https://juce.com/get-juce/).

## TONE3000 source code

The native adapter builds against a pinned revision of the
[TONE3000 plugin](https://github.com/tone-3000/tone3000-plugin), licensed under
the MIT License. See the [source manifest](native/tone3000/sources.json) for the
exact revision. TONE3000 source is not relicensed by Oxidal. The retained licence
and contribution notices are in:

- [`native/tone3000/LICENSE-TONE3000`](native/tone3000/LICENSE-TONE3000)
- [`native/tone3000/LICENSE-STAGE`](native/tone3000/LICENSE-STAGE)
- [`native/tone3000/NOTICE-split.md`](native/tone3000/NOTICE-split.md)
- [`native/pitch/NOTICE`](native/pitch/NOTICE)

## Audio decoding

Backing-track import decodes WAV and MP3 with the Symphonia crates, licensed
under the Mozilla Public License 2.0 and used unmodified. The licence text,
locked versions and source location are in
[`licenses/symphonia`](licenses/symphonia). Resampling (`rubato`) and loudness
measurement (`ebur128`) are MIT-licensed.

## Other native and model code

The native Hold and Swell adapters and portions of the project-owned NAM implementation retain
their upstream MIT notices:

- [`native/hold/NOTICE`](native/hold/NOTICE)
- [`native/swell/NOTICE`](native/swell/NOTICE)
- [`crates/oxidal-nam/NOTICE`](crates/oxidal-nam/NOTICE)

## LittleFly LV2 bundle

Oxidal bundles the DSP-only LittleFly LV2 plugin from
[brummer10/LittleFly.lv2](https://github.com/brummer10/LittleFly.lv2), pinned at
`d1d30aeb97de2134e44101eee89ab3f5697fb74f`. Its upstream 0BSD licence is kept
in [`thirdparty/lv2/littlefly/LICENSE`](thirdparty/lv2/littlefly/LICENSE). The
optional X11 UI is not included in the appliance bundle; the LV2 DSP binary and
its upstream Turtle metadata are unchanged.

Rust, JavaScript and system dependencies retain their own licences. The locked
dependency checks and release process must remain green before distribution.

## Presets and audio assets

Oxidal does not distribute TONE3000 presets, NAM captures, impulse responses or
provider downloads. Users are responsible for the rights to assets they import.
Project-authored binary parser fixtures under
[`crates/oxidal-presets/tests/fixtures`](crates/oxidal-presets/tests/fixtures) contain
no model weights, audio or playable tone.

Local preset import and TONE3000 catalog access are separate features. Catalog
access is governed by the [TONE3000 API terms](https://www.tone3000.com/api/terms),
including requirements for attribution, authenticated delivery and commercial use.

TONE3000, JUCE, NAM and other names belong to their respective owners. Inclusion of
an integration or notice does not imply endorsement or affiliation.

## Logos on the About page

`apps/web/public/brand/credits/` holds other projects' logos, shown only to
credit and link to them. They remain the property of their owners and are not
covered by Oxidal's licence.

| File               | Project            | Source                                                                                           |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| `rust.svg`         | Rust               | [rust-lang.org logo](https://www.rust-lang.org/logos/rust-logo-blk.svg)                          |
| `tone3000.svg`     | TONE3000           | Wordmark in TONE3000's own [plugin repository](https://github.com/tone-3000/tone3000-plugin)     |
| `nam.png`          | Neural Amp Modeler | Site icon of [neuralampmodeler.com](https://www.neuralampmodeler.com), resized to 128 px         |
| `agenticflowx.svg` | AgenticFlowX       | `assets/agenticflow_icon_minimal.svg` in [AgenticFlowX/afx](https://github.com/AgenticFlowX/afx) |
