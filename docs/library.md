# Presets, NAM models and IRs

Library has three browsing sections: Presets, NAM models and IRs. Preset authoring
remains in Presets. Browsing and importing files never starts playback or changes
the current sound; model selection for a playing block remains a separate action
in Rig.

Presets are grouped by origin: immutable TONE3000 downloads, immutable Oxidal
examples and Mine. Only Mine is the device set list used by Perform, Previous,
Next and MIDI program order. A first sonic edit to either immutable group creates
and starts a Mine copy, retains description/categories with copy credit, and asks
the player to Keep or Discard it. Discard returns to the source before removing
the new copy. Legacy portable rigs without an explicit origin are Mine.

NAM models and IRs include both TONE3000 downloads and files added by the user.
The existing verified `audition-models` store retains these files independently
of saved presets. A native preset embeds its model bytes; a mixed bundle embeds
its native resources and explicit assets for portable offline recall. The
independent library file and a preset's embedded bytes have separate lifetimes.
Deleting a preset must keep independent files by default; optional dependency-safe
asset removal is a separate operation. Preset deletion is not implemented by the
new file browsing interface.

## Browse and download

`GET /api/v1/models/local` preserves its existing `after` and `all` parameters,
with optional `format=nam|ir` and `query` filters. Format and case-insensitive
name/title/import-folder search run before the existing 64-row pagination limit.
The browser renders one page at a time and keeps each section's search while
moving between workspaces. Stale searches/pages are cancelled and cannot replace
the current result. Listing checks metadata integrity. IR pages additionally read at most 64 bounded
WAV chunk headers per file and seek past sample data; loading a model still
verifies its complete content hash. PCM/float RIFF WAV headers provide actual
rate, channels, bit depth, frames and duration. Unsupported or malformed headers
have no audio metadata; RF64 and unknown encodings currently use this fallback.
The readings are informational and do not establish playback compatibility.

TONE3000 opens the existing provider browser in download mode. An explicit model
download uses the signed-in account and existing entitlement/download checks,
then refreshes the library. Download mode has no live-audition controls or playback
callback. Existing provider collection/search limits remain unchanged; this does
not introduce a global TONE3000 catalog index or bulk provider downloads.

## Import collections

Import offers file and folder selection. Each request contains one NAM or WAV
file, up to the existing 32 MiB limit. The browser keeps file handles and metadata
for the selection, uploads sequentially, and reports progress and individual
failures. A collection's total size is not constrained to the model picker's
separate 32 MiB multi-variant block budget. No entire collection is read into RAM
or sent in one request. Cancellation stops remaining work; files already accepted
by the unit remain in the library. An accepted in-flight request may finish even
if its client disconnects; refresh is the authority for what was stored.

For folder imports, the optional `folder` upload parameter preserves a relative
display folder in verified asset metadata and returns it in `LocalModel.folder`.
It is searchable, never resolved as a filesystem path, and rejects traversal,
absolute paths, control characters and invalid components. File bytes retain
their content hash. Identical repeated imports with the same metadata remain
idempotent; differently named/foldered entries can contain the same model bytes.
There is no claim of cross-entry blob deduplication.

This supports bounded import of collections totaling gigabytes, not a promise
of a particular transfer speed or disk capacity. The mounted data filesystem
still determines available space; failed writes are reported per file. The
32 MiB per-file admission and downstream engine compatibility limits remain.
This increment does not qualify every WAV as a playable IR or every NAM format
for the native engine.

## Cabinet groups and capture details

The IR view groups each bounded page by its cabinet collection. Recognized
Boutique Tones MZero capture names become microphone code, position code and
angle or mix labels; original file/folder names stay under each expandable row.
Unknown naming conventions keep readable original names and folder headings,
without guessing microphone brands or distance units. Technical values always
come from WAV headers, even when a folder's rate label disagrees.

NAM entries open a model preview. Downloaded provider details are read from the
immutable asset's retained metadata; images use the existing Pi `tone-images`
cache and are loaded through the unit, including when the account is unavailable
and the picture is already cached. Uploaded NAMs retain bounded name, author,
trainer and gear metadata. Explicit namespaced TONE3000 tone IDs, or a tone ID
alongside the TONE3000 trainer, can resolve provider details; a model ID or trainer
label alone never becomes a tone identity. Explicit HTTPS TONE3000 source URLs
may link to that source. Other uploads keep a neutral placeholder. No source file
or existing immutable asset is rewritten. Earlier uploads without this descriptive
metadata continue using their filename.

Audio audition is separate from opening the preview. It reads the currently
running native/mixed rig, requires an explicit block selection, then uses the same
revision/session-checked preparation operations as the Rig picker. A changed
owner is rejected. The UI polls only its accepted preparation receipt and reports
confirmed application or failure. Audition changes the selected live block;
closing keeps that change, and the player can restore it with Undo in Rig. It
does not save or overwrite a preset. With no suitable running rig, the preview
links to Rig rather than starting audio automatically.

## Library backup

Library → Manage library → Download backup streams a versioned tar archive directly
from the private data root. It includes preset payloads, set-list order and labels,
descriptions/categories, per-preset MIDI maps, separate NAM/IR files and the global
MIDI mapping document. The download holds the library's exclusive file gate so a
concurrent save, import or deletion cannot produce a partial snapshot. Large assets
are never collected into memory or duplicated into a temporary archive on the unit.

The archive deliberately excludes TONE3000 account tokens, control-audit records and
monitor history. Account sign-in must be re-established independently. Symlinks are
archived as links rather than followed outside the private root. The v1 archive is a
portable backup artifact; automated in-place restore is not yet exposed because it
needs its own preview, capacity check, stopped-audio gate and rollback transaction.
