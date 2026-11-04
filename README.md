<p align="center">
  <img src="apps/web/public/brand/wordmark.svg" alt="Oxidal" width="360">
</p>

<p align="center">
  <strong>A Rust-powered, device-local guitar and bass processor built around Raspberry Pi 5.</strong>
</p>

<p align="center">
  <em>Active development — the software, installation process and hardware support are still evolving.</em>
</p>

![Oxidal running the Afterlight example rig](docs/assets/screenshots/rig-afterlight.jpeg)

Oxidal uses Neural Amp Modeler (NAM) captures as its primary tone source for amp
heads, cabinets and complete captured rigs. TONE3000 preset compatibility and
supported LV2 effects turn those tones into playable rigs with prepared scenes. Its
Rust backend owns the control plane, library, device services and audio-engine
supervision. The browser is the controller; processing, presets and account data
stay on the device.

## Tone and effects

- **NAM first** — load licensed NAM captures for an amp head, cabinet or complete
  signal chain, with impulse responses available for cabinet and room processing.
- **TONE3000 preset compatibility** — import compatible `.t3kpreset` files and work
  with their native rig structure. Oxidal does not bundle TONE3000 presets or their
  associated captures.
- **Supported LV2 effects** — build around the core NAM tone with selected
  distortion, fuzz, compression, filtering, modulation, pitch, delay and reverb
  plugins. Curated support includes effects from Guitarix, Invada, MDA, SWH, x42,
  FOMP and Dragonfly, alongside Oxidal Hold and Oxidal Pitch. LV2 support is a
  qualified compatibility profile, not a claim that every LV2 plugin will work.

Upstream projects: [Neural Amp Modeler](https://www.neuralampmodeler.com/),
[TONE3000](https://www.tone3000.com/) and [LV2](https://lv2plug.in/).
See Oxidal's [native preset adapter](docs/native-tone3000.md) and
[LV2 compatibility notes](docs/lv2.md) for supported workflows.

## Playing live

- **Flexible rigs** — arrange native processors and supported LV2 effects in serial,
  parallel and scene-based signal paths.
- **Scenes and MIDI** — preload scenes and switch from the browser or a mapped
  MIDI controller. Supported layouts can retain delay and reverb trails.
- **Sound Check** — set up the audio interface, match levels and monitor live
  audio and processing health.

| Perform                                                                 | Sound Check                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| ![Oxidal Perform view](docs/assets/screenshots/perform-afterlight.jpeg) | ![Oxidal Sound Check](docs/assets/screenshots/sound-check.jpeg) |

[See more screenshots](docs/screenshots.md)

## Raspberry Pi appliance

Oxidal has a custom headless Linux image based on Raspberry Pi OS Lite. It sets
up the audio services, supported effect packs and a password-protected Wi-Fi
hotspot. Join the hotspot from a phone or tablet and open `https://oxidal.local`
using the generated device credentials and certificate setup. Local playback
works offline. You can also join an existing Wi-Fi network or use Ethernet.

Presets and device settings live on a separate data partition. Once you've
checked your audio setup, you can choose a saved session to load at boot. See the
[image build and setup guide](os/README.md#phone-access-and-first-sound).
The upstream base image comes from [Raspberry Pi OS](https://www.raspberrypi.com/software/operating-systems/).

## Repository scope

This repository contains the Oxidal software, browser interface, appliance image
recipes and documentation. The hardware controller is developed separately.

## Acknowledgments

Oxidal grew out of Richard Sentino's integration patches for
[PiPedal](https://github.com/rerdavies/pipedal) and the
[TONE3000 plugin](https://github.com/tone-3000/tone3000-plugin).
Thanks to both projects and their contributors. See Richard's
[archived PiPedal integration](https://github.com/rixrix/pipedal/pull/1) and the
[archived TONE3000 stage bridge](https://github.com/rixrix/tone3000-plugin/pull/1).

## Architecture

```mermaid
flowchart LR
    UI[Browser] <-->|HTTPS + events| Proxy[Appliance nginx]
    Proxy <--> API[Rust daemon]
    API --> Store[Device-local library]
    API --> Device[Wi-Fi and device helper]
    API --> DSP[Supervised audio worker]
    MIDI[MIDI controller] --> DSP
    Input[Audio in] --> DSP --> Output[Audio out]
    DSP --> Native[NAM and TONE3000-compatible rigs]
    DSP --> LV2[Supported LV2 effects]
```

The control plane owns the API, library and device settings. A supervised worker is
the single owner of the audio interface. Read the
[architecture guide](docs/architecture.md) for process boundaries and contracts.

## Current status

The working appliance runs live NAM-based audio, supports compatible TONE3000 preset
import, prepared scene recall and selected LV2 effects, and exposes guitar, MIDI,
audio and health workflows in the browser. Automated checks cover the Rust services,
web application, contracts, packaging and isolated audio workers.

Oxidal targets x86-64 Linux and Raspberry Pi ARM64. Physical-interface coverage,
real-time qualification, recovery and installation across supported hardware remain
in progress. Use a fresh SD card for Raspberry Pi experiments.

Oxidal does not distribute TONE3000 presets, NAM captures, impulse responses or
provider downloads. Factory images contain Oxidal-authored effects-only examples;
players supply assets they are licensed to use. The tiny `.t3kpreset` files in the
test suite are project-authored parser fixtures with no model weights or playable
tone.

## Development

Use Node 22.21.0, pnpm 10.32.1 and Rust 1.95.0.

```sh
rustup toolchain install 1.95.0 --profile minimal --component clippy,rustfmt
npm install --global pnpm@10.32.1
pnpm bootstrap
pnpm hooks:install
pnpm dev
```

Open <http://127.0.0.1:5173>. No Raspberry Pi is required for browser and control
plane development.

```sh
pnpm check
pnpm guardrails:prove
pnpm contract:check
pnpm release:dry-run
```

Start with the [documentation index](docs/README.md),
[development guide](docs/development.md), [web interface](apps/web/README.md) or
[appliance image guide](os/README.md).

## License

Copyright © 2026 Richard Sentino.

Oxidal's original code is licensed under the [Apache License 2.0](LICENSE). Some
optional native components use separately licensed dependencies; see
[third-party licensing](THIRD_PARTY.md) before building or distributing them.

The Oxidal name and logo are not granted under the Apache licence.
