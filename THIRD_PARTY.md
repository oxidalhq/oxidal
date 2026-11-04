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

The native adapter builds against a pinned TONE3000 source revision licensed under
the MIT License. TONE3000 source is not relicensed by Oxidal. The retained licence
and contribution notices are in:

- [`native/tone3000/LICENSE-TONE3000`](native/tone3000/LICENSE-TONE3000)
- [`native/tone3000/LICENSE-STAGE`](native/tone3000/LICENSE-STAGE)
- [`native/tone3000/NOTICE-split.md`](native/tone3000/NOTICE-split.md)
- [`native/pitch/NOTICE`](native/pitch/NOTICE)

## Other native and model code

The native Hold adapter and portions of the project-owned NAM implementation retain
their upstream MIT notices:

- [`native/hold/NOTICE`](native/hold/NOTICE)
- [`crates/oxidal-nam/NOTICE`](crates/oxidal-nam/NOTICE)

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
