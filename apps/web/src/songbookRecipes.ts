import {
  chorus,
  compressor,
  coreScenes,
  drive,
  echo,
  echoAt,
  type FactoryRecipe,
  flyHall,
  flyRoom,
  fx,
  hall,
  keyed,
  leadLift,
  nam,
  orbit,
  pitch,
  type RecipeScene,
  room,
  type SceneSettings,
  silk,
  voice,
} from './factoryRecipes.ts';

/**
 * Original, era- and genre-tagged presets, each built on its own amp voice from
 * `factoryVoices.ts`. Names, descriptions and tags describe the sound only: no
 * artist, song or trademark appears here. Scenes follow the collection's core
 * order, so the pads stay in the same place on every preset: Intro (the softer
 * base), Rhythm, Lead (the one level lift), then a fourth scene of its own,
 * an ambient or special sound the preset's effects can make.
 * @see docs/factory-collection.md
 */
const tight = (freq: number) =>
  fx('Invada High Pass Filter (stereo)', { freq });
/** The voices are Rhythm, Lead and Intro, in that order. */
const scenes = (
  special: [
    name: string,
    mix: number[],
    level?: number,
    controls?: SceneSettings,
  ],
): RecipeScene[] =>
  coreScenes(
    ['Intro', [0, 0, 1]],
    ['Rhythm', [1, 0, 0]],
    ['Lead', [0, 1, 0], leadLift],
    special,
  );
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
      'Raw fifty-watt stack crunch with a swirling phaser and a soft modulated intro, in the spirit of early-eighties hard rock. Echo is fixed, not tempo-synced.',
    categories: ['80s', 'Hard rock', 'Classic rock'],
    genres: ['Hard rock', 'Classic rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Early-1980s hard rock: a raw, cranked stack with a slow phaser and a short echo.',
    performance:
      'Intro is a soft chorused version for arpeggios. Rhythm is the dry crunch. Lead adds the phaser swirl with the level lift for riffs and solos, and Wash sends the chorused voice into long repeats and a bigger room for a break.',
    before: [nam('plexi-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', orbit(0.4, 4)),
      voice('Intro', silk()),
    ],
    after: [keyed('echo', echo(0.08)), keyed('room', room())],
    scenes: scenes([
      'Wash',
      [0, 0, 1],
      1,
      { echo: { fx_mix: 0.3, feedback: 0.55 }, room: { dry_wet: 28 } },
    ]),
  },
  {
    id: 'E80-02',
    name: 'Arena Chorus',
    era: '80s',
    description:
      'Open master-volume stack crunch with a wide chorus intro and an echoing lead, aimed at big eighties pop-rock choruses.',
    categories: ['80s', 'Hard rock', 'Pop rock'],
    genres: ['Hard rock', 'Pop'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Big 1980s pop-rock choruses: an open master-volume stack with a wide chorus and an echoing lead.',
    performance:
      'Intro is the wide chorus for picked chords. Rhythm is the open crunch. Lead adds a single echo with the level lift for melodies, and Big room puts the chorus in a large room for the last chorus.',
    before: [nam('jcm-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', echo(0.2)),
      voice('Intro', chorus()),
    ],
    after: [keyed('room', room())],
    scenes: scenes([
      'Big room',
      [0, 0, 1],
      1,
      { room: { dry_wet: 30, roomsize: 0.7 } },
    ]),
  },
  {
    id: 'E80-03',
    name: 'Power Stack',
    era: '80s',
    description:
      'Saturated master-volume stack for heavy metal rhythm and lead. Tightening comes before the amp; the Lead scene adds a small lift.',
    categories: ['80s', 'Heavy metal', 'Metal'],
    genres: ['Hard rock', 'Modern metal'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '1980s heavy metal: a saturated master-volume stack, tightened before the amp and boosted for solos.',
    performance:
      'Intro cuts more low end for a thinner picked part. Rhythm is the tightened stack. Lead adds an overdrive in front with the level lift for sustain, and Echo break sends the thin voice into long repeats for a quiet bridge.',
    before: [],
    voices: [
      voice('Rhythm', tight(90)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(130)),
    ],
    after: [nam('jcm-lead'), keyed('echo', echo(0.08))],
    scenes: scenes([
      'Echo break',
      [0, 0, 1],
      1,
      { echo: { fx_mix: 0.3, feedback: 0.55 } },
    ]),
  },
  {
    id: 'E80-04',
    name: 'Cold Steel',
    era: '80s',
    description:
      'Fast, tight, thick lead voice for thrash rhythm; palm-muted riffs stay clear because the low end is pulled back before the amp.',
    categories: ['80s', 'Thrash', 'Metal'],
    genres: ['Modern metal', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '1980s thrash: a fast, thick, compressed lead amp with the low end pulled back so palm mutes stay clear.',
    performance:
      'Intro is the amp without the boost. Rhythm is the tightest boosted voice for fast riffs. Lead lets more low end through with the level lift for a fuller solo tone, and Break puts the unboosted voice in a large, dark room for a slow section.',
    before: [],
    voices: [
      voice('Rhythm', tight(110), drive()),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(150)),
    ],
    after: [nam('mark-lead'), keyed('room', room())],
    scenes: scenes([
      'Break',
      [0, 0, 1],
      1,
      { room: { dry_wet: 30, roomsize: 0.75 } },
    ]),
  },
  {
    id: 'E80-05',
    name: 'Neon Clean',
    era: '80s',
    description:
      'Bright, tight clean with a lush chorus, a slow phase sweep and a roomy hall, for new-wave and synth-pop guitar parts.',
    categories: ['80s', 'New wave', 'Pop'],
    genres: ['Clean', 'Pop'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '1980s new wave and synth-pop: a bright, tight clean with a lush chorus, a slow phase sweep and a roomy hall.',
    performance:
      'Intro is the slow phaser. Rhythm is the chorused clean. Lead adds an echo with the level lift for single-note hooks, and Wash opens the hall wide and long under the phaser for an ambient break.',
    before: [nam('studio-clean')],
    voices: [
      voice('Rhythm', chorus()),
      voice('Lead', echo(0.22), chorus()),
      voice('Intro', orbit(0.25, 4)),
    ],
    after: [keyed('hall', hall(100, 2.2))],
    scenes: scenes([
      'Wash',
      [0, 0, 1],
      1,
      { hall: { DRY_WET_MIX: -0.2, MID_RT60: 4.5 } },
    ]),
  },
  {
    id: 'E80-06',
    name: 'Glass Pop',
    era: '80s',
    description:
      'Open, bell-like combo clean through gentle compression, with a shimmering chorus and a short room for polished pop rhythm and arpeggios.',
    categories: ['80s', 'Pop', 'Synth-pop'],
    genres: ['Pop', 'Clean'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Polished 1980s pop: an open, bell-like clean combo with gentle compression, a shimmering chorus and a short room.',
    performance:
      'Intro adds a dotted echo for picked openings. Rhythm is the compressed clean. Lead adds the shimmering chorus with the level lift, and Space puts the chorus in larger reflections for a sparse bridge.',
    before: [nam('blackface-clean'), compressor()],
    voices: [
      voice('Rhythm'),
      voice('Lead', silk()),
      voice('Intro', echoAt(0.375)),
    ],
    after: [keyed('room', flyRoom())],
    scenes: scenes([
      'Space',
      [0, 1, 0],
      1,
      { room: { early_level: 45, size: 30 } },
    ]),
  },
  // 90s
  {
    id: 'E90-01',
    name: 'Grunge Wall',
    era: '90s',
    description:
      'Thick boutique crunch pushed by a fuzz, a gritty distortion or a clean-ish drive, for loud-quiet-loud grunge dynamics.',
    categories: ['90s', 'Grunge', 'Alt rock'],
    genres: ['Hard rock', 'Edge of breakup'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Early-1990s grunge: a thick crunch amp pushed by a fuzz for the loud parts and a light drive for the quiet ones.',
    performance:
      'Intro is the light drive for quiet verses. Rhythm is the fuzz wall for choruses. Lead swaps the fuzz for a gritty distortion that cuts, with the level lift, and Double runs the fuzz and the distortion together for the loudest chorus.',
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', rat()),
      voice('Intro', drive()),
    ],
    after: [nam('mark-crunch'), room()],
    scenes: scenes(['Double', [0.6, 0.6, 0]]),
  },
  {
    id: 'E90-02',
    name: 'Groove Hammer',
    era: '90s',
    description:
      'Aggressive high-gain stack for groove and down-tuned metal. Low end is controlled before the amp; try drop tunings and keep the gain moderate.',
    categories: ['90s', 'Groove metal', 'Metal'],
    genres: ['Modern metal', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '1990s groove metal: an aggressive high-gain stack with a controlled low end, made for down-tuned riffs.',
    performance:
      'Intro cuts more low end for a thinner single-note part. Rhythm is the tightened stack. Lead adds a boost in front with the level lift for sustain, and Echo break sends the thin voice into long repeats for a breakdown.',
    before: [],
    voices: [
      voice('Rhythm', tight(110)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(150)),
    ],
    after: [nam('hotrod-high'), keyed('echo', echo(0.06))],
    scenes: scenes([
      'Echo break',
      [0, 0, 1],
      1,
      { echo: { fx_mix: 0.3, feedback: 0.55 } },
    ]),
  },
  {
    id: 'E90-03',
    name: 'Pocket Chime',
    era: '90s',
    description:
      'Open, bell-like combo clean with squeezy compression, an envelope filter and a light chorus, for funk-rock rhythm.',
    categories: ['90s', 'Funk rock', 'Alt rock'],
    genres: ['Funk', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '1990s funk-rock: an open, bell-like clean combo with squeezy compression, an envelope filter and a light chorus.',
    performance:
      'Intro is the chorus voice for clean chords. Rhythm is the compressed chop. Lead adds the envelope filter with the level lift for solos and fills, and Wide pocket layers the chop and the chorus in a slightly larger room for a chorus section.',
    before: [nam('blackface-clean')],
    voices: [
      voice('Rhythm', compressor()),
      voice('Lead', fx('GxAutoWah')),
      voice('Intro', chorus()),
    ],
    after: [keyed('room', room())],
    scenes: scenes([
      'Wide pocket',
      [0.55, 0, 0.55],
      1,
      { room: { dry_wet: 20 } },
    ]),
  },
  {
    id: 'E90-04',
    name: 'Britpop Shimmer',
    era: '90s',
    description:
      'Glassy clean with a firm low end, a short echo and a shimmering chorus for jangly indie and britpop parts.',
    categories: ['90s', 'Britpop', 'Indie'],
    genres: ['Pop', 'Clean'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      '1990s indie and jangle pop: a glassy clean with a short echo and a shimmering chorus.',
    performance:
      'Intro is the chorus voice for strummed openings. Rhythm is the dry clean. Lead adds the echo with the level lift for melodies, and Wash puts the chorus in larger reflections for a ringing outro.',
    before: [nam('chime-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', echoAt(0.25)),
      voice('Intro', silk()),
    ],
    after: [keyed('room', flyRoom())],
    scenes: scenes([
      'Wash',
      [0, 0, 1],
      1,
      { room: { early_level: 45, size: 30 } },
    ]),
  },
  // 2000s
  {
    id: 'E00-01',
    name: 'Low Orbit',
    era: '2000s',
    description:
      'Scooped, heavy, wide high-gain rhythm for nu-metal and alternative metal. Keep the tuning low and the guitar profile gate set.',
    categories: ['2000s', 'Nu metal', 'Alt metal'],
    genres: ['Modern metal', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Early-2000s alternative metal: a scooped, heavy, wide high-gain rhythm played in low tunings.',
    performance:
      'Intro cuts more low end for a thin, tense part. Rhythm is the tightened amp. Lead adds a boost in front with the level lift for single-note lines, and Thick runs the plain and boosted voices together for the heaviest chorus.',
    before: [],
    voices: [
      voice('Rhythm', tight(100)),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(140)),
    ],
    after: [nam('rectifier-high'), echo(0.07)],
    scenes: scenes(['Thick', [0.6, 0.6, 0]]),
  },
  {
    id: 'E00-02',
    name: 'Stadium Alt',
    era: '2000s',
    description:
      'Edge-of-breakup master-volume stack crunch with a drive for choruses and an echoing lead into a large hall, for alternative rock.',
    categories: ['2000s', 'Alt rock', 'Rock'],
    genres: ['Hard rock', 'Edge of breakup'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      '2000s alternative rock: a master-volume stack at the edge of breakup, a drive for choruses and an echoing lead in a large hall.',
    performance:
      'Intro is the echo voice for picked figures. Rhythm is the edge-of-breakup amp. Lead adds the drive with the level lift for choruses and solos, and Ambient opens a long hall behind the echo voice for a spacious bridge.',
    before: [nam('jcm-crunch')],
    voices: [
      voice('Rhythm'),
      voice('Lead', drive()),
      voice('Intro', echo(0.2)),
    ],
    after: [keyed('hall', flyHall(2.5, 16))],
    scenes: scenes([
      'Ambient',
      [0, 0, 1],
      1,
      { hall: { late_level: 40, decay: 5 } },
    ]),
  },
  {
    id: 'E00-03',
    name: 'Fuzz Hook',
    era: '2000s',
    description:
      'Raw fifty-watt stack crunch behind a fuzz, a gritty distortion or a light drive, for riff-driven alternative and garage rock.',
    categories: ['2000s', 'Alt rock', 'Garage'],
    genres: ['Hard rock', 'Classic rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      '2000s garage rock: a raw, cranked stack behind a fuzz, a gritty distortion or a light drive.',
    performance:
      'Intro is the light drive for quieter parts. Rhythm is the fuzz riff sound. Lead swaps in the gritty distortion with the level lift, and Cave puts the fuzz in a big room for a slow, heavy outro.',
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', rat()),
      voice('Intro', drive()),
    ],
    after: [nam('plexi-crunch'), keyed('room', room())],
    scenes: scenes([
      'Cave',
      [1, 0, 0],
      1,
      { room: { dry_wet: 32, roomsize: 0.8 } },
    ]),
  },
  // Modern
  {
    id: 'EMD-01',
    name: 'Tight Eight',
    era: 'Modern',
    description:
      'Scooped modern high gain for low-tuned rhythm; drop, seven- or eight-string tunings. A tightening filter and a boost sit before the amp. Pair with your measured guitar gate.',
    categories: ['Modern', 'Djent', 'Metal'],
    genres: ['Modern metal', 'Progressive'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Low-tuned modern metal of the 2010s: scooped high gain with a tightening filter and a boost in front, for seven- and eight-string riffs.',
    performance:
      'Intro drops the boost and cuts more low end for a thinner part. Rhythm is the tightened, boosted amp. Lead lets a little more low end through with the level lift for sustain, and Ambient break sends the thin voice into long repeats between heavy sections.',
    before: [],
    voices: [
      voice('Rhythm', tight(100), drive()),
      voice('Lead', tight(90), drive()),
      voice('Intro', tight(140)),
    ],
    after: [nam('modern-scooped'), keyed('echo', echo(0.05))],
    scenes: scenes([
      'Ambient break',
      [0, 0, 1],
      1,
      { echo: { fx_mix: 0.32, feedback: 0.6 } },
    ]),
  },
  {
    id: 'EMD-02',
    name: 'Black Gate',
    era: 'Modern',
    description:
      'Dark, dense high gain with a tightly cut low end for brutal and extreme metal. Assumes low tuning and a strong gate; use the lead scene for solos only.',
    categories: ['Modern', 'Brutal', 'Death metal'],
    genres: ['Modern metal'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Extreme metal of the 2000s and 2010s: dark, dense high gain with the low end cut hard before the amp.',
    performance:
      'Intro cuts more low end for tremolo-picked lines. Rhythm is the tight, dark wall with compression. Lead swaps the compressor for a boost with the level lift, for solos only, and Void puts the tremolo-picked voice in a huge dark room.',
    before: [],
    voices: [
      voice('Rhythm', tight(120), compressor()),
      voice('Lead', tight(120), drive()),
      voice('Intro', tight(180)),
    ],
    after: [nam('modern-dark'), keyed('room', room())],
    scenes: scenes([
      'Void',
      [0, 0, 1],
      1,
      { room: { dry_wet: 32, roomsize: 0.85 } },
    ]),
  },
  {
    id: 'EMD-03',
    name: 'Cold Cathedral',
    era: 'Modern',
    description:
      'Glassy clean with a slow phase sweep, a very long hall and a cold early-reflection room for gothic and dark atmospheric guitar. Echo and reverb are not tempo-synced.',
    categories: ['Modern', 'Goth', 'Dark'],
    genres: ['Clean', 'Ambient'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Gothic and dark atmospheric guitar from the 1980s onward: a glassy clean with a slow phase sweep in a very long, cold hall.',
    performance:
      'Intro is the chorus voice for arpeggios. Rhythm is the slowly phased clean. Lead moves to the long hall voice with the level lift for melodies, and Vault opens the shared hall to its longest for the phased chords.',
    before: [nam('chime-clean')],
    voices: [
      voice('Rhythm', orbit(0.15, 6)),
      voice('Lead', flyHall(8, 40)),
      voice('Intro', silk()),
    ],
    after: [keyed('hall', hall(100, 4))],
    scenes: scenes([
      'Vault',
      [1, 0, 0],
      1,
      { hall: { DRY_WET_MIX: -0.1, MID_RT60: 7 } },
    ]),
  },
  {
    id: 'EMD-04',
    name: 'Ambient Bloom',
    era: 'Modern',
    description:
      'Bright clean with a pitched-up shimmer and a large hall for worship swells and cinematic beds. Pitch voices add some delay.',
    categories: ['Modern', 'Worship', 'Ambient'],
    genres: ['Ambient', 'Clean'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Modern cinematic and worship beds: a bright clean with a pitched-up shimmer and a large hall.',
    performance:
      'Intro is a plain hall voice for swelled chords. Rhythm is the bare clean amp. Lead adds the octave shimmer in a long hall with the level lift, and Halo keeps the bare amp up front with the octave shimmer underneath.',
    before: [nam('studio-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', pitch(12), flyHall(7, 36)),
      voice('Intro', hall(100, 3)),
    ],
    after: [],
    scenes: scenes(['Halo', [0.8, 0.5, 0]]),
  },
  {
    id: 'EMD-05',
    name: 'Doom Smoke',
    era: 'Modern',
    description:
      'Slow, heavy, scooped high-gain rhythm behind a fuzz and a long hall, for doom and stoner riffs. Keep the volume up and the notes long.',
    categories: ['Modern', 'Doom', 'Metal'],
    genres: ['Modern metal', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Doom and stoner riffs from the 1990s onward: slow, scooped high-gain rhythm behind a fuzz and a long hall.',
    performance:
      'Intro is a light drive for open, ringing chords. Rhythm is the fuzz into the amp. Lead tightens the low end and adds a boost with the level lift, and Smoke drowns the fuzz in a long hall for the slowest riffs.',
    before: [],
    voices: [
      voice('Rhythm', fuzz()),
      voice('Lead', tight(60), drive()),
      voice('Intro', drive()),
    ],
    after: [nam('rectifier-high'), keyed('hall', hall(100, 2.5))],
    scenes: scenes([
      'Smoke',
      [1, 0, 0],
      1,
      { hall: { DRY_WET_MIX: -0.2, MID_RT60: 5 } },
    ]),
  },
  {
    id: 'EMD-06',
    name: 'Surf Spring',
    era: 'Modern',
    description:
      'Open, bell-like combo clean with a throbbing tremolo, a slap echo and a bright hall, for surf, rockabilly and twangy roots parts.',
    categories: ['Modern', 'Surf', 'Roots'],
    genres: ['Clean', 'Edge of breakup'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Surf and rockabilly of the early 1960s: an open, bell-like clean combo with a throbbing tremolo, a slap echo and a bright hall.',
    performance:
      'Intro is the slap echo voice for picked melodies. Rhythm is the dry clean in the hall. Lead adds the throbbing tremolo with the level lift, and Drench soaks the dry clean in a deeper hall for a reverb-drenched solo break.',
    before: [nam('blackface-clean')],
    voices: [
      voice('Rhythm'),
      voice('Lead', tremolo()),
      voice('Intro', echo(0.2)),
    ],
    after: [keyed('hall', flyHall(2.5, 18))],
    scenes: scenes([
      'Drench',
      [1, 0, 0],
      1,
      { hall: { late_level: 36, decay: 3.5 } },
    ]),
  },
];
