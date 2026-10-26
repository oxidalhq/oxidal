# Monitoring

The Monitor view reads real, decimated measurements from the isolated saved-preset and LV2 workers and Linux host counters. It does not synthesize levels while the control preview is silent. Unsupported host readings stay unavailable. Graphs follow shadcn’s composable Recharts pattern and semantic theme tokens.

- Stereo input/output peak and RMS are measured at the mapped DSP buffers, before physical output channel mixing/format conversion. A display floor of −120 dBFS avoids infinities. These are digital levels, not acoustic SPL.
- Clipping counts samples at or above full scale, cumulative per worker. Reset view resets only that browser’s baseline/history. Invalid floating-point samples are counted separately.
- A fixed 128-block timing window reports processing p50/p95/max and its percentage of one period’s deadline. It excludes ALSA I/O, scheduling and queue delays. Buffer arithmetic is not round-trip latency. ALSA must accept the configured rate/period/buffer exactly before starting.
- The meter accumulator uses fixed arrays and no per-block heap allocation. Native JSON/pipe output runs on a separate thread through a capacity-one queue at up to 5 Hz; intermediate views may drop under backpressure. Graph replies use the existing bounded worker protocol. The experimental graph owner/control loop is still not real-time qualified.
- Linux CPU comes from `/proc/stat` deltas without double-counting guest time; memory comes from available/total memory; supported CPU thermal zones retain their sensor identity. Xrun counters, throttling flags, per-block CPU, correlation and USB hotplug history remain pending rather than displaying invented values.
- HTTP sampling is 1 Hz, UI history holds 120 points, and stale audio is marked after 3 seconds. Freeze retains the displayed readings. E-paper mode uses five-second polling and no chart animations. Hidden or closed monitoring views do not poll.

Verification uses known-signal Rust meter tests, real ALSA-null native/LV2 worker HTTP tests, and desktop/mobile Playwright checks for freeze/reset/stale state, overflow and accessibility. Screenshot fixtures are labeled as fixtures, not hardware measurements. Physical Pi overhead/thermal/audio acceptance remains separate.
