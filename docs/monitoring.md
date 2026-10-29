# Monitoring

The Monitor view reads real, decimated measurements from the isolated saved-preset and LV2 workers and Linux host counters. It does not synthesize levels while the control preview is silent. Unsupported host readings stay unavailable. Graphs follow shadcn’s composable Recharts pattern and semantic theme tokens.

- Stereo input/output peak and RMS are measured at the mapped DSP buffers, before physical output channel mixing/format conversion. A display floor of −120 dBFS avoids infinities. These are digital levels, not acoustic SPL.
- Clipping counts samples at or above full scale, cumulative per worker. Reset view resets only that browser’s baseline/history. Invalid floating-point samples are counted separately.
- A fixed 128-block timing window reports processing p50/p95/max and its percentage of one period’s deadline. It excludes ALSA I/O, scheduling and queue delays. Buffer arithmetic is not round-trip latency. ALSA must accept the configured rate/period/buffer exactly before starting.
- The meter accumulator uses fixed arrays and no per-block heap allocation. Native JSON/pipe output runs on a separate thread through a capacity-one queue at up to 5 Hz; intermediate views may drop under backpressure. Graph replies use the existing bounded worker protocol. The experimental graph owner/control loop is still not real-time qualified.
- Linux CPU comes from `/proc/stat` deltas without double-counting guest time; memory comes from available/total memory; supported CPU thermal zones retain their sensor identity. Xrun counters, throttling flags, per-block CPU, correlation and USB hotplug history remain pending rather than displaying invented values.
- HTTP sampling is 1 Hz, UI history holds 120 points, and stale audio is marked after 3 seconds. Freeze retains the displayed readings. E-paper mode uses five-second polling and no chart animations. Right-channel and host-CPU traces use dashed strokes with matching legends so they remain distinguishable without colour. Hidden or closed history views do not poll. A compact sticky resource strip polls independently across all main views (1 Hz, 5 seconds for e-paper). A read-only `/monitor/events` SSE stream invalidates its cached snapshot on confirmed playback phase changes and first meter availability, so Start/Stop/failure do not wait for the slow e-paper poll. Older in-flight HTTP replies cannot overwrite that refresh; regular polling remains the fallback. Starting/stopping and waiting for initial meters are distinct from stopped or stale audio. Host sampling stays at 1 Hz and steady meter updates do not emit lifecycle events; freezing diagnostic history does not freeze live resource status. It displays DSP p95/peak deadline percentages, total host CPU, RAM used/total, cumulative clips and xruns when available. Stopped/stale/disconnected audio never retains a healthy-looking numeric DSP reading.

Verification uses known-signal Rust meter tests, real ALSA-null native/LV2 worker HTTP tests, and desktop/mobile Playwright checks for freeze/reset/stale state, overflow and accessibility. Screenshot fixtures are labeled as fixtures, not hardware measurements. Physical Pi overhead/thermal/audio acceptance remains separate.

## Recorded device history

`GET /api/v1/monitor/history` returns the latest 720 validated samples.
`GET /api/v1/monitor/history/export` downloads all retained samples as JSON.
The Monitor page's **Device history** panel loads on demand and offers refresh
and export; it does not add continuous graph polling. Freeze/Reset still affect
only the current browser's live graph.

The daemon records every five seconds independently of clients. Four rotating
2 MiB JSONL files under `presets/monitor-history/` bound storage to 8 MiB. Rotation
is size-based, not a guaranteed number of days. Records carry schema version,
wall-clock milliseconds, recorder identity, monotonic elapsed time, audio session
and the existing decimated host/stream/meter snapshot. Error message text is
excluded. No audio samples, credentials, commands or model bytes are recorded.

A two-entry nonblocking queue isolates collection from background file writes.
Storage failure or a full queue drops history samples and reports counters; it
does not stop audio. Interrupted/corrupt records are skipped and counted on read.
The latest write is not guaranteed to survive sudden power loss. The graph leaves
gaps across recorder/audio-session changes, long sampling gaps and stale audio.
Exports retain timestamps and elapsed time so clock corrections can be identified.

This is sampled telemetry, not an operation audit trail. Persistent action/outcome
auditing and historical time/category filtering remain separate work.

## Control request audit

Monitor → **Control audit** provides operation, outcome and local time-range
filters, on-demand refresh, and a JSON export of all retained records. It does
not poll while playing. Rows are newest first and rendered in pages of 50.
`GET /api/v1/audit` and `/api/v1/audit/export` return the same validated records.

The audit records completion of allowlisted POST requests for native/mixed/effects
audio, device/network, provider account, draft/defaults, preset/library, model
import/download and shared controls. **Accepted** means an HTTP success response,
not confirmed audio application; **Rejected** covers non-server unsuccessful
responses and **Failed** covers server errors. Records include request/completion
time, a fixed operation category and HTTP status. No body, query string, path,
header, terminal command, error text, credentials or audio is persisted. Unknown
routes, polling, terminal and diagnostic commands are excluded. Proxy-level
authentication rejection never reaches this journal.

Two rotating 1 MiB JSONL files under `presets/control-audit/` bound retention.
A nonblocking 64-entry queue delegates writes to the blocking pool. Dropped writes
and unreadable records are exposed; this is best-effort troubleshooting history,
not a guaranteed security log. Interrupted appends are isolated and skipped.
Sudden power loss may lose the latest writes. Worker-confirmed application events,
unfinished requests and gesture coalescing are still pending; repeated knob
adjustments currently produce separate request records.

Device history offers DSP/CPU, RAM percentage, temperature and newly recovered
xruns per recorded interval. Recent ranges use the recorder's elapsed clock and
stay within its current run; All loaded includes the latest 720 stored samples.
Xrun deltas require adjacent fresh samples in the same audio/recorder session and
a nondecreasing counter. Session changes, counter resets and stale readings leave
gaps rather than zeroes. These sampled counts cannot locate an individual glitch
within the five-second interval or prove its cause.

Export shown CSV exports every available reading for the selected loaded range,
with explicit units, UTC timestamps, recorder/audio identities and blank missing
values. The JSON export still includes all retained samples. Neither operation
adds periodic browser polling or changes audio processing.
