import { expect, it } from 'vitest';

import type { RigDocument } from './api';
import { SCENES_V4, scenesFormat } from './sceneFormat';
import {
  applyNativeSceneControls,
  type NativeScene,
  nativeSceneKey,
} from './sceneNative';

const manifest = {
  oxidal: {
    graph: {
      nodes: [
        { id: 'amp', kind: 'tone3000' },
        { id: 'fx', kind: 'lv2' },
      ],
    },
  },
} as unknown as RigDocument['manifest'];
const saved = {
  node: 'amp',
  parameter: 'block:capture:inputGain',
  value: 0.25,
};

it('keeps compound node and inner-block identities separate', () => {
  const first = { node: 'amp', parameter: 'block:x:block:y:mix', value: 0.2 };
  const second = { node: 'amp:block:x', parameter: 'block:y:mix', value: 0.8 };
  expect(nativeSceneKey(first)).not.toBe(nativeSceneKey(second));
  const graph = structuredClone(manifest);
  graph.oxidal!.graph.nodes.push({
    ...graph.oxidal!.graph.nodes[0]!,
    id: second.node,
  });
  const definition = { scenes: [{ id: 'clean' } as NativeScene] };
  applyNativeSceneControls(graph, definition, { clean: [first, second] }, []);
  expect(definition.scenes[0]!.native_controls).toEqual([first, second]);
});

it('uses immutable saved capture defaults for other scenes and keeps native zero values', () => {
  const definition: { scenes: NativeScene[]; initial_scene?: string } = {
    scenes: [{ id: 'clean' }, { id: 'lead' }],
  };
  applyNativeSceneControls(
    manifest,
    definition,
    { lead: [{ ...saved, value: 0 }] },
    [saved],
    'lead',
  );
  expect(definition.scenes.map((s) => s.native_controls)).toEqual([
    [saved],
    [{ ...saved, value: 0 }],
  ]);
  expect(definition.initial_scene).toBe('lead');
  expect(scenesFormat(definition)).toBe(SCENES_V4);
});

it('preserves complete saved scene values when baseline metadata is unavailable', () => {
  const definition = {
    scenes: [
      { id: 'clean', native_controls: [saved] },
      { id: 'lead', native_controls: [{ ...saved, value: 0.75 }] },
    ],
  };
  applyNativeSceneControls(
    manifest,
    definition,
    { lead: [{ ...saved, value: 0.5 }] },
    [],
  );
  expect(definition.scenes.map((s) => s.native_controls[0]!.value)).toEqual([
    0.25, 0.5,
  ]);
});

it('refuses an unknown baseline before changing any scene or its starting pointer', () => {
  const definition = {
    scenes: [{ id: 'clean' }, { id: 'lead' }],
    initial_scene: 'clean',
  };
  expect(() =>
    applyNativeSceneControls(
      manifest,
      definition,
      { lead: [{ ...saved, value: 0.9 }] },
      [],
      'lead',
    ),
  ).toThrow('Saved capture values');
  expect(definition).toEqual({
    scenes: [{ id: 'clean' }, { id: 'lead' }],
    initial_scene: 'clean',
  });
});

it.each([
  { ...saved, node: 'fx' },
  { ...saved, parameter: 'block:capture:normalize' },
  { ...saved, parameter: 'inputLevel' },
  { ...saved, value: 1.1 },
  { ...saved, value: NaN },
])('rejects unsupported targets and values without mutation', (control) => {
  const definition = { scenes: [{ id: 'clean' }, { id: 'lead' }] };
  expect(() =>
    applyNativeSceneControls(manifest, definition, { lead: [control] }, [
      saved,
    ]),
  ).toThrow();
  expect(definition).toEqual({ scenes: [{ id: 'clean' }, { id: 'lead' }] });
});

it('bounds native and LV2 settings together', () => {
  const definition = {
    scenes: [
      { id: 'clean', controls: Array.from({ length: 32 }, (_, i) => i) },
    ],
  };
  expect(() =>
    applyNativeSceneControls(manifest, definition, { clean: [saved] }, [saved]),
  ).toThrow('at most 32');
});
