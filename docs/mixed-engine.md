# Mixed rigs and scenes

A mixed rig puts native tones and supported LV2 effects in one signal chain.
Oxidal prepares the graph before playback and runs it in a supervised worker.

| Choose            | When you want                                                      |
| ----------------- | ------------------------------------------------------------------ |
| Serial chain      | Saved native tones and effects arranged in order.                  |
| Split amp and cab | An effect between the amp and cabinet stages of a compatible tone. |
| Scenes            | Preloaded branches with a shared output chain.                     |

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
