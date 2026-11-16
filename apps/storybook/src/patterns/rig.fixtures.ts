import type { BlockControl, BlockModel } from '../widgets/block-editor';
import type { Scene } from '../widgets/scene-pad';
import type { Step } from '../lib/route';
import type { ChainLaneModel } from '../widgets/chain';

type RigLane = Omit<ChainLaneModel, 'blocks'> & { blocks: BlockModel[] };

export const AMPS = [
  { value: 'plexi', label: 'Plexi 50', caption: 'NAM · 48 kHz' },
  { value: 'jcm', label: 'JCM 800 crunch', caption: 'NAM · 48 kHz' },
  { value: 'ac30', label: 'AC30 top boost', caption: 'NAM A2 · 48 kHz' },
  { value: 'twin', label: 'Twin clean', caption: 'NAM · 44.1 kHz' },
  { value: 'b15', label: 'B15 bass', caption: 'NAM · 48 kHz' },
];

export const CABS = [
  { value: 'gb412', label: '4×12 Greenback', caption: 'IR · SM57 · 2 cm' },
  { value: 'v30', label: '4×12 V30', caption: 'IR · R121 · 5 cm' },
  { value: 'blue212', label: '2×12 Blue', caption: 'IR · SM57 · edge' },
  { value: 'tweed112', label: '1×12 Tweed', caption: 'IR · MD421' },
];

export const amp = (
  id: string,
  label: string,
  model: string,
  unsaved = false,
): BlockModel => ({
  id,
  label,
  kind: 'amp',
  caption: 'Amp · NAM',
  on: true,
  unsaved,
  source: { label: 'Model', value: model, options: AMPS },
  controls: [
    {
      id: 'gain',
      label: 'Gain',
      value: 6.5,
      min: 0,
      max: 10,
      main: true,
      group: 'Drive',
    },
    {
      id: 'bass',
      label: 'Bass',
      value: 5,
      min: 0,
      max: 10,
      main: true,
      group: 'Tone',
    },
    {
      id: 'mid',
      label: 'Mid',
      value: 6,
      min: 0,
      max: 10,
      main: true,
      group: 'Tone',
    },
    {
      id: 'treble',
      label: 'Treble',
      value: 7,
      min: 0,
      max: 10,
      main: true,
      group: 'Tone',
    },
    {
      id: 'presence',
      label: 'Presence',
      value: 5.5,
      min: 0,
      max: 10,
      group: 'Tone',
    },
    {
      id: 'level',
      label: 'Level',
      value: -6,
      min: -24,
      max: 12,
      unit: 'dB',
      group: 'Output',
    },
  ],
});

export const cab = (
  id: string,
  label: string,
  ir: string,
  mics: string[] = ['SM57', 'R121'],
): BlockModel => ({
  id,
  label,
  kind: 'cab',
  caption: 'Cabinet · IR',
  on: true,
  source: { label: 'Impulse response', value: ir, options: CABS },
  mics,
  controls: [
    {
      id: 'mic-position',
      label: 'Mic A position',
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      hidden: true,
    },
    {
      id: 'mic-angle',
      label: 'Mic A angle',
      value: -20,
      min: -180,
      max: 180,
      step: 1,
      hidden: true,
    },
    {
      id: 'mic-b-position',
      label: 'Mic B position',
      value: 0.6,
      min: 0,
      max: 1,
      step: 0.01,
      hidden: true,
    },
    {
      id: 'mic-b-angle',
      label: 'Mic B angle',
      value: 30,
      min: -180,
      max: 180,
      step: 1,
      hidden: true,
    },
    {
      id: 'mic-b-distance',
      label: 'Mic B distance',
      value: 8,
      min: 0,
      max: 30,
      step: 1,
      unit: 'cm',
      hidden: true,
    },
    {
      id: 'mic-blend',
      label: 'Mic blend',
      value: 35,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      hidden: true,
    },
    {
      id: 'lowcut',
      label: 'Low cut',
      value: 80,
      min: 20,
      max: 400,
      step: 5,
      unit: 'Hz',
      main: true,
      group: 'Shape',
    },
    {
      id: 'highcut',
      label: 'High cut',
      value: 8000,
      min: 2000,
      max: 20000,
      step: 100,
      unit: 'Hz',
      main: true,
      group: 'Shape',
    },
    {
      id: 'level',
      label: 'Level',
      value: 0,
      min: -24,
      max: 12,
      unit: 'dB',
      main: true,
      group: 'Output',
    },
    {
      id: 'distance',
      label: 'Mic A distance',
      value: 2,
      min: 0,
      max: 30,
      step: 1,
      unit: 'cm',
      group: 'Shape',
    },
  ],
});

export const delay = (id: string): BlockModel => ({
  id,
  label: 'Echo',
  kind: 'time',
  role: 'delay',
  caption: 'Delay · Tape',
  on: false,
  controls: [
    {
      id: 'time',
      label: 'Time',
      value: 380,
      min: 20,
      max: 2000,
      step: 5,
      unit: 'ms',
      main: true,
      group: 'Time',
    },
    {
      id: 'feedback',
      label: 'Feedback',
      value: 35,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      main: true,
      group: 'Time',
    },
    {
      id: 'mix',
      label: 'Mix',
      value: 25,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      main: true,
      group: 'Mix',
    },
    {
      id: 'tone',
      label: 'Tone',
      value: 5,
      min: 0,
      max: 10,
      main: true,
      group: 'Colour',
    },
    { id: 'wow', label: 'Wow', value: 2, min: 0, max: 10, group: 'Colour' },
    {
      id: 'flutter',
      label: 'Flutter',
      value: 1.5,
      min: 0,
      max: 10,
      group: 'Colour',
    },
    {
      id: 'saturation',
      label: 'Saturation',
      value: 3,
      min: 0,
      max: 10,
      group: 'Colour',
    },
  ],
});

export const reverb = (id: string, caption: string): BlockModel => ({
  id,
  label: 'Bloom',
  kind: 'time',
  role: 'reverb',
  caption,
  on: true,
  controls: [
    {
      id: 'size',
      label: 'Size',
      value: 6,
      min: 0,
      max: 10,
      main: true,
      group: 'Space',
    },
    {
      id: 'decay',
      label: 'Decay',
      value: 3.2,
      min: 0.1,
      max: 20,
      step: 0.1,
      unit: 's',
      main: true,
      group: 'Space',
    },
    {
      id: 'mix',
      label: 'Mix',
      value: 30,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      main: true,
      group: 'Mix',
    },
    {
      id: 'predelay',
      label: 'Pre-delay',
      value: 20,
      min: 0,
      max: 200,
      step: 1,
      unit: 'ms',
      main: true,
      group: 'Space',
    },
    {
      id: 'damping',
      label: 'Damping',
      value: 4,
      min: 0,
      max: 10,
      group: 'Colour',
    },
    {
      id: 'shimmer',
      label: 'Shimmer',
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      group: 'Colour',
    },
  ],
});

export const drive = (id: string): BlockModel => ({
  id,
  label: 'TS9',
  kind: 'pedal',
  role: 'drive',
  caption: 'Drive',
  on: true,
  controls: [
    { id: 'drive', label: 'Drive', value: 4, min: 0, max: 10, main: true },
    { id: 'tone', label: 'Tone', value: 6, min: 0, max: 10, main: true },
    { id: 'level', label: 'Level', value: 7, min: 0, max: 10, main: true },
  ],
});

export const gate = (id: string): BlockModel => ({
  id,
  label: 'Gate',
  kind: 'lv2',
  role: 'gate',
  caption: 'Noise gate',
  on: true,
  controls: [
    {
      id: 'threshold',
      label: 'Threshold',
      value: -48,
      min: -80,
      max: 0,
      unit: 'dB',
      main: true,
    },
    {
      id: 'release',
      label: 'Release',
      value: 120,
      min: 10,
      max: 1000,
      step: 10,
      unit: 'ms',
      main: true,
    },
  ],
});

export const mod = (id: string): BlockModel => ({
  id,
  label: 'Motion',
  kind: 'mod',
  caption: 'Chorus',
  on: true,
  controls: [
    { id: 'rate', label: 'Rate', value: 2, min: 0, max: 10, main: true },
    { id: 'depth', label: 'Depth', value: 5, min: 0, max: 10, main: true },
    {
      id: 'mix',
      label: 'Mix',
      value: 50,
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      main: true,
    },
  ],
});

/** A realistic serial rig: gate, drive, amp, cab, delay, reverb. */
export const SERIAL: RigLane[] = [
  {
    id: 'main',
    blocks: [
      gate('gate'),
      drive('ts9'),
      amp('amp', 'Plexi 50', 'plexi', true),
      cab('cab', '4×12 Greenback', 'gb412'),
      delay('echo'),
      reverb('bloom', 'Reverb · Hall'),
    ],
  },
];

/** A parallel rig: a dry lane and a wet lane summed at the merge. */
export const PARALLEL: RigLane[] = [
  {
    id: 'dry',
    name: 'Dry',
    blocks: [
      amp('amp-a', 'Plexi 50', 'plexi'),
      cab('cab-a', '4×12 Greenback', 'gb412'),
    ],
  },
  {
    id: 'wet',
    name: 'Wet',
    blocks: [
      mod('motion'),
      amp('amp-b', 'AC30 top boost', 'ac30'),
      cab('cab-b', '2×12 Blue', 'blue212'),
      reverb('bloom-b', 'Reverb · Shimmer'),
    ],
  },
];

export const SCENES: Scene[] = [
  { id: 'a', name: 'Clean' },
  { id: 'b', name: 'Crunch' },
  { id: 'c', name: 'Lead' },
  { id: 'd', name: 'Ambient' },
];

/** The serial rig as a route: one path, no splits. */
export const SERIAL_ROUTE: Step<BlockModel>[] = SERIAL[0]!.blocks;

/**
 * A Quad-Cortex-style route: gate and drive, then the signal splits into two
 * amps (Plexi into a Greenback, AC30 into a Blue) and joins, then delay, then
 * a second split with reverb on one branch and the dry signal on the other.
 */
export const PARALLEL_ROUTE: Step<BlockModel>[] = [
  gate('gate'),
  drive('ts9'),
  {
    split: true,
    id: 'split-amps',
    branches: [
      [
        amp('amp-a', 'Plexi 50', 'plexi'),
        cab('cab-a', '4×12 Greenback', 'gb412'),
      ],
      [
        amp('amp-b', 'AC30 top boost', 'ac30'),
        cab('cab-b', '2×12 Blue', 'blue212'),
      ],
    ],
    levels: [0, -3],
  },
  delay('echo'),
  {
    split: true,
    id: 'split-wet',
    branches: [[reverb('bloom', 'Reverb · Hall')], []],
    levels: [-4, 0],
  },
];

export const NEW_BLOCK = (): BlockModel => mod(`new-${Date.now()}`);

export type { BlockControl };
