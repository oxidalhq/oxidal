# Oxidal Pitch (LV2)

`native/pitch` builds the TONE3000 pitch engine as a standalone LV2 effect, so a pitch block can sit anywhere in a preset (for example in one lane of a preset with scenes) instead of only inside a TONE3000 chain.

- **Plugins:** `urn:oxidal:plugin:pitch#mono` (Oxidal Pitch (Mono)) and `urn:oxidal:plugin:pitch#stereo` (Oxidal Pitch (Stereo)), one binary `oxidal_pitch.so` in the bundle `oxidal-pitch.lv2`.
- **Controls:** Enabled (on by default; off fades to dry), Semitones −24…+24, Step (whole semitones), Tonality (20000 Hz is off), Buffer 20/30/40/60 ms, Input (Stereo, Left or Right before pitch, stereo variant). The plugin reports its latency on the `latency` port, so Oxidal's graph aligns parallel paths around it.
- **Engine:** `PitchShift.h`/`PitchShift.cpp` compiled unmodified from the pinned TONE3000 checkout (`native/tone3000/sources.json`, ab5e5ae), hash-checked by CMake. Nothing is vendored or downloaded.
- **Build:** after `native/tone3000/build.py` has prepared the pinned checkouts,

  ```sh
  cmake -S native/pitch -B build/pitch -DCMAKE_BUILD_TYPE=Release \
    -DOXIDAL_PITCH_JUCE_SOURCE=<tone3000 checkout>/libs/juce \
    -DOXIDAL_PITCH_TONE3000_SOURCE=<tone3000 checkout>
  cmake --build build/pitch && ctest --test-dir build/pitch
  ```

  `pitch-wrapper-upstream` checks the LV2 wrapper sample for sample against the engine compiled on its own, across controls, sample rates and block sizes; `pitch-bundle-load` loads both descriptors through `lv2_descriptor`.

- **Install:** copy `build/pitch/oxidal-pitch.lv2` into a directory on the daemon's `LV2_PATH` (on the image, `/usr/local/lib/lv2`) and restart the daemon; Add effect then lists it.
- **Licences:** the adapter is MIT (ported from a PiPedal fork), TONE3000 is MIT, and JUCE 9.0.3 links under its AGPLv3 path like the TONE3000 adapter. The bundle carries all three notices.
