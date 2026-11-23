# Audio setup and playback

## Get sound

1. Connect your audio interface and open **Settings → Audio**.
2. Refresh the device list, select an input and output, and check the proposed
   settings. Start with both directions on the same interface and clock.
3. Choose a saved preset in **Library** and start playback.
4. Open **Sound Check** to check input and output levels before turning up.

## Run and inspect

Oxidal uses ALSA on Linux. The device check opens the endpoint briefly to verify
the requested rate, format and buffer settings. A successful check on each
direction is useful, but actual duplex playback is the next test.

| If you see                   | Try this                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| Interface missing            | Connect it, then refresh the device list.                              |
| Device busy                  | Stop the current session or close the other application using it.      |
| Dropouts or missed deadlines | Try a larger buffer and check Sound Check again with the intended rig. |
| Clipping                     | Lower the input or the level of the branch that clips.                 |

## Apply device settings to the current tone

Use **Apply** in Audio settings to try a new input, output, rate, buffer or
channel map in a running Native, Mixed or Effects session. Audio restarts with
the current tone and confirmed controls. Once the worker has processed audio
with the new settings, you have 15 seconds to choose **Keep** or **Go back now**.
Oxidal reverts on the device when time runs out, even if the browser closes or
loses its connection. If the previous interface cannot restart, the error
explains that audio stopped and the original configuration is available for
Resume.

Only one change can be pending. Finish recording, rendering a reamp, preparing
a sound, adjusting Venue EQ, or changing network settings or effect packs before
applying. Protect blocks Apply and Keep. You can still revert or stop audio.
**Stop** in the confirmation dialog cancels that preview and releases the
audio device. The previous settings are available for explicit Resume.

The session remembers a kept configuration after the daemon restarts. An
interrupted preview restores the previous configuration, and does not enable
startup playback or replace the selected startup preset. Effects **Resume**
uses its last confirmed configuration independently of startup playback.

The settings dialog distinguishes calculated buffer times from measurements.
The one-way buffer time is period frames multiplied by periods and divided by
sample rate. It does not include converter or transport delay. Recovered xruns,
processing deadline misses and invalid samples describe the current worker
during the trial when measurements are available.

## Live NAM audition and offline copies

Select a block in a supported running rig to try a NAM capture or WAV impulse
response. Save a named copy to keep the edit. The offline native editor remains
available when live audio is stopped.

## Shared boot selection

After checking playback, select **Use this session on boot** to restore that
session when Oxidal starts. **Resume** is available for supported saved
sessions after a daemon restart. A boot failure is reported in the browser.

## Presets and scenes

A scene changes the active routing within a rig. You can prepare multiple
branches and put shared delay or reverb after them so their histories can
continue through a scene change. See [mixed rigs and scenes](mixed-engine.md).

## Physical round-trip latency

The buffer settings and plugin-reported delay describe parts of the signal
path. To measure the whole path, use a physical loopback on the target
interface. Use [Sound Check](monitoring.md) to track processing health while
running the actual rig.

## References

- [Audio device API](../crates/oxidal-api/src/audio.rs) and
  [playback tests](../crates/oxidal-api/tests/playback.rs)
- [Architecture](architecture.md) and [appliance setup](../os/README.md)

## What starts with Oxidal

**Last played preset** follows a successful explicit mixed Start or prepared
Switch. A Start first reports preparation; only its confirmed Running result
updates startup. Failure, cancellation, automatic recovery and Save alone do not
retarget it. Startup must already be enabled for Follow to replace its target.
An empty mixed startup override record loads the saved defaults. A partial
recovery record still requires the complete matching control catalog, and an
incorrect source revision is rejected.
The mixed startup recall uses the saved bundle defaults, excluding temporary
live values, external model overrides and unsaved working receipts. A storage
failure leaves the previous choice and reports that the new choice was not saved.

**Pinned saved version** captures the saved version currently playing even when
startup already names another preset. Save and play the saved version first if
there are unsaved edits or pending model changes. Resolve any automatic copy's
Keep/Discard decision before choosing startup. The UI shows the confirmed
startup name and expandable version identifier. **Pin the playing saved version**
can replace an existing pin; later playback does not change it.

`POST /api/v1/startup` accepts `follow`, optional `expected` startup readback and
optional `capture: {owner, session, revision}`. The daemon verifies the reviewed
running session and stored preset, then persists target and policy together in
one boot record. Stale reviews return 409, and Protect returns 423. Existing
`{follow}` clients remain compatible. Schema-1 and schema-2 boot files remain
readable; schema-2 records without an embedded policy use the legacy
`boot-follow.json` preference. Owner `set_boot {enabled:false}` still clears
startup without stopping audio.

## Guitars

Each guitar has a profile: an input trim and an optional gate, applied before
every preset, so a hotter guitar does not need its own presets. One guitar is
active at a time, and there are three ways to change it:

- **By hand.** The Guitar row on Perform, or the guitar button beside Level.
- **From a footswitch.** MIDI → Device controls → **Next guitar** selects the
  next profile and wraps after the last.
- **With the preset.** In the guitar dialog, **Always use … for this preset**
  makes the playing preset remember that guitar. Starting the preset then
  selects it. A guitar chosen by hand afterwards stays until another preset
  starts. Deleting a guitar forgets the presets that remembered it.

Even out does not depend on the active guitar and never changes it.

## Tuner

Oxidal has its own tuner. It listens to the raw interface input, before trim,
gate and effects, so it works under any playing preset, with or without a
TONE3000 chain. With nothing playing it opens the interface itself, using the
last audio settings: a pass-through session that is always muted and ends when
the tuner closes, or 15 seconds after its view stops asking. A unit that has
never played anything has no audio settings yet and says so.

The detector runs inside the audio worker with fixed buffers and a bounded
share of each block. It reads from a five-string bass's low B (about 31 Hz) to
1.6 kHz and resolves synthetic string tones to within 0.2 cents in tests; it
has not been compared against a reference tuner on real instruments.

The view is a round strobe dial: two rings turn clockwise when the note is
sharp, the other way when it is flat, and stand still in tune (within 1 cent).
Under the note a sine trace slides against a fixed reference trace and lies on
it in tune. It mutes the outputs
while open and puts the previous monitoring back on close, can fill the screen,
has a dark look for the stage and a black-on-white look for daylight, and a
reference pitch from 430 to 450 Hz. On E-paper nothing animates. The
tuner stays available under Protect.

## Even out measurement boundary

Even out measures its built-in reference riff before master volume and venue EQ,
with the same Mono or Stereo fold as playback. Measurements from an older
algorithm or the other channel mode need remeasurement. A scene's correction
replaces an older whole-preset measurement; it is not added to it. The chart
shows the predicted result of stored corrections, not a second measurement of
the corrected output. An unmeasured or changed preset still needs Even out.

The riff is a repeatable comparison, not a guarantee for every guitar, playing
style or long effect tail. The mono measurement regression checks one-sided and
phase-opposed signals, because summing channels can change loudness. See
[EBU Tech 3343](https://tech.ebu.ch/docs/tech/tech3343v4_1.pdf) for the relationship
between downmix coefficients, channel correlation and resulting loudness.

Calibration workers start with a process-only output mute before their first
sample. It remains active during preset loading, between reference riffs and
while measurement results are stored. Reference metering stays before that mute.
Completing or cancelling the run clears the launch flag and starts the original
rig in a fresh worker, restoring normal monitoring without saving a mute or
changing the unit master level.
