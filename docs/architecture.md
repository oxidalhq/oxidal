# Architecture

The browser controls Oxidal over HTTP and receives state updates through
server-sent events. Audio runs on the device. On the Raspberry Pi image, nginx
authenticates HTTPS requests and forwards them to the Rust daemon, `oxidald`,
which listens on loopback.

Source: [web app](../apps/web), [daemon and API routes](../crates/oxidal-api/src/lib.rs)
and [nginx configuration](../os/config/oxidal-nginx.conf).

## Live audio

The daemon starts and supervises separate workers. A shared device permit keeps
live playback and hardware probes from competing for the ALSA interface.

| Path                  | What it runs                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `/api/v1/rig-audio`   | Mixed rigs with native NAM/IR stages and supported LV2 plugins, including prepared scenes. |
| `/api/v1/audio`       | Standalone native saved-preset playback.                                                   |
| `/api/v1/graph-audio` | Standalone LV2 graph playback.                                                             |

The mixed worker uses `oxidal-engine` and `oxidal-graph` for routing. The
`oxidal-tone3000` adapter wraps native preset and DSP code, while `oxidal-lv2`
hosts installed effects. The workspace also has a separate Rust NAM inference
crate. The browser displays confirmed worker state, including live controls and
meters. Supported live sessions take device-local MIDI input for scene selection
and mapped controls.

Source: [mixed engine](../crates/oxidal-engine), [routing](../crates/oxidal-graph),
[native adapter](../crates/oxidal-tone3000), [LV2 host](../crates/oxidal-lv2) and
[Rust NAM inference](../crates/oxidal-nam).

The offline native editor and the opt-in development simulator have separate
state. Stopping live audio leaves the browser and editor available.

See [audio setup](audio.md), [mixed rigs](mixed-engine.md) and
[LV2 compatibility](lv2.md) for the limits of each path.

## Native original library

Imported `.t3kpreset` files are structurally checked and stored by SHA-256.
Oxidal retains the original bytes. Editing and saving a copy creates a separate
library entry. Rigs can also use local NAM and WAV IR files. A saved session can
be selected explicitly for boot. See [the library](library.md) and
[the preset format](presets/format.md).

## Appliance and device services

Oxidal's custom image builds on Raspberry Pi OS Lite (ARM64). It runs headless,
with a separate persistent data partition. NetworkManager handles Wi-Fi and the
built-in hotspot. Supported phones can show a local welcome page when they join,
and the control UI uses authenticated HTTPS.

A separate privileged helper handles network changes, power actions and
installation of supported effects packs over a restricted Unix socket.
See [image setup](../os/README.md), [device settings](device-service.md) and
[maintenance access](debug-console.md).

Source: [base image manifest](../os/manifests/base.json),
[hotspot welcome page](../os/config/oxidal-welcome.html) and
[device helper](../crates/oxidal-device).

## API and development

Rust types generate JSON Schema and TypeScript for the versioned API. The browser
validates incoming payloads and uses session and revision checks on live edits.
See the [development guide](development.md) for contract generation and checks.
