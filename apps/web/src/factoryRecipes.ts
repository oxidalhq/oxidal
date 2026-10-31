import type { Lv2Plugin, RigDocument } from './api';
import type { RigNativeSource } from './generated/contract';
import { rigBuilder, type DraftEffect } from './rigDraft.ts';

const pluginUris: Record<string, string> = {
  'Oxidal Pitch (Stereo)': 'urn:oxidal:plugin:pitch#stereo',
  'Reverse Delay (5s max)': 'http://plugin.org.uk/swh-plugins/revdelay',
  'MDA Leslie': 'http://drobilla.net/plugins/mda/Leslie',
  'MDA SubSynth': 'http://drobilla.net/plugins/mda/SubSynth',
  'MDA Degrade': 'http://drobilla.net/plugins/mda/Degrade',
  'MDA RingMod': 'http://drobilla.net/plugins/mda/RingMod',
  GxTape: 'http://guitarix.sourceforge.net/plugins/gxtape#tape',
  'GxZita_rev1-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_zita_rev1_stereo#_zita_rev1_stereo',
  'GxReverb-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_reverb_stereo#_reverb_stereo',
  GxAutoWah: 'http://guitarix.sourceforge.net/plugins/gxautowah#autowah',
  GxBigMuffPi: 'http://guitarix.sourceforge.net/plugins/gx_bmp_#_bmp_',
  'GxChorus-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_chorus_stereo#_chorus_stereo',
  GxCompressor:
    'http://guitarix.sourceforge.net/plugins/gx_compressor#_compressor',
  GxPhaser: 'http://guitarix.sourceforge.net/plugins/gx_phaser#_phaser',
  GxRat: 'http://guitarix.sourceforge.net/plugins/gx_aclipper_#_aclipper_',
  GxTremolo: 'http://guitarix.sourceforge.net/plugins/gx_tremolo#_tremolo',
  GxTubeScreamer: 'http://guitarix.sourceforge.net/plugins/gxts9#ts9sim',
  'Invada High Pass Filter (stereo)':
    'http://invadarecords.com/plugins/lv2/filter/hpf/stereo',
  'Invada Low Pass Filter (stereo)':
    'http://invadarecords.com/plugins/lv2/filter/lpf/stereo',
  'MDA DubDelay': 'http://drobilla.net/plugins/mda/DubDelay',
  'MDA RezFilter': 'http://drobilla.net/plugins/mda/RezFilter',
  'MDA Tracker': 'http://drobilla.net/plugins/mda/Tracker',
  'Oxidal Hold (Stereo)': 'urn:oxidal:plugin:hold#stereo',
};

export type FactoryRole = 'clean' | 'crunch' | 'heavy' | 'bass';
type Effect =
  | { plugin: string; controls?: Record<string, number> }
  | { native: FactoryRole };
type Voice = { name: string; effects: Effect[] };
export type FactoryRecipe = {
  id: string;
  name: string;
  description: string;
  categories: string[];
  before: Effect[];
  voices: Voice[];
  after: Effect[];
  scenes: { name: string; mix: number[]; level?: number }[];
};
const fx = (plugin: string, controls: Record<string, number> = {}): Effect => ({
  plugin,
  controls,
});
const nam = (native: FactoryRole): Effect => ({ native });
const room = () =>
  fx('GxReverb-Stereo', { dry_wet: 12, roomsize: 0.35, damp: 0.55 });
const hall = (dry = 100, decay = 3) =>
  fx('GxZita_rev1-Stereo', {
    DRY_WET_MIX: dry ? -0.65 : 1,
    MID_RT60: decay,
    LOW_RT60: Math.min(8, decay * 0.8),
    HF_DAMPING: 6500,
    LF_X: 180,
    IN_DELAY: 25,
  });
const compressor = () =>
  fx('GxCompressor', {
    THRESHOLD: -22,
    RATIO: 2.5,
    ATTACK: 0.012,
    RELEASE: 0.15,
  });
const chorus = () =>
  fx('GxChorus-Stereo', { level: 0.25, depth: 0.012, freq: 0.7 });
const drive = () => fx('GxTubeScreamer', { fslider0_: -12, fslider2_: 0.2 });
const echo = (wet = 0.25) =>
  fx('MDA DubDelay', {
    delay: 0.32,
    feedback: 0.45,
    fx_mix: wet,
    lfo_depth: 0.03,
  });
const echoAt = (delay: number) =>
  fx('MDA DubDelay', { delay, feedback: 0.3, fx_mix: 1, lfo_depth: 0 });
const reverse = (seconds: number) =>
  fx('Reverse Delay (5s max)', {
    delay_time: seconds,
    dry_level: -70,
    wet_level: -6,
    feedback: 0.2,
    xfade_samp: 1250,
  });
const pitch = (semitones: number) =>
  fx('Oxidal Pitch (Stereo)', { semitones, window: 1, input_mode: 0 });
const rotary = (speed: number) =>
  fx('MDA Leslie', { speed, mode: speed < 0.5 ? 0.2 : 0.8 });
const sub = (level: number) =>
  fx('MDA SubSynth', { level, dry_mix: 0, thresh: 0.35 });
const tape = () =>
  fx('GxTape', { drive: 0.25, hiss: 0, wowdepth: 0.006, flutdepth: 0.004 });
const held = () =>
  fx('Oxidal Hold (Stereo)', {
    dry: 0,
    level: -9,
    attack: 700,
    release: 3500,
    focus: 85,
    width: 70,
  });
const voice = (name: string, ...effects: Effect[]): Voice => ({
  name,
  effects,
});
const selections = (names: [string, string, string, string]) =>
  names.map((name, i) => ({
    name,
    mix: [i === 0 ? 1 : 0, i === 1 || i === 3 ? 1 : 0, i === 2 ? 1 : 0],
    level: i === 3 ? 1.12 : 1,
  }));

/** Original recipes contain settings and roles, never third-party model payloads.
 * @see docs/factory-collection.md */
export const factoryRecipes: FactoryRecipe[] = [
  {
    id: 'C01',
    name: 'Clear Current',
    description:
      'Inspired by articulate studio cleans. A shared clean NAM voice with compression, gentle width and an intentional lead lift.',
    categories: ['Clean', 'Pop', 'Country'],
    before: [nam('clean')],
    voices: [
      voice('Dry'),
      voice('Soft compression', compressor()),
      voice('Wide', chorus()),
    ],
    after: [room()],
    scenes: selections(['Dry', 'Soft compression', 'Wide', 'Lead']).map(
      (scene, index) => ({
        ...scene,
        level: index === 1 ? 2 : index === 3 ? 2.24 : 1,
      }),
    ),
  },
  {
    id: 'C02',
    name: 'Velvet Room',
    description:
      'Inspired by intimate jazz and neo-soul chord sounds. Warm top end, gentle movement and a small shared room.',
    categories: ['Jazz', 'Neo-soul', 'Clean'],
    before: [
      nam('clean'),
      fx('Invada Low Pass Filter (stereo)', { freq: 6200 }),
    ],
    voices: [
      voice('Intimate'),
      voice('Open', chorus()),
      voice('Motion', fx('GxTremolo', { depth: 0.25, freq: 2.4, dry_wet: 60 })),
    ],
    after: [room()],
    scenes: selections(['Intimate', 'Open', 'Gentle motion', 'Solo']).map(
      (scene, index) => ({ ...scene, level: index === 2 ? 1.55 : scene.level }),
    ),
  },
  {
    id: 'C03',
    name: 'Pocket Wire',
    description:
      'Inspired by percussive funk and disco rhythm. Play short muted strokes; the envelope responds to your picking level.',
    categories: ['Funk', 'Disco', 'Pop'],
    before: [nam('clean')],
    voices: [
      voice('Tight', compressor()),
      voice('Envelope', fx('GxAutoWah')),
      voice('Phaser', fx('GxPhaser', { dry_wet: 35, speed: 0.7 })),
    ],
    after: [room()],
    scenes: selections(['Tight', 'Envelope', 'Phaser', 'Accent']),
  },
  {
    id: 'R01',
    name: 'Copper Edge',
    description:
      'Inspired by roots and blues touch response. Drives feed one shared crunch NAM voice; echo history remains downstream.',
    categories: ['Blues', 'Roots', 'Indie'],
    before: [],
    voices: [
      voice('Touch'),
      voice('Push', drive()),
      voice('Grain', fx('GxRat')),
    ],
    after: [nam('crunch'), echo(0.12), room()],
    scenes: selections(['Touch', 'Push', 'Grain', 'Lead']),
  },
  {
    id: 'R04',
    name: 'Offbeat',
    description:
      'Inspired by clean offbeat chops and dub echoes. Scene sends leave the old repeats ringing; feedback is deliberately restrained.',
    categories: ['Reggae', 'Ska', 'Dub'],
    before: [nam('clean')],
    voices: [
      voice('Chop'),
      voice('Echo', echo(1)),
      voice('Space', hall(0, 3.5)),
    ],
    after: [],
    scenes: [
      { name: 'Dry chop', mix: [0.8, 0, 0] },
      { name: 'Short echo', mix: [0.8, 0.16, 0] },
      { name: 'Dub', mix: [0.8, 0.3, 0.08] },
      { name: 'Space', mix: [0.8, 0.12, 0.25] },
    ],
  },
  {
    id: 'K01',
    name: 'Open Circuit',
    description:
      'Inspired by open classic-rock crunch. Three drive colours feed the same NAM chain and shared room.',
    categories: ['Classic rock', 'Garage', 'Power pop'],
    before: [],
    voices: [
      voice('Edge'),
      voice('Rhythm', drive()),
      voice('Grain', fx('GxRat')),
    ],
    after: [nam('crunch'), room()],
    scenes: selections(['Edge', 'Rhythm', 'Grain', 'Lead']),
  },
  {
    id: 'H01',
    name: 'Iron Pulse',
    description:
      'Inspired by articulate modern-metal rhythm. Tightening happens before the shared high-gain NAM voice; use its lead scene for a small level lift.',
    categories: ['Modern metal', 'Progressive metal'],
    before: [],
    voices: [
      voice('Rhythm'),
      voice(
        'Tight',
        fx('Invada High Pass Filter (stereo)', { freq: 90 }),
        drive(),
      ),
      voice('Attack', fx('Invada High Pass Filter (stereo)', { freq: 130 })),
    ],
    after: [nam('heavy'), echo(0.09)],
    scenes: selections(['Rhythm', 'Tight', 'Attack', 'Lead']),
  },
  {
    id: 'B02',
    name: 'Split Rail',
    description:
      'Inspired by split-band bass production: compressed lows under an independently driven upper voice. Check the crossover with your bass in mono.',
    categories: ['Bass', 'Rock', 'Metal'],
    before: [],
    voices: [
      voice(
        'Foundation',
        fx('Invada Low Pass Filter (stereo)', { freq: 180 }),
        compressor(),
      ),
      voice(
        'Grit',
        fx('Invada High Pass Filter (stereo)', { freq: 180 }),
        nam('bass'),
      ),
      voice(
        'Fuzz',
        fx('Invada High Pass Filter (stereo)', { freq: 220 }),
        fx('GxBigMuffPi'),
      ),
    ],
    after: [],
    scenes: [
      { name: 'Foundation', mix: [0.8, 0.22, 0] },
      { name: 'Edge', mix: [0.8, 0.35, 0] },
      { name: 'Grind', mix: [0.8, 0.5, 0] },
      { name: 'Fuzz', mix: [0.8, 0.2, 0.2] },
    ],
  },
  {
    id: 'A01',
    name: 'Afterlight',
    description:
      'Inspired by post-rock and ambient clean textures. Effect-only: clear dry attack, a rhythmic echo send and a persistent long hall.',
    categories: ['Ambient', 'Post-rock', 'Worship'],
    before: [compressor()],
    voices: [
      voice('Near'),
      voice('Echo', echo(1)),
      voice('Bloom', hall(0, 5.5)),
    ],
    after: [],
    scenes: [
      { name: 'Near', mix: [0.85, 0.05, 0.08] },
      { name: 'Echo', mix: [0.85, 0.25, 0.12] },
      { name: 'Bloom', mix: [0.85, 0.1, 0.45] },
      { name: 'Wide', mix: [0.75, 0.3, 0.55] },
    ],
  },
  {
    id: 'A04',
    name: 'Slow Weather',
    description:
      'Inspired by an accompaniment you can play over. Open the Hold block and turn Hold on while a chord rings, then off to release. Scenes mix that captured layer; they do not capture automatically.',
    categories: ['Ambient', 'Hold', 'Soundtrack'],
    before: [],
    voices: [
      voice('Live'),
      voice(
        'Held layer',
        fx('Oxidal Hold (Stereo)', {
          dry: 0,
          level: -6,
          attack: 600,
          release: 3000,
          focus: 85,
          width: 70,
        }),
        chorus(),
      ),
    ],
    after: [hall(100, 4)],
    scenes: [
      { name: 'Live', mix: [0.8, 0] },
      { name: 'Companion', mix: [0.8, 0.45] },
      { name: 'Wide', mix: [0.8, 0.8] },
      { name: 'Held foreground', mix: [0.4, 1] },
    ],
  },
  {
    id: 'S01',
    name: 'Reed Circuit',
    description:
      'Inspired by monophonic electronic lead instruments. Play one clean note at a time; Tracker does not track chords. The dry blend preserves some pick articulation.',
    categories: ['Guitar synth', 'Electronic', 'Fusion'],
    before: [],
    voices: [
      voice('Dry'),
      voice('Reed', fx('MDA Tracker', { mix: 1, glide: 0.85 })),
      voice(
        'Filter',
        fx('MDA Tracker', { mix: 1, glide: 0.92 }),
        fx('MDA RezFilter', {
          freq: 0.65,
          res: 0.4,
          lfo_vcf: 0.5,
          env_vcf: 0.5,
          output: 0.6,
        }),
      ),
    ],
    after: [echo(0.15), room()],
    scenes: [
      { name: 'Rounded', mix: [0.2, 0.65, 0] },
      { name: 'Articulate', mix: [0.45, 0.5, 0] },
      { name: 'Filtered', mix: [0.3, 0, 0.65] },
      { name: 'Lead', mix: [0.2, 0.65, 0], level: 1.12 },
    ],
  },
  {
    id: 'X03',
    name: 'Two Horizons',
    description:
      'Inspired by complementary studio amp blends. Two NAM voices share one wet chain. This blends audio, not model weights; check phase and mono compatibility with your chosen captures.',
    categories: ['Experimental', 'Alternative rock', 'Dual amp'],
    before: [],
    voices: [voice('Clear', nam('clean')), voice('Edge', nam('crunch'))],
    after: [echo(0.12), hall(100, 1.8)],
    scenes: [
      { name: 'Clear', mix: [0.8, 0] },
      { name: 'Edge', mix: [0, 0.8], level: 1.65 },
      { name: 'Blend', mix: [0.45, 0.45] },
      { name: 'Lead', mix: [0.3, 0.65] },
    ],
  },
  {
    id: 'C04',
    name: 'Interlace',
    description:
      'Inspired by bright interlocking guitar lines in highlife, soukous and Latin pop. A clean voice feeds separate short and offset echoes; leave space between phrases.',
    categories: ['Clean', 'Highlife', 'Latin pop'],
    before: [nam('clean')],
    voices: [
      voice('Dry'),
      voice('Short', echoAt(0.12)),
      voice('Offset', echoAt(0.23), chorus()),
    ],
    after: [room()],
    scenes: [
      { name: 'Dry', mix: [0.8, 0, 0] },
      { name: 'Interlock', mix: [0.8, 0.2, 0] },
      { name: 'Width', mix: [0.75, 0.1, 0.2] },
      { name: 'Lead', mix: [0.8, 0.15, 0.2], level: 1.12 },
    ],
  },
  {
    id: 'R02',
    name: 'Dust Road',
    description:
      'Inspired by repeating desert-blues lines and raw roots guitar. Filtered grit precedes one crunch voice, with a dark echo for sustained phrases.',
    categories: ['Roots', 'Desert blues', 'Blues'],
    before: [],
    voices: [
      voice('Touch'),
      voice(
        'Grit',
        drive(),
        fx('Invada Low Pass Filter (stereo)', { freq: 4200 }),
      ),
      voice('Sustain', fx('GxBigMuffPi')),
    ],
    after: [nam('crunch'), echo(0.18)],
    scenes: selections(['Touch', 'Grit', 'Sustain', 'Forward']),
  },
  {
    id: 'R03',
    name: 'Coastline',
    description:
      'Inspired by rockabilly slap and country tremolo. The splash uses a short room, not a spring-reverb emulation; choose a bright clean capture.',
    categories: ['Country', 'Rockabilly', 'Surf'],
    before: [nam('clean')],
    voices: [
      voice('Twang'),
      voice('Slap', echoAt(0.1)),
      voice(
        'Tremolo',
        fx('GxTremolo', { depth: 0.55, freq: 4.2, dry_wet: 60 }),
      ),
    ],
    after: [fx('GxReverb-Stereo', { dry_wet: 20, roomsize: 0.3, damp: 0.3 })],
    scenes: [
      { name: 'Twang', mix: [0.8, 0, 0] },
      { name: 'Slap', mix: [0.8, 0.18, 0] },
      { name: 'Tremolo', mix: [0.15, 0.1, 0.8] },
      { name: 'Splash', mix: [0.6, 0.3, 0.35] },
    ],
  },
  {
    id: 'K02',
    name: 'Hot Wire',
    description:
      'Inspired by tight punk and hard-rock rhythm. Filter and drive colours feed a shared crunch capture; the dry scene has no artificial echo.',
    categories: ['Hard rock', 'Punk', 'Alternative rock'],
    before: [],
    voices: [
      voice('Crunch'),
      voice('Drive', drive()),
      voice(
        'Attack',
        fx('Invada High Pass Filter (stereo)', { freq: 110 }),
        fx('GxRat'),
      ),
    ],
    after: [nam('crunch')],
    scenes: selections(['Crunch', 'Drive', 'Attack', 'Lead']),
  },
  {
    id: 'K03',
    name: 'Chrome Night',
    description:
      'Inspired by wide eighties clean and lead contrasts. Clean chorus and a driven NAM voice share an echo; check the chosen captures together in mono.',
    categories: ['Pop', 'Fusion', 'Progressive rock'],
    before: [],
    voices: [
      voice('Clean', nam('clean')),
      voice('Chorus', nam('clean'), chorus()),
      voice('Rhythm', drive(), nam('crunch')),
    ],
    after: [echo(0.2), room()],
    scenes: [
      { name: 'Clean', mix: [0.8, 0, 0] },
      { name: 'Chorus', mix: [0, 0.8, 0] },
      { name: 'Rhythm', mix: [0, 0, 0.8] },
      { name: 'Wide lead', mix: [0, 0.2, 0.7], level: 1.12 },
    ],
  },
  {
    id: 'K04',
    name: 'Long Arc',
    description:
      'Inspired by psychedelic sustained leads. Fuzz feeds a shared crunch voice; a separate rotary-coloured branch offers movement without changing the echo history.',
    categories: ['Psychedelic rock', 'Blues rock', 'Fusion'],
    before: [],
    voices: [
      voice('Edge'),
      voice('Fuzz', fx('GxBigMuffPi')),
      voice('Rotary', drive(), rotary(0.18)),
    ],
    after: [nam('crunch'), echo(0.25), room()],
    scenes: selections(['Edge', 'Fuzz', 'Rotary', 'Echo lead']),
  },
  {
    id: 'H02',
    name: 'Low Gravity',
    description:
      'Inspired by low-tuned modern heavy rhythm. Downshift is minus two semitones before a shared high-gain voice; it adds processing delay and does not physically retune the strings.',
    categories: ['Detuned', 'Djent', 'Modern metal'],
    before: [],
    voices: [
      voice('Native tuning'),
      voice(
        'Downshift',
        pitch(-2),
        fx('Invada High Pass Filter (stereo)', { freq: 75 }),
        drive(),
      ),
      voice('Atmosphere', pitch(-2), hall(100, 4)),
    ],
    after: [nam('heavy')],
    scenes: selections(['Native tuning', 'Downshift', 'Atmosphere', 'Lead']),
  },
  {
    id: 'H03',
    name: 'Ash Field',
    description:
      'Inspired by doom and stoner-rock fuzz. A sub-octave branch and a restrained long space sit around one heavy capture; watch low-frequency headroom.',
    categories: ['Doom', 'Stoner', 'Sludge'],
    before: [],
    voices: [
      voice('Grit', drive()),
      voice('Fuzz', fx('GxBigMuffPi')),
      voice(
        'Low texture',
        pitch(-12),
        fx('GxBigMuffPi'),
        fx('Invada High Pass Filter (stereo)', { freq: 45 }),
      ),
    ],
    after: [nam('heavy'), hall(100, 3)],
    scenes: [
      { name: 'Grit', mix: [0.8, 0, 0] },
      { name: 'Fuzz', mix: [0, 0.7, 0] },
      { name: 'Low texture', mix: [0, 0.55, 0.15] },
      { name: 'Drone', mix: [0, 0.4, 0.3] },
    ],
  },
  {
    id: 'H04',
    name: 'Glass and Teeth',
    description:
      'Inspired by post-hardcore clean-to-heavy contrasts. Three independently prepared NAM voices feed a common room. This is a demanding preset: match the selected captures before playing.',
    categories: ['Post-hardcore', 'Progressive metal', 'Alternative rock'],
    before: [],
    voices: [
      voice('Glass', nam('clean'), chorus()),
      voice('Crunch', nam('crunch')),
      voice('Teeth', nam('heavy')),
    ],
    after: [room()],
    scenes: [
      { name: 'Glass', mix: [0.8, 0, 0] },
      { name: 'Crunch', mix: [0, 0.8, 0] },
      { name: 'Teeth', mix: [0, 0, 0.8] },
      { name: 'Lead', mix: [0.12, 0, 0.8], level: 1.12 },
    ],
  },
  {
    id: 'B01',
    name: 'Foundation',
    description:
      'Inspired by supportive soul, jazz and pop bass. One bass NAM voice feeds rounded, clear and compressed branches. Set levels with an actual bass before relying on the pick scene.',
    categories: ['Bass', 'Soul', 'Jazz'],
    before: [nam('bass')],
    voices: [
      voice('Round', fx('Invada Low Pass Filter (stereo)', { freq: 1800 })),
      voice('Finger'),
      voice(
        'Pick',
        compressor(),
        fx('Invada Low Pass Filter (stereo)', { freq: 4200 }),
      ),
    ],
    after: [fx('Invada High Pass Filter (stereo)', { freq: 30 })],
    scenes: selections(['Round', 'Finger', 'Pick', 'Forward']),
  },
  {
    id: 'B03',
    name: 'Elastic',
    description:
      'Inspired by percussive funk and disco bass. Envelope and octave voices respond to single-note playing; preserve a clean foundation when adding the octave.',
    categories: ['Bass', 'Funk', 'Disco'],
    before: [nam('bass')],
    voices: [
      voice('Punch'),
      voice('Envelope', fx('GxAutoWah')),
      voice('Octave', sub(0.45)),
    ],
    after: [],
    scenes: [
      { name: 'Punch', mix: [0.8, 0, 0] },
      { name: 'Envelope', mix: [0.25, 0.6, 0] },
      { name: 'Octave', mix: [0.65, 0, 0.25] },
      { name: 'Lead', mix: [0.2, 0.6, 0.15], level: 1.12 },
    ],
  },
  {
    id: 'B04',
    name: 'Substation',
    description:
      'Inspired by dub and electronic bass production. Clean lows, a generated sub and filtered grit share a protective high-pass. Sub tracking needs clear single notes.',
    categories: ['Bass', 'Dub', 'Electronic'],
    before: [nam('bass')],
    voices: [
      voice(
        'Deep clean',
        fx('Invada Low Pass Filter (stereo)', { freq: 1400 }),
      ),
      voice('Sub', sub(0.5)),
      voice(
        'Grit',
        fx('GxRat'),
        fx('Invada Low Pass Filter (stereo)', { freq: 900 }),
      ),
    ],
    after: [fx('Invada High Pass Filter (stereo)', { freq: 30 })],
    scenes: [
      { name: 'Deep clean', mix: [0.8, 0, 0] },
      { name: 'Sub', mix: [0.7, 0.2, 0] },
      { name: 'Filtered', mix: [0.5, 0, 0.25] },
      { name: 'Grit', mix: [0.5, 0.1, 0.3] },
    ],
  },
  {
    id: 'A02',
    name: 'Soft Ruin',
    description:
      'Inspired by shoegaze reverb-before-drive textures. The reverse branch and a long hall feed fuzz independently; their returns keep ringing when a scene send closes.',
    categories: ['Shoegaze', 'Noise rock', 'Ambient'],
    before: [],
    voices: [
      voice('Dry edge', drive()),
      voice('Haze', hall(0, 4), fx('GxBigMuffPi')),
      voice('Reverse', reverse(0.75), fx('GxRat')),
    ],
    after: [fx('Invada Low Pass Filter (stereo)', { freq: 5200 })],
    scenes: [
      { name: 'Dry edge', mix: [0.7, 0, 0] },
      { name: 'Haze', mix: [0.5, 0.2, 0] },
      { name: 'Reverse', mix: [0.45, 0, 0.25] },
      { name: 'Wall', mix: [0.4, 0.18, 0.2] },
    ],
  },
  {
    id: 'A03',
    name: 'Orbit',
    description:
      'Inspired by interlocking art-rock and ambient echoes. Two distinct echo times create a pattern; times are fixed, not host-tempo synchronized.',
    categories: ['Art rock', 'Math rock', 'Ambient'],
    before: [],
    voices: [
      voice('Direct'),
      voice('Tap A', echoAt(0.28)),
      voice('Tap B', echoAt(0.42), chorus()),
    ],
    after: [hall(100, 2.5)],
    scenes: [
      { name: 'Single tap', mix: [0.8, 0.22, 0] },
      { name: 'Interlock', mix: [0.8, 0.2, 0.18] },
      { name: 'Wide', mix: [0.65, 0.12, 0.35] },
      { name: 'Wash', mix: [0.35, 0.3, 0.35] },
    ],
  },
  {
    id: 'S02',
    name: 'Rotor Choir',
    description:
      'Inspired by organ-like octave and rotary textures. Octave voices remain separate from your dry attack. Pitch processing adds delay; this does not generate a tracked polyphonic synthesizer.',
    categories: ['Guitar synth', 'Psychedelic', 'Gospel'],
    before: [],
    voices: [
      voice('Dry'),
      voice('Slow rotor', pitch(12), rotary(0.15)),
      voice('Fast rotor', pitch(12), rotary(0.85)),
    ],
    after: [room()],
    scenes: [
      { name: 'Dry blend', mix: [0.8, 0.1, 0] },
      { name: 'Octave', mix: [0.45, 0.4, 0] },
      { name: 'Slow rotor', mix: [0.25, 0.65, 0] },
      { name: 'Fast rotor', mix: [0.25, 0, 0.65] },
    ],
  },
  {
    id: 'S03',
    name: 'Glass Steps',
    description:
      'Inspired by percussive electronic sound design. An octave-up reverse branch and a metallic ring branch contrast with the clear attack; let the reverse buffer fill before judging its onset.',
    categories: ['Electronic', 'Experimental', 'Guitar synth'],
    before: [],
    voices: [
      voice('Dry'),
      voice('Reverse octave', pitch(12), reverse(0.4)),
      voice('Ring', fx('MDA RingMod', { freq: 0.04, feedback: 0.1 })),
    ],
    after: [room()],
    scenes: [
      { name: 'Dry', mix: [0.8, 0, 0] },
      { name: 'Octave wash', mix: [0.6, 0.25, 0] },
      { name: 'Reverse', mix: [0.2, 0.6, 0] },
      { name: 'Metal', mix: [0.4, 0.15, 0.3] },
    ],
  },
  {
    id: 'S04',
    name: 'Low Lantern',
    description:
      'Inspired by guitar-to-bass and electronic low voices. Play clear single notes for the sub generator. Dry attack, filtered sub and dirty sub can be mixed independently.',
    categories: ['Guitar synth', 'Electronic', 'Bass'],
    before: [],
    voices: [
      voice('Dry'),
      voice(
        'Sub',
        sub(0.6),
        fx('Invada Low Pass Filter (stereo)', { freq: 650 }),
      ),
      voice(
        'Dirty',
        sub(0.5),
        drive(),
        fx('Invada Low Pass Filter (stereo)', { freq: 1800 }),
      ),
    ],
    after: [fx('Invada High Pass Filter (stereo)', { freq: 35 })],
    scenes: [
      { name: 'Dry mix', mix: [0.7, 0.15, 0] },
      { name: 'Sub', mix: [0.25, 0.6, 0] },
      { name: 'Filtered', mix: [0.1, 0.75, 0] },
      { name: 'Dirty', mix: [0.2, 0.3, 0.3] },
    ],
  },
  {
    id: 'X01',
    name: 'Small Hours',
    description:
      'Inspired by worn tape and bedroom-pop guitar. Tape movement and bandwidth change the texture without adding deliberate hiss. One clean NAM voice remains shared.',
    categories: ['Lo-fi', 'Bedroom pop', 'Alternative'],
    before: [nam('clean')],
    voices: [
      voice('Clear'),
      voice('Worn', tape()),
      voice(
        'Narrow',
        tape(),
        fx('Invada High Pass Filter (stereo)', { freq: 350 }),
        fx('Invada Low Pass Filter (stereo)', { freq: 2400 }),
      ),
    ],
    after: [echo(0.12)],
    scenes: selections(['Clear', 'Worn', 'Narrow', 'Forward']),
  },
  {
    id: 'X02',
    name: 'Broken Radio',
    description:
      'Inspired by band-limited industrial textures. Degradation and ring modulation sit beside a narrow dry voice. The Clear scene stops new effect sends while existing returns drain.',
    categories: ['Industrial', 'Experimental', 'Lo-fi'],
    before: [
      fx('Invada High Pass Filter (stereo)', { freq: 300 }),
      fx('Invada Low Pass Filter (stereo)', { freq: 3200 }),
    ],
    voices: [
      voice('Narrow'),
      voice(
        'Crush',
        fx('MDA Degrade', {
          quant: 0.35,
          rate: 0.4,
          headroom: 0.85,
          output: 0.4,
        }),
      ),
      voice('Ring', fx('MDA RingMod', { freq: 0.11, feedback: 0.15 })),
    ],
    after: [],
    scenes: [
      { name: 'Narrow', mix: [0.8, 0, 0] },
      { name: 'Crush', mix: [0.3, 0.5, 0] },
      { name: 'Ring', mix: [0.3, 0, 0.45] },
      { name: 'Clear', mix: [0.8, 0, 0] },
    ],
  },
  {
    id: 'X04',
    name: 'Held Light',
    description:
      'Inspired by a held cinematic harmony above clear live notes. Capture and release explicitly in the Hold blocks: scenes only mix their sends. Two independent held voices rise an octave or stay dark.',
    categories: ['Hold', 'Ambient', 'Cinematic'],
    before: [],
    voices: [
      voice('Live'),
      voice('Rise', held(), pitch(12), hall(0, 5)),
      voice(
        'Dark',
        held(),
        fx('Invada Low Pass Filter (stereo)', { freq: 1800 }),
        hall(0, 5),
      ),
    ],
    after: [],
    scenes: [
      { name: 'Live', mix: [0.8, 0, 0] },
      { name: 'Rise', mix: [0.8, 0.45, 0] },
      { name: 'Dark', mix: [0.8, 0, 0.45] },
      { name: 'Both', mix: [0.6, 0.3, 0.3] },
    ],
  },
];

export function factoryRoles(recipe: FactoryRecipe): FactoryRole[] {
  return [
    ...new Set(
      [
        ...recipe.before,
        ...recipe.voices.flatMap((v) => v.effects),
        ...recipe.after,
      ].flatMap((e) => ('native' in e ? [e.native] : [])),
    ),
  ];
}

/** Missing dependencies are reported before publication. */
export function factoryMissingPlugins(
  recipe: FactoryRecipe,
  plugins: Lv2Plugin[],
) {
  return [
    ...new Set(
      [
        ...recipe.before,
        ...recipe.voices.flatMap((v) => v.effects),
        ...recipe.after,
      ]
        .filter((e): e is Extract<Effect, { plugin: string }> => 'plugin' in e)
        .filter(
          (e) =>
            !plugins.some(
              (p) =>
                p.uri === pluginUris[e.plugin] &&
                !p.unsupported &&
                !p.ports.some((port) => port.atom),
            ),
        )
        .map((e) => e.plugin),
    ),
  ];
}

/** Build from explicit local bindings; never match captures by a guessed name.
 * Input gates retain branch histories; shared NAM and wet blocks are instantiated once.
 * @see docs/factory-collection.md */
export function buildFactoryRecipe(
  recipe: FactoryRecipe,
  plugins: Lv2Plugin[],
  bindings: Partial<Record<FactoryRole, RigNativeSource>>,
  profile: string,
  id = crypto.randomUUID(),
) {
  const rig = rigBuilder(id, `Oxidal · ${recipe.name}`, profile, false);
  let sequence = 0;
  const effect = (e: Effect): DraftEffect => {
    const id = `fx-${++sequence}`;
    if ('native' in e) {
      const source = bindings[e.native];
      if (!source)
        throw new Error(`Choose a ${e.native} NAM preset for ${recipe.name}.`);
      return {
        id,
        kind: 'native',
        name: `${e.native} · ${source.preset.name}`,
        ...source,
      };
    }
    const plugin = plugins.find((p) => p.uri === pluginUris[e.plugin]);
    if (!plugin || plugin.unsupported || plugin.ports.some((p) => p.atom))
      throw new Error(`Install ${e.plugin} before building ${recipe.name}.`);
    const controls = Object.fromEntries(
      plugin.ports
        .filter((p) => p.control && p.input)
        .map((p) => [p.symbol, p.default]),
    );
    for (const [key, value] of Object.entries(e.controls ?? {})) {
      const port = plugin.ports.find(
        (p) => p.symbol === key && p.control && p.input,
      );
      if (
        !port ||
        !Number.isFinite(value) ||
        (port.minimum != null && value < port.minimum) ||
        (port.maximum != null && value > port.maximum)
      )
        throw new Error(`${plugin.name}: incompatible control ${key}.`);
      controls[key] = value;
    }
    if (Object.values(controls).some((v) => v == null || !Number.isFinite(v)))
      throw new Error(`${plugin.name}: missing control defaults.`);
    return {
      id,
      kind: 'lv2',
      name: plugin.name,
      plugin,
      mono: 'sum',
      controls: controls as Record<string, number>,
    };
  };
  const common = rig.chain(recipe.before.map(effect), rig.input);
  const split = common.map((from, side) => {
    const id = `scene-input-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'split',
      audioInputs: 1,
      audioOutputs: recipe.voices.length,
    });
    rig.host.graph.edges.push({ from, to: { node: id, port: 0 } });
    return id;
  });
  const ends = recipe.voices.map((v, index) => {
    const feed = split.map((node, side) => {
      const id = `scene-feed-${index}-${side}`;
      rig.host.graph.nodes.push({
        id,
        kind: 'gain',
        audioInputs: 1,
        audioOutputs: 1,
        inputGains: [recipe.scenes[0]!.mix[index]!],
      });
      rig.host.graph.edges.push({
        from: { node, port: index },
        to: { node: id, port: 0 },
      });
      rig.labels[id] = `${v.name} send`;
      return { node: id, port: 0 };
    });
    return rig.chain(v.effects.map(effect), [feed[0]!, feed[1]!]);
  });
  const sum = [0, 1].map((side) => {
    const id = `scene-return-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'merge',
      audioInputs: ends.length,
      audioOutputs: 1,
      inputGains: ends.map(() => 1),
    });
    ends.forEach((ports, index) =>
      rig.host.graph.edges.push({
        from: ports[side]!,
        to: { node: id, port: index },
      }),
    );
    return { node: id, port: 0 };
  });
  const wet = rig.chain(recipe.after.map(effect), [sum[0]!, sum[1]!]);
  const output = wet.map((from, side) => {
    const id = `scene-level-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'gain',
      audioInputs: 1,
      audioOutputs: 1,
      inputGains: [recipe.scenes[0]!.level ?? 1],
    });
    rig.host.graph.edges.push({ from, to: { node: id, port: 0 } });
    return { node: id, port: 0 };
  });
  const result = rig.finish([output[0]!, output[1]!]);
  const manifest: RigDocument['manifest'] = JSON.parse(result.manifest_json);
  manifest.oxidal!.recall.tails = 'preserve';
  manifest.requiredExtensions.push('urn:oxidal:gain:1', 'urn:oxidal:scenes:1');
  manifest.extensions['urn:oxidal:gain:1'] = {};
  manifest.extensions['urn:oxidal:scenes:1'] = {
    fade_ms: 15,
    scenes: recipe.scenes.map((scene, index) => ({
      id: `scene-${index + 1}`,
      name: scene.name,
      gains: [
        ...scene.mix.flatMap((value, voice) =>
          [0, 1].map((side) => ({
            node: `scene-feed-${voice}-${side}`,
            port: 0,
            value,
          })),
        ),
        ...[0, 1].map((side) => ({
          node: `scene-level-${side}`,
          port: 0,
          value: scene.level ?? 1,
        })),
      ],
    })),
  };
  Object.assign(manifest.extensions['urn:oxidal:authoring']!, {
    origin: 'oxidal_example',
    scene_tails: 'preserve',
    factory_recipe: recipe.id,
    factory_version: 1,
    internal_nodes: rig.host.graph.nodes
      .filter((n) => n.id.startsWith('scene-'))
      .map((n) => n.id),
  });
  return { ...result, manifest_json: JSON.stringify(manifest) };
}
