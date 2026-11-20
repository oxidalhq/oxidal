/**
 * Saved scenes require exactly the version that carries their sonic fields.
 * @see docs/presets/format.md
 */
import { expect, it } from 'vitest';

import type { RigDocument } from './api';
import {
  readScenes,
  SCENES_V1,
  SCENES_V2,
  SCENES_V3,
  SCENES_V4,
  SCENES_V5,
  scenesFormat,
  scenesKey,
  sealScenes,
  writeScenes,
} from './sceneFormat';

type Manifest = RigDocument['manifest'];
const gains = [{ node: 'merge', port: 0, value: 1 }];
const plain = { fade_ms: 10, scenes: [{ id: 'a', name: 'A', gains }] };
const controlled = {
  fade_ms: 10,
  scenes: [
    {
      id: 'a',
      name: 'A',
      gains,
      controls: [{ node: 'fx', symbol: 'time', value: 0.5 }],
    },
  ],
};
const bypassed = {
  ...plain,
  scenes: plain.scenes.map((s) => ({
    ...s,
    bypass: [{ node: 'capture', value: true }],
  })),
};

it('requires version 3 for bypass and preserves it through sealing and replacement', () => {
  const document = manifest(SCENES_V2, controlled);
  writeScenes(document, bypassed);
  expect(scenesKey(document)).toBe(SCENES_V3);
  expect(document.requiredExtensions).toEqual([SCENES_V3, 'urn:oxidal:gain:1']);
  expect(sealScenes(document)).toEqual(document);
  expect(readScenes(document)).toEqual(bypassed);
  writeScenes(document, controlled);
  expect(scenesKey(document)).toBe(SCENES_V2);
  expect(document.extensions[SCENES_V3]).toBeUndefined();
});
const manifest = (key: string, scenes: unknown): Manifest =>
  ({
    extensions: { 'urn:oxidal:authoring': {}, [key]: scenes },
    requiredExtensions: [key, 'urn:oxidal:gain:1'],
  }) as unknown as Manifest;

it('preserves capture values and starting scene through serialization and upgrades', () => {
  const captured = {
    ...bypassed,
    initial_scene: 'a',
    scenes: bypassed.scenes.map((s) => ({
      ...s,
      native_controls: [
        { node: 'capture', parameter: 'block:amp:outputGain', value: 0 },
      ],
    })),
  };
  const document = manifest(SCENES_V3, bypassed);
  writeScenes(document, captured);
  const reopened = JSON.parse(JSON.stringify(document)) as Manifest;
  expect(reopened.requiredExtensions).toEqual([SCENES_V4, 'urn:oxidal:gain:1']);
  expect(readScenes(sealScenes(reopened))).toEqual(captured);
  expect(reopened.extensions[SCENES_V3]).toBeUndefined();
  writeScenes(reopened, undefined);
  expect(scenesKey(reopened)).toBeUndefined();
  expect(reopened.requiredExtensions).toEqual(['urn:oxidal:gain:1']);
});

it('chooses version 2 only for scenes that set effect settings', () => {
  expect(scenesFormat(plain)).toBe(SCENES_V1);
  expect(scenesFormat(controlled)).toBe(SCENES_V2);
  expect(
    scenesFormat({ scenes: [{ id: 'a', name: 'A', gains, controls: [] }] }),
  ).toBe(SCENES_V1);
});

it('reads either version, and nothing when there are no scenes', () => {
  expect(readScenes(manifest(SCENES_V1, plain))).toEqual(plain);
  expect(readScenes(manifest(SCENES_V2, controlled))).toEqual(controlled);
  expect(scenesKey(manifest(SCENES_V2, controlled))).toBe(SCENES_V2);
  const none = manifest('urn:oxidal:other:1', {});
  expect(readScenes(none)).toBeUndefined();
  expect(scenesKey(none)).toBeUndefined();
});

it('writes the version the scenes need and keeps the required list in order', () => {
  // A version 1 preset that gains a setting moves to version 2 in place.
  const legacy = manifest(SCENES_V1, controlled);
  sealScenes(legacy);
  expect(legacy.extensions[SCENES_V1]).toBeUndefined();
  expect(legacy.extensions[SCENES_V2]).toEqual(controlled);
  expect(legacy.requiredExtensions).toEqual([SCENES_V2, 'urn:oxidal:gain:1']);
  // Removing the last setting goes back to version 1.
  writeScenes(legacy, plain);
  expect(legacy.extensions[SCENES_V2]).toBeUndefined();
  expect(legacy.extensions[SCENES_V1]).toEqual(plain);
  expect(legacy.requiredExtensions).toEqual([SCENES_V1, 'urn:oxidal:gain:1']);
  // An unchanged version 1 preset is left exactly as it was.
  const same = manifest(SCENES_V1, plain);
  const before = JSON.stringify(same);
  expect(JSON.stringify(sealScenes(same))).toBe(before);
  // A preset without scenes gains them at the end of the list.
  const fresh = {
    extensions: {},
    requiredExtensions: ['urn:oxidal:gain:1'],
  } as unknown as Manifest;
  writeScenes(fresh, controlled);
  expect(fresh.requiredExtensions).toEqual(['urn:oxidal:gain:1', SCENES_V2]);
  // Writing no scenes removes them.
  writeScenes(fresh, undefined);
  expect(fresh.extensions).toEqual({});
  expect(fresh.requiredExtensions).toEqual(['urn:oxidal:gain:1']);
});

it('requires v5 for inner block switches and preserves exact rows through reopen and sealing', () => {
  const inner = {
    ...bypassed,
    initial_scene: 'a',
    scenes: bypassed.scenes.map((scene) => ({
      ...scene,
      native_bypass: [{ node: 'capture', block: 'pedal:1', value: false }],
    })),
  };
  const document = manifest(SCENES_V4, bypassed);
  writeScenes(document, inner);
  const reopened = JSON.parse(JSON.stringify(document)) as Manifest;
  expect(reopened.requiredExtensions).toEqual([SCENES_V5, 'urn:oxidal:gain:1']);
  expect(readScenes(sealScenes(reopened))).toEqual(inner);
  expect(reopened.extensions[SCENES_V4]).toBeUndefined();
});
