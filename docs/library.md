# Presets, NAM models and IRs

Open **Library** to browse **Presets**, **NAM models** or **IRs**. Importing a
file leaves the current sound alone. To try a capture on a playing rig, choose
a block and audition it explicitly.

Presets are grouped into **Mine**, **TONE3000** and **Oxidal** examples.
**Mine** supplies the set list for Perform, Previous/Next and MIDI program
changes. Editing the sound of an original creates a copy in Mine. **Keep**
retains the copy. **Discard** returns to the original.

Saved native presets embed their model bytes. Library NAM and IR files are
stored separately, so removing a preset can leave those files available to
other rigs. See the [preset format](presets/format.md) for storage details.

## Browse and download

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

Open **Library → Manage library → Download backup** to export presets, captures,
IRs, set-list order and MIDI mappings as a tar archive. TONE3000 account tokens,
control-audit records and monitor history are excluded. Sign in again when
setting up another device. The interface currently supports backup download only.
