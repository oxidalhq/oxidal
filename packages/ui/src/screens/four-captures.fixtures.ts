import { amp, cab, delay, drive, reverb } from '../patterns/rig.fixtures';
import type { SceneModel } from '../widgets/scene-editor';

const captures = [
  amp('clean', 'Twin clean', 'twin'),
  amp('crunch', 'Plexi crunch', 'plexi'),
  amp('lead', 'JCM lead', 'jcm'),
  amp('dirt', 'AC30 dirt', 'ac30'),
].map((block, i) => ({ ...block, caption: 'Full rig · NAM', on: i === 0 }));

export const CAPTURE_STOMP_KEY = 'oxidal.demo.capture-stomp';
export const CAPTURE_WET = { id: 'wet', name: 'Wet', nodes: ['echo', 'bloom'] };

export const CAPTURE_ROUTE = [
  drive('ts9'),
  ...captures,
  { ...cab('cab', 'Optional cabinet', 'gb412'), on: false },
  delay('echo'),
  reverb('bloom', 'Reverb · Hall'),
];

export const CAPTURE_SCENES: SceneModel[] = [
  'Clean',
  'Crunch',
  'Lead',
  'Dirt',
].map((name, i) => ({
  id: ['a', 'b', 'c', 'd'][i]!,
  name,
  on: {
    ...Object.fromEntries(
      captures.map((block, index) => [block.id, index === i]),
    ),
    ts9: i >= 2,
    echo: i === 2,
    bloom: i === 2,
    cab: false,
  },
  levels: {},
}));
