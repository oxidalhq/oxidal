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

### MIDI input events

The shared byte decoder offers an unmapped `InputEvent` path for PC/CC, note
press/release and defined real-time bytes. Zero-velocity Note On is exposed as
Note Off. Running status and incomplete messages survive interleaved real-time
bytes; system-common and SysEx cancel running status. The event types are separate
from the serialized PC/CC `Message` contract. The existing worker mappings and
hardware reader's `read` method still dispatch only PC/CC.

The optional Linux `Input::read_events` method exposes the same decoder through
one nonblocking read of at most 64 bytes. Consumers own timestamps, passive
learning, capability checks, disconnect cleanup and bounded action scheduling.
This decoder foundation does not enable note mappings, hold actions, MIDI clock
following or controller feedback in the current workers.

### Ordered PC/CC observation and learning

Every PC/CC message a worker receives is recorded in arrival order in the MIDI
status: `events` counts messages, `last` is the newest and `recent` keeps up to
32 entries, each with a sequence number equal to the count after it. A consumer
that remembers the last sequence it processed can detect overwritten messages
(a gap) or a worker restart (a lower count); a repeated Program Change is a
second press, not a duplicate. The log is bounded and updated outside audio
callbacks.

Passive learning is a gate on dispatch: while `learning` is set, messages are
recorded but never reach the action path, so learning a switch cannot sound its
current assignment. A learn window ends after 30 seconds on its own and any
configuration change cancels it, so a lost browser cannot leave footswitch
control disabled. `POST /midi/learn` starts or ends a window on the playing
engine, and Protect refuses starting one. The web Learn buttons and the
controller message check hold the gate open while they listen.

Global preset recall consumes every recorded message in order, so a Bank Select
pair arriving just before a Program Change is applied together with it rather
than collapsed to the last message of a polling interval.

### Device controls

The MIDI map carries three optional device-wide triggers outside every preset
map: Previous preset, Next preset and Mute output. Each is one Program Change or
one CC press (value 64 or more). Bank Select CC 0 and 32 are refused, two actions
cannot share a number, and a trigger that a preset mapping already uses is
refused so one press never runs two actions. Previous and Next step through the
current Mine set-list, stop at the first and last preset with a reason, and
recall through the same path as Program Change, so a refused or unready preset
leaves the current sound playing. Mute flips the worker-owned output mute, so no
other copy of that state can disagree. Presses are handled one at a time in
arrival order. `GET /midi/action` reports the newest outcome and
`POST /midi/navigate` runs Previous or Next for the Perform buttons. The Tuner
needs the browser and is not a footswitch action yet.

### Several controllers

The first controller keeps its existing settings; up to three more can be added,
each enabled explicitly in the map (`extra_inputs`), never merged in on
detection. Each has its own endpoint, channel filter, port, decoder and retry
timer, so one unplugged device neither stalls nor corrupts another and a reconnect
starts from a clean decoder with no replayed press. Every logged message carries
its source, and Bank Select is kept per controller and channel, so two pedals that
send the same Program or CC never share a bank. Controllers share the playing
preset's assignments; only the channel filter differs per source. The same device
cannot be added twice, and extra controllers require a first one. Passive learn can
be limited to one controller. A controller that disappears keeps its saved entry
and shows as not connected.

Source: [MIDI decoder and input](../crates/oxidal-audio/src/midi.rs), with wire
message identifiers from the [MIDI Association](https://midi.org/summary-of-midi-1-0-messages).

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
