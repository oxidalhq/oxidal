# LV2 plugins and attributions

Oxidal supports a tested subset of LV2. A plugin is listed here because it is
built with Oxidal, bundled with the appliance or admitted by the Linux host
harness. This is not a claim that every plugin from a collection is suitable
for every rig or Raspberry Pi workload. See [LV2 host limits](lv2.md).

## Oxidal effects

Each effect provides mono and stereo LV2 plugins.

| Effect  | Licence                                         | Source and algorithm references                                                                           |
| ------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Bloom   | Apache-2.0                                      | [`crates/oxidal-bloom`](../crates/oxidal-bloom), [references](../crates/oxidal-bloom/REFERENCES.md)       |
| Echo    | Apache-2.0                                      | [`crates/oxidal-echo`](../crates/oxidal-echo), [references](../crates/oxidal-echo/REFERENCES.md)          |
| Motion  | Apache-2.0                                      | [`crates/oxidal-motion`](../crates/oxidal-motion), [references](../crates/oxidal-motion/REFERENCES.md)    |
| Moment  | Apache-2.0                                      | [`crates/oxidal-moment`](../crates/oxidal-moment), [references](../crates/oxidal-moment/REFERENCES.md)    |
| Sustain | Apache-2.0                                      | [`crates/oxidal-sustain`](../crates/oxidal-sustain), [references](../crates/oxidal-sustain/REFERENCES.md) |
| Fuzz    | Apache-2.0                                      | [`crates/oxidal-fuzz`](../crates/oxidal-fuzz), [references](../crates/oxidal-fuzz/REFERENCES.md)          |
| Wah     | Apache-2.0                                      | [`crates/oxidal-wah`](../crates/oxidal-wah), [references](../crates/oxidal-wah/REFERENCES.md)             |
| Hold    | MIT                                             | [`native/hold`](../native/hold), [references](../native/hold/REFERENCES.md)                               |
| Swell   | MIT                                             | [`native/swell`](../native/swell), [references](../native/swell/REFERENCES.md)                            |
| Pitch   | MIT adapter; TONE3000 and JUCE terms also apply | [`native/pitch`](../native/pitch), [notice](../native/pitch/NOTICE)                                       |

Except for Pitch, these effects are original Oxidal code. Their reference files
identify the papers, books and standards used for each algorithm. They do not
use a commercial pedal's source, firmware, recordings or parameter tables.

## Bundled third-party plugin

| Plugin    | Project                                                               | Licence | Oxidal copy                                                                            |
| --------- | --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| LittleFly | [brummer10/LittleFly.lv2](https://github.com/brummer10/LittleFly.lv2) | 0BSD    | Pinned source and licence in [`thirdparty/lv2/littlefly`](../thirdparty/lv2/littlefly) |

Oxidal bundles the LittleFly DSP plugin without its optional X11 interface.

## Optional Linux effect collections

These Debian packages are available through **Settings → Effects**. They are
not installed in a new appliance image. The usable count is the current
measured value compiled into the device helper. The
[LV2 qualification report](lv2.md#debian-13-arm64-results-2026-11-12) records
the test method, package versions and dated results.

| Collection       | Project site                                                                        | Debian package              | Harness-usable plugins |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------------- | ---------------------: |
| Guitarix         | [guitarix.org](https://guitarix.org/)                                               | `guitarix-lv2`              |                     70 |
| Dragonfly Reverb | [michaelwillis/dragonfly-reverb](https://github.com/michaelwillis/dragonfly-reverb) | `dragonfly-reverb-lv2`      |                      4 |
| Calf Studio Gear | [calf-studio-gear/calf](https://github.com/calf-studio-gear/calf)                   | `calf-plugins`              |                     37 |
| Invada Studio    | [Launchpad](https://launchpad.net/invada-studio)                                    | `invada-studio-plugins-lv2` |                     14 |
| x42              | [x42-plugins.com](https://www.x42-plugins.com/x42/)                                 | `x42-plugins`               |                     44 |
| MDA LV2          | [drobilla/mda-lv2](https://gitlab.com/drobilla/mda-lv2)                             | `mda-lv2`                   |                     31 |
| SWH              | [plugin.org.uk](http://plugin.org.uk/)                                              | `swh-lv2`                   |                     78 |
| FOMP             | [drobilla.net](https://drobilla.net/software/fomp/)                                 | `fomp`                      |                      4 |
| ZamAudio         | [zamaudio.com](https://www.zamaudio.com/)                                           | `zam-plugins`               |                     12 |
| DISTRHO Ports    | [DISTRHO/DPF-Plugins](https://github.com/DISTRHO/DPF-Plugins)                       | `dpf-plugins-lv2`           |                      9 |

Each collection keeps its own copyright holders and licences. Oxidal does not
relicense these packages. On a device, the effect panel links to the exact
copyright file installed under `/usr/share/doc/<package>/copyright`; a
collection can contain files under more than one licence.

## Plugins used by factory sounds

The factory collection currently has metadata for these third-party plugins.
They remain supplied by their own projects and Debian packages.

| Project          | Plugins                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guitarix         | GxAutoWah, GxBigMuffPi, GxChorus Stereo, GxCompressor, GxDuckDelay Stereo, GxEchoCat, GxOC-2, GxPhaser, GxRat, GxReverb Stereo, GxShimmizita, GxSustainer, GxTape, GxTremolo, GxTubeDelay, GxTubeScreamer, GxTubeTremelo, GxZita Reverb Stereo |
| Invada Studio    | High-pass Filter Stereo, Low-pass Filter Stereo                                                                                                                                                                                                |
| MDA              | Degrade, DubDelay, Leslie, RezFilter, RingMod, SubSynth, Tracker                                                                                                                                                                               |
| SWH              | Reverse Delay                                                                                                                                                                                                                                  |
| FOMP             | Auto-wah, Chorus, Phaser                                                                                                                                                                                                                       |
| Dragonfly Reverb | Hall Reverb                                                                                                                                                                                                                                    |
| x42              | Compressor Stereo                                                                                                                                                                                                                              |
| Calf Studio Gear | Multi Chorus, Reverse Delay, Saturator, Vintage Delay                                                                                                                                                                                          |
| DISTRHO Ports    | 3 Band EQ, Cycle Shifter, MaFreeverb, MaGigaverb, MVerb, Ping Pong Pan, Soul Force                                                                                                                                                             |

ZamAudio and LittleFly are supported but are not currently used by a factory
sound. The exact plugin URIs are kept in
[`apps/web/src/factoryRecipes.ts`](../apps/web/src/factoryRecipes.ts).
