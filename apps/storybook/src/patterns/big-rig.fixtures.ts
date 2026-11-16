import type { Step } from '../lib/route';
import type { BlockModel } from '../widgets/block-editor';
import { amp, cab, delay, drive, gate, mod, reverb } from './rig.fixtures';

/** Size of a NAM capture, as TONE3000 and the NAM trainer name them. */
export type CaptureSize = 'Standard' | 'Lite' | 'Feather' | 'Nano';

export type Branch = {
  name: string;
  size: CaptureSize;
  steps: Step<BlockModel>[];
};

const named = (block: BlockModel, label: string, caption?: string) => ({
  ...block,
  label,
  caption: caption ?? block.caption,
});

/**
 * Ten complete amp sounds, each its own NAM capture and cab, some with a
 * pedal in front or a second split inside (two IRs blended, or a bass DI
 * beside the cab). The first five, seven or ten make the example rigs.
 */
const BRANCHES: Branch[] = [
  {
    name: 'Clean',
    size: 'Standard',
    steps: [
      named(amp('b1-amp', '', 'twin'), 'Twin clean', 'NAM · Standard'),
      cab('b1-cab', '1×12 Tweed', 'tweed112'),
    ],
  },
  {
    name: 'Chime',
    size: 'Standard',
    steps: [
      named(amp('b2-amp', '', 'ac30'), 'AC30 top boost', 'NAM A2 · Standard'),
      cab('b2-cab', '2×12 Blue', 'blue212'),
    ],
  },
  {
    name: 'Crunch',
    size: 'Standard',
    steps: [
      named(amp('b3-amp', '', 'plexi'), 'Plexi 50', 'NAM · Standard'),
      cab('b3-cab', '4×12 Greenback', 'gb412'),
    ],
  },
  {
    name: 'Rhythm',
    size: 'Lite',
    steps: [
      named(amp('b4-amp', '', 'jcm'), 'JCM 800 crunch', 'NAM · Lite'),
      cab('b4-cab', '4×12 V30', 'v30'),
    ],
  },
  {
    name: 'Lead',
    size: 'Standard',
    steps: [
      { ...drive('b5-drive'), label: 'TS9 push' },
      named(amp('b5-amp', '', 'plexi'), 'Plexi lead', 'NAM · Standard'),
      cab('b5-cab', '4×12 V30', 'v30'),
      { ...delay('b5-echo'), on: true, label: 'Lead echo' },
    ],
  },
  {
    name: 'Heavy',
    size: 'Standard',
    steps: [
      named(amp('b6-amp', '', 'jcm'), 'High gain', 'NAM · Standard'),
      {
        split: true,
        id: 'b6-cabs',
        branches: [
          [cab('b6-cab-a', '4×12 V30', 'v30')],
          [cab('b6-cab-b', '4×12 Greenback', 'gb412')],
        ],
        levels: [0, -4],
      },
    ],
  },
  {
    name: 'Bass',
    size: 'Lite',
    steps: [
      named(amp('b7-amp', '', 'b15'), 'B15 bass', 'NAM · Lite'),
      {
        split: true,
        id: 'b7-di',
        branches: [[cab('b7-cab', '1×12 Tweed', 'tweed112', ['MD421'])], []],
        levels: [0, -6],
      },
    ],
  },
  {
    name: 'Fuzz',
    size: 'Feather',
    steps: [
      { ...drive('b8-fuzz'), label: 'Fuzz', caption: 'Drive · Fuzz' },
      named(amp('b8-amp', '', 'twin'), 'Tweed fuzz', 'NAM · Feather'),
      cab('b8-cab', '1×12 Tweed', 'tweed112'),
    ],
  },
  {
    name: 'Jazz',
    size: 'Nano',
    steps: [
      named(amp('b9-amp', '', 'twin'), 'Jazz combo', 'NAM · Nano'),
      cab('b9-cab', '1×12 Tweed', 'tweed112', ['R121']),
    ],
  },
  {
    name: 'Wash',
    size: 'Lite',
    steps: [
      { ...mod('b10-motion'), label: 'Motion' },
      named(amp('b10-amp', '', 'ac30'), 'AC30 swell', 'NAM A2 · Lite'),
      cab('b10-cab', '2×12 Blue', 'blue212'),
      reverb('b10-bloom', 'Reverb · Shimmer'),
    ],
  },
];

export const BRANCH_COUNTS = [5, 7, 10] as const;
export type BranchCount = (typeof BRANCH_COUNTS)[number];

export const SILENT = -60;

/**
 * A rig with `count` amp branches between one split and one join, a shared
 * delay, then a second split: hall reverb, shimmer, or dry.
 */
export function bigRig(count: BranchCount): Step<BlockModel>[] {
  return rigOf(BRANCHES.slice(0, count));
}

/** The same rig shape around any list of amp branches. */
export function rigOf(used: Branch[]): Step<BlockModel>[] {
  return [
    gate('gate'),
    {
      split: true,
      id: 'amps',
      branches: used.map((b) => b.steps),
      names: used.map((b) => b.name),
      levels: used.map((_, i) => (i === 0 ? 0 : SILENT)),
    },
    delay('echo'),
    {
      split: true,
      id: 'space',
      branches: [
        [reverb('hall', 'Reverb · Hall')],
        [reverb('shimmer', 'Reverb · Shimmer')],
        [],
      ],
      names: ['Hall', 'Shimmer', 'Dry'],
      levels: [-6, SILENT, 0],
    },
  ];
}

export const branchesOf = (count: BranchCount) => BRANCHES.slice(0, count);

/** A new branch for a model: the capture into a 4×12 cab. */
export function branchFor(
  model: { id: string; label: string; caption: string },
  size: CaptureSize,
  n: number,
): Branch {
  return {
    name: model.label,
    size,
    steps: [
      named(amp(`added-${n}-amp`, '', model.id), model.label, model.caption),
      cab(`added-${n}-cab`, '4×12 V30', 'v30'),
    ],
  };
}

/** The device keeps this share of each audio period free, so a busy moment never drops out. */
export const LIMIT = 0.85;

/** A scene of the big rig: the level of each amp branch, the space split, and blocks on or off. */
export type BigScene = {
  id: string;
  name: string;
  /** Amp branch index → level in dB. Branches not listed are silent. */
  amps: Record<number, number>;
  space: [number, number, number];
  on?: Record<string, boolean>;
};

const S = SILENT;

/**
 * Scenes that pick one amp, or blend two (a clean and a crunch, a heavy
 * with a bass DI), with their own reverb. Scenes that need a branch the
 * smaller rigs lack are left out of those rigs.
 */
export const BIG_SCENES: BigScene[] = [
  { id: 'clean', name: 'Clean', amps: { 0: 0 }, space: [-6, S, 0] },
  { id: 'chime', name: 'Chime', amps: { 1: 0 }, space: [-8, S, 0] },
  { id: 'crunch', name: 'Crunch', amps: { 2: 0 }, space: [S, S, 0] },
  {
    id: 'blend',
    name: 'Clean + crunch',
    amps: { 0: -3, 2: -5 },
    space: [-10, S, 0],
  },
  {
    id: 'rhythm',
    name: 'Rhythm',
    amps: { 3: 0 },
    space: [S, S, 0],
    on: { echo: false },
  },
  {
    id: 'lead',
    name: 'Lead',
    amps: { 4: 0 },
    space: [-8, S, 0],
    on: { echo: true },
  },
  { id: 'heavy', name: 'Heavy', amps: { 5: 0 }, space: [S, S, 0] },
  {
    id: 'doom',
    name: 'Heavy + bass',
    amps: { 5: -2, 6: -6 },
    space: [S, S, 0],
  },
  { id: 'fuzz', name: 'Fuzz', amps: { 7: 0 }, space: [-12, S, 0] },
  { id: 'wash', name: 'Wash', amps: { 9: 0, 8: -8 }, space: [S, -2, -12] },
];

export const scenesFor = (count: number) =>
  BIG_SCENES.filter((s) => Object.keys(s.amps).every((i) => Number(i) < count));

/**
 * Share of each audio period one running branch takes, for this example
 * only: the Pi measures the real load and the health word reports it.
 */
export const ESTIMATE: Record<CaptureSize, number> = {
  Standard: 0.09,
  Lite: 0.06,
  Feather: 0.03,
  Nano: 0.02,
};
/** The rest of the rig: gate, cabs, delay, reverbs. */
export const SHARED_ESTIMATE = 0.12;
