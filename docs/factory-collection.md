# Factory collection

Library → **Explore Oxidal sounds** assembles 44 original starting points from
installed effects and explicitly selected local NAM presets. Forty are four-scene
instruments; four experimental presets are long serial chains. It adds an immutable
Oxidal example without changing the playing sound.
Editing an example creates an owned copy. These are version-1 recipes, not a
claim that every genre or arbitrary capture is already auditioned and balanced.

Fresh appliance images install the 16 effects-only sounds in Library on first
boot with no downloads. The remaining 28 are available in
the collection browser for assembly with the NAM voices you choose. The initial
seed uses deterministic manifests, verifies installed plugin controls and writes
a persistent completion marker. A partial run can retry without duplicating
presets; after completion, deleting an example does not recreate it at reboot.
It never starts audio or alters existing presets. Seeding errors are logged in
the daemon's systemd journal without preventing the daemon from running.

| ID  | Instrument    | Role and scene palette                                    |
| --- | ------------- | --------------------------------------------------------- |
| C01 | Clear Current | Clean studio voice: dry, compression, width, lead         |
| C02 | Velvet Room   | Jazz / neo-soul: warm clean, movement, intimate room      |
| C03 | Pocket Wire   | Funk: compression, envelope wah, phaser                   |
| R01 | Copper Edge   | Blues / roots: touch, push, grain, shared echo            |
| R04 | Offbeat       | Reggae / dub: clean chops and independent wet sends       |
| K01 | Open Circuit  | Classic rock: shared NAM and drive colours                |
| H01 | Iron Pulse    | Metal: high-pass / drive tightening before NAM            |
| B02 | Split Rail    | Bass: compressed lows plus NAM grit / fuzz highs          |
| A01 | Afterlight    | Ambient: dry signal with independent echo and hall        |
| A04 | Slow Weather  | Hold: capture a chord manually, mix it under live playing |
| S01 | Reed Circuit  | Synth texture: monophonic tracking and resonant filtering |
| X03 | Two Horizons  | Two NAM voices: clean / crunch / combined / lead          |

The expanded bank adds Interlace (clean interlocking echoes), Dust Road (roots),
Coastline (slap/tremolo), Hot Wire (punk/hard rock), Chrome Night (wide clean/lead),
Long Arc (fuzz/rotary), Low Gravity (detuned heavy), Ash Field (doom), Glass and Teeth
(clean/heavy contrasts), Foundation (supportive bass), Elastic (envelope bass),
Substation (dub/sub), Soft Ruin (shoegaze), Orbit (interlocking delays), Rotor Choir
(octave/rotary), Glass Steps (reverse/pitched textures), Low Lantern (sub voice),
Small Hours (tape), Broken Radio (degraded/ring textures), and Held Light (pitched
sustain). Search names, genres and descriptions inside the collection browser.

The provider additions are Studio Glass (x42 compressor, FOMP modulation and
Dragonfly Early Reflections), Rubber Pocket (x42/FOMP bass envelope), Liquid Chrome
(FOMP rock modulation), Glass Atrium (Dragonfly Hall), Blue Hour (close reflections),
Prism Orbit (experimental phaser/pitch/Hall), Rubber Bloom (experimental wah/Hold),
and Velvet Ensemble (chorus/pitch/reflections). Dragonfly Room is deferred pending
independent-instance comparison; it is not used by these recipes.

Four experimental serial additions deliberately leave the repeated scene layout:
Cascade Engine stacks two complete whole-rig NAM captures among pedals, Pressure
Vessel drives one heavy NAM through a longer pedal path, Night Conveyor is a
seven-block effects-only evolving chain, and Subcurrent runs one bass NAM through
six further processing stages. They are capacity and sound-design starting points,
not claims that whole-rig NAM stacking is equivalent to separate amp, cab and IR
stages. Their descriptions require a low initial Master Level and Sound Check before
audition.

Fixed echo controls are not tempo-synchronized. Coastline uses a room rather than
claiming a spring algorithm. Sub/tracker recipes require clear single notes; pitch
voices add algorithmic delay. Hold capture/release remains explicit in its blocks.
These limitations are in the individual descriptions, not hidden by genre names.

## Named voices and the era songbook

Recipes choose a NAM sound through a **voice**: Oxidal's own id for a sound, such
as a plexi-style crunch, an 800-style lead, a scooped modern high-gain or a
blackface-style clean. `apps/web/src/factoryVoices.ts` lists each voice with a
plain description and the TONE3000 tone and model ids to download for it. Only
numeric ids are stored; titles, creators, licences and sizes are read from
TONE3000 and shown as the provider presents them. No capture ships with Oxidal.
The four original roles (`clean`, `crunch`, `heavy`, `bass`) still work as
player-chosen bindings.

`apps/web/src/songbookRecipes.ts` adds original presets tagged by era (`80s`,
`90s`, `2000s`, `Modern`) and genre. Each preset has its own amp voice, so the
bank no longer shares four amps. Songbook names stand alone, without the
"Oxidal ·" prefix, and every preset uses the same scenes in the same order:
Rhythm, Lead, Intro and Boost. Names, descriptions and tags describe the sound
and never name an artist, song or trademarked product.

Captures are downloaded by the player, one preset at a time, when they first use
a preset that needs them; nothing is downloaded in bulk or ahead of use.

## Assets and dependencies

The standard image contains the recipe settings, **not** third-party NAM/IR payloads or
private development presets. Twenty-eight recipes require local saved NAM voices;
16 are effects-only. A selected native source contributes its **whole
saved chain**, including its cabinets and settings. Choose an appropriate
amp-and-cab source; this is not an automatic extraction of one amp from a complex
preset. Different captures change gain, timbre and processing cost substantially.
Automatic TONE3000 capture selection/download is a separate unfinished workflow.

Recipes pin plugin URIs, complete control defaults and explicit parameter values.
Required packs are Guitarix, Invada, MDA, SWH, x42, FOMP and Dragonfly, plus Oxidal Hold and Pitch. New appliance builds install these packs and bundle the tested Hold and Pitch effects; existing installations can install the external packs through Settings → Effects. Missing dependencies are
shown before Build. The initial reverbs are GxReverb-Stereo and GxZita_rev1-Stereo.
Dragonfly's Atom ports require explicit portable state in the mixed loader; it is
not silently admitted through the scalar recipe builder. Same-name URI substitutes,
missing defaults, Atom effects and incompatible parameter ranges are rejected.
The public metadata fixture in `apps/web/src/fixtures/factory-lv2.json` was obtained
from the installed Pi catalog at 48 kHz; it contains no capture payloads.

Sources remain immutable. Each built preset embeds verified copies of the chosen
resources through the existing bundle publisher. Rights to downloaded or purchased
captures still belong to their respective providers; local assembly does not grant
redistribution rights.

## Signal layout and switching

Shared NAM/effects are instantiated once per recipe, before the split or after the
sum. Scene gates control the **input** of each branch; its return remains connected
so delays and reverbs drain naturally. Wet-send recipes keep dry and wet signals
separate. Complete gain snapshots prevent old scene settings leaking into a new
selection. Blend ramps these sends; it can also change the drive into nonlinear
blocks. It is not a transparent crossfade between two independently rendered
nonlinear outputs.

Serial recipes have one ordered path and no scene split/merge. Mono effects add
explicit stereo-to-mono and mono-to-stereo adapters while preserving the order of
the processing blocks. The collection UI reports scene count, parallel voice count,
serial block count and NAM stage count separately so those quantities are not
mistaken for an engine limit. Once saved, the normal Library and Rig picker report
serial/parallel/scene topology and the actual NAM and LV2 instance counts.

New preserved-scene compositions and these factory recipes also declare whole
preset `recall.tails: preserve`. A prepared resident switch ramps input sends and
keeps the outgoing graph's aligned output. Cut retains its output-crossfade policy.
Existing saved presets are not rewritten. A legacy Cut preset can therefore still
cut whole-preset trails even if its internal scenes preserve branch trails.

Prepared graphs remain alive and process silence when not selected. Retained
returns have **no arbitrary timeout**; their natural decay is preserved, and a
held/infinite effect can continue until released, reselected and edited, or audio
stops. There is no automatic silence detector or suspension yet. Memory and CPU
cost are bounded by the explicitly prepared set, but there is no measured CPU
admission guard: do not prepare the entire collection by default. Repeated scene
changes can retarget a ramp; whole-preset requests are serialized until the current
transition completes. Ordinary Start, Restart and reconfiguration interrupt audio.

## Reproducible assembly and qualification

Use the pinned Node version. Save explicit `RigNativeSource` objects from
`GET /api/v1/presets/rig-sources` in a JSON object keyed by `clean`, `crunch`,
`heavy` and `bass`. Then run:

```sh
node --experimental-strip-types scripts/factory.mjs \
  --bindings /path/to/roles.json --output /path/to/build
```

This validates all recipes and writes requests without publishing. Add `--publish`
to create presets through a loopback API or SSH tunnel (`--api` defaults to
`http://127.0.0.1:3230`). Existing output IDs are reused on retry. Changing settings
creates a new immutable revision; old revisions are not silently deleted.
Use `--ids X07,H06,X08,B06` to build or publish only a named subset; an unknown ID
is rejected before any request is written.

Appliance packaging runs `scripts/factory-bundles.mjs --output <directory>` under
Node's `--experimental-strip-types` option to generate only the asset-free bank.
`os/scripts/seed_factory.py` publishes it through the local daemon at startup;
the installed-image tests use a separate temporary library to check the bank and
idempotence. The recipe JSON, not a development-library export, is the source.

For a device run, save `GET /api/v1/rig-audio` to `owner-audio.json` **before**
changing audio. This command temporarily replaces the playing rig, measures four
scenes for a scene instrument or one full pass for a serial chain with the built-in
plucked-string riff, rapidly retargets Blend where scenes exist, and restores the
supplied owner settings on normal/error exit:

```sh
python3 scripts/qualify-factory.py \
  --published /path/to/build/published.json \
  --restore /path/to/owner-audio.json --output /path/to/pi-scenes.json
```

For a longer prepared-set run, save a `StartRig` settings object containing its
prepared alternatives, then use:

```sh
python3 scripts/qualify-prepared.py \
  --settings /path/to/prepared-settings.json \
  --restore /path/to/owner-audio.json --output /path/to/prepared-soak.json \
  --seconds 3600 --frames 256 --capture-last-hold
```

For a bounded ad-hoc set, pass `--revisions first,second,...` instead of
`--settings`; the runner reuses the captured restore snapshot's stream and builds
null-recall prepared entries for only those immutable revisions.

### Pi 5 serial-topology evidence

The initial device qualification used the owner's Jogg at 48 kHz with three
periods, the built-in reference riff and physical output muted. At 64 frames, each
of the four serial presets ran alone with zero xruns, deadline misses or invalid
samples. Their measured callback peaks were 1,279.152 µs for Cascade Engine,
594.457 µs for Pressure Vessel, 344.978 µs for Night Conveyor and 1,171.358 µs for
Subcurrent against a 1,333.333 µs deadline. Pressure Vessel's earlier two-NAM
variants exceeded the deadline; the admitted recipe therefore uses one heavy NAM
stage and those failed revisions were archived rather than presented as qualified.

Prepared-set results show why lane count is not a capacity limit:

| Resident set         | Frames | Result | Evidence                                                        |
| -------------------- | -----: | ------ | --------------------------------------------------------------- |
| X07 + H06            |     64 | Fail   | 1,503.726 µs peak; 11 deadline misses                           |
| X07 + X08            |     64 | Fail   | 1,456.115 µs peak; first miss after 7.09 seconds                |
| All four serial rigs |     64 | Fail   | 2,171.534 µs peak; 139 misses and 26 xruns                      |
| All four serial rigs |    128 | Fail   | 3,411 µs peak; 163 misses and 9 xruns                           |
| X07 + X08            |    128 | Pass   | 600 seconds, 488 switches, 2,634.124 µs peak, zero audio errors |

The passing pair consumed 98.8% of its 2,666.667 µs callback deadline at its worst
point, so it is measured evidence rather than a safe default capacity promise.
Increasing the buffer also increases the amount of work each prepared graph does
per callback; it did not make the four-resident set fit. Oxidal needs an admission
and headroom warning based on the actual prepared graphs, not a fixed lane or
preset count. The qualification restored the exact pre-test rig and the live API
then reported zero xruns, deadline misses and invalid samples.

The later resident scheduler warms each alternative before PCM opens, then stops
rendering untouched alternatives. Cut graphs drain silently and Preserve returns
remain audible until both channels stay below −140 dBFS for two seconds; a Hold or
feedback path that keeps producing samples does not sleep. This removes silent
prepared graphs from steady callback work without shortening an audible tail. The
measurements above remain historical evidence for the former always-rendering
scheduler; repeat the same Pi matrix before accepting new resident-set capacity or
buffer defaults.

The optional Hold flag captures the voices in the last prepared preset. The test
uses continuous reference input, keeps physical output muted between switches,
polls telemetry frequently and restores the supplied configuration even on a
failed deadline check. Its report records polling gaps as well as observed peaks.
It also snapshots every resident's Library topology, scene names and actual
native/LV2 instance counts, plus the worker's prepared status, buffer allocation
and graph-reported latency. Missing Library metadata is explicit rather than
silently reducing a capacity run to opaque revision hashes.
DSP percentiles cover a rolling 128-callback window; the separate session peak
and deadline-miss count are cumulative, so a polling delay cannot hide a spike.
The example buffer size is a qualification choice, not an automatic capacity
guarantee. A killed process still requires manual restoration.

The reference utility measures pre-master DSP and mutes physical output while
active. Its LUFS and real ALSA scheduling evidence do not establish audible tone
quality, analog round-trip performance, clipping before the measurement mute, or
bass/monophonic tracking quality with a human performance. An interrupted/killed
qualification process may require manually restoring the saved configuration.

The engine tests compare retained echoes against uninterrupted PCM, rapid
A→B→C→A sequences, mixed Cut/Preserve returns, unequal path latency and candidate
failure. `cargo run --release -p oxidal-engine --features native --example
qualify_tails` runs on a Linux device with Guitarix installed: it compares the
actual Zita reverb tail and a captured Oxidal Hold chord to unswitched references,
with Cut as a negative control. It opens no PCM device and reports offline timing separately from live
ALSA evidence. Physical listening and longer loaded-device acceptance remain
necessary before a release claim.
