import type { BlockType, ModelChoice } from './swap-sheet';
import { delay, drive, gate, mod, reverb } from './rig.fixtures';

/**
 * Models a block can try: captures and IRs already on the device, and
 * TONE3000 tones (some downloaded, some not). Creators and licences are
 * example values.
 */
export const MODELS: ModelChoice[] = [
  {
    id: 'plexi',
    label: 'Plexi 50',
    caption: 'NAM · Standard · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'jcm',
    label: 'JCM 800 crunch',
    caption: 'NAM · Lite · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'ac30',
    label: 'AC30 top boost',
    caption: 'NAM A2 · Standard · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'twin',
    label: 'Twin clean',
    caption: 'NAM · Standard · 44.1 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 'b15',
    label: 'B15 bass',
    caption: 'NAM · Lite · 48 kHz',
    kind: 'amp',
    from: 'mine',
  },
  {
    id: 't3k-dumble',
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
    label: 'High gain lead',
    caption: 'NAM · Standard · 48 kHz',
    kind: 'amp',
    from: 'tone3000',
    creator: 'Studio Pack',
    licence: 'Free to use',
  },
  {
    id: 't3k-deluxe',
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
    caption: 'IR · SM57 · 2 cm',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'v30',
    label: '4×12 V30',
    caption: 'IR · R121 · 5 cm',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'blue212',
    label: '2×12 Blue',
    caption: 'IR · SM57 · edge',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 'tweed112',
    label: '1×12 Tweed',
    caption: 'IR · MD421',
    kind: 'cab',
    from: 'mine',
  },
  {
    id: 't3k-oversized',
    label: '4×12 Oversized',
    caption: 'IR · SM57 + R121',
    kind: 'cab',
    from: 'tone3000',
    creator: 'Jane Capture',
    licence: 'CC BY 4.0',
  },
  {
    id: 'ts9',
    label: 'TS9',
    caption: 'NAM pedal · Lite',
    kind: 'pedal',
    from: 'mine',
  },
  {
    id: 't3k-rat',
    label: 'Rat',
    caption: 'NAM pedal · Standard',
    kind: 'pedal',
    from: 'tone3000',
    creator: 'Porch Tones',
    licence: 'Free to use',
  },
];

/** What a block can turn into. Each starts from its defaults. */
export const BLOCK_TYPES: BlockType[] = [
  { id: 'drive', label: 'Drive', group: 'Drive', make: (id) => drive(id) },
  {
    id: 'fuzz',
    label: 'Fuzz',
    group: 'Drive',
    make: (id) => ({ ...drive(id), label: 'Fuzz', caption: 'Drive · Fuzz' }),
  },
  {
    id: 'delay',
    label: 'Tape echo',
    group: 'Delay',
    make: (id) => ({ ...delay(id), on: true }),
  },
  {
    id: 'hall',
    label: 'Hall',
    group: 'Reverb',
    make: (id) => ({ ...reverb(id, 'Reverb · Hall'), label: 'Hall' }),
  },
  {
    id: 'shimmer',
    label: 'Shimmer',
    group: 'Reverb',
    make: (id) => ({ ...reverb(id, 'Reverb · Shimmer'), label: 'Shimmer' }),
  },
  { id: 'chorus', label: 'Chorus', group: 'Modulation', make: (id) => mod(id) },
  {
    id: 'gate',
    label: 'Noise gate',
    group: 'Dynamics',
    make: (id) => gate(id),
  },
];
