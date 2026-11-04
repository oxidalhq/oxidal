# TONE3000 preset compatibility

Oxidal's optional native adapter opens compatible `.t3kpreset` files and
provides native tone editing and playback. Imported originals stay in the
library. Save a named copy to keep your changes.

| Task                       | Where to start                                                   |
| -------------------------- | ---------------------------------------------------------------- |
| Open a preset file         | Import it into Library and open it in the native editor.         |
| Edit without playing       | Use the offline native editor.                                   |
| Hear an edit               | Start a supported native or mixed rig and adjust the live block. |
| Try your own capture or IR | Open the block picker and choose Local files.                    |

## Prepared model audition boundary

Choose a NAM capture or WAV IR, then select the target block. The worker
prepares the asset before applying it. Supported blocks can also hold a
collection of files and switch between its variants. Compatibility depends on
the model and file format. See [Library](library.md#cabinet-groups-and-capture-details).

## Live working-state authoring

The live editor supports confirmed scalar controls, per-block EQ and supported
chain edits. Changes that alter engine preparation, such as oversampling, follow
a separate apply step. Save a named copy to keep the tone for later use.

### Tuner and automatic matching

On a supported running native input, the tuner starts when opened. Native tools
also support automatic level matching and alignment for compatible setups.

## Standalone native hardware MIDI

Configure the input and channel in MIDI settings. Assign supported controls
using Learn or select a mapping manually. A missing controller is shown as
disconnected while audio continues.

## Persistent bounded tone history

Supported edits can be undone or redone from the rig. Working history can
survive session reconstruction. If an older history entry fails validation,
Oxidal can disable Undo while keeping the current valid tone available.

## Build and repeat the qualification

Run `pnpm native:check` on a supported build host. The suite exercises preset
load and save, model playback, live edits and recovery using the native worker.
Physical interface and real-time checks are separate.

## Dependency and patch provenance

- [Pinned source and patch manifest](../native/tone3000/sources.json)
- [Native adapter implementation](../crates/oxidal-tone3000/src)
- [Native qualification suite](../crates/oxidal-tone3000/examples/qualify.rs)
- [Third-party licensing](../THIRD_PARTY.md)

Oxidal ships no TONE3000 preset downloads. Local file import and optional
[TONE3000 account access](tone3000-account.md) are separate workflows.
