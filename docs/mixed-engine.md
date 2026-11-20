# Mixed rigs and scenes

A mixed rig puts native tones and supported LV2 effects in one signal chain.
Oxidal prepares the graph before playback and runs it in a supervised worker.

| Choose            | When you want                                                      |
| ----------------- | ------------------------------------------------------------------ |
| Serial chain      | Saved native tones and effects arranged in order.                  |
| Split amp and cab | An effect between the amp and cabinet stages of a compatible tone. |
| Scenes            | Preloaded branches with a shared output chain.                     |

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
