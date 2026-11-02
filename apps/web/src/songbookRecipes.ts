import {
  chorus,
  compressor,
  drive,
  echo,
  echoAt,
  flyHall,
  flyRoom,
  fx,
  hall,
  nam,
  orbit,
  pitch,
  room,
  selections,
  silk,
  voice,
  type FactoryRecipe,
} from './factoryRecipes.ts';

/**
 * Original, era- and genre-tagged presets, each built on its own amp voice from
 * `factoryVoices.ts`. Names, descriptions and tags describe the sound only: no
 * artist, song or trademark appears here. Scenes are always Rhythm, Lead, Intro
 * and Boost so the pads stay in the same place on every preset.
 * @see docs/factory-collection.md
 */
const tight = (freq: number) =>
  fx('Invada High Pass Filter (stereo)', { freq });
const names = ['Rhythm', 'Lead', 'Intro', 'Boost'] as const;
const scenes = () => selections([...names]);
const fuzz = () => fx('GxBigMuffPi');
const rat = () => fx('GxRat');
const tremolo = () => fx('GxTremolo', { depth: 0.35, freq: 4.5, dry_wet: 70 });

export const songbookRecipes: FactoryRecipe[] = [
  // 80s
  {
    id: 'E80-01',
    name: 'Brown Crunch',
    era: '80s',
    description:
      'Plexi-style crunch with a swirling phaser and a soft modulated intro, in the spirit of early-eighties hard rock. Echo is fixed, not tempo-synced.',
    categories: ['80s', 'Hard rock', 'Classic rock'],
    before: [nam('plexi-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', orbit(0.4, 4)),
      voice('Intro', silk()),
    ],
    after: [echo(0.08), room()],
    scenes: scenes(),
  },
  {
    id: 'E80-02',
    name: 'Arena Chorus',
    era: '80s',
    description:
      'Open 800-style crunch with a wide chorus intro and an echoing lead, aimed at big eighties pop-rock choruses.',
    categories: ['80s', 'Hard rock', 'Pop rock'],
    before: [nam('jcm-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', echo(0.2)),
      voice('Intro', chorus()),
    ],
    after: [room()],
    scenes: scenes(),
  },
  {
    id: 'E80-03',
    name: 'Power Stack',
    era: '80s',
    description:
      'Saturated 800-style stack for heavy metal rhythm and lead. Tightening comes before the amp; use the Boost scene for a small lift.',
    categories: ['80s', 'Heavy metal', 'Metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(90)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(130)),
    ],
    after: [nam('jcm-lead'), echo(0.08)],
    scenes: scenes(),
  },
  {
    id: 'E80-04',
    name: 'Cold Steel',
    era: '80s',
    description:
      'Fast, tight, thick lead voice for thrash rhythm; palm-muted riffs stay clear because the low end is pulled back before the amp.',
    categories: ['80s', 'Thrash', 'Metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(110), drive()),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(150)),
    ],
    after: [nam('mark-lead'), room()],
    scenes: scenes(),
  },
  {
    id: 'E80-05',
    name: 'Neon Clean',
    era: '80s',
    description:
      'Bright, tight clean with a lush chorus, a slow phase sweep and a roomy hall, for new-wave and synth-pop guitar parts.',
    categories: ['80s', 'New wave', 'Pop'],
    before: [nam('studio-clean')],
    voices: [
      voice('Rhythm', chorus()),
      voice('Lead', echo(0.22), chorus()),
      voice('Intro', orbit(0.25, 4)),
    ],
    after: [hall(100, 2.2)],
    scenes: scenes(),
  },
  {
    id: 'E80-06',
    name: 'Glass Pop',
    era: '80s',
    description:
      'Open blackface-style clean through gentle compression, with a shimmering chorus and a short room for polished pop rhythm and arpeggios.',
    categories: ['80s', 'Pop', 'Synth-pop'],
    before: [nam('blackface-clean'), compressor()],
    voices: [
      voice('Rhythm'),
      voice('Lead', silk()),
      voice('Intro', echoAt(0.375)),
    ],
    after: [flyRoom()],
    scenes: scenes(),
  },
  // 90s
  {
    id: 'E90-01',
    name: 'Grunge Wall',
    era: '90s',
    description:
      'Thick boutique crunch pushed by a fuzz, a gritty distortion or a clean-ish drive, for loud-quiet-loud grunge dynamics.',
    categories: ['90s', 'Grunge', 'Alt rock'],
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', rat()),
      voice('Intro', drive()),
    ],
    after: [nam('mark-crunch'), room()],
    scenes: scenes(),
  },
  {
    id: 'E90-02',
    name: 'Groove Hammer',
    era: '90s',
    description:
      'Aggressive high-gain stack for groove and down-tuned metal. Low end is controlled before the amp; try drop tunings and keep the gain moderate.',
    categories: ['90s', 'Groove metal', 'Metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(110)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(150)),
    ],
    after: [nam('hotrod-high'), echo(0.06)],
    scenes: scenes(),
  },
  {
    id: 'E90-03',
    name: 'Pocket Chime',
    era: '90s',
    description:
      'Open blackface-style clean with squeezy compression, an envelope filter and a light chorus, for funk-rock rhythm.',
    categories: ['90s', 'Funk rock', 'Alt rock'],
    before: [nam('blackface-clean')],
    voices: [
      voice('Rhythm', compressor()),
      voice('Lead', fx('GxAutoWah')),
      voice('Intro', chorus()),
    ],
    after: [room()],
    scenes: scenes(),
  },
  {
    id: 'E90-04',
    name: 'Britpop Shimmer',
    era: '90s',
    description:
      'Glassy clean with a firm low end, a short echo and a shimmering chorus for jangly indie and britpop parts.',
    categories: ['90s', 'Britpop', 'Indie'],
    before: [nam('chime-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', echoAt(0.25)),
      voice('Intro', silk()),
    ],
    after: [flyRoom()],
    scenes: scenes(),
  },
  // 2000s
  {
    id: 'E00-01',
    name: 'Low Orbit',
    era: '2000s',
    description:
      'Scooped, heavy, wide high-gain rhythm for nu-metal and alternative metal. Keep the tuning low and the guitar profile gate set.',
    categories: ['2000s', 'Nu metal', 'Alt metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(100)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(140)),
    ],
    after: [nam('rectifier-high'), echo(0.07)],
    scenes: scenes(),
  },
  {
    id: 'E00-02',
    name: 'Stadium Alt',
    era: '2000s',
    description:
      'Edge-of-breakup 800-style crunch with a drive for choruses and an echoing lead into a large hall, for alternative rock.',
    categories: ['2000s', 'Alt rock', 'Rock'],
    before: [nam('jcm-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', drive()),
      voice('Intro', echo(0.2)),
    ],
    after: [flyHall(2.5, 16)],
    scenes: scenes(),
  },
  {
    id: 'E00-03',
    name: 'Fuzz Hook',
    era: '2000s',
    description:
      'Raw plexi-style crunch behind a fuzz, a gritty distortion or a light drive, for riff-driven alternative and garage rock.',
    categories: ['2000s', 'Alt rock', 'Garage'],
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', rat()),
      voice('Intro', drive()),
    ],
    after: [nam('plexi-crunch'), room()],
    scenes: scenes(),
  },
  // Modern
  {
    id: 'EMD-01',
    name: 'Tight Eight',
    era: 'Modern',
    description:
      'Scooped modern high gain for low-tuned rhythm; drop, seven- or eight-string tunings. A tightening filter and a boost sit before the amp. Pair with your measured guitar gate.',
    categories: ['Modern', 'Djent', 'Metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(100), drive()),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(140)),
    ],
    after: [nam('modern-scooped'), echo(0.05)],
    scenes: scenes(),
  },
  {
    id: 'EMD-02',
    name: 'Black Gate',
    era: 'Modern',
    description:
      'Dark, dense high gain with a tightly cut low end for brutal and extreme metal. Assumes low tuning and a strong gate; use the lead scene for solos only.',
    categories: ['Modern', 'Brutal', 'Death metal'],
    before: [],
    voices: [
      voice('Rhythm', tight(120), compressor()),
      voice('Lead', tight(120), drive()),
      voice('Intro', tight(180)),
    ],
    after: [nam('modern-dark'), room()],
    scenes: scenes(),
  },
  {
    id: 'EMD-03',
    name: 'Cold Cathedral',
    era: 'Modern',
    description:
      'Glassy clean with a slow phase sweep, a very long hall and a cold early-reflection room for gothic and dark atmospheric guitar. Echo and reverb are not tempo-synced.',
    categories: ['Modern', 'Goth', 'Dark'],
    before: [nam('chime-clean')],
    voices: [
      voice('Rhythm', orbit(0.15, 6)),
      voice('Lead', flyHall(8, 40)),
      voice('Intro', silk()),
    ],
    after: [hall(100, 4)],
    scenes: scenes(),
  },
  {
    id: 'EMD-04',
    name: 'Ambient Bloom',
    era: 'Modern',
    description:
      'Bright clean with a pitched-up shimmer and a large hall for worship swells and cinematic beds. Pitch voices add some delay.',
    categories: ['Modern', 'Worship', 'Ambient'],
    before: [nam('studio-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', pitch(12), flyHall(7, 36)),
      voice('Intro', hall(100, 3)),
    ],
    after: [],
    scenes: scenes(),
  },
  {
    id: 'EMD-05',
    name: 'Doom Smoke',
    era: 'Modern',
    description:
      'Slow, heavy rectifier-style rhythm behind a fuzz and a long hall, for doom and stoner riffs. Keep the volume up and the notes long.',
    categories: ['Modern', 'Doom', 'Metal'],
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', tight(60), drive()),
      voice('Intro', drive()),
    ],
    after: [nam('rectifier-high'), hall(100, 2.5)],
    scenes: scenes(),
  },
  {
    id: 'EMD-06',
    name: 'Surf Spring',
    era: 'Modern',
    description:
      'Open blackface-style clean with a throbbing tremolo, a slap echo and a bright hall, for surf, rockabilly and twangy roots parts.',
    categories: ['Modern', 'Surf', 'Roots'],
    before: [nam('blackface-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', tremolo()),
      voice('Intro', echo(0.2)),
    ],
    after: [flyHall(2.5, 18)],
    scenes: scenes(),
  },
];
