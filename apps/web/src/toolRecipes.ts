import {
  chorus,
  compressor,
  coreScenes,
  echo,
  type FactoryRecipe,
  fx,
  keyed,
  leadLift,
  nam,
  pitch,
  room,
  sub,
  voice,
} from './factoryRecipes.ts';

/**
 * Presets for turning a guitar into a bass for testing and recording, and for
 * layering a guitar and a bass. The octave-down pitch voice works best on clear
 * single notes and adds a little delay. Names and descriptions describe the sound.
 * @see docs/factory-collection.md
 */
const octave = () => pitch(-12);

export const toolRecipes: FactoryRecipe[] = [
  {
    id: 'T01',
    name: 'Guitar Bass',
    era: 'Modern',
    description:
      'Plays your guitar an octave down through a warm vintage bass stack, for testing and recording bass parts. Play single notes cleanly; the pitch voice adds a little delay.',
    categories: ['Modern', 'Bass', 'Utility'],
    genres: ['Bass'],
    techniques: ['Pitch', 'Utility'],
    engine: 'hybrid',
    complexity: 'simple',
    inspiration:
      'Guitar-as-bass demo recording: an octave-down pitch block into a warm vintage bass stack.',
    performance:
      'Octave is the plain octave-down bass. Compressed evens out the notes for recording, Boost squeezes them harder with the level lift so a line sits forward, and Sub adds a generated octave below for weight. Play clean single notes.',
    before: [octave(), nam('bass-vintage')],
    voices: [
      voice('Octave'),
      voice('Sub', sub(0.6)),
      voice('Comp', keyed('comp', compressor())),
    ],
    after: [],
    scenes: coreScenes(
      ['Octave', [1, 0, 0]],
      ['Compressed', [0, 0, 1]],
      ['Boost', [0, 0, 1], leadLift, { comp: { THRESHOLD: -28 } }],
      ['Sub', [0, 1, 0]],
    ),
  },
  {
    id: 'T02',
    name: 'Low Wire',
    era: 'Modern',
    description:
      'Octave-down guitar through a gritty rock bass amp, with a fuzz and a sub layer for heavy riffs. Keep notes clear and short for the best tracking.',
    categories: ['Modern', 'Bass', 'Rock'],
    genres: ['Bass', 'Hard rock'],
    techniques: ['Pitch', 'Utility'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Guitar-as-bass for heavy riffs: an octave-down pitch block into a gritty rock bass amp with a fuzz and a sub layer.',
    performance:
      'Clean is the octave-down bass amp. Fuzz adds the fuzz for heavy riffs, Boost compresses the fuzz harder with the level lift for a sustained line, and Sub adds a generated octave below. Keep notes short and clear.',
    before: [octave(), nam('bass-grit')],
    voices: [
      voice('Clean'),
      voice('Fuzz', fx('GxBigMuffPi')),
      voice('Sub', sub(0.5)),
    ],
    after: [keyed('comp', compressor())],
    scenes: coreScenes(
      ['Clean', [1, 0, 0]],
      ['Fuzz', [0, 1, 0]],
      ['Boost', [0, 1, 0], leadLift, { comp: { THRESHOLD: -28 } }],
      ['Sub', [0, 0, 1]],
    ),
  },
  {
    id: 'T03',
    name: 'Two Strings',
    era: 'Modern',
    description:
      'A raw stack guitar and an octave-down vintage bass played together from one guitar. Switch between guitar, bass, both, and a bass-heavy stack. Two amps run at once.',
    categories: ['Modern', 'Bass', 'Guitar and bass'],
    genres: ['Bass', 'Classic rock'],
    techniques: ['Pitch', 'Guitar and bass'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Two-piece rock bands of the 2000s: one guitar feeding a raw guitar stack and, an octave down, a vintage bass stack.',
    performance:
      'Guitar is the guitar stack alone. Bass is the octave-down bass stack alone, Both plays them together, and Bass heavy leans on the bass stack for riffs.',
    before: [],
    voices: [
      voice('Guitar', nam('plexi-crunch')),
      voice('Bass', octave(), nam('bass-vintage')),
    ],
    after: [compressor(), room()],
    scenes: [
      { name: 'Guitar', mix: [0.8, 0] },
      { name: 'Bass', mix: [0, 0.8] },
      { name: 'Both', mix: [0.6, 0.5] },
      { name: 'Bass heavy', mix: [0.4, 0.8] },
    ],
  },
  {
    id: 'T04',
    name: 'Velvet Duo',
    era: 'Modern',
    description:
      'A clean chorused guitar over an octave-down bass with a short echo, for warm duo parts and recording demos. Two amps run at once; echo is fixed, not tempo-synced.',
    categories: ['Modern', 'Bass', 'Guitar and bass'],
    genres: ['Bass', 'Clean'],
    techniques: ['Pitch', 'Guitar and bass'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Home demo recording: a chorused clean guitar over an octave-down bass with a short echo.',
    performance:
      'Guitar is the chorused clean amp alone. Bass is the octave-down bass alone, Duo plays them together, and Bass forward leans on the bass for a fuller low end.',
    before: [],
    voices: [
      voice('Guitar', nam('blackface-clean'), chorus()),
      voice('Bass', octave(), nam('bass-vintage'), compressor()),
    ],
    after: [echo(0.08), room()],
    scenes: [
      { name: 'Guitar', mix: [0.8, 0] },
      { name: 'Bass', mix: [0, 0.8] },
      { name: 'Duo', mix: [0.6, 0.5] },
      { name: 'Bass forward', mix: [0.4, 0.8] },
    ],
  },
];
