# Mixed rigs and scenes

A mixed rig puts native tones and supported LV2 effects in one signal chain.
Oxidal prepares the graph before playback and runs it in a supervised worker.

| Choose            | When you want                                                      |
| ----------------- | ------------------------------------------------------------------ |
| Serial chain      | Saved native tones and effects arranged in order.                  |
| Split amp and cab | An effect between the amp and cabinet stages of a compatible tone. |
| Scenes            | Preloaded branches with a shared output chain.                     |

## Restore one LV2 block's defaults

The running rig exposes **Restore plugin defaults** for a selected LV2 block.
It uses the worker's exact node and control revision, and refuses while the rig
is preparing, switching, or fading a scene. The worker applies one
[verified control update](lv2.md#restore-controls-to-factory-defaults). The
finished update appears in the rig's confirmed controls and is included in the
next explicit Save. The saved preset and any stored scene settings keep their
values until explicitly edited and saved.

From **Preset actions → Discard live edits**, confirm **Discard edits and reload**
to reopen the playing preset version with its saved values. Audio restarts and
releases any caught loop. The device keeps the stream configuration and MIDI
mapping. If another viewer edits the rig during confirmation, reopen Discard to
review the current state.

## The rig canvas

Rig draws every topology with one renderer: a straight chain, any routing tree
and scene lanes. Blocks sit on a wire with a **+** in every gap. The **+** offers
**Add effect** or **Split here**. Split here makes two paths: the effect you
choose goes on Path 1 and Path 2 starts dry, with **+ Add effect** to fill it.

- **Paths.** A split stacks its paths, each captioned with its level and pan.
  Each path has a level, a pan and **Invert polarity**. Use **Add path** to
  add another and the path levels dialog to copy or remove one. A rig holds up to 64
  paths.
- **Moving blocks.** Drag a block to any gap, within a path or across paths.
  Without a pointer, focus the block and press Alt with an arrow key.
- **E-paper.** With the E-paper display setting the chain is a numbered list
  with path labels and buttons only. There is no dragging; level and pan use
  raise and lower steps.
- **Scenes.** In a scene preset each scene is a path of the scene split. Effects
  can go ahead of the scenes (shared by every scene), inside a scene after its
  tone, and after the scenes (shared again).
- **Read-only drawings.** A preset whose routing the editor cannot read is still
  drawn with its blocks and paths, but it cannot be rearranged there.

## Serial composition from saved tones

Open **Library → New preset**, add saved tones and installed effects, then
arrange them in order. For a mono effect, choose left, right or an average of
both inputs. Start playback to check the chain before saving.

## Separate amp/cab authoring

A compatible saved tone can be turned into linked amp and cab stages. The
supported split runs at 48 kHz and retains the exact saved source. Choose the
input and confirm the amp-head stage before adding effects between the two.

## Preloaded scenes and shared effects

- Select a scene to recall its branch mix. Toggle individual branches to try a
  different mix, then use **Update scene** to keep it.
- Put delay or reverb after the selector if you want its existing tail to carry
  through the switch.
- Branches remain ready and can use CPU even when muted. Check processing health
  with the full rig running.
- Use MIDI program changes or CC mappings for supported scene and branch controls.
- A scene can also set effect controls, such as a swell or delay time. Smooth
  controls glide over the preset's scene fade; stepped ones (modes, switches,
  note divisions) change while their branch is silent. See
  [scene changes and stepped controls](lv2.md#scene-changes-and-stepped-controls).
  The scene's settings list marks each control **glides** or **switches when
  silent**, and a scene keeps up to 32 control values. To rename, reorder,
  duplicate, delete or copy scenes, see [scene management](library.md#scene-management).

Version 3 scenes can also bypass nodes in a serial chain or a split. They
name the same native or LV2 processor nodes in every scene, up to 128 nodes.
The bypass transition blends each processor's output with its latency-aligned
input over the preset's scene fade. The processor keeps running so its history
is ready when the next scene switches it back on. Selecting another scene
during the fade starts from the blend already reached. A bypassed processor
still uses CPU. Direct bypass edits to the same nodes use that fade too.

The mixed worker confirms the target bypass values in its normal controls as
soon as it accepts the scene. Save retains the scene definitions and writes the
confirmed bypass values as the new preset defaults. Resume also restores those
confirmed targets. An in-flight blend and DSP history end with the session.

The shared `/api/v1/scene-draft` response includes a revision. When a draft
contains bypass or native capture edits, updating or clearing it requires that revision as
`expected_revision` in the PUT body. A stale revision returns HTTP 409 and
leaves the draft intact. Scene draft changes stay in the daemon until saved
to a preset.

Version 4 scenes also set the input gain, output gain and mix of specific NAM
and IR captures. The mixed worker validates the outer processor node and
the capture's stable native ID, then writes the confirmed targets in one
owner-thread operation. The native 50 ms smoothers continue from their current
audio values. The preset's merge and bypass fades have their own timing.
Working recovery restores confirmed targets, and Save keeps the capture IDs
in the embedded tone or the derived amp/cab recipe.

The worker reports `capture_defaults` from the immutable saved bundle when it
can report the complete list. Working changes and the startup scene can
change the current controls without changing those saved defaults. A version 4
preset can name its startup scene, which the worker applies before audio starts.

### Selective stomp groups

A stomp group switches only its listed blocks. For example, assign Echo and
Bloom to **Wet**. Pressing Wet turns both on when either is off and turns both
off when both are on. A manually changed TS9 stays where the player put it
until another action changes it. Recalling a named scene restores that scene's
saved settings, including its assignments for the grouped blocks.

The required portable extension `urn:oxidal:stomp-groups:1` stores a
`groups` array of 1–16 entries, each with an `id`, `name` and `nodes`.
IDs start with an ASCII letter and contain at most 64 ASCII letters, digits,
underscores or hyphens. Names are trimmed and at most 80 UTF-8 bytes.
Each group lists 1–16 distinct graph processor IDs present in the saved
bypass targets of every scene. Eligible targets include LV2 processors and
whole native graph nodes. Switching a block inside a native node uses the
separate native scene format below.

`POST /api/v1/rig-audio` accepts `stomp_group` with a group ID and the
current worker session and revision. The worker checks every target before
starting their latency-aligned bypass ramps at the same stream position.
Readback reports group **On**, **Off** or **Mixed** from the confirmed target
states and keeps the last selected named scene separately.

Use the playing rig's MIDI controls to map a CC to a stomp group. The
device-local binding uses the group's ID and `toggle` mode. A press at 64
or above invokes the same worker command as touch. Lower values leave the
sound alone. Protect allows the performance action from either input and
guards assignment edits.

### Warm bypass inside a native tone

Version 5 scenes can switch a prepared NAM or IR inside a native block. The
native processor keeps running the capture and its EQ and gains while its
audible output fades to dry. Returning to the capture uses the history built
while it was bypassed. An outer bypass on the same block also keeps the inner
processors running.

Version 5 reports the actual native fade and scalar glide. Reapplying settled
controls leaves the scene ready. A scalar change on a cold, silent block settles
immediately. A pending model preparation blocks a scene change without committing
that preparation. If an armed block fails during rendering, the worker reports
the failure and releases the audio stream.

The worker distinguishes saved `native_bypass_defaults` from the live keys
in `native_bypass_armed`. The same inner power controls work as warm
adjustments once a version 5 scene preset has prepared them. Save keeps the
confirmed power settings and scene definitions in the new preset. An extracted
amp/cab pair keeps its exact source bytes.

An armed lane keeps the same loaded NAM positions for calibration and IR
channel selection while scenes change. At 1× the bypass endpoint uses the
direct chain input. At 2×, 4×, and 8× an armed IR runs a second resampling
island on its dry input. Both islands keep independent filter history. The
bypass retains that filter response. The whole preset uses one host rate
conversion for both endpoints. Arming counts all resident warm buffers
against one 32 MiB limit before reserving the additional adapter storage.

With version 5, extracted Amp and Cab each convert at their own host-facing
ports. The two stages use the same optional oversampling factor and can have
LV2 processing between them. Their separate conversion paths have their own
delay and filter response. Legacy pairs still require 48 kHz at 1×.

For an armed node, model replacement and whole-native structure, settings and
Undo edits first build an isolated candidate. The device checks all dependent
scene IDs and the resident memory budget while the current worker still owns
audio. Removing an armed target is refused. After an accepted edit the device
fades out the previous worker, starts the re-armed replacement and retains
the previous working state if that startup fails. Pi timing and physical
input/output still need qualification.

### Sleeping scene branches

A preset with the required `urn:oxidal:sleep-branches:1` extension can stop
processing independent muted branches. Each branch starts at its declared
mono Gain nodes and ends at the return gain ports in its scene branch entry.
Preparation refuses overlapping routes, hidden inputs, undeclared outputs,
and scene changes to processing inside the tail path. A shared downstream
processor remains active and can still have its own scene controls.

Saved rigs with older scene declarations can preview a sleep plan from their
existing return routes. The plan places unity sends on the exact edges that
enter an independent processing branch. Shared and dry paths stay scheduled.
Publication applies the plan only when explicitly requested, and writes a new
immutable revision. The preview checks routing. Plugin compatibility and
buffer admission are checked when the revised rig prepares to play.

Trails fades the outgoing branch's sends and leaves its old return level for
the tail. Blend keeps its input until the selected return fade finishes,
then closes the sends. A branch stays Draining until its sends have reached
zero and its processor output stays below 2e-7 full scale for two seconds plus
the prepared delay. A continuous feedback tail keeps occupying a running
slot. An Asleep branch skips its audio processing and retains its processors
and memory.

A scene request primes any asleep branch with live input for the prepared
graph delay plus one period. The old scene remains active until this completes.
A later request can replace a pending request. If a branch fails during
preparation, the old scene keeps playing and the failed branch must be
prepared again. The device reports requested and active scene IDs separately.
Turning branch sleep off prepares muted branches before any new return uses
them. Save and working recovery retain the confirmed enable setting.

The worker counts active, priming and draining branches against the same
all-running graph bound it uses when branch sleep is off. Those counts
describe scheduled processors. Pi measurements are required before assigning
a processing cost or admitting larger rigs on the strength of branch sleep.

## Whole-native authoring and portable instance settings

Whole-native blocks support live control and EQ edits, NAM and IR audition, and
saving an independent copy. Some settings, including oversampling, require a
fresh preparation step. Portable saves can retain native resources and supported
LV2 state. See [LV2 compatibility](lv2.md) for plugin limits.

## Confirmed session recovery

Use **Resume** to reopen a supported session after a restart. Boot playback is a
separate choice in Audio settings. See [audio setup](audio.md#shared-boot-selection).

## Realtime render thread

The worker prepares processors and routing before opening the audio stream.
The render thread owns the duplex stream. Control and model changes are handled
by the worker outside the render loop. Plugin-reported delay is used for
supported graph alignment. Measure physical latency and dropouts on the device
with your intended interface and rig.

## References

- [Routing and rendering code](../crates/oxidal-engine/src)
- [Mixed engine qualification](../crates/oxidal-engine/examples/qualify_mixed.rs)
- [Worker and API tests](../crates/oxidal-api/tests/rig_playback.rs)

## Starting scenes in the set list

Two set entries can recall the same saved revision with different starting
scenes. Set-list recall, Next and Previous, and Program Change use the entry's
resolved revision and scene. A prepared alternative stays inaudible while its
starting scene settles and the worker verifies its output. A refusal leaves the
current resident playing and preserves the current set-list position. If the
alternative is still contributing an earlier tail, the worker refuses a
different starting scene until that tail has finished.

A rig that loads on recall checks its saved starting scene in an isolated
worker before replacing the current sound. The new stream starts at that scene
and confirms processed frames before the device reports the entry as selected.
This path reopens the audio device. Protect allows recalls of the current rig
or an already prepared alternative.

## Build a rig from captures

The Library builds an owned rig from four verified NAM assets and their
confirmed roles. Enter the captures in Clean, Crunch, Lead, Dirt order. The
rig starts on Clean. Each scene opens one capture return and keeps the
shared Echo and Bloom after the returns. The capture processors run at 1×
oversampling and stay warm during scene changes.

A separate WAV cabinet processes the amp returns together. Full-rig returns
join after the cabinet. The build refuses role mismatches and checks the
embedded native files, routing, native loading and all four scenes in an
isolated worker before publishing. Existing audio keeps running during the
build. The saved rig owns its embedded captures and cabinet.

A retry with the same request ID and inputs returns the same saved revision.
Change the request ID when starting a different build. The isolated 48 kHz
check verifies preparation and rendering. Playback still checks the selected
device configuration and the rig's resource needs.
