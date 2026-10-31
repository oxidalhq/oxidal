# Factory collection

Library → **Explore Oxidal sounds** assembles 40 original starting points,
with four scenes each, from installed effects and explicitly selected local NAM
presets. It adds an immutable Oxidal example without changing the playing sound.
Editing an example creates an owned copy. These are version-1 recipes, not a
claim that every genre or arbitrary capture is already auditioned and balanced.

Fresh appliance images install the 15 effects-only sounds in Library on first
boot, with four scenes each and no downloads. The remaining 25 are available in
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

Fixed echo controls are not tempo-synchronized. Coastline uses a room rather than
claiming a spring algorithm. Sub/tracker recipes require clear single notes; pitch
voices add algorithmic delay. Hold capture/release remains explicit in its blocks.
These limitations are in the individual descriptions, not hidden by genre names.

## Assets and dependencies

The standard image contains the recipe settings, **not** third-party NAM/IR payloads or
private development presets. Twenty-two recipes require local saved NAM voices; all four A recipes, all four S recipes, X02 and X04 use effects only. A selected native source contributes its **whole
saved chain**, including its cabinets and settings. Choose an appropriate
amp-and-cab source; this is not an automatic extraction of one amp from a complex
preset. Different captures change gain, timbre and processing cost substantially.
Automatic TONE3000 capture selection/download is a separate unfinished workflow.

Recipes pin plugin URIs, complete control defaults and explicit parameter values.
Required packs are Guitarix, Invada, MDA and SWH, plus Oxidal Hold and Pitch. New appliance builds install these packs and bundle the tested Hold and Pitch effects; existing installations can install the external packs through Settings → Effects. Missing dependencies are
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

Appliance packaging runs `scripts/factory-bundles.mjs --output <directory>` under
Node's `--experimental-strip-types` option to generate only the asset-free bank.
`os/scripts/seed_factory.py` publishes it through the local daemon at startup;
the installed-image tests use a separate temporary library to check the bank and
idempotence. The recipe JSON, not a development-library export, is the source.

For a device run, save `GET /api/v1/rig-audio` to `owner-audio.json` **before**
changing audio. This command temporarily replaces the playing rig, measures four
scenes per recipe with the built-in plucked-string riff, rapidly retargets Blend,
and restores the supplied owner settings on normal/error exit:

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

The optional Hold flag captures the voices in the last prepared preset. The test
uses continuous reference input, keeps physical output muted between switches,
polls telemetry frequently and restores the supplied configuration even on a
failed deadline check. Its report records polling gaps as well as observed peaks.
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
