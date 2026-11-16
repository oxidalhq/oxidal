import type { Step } from '../lib/route';
import type { BlockModel } from '../widgets/block-editor';
import { PARALLEL_ROUTE, SERIAL_ROUTE } from './rig.fixtures';

/** What a scene stores: which blocks are on and how loud each branch of each split is. */
export type SceneModel = {
  id: string;
  name: string;
  on: Record<string, boolean>;
  levels: Record<string, number[]>;
  edited?: boolean;
};

const pick = (route: Step<BlockModel>[], id: string) =>
  JSON.parse(
    JSON.stringify(route.find((s) => !('split' in s) && s.id === id)),
  ) as BlockModel;

const amps = PARALLEL_ROUTE[2] as Extract<Step<BlockModel>, { split: true }>;

/**
 * One preset that holds three complete sounds side by side: a clean amp,
 * a crunch amp and a lead chain with its own delay, between one split and
 * one join, then a shared reverb. Each scene picks which branch you hear and
 * which blocks are on — so switching scenes changes the whole sound with no
 * gap, inside one rig.
 */
export const THREE_SOUNDS: Step<BlockModel>[] = [
  pick(SERIAL_ROUTE, 'gate'),
  pick(SERIAL_ROUTE, 'ts9'),
  {
    split: true,
    id: 'sounds',
    branches: [
      [
        {
          ...amps.branches[1]![0]!,
          id: 'clean-amp',
          label: 'AC30 clean',
        } as BlockModel,
        { ...amps.branches[1]![1]!, id: 'clean-cab' } as BlockModel,
      ],
      [
        {
          ...amps.branches[0]![0]!,
          id: 'crunch-amp',
          label: 'Plexi crunch',
        } as BlockModel,
        { ...amps.branches[0]![1]!, id: 'crunch-cab' } as BlockModel,
      ],
      [
        {
          ...amps.branches[0]![0]!,
          id: 'lead-amp',
          label: 'Plexi lead',
        } as BlockModel,
        {
          ...amps.branches[0]![1]!,
          id: 'lead-cab',
          label: '4×12 V30',
        } as BlockModel,
        { ...pick(SERIAL_ROUTE, 'echo'), id: 'lead-echo', on: true },
      ],
    ],
    levels: [0, -60, -60],
  },
  pick(SERIAL_ROUTE, 'bloom'),
];

export const THREE_SCENES: SceneModel[] = [
  {
    id: 'clean',
    name: 'Clean',
    on: { ts9: false, bloom: true },
    levels: { sounds: [0, -60, -60] },
  },
  {
    id: 'crunch',
    name: 'Crunch',
    on: { ts9: true, bloom: false },
    levels: { sounds: [-60, 0, -60] },
  },
  {
    id: 'lead',
    name: 'Lead',
    on: { ts9: true, bloom: true, 'lead-echo': true },
    levels: { sounds: [-60, -60, 0] },
  },
  {
    id: 'ambient',
    name: 'Ambient',
    on: { ts9: false, bloom: true },
    levels: { sounds: [0, -60, -6] },
  },
];
