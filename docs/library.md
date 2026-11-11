# Library

Open **Library** to find, play and organize sounds, tones and media. Importing
a file leaves the current sound alone. To try a capture on a playing rig,
choose a block and audition it explicitly.

Library has two groups. Each section has its own link, such as
`#library/tones`.

| Group  | Sections                                                      |
| ------ | ------------------------------------------------------------- |
| Sounds | Mine, Oxidal sounds, TONE3000, Set list, Tones and IRs        |
| Media  | Backing tracks, DI and reamps (see [session media](media.md)) |

Links from before this layout still work: `#library/presets` opens Mine,
`#library/sounds` opens Tones and IRs and `#library/discover` opens Oxidal
sounds.

## Mine

**Mine** is one list of your presets, including saved TONE3000 chains. It is
searchable, and the search survives a reload. Each row shows its topology,
scenes and whether it is ready, with **In set list #N** or **Not in set list**.
**Play** starts the preset, **Details** shows its description and the **More**
menu holds the occasional actions:

| Action                        | What it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| Edit                          | Opens the preset in Rig without playing it.                            |
| Duplicate                     | Makes "Name copy" in Mine, outside the set list, and opens it stopped. |
| Add to / Remove from set list | Changes membership only. Removing keeps the preset in Mine.            |
| MIDI                          | Plays the preset and opens its MIDI assignments.                       |
| Rename, Delete…               | Rename it, or remove it after a confirmation.                          |

A saved TONE3000 chain in Mine offers Play, Details, Download, Add to / Remove
from set list, Rename and Delete…. It has no Duplicate.

**Keep ready** loads up to a few presets beside the playing one so switching
has no gap. Editing the sound of a read-only example creates a copy in Mine
with **Make my copy**; **Keep** retains it and **Discard** returns to the
original.

## Set list

The **Set list** is the ordered list that Perform, **Previous** / **Next**, the
picker and MIDI program changes follow. Membership is explicit:

- Presets in Mine are members unless you remove them. Drag a row, or use its
  move up and move down buttons, to reorder.
- Read-only [Oxidal sounds](factory-collection.md) join by reference, never by
  copy, and appear at the end of the list until you move them. Removing one
  takes it out of the set list and leaves the sound in Oxidal sounds.
- Presets outside the set list are shown under **Not in the set list**, each
  with an add button.
- **Add starter set list** appends nine LV2-only Oxidal sounds, one per core
  genre, after your existing entries and never in their place. A fresh unit
  offers it once; **Not now** stops the offer. Starter entries that are not
  installed are skipped and reported.

Previous and Next stop at the ends of the set list.

## Duplicate

**Duplicate** copies a preset in Mine, including its scenes, MIDI assignments,
boosts and measured levels, as "Name copy". The copy is not in the set list.
Rig also offers Duplicate for the preset it has open.

## Scene management

Open a scene's menu in Rig to manage scenes without leaving the preset:

- **Rename** changes the scene's name.
- **Move left** and **Move right** reorder scenes. MIDI bindings follow the
  scene, not its position.
- **Duplicate scene** adds a copy after the current one, up to 64 scenes.
- **Delete…** removes a scene and its MIDI binding. A preset always keeps at
  least one scene, so the last one cannot be deleted.
- **Copy to preset…** copies the scene into another preset in Mine and lists
  what differs before it copies. Blocks the target does not have are skipped.

Scene edits wait until you save or discard pending **Update scene** changes.

A scene can also keep values for plugin controls (up to 32). Its settings
list shows each as **glides** for smooth controls or **switches when silent**
for stepped ones. See [scene changes and stepped controls](lv2.md#scene-changes-and-stepped-controls).

## Tones and IRs: browse and download

Search NAM and IR entries by name or import folder. To download models through
the provider browser, connect a [TONE3000 account](tone3000-account.md). A
download adds the file to the library for later use.

## Import collections

Choose files or a folder to import NAM captures or WAV IRs. The browser uploads
one file at a time, up to 32 MiB per file. Cancelling stops the remaining uploads.
Files already accepted stay in the library. Refresh the list to see what was
stored.

## Cabinet groups and capture details

IRs are grouped by cabinet collection where the names provide that information.
Sample rate, channels and duration come from the WAV header. NAM entries show
available model metadata, including creator and source when known.

To audition a capture, select a block in a supported running rig. Closing the
preview keeps the auditioned sound. Use **Undo** in Rig to revert it, or save
the preset to keep it.

## Library backup

Open **Library → Set list → Download backup** to export presets, captures,
IRs, set-list order and MIDI mappings as a tar archive. TONE3000 account tokens,
control-audit records and monitor history are excluded. Sign in again when
setting up another device. The interface currently supports backup download only.
