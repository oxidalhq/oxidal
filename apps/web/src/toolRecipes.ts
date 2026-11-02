import {
  chorus,
  compressor,
  echo,
  fx,
  nam,
  pitch,
  room,
  selections,
  sub,
  voice,
  type FactoryRecipe,
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
    before: [octave(), nam('bass-vintage')],
    voices: [
      voice('Octave'),
      voice('Sub', sub(0.6)),
      voice('Comp', compressor()),
    ],
    after: [],
    scenes: selections(['Octave', 'Sub', 'Compressed', 'Boost']),
  },
  {
    id: 'T02',
    name: 'Low Wire',
    era: 'Modern',
    description:
      'Octave-down guitar through a gritty rock bass amp, with a fuzz and a sub layer for heavy riffs. Keep notes clear and short for the best tracking.',
    categories: ['Modern', 'Bass', 'Rock'],
    before: [octave(), nam('bass-grit')],
    voices: [
      voice('Clean'),
      voice('Fuzz', fx('GxBigMuffPi')),
      voice('Sub', sub(0.5)),
    ],
    after: [compressor()],
    scenes: selections(['Clean', 'Fuzz', 'Sub', 'Boost']),
  },
  {
    id: 'T03',
    name: 'Two Strings',
    era: 'Modern',
    description:
      'A plexi-style guitar and an octave-down vintage bass played together from one guitar. Switch between guitar, bass, both, and a bass-heavy stack. Two amps run at once.',
    categories: ['Modern', 'Bass', 'Guitar and bass'],
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
