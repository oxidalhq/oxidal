import type { Step } from '../lib/route';
import {
  amp,
  cab,
  delay,
  drive,
  gate,
  mod,
  reverb,
} from '../patterns/rig.fixtures';
import type { BlockModel } from './block-editor';
import { type SceneModel, SILENT } from './scene-editor';

const named = (block: BlockModel, label: string, caption?: string) => ({
  ...block,
  label,
  ...(caption ? { caption } : {}),
});

/**
 * One preset with four branches, each with its own job: Rhythm, Lead,
 * Swells and a wet-only path. Lead uses the same TS9 and the same Plexi
 * capture as Rhythm, each a second copy with other settings.
 */
export const FOUR_JOBS: Step<BlockModel>[] = [
  gate('gate'),
  {
    split: true,
    id: 'jobs',
    names: ['Rhythm', 'Lead', 'Swells', 'Wet'],
    levels: [0, SILENT, SILENT, -8],
    branches: [
      [
        named(drive('ts9'), 'TS9 tight', 'Drive · low gain'),
        named(amp('plexi', 'Plexi 50', 'plexi'), 'Plexi 50'),
        cab('cab-gb', '4×12 Greenback', 'gb412'),
      ],
      [
        named(drive('ts9-boost'), 'TS9 boost', 'Drive · more level'),
        named(
          amp('plexi-hot', 'Plexi 50', 'plexi'),
          'Plexi 50 hot',
          'Amp · NAM · gain 8',
        ),
        cab('cab-v30', '4×12 V30', 'v30'),
        delay('lead-echo'),
      ],
      [
        named(mod('swell'), 'Swell', 'Volume swell'),
        named(amp('twin', 'Twin clean', 'twin'), 'Twin clean'),
        cab('cab-tweed', '1×12 Tweed', 'tweed112'),
      ],
      [
        named(delay('wet-echo'), 'Echo long', 'Delay · 100% wet'),
        reverb('wet-bloom', 'Reverb · 100% wet'),
      ],
    ],
  },
];

export const FOUR_SCENES: SceneModel[] = [
  {
    id: 'verse',
    name: 'Verse',
    on: { ts9: false },
    levels: { jobs: [0, SILENT, SILENT, -10] },
  },
  {
    id: 'chorus',
    name: 'Chorus',
    on: { ts9: true },
    values: { ts9: { drive: 6, level: 8 } },
    levels: { jobs: [0, SILENT, SILENT, -6] },
  },
  {
    id: 'lead',
    name: 'Lead',
    on: { 'lead-echo': true },
    levels: { jobs: [SILENT, 0, SILENT, -8] },
  },
  {
    id: 'swells',
    name: 'Swells',
    on: {},
    levels: { jobs: [SILENT, SILENT, 0, 0] },
  },
];
