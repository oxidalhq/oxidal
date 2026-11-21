import { expect, it } from 'vitest';

import type { Lv2Plugin, RigDocument } from './api';
import type { Scenes, VersionTarget } from './generated/contract';
import {
  planSceneBlockCopy,
  publishSceneBlockCopy,
  sceneBlockChoices,
} from './sceneBlockCopy';
import { readScenes, SCENES_V5 } from './sceneFormat';

const revision = 'a'.repeat(64);
const version: VersionTarget = {
  first: revision,
  expected_content: revision,
  expected_revision: 'b'.repeat(64),
  version: 'main',
  request_id: 'copy-eq-fixture',
};
const selection = {
  sourceBlock: 'lead-eq',
  destinationBlock: 'dirt-eq',
  destinationScene: 'dirt',
};
const eq: Lv2Plugin = {
  uri: 'urn:fixture:eq',
  name: 'EQ',
  ports: [
    {
      index: 0,
      symbol: 'mid_gain',
      name: 'Mid gain',
      unit: 'dB',
      minimum: -20,
      maximum: 20,
      audio: false,
      input: true,
      output: false,
      control: true,
      integer: false,
      logarithmic: false,
      toggled: false,
      latency: false,
    },
  ],
};

function document(): RigDocument {
  const scene = (
    id: string,
    gain: number,
    bypass: boolean,
    capture: number,
  ) => ({
    id,
    name: id,
    gains: [{ node: 'level', port: 0, value: gain }],
    controls: [
      { node: 'lead-eq', symbol: 'mid_gain', value: id === 'lead' ? 5 : -3 },
    ],
    bypass: [{ node: 'dirt-eq', value: bypass }],
    native_controls: [
      { node: 'capture', parameter: 'block:dirt:mix', value: capture },
    ],
    native_bypass: [{ node: 'capture', block: 'dirt', value: bypass }],
  });
  return {
    revision,
    manifest: {
      id: 'ef684491-712e-4f76-9be6-3da261ec79c0',
      name: 'Example rig',
      format: 'oxidal.preset',
      formatVersion: 1,
      tone3000: {
        instances: [{ id: 'capture', preset: 'data', profile: 'fixture' }],
      },
      resources: [
        {
          id: 'data',
          kind: 'tone3000-preset',
          path: 'data',
          bytes: 10,
          sha256: 'c'.repeat(64),
        },
      ],
      extensions: {
        'urn:oxidal:authoring': { origin: 'mine' },
        [SCENES_V5]: {
          fade_ms: 10,
          initial_scene: 'lead',
          scenes: [scene('lead', 1, false, 0.5), scene('dirt', 0.6, true, 0.7)],
        },
      },
      requiredExtensions: [SCENES_V5],
      oxidal: {
        graph: {
          nodes: [
            {
              id: 'lead-eq',
              kind: 'lv2',
              audioInputs: 1,
              audioOutputs: 1,
              instance: 'lead-instance',
            },
            {
              id: 'dirt-eq',
              kind: 'lv2',
              audioInputs: 1,
              audioOutputs: 1,
              instance: 'dirt-instance',
              bypassed: false,
            },
            {
              id: 'capture',
              kind: 'tone3000',
              audioInputs: 1,
              audioOutputs: 1,
              instance: 'capture',
            },
            {
              id: 'level',
              kind: 'gain',
              audioInputs: 1,
              audioOutputs: 1,
              inputGains: [1],
            },
          ],
          edges: [],
        },
        lv2: [
          {
            id: 'lead-instance',
            pluginUri: eq.uri,
            controls: { mid_gain: 0 },
            assets: [],
            requiredFeatures: [],
          },
          {
            id: 'dirt-instance',
            pluginUri: eq.uri,
            controls: { mid_gain: -2 },
            assets: [],
            requiredFeatures: [],
          },
        ],
        recall: { tails: 'cut' },
      },
    },
  };
}

it('copies only an EQ port to another stable graph node and keeps destination sound resources and mix', () => {
  const opened = document();
  const original = structuredClone(opened.manifest);
  const plan = planSceneBlockCopy(opened, 'lead', selection, [eq]);
  expect(plan).toMatchObject({
    rows: [{ label: 'Mid gain', before: '-2 dB', after: '5 dB' }],
  });
  if ('refusal' in plan) throw new Error(plan.refusal);
  const request = publishSceneBlockCopy(opened, plan, version);
  expect(request).toMatchObject({
    version_target: version,
    source: { kind: 'rig', id: revision },
    resources: { data: { kind: 'bundle', revision, resource: 'data' } },
  });
  const saved = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(opened.manifest).toEqual(original);
  expect(saved.oxidal).toEqual(original.oxidal);
  expect(saved.tone3000).toEqual(original.tone3000);
  expect(saved.resources).toEqual(original.resources);
  const before = readScenes<Scenes>(original)!;
  const after = readScenes<Scenes>(saved)!;
  expect(after.initial_scene).toBe(before.initial_scene);
  expect(after.scenes[0]).toEqual({
    ...before.scenes[0],
    controls: [
      ...before.scenes[0]!.controls!,
      { node: 'dirt-eq', symbol: 'mid_gain', value: -2 },
    ],
  });
  expect(after.scenes[1]).toEqual({
    ...before.scenes[1],
    controls: [
      ...before.scenes[1]!.controls!,
      { node: 'dirt-eq', symbol: 'mid_gain', value: 5 },
    ],
  });
  expect(() =>
    publishSceneBlockCopy(opened, plan, {
      ...version,
      expected_content: 'c'.repeat(64),
    }),
  ).toThrow(/destination changed/);
});

it('only offers saved source blocks and refuses incompatible blocks or missing ports', () => {
  const opened = document();
  expect(
    sceneBlockChoices(opened, 'lead').sourceBlocks.map((block) => block.id),
  ).toEqual(['lead-eq']);
  expect(
    planSceneBlockCopy(
      opened,
      'lead',
      { ...selection, destinationBlock: 'capture' },
      [eq],
    ),
  ).toMatchObject({
    refusal: expect.stringContaining('same effect plugin'),
  });
  expect(
    planSceneBlockCopy(opened, 'lead', selection, [{ ...eq, ports: [] }]),
  ).toMatchObject({
    refusal: expect.stringContaining('unavailable as a scene setting'),
  });
  expect(
    planSceneBlockCopy(
      opened,
      'lead',
      { ...selection, destinationBlock: 'lead-eq' },
      [eq],
    ),
  ).toMatchObject({
    controls: [{ node: 'lead-eq', symbol: 'mid_gain', value: 5 }],
  });
});
