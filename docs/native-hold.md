# Oxidal Hold (LV2)

`native/hold` is Oxidal's own spectral sustain effect: switch Hold on and what you are playing keeps ringing as a seamless drone while you play over it. It is original code that needs only the LV2 headers.

- **Plugins:** `urn:oxidal:plugin:hold#mono` (Oxidal Hold (Mono)) and `urn:oxidal:plugin:hold#stereo` (Oxidal Hold (Stereo)), one binary `oxidal_hold.so` in the bundle `oxidal-hold.lv2`.
- **Controls:** Hold (on captures, off releases), Attack 10 ms–5 s (default 300 ms), Release 10 ms–10 s (default 1.5 s), Level −40…+6 dB of the held sound, Dry (on by default; off leaves only the held sound). A footswitch maps to Hold once physical MIDI is in; momentary or latching is the switch's behaviour.
- **How it works:** the last few overlapping frames (about 43 ms each, four at a quarter-frame hop) are analysed when Hold goes on and their magnitude spectra are averaged. While held, every hop resynthesises that spectrum with fresh random phases and overlap-adds it, so the sound neither loops nor beats. Each stereo side is held on its own with independent phases. The dry path has no latency; the held sound is not time-critical and reports none.
- **Realtime:** every buffer and FFT table is allocated at instantiate; `run` only computes. Frame length doubles at 96 kHz and again above 100 kHz to keep the same duration.
- **Build and test:**

  ```sh
  cmake -S native/hold -B build/hold -DCMAKE_BUILD_TYPE=Release
  cmake --build build/hold && ctest --test-dir build/hold
  ```

  The test holds a 220 Hz tone and checks the drone stays within 3 dB of the captured level at that pitch after the input stops (at 48 and 96 kHz), that Release reaches silence, that dry is bit-exact while not held, that the stereo sides differ, and that invalid input and controls stay finite.

- **Install:** copy `build/hold/oxidal-hold.lv2` into a directory on the daemon's `LV2_PATH` (on the image, `/usr/local/lib/lv2`) and restart the daemon.
