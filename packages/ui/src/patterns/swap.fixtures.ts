import type { ToneGear } from './model-browser';
import { delay, drive, gate, mod, reverb } from './rig.fixtures';
import type { BlockType, ModelChoice } from './swap-sheet';

/**
 * Models a block can try: captures and IRs already on the device, and
 * TONE3000 tones (some downloaded, some not). Creators and licences are
 * example values.
 */
const LISTED: ModelChoice[] = [
  {
    id: 'plexi',
    loudness: -2,
    label: 'Plexi 50',
    caption: 'NAM · Standard · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'jcm',
    loudness: 1.5,
    label: 'JCM 800 crunch',
    caption: 'NAM · Lite · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'ac30',
    loudness: -4,
    label: 'AC30 top boost',
    caption: 'NAM A2 · Standard · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'twin',
    loudness: -6.5,
    label: 'Twin clean',
    caption: 'NAM · Standard · 44.1 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'b15',
    loudness: -3,
    label: 'B15 bass',
    caption: 'NAM · Lite · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 't3k-dumble',
    loudness: 0.5,
    label: 'Overdrive special',
    caption: 'NAM A2 · Standard · 48 kHz',
    kind: 'amp',
    from: 'tone3000',
    creator: 'Jane Capture',
    licence: 'CC BY 4.0',
    downloaded: true,
  },
  {
    id: 't3k-5150',
    loudness: 3,
    label: 'High gain lead',
    caption: 'NAM · Standard · 48 kHz',
    kind: 'amp',
    from: 'tone3000',
    creator: 'Studio Pack',
    licence: 'Free to use',
  },
  {
    id: 't3k-deluxe',
    loudness: -5,
    label: 'Deluxe reverb',
    caption: 'NAM · Feather · 48 kHz',
    kind: 'amp',
    from: 'tone3000',
    creator: 'Porch Tones',
    licence: 'CC BY 4.0',
  },
  {
    id: 'gb412',
    label: '4×12 Greenback',
    caption: 'IR · 48 kHz · 24-bit · mono',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'v30',
    label: '4×12 V30',
    caption: 'IR · 48 kHz · 24-bit · stereo',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'blue212',
    label: '2×12 Blue',
    caption: 'IR · 44.1 kHz · 24-bit · mono',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'tweed112',
    label: '1×12 Tweed',
    caption: 'IR · 48 kHz · 16-bit · mono',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 't3k-oversized',
    label: '4×12 Oversized',
    caption: 'IR · 48 kHz · 24-bit · stereo',
    kind: 'cab',
    from: 'tone3000',
    creator: 'Jane Capture',
    licence: 'CC BY 4.0',
  },
  {
    id: 'ts9',
    loudness: 0,
    label: 'TS9',
    caption: 'NAM pedal · Lite',
    kind: 'pedal',
    from: 'mine',
  },
  {
    id: 't3k-rat',
    loudness: 2,
    label: 'Rat',
    caption: 'NAM pedal · Standard',
    kind: 'pedal',
    from: 'tone3000',
    creator: 'Porch Tones',
    licence: 'Free to use',
  },
];

const MORE_TONES: ModelChoice[] = [
  ['t3k-1969', 'Plexi lead 1969', 'NAM · Standard · 48 kHz', 'Jane Capture', 1],
  ['t3k-bassman', 'Tweed bassman', 'NAM · Lite · 48 kHz', 'Porch Tones', -4.5],
  [
    't3k-rectifier',
    'Modern rectifier',
    'NAM A2 · Standard · 48 kHz',
    'Studio Pack',
    4,
  ],
  ['t3k-ac15', 'Class A 15', 'NAM · Feather · 48 kHz', 'Porch Tones', -5.5],
  [
    't3k-jubilee',
    'Silver anniversary',
    'NAM · Standard · 48 kHz',
    'Studio Pack',
    2,
  ],
].map(([id, label, caption, creator, loudness]) => ({
  id: id as string,
  label: label as string,
  caption: caption as string,
  creator: creator as string,
  loudness: loudness as number,
  kind: 'amp' as const,
  from: 'tone3000' as const,
  licence: 'CC BY 4.0',
}));

const SIZES = ['Standard', 'Lite', 'Feather'];
const GEAR: Record<ModelChoice['kind'], ToneGear> = {
  amp: 'amp',
  cab: 'cab',
  pedal: 'pedal',
};

/** Fills in what the catalogue reports about each example. */
const described = (m: ModelChoice): ModelChoice => {
  const size = m.caption.split(' · ').find((part) => SIZES.includes(part));
  const format = m.caption.includes('A2')
    ? 'NAM A2'
    : m.kind === 'cab'
      ? 'IR'
      : 'NAM';
  return {
    ...m,
    size,
    gear: GEAR[m.kind],
    ...(m.from === 'tone3000' && {
      variants: [
        { id: `${m.id}-standard`, label: 'Standard · full detail' },
        { id: `${m.id}-lite`, label: 'Lite · lighter on the Pi' },
      ],
      origin: {
        kind: 'tone3000' as const,
        title: m.label,
        creator: { name: m.creator ?? 'Example creator' },
        page: `https://www.tone3000.com/tones/${m.id}`,
        image: m.kind === 'amp' ? '/examples/amp-head.svg' : undefined,
        gear:
          GEAR[m.kind] === 'amp' ? 'Amp' : m.kind === 'cab' ? 'Cab' : 'Pedal',
        format,
        models: 2,
        counts: { standard: 1, a2: 1 },
        licence: m.licence ?? 'Free to use',
      },
    }),
  };
};

export const MODELS: ModelChoice[] = [...LISTED, ...MORE_TONES].map(described);

/** What a block can turn into. Each starts from its defaults. */
export const BLOCK_TYPES: BlockType[] = [
  {
    id: 'drive',
    label: 'Drive',
    description: 'A mild overdrive that tightens the amp',
    group: 'Drive',
    make: (id) => drive(id),
  },
  {
    id: 'fuzz',
    label: 'Fuzz',
    description: 'Thick, buzzing sustain',
    group: 'Drive',
    make: (id) => ({ ...drive(id), label: 'Fuzz', caption: 'Drive · Fuzz' }),
  },
  {
    id: 'delay',
    label: 'Tape echo',
    description: 'Warm repeats that darken as they fade',
    group: 'Delay',
    make: (id) => ({ ...delay(id), on: true }),
  },
  {
    id: 'hall',
    label: 'Hall',
    description: 'A large room behind the notes',
    group: 'Reverb',
    make: (id) => ({ ...reverb(id, 'Reverb · Hall'), label: 'Hall' }),
  },
  {
    id: 'shimmer',
    label: 'Shimmer',
    description: 'A reverb whose tail climbs an octave',
    group: 'Reverb',
    make: (id) => ({ ...reverb(id, 'Reverb · Shimmer'), label: 'Shimmer' }),
  },
  {
    id: 'chorus',
    label: 'Chorus',
    description: 'A slow doubling that widens chords',
    group: 'Modulation',
    make: (id) => mod(id),
  },
  {
    id: 'gate',
    label: 'Noise gate',
    description: 'Closes on the hiss between phrases',
    group: 'Dynamics',
    make: (id) => gate(id),
  },
];
