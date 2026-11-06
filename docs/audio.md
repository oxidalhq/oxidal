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

Use **Apply** in Audio settings to try a new configuration. Supported live
sessions retain confirmed controls through the change and attempt to restore the
previous configuration if preparation fails.

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
