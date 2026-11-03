# Oxidal Hold (LV2)

`native/hold` is Oxidal's own spectral sustain effect: switch Hold on and what you are playing keeps ringing as a seamless drone while you play over it. It is original code that needs only the LV2 headers.

- **Plugins:** `urn:oxidal:plugin:hold#mono` (Oxidal Hold (Mono)) and `urn:oxidal:plugin:hold#stereo` (Oxidal Hold (Stereo)), one binary `oxidal_hold.so` in the bundle `oxidal-hold.lv2`.
- **Controls:** Hold (on captures, off releases), Attack 10 ms–5 s (default 300 ms), Release 10 ms–10 s (default 1.5 s), Level −40…+6 dB of the held sound, Focus 0–100% (default 80: how much of the sound that is not a note's partial is dropped from the hold, so amp hiss, room and distortion fizz are not frozen into a wash), Width 0–100% (stereo only, default 50: 100 keeps the captured stereo image, 0 holds the centre), Dry (on by default; off leaves only the held sound). The mono plugin has no Width, so its audio ports are numbered one lower. A footswitch maps to Hold once physical MIDI is in; momentary or latching is the switch's behaviour.
- **How it works:** when Hold goes on, the newest frame (about 85 ms) and the one a quarter-frame before it are analysed. The held sound keeps each bin's magnitude and keeps turning its phase at the rate it was turning between the two frames, then every quarter-frame hop it is resynthesised and overlap-added. Before that, Width pulls the two sides toward their mid, and Focus keeps only the bins within two of a spectral peak (a local maximum well above its neighbourhood and above 3% of the strongest peak), scaling the rest down; the kept sound is brought back to the loudness the whole had. A held note therefore stays the same steady note, with its harmonics, rather than becoming a noise wash, and each stereo side follows its own input, so a mono source stays mono and a wide one keeps its image. (An earlier version averaged four short frames and gave every bin a fresh random phase; on a distorted chord that kept the tone colour but lost the harmonics and decorrelated the sides, which sounded like a wide wash of the chain's EQ rather than the last note.) The dry path has no latency; the held sound is not time-critical and reports none.
- **Chain position:** a Hold added at the end of a chain starts with Focus at 0, so it captures the complete processed spectrum passed by upstream effects such as a flanger, room or distortion. The standard plugin default remains 80 for deliberately isolating note partials. An end-of-chain Hold freezes the flanger coloration present in its capture window; putting the flanger after Hold keeps the held sound sweeping.
- **Realtime:** every buffer and FFT table is allocated at instantiate; `run` only computes. Frame length doubles at 96 kHz and again above 100 kHz to keep the same duration.
- **Build and test:**

  ```sh
  cmake -S native/hold -B build/hold -DCMAKE_BUILD_TYPE=Release
  cmake --build build/hold && ctest --test-dir build/hold
  ```

  The test holds a 220 Hz tone and checks the drone stays within 3 dB of the captured level at that pitch after the input stops (at 48 and 96 kHz), that Release reaches silence, that dry is bit-exact while not held, that the stereo sides differ, and that invalid input and controls stay finite.

- **Install:** copy `build/hold/oxidal-hold.lv2` into a directory on the daemon's `LV2_PATH` (on the image, `/usr/local/lib/lv2`) and restart the daemon.
