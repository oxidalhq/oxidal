# Using the browser interface

- **Rig** shows the active signal chain. Tap a parameter value to adjust it. **Done**
  keeps the edit, **Cancel** restores the preview, and saving writes the result to
  the library.
- **Perform** puts scenes and playing controls within easy reach.
- **Library** is where you browse, import and edit presets and captures.
- **Sound Check** and **Monitor** show levels and processing health.
- **Settings** covers audio, Wi-Fi, MIDI, display, accounts, effect packs and
  maintenance.

See the [screenshots](screenshots.md) for examples.

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

## Scenes and ready presets

Scene pads recall routing inside the playing preset. Switching a branch on or
off changes the current mix. Use **Update scene** to keep that routing or
**Save** to save changes to the whole preset.

**Ready to switch** lists other loaded presets. **Playing** is audible,
**Processing** is still rendering a transition or tail, and **Sleeping** is
loaded without current DSP work.
