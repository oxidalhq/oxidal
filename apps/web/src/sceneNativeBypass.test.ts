import { expect, it } from 'vitest';

import type { RigDocument } from './api';
import type { SceneNativeBypass } from './generated/contract';
import { SCENES_V5, scenesFormat } from './sceneFormat';
import { applyNativeSceneBypass, nativeBypassKey } from './sceneNativeBypass';
const manifest = {
  oxidal: {
    graph: {
      nodes: [
        { id: 'capture', kind: 'tone3000' },
        { id: 'fx', kind: 'lv2' },
      ],
    },
  },
} as unknown as RigDocument['manifest'];
type Definition = {
  scenes: {
    id: string;
    native_bypass?: SceneNativeBypass[];
    bypass?: { node: string }[];
  }[];
  initial_scene?: string;
};
const baseline = { node: 'capture', block: 'nam:pedal', value: true };
it('fills other scenes from saved disabled state and preserves explicit false and exact identities', () => {
  const definition: Definition = { scenes: [{ id: 'clean' }, { id: 'lead' }] };
  applyNativeSceneBypass(
    manifest,
    definition,
    { lead: [{ ...baseline, value: false }] },
    [baseline],
    'lead',
  );
  expect(definition.scenes.map((scene) => scene.native_bypass)).toEqual([
    [baseline],
    [{ ...baseline, value: false }],
  ]);
  expect(definition.initial_scene).toBe('lead');
  expect(scenesFormat(definition)).toBe(SCENES_V5);
  expect(nativeBypassKey({ node: 'a:b', block: 'c' })).not.toBe(
    nativeBypassKey({ node: 'a', block: 'b:c' }),
  );
});
it('refuses unknown saved defaults instead of using a currently playing value, without partial edits', () => {
  const definition: Definition = { scenes: [{ id: 'clean' }, { id: 'lead' }] };
  expect(() =>
    applyNativeSceneBypass(manifest, definition, { lead: [baseline] }, []),
  ).toThrow(/Saved capture block states/);
  expect(definition).toEqual({ scenes: [{ id: 'clean' }, { id: 'lead' }] });
});
it('preserves existing complete scene values when baseline metadata is absent', () => {
  const definition: Definition = {
    scenes: [
      { id: 'a', native_bypass: [baseline] },
      { id: 'b', native_bypass: [{ ...baseline, value: false }] },
    ],
  };
  applyNativeSceneBypass(manifest, definition, {}, []);
  expect(definition.scenes[1]!.native_bypass![0]!.value).toBe(false);
});
it('rejects duplicates, foreign/display-only targets, byte limits and combined outer/inner overflow', () => {
  for (const rows of [
    [baseline, baseline],
    [{ ...baseline, node: 'fx' }],
    [{ ...baseline, block: 'é'.repeat(65) }],
  ]) {
    const definition: Definition = { scenes: [{ id: 'a' }] };
    expect(() =>
      applyNativeSceneBypass(manifest, definition, { a: rows }, rows),
    ).toThrow();
    expect(definition.scenes[0]!.native_bypass).toBeUndefined();
  }
  const definition: Definition = {
    scenes: [
      {
        id: 'a',
        bypass: Array.from({ length: 128 }, (_, i) => ({ node: String(i) })),
      },
    ],
  };
  expect(() =>
    applyNativeSceneBypass(manifest, definition, { a: [baseline] }, [baseline]),
  ).toThrow(/128/);
});
