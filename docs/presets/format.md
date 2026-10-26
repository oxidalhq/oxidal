# Oxidal preset format

**Status:** draft proposal, revision 0.2. **Wire format:** `formatVersion: 1`, experimental until the native conformance gates below pass. The runtime stores immutable native `.t3kpreset` originals after bounded structural inspection (see [architecture](../architecture.md#native-original-library)). It does not yet implement this `.oxpreset` bundle importer, authoring, exporter, stripping operation or sync transport. Normative MUST/MUST NOT requirements describe the intended implementation.

## Purpose and choice

An edited TONE3000 preset belongs to Oxidal. It can return to TONE3000 only if the entire resulting tone is compatible. A mixed rig containing external LV2 processing remains Oxidal-only. The format must make an explicit, user-directed conversion to a separate pure tone straightforward without losing the original mixed rig.

Use **composition**: a versioned JSON manifest references an unchanged native TONE3000 preset payload and a separate Oxidal host section. A portable `.oxpreset` ZIP bundle holds the manifest and its resources. Do not translate TONE3000's full state into a competing JSON tone model, append fields to its native payload, or pretend `.t3kpreset` is JSON.

| Approach                                              | Assessment                                                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend the TONE3000 ValueTree with Oxidal children    | Close to the upstream tree, but external fields can be ignored/pruned by upstream writers and the file can falsely look like a playable TONE3000 preset. Rejected for the interchange format. |
| Reimplement every TONE3000 setting as JSON            | Readable, but requires an additional lossless typed-ValueTree codec and ongoing field/version migrations. Risks unknown fields and embedded model bytes. Not the canonical tone store.        |
| JSON manifest + native payloads + separate host state | Recommended. Keeps upstream format and its state authority intact, provides inspectable routing/metadata, and supports explicit removal of non-native processing.                             |

This is an Oxidal design choice informed by established patterns, not an existing cross-vendor preset standard. [OpenTimelineIO bundles](https://opentimelineio.readthedocs.io/en/v0.14/tutorials/otio-filebundles.html) demonstrate packaging a structured document alongside referenced media. [LV2 State](https://lv2plug.in/ns/ext/state) defines plugin state as port values plus typed properties, including mapped file resources. [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) provides the manifest contract. These precedents do not establish audio equivalence.

## Naming

Use `tone3000` in Oxidal-owned identifiers specific to the TONE3000 integration, and **TONE3000** for the brand in user-facing text. For example, the schema definition is `tone3000Instance`, instance IDs in these examples use `tone3000Main`, and resource IDs use `currentTone3000Preset` / `sourceTone3000Preset`. These example IDs remain references, not mandatory prefixes for user-created IDs.

Upstream compatibility identifiers are preserved exactly: `.t3kpreset`, `T3KB`, `T3KH`, `T3KPreset` and `T3KPresetHeader` are native format names, not Oxidal branding abbreviations to rename. Plugin URIs and original preset IDs retain their upstream/user-defined spelling.

## TONE3000 compatibility baseline

Inspected source revision: `ef6f178ae1ac6412b55fec6f058d86e640e5aaaf`. Source profile identifier: `tone3000-plugin:ef6f178ae1ac6412b55fec6f058d86e640e5aaaf`. This labels a codec/semantic baseline; it is not a binary signature or evidence that a patched build is equivalent. Maintain an installed compatibility registry with actual build hashes, dependency/patch pins and qualification results; do not treat a manifest's profile string as permission to execute a backend.

| Upstream construct                                                 | Meaning Oxidal preserves                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `T3KB` + binary body                                               | Legacy framing                                                                                                                          |
| `T3KH` + signed little-endian 32-bit header length + header + body | Headered framing; baseline reader limits the header to 64 KiB                                                                           |
| `T3KPresetHeader`                                                  | Header `id` and `name`                                                                                                                  |
| `T3KPreset`                                                        | Complete preset body; its `schemaVersion` is distinct from file framing and Oxidal `formatVersion`                                      |
| `ChainSnapshot`                                                    | `stereoEnabled`, `branchSide`, `branchAfterBlockId`, ordered `ChainBlocks` / `RightChainBlocks`, block settings and embedded model data |
| `Params` / `Param`                                                 | Upstream parameter IDs and denormalized values, including gate, pitch, tone stack, balance, Spread/Align and pan/polarity               |

The authoritative sources are [PresetFile.h](https://github.com/tone-3000/tone3000-plugin/blob/ef6f178ae1ac6412b55fec6f058d86e640e5aaaf/plugin/include/PresetFile.h), [PresetFile.cpp](https://github.com/tone-3000/tone3000-plugin/blob/ef6f178ae1ac6412b55fec6f058d86e640e5aaaf/plugin/src/PresetFile.cpp), [ProcessorPresets.cpp](https://github.com/tone-3000/tone3000-plugin/blob/ef6f178ae1ac6412b55fec6f058d86e640e5aaaf/plugin/src/ProcessorPresets.cpp) and [ProcessorHistory.cpp](https://github.com/tone-3000/tone3000-plugin/blob/ef6f178ae1ac6412b55fec6f058d86e640e5aaaf/plugin/src/ProcessorHistory.cpp). JUCE documents ValueTree's [binary serialization](https://docs.juce.com/master/classjuce_1_1ValueTree.html).

Presets and full processor/session state are different. Interface calibration, oversampling, solo, input mode, MIDI mapping and window size are not TONE3000 tone-preset fields in this baseline. Do not overwrite device/global settings when importing a tone. Pure export validates the tone preset, not equivalence of all possible host sessions.

## Container and manifest

```text
Example.oxpreset                    ZIP container; extension does not imply JSON
├── manifest.json                   UTF-8 JSON; manifest.schema.json applies
├── tone3000/current.t3kpreset       Current authoritative native tone
├── origins/tone3000-source.t3kpreset        Optional immutable original import
└── lv2/delay/                      Present only for a mixed rig
    ├── state.ttl                   Portable LV2 state when required
    └── files/...                   Mapped plugin assets, if any
```

An unpacked directory with the same contents is permitted for local storage/development; interchange uses the bundle. Persist via a sibling temporary file/directory and atomic replacement after validation. A separate on-disk database/cache may deduplicate resources internally but MUST materialize all required files for portable export. No network fetch is needed to validate or restore a complete bundle.

The [JSON Schema](manifest.schema.json) defines field shapes, bounds, enum values and unknown-field rejection. The semantic rules below are equally mandatory. A schema-valid manifest is not a valid preset or an export authorization.

| Field                              | Contract                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`, `formatVersion`          | Exactly `oxidal.preset` and integer `1`. Unsupported versions fail without rewriting.                                                                                                                                       |
| `id`, `name`                       | Oxidal UUID identity and display name. Name is not a path. A modified import/new copy has a new Oxidal identity, independent of the source TONE3000 ID.                                                                     |
| `tone3000.instances`               | One or more native tone instances, each with a stable local ID, a resource ID for its current `.t3kpreset`, a compatibility-profile ID, and optional original import provenance. Multiple instances make a rig Oxidal-only. |
| `oxidal`                           | `null` for the canonical pure-native tone, otherwise the host graph, LV2 instances and recall policy. It is the only place v1 host processing/routing is described.                                                         |
| `resources`                        | Complete resource catalog: local ID, bundle-relative path, kind, lowercase SHA-256 and exact uncompressed byte count. References use IDs, not external filesystem paths.                                                    |
| `extensions`, `requiredExtensions` | URI-keyed extension objects and required extension identifiers. Required extensions MUST exist in `extensions`; an unknown required extension blocks load/edit/export. V1 defines no extension semantics.                   |

Top-level metadata is intentionally small. Accounts, credentials, machine paths, device identifiers, live CPU/meter readings, authentication/session tokens and export-eligibility flags MUST NOT be serialized. Format extensions require an explicit capability/version contract, not arbitrary unknown top-level fields. Unknown optional extensions may be preserved as opaque metadata but MUST NOT silently affect sound. Any unrecognized extension blocks TONE3000 export until explicitly removed in a separate copy or qualified as non-sonic.

### Native tone state and provenance

The current native payload is the sole persistent authority for that TONE3000 instance. Browser projections and sliders are views, not a second tone store. A save MUST wait for confirmed backend changes and native serialization of that same committed revision; do not pair newer displayed controls with stale bytes. Assets embedded by upstream remain embedded. Do not copy factory/capture weights into the source repository to satisfy examples.

For an unedited import, retain the original payload byte-for-byte. Once edited, store the current native payload separately from immutable `origin.resource`. Preserve unknown native bytes on no-op saves. If a selected backend would discard unknown native fields during editing, reject the incompatible edit or provide a proven preservation path; do not silently claim full fidelity. Unknown/unsupported native formats may be retained for recovery but MUST NOT be applied or declared exportable merely because their hashes match.

An origin is provenance, not the active sound and not authority to overwrite a remote preset. `sourcePresetId`, when present, is opaque. Changes only to external effects MUST NOT reserialize/alter the TONE3000 payload. Backend lifecycle/build qualification and full session state remain separate from tone-preset bytes.

### Graph and LV2 state

V1 graph nodes are logical `input`, `output`, `tone3000`, `lv2`, `split` and `merge`. A node declares audio input/output port counts. Each edge joins one scalar audio output port to one scalar audio input port by zero-based index. Stereo needs two explicit edges; never infer stereo or sum signals implicitly. Input/output nodes refer to logical rig I/O, not hardware addresses. V1 has one input and one output node, each with one or two channels. No feedback cycles are supported.

- Node, instance and resource IDs MUST be unique in their scopes. Every reference resolves to the declared kind; every instance is used exactly once, and all nodes lie on an input-to-output path. Unused source provenance is allowed; unused processing instances are not.
- Ports MUST be in range; input nodes have no inputs, output nodes no outputs, and edge pairs are unique. Each destination port has at most one source. Every declared input port of a processing/output node is connected. Sources can fan out only via an explicit split node.
- TONE3000 nodes have one/two corresponding input and output channels according to a qualified backend profile. LV2 port counts match discovered audio ports in their declared index order; MIDI/Atom/Control ports are not audio edges.
- Split nodes have one input and two or more outputs, each copying that scalar input at unity. Merge nodes have two or more inputs and one output; `inputGains.length` equals input count and output is the explicit weighted sum. Use two split/merge nodes for independent stereo channels. Gain/level behavior is never implicit normalization.
- LV2 instances retain plugin URI, numeric control-port values keyed by stable symbols, portable state resource when needed, owned asset resource IDs and required feature URIs. Discover the installed binary; the bundle contains no plugin executable. A plugin that cannot save portable state is not silently treated as portable.
- Store LV2 typed property state in its native Turtle representation, using URI keys/types rather than process-local URIDs. Follow `state:mapPath`/`state:makePath`; each plugin's abstract files resolve only into its own declared bundle asset subtree. No absolute paths, external URI fetches, traversal or escaping symlinks are permitted. Turtle parsing does not execute code.
- Control values must match the plugin's units/ranges and be finite. If the state document also contains control values they MUST agree with `controls` at the plugin's representable precision; conflicting copies are an error. Restore opaque state off the audio callback, then confirmed control values, and activate only after readiness/validation.
- `bypassed` belongs to host processing and is preserved. Bypassing a node does not remove it from the saved rig or make export compatible.
- `recall.tails` requests `cut` or `preserve`. `preserve` requires a qualified persistent/retiring wet graph; a loader MUST report unsupported policy instead of dropping tails. No running delay-buffer/tail samples are serialized.

V1 contains one committed base rig. MIDI/controller mappings, device calibration and audio I/O setup stay in their own device/global documents; scene banks, setlists, alternate NAM backends, automation and snapshot overrides are outside this draft's v1 payload. They require a subsequent explicit schema/extension rather than partially serializing unsupported features. This is a deliberate first format slice, not a redefinition of the broader product requirements.

## Validation, ownership and lifecycle

Readers MUST reject duplicate JSON keys; numbers must be finite; manifest/schema resolution is local and does not fetch remote schemas. Apply these stages before mutating the active rig:

1. Check container layout, limits, canonical safe paths and ZIP entry types.
2. Validate the manifest against the exact supported schema; do not coerce types, fill defaults or delete unknown properties.
3. Validate unique IDs, references, graph invariants, extension support and resource ownership.
4. Verify every declared resource's size/hash, then decode native preset and LV2 state with bounded parsers and the declared qualified profiles. Hash integrity does not prove compatibility or authenticity.
5. Prepare resources/plugin instances off the audio callback and verify state/readiness. Only an explicit load action may commit a prepared rig; parsing or importing alone changes no sound.

Reject unlisted non-directory archive entries, missing files, duplicate/case-colliding paths, absolute/drive/UNC paths, backslashes, NUL, dot/dot-dot components, symlinks, special devices, encrypted files and methods other than ZIP Store/Deflate. Paths use the schema's restricted ASCII namespace; display names remain Unicode. Baseline import limits: 1 MiB manifest, 4,096 resources, 256 MiB per resource, 1 GiB total uncompressed data, depth 64 for structured native/state data, and 256 graph nodes. Enforce limits during streaming/decompression, not after extraction. Implementations may lower admission limits with a clear error; no truncation. An expanded directory receives equivalent containment/symlink checks. Never trust ZIP sizes alone.

An edit, rename/save, or extension change to an imported tone creates an Oxidal preset identity on first modification. Further saves retain that Oxidal ID; “Save as”/“Create compatible copy” creates a new ID. The original import is not overwritten. Save the complete consistent state or fail atomically, leaving the previous saved file and active rig intact. Define retention/garbage collection separately from logical deletion of shared resources.

## Pure export and sync eligibility

Eligibility is **computed**, never a trusted manifest boolean. All of the following MUST hold:

- Exactly one TONE3000 instance and a fully decoded, supported, current native payload with all required assets and tone parameters intact.
- `oxidal` is `null`. An explicit host graph, external LV2 instance/resource, alternate engine, host bypass/mix/routing/recall behavior or other non-native sonic setting blocks export. An equivalent identity graph may be converted to the canonical null form only through verified normalization; no graph is assumed equivalent just because it contains one tone node.
- No undeclared/unreferenced processing resources, required extensions or unknown extension semantics. Immutable original-tone provenance and explicitly qualified non-sonic metadata do not affect the sound.
- Every retained tone setting is expressible by the selected TONE3000 writer/profile. No dropped effects, approximate mappings or silent routing flattening.

A pure Oxidal preset stays an Oxidal preset locally even after export. Export writes only the current native `.t3kpreset`, never the manifest, host state or original payload in place of current edits. No edit: native bytes are identical. Edited: semantic equivalence is required; byte identity is not assumed. Destination overwrite, source identity updates and sync conflict handling require explicit actions. Default file export is “Save as”; it must not overwrite an imported source automatically.

Sync MUST use the same full validation/eligibility result immediately before submission, bound to the same saved revision/resource hashes. Concurrent edits invalidate an earlier result. Authorization, provider terms, network transport and conflicts are a separate design; this spec does not assert a public sync API exists. A mixed-preset sync request MUST fail before constructing/submitting provider data.

Recommended structured reasons: `UNSUPPORTED_FORMAT`, `INVALID_RESOURCE`, `UNSUPPORTED_NATIVE_STATE`, `MULTIPLE_TONE3000_INSTANCES`, `HOST_PROCESSING_PRESENT`, `UNKNOWN_EXTENSION`, `UNSUPPORTED_PLUGIN_FEATURE`, `REVISION_CHANGED`. Report the affected instance/resource and remediation without exposing credentials or native binary blobs.

## Explicit stripping: create a compatible copy

“Remove non-TONE3000 settings” is a conversion operation, not an export loophole:

1. Select a source Oxidal revision and, if needed, which TONE3000 instance to retain. Never automatically combine multiple native instances or bake external DSP into model/IR assets.
2. Preview every removal: external plugins (including bypassed ones and external pitch), host graph/gains/bypass, tail policy and non-native/unknown extension state. Explain that the resulting sound/recall behavior can differ.
3. After the user accepts that concrete removal preview, create a **new** Oxidal preset ID/name, keep the chosen instance's current native payload unchanged, set `oxidal: null`, and omit non-native instances/resources/extensions. Keep only its selected current/source payloads and permitted provenance; the original mixed rig remains untouched.
4. Re-run complete validation and native compatibility checks. Unknown data inside the retained native payload is not made supported merely by removing the host section.
5. Save the new copy. Only then expose explicit export/sync for that copy if it passes. Do not silently fall back to the original imported tone or export a TONE3000 subsection directly from the mixed source.

Users can also manually remove non-native processing, save the edited Oxidal preset and request normalization/validation. Nothing becomes a TONE3000 preset merely by renaming a file extension.

## Versioning and implementation authority

The committed schema is the authority for the manifest shape; this document is the authority for container, semantic and workflow rules. Future Rust models, browser types and codecs MUST share conformance vectors and fail CI on divergence. Schema validation does not replace semantic validation. Draft revisions may change before freeze; after freeze, format-1 meanings and its schema ID are immutable. Incompatible shapes/semantics require a new `formatVersion` and an explicit copy/migration path; preserve the input until migration completes. Unknown versions are never rewritten as version 1.

Eligibility and conversion previews bind to the active document revision, SHA-256 of the exact manifest bytes and the verified resource hashes. Even a metadata edit invalidates a cached result conservatively. Do not sign off an in-memory view and then export different on-disk/native state. Optional user metadata extensions cannot be a back door for unsupported audio behavior.

## Examples and conformance gates

[Pure edited manifest](examples/pure-edited.json), [mixed delay manifest](examples/mixed-delay.json), and [separate compatible-copy manifest](examples/compatible-copy.json) illustrate structure. These are **manifest-only, synthetic documentation examples**: sizes/hashes are placeholders, the example delay URI names no real plugin, and no native/audio payload is bundled. They pass shape validation but MUST fail full admission without actual matching native resources. They are not factory presets or audio compatibility fixtures.

`pnpm presets:check` validates the schema and examples and rejects representative invalid manifest shapes; it does not decode native payloads or implement eligibility. Before format 1 is frozen or runtime compatibility is claimed, implement and pass:

| Gate                    | Required evidence                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native framing/body     | Both T3KB/T3KH; invalid/truncated/oversized headers; schema versions; duplicate IDs; unknown fields; full pinned factory corpus and project-owned licensed assets                                              |
| Tone fidelity           | No-op byte preservation; every serialized tone setting; embedded NAM/IR bytes; edited semantic round trips; state/audio comparison against the pinned backend at defined rates/channel settings and tolerances |
| Mixed restoration       | Serial and parallel/split/merge; portable LV2 properties/control values/assets; missing plugin/features; out-of-range ports, fan-in and cycles; failed prepare leaves playing rig intact                       |
| Ownership and stripping | Imported originals unchanged; independent source/current bytes; mixed and bypassed-plugin export/sync blocked; selection/removal preview; new copy ID; post-conversion eligibility and revision-race rejection |
| Container failure       | Wrong hash/size, duplicate JSON keys, unsafe/duplicate ZIP paths, decompression limits, native parse bounds, symlinks, unknown extensions/versions and interrupted save                                        |
| Scope boundaries        | Device/global settings untouched; no credentials/executables/private source paths in exported bundles; offline restoration with no provider token                                                              |

Full product behavior also requires gapless/trails, hardware performance and provider integration qualification outside this format spec. Promotion from draft requires the format/codecs and acceptance evidence to be reviewed together; a schema-only pass is not approval of those capabilities.

## Offline artwork

Preset display metadata is inspected independently from the stored original:
`ChainBlock.toneJson` supplies the title, gear and first image URL. NAM, cab, IR,
space and other gear labels share this path; absent/malformed optional metadata
does not reject a valid preset. Model artwork belongs to its parent tone/block,
never to another asset just because their titles match.

Library, the native editor and sounding blocks show this metadata and locally
saved images. **Save artwork offline** downloads supplied images onto the device;
it requires internet access on that device once. It never changes the sounding
rig. Subsequent views and daemon/browser restarts use device storage, without
contacting the source. Files are shared by URL hash and checksum-verified; corrupt
or missing files show a fallback and can be downloaded again. A provider account,
model browser and automatic artwork downloads during future provider imports are
not implemented by this feature. Structural authoring must refresh the metadata
association when it becomes supported.

The authenticated appliance proxy also protects these same-origin API paths:
`GET /api/v1/presets/{id}/artwork?owned=false` lists block metadata and cached status;
`GET` on its `/{key}` child reads only cached PNG bytes; `POST` downloads the image
already associated with that exact preset/key. Owned copies use `owned=true`.
Arbitrary client URLs are not accepted. Public HTTPS only, checked/pinned DNS,
no ambient proxy or redirects, MIME plus raster decoding checks, 4 MiB downloads,
4096-pixel side and 64 MiB decode limits, one concurrent download and a 256 MiB
cache budget bound this non-audio work. PNG/JPEG/WebP become at-most-384-pixel PNG
thumbnails. Unsupported/redirected/expired sources remain readable text fallbacks.
Only new artwork saving stops when the cache is full; audio/model assets remain
untouched. Cache-management UI, broader provider metadata and automatic refresh
of expired signed URLs remain pending.

An opt-in maintained HTTP test checks a real source download without bundling
third-party images in the repository:

```sh
OXIDAL_ARTWORK_PRESET=/path/to/your/preset.t3kpreset cargo test -p oxidal-api \
  --test http source_artwork_download -- --ignored --nocapture
```

The preset must supply a reachable public image and the test machine needs
internet access. Ordinary unit/HTTP tests exercise offline restart, integrity,
wrong-asset rejection and response limits without contacting outside services.
Browser tests identify their presentation fixtures explicitly.
