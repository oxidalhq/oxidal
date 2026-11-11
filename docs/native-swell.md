# Oxidal Swell (LV2)

`native/swell` is Oxidal's own auto-swell (slow-gear) effect: each new note fades in instead of starting on its pick, like a volume pedal worked by your playing. It is original code that needs only the LV2 headers.

- **Plugins:** `urn:oxidal:plugin:swell#mono` (Oxidal Swell (Mono)) and `urn:oxidal:plugin:swell#stereo` (Oxidal Swell (Stereo)), one binary `oxidal_swell.so` in the bundle `oxidal-swell.lv2`. Both share one port layout; the mono plugin has no right-hand audio ports.
- **Controls:** all scalar, so scenes and MIDI can change them.

  | Control     | Symbol        | Range      | Default | What it does                                                                                    |
  | ----------- | ------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------- |
  | Threshold   | `threshold`   | −70…−10 dB | −45 dB  | How loud a note must be to count; quieter playing stays silent                                  |
  | Sensitivity | `sensitivity` | 0–100%     | 50%     | How big a jump in level retriggers a swell while a note rings: 100 = 2 dB, 1 = 20 dB, 0 = never |
  | Swell time  | `time`        | 20 ms–4 s  | 600 ms  | The fade-in, from silence to the input level (logarithmic control)                              |
  | Release     | `release`     | 10 ms–5 s  | 300 ms  | The fade-out once the note has died away                                                        |
  | Curve       | `curve`       | 0–100%     | 50%     | Shape of the fade: 0 linear, 50 progress^2.5, 100 progress^4 (slow start, like a volume pedal)  |
  | Mix         | `mix`         | 0–100%     | 100%    | 100 is fully swelled; lower values blend back the unswelled signal; 0 is bit-exact dry          |

- **How it works:** one envelope follower (1 ms attack, 50 ms release) listens to the louder side, so both stereo sides fade together and the image is kept. When it rises above Threshold, a progress value climbs from where it is to 1 over the swell time and the gain is progress^curve; when it falls 6 dB below Threshold, progress falls to 0 over Release, and the next note swells from there. A second, slow follower (80 ms / 400 ms) tracks the ringing level: a jump of the fast follower above it by the Sensitivity margin is a new pick, which fades the current swell out over 4 ms (never a cut) and swells again; attacks are at least 50 ms apart and a jump must settle before another can count. Because the gain is always computed from the continuous progress value, changing Swell time only changes how fast progress moves, and Swell time (in the log domain), Curve and Mix glide to a new value over about 20 ms. A scene change therefore never steps the output.
- **No latency:** there is no lookahead and no latency port; the input is never delayed. The first millisecond of a pick passes at the start of the fade (gain below 0.001 at the defaults).
- **Realtime:** the instance is allocated at instantiate; `run` only computes (no allocation, locks or system calls). Envelopes flush to zero in silence and glides land exactly on their targets, so there are no denormal tails.
- **Build and test:**

  ```sh
  cmake -S native/swell -B build/swell -DCMAKE_BUILD_TYPE=Release
  cmake --build build/swell && ctest --test-dir build/swell
  ```

  The test checks that a note below Threshold is silent and a note above it starts silent (the pick is hidden) and reaches the input level; that Curve 0, 50 and 100 give progress, progress^2.5 and progress^4 at half the swell time and every swell is monotonic and ends at unity; that a linear swell reaches unity at the swell time within a block for 20 ms, 600 ms and 4 s at 48 and 96 kHz; that changing Swell time 4 s → 20 ms and 20 ms → 4 s mid-swell, and Curve and Mix mid-swell, never moves the gain by more than 0.0042 of full scale in one sample at 48 kHz (the steepest step of an uninterrupted 20 ms swell at Curve 100; measured 0.0029, 0.0006 and 0.0011); that Release fades rather than cuts and reaches silence, and the next note swells again; that a +24 dB pick retriggers through the 4 ms fade (never a single-sample cut) and Sensitivity 0 does not retrigger; that stereo sides take the same gain; that Mix 0 is bit-exact dry and a completed swell is bit-exact, undelayed input; that invalid input and controls stay finite; and that `run` makes no allocation.

- **Install:** copy `build/swell/oxidal-swell.lv2` into a directory on the daemon's `LV2_PATH` (on the image, `/usr/local/lib/lv2`) and restart the daemon. The appliance build (`scripts/artifacts.mjs`) builds, tests and packages it beside Hold and Pitch.
- **Qualify:** with the LV2 harness built (see [LV2 host](lv2.md#offline-pack-smoke-checks)), run `oxidal-plugin-check --bundle build/swell/oxidal-swell.lv2/ --sample-rate 48000 --frames 48`; both plugins should be `usable` with `latency_frames` 0.
