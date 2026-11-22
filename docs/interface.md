# Using the browser interface

- **Rig** shows the active signal chain. Tap a parameter value to adjust it. **Done**
  keeps the edit, **Cancel** restores the preview, and saving writes the result to
  the library.
- **Perform** puts scenes and playing controls within easy reach.
- **Library** is where you browse, import and edit presets and captures.
- **Levels** shows levels and processing health.
- **Settings** covers audio, Wi-Fi, MIDI, display, accounts, effect packs and
  maintenance.

See the [screenshots](screenshots.md) for examples.

## Navigation and recovery

An unsaved Venue EQ edit asks before leaving, including with browser Back or
a section link. **Keep editing** retains the draft and its preview; **Revert
and leave** restores the saved EQ before navigating.

Phone navigation and the cued backing player share one bottom area. The page
reserves room for both, and adjustment dialogs follow the available viewport
during rotation and keyboard resizing.

If a screen cannot download, its recovery message offers **Reload interface**.
Navigation and device readback remain available. Device audio runs independently
of the page.

## MIDI defaults

Open **Settings → MIDI** to review or learn controller assignments. A new map starts with CC 7 for master output, CC 16–23 for the eight-scene template, CC 24/25 for previous/next preset, CC 26 for the tuner, CC 27 for tap tempo, CC 28 for a temporary instrument boost, and CC 29 for Protect. CC 80–85 control backing playback. CC 86 toggles chord-sheet scrolling or advances a page in E-paper and reduced-motion modes. CC 87 sets the scrolling speed. The master uses the same taper as the on-screen fader. Boost adds 3 dB within the existing gain limit and clears when the audio stream closes.

**Reset to default MIDI controls** shows the previous and proposed assignments and identifies conflicts before applying. Existing maps keep their assignments when the software is updated. New Mine Rigs inherit the first eight Tone3000 or LV2 bypass switches in graph order (CC 48–55) and the first eight named scene branches in declaration order (CC 56–63). A device-wide assignment takes priority and leaves that slot unassigned inside the rig. Explicitly applying the template to a saved rig replaces its assignments after review. Native and mixed playback receive device-wide actions and assignments for the playing preset. The effects-only worker receives the selected controller inputs for device-wide actions and passive Learn. Its effect parameters remain available in Rig. [Backing tracks and tempo](media.md)

## Fullscreen and screen timeout

Open **Settings → Display** to choose Default, Night, Sunlight or E-paper. The
same page has separate **Enter fullscreen** and **Keep screen awake** controls.

Keep screen awake requires trusted HTTPS and browser support. It is off by
default. The browser can release the wake lock when you leave the tab or lock
the device. Return to the page to resume it, or retry from Settings if prompted.

## Mixed composition

From **Library → New preset**, combine saved native tones with supported
installed LV2 effects. Compatible saved tones can be split into linked amp and
cab stages, with effects between them. See [mixed rig setup and limits](mixed-engine.md#separate-ampcab-authoring).

In Rig, **Undo** and **Redo** in the header step through the revisions saved
while you edit this preset (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z or Ctrl+Y; not while
typing in a field). Each step asks first and replays the earlier revision, with
its MIDI assignments. MIDI assignments removed with a block do not come back.
Undo starts again when the first edit of an Oxidal sound or TONE3000 chain makes
your copy; Discard copy is the way back from that. **Remove** on a block asks
before it removes the block and its settings.

## Scenes and ready presets

Scene pads recall routing inside the playing preset. Switching a branch on or
off changes the current mix. Use **Update scene** to keep that routing or
**Save** to save changes to the whole preset.

**Ready to switch** lists other loaded presets. **Playing** is audible,
**Processing** is still rendering a transition or tail, and **Sleeping** is
loaded without current DSP work.

## Creating without interrupting playback

**New preset → Create preset** saves an Empty or Copy preset in **Mine** and
leaves the current sound and unsaved work alone. Choose **Keep in Library** to
continue playing. The current editor needs playback: **Play to edit…** opens a
separate review of the interruption and possible loss of unsaved edits. Cancel
and save your current work first, or confirm **Replace sound and play**. If the
playing session changed during the review, review again before replacing it.

## Protect during performance

Protect is a device-wide setting that survives restart. It blocks parameter and
structure edits from browsers and mapped MIDI input. Scenes, branch switches,
supported stomp bypass, prepared preset switches, output mute and the native or
mixed tuner remain available. Tuner start and stop do not grant permission for
alignment, balance measurement or other authoring actions.

Changing Protect waits for the playing worker to acknowledge it. A new worker
inherits the saved setting, and MIDI reconnection or reconfiguration keeps it.
Wait for audio preparation to finish before changing Protect. If a worker cannot
acknowledge the setting, audio stops with an error instead of leaving an
unprotected MIDI path running.

In **Settings → MIDI → Guided setup**, choose a controller and layout, then check each switch. A received switch indicates a new message from the selected input. You can name and save a layout before connecting a pedal. For an expression pedal, assign CC 11 to a continuous preset control, set the heel and toe positions and select a response curve.

In Library, **Newest** sorts by when a preset first joined the device catalog. Renaming a preset, moving its set-list entry and saving another revision preserve that date. Presets from before dates were recorded appear below dated entries in name order.
