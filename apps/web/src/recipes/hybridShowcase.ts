import {
  echoAt,
  flyHall,
  flyRoom,
  fx,
  nam,
  orbit,
  pitch,
  silk,
  sub,
  voice,
  type Effect,
  type FactoryRecipe,
} from '../factoryRecipes.ts';

/**
 * Hybrid showcase presets: reference-unit style rigs that keep the familiar
 * compressor, drive capture, amp capture, cabinet, modulation, delay, reverb
 * shape. Captures are named voices the player downloads from their own
 * TONE3000 account; nothing third-party ships with Oxidal. Each preset keeps
 * to three distinct captures (cabinet impulses do not count), the provisional
 * hybrid budget until the Pi measurement sets it.
 *
 * @see docs/factory-collection.md
 */

/** Scene weights are relative; every non-lead scene is normalised to the same
 * power and the third scene (the lead) sits about 2 dB above it, so scenes are
 * level-matched by construction. Mixes never exceed 1. */
const BASE_POWER = 0.64;
const LEAD_POWER = 1;
const scenes = (rows: [name: string, weights: number[]][]) =>
  rows.map(([name, weights], index) => {
    const power = index === 2 ? LEAD_POWER : BASE_POWER;
    const scale = Math.sqrt(power / weights.reduce((s, w) => s + w * w, 0));
    return {
      name,
      mix: weights.map((w) => Math.round(w * scale * 1000) / 1000),
    };
  });

const comp = (threshold = -24) =>
  fx('x42 Compressor Stereo', {
    threshold,
    Ratio: 0.5,
    attack: 0.015,
    release: 0.25,
  });
const swell = (time = 900) =>
  fx('Oxidal Swell (Stereo)', {
    threshold: -45,
    sensitivity: 60,
    time,
    release: 400,
    curve: 50,
    mix: 100,
  });
const hold = () =>
  fx('Oxidal Hold (Stereo)', {
    dry: 0,
    level: -9,
    attack: 700,
    release: 3500,
    focus: 85,
    width: 70,
  });
const shimmer = () =>
  fx('GxShimmizita', {
    DRYWET: 1,
    PSDRYWET: 0.7,
    SHIFT: 4,
    T60M: 3.5,
    T60DS: 5,
    DEPTH: 0.2,
  });
const duck = (time = 420) =>
  fx('GxDuckDelay-Stereo', {
    TIME: time,
    FEEDBACK: 0.35,
    AMOUNT: 24,
    EFFECT: -6,
    ATTACK: 0.1,
    RELEASE: 0.4,
    PINGPONG: 0.3,
  });
const reverse = (seconds: number) =>
  fx('Reverse Delay (5s max)', {
    delay_time: seconds,
    dry_level: -70,
    wet_level: -6,
    feedback: 0.2,
    xfade_samp: 1250,
  });
const tape = (wow = 0.006) =>
  fx('GxTape', { drive: 0.25, hiss: 0, wowdepth: wow, flutdepth: 0.004 });
const tapeEcho = () =>
  fx('MDA DubDelay', {
    delay: 0.28,
    feedback: 0.35,
    fx_mix: 1,
    lfo_depth: 0.05,
  });
const wah = () =>
  fx('FOMP Auto-wah', {
    drive: 3,
    decay: 0.22,
    range: 0.65,
    freq: 0.35,
    mix: 0.6,
  });
const trem = () => fx('GxTremolo', { depth: 0.5, freq: 4.5, dry_wet: 100 });
const grit = () => fx('Calf Saturator', { drive: 4, mix: 0.6 });
const crush = () =>
  fx('MDA Degrade', { quant: 0.35, rate: 0.4, headroom: 0.85, output: 0.4 });
const lowPass = (freq: number) =>
  fx('Invada Low Pass Filter (stereo)', { freq });
const highPass = (freq: number) =>
  fx('Invada High Pass Filter (stereo)', { freq });
const octaveDown = () =>
  fx('Oxidal Pitch (Stereo)', { semitones: -12, window: 2, input_mode: 0 });
const path = (name: string, steps: Effect[] = [], pan?: number) => ({
  name,
  steps,
  ...(pan === undefined ? {} : { pan }),
});

export const hybridShowcaseRecipes: FactoryRecipe[] = [
  {
    id: 'HY01',
    name: 'Studio Clean',
    description:
      'A glassy clean with compression, a chorus, an echo and a swell pad on a plate-style hall.',
    categories: ['Clean', 'Pop'],
    genres: ['Clean', 'Pop'],
    techniques: ['Serial chain', 'Parallel routing', 'Swell'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Polished studio cleans from the late 1970s to the 1990s: compressed, wide and tidy under a vocal.',
    performance:
      'Clean is the bed. Chorus thickens chords, Lead lifts a single-note line with a little echo, Ambient opens the hall. Swell turns each note into a pad.',
    before: [comp(), nam('blackface-clean')],
    voices: [
      voice('Dry'),
      voice('Chorus', silk()),
      voice('Echo', echoAt(0.3)),
      voice('Swell', swell(1200)),
    ],
    after: [flyHall(2.2, 14)],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0]],
      ['Chorus', [0.8, 0.7, 0, 0]],
      ['Lead', [1, 0, 0.35, 0]],
      ['Ambient', [0.6, 0.3, 0.35, 0.6]],
      ['Swell', [0.5, 0, 0, 1]],
    ]),
  },
  {
    id: 'HY02',
    name: 'Arena Chime',
    description:
      'A jangling edge-of-breakup amp with four parallel paths: dotted echo, shimmer, swell and a frozen tail.',
    categories: ['Edge of breakup', 'Pop', 'Parallel routing'],
    genres: ['Edge of breakup', 'Pop'],
    techniques: ['Parallel routing', 'Swell', 'Hold', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Big-room pop and rock guitar of the 1980s: chiming rhythm parts under dotted echoes and a wide hall.',
    performance:
      'Chime is the open rhythm. Dotted adds the rhythmic echo, Lead pushes one path forward, Shimmer lifts an octave into the hall. Swell and Freeze are for the bridge and the outro.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [flyHall(3, 20)],
    route: [
      comp(),
      nam('ac30-chime'),
      {
        paths: [
          path('Dry'),
          path('Dotted', [echoAt(0.3)]),
          path('Shimmer', [shimmer()], 0.3),
          path('Swell', [swell(1500)]),
          path('Freeze', [hold()]),
        ],
      },
    ],
    scenes: scenes([
      ['Chime', [1, 0, 0, 0, 0]],
      ['Dotted', [0.8, 0.6, 0, 0, 0]],
      ['Lead', [1, 0.4, 0, 0, 0]],
      ['Shimmer', [0.7, 0, 0.8, 0, 0]],
      ['Swell', [0.3, 0, 0, 1, 0]],
      ['Freeze', [0.3, 0, 0, 0, 1]],
    ]),
  },
  {
    id: 'HY03',
    name: 'Blues Club',
    description:
      'A pedal-pushed combo clean with slapback, a tape echo and a touch of added grit.',
    categories: ['Blues', 'Edge of breakup'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Serial chain', 'Parallel routing'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Small-club electric blues of the 1960s and 1970s: a pushed combo, a short room and a dash of tape echo.',
    performance:
      'Clean keeps the pedal as a gentle push. Edge blends in extra grit for chords, Lead leans on the grit and a tape echo for a solo, Slapback is the short rockabilly-style repeat.',
    before: [comp(-26), nam('drive-ts9'), nam('super-reverb-77')],
    voices: [
      voice('Dry'),
      voice('Grit', grit()),
      voice('Tape', tapeEcho()),
      voice('Slap', echoAt(0.08)),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0]],
      ['Edge', [0.9, 0.5, 0, 0]],
      ['Lead', [0.8, 0.7, 0.35, 0]],
      ['Slapback', [1, 0, 0, 0.4]],
    ]),
  },
  {
    id: 'HY04',
    name: 'Stadium',
    description:
      'Raw, dynamic crunch with a phaser, a long echo and a plate-style hall.',
    categories: ['Classic rock', 'Hard rock'],
    genres: ['Classic rock', 'Hard rock'],
    techniques: ['Serial chain', 'Parallel routing'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Arena rock of the 1970s: an amp pushed hard, a swirling phaser on the verse and an echoing solo.',
    performance:
      'Rhythm is the plain crunch. Phase adds the swirl for the verse, Lead lifts the level for a solo, Echo lead adds long repeats for the last chorus.',
    before: [comp(-22), nam('plexi-crunch')],
    voices: [
      voice('Dry'),
      voice('Phase', orbit(0.4, 4)),
      voice('Echo', echoAt(0.34)),
    ],
    after: [flyHall(2.6, 16)],
    scenes: scenes([
      ['Rhythm', [1, 0, 0]],
      ['Phase', [0.8, 0.8, 0]],
      ['Lead', [1, 0, 0.15]],
      ['Echo lead', [1, 0, 0.5]],
    ]),
  },
  {
    id: 'HY05',
    name: 'Eighties Lead',
    description:
      'A hard-rock rhythm amp and a boosted lead amp, widened with chorus, a stereo delay and a plate-style hall.',
    categories: ['Hard rock', 'Classic rock'],
    genres: ['Hard rock', 'Classic rock'],
    techniques: ['Parallel routing', 'Serial chain'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Late-1980s studio hard rock: a tight rhythm stack, a boosted singing lead and a lot of chorus and delay.',
    performance:
      'Rhythm is tight and dry. Wide doubles it with the lead amp, Lead switches to the boosted amp, Big lead stacks both for the final chorus.',
    before: [comp(-24)],
    voices: [
      voice('Rhythm', nam('jcm800-v30')),
      voice('Lead', nam('drive-sd1'), nam('jcm-lead')),
    ],
    after: [silk(), echoAt(0.22), flyHall(2.4, 16)],
    scenes: scenes([
      ['Rhythm', [1, 0]],
      ['Wide', [0.8, 0.4]],
      ['Lead', [0, 1]],
      ['Big lead', [0.6, 0.8]],
    ]),
  },
  {
    id: 'HY06',
    name: 'Modern Metal',
    description:
      'Two modern high-gain amps panned left and right, a clean amp, a tracked sub and an octave below.',
    categories: ['Modern metal', 'Parallel routing'],
    genres: ['Modern metal'],
    techniques: ['Parallel routing', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Tight 2000s and 2010s metal rhythm: double-tracked width, a low end held in check and a clean amp for the break.',
    performance:
      'Rhythm is the wide double. Tight narrows to one side for palm mutes, Lead leans on one amp. Ambient clean is the break. Octave and Chug add weight under the riff.',
    topology: 'routed',
    before: [highPass(85)],
    voices: [],
    after: [flyRoom()],
    route: [
      {
        paths: [
          path('Left amp', [nam('modern-tight')], -0.8),
          path('Right amp', [nam('modern-dark')], 0.8),
          path('Clean', [nam('two-rock-clean')]),
          path('Sub', [sub(0.3)]),
          path('Octave', [octaveDown()]),
        ],
      },
    ],
    scenes: scenes([
      ['Rhythm', [1, 1, 0, 0, 0]],
      ['Tight', [1, 0.4, 0, 0, 0]],
      ['Lead', [0.7, 1, 0, 0, 0]],
      ['Ambient clean', [0, 0, 1, 0, 0]],
      ['Octave', [0.8, 0.8, 0, 0, 0.5]],
      ['Chug', [1, 1, 0, 0.6, 0]],
    ]),
  },
  {
    id: 'HY07',
    name: 'Prog Suite',
    description:
      'A boosted low-tuned rhythm amp and a clean amp, with a ducking delay, an octave and a swell on parallel paths.',
    categories: ['Progressive', 'Modern metal', 'Parallel routing'],
    genres: ['Progressive', 'Modern metal'],
    techniques: ['Parallel routing', 'Swell', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Progressive metal of the 2010s: tight low-tuned riffs, clean passages and long, ducked repeats.',
    performance:
      'Clean opens the piece. Rhythm is the riff amp, Lead adds ducked echo and an octave above, Ambient is clean with long repeats. Octave lead and Swell are for the middle section.',
    topology: 'routed',
    before: [highPass(70)],
    voices: [],
    after: [flyHall(3.5, 16)],
    route: [
      {
        paths: [
          path('Rhythm', [
            nam('drive-fortin'),
            nam('badlander-head'),
            nam('ir-mesa-os'),
          ]),
          path('Clean', [nam('two-rock-clean')]),
          path('Octave', [pitch(12)]),
          path('Ducked echo', [duck()]),
          path('Swell', [swell(1400)]),
        ],
      },
    ],
    scenes: scenes([
      ['Clean', [0, 1, 0, 0, 0]],
      ['Rhythm', [1, 0, 0, 0, 0]],
      ['Lead', [1, 0, 0.3, 0.35, 0]],
      ['Ambient', [0, 0.6, 0, 0.8, 0.5]],
      ['Octave lead', [0.8, 0, 0.6, 0, 0]],
      ['Swell', [0, 0.3, 0, 0, 1]],
    ]),
  },
  {
    id: 'HY08',
    name: 'Post-rock',
    description:
      'A shimmering clean amp with swell, reverse and frozen paths for long builds.',
    categories: ['Post-rock', 'Ambient', 'Parallel routing'],
    genres: ['Post-rock', 'Ambient'],
    techniques: ['Parallel routing', 'Swell', 'Hold'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Instrumental post-rock of the late 1990s and 2000s: volume swells, reversed notes and slow builds to a big hall.',
    performance:
      'Clean is the opening figure. Swell fades each note in, Crescendo layers swell and reverse for the peak, Wash is the aftermath. Freeze holds a chord; Reverse plays notes backwards.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [flyHall(5, 24)],
    route: [
      comp(-26),
      nam('match-brave'),
      {
        paths: [
          path('Dry'),
          path('Swell', [swell(1800)]),
          path('Reverse', [reverse(1.2)]),
          path('Freeze', [hold()]),
        ],
      },
    ],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0]],
      ['Swell', [0.5, 0.8, 0, 0]],
      ['Crescendo', [0.4, 1, 0.3, 0]],
      ['Wash', [0.3, 0.5, 0.5, 0]],
      ['Freeze', [0.2, 0, 0, 1]],
      ['Reverse', [0.5, 0, 1, 0]],
    ]),
  },
  {
    id: 'HY09',
    name: 'Bass Suite',
    description:
      'A round bass amp with a driven bass path, an octave below, an envelope filter and a chorus.',
    categories: ['Bass', 'Funk', 'Parallel routing'],
    genres: ['Bass', 'Funk'],
    techniques: ['Parallel routing', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Studio bass of the 1970s to the 2000s: a round fundamental, a driven path for rock and a few classic bass effects on separate paths.',
    performance:
      'Clean is the round low end. Grit blends in the driven path, Solo lifts a chorused line over the top, Sub adds an octave below. Filter and Chorus are for fills and choruses.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [],
    route: [
      comp(-22),
      {
        paths: [
          path('Clean', [nam('svt-head'), nam('ir-ampeg-810')]),
          path('Grit', [nam('drive-sansamp'), nam('darkglass-rig')]),
          path('Octave', [octaveDown()]),
          path('Filter', [wah()]),
          path('Chorus', [silk()]),
        ],
      },
    ],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0, 0]],
      ['Grit', [0.5, 0.8, 0, 0, 0]],
      ['Solo', [0.7, 0.4, 0, 0, 0.7]],
      ['Sub', [0.7, 0, 0.8, 0, 0]],
      ['Filter', [0.5, 0, 0, 0.9, 0]],
      ['Chorus', [0.8, 0, 0, 0, 0.6]],
    ]),
  },
  {
    id: 'HY10',
    name: 'Jazz Parlour',
    description:
      'A warm, rounded jazz combo with a soft top end, a chorus, a rotary-style swirl and a small room.',
    categories: ['Jazz', 'Clean'],
    genres: ['Jazz', 'Clean'],
    techniques: ['Serial chain', 'Parallel routing'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Hollow-body jazz chord playing of the 1950s to the 1970s: a warm, dark tone with the top end rolled off.',
    performance:
      'Clean is for chords and comping. Warm adds a gentle chorus, Solo lifts the level for a single-note melody, Rotary slows a swirl for a ballad.',
    before: [lowPass(5200), comp(-26), nam('polytone-jazz')],
    voices: [
      voice('Dry'),
      voice('Chorus', silk()),
      voice('Rotary', fx('MDA Leslie', { speed: 0.3, mode: 0.2 })),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Clean', [1, 0, 0]],
      ['Warm', [0.8, 0.6, 0]],
      ['Solo', [1, 0, 0]],
      ['Rotary', [0.5, 0, 0.9]],
    ]),
  },
  {
    id: 'HY11',
    name: 'Twang Station',
    description:
      'A snappy, compressed country clean with slapback and a swell for steel-style lines.',
    categories: ['Country', 'Clean'],
    genres: ['Country', 'Clean'],
    techniques: ['Serial chain', 'Parallel routing', 'Swell'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Studio country guitar from the 1960s to the 1990s: a snappy, compressed clean with a short slap.',
    performance:
      'Clean is the snap for chicken-picked lines. Snap adds a slap for rhythm, Lead lifts for a solo, Steel fades notes in like a pedal steel.',
    before: [comp(-30), nam('drive-morning-glory'), nam('blackface-clean')],
    voices: [
      voice('Dry'),
      voice('Slap', echoAt(0.1)),
      voice('Steel', swell(1100)),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Clean', [1, 0, 0]],
      ['Snap', [1, 0.3, 0]],
      ['Lead', [1, 0.2, 0]],
      ['Steel', [0.3, 0, 1]],
    ]),
  },
  {
    id: 'HY12',
    name: 'Funk Engine',
    description:
      'A fast, flat clean with an envelope filter, a phaser and a chorus on parallel paths.',
    categories: ['Funk', 'Pop'],
    genres: ['Funk', 'Pop'],
    techniques: ['Serial chain', 'Parallel routing'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Rhythm guitar from 1970s funk and disco: muted sixteenths, an envelope filter on the response and a small room.',
    performance:
      'Clean is the muted chop. Quack opens the filter, Solo lifts the filter for a line, Wide adds chorus for open chords. Swirl is the phaser for the break.',
    before: [comp(-28), nam('jc-clean')],
    voices: [
      voice('Dry'),
      voice('Quack', wah()),
      voice('Wide', silk()),
      voice('Swirl', orbit(0.6, 4)),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0]],
      ['Quack', [0.5, 1, 0, 0]],
      ['Solo', [0.4, 1, 0, 0]],
      ['Wide', [0.8, 0, 0.7, 0]],
      ['Swirl', [0.6, 0, 0, 0.9]],
    ]),
  },
  {
    id: 'HY13',
    name: 'Soul Tremble',
    description:
      'A rich combo clean with tremolo, a slow tape echo and a dark room.',
    categories: ['Blues', 'Jazz'],
    genres: ['Blues', 'Jazz'],
    techniques: ['Serial chain', 'Parallel routing'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Late-night soul and blues guitar of the 1960s: tremolo on the amp, a dark room and slow echo.',
    performance:
      'Clean is the base for ballad chords. Tremolo adds the pulse, Lead lifts a melody with a slow echo, Dark room closes the top end for the outro.',
    before: [comp(-26), nam('super-reverb-77')],
    voices: [
      voice('Dry'),
      voice('Tremolo', trem()),
      voice('Echo', tapeEcho()),
      voice('Dark room', lowPass(3000), flyHall(4, 24)),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0]],
      ['Tremolo', [0.3, 1, 0, 0]],
      ['Lead', [1, 0, 0.35, 0]],
      ['Dark room', [0.6, 0, 0, 0.8]],
    ]),
  },
  {
    id: 'HY14',
    name: 'Cream Stack',
    description:
      'A dense crunch amp and a smooth lead amp with a drive in front, plus echo and a plate-style hall.',
    categories: ['Hard rock', 'Classic rock'],
    genres: ['Hard rock', 'Classic rock'],
    techniques: ['Parallel routing', 'Serial chain'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Hard rock and heavy blues of the late 1970s and 1980s: a crunch rhythm and a creamy, sustaining lead.',
    performance:
      'Crunch is the straight rhythm amp. Rhythm adds a little of the lead amp for body, Lead switches to the lead amp, Cream stacks both for the long note at the end.',
    before: [comp(-24)],
    voices: [
      voice('Crunch', nam('slo-crunch')),
      voice('Lead', nam('drive-kot'), nam('slo-lead')),
    ],
    after: [echoAt(0.2), flyHall(2.8, 14)],
    scenes: scenes([
      ['Crunch', [1, 0]],
      ['Rhythm', [0.8, 0.3]],
      ['Lead', [0, 1]],
      ['Cream', [0.5, 0.8]],
    ]),
  },
  {
    id: 'HY15',
    name: 'Lo-fi Cassette',
    description:
      'A clean amp through tape wobble, a bit-crusher and a hazy pad for worn-out textures.',
    categories: ['Lo-fi', 'Ambient'],
    genres: ['Lo-fi', 'Ambient'],
    techniques: ['Serial chain', 'Parallel routing', 'Swell'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Bedroom and tape-loop recordings of the 1980s and 2010s: slightly wobbly, dull on top and a little crunchy.',
    performance:
      'Tape is a soft, worn clean. Wobble deepens the pitch drift, Crushed lead adds a bit-crushed line, Haze fades in a chorused pad.',
    before: [lowPass(7000), comp(-26), nam('jc-clean')],
    voices: [
      voice('Tape', tape()),
      voice('Wobble', tape(0.02)),
      voice('Crush', crush()),
      voice('Haze', swell(1500), silk()),
    ],
    after: [flyRoom()],
    scenes: scenes([
      ['Tape', [1, 0, 0, 0]],
      ['Wobble', [0.4, 1, 0, 0]],
      ['Crushed lead', [0.6, 0, 0.8, 0]],
      ['Haze', [0.3, 0, 0, 1]],
    ]),
  },
  {
    id: 'HY16',
    name: 'Neon Ladder',
    description:
      'A glassy clean with ring modulation, a tracked sub, an octave up and a bit-crusher on parallel paths.',
    categories: ['Synth', 'Experimental', 'Parallel routing'],
    genres: ['Synth', 'Experimental'],
    techniques: ['Parallel routing', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Guitar played as a synthesiser, from 1980s new wave to modern electronic pop: ring-modulated bells, a sub underneath and bright octaves.',
    performance:
      'Clean is the plain base. Ring adds metallic bells, Lead lifts an octave above, Pad stacks the sub and the octave under a chord. Crush is for the breakdown.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [silk(), flyHall(3, 18)],
    route: [
      nam('two-rock-clean'),
      {
        paths: [
          path('Clean'),
          path(
            'Ring',
            [fx('MDA RingMod', { freq: 0.11, feedback: 0.15 })],
            -0.4,
          ),
          path('Sub', [sub(0.5)]),
          path('Octave up', [pitch(12)], 0.4),
          path('Crush', [crush()]),
        ],
      },
    ],
    scenes: scenes([
      ['Clean', [1, 0, 0, 0, 0]],
      ['Ring', [0.4, 1, 0, 0, 0]],
      ['Lead', [0.7, 0, 0, 0.8, 0]],
      ['Pad', [0.3, 0, 0.8, 0.6, 0]],
      ['Crush', [0.4, 0, 0, 0, 1]],
    ]),
  },
  {
    id: 'HY17',
    name: 'Drift Garden',
    description:
      'A clean amp with a shimmer, a ducking delay and a held, chorused pad on parallel paths.',
    categories: ['Ambient', 'Experimental', 'Parallel routing'],
    genres: ['Ambient', 'Experimental'],
    techniques: ['Parallel routing', 'Hold', 'Pitch'],
    engine: 'hybrid',
    complexity: 'complex',
    inspiration:
      'Ambient guitar from the mid-1980s onward: soft attacks, long reverb tails and repeats that step aside while you play.',
    performance:
      'Bed is the dry guitar. Duck adds echoes that get quiet while you play, Lead floats one line over them, Cathedral blends shimmer and a held pad. Pad only and Drone are for the finale.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [flyHall(6, 26)],
    route: [
      comp(-26),
      nam('studio-clean'),
      {
        paths: [
          path('Dry'),
          path('Shimmer', [shimmer()], 0.3),
          path('Ducked echo', [duck(520)]),
          path('Pad', [hold(), silk()], -0.3),
        ],
      },
    ],
    scenes: scenes([
      ['Bed', [1, 0, 0, 0]],
      ['Duck', [0.8, 0, 0.8, 0]],
      ['Lead', [1, 0, 0.35, 0]],
      ['Cathedral', [0.3, 0.8, 0, 0.6]],
      ['Pad only', [0, 0, 0, 1]],
      ['Drone', [0, 0.6, 0.4, 0.8]],
    ]),
  },
];
