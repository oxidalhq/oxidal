import { expect, it } from 'vitest';

import type { RigDocument } from './api';
import { applySceneBypass, type SceneBypass } from './sceneBypass';
import { SCENES_V3, scenesFormat } from './sceneFormat';

type Manifest = RigDocument['manifest'];
const manifest = () =>
  ({
    oxidal: {
      graph: {
        nodes: [
          { id: 'capture', kind: 'tone3000', bypassed: true },
          { id: 'effect', kind: 'lv2', bypassed: false },
          { id: 'join', kind: 'merge' },
        ],
      },
    },
  }) as unknown as Manifest;

it('materializes every target from the saved preset and keeps an explicit false', () => {
  const original = manifest();
  const live = structuredClone(original);
  live.oxidal!.graph.nodes[0]!.bypassed = false;
  const scenes: { id: string; bypass?: SceneBypass[] }[] = [
    { id: 'a' },
    { id: 'b' },
  ];
  applySceneBypass(
    original,
    live,
    scenes,
    {
      a: [
        { node: 'capture', value: false },
        { node: 'effect', value: true },
      ],
    },
    'a',
  );
  expect(scenes.map((s) => s.bypass)).toEqual([
    [
      { node: 'capture', value: false },
      { node: 'effect', value: true },
    ],
    [
      { node: 'capture', value: true },
      { node: 'effect', value: false },
    ],
  ]);
  expect(live.oxidal!.graph.nodes.map((n) => n.bypassed)).toEqual([
    false,
    true,
    undefined,
  ]);
  expect(original.oxidal!.graph.nodes[0]!.bypassed).toBe(true);
  expect(scenesFormat({ scenes })).toBe(SCENES_V3);
});

it('retains another scene’s explicit bypass when adding a target', () => {
  const original = manifest();
  const scenes = [
    { id: 'a', bypass: [{ node: 'capture', value: false }] },
    { id: 'b', bypass: [{ node: 'capture', value: true }] },
  ];
  applySceneBypass(
    original,
    structuredClone(original),
    scenes,
    { a: [{ node: 'effect', value: true }] },
    undefined,
  );
  expect(scenes[0]!.bypass).toEqual([
    { node: 'capture', value: false },
    { node: 'effect', value: true },
  ]);
  expect(scenes[1]!.bypass).toEqual([
    { node: 'capture', value: true },
    { node: 'effect', value: false },
  ]);
});

const badDrafts: Record<string, SceneBypass[]>[] = [
  { a: [{ node: 'missing', value: true }] },
  { a: [{ node: 'join', value: true }] },
  { absent: [{ node: 'effect', value: true }] },
  {
    a: [
      { node: 'effect', value: true },
      { node: 'effect', value: false },
    ],
  },
];
it.each(badDrafts)(
  'refuses invalid bypass drafts before changing any scene',
  (draft) => {
    const original = manifest();
    const next = structuredClone(original);
    const scenes = [{ id: 'a' }, { id: 'b' }];
    expect(() =>
      applySceneBypass(original, next, scenes, draft, 'a'),
    ).toThrow();
    expect(scenes).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(next).toEqual(original);
  },
);
