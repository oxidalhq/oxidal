# Session media

Oxidal keeps backing tracks, DI recordings and reamp results in a media store
that is separate from presets. This page covers where the store lives, how
uploads work, the limits, and how the store recovers after a crash or power
loss. Playback, reamping and the Library screens are built on top of it.

Source: [media store](../crates/oxidal-api/src/media.rs),
[media API](../crates/oxidal-api/src/media_api.rs) and
[audio host stage](../crates/oxidal-audio/src/tools.rs).

## Where files live

| Environment | Root                     | Set by                                       |
| ----------- | ------------------------ | -------------------------------------------- |
| Pi image    | `/var/lib/oxidal/media/` | `OXIDAL_MEDIA_DIR` in `oxidald.service`      |
| Development | `.local/media/`          | the default when `OXIDAL_MEDIA_DIR` is unset |
| NVMe later  | any mount                | point `OXIDAL_MEDIA_DIR` at it               |

On the image, `/var/lib/oxidal` is on the persistent data partition and stays
writable when [storage is locked](storage-lock.md). The daemon creates the store
on first start. Its directories are mode `0750` and owned by the service user.

```text
media/
  store.json              schema version and optional larger reserve
  assets/<id>/            one directory per asset (ULID)
    manifest.json         written last; its presence makes the asset real
    original.mp3|.wav     the uploaded file, byte for byte
    play-48000.f32        play-ready render: interleaved little-endian float32
  incoming/               uploads and work in progress
  quarantine/<id>/        assets that failed the startup check, with REASON
```

File names inside an asset are fixed by Oxidal. A title is metadata only, so a
file name from a phone or laptop never becomes a path.

## Manifest

`manifest.json` is schema 1. It records the asset `kind` (`backing`, `di` or
`reamp`), title, creation time, the uploaded source (bytes, SHA-256, container,
codec, rate, channels, frames, lossy), one play-ready render per stream rate
(rate, channels, frames, SHA-256, resampler, peak and loudness), the per-track
trim (−24 to +6 dB) and, for reamp results, the source and processing details. A newer schema is
refused rather than rewritten.

## Uploads

Uploads are chunked and resumable, so they stay far below nginx's 128 MB body
limit and survive a phone going to sleep or a Wi-Fi drop.

| Request                                  | Effect                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `GET /api/v1/media`                      | Assets, quarantined entries, bytes used and free space |
| `POST /api/v1/media/uploads`             | Start an upload with `{ "name", "size" }`              |
| `PUT /api/v1/media/uploads/{id}?offset=` | Append one chunk at the confirmed offset               |
| `GET /api/v1/media/uploads/{id}`         | Confirmed offset and whether the file is complete      |
| `DELETE /api/v1/media/uploads/{id}`      | Cancel and remove the partial file                     |
| `DELETE /api/v1/media/assets/{id}`       | Delete an asset; refused while it is in use            |

- A chunk sent at the wrong offset is refused with `409` and the confirmed
  offset, so a client that lost a response resumes from the right place.
- Files must be WAV or MP3, 1 byte to 2 GiB. Chunks are at most 8 MiB.
- An upload untouched for 24 hours is discarded. At most eight uploads may be
  open at once.
- Uploads and deletes are refused while Protect is on.

## Space

The store always keeps a reserve free: the larger of 1 GiB, 5 % of the
filesystem and the reserve in `store.json`. A new upload must fit its file plus
an estimate of its play-ready render (3.5 × a WAV, 26 × an MP3) without eating
into the reserve. Every chunk is checked again. A refusal returns `507` with
the free space and the reserve.

## Recovery

Finishing an asset follows a fixed order: data files are synced, the manifest
is written to a temporary file, synced and renamed into place, the directory is
synced, and only then is the asset directory renamed into `assets/`. A crash at
any point leaves either nothing or a complete asset.

At startup the daemon:

1. Deletes everything in `incoming/`, including unfinished uploads.
2. Checks each entry in `assets/`: a valid ID, a valid manifest whose ID matches
   its directory, and every listed file at the size the manifest says.
3. Moves anything that fails to `quarantine/` with a `REASON` file and lists it
   in `GET /api/v1/media`. Quarantined entries are never deleted automatically.

Hashes are checked when a file is read for export, not on every start, so a
large library does not slow boot. If the store cannot be opened, the daemon
still starts and the media requests answer `503` with the reason.

## Leases

The player and reamp jobs hold a lease on an asset while they use it. Deleting a
leased asset is refused with `409`. A delete first renames the asset out of
`assets/`, so it disappears at once even if removing the files takes a moment.

## Backing player in the app

Every player control in the web app sends the same player command to the
daemon (`POST /api/v1/player/commands`), so MIDI footswitches, the mini-player,
the full player, Perform and Library never disagree. Source:
[session media components](../apps/web/src/components/media/),
[upload client](../apps/web/src/lib/mediaUpload.ts) and
[player clock](../apps/web/src/lib/playerClock.ts).

- **One snapshot.** The device event stream `GET /api/v1/events` carries a
  `player` event with every player snapshot, so a browser tab keeps one stream
  to the device (`GET /api/v1/player/events` carries the same snapshots alone).
  The app draws every surface from the newest snapshot. While a track plays, the shown position
  advances locally from `frame` and the track rate until the next snapshot.
  Buttons show a pending state for at most 300 ms, then the device's state.
- **Safe retries.** Each action has a fresh request ID; a lost response is
  retried once with the same ID. Next, Previous, seek and skip carry the cued
  track, so a command from a screen that missed a change is refused.
- **Where it shows.** In the masthead between the wordmark and the navigation
  from 1200 px, a strip under the masthead from 600 px and a bar above the safe area on phones and in E-paper mode. It is
  hidden while nothing is cued. The full player opens over any page. Perform
  has one backing row, and Library has a Backing tracks section.
- **Imports.** Files go up in 8 MiB chunks. A refused offset resumes from the
  offset the device confirmed, and a lost connection pauses the file until the
  browser is back online. The import queue lives for the whole app session, so
  leaving Library does not stop an upload.
- **Protect.** Play, pause, stop, skip, seek, Next/Previous and level work with
  Protect on. Import, rename, reorder, trim, delete and MIDI learn need it off.
- **MIDI.** Settings › MIDI has a Backing player group: Play/Pause, Stop track,
  Next track, Previous track, Back 10 s, Forward 10 s and a level knob CC.

## Song preparation and practice timing

The [song preparation crate](../crates/oxidal-splitter) estimates tempo and
beats offline from a 10 ms energy envelope. Tempo is the envelope's
autocorrelation lag with the most weight around 120 BPM, and beats come from a
dynamic-programming tracker that rewards strong onsets and spacing close to
that tempo, so off-beat and syncopated attacks do not stop it and the beats
follow gentle tempo changes. Method reference
[Ellis, 2007](https://doi.org/10.1080/09298210701653344). Material whose
tracked beats mostly miss real onsets is reported as tempo uncertain. Half and
double time are common confusions: **½×** and **2×** next to the found tempo
switch the click to a steady tempo from the first detected beat. Accuracy on
annotated recordings is still to be measured.

The **Practice** section of the backing player shows the waveform after
**Show waveform and find the tempo**. Tap it to move the playhead or drag
across it to choose a loop; **Set A** and **Set B** use the playhead. Speed
buttons run from 0.5× to 1.5×. **Click** turns the metronome on and sends
changes to tempo, first beat (**Beat 1 here**), **Tap** tempo and level at
once. A range includes A and wraps at B. Seeking outside the active range
turns off section repeat. Changing songs resets the range, click and speed.
The analyser stores an estimated tempo, beat positions and waveform overview
beside the media store. Songs with uncertain beats can use a manual BPM and
first beat. The device follows the backing transport and applies a separate
click level. The click follows the session output routing, including mute.

The backing reader uses bounded waveform-similarity overlap-add at 0.5×,
0.75×, 1.25× and 1.5×. At 1× it reads the original audio directly. Method
reference [Roelands and Verhelst, 1993](https://www.isca-archive.org/eurospeech_1993/roelands93_eurospeech.html).

### Stem mix recipes

The song preparation crate defines separate four- and six-stem mix recipes.
Each stem has stored mute, solo and gain in tenths of a decibel. The renderer
reads aligned stereo chunks and applies a single whole-song attenuation when
the result would exceed −1 dBFS.

**Library › Stems** lists every song with stems and its saved mixes, with
**Split a track…** and **Import stems…**. In **Backing tracks**, a song with
stems carries a chip such as “6 stems”, and a saved mix a “Mix” chip with
“Mix of …”; **Split into stems…** in a plain track's menu starts the same
sheet.

The stems sheet splits a song (choose 4 or 6 stems; a progress bar follows the
job and the sheet can be closed) and shapes mixes while you listen. **Play**
cues the split's stems in the backing player and plays them live: the reader
mixes the stem files with the current settings before speed, loop and click,
so a change is heard within about half a second. **Start from** applies a
one-tap starting point (Full song, No vocals, No guitar, No bass, No drums,
No keys, Drums and bass, Drums only, limited to the parts present) and names a
new mix after it. Each stem row has Mute (M), Solo (S), a level slider from
−24 to +6 dB, a readout that resets to 0 dB and a WAV download. Undo and Redo
cover the draft; a slider drag is one step. **Save mix** creates it, **Save**
replaces it and **Save as new** keeps a copy. Saved controls reopen with the
mix. The previous render remains available if preparation fails.

A saved mix also plays live wherever it is cued (Backing tracks, Stems, the
Set list or a linked rig), and the full player shows a **Stems** section with
the same rows. Changes there are heard at once; **Save to this mix** keeps
them and **Reset** returns to the saved settings. The rendered WAV plays
instead when the stems were prepared at a different audio rate. Live mixing
works with Protect on; saving does not. While a split runs, the top bar shows
its progress on every page and opens that song's stems when tapped; the song's
rows in Backing tracks and Stems show it too. Confirmations use Oxidal dialogs.

Song preparation runs beside live audio. Splits, mix renders, stem imports and
tempo analysis use the Linux idle CPU policy and idle disk class, so the audio
workers, backing reader and API run first and presets stay playable. Protect
stops a running split and refuses new preparation; playing does not.

Download a separated stem as 32-bit float WAV, all stems as a ZIP of those WAVs,
or the rendered mix as 24-bit WAV. The all-stem ZIP is prepared in media
staging, checked against the storage reserve, then sent as a bounded file
stream. Temporary archives are removed at transfer end or at restart. The
original file and each split stay available when a mix changes or is removed.

| Request                                                         | Effect                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/media/songs`                                       | List every song with stems and its saved mixes            |
| `GET /api/v1/media/songs/{source}`                              | Read the prepared split versions and editable saved mixes |
| `POST /api/v1/media/songs/{source}/mixes`                       | Save a new mix or replace an expected revision            |
| `DELETE /api/v1/media/songs/{source}/mixes`                     | Delete the requested mix revision                         |
| `GET /api/v1/media/songs/{source}/splits/{id}/stems/{role}/wav` | Download one separated stem                               |
| `GET /api/v1/media/songs/{source}/splits/{id}/stems.zip`        | Download every stem in the chosen split                   |

The player commands `cue_stems` (song, split and recipe; the position is kept
when that song or one of its mixes is cued) and `set_stem_mix` (a new recipe
for the live stems) drive live playback; the player snapshot reports the live
split, its roles and recipe as `stems`.

A saved mix's section in the sheet downloads its WAV and lists where it
**Plays with**. Link it to a Set list entry or saved rig there; linking a
target that already has a mix replaces it. **Cue backing** beside the rig or
Set list entry explicitly cues the current revision, and asks before stopping
another playing track. Editing a saved mix keeps the link.

### Importing prepared stems

Open **Library › Stems › Import stems…** and use **Choose stem
files…** to pick several WAV or MP3 files at once. Names containing vocal,
drum, bass, guitar, piano or keys, or other are matched to that part, the
remaining files fill empty parts, and a shared file name prefix becomes the
song name. Change or remove any file per part before importing. Import one song
at a time. Vocals, Drums,
Bass, Guitar, Piano and Other are available, and any unused part can stay
empty. The Pi creates one playable song and opens **Stems and mixes**. Adjust
mute, solo or level, then save and attach named mixes using the same workflow
as a split made on the Pi. This import works without a local splitter model
or an original full mix.

Export each part on the Mac from the same timestamp, keeping any leading
silence. Oxidal aligns file starts, converts to the current preparation rate
and pads shorter tails with silence. Use WAV when available. The single WAV
downloads and ZIP contain the prepared versions of the parts supplied. Turn
Protect off before preparing a stem song.

For the API, create each resumable upload with `stem: true` and send its
chunks as usual. Once each upload reports `complete`, send the title and
`stems` array of `{role, upload}` assignments to
`POST /api/v1/media/songs/import-stems`. Unused staged uploads are removed
after expiry or service restart. The neutral backing render and all stems
become visible together.

### Local splitter runtime

Oxidal owns the split jobs, source decoding, staged outputs, editor and
playback. On Linux, it looks for `bin/demucs-onnx` and `models/` in
`/opt/oxidal/splitter/current/`. For a separate local install, set these on the
daemon before starting it.

| Setting                  | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `OXIDAL_SPLITTER_RUNNER` | Absolute path to the locally installed Rust `demucs-onnx` CLI  |
| `OXIDAL_SPLITTER_MODELS` | Absolute path containing the ONNX graphs and matching sidecars |
| Four stems               | `htdemucs.onnx` and `htdemucs.json`                            |
| Six stems                | `htdemucs_6s.onnx` and `htdemucs_6s.json`                      |

The [third-party splitter directory](../thirdparty/oxidal-splitter/README.md)
contains the pinned runner source, Linux ARM64 runtime libraries, notices,
and instructions for preparing the runtime.

The Pi 5 test build uses CPU ONNX Runtime 1.23.2 (Linux ARM64) and
[`demucs-onnx` commit `757ab9f`](https://github.com/HRSadeghi/demucs-onnx/commit/757ab9face37c20edd2e08ac82410da82320763b)
with `ort` 2.0.0-rc.13 dynamically loading the supplied runtime. Use the
graphs and sidecars from
[export revision `9128f6e`](https://huggingface.co/HRSadeghi/demucs-onnx/tree/9128f6ee0f1b8e333b5b8d12613aefb3bebc249a).
Oxidal checks local files before each split, so a runtime installed after
start-up is used without a restart. It invokes `separate` with absolute paths,
CPU execution, two threads and batch size one, at idle CPU and disk priority.
The job's progress comes from the runner's chunk count. The runner writes WAVs
labelled by role. Oxidal aligns them to the source timeline and publishes the
complete split atomically. Turn Protect off before splitting; turning it on
stops the split and keeps earlier splits. Install or update the runtime on a
development Pi with `pnpm deploy:local splitter` (see
[OS images](../os/README.md)).

With the runner and both graphs installed, set `OXIDAL_SPLITTER_RUNNER` and
`OXIDAL_SPLITTER_MODELS` as above and run
`cargo test -p oxidal-api --lib real_runner_splits_ -- --ignored`
to exercise both formats and split modes through the Rust integration on the host.

The MIT-licensed runner and ONNX Runtime are candidates for the software
package with their notices and a pinned, qualified build. Meta's [source licence](https://github.com/facebookresearch/demucs/blob/main/LICENSE)
covers code, while [the maintainer's weights statement](https://github.com/facebookresearch/demucs/issues/327)
excluded the published weights from that licence. A product bundle needs a
verified redistribution grant for the exact checkpoint.

## Venue EQ

Settings › Audio › Output › Venue EQ corrects the main outputs for the room (on an
interface such as the Jogg, the headphones mirror them). It applies once after
the session mix, so it never changes presets, the DI tap, recordings, reamp
results or exports. Source: [venue EQ screen](../apps/web/src/components/media/VenueEq.tsx),
[response and headroom](../apps/web/src/lib/venueEq.ts) and
[preview throttle](../apps/web/src/lib/venuePreview.ts).

- **Bands.** High-pass (20–400 Hz, 12 or 24 dB/oct), low shelf (40–500 Hz),
  low mid, mid and high mid bells (40 Hz–16 kHz, Q 0.3–8), high shelf
  (1.5–16 kHz) and low-pass (2–20 kHz, 12 or 24 dB/oct); shelves and bells are
  ±12 dB, and every band has its own On. Output trim is −24…+6 dB.
- **Graph.** The response is the combined magnitude of the same RBJ biquads the
  audio stage runs, at 48 kHz, on a 20 Hz–20 kHz log axis. Drag a handle (or
  use the arrow keys on it) to move a band; the band editor below offers the
  same values with step buttons. On E-paper the graph redraws on release only.
- **Profiles.** Five read-only starting points (Flat, Small PA, Boomy room,
  Harsh room, Headphones) to tune by ear, plus your own. Save on a starting
  point creates your own copy, named after it with "(edited)"; Save as…, Rename, Duplicate and
  Delete work on your profiles. Deleting the profile in use switches to Flat.
- **Preview, Save, Revert.** Edits are heard at once as an unsaved preview
  owned by the device ("Edited · unsaved"). A drag sends at most 20 previews a
  second and always sends the value on release. Save keeps the edit; Revert
  returns to the saved profile. Leaving the screen with an unsaved edit asks
  Keep editing or Revert and leave.
- **Compare and Bypass.** Compare to saved switches between the edit and the
  saved profile; Bypass switches between the corrected and flat outputs. Both
  are one-tap toggles and crossfade on the device.
- **Headroom.** Above +6 dB of peak boost (bands plus trim) the screen says
  "Adds up to +X dB; risk of clipping" and offers the output trim that brings
  the peak back to +6 dB.
- **Five-minute rule.** An unsaved edit stays audible while the screen is open
  (it keeps it alive every minute) and for 5 minutes after a phone sleeps or
  disconnects, so the PA sound does not jump. After that, or after a reboot, the
  saved profile returns and the next visit says "Your unsaved venue edit was
  discarded".
- **Two screens.** Every change goes through `POST /api/v1/venues/commands`
  with the revision the screen last saw, and the device event stream carries a
  `venue` event with each new state. A screen acting on an old revision is
  refused with `409` and shows the current state, saying someone else changed
  the venue EQ.
- **Protect.** With Protect on, every venue command is refused (`423`): no
  edits, bypass or profile changes. The screen shows the lock and disables its
  controls.

## Audio path

Session media meets the live signal in the shared audio host stage that every
worker uses:

```text
input ─► raw tap (DI recording) ─► input source: Live | Reamp DI ─► trim ─► gate ─► rig
rig ─► preset boost ─► session mix (+ backing return) ─► venue EQ ─► mono ─► Master ─► Mute
```

Preset boost is part of the guitar signal and never reaches a backing track.
Master, mono, Mute and venue EQ apply to everything that reaches the outputs.
Samples move between file threads and the audio thread through preallocated
lock-free rings, so the audio thread never waits for storage or allocates.

## Record DI and reamp

Library ▸ DI and reamps records the raw guitar and reamps it later.

- **Record DI** writes the interface input before trim, gate and effects (mono,
  float32 at the stream rate) while you hear your rig as usual. A backing track
  may keep playing; it is mixed after the rig and never reaches the recording.
  The asset records the guitar profile, trim and gate in effect.
- **Reamp** plays a DI (or one channel of a stereo file) into the rig that is
  playing now, in place of the guitar, and records the rig's own output before
  the backing track, venue EQ and Master. Input processing has no default: the
  unit's current trim and gate, or none for a DI that is already
  level-matched. A tail of 0–10 s lets delays and reverbs ring out. With
  monitoring off the outputs are muted; the result is not.
- While a reamp runs, recall, scene changes, edits and calibration are refused
  with "Reamp in progress"; Mute stays available. Stop and keep saves the part
  so far, marked incomplete; Cancel discards it. A full disk stops the job and
  keeps the valid part. Live input returns when it ends.
- Results are `di` and `reamp` assets with source and processing details (source file and hash,
  channel, processing, the running rig and scene, tail, stream rate and
  buffer). They play in the backing player and download as 24-bit WAV.
- A reamp runs through the preset and scene that are playing now; load the
  sound first. Footswitch scene changes handled inside the mixed-rig worker
  are not yet blocked during a reamp.

| Request                             | Effect                                     |
| ----------------------------------- | ------------------------------------------ |
| `GET /api/v1/capture`               | The current or last job                    |
| `POST /api/v1/capture/record-di`    | Start recording a DI                       |
| `POST /api/v1/capture/reamp`        | Start a reamp (`source`, `processing`, …)  |
| `POST /api/v1/capture/stop`         | `{ "keep": true }` saves, `false` discards |
| `GET /api/v1/media/assets/{id}/wav` | Download any asset as 24-bit WAV           |
