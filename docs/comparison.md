# Comparison with other amp and effects units

Dated 2026-11-11. This page states what Oxidal measures on its own hardware next
to what four other makers publish. It does not rank the units.

- **Oxidal** figures come from this repository's measured documents. A figure that
  has not been measured on the Raspberry Pi is marked "pending Pi measurement"
  and is not estimated.
- **Reference units** (Neural DSP Quad Cortex, Fractal Axe-Fx III and FM9, Line 6
  Helix, HeadRush Prime) use only the maker's own specifications or manuals,
  numbered in [Sources](#sources). "Not published" means the cited sources give no
  figure. Manual versions differ in age; a newer firmware may change a figure.
- Oxidal's hardware for the measured figures is one Raspberry Pi 5 with a Hotone
  Jogg USB interface at 48 kHz. They are a guide for that hardware, not a
  guarantee (see [capacity](capacity.md)).

## Table

| Capability                                | Oxidal                                                                                                                                                                                                                                                                                                                     | Quad Cortex                                                                                            | Axe-Fx III / FM9                                                                                                                          | Helix                                                                                                                       | HeadRush Prime                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Simultaneous amp captures or models       | Lightest models: 14 or more at 256 frames (15 tested), 6 at 128, 3 at 64. Heavy presets: 7 fit at 256, 10 did not. A2 at 96 × 3: 5 A2 Full instances (6 failed), 7 A2 Lite (2 of 3 runs; 8 failed). [^capacity]                                                                                                            | The page says it can run "four amplifier models" with other effects; no exact limit is published. [Q1] | Axe-Fx III: two amp blocks of four channels each. [F1] FM9: two amp blocks of four channels each. [F3]                                    | Up to four amp, amp+cab or preamp blocks (two per path), limited by DSP. [H1]                                               | Not published. [R2]                                                                                         |
| Scenes or snapshots per preset            | Up to 64 per preset; Oxidal sounds use four to eight. A scene sets path levels and can change effect settings. [^factory]                                                                                                                                                                                                  | Eight scenes per preset. [Q2]                                                                          | Eight scenes per preset on both. [F2] [F3]                                                                                                | Eight snapshots per preset. [H1]                                                                                            | Scenes are assigned to footswitches; no per-rig count is published. [R1]                                    |
| Scene switching: gap                      | Scene gains ramp sample by sample over the preset's fade time. Gap and click measurement, prepared and unprepared: pending Pi measurement. [^scenes]                                                                                                                                                                       | The maker's FAQ says scenes switch "without any crossfade/gaps". [Q2]                                  | Scene changes "can be gapless and seamless". [F2]                                                                                         | Snapshots are described as "seamless"; no gap figure. [H1]                                                                  | Not published for scenes. [R1]                                                                              |
| Scene switching: trails                   | A delay or reverb placed after the selector keeps its tail through the switch. Tail preserved or cut per topology on the Pi: pending Pi measurement. [^trails]                                                                                                                                                             | Delay trails are kept in Scene and Stomp modes. [Q2]                                                   | Scenes give "perfect spillover" of delay and reverb. [F2]                                                                                 | Trails are kept across snapshots ("seamlessly with spillover delay and reverb trails"). [H1]                                | Tail spillover is a rig and per-effect setting; it does not work with an effects loop or USB audio on. [R1] |
| Whole-preset change                       | A prepared switch keeps other presets loaded ("Ready to switch"). Gaplessness is not claimed and not measured: pending Pi measurement. The experimental graph worker has no gapless switch. [^switch]                                                                                                                      | Preset changes "incur" an "inevitable" gap. [Q2]                                                       | Spillover across presets needs the same blocks in each preset; no gap figure. [F2]                                                        | A "small audible gap"; trails need Preset Spillover, which gives up one of the two DSPs. [H1]                               | The page states "gapless preset switching" with tail spillover; no figure. [R2]                             |
| Round-trip latency                        | Pending Pi measurement on the Jogg (`scripts/roundtrip-latency.py`). [^latency]                                                                                                                                                                                                                                            | Not published; USB is described as "ultra-low latency". [Q1]                                           | Not published; USB is described as "ultra-low latency". [F2]                                                                              | Not published; USB is described as "low-latency". [H1]                                                                      | Not published. [R1] [R2]                                                                                    |
| Routing: paths and splits                 | Serial chain; splits into parallel paths with per-path level, pan and polarity; preloaded paths mixed by scenes with a shared output chain; effects between the amp and cab stages of a compatible tone. No fixed path count is documented. [^routing]                                                                     | Grid of four rows of eight blocks, with splitters and mixers. [Q2]                                     | Layout grid with up to six full stereo paths on the Axe-Fx III. [F2] FM9: not published here.                                             | Two paths, each with A and B parallel lanes via Split and Merge blocks; up to 32 block locations, DSP permitting. [H1] [H2] | 14 slots per rig; straight, middle-split and immediate-split paths. [R1]                                    |
| Routing: effects before and after the amp | Both, as ordinary chain positions. Effects before the amp ran cleanly in the capacity tests. [^capacity]                                                                                                                                                                                                                   | Any order on the grid. [Q2]                                                                            | Any order on the grid. [F2]                                                                                                               | Any order within a path. [H1]                                                                                               | Any order within the slots. [R1]                                                                            |
| Capture                                   | Imports NAM captures and WAV IRs and auditions them in a running rig. It does not make captures. [^library]                                                                                                                                                                                                                | Neural Capture, created on the unit. [Q1] [Q2]                                                         | IR Capture utility for cab IRs; the manual documents no amp capture. [F2]                                                                 | Loads IRs in IR blocks; the manual documents no amp capture. [H1]                                                           | Amp Cloner captures amps, preamps and drive pedals. [R2]                                                    |
| Reamp                                     | Record DI before trim, gate and effects; reamp a DI through the playing rig and record its output; backing tracks. Results download as 24-bit WAV. [^media]                                                                                                                                                                | DI recording and reamp over USB. [Q2]                                                                  | USB reamp and process input over 8 × 8 USB audio. [F2]                                                                                    | DI recording and reamp over USB. [H1]                                                                                       | USB Reamp mode. [R1]                                                                                        |
| Effect library size                       | 303 effects pass the ARM64 smoke harness across ten collections, plus Oxidal Hold, Swell and Pitch. 140 finished Oxidal sounds are listed on a fresh image; effect packs and tones are installed by the player, none is shipped. A Pi run is still required before an effect counts as qualified on the device. [^effects] | "100+ effects", "90+ amps", "1000+ IRs". [Q1]                                                          | Axe-Fx III: "hundreds" of amp models in one block, 40+ block types, no effect count. [F2] FM9: 290+ amp models, 2,200+ factory cabs. [F3] | 112 amp models, 87 cab models, 274 effects models. [H2]                                                                     | 97 amps, 82 cabinets, about 110 effects, 300+ built-in IRs. [R2]                                            |

[^capacity]: [capacity](capacity.md): Raspberry Pi 5, Hotone Jogg, 48 kHz.

[^factory]: [factory collection](factory-collection.md#signal-layout-and-switching).

[^scenes]: [LV2 scene changes](lv2.md#scene-changes-and-stepped-controls). The ramp is covered by engine tests (`scenes_ramp_exact_samples_…`); a swell-time listening check on the Pi is also pending.

[^trails]: [mixed rigs and scenes](mixed-engine.md#preloaded-scenes-and-shared-effects) and [curated scalar Dragonfly Hall](lv2.md#curated-scalar-dragonfly-hall). The tail comparison (`qualify_tails`) is an engine test, not a Pi run.

[^switch]: [interface](interface.md#scenes-and-ready-presets) and [browser authoring](lv2.md#browser-authoring).

[^latency]: [audio setup](audio.md#physical-round-trip-latency) and [capacity](capacity.md#what-is-not-yet-measured), which lists round-trip latency as not yet measured.

[^routing]: [mixed rigs and scenes](mixed-engine.md) and [capacity](capacity.md#how-many-effects). The experimental graph worker admits up to 64 nodes and 128 edges ([LV2 host](lv2.md#prepared-graph-and-control-bridge)).

[^library]: [library](library.md#cabinet-groups-and-capture-details) and [audio setup](audio.md#live-nam-audition-and-offline-copies).

[^media]: [session media](media.md#record-di-and-reamp).

[^effects]: [LV2 host](lv2.md#debian-13-arm64-results-2026-11-12) lists per-pack results; the counts are the `usable_plugins` values in `crates/oxidal-device/src/packs.rs`. Guitarix 70, Dragonfly 4, Calf 37, Invada 14, x42 44, MDA 31, SWH 78, FOMP 4, Zam 12, DPF 9. All ten packs are in the Settings → Effects allowlist but are optional installs. See the [factory collection](factory-collection.md).

## Where Oxidal is behind

- **Capture count on A2 Full.** The Raspberry Pi runs 3 NAM instances reliably at 64
  frames and 6 at 128 with the lightest models, and heavy models fit fewer. The
  A2 Lite and A2 Full counts at 96 × 3 are not measured yet. The Quad Cortex
  page names four amp models at once.
- **Gapless whole-preset changes.** A prepared switch keeps presets loaded, but
  gaplessness is not claimed or measured, and no switch of the experimental graph
  worker is gapless. The Quad Cortex and Helix manuals say a preset change leaves
  a gap; HeadRush states gapless switching.
- **No round-trip latency figure yet.** Buffer size alone does not give it, and the
  physical measurement on the Jogg has not been run.
- **No IR, convolution or spring reverbs.** Plugins that need file or opaque state
  are not hosted: the host rejects Atom effects in browser authoring, and
  "IR/spring reverbs, vocoders, guitar-to-MIDI" are recorded as host gaps. The
  reverbs that pass the harness are algorithmic.
- **Other host gaps.** Sidechain inputs are rejected (Calf Envelope Filter,
  ZamGate and ZamCompX2); mono-to-stereo plugins are out of scope; two Guitarix
  plugins fail in the harness (Gx Tape Stereo crashes, Gxdetune times out, both
  contained); there is no live insertion, removal or reordering of LV2 nodes; and
  plugin state and DSP tails are not kept across a restart. See
  [LV2 compatibility](lv2.md#supported-boundary).
- **Stepped effect controls can still be audible.** A stepped control on the
  shared output chain or in a branch both scenes play changes at the fade
  midpoint, and plugins without internal smoothing can zipper on live edits.
- **Native TONE3000 controls are not scene controls.**
- **Capture creation.** Oxidal imports captures; it has no on-device capture
  workflow such as Neural Capture or Amp Cloner.
- **Pi qualification.** The Debian 13 harness results are from an ARM64 container,
  not the Pi. Runs longer than a few minutes at the capacity limits, other
  interfaces and sustained thermal load are not measured.

## How Oxidal figures are measured

Run these on the Pi against the running daemon. Each writes its results to the
output path you give; keep the platform, package versions, buffer size and rig
names with the results.

**Round-trip latency.** Use a two-channel capture: channel 1 gets a direct split
of the stimulus and channel 2 gets the Oxidal output. Record it on the same capture
device, then analyse it. The reference and the processed signal must come from
one recorder.

```sh
python3 scripts/roundtrip-latency.py generate --output stimulus.wav --count 8 --interval 0.5
python3 scripts/roundtrip-latency.py analyse --input capture.wav --output latency.json \
  --interface "Hotone Jogg" --period-frames 64 --period-count 3 --rig "<rig name>"
```

**NAM instance capacity.** `scripts/capacity-ladder.py` climbs a ladder of prepared
resident presets at each buffer size through `scripts/qualify-prepared.py`. A rung
passes only with zero xruns, deadline misses and invalid samples. The ladder stops
at its first failure.

```sh
python3 scripts/capacity-ladder.py --rigs rigs.json --restore rig-audio.json \
  --api http://127.0.0.1:3210 --frames 256,128,64 --counts 2,3,4,6,8,10,12,16 \
  --seconds 45 --out capacity-run
```

`rigs.json` lists `presets[{revision, name, native_instances}]`; `rig-audio.json` is
a saved `GET /api/v1/rig-audio` snapshot that the script restores afterwards.

**Scenes, trails and factory recipes.** `scripts/qualify-factory.py` replaces the
playing rig temporarily, measures a built-in riff with the output muted and
restores the owner snapshot on every exit.

```sh
python3 scripts/qualify-factory.py --api http://127.0.0.1:3210 \
  --published published.json --restore rig-audio.json --output factory-run.json
```

**Effect counts.** [LV2 host](lv2.md#offline-pack-smoke-checks) describes
`scripts/plugin-pack-check.py`, which runs `oxidal-plugin-check` per installed
pack without opening a sound device.

**Scene ramp, trails and tests.** `cargo test -p oxidal-engine` covers the scene
ramp (`crates/oxidal-engine/tests/latency.rs`) and scene controls
(`crates/oxidal-engine/tests/scene_controls.rs`). `pnpm lv2:check` runs the LV2
host suite.

## Pending Pi measurements

| Figure                                               | How to measure                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Scene-switch gap and click, prepared and unprepared  | Pi run of `scripts/qualify-factory.py`; no click metric is scripted yet |
| Delay and reverb tail preserved or cut, per topology | Pi listening and capture run; the tail comparison is engine-only today  |
| Gapless whole-preset change                          | Pi capture of a prepared switch                                         |
| Round-trip latency on the Jogg                       | `scripts/roundtrip-latency.py`                                          |

## Sources

All pages and PDFs were read on 2026-11-11.

| Tag | Source                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Neural DSP, Quad Cortex product page: <https://neuraldsp.com/quad-cortex>                                                                                    |
| Q2  | Neural DSP, Quad Cortex User Manual 1.0.2: <https://downloads.neuraldsp.com/file/quad-cortex/Quad%20Cortex%20User%20Manual%201_0_2.pdf>                      |
| F1  | Fractal Audio Systems, product family page: <https://fractalaudio.com/family>                                                                                |
| F2  | Fractal Audio Systems, Axe-Fx III Owner's Manual (firmware 20.x): <https://www.fractalaudio.com/downloads/manuals/axe-fx-3/Axe-Fx-III-Owners-Manual.pdf>     |
| F3  | Fractal Audio Systems, FM9 Owner's Manual (firmware 3.x): <https://www.fractalaudio.com/downloads/manuals/FM9/FM9-Owners-Manual.pdf>                         |
| H1  | Line 6, Helix 3.80 Owner's Manual: <https://line6.com/data/6/0a00051afda2673ccc1cc8e68/application/pdf/Helix%203.80%20Owner's%20Manual%20-%20English%20.pdf> |
| H2  | Line 6, Helix Floor product page: <https://line6.com/helix/helix-floor.html>                                                                                 |
| R1  | HeadRush, Prime User Guide v1.0: <https://cdn.inmusicbrands.com/HeadRush/prime/HeadRush%20Prime%20-%20User%20Guide%20-%20v1.0.pdf>                           |
| R2  | HeadRush, Prime product page: <https://www.headrushfx.com/jp/prime>                                                                                          |

The Quad Cortex manual is an early version (1.0.2) and the Axe-Fx III and FM9
manuals are for older firmware; later firmware can change these figures.
