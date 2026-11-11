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
trim (−24 to +6 dB) and, for reamp results, provenance. A newer schema is
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
- **Where it shows.** A masthead chip from 1024 px, a strip under the masthead
  from 600 px and a bar above the safe area on phones and in E-paper mode. It is
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
