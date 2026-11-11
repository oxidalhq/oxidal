import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import type { Lv2Plugin, Preset, RigDocument } from './api';
import { lv2Effect, sceneRig, type NativeDraft } from './rigDraft';
import {
  LAST_SCENE,
  addSceneEffect,
  branchEffects,
  copySceneTo,
  deleteScene,
  duplicateScene,
  keepScenes,
  moveScene,
  removeSceneEffect,
  renameScene,
  sceneCopyPlan,
  updateScene,
  updateScenes,
} from './sceneEdit';

const validator = new Ajv({ strict: false }).compile(schema);
const port = (index: number, symbol: string, input: boolean, audio: boolean) =>
  ({
    index,
    symbol,
    input,
    output: !input,
    audio,
    control: !audio,
    integer: false,
    toggled: false,
    logarithmic: false,
    latency: false,
    ...(audio ? {} : { default: 0, minimum: -90, maximum: 24 }),
  }) as Lv2Plugin['ports'][number];
const mono: Lv2Plugin = {
  name: 'Mono gain',
  uri: 'urn:example:mono',
  unsupported: null,
  ports: [
    port(0, 'in', true, true),
    port(1, 'out', false, true),
    port(2, 'gain', true, false),
  ],
};
const stereo: Lv2Plugin = {
  name: 'Stereo hold',
  uri: 'urn:example:stereo',
  unsupported: null,
  ports: [
    port(0, 'in_l', true, true),
    port(1, 'in_r', true, true),
    port(2, 'out_l', false, true),
    port(3, 'out_r', false, true),
    port(4, 'level', true, false),
  ],
};
const preset: Preset = {
  sha256: 'a'.repeat(64),
  name: 'Tone',
  size_bytes: 100,
  framing: 'current',
  block_count: 0,
  embedded_bytes: 0,
  parameter_count: 0,
  playback_available: false,
};
const tone = (id: string, name: string): NativeDraft => ({
  id,
  kind: 'native',
  name,
  preset,
  source: { kind: 'original', preset: preset.sha256 },
});
const revision = 'r'.repeat(64);
function scenes(): RigDocument {
  const published = sceneRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Scenes',
    [tone('crunch', 'Crunch'), tone('fuzz', 'Fuzz')],
    'tone3000-plugin:' + 'a'.repeat(40),
    'preserve',
  );
  return {
    revision,
    manifest: JSON.parse(published.manifest_json),
  } as RigDocument;
}
const into = (manifest: RigDocument['manifest'], sum: string, port: number) =>
  manifest.oxidal!.graph.edges.find(
    (e) => e.to.node === sum && e.to.port === port,
  )!;

it('puts an effect after one scene only, keeping the scenes and the TONE3000 resources', () => {
  const document = scenes();
  const request = addSceneEffect(document, 'fuzz', lv2Effect(stereo));
  const manifest = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  const [effect] = manifest.oxidal!.lv2;
  expect(branchEffects(manifest.oxidal!.graph, 'fuzz')).toEqual([effect!.id]);
  expect(branchEffects(manifest.oxidal!.graph, 'crunch')).toEqual([]);
  // The fuzz branch now reaches the scene sums through the effect; crunch is as it was.
  expect(into(manifest, 'scene-left', 1).from.node).toBe(effect!.id);
  expect(into(manifest, 'scene-right', 1).from.node).toBe(effect!.id);
  expect(into(manifest, 'scene-left', 0).from.node).toBe('crunch');
  expect(manifest.extensions['urn:oxidal:scenes:1']).toEqual(
    document.manifest.extensions['urn:oxidal:scenes:1'],
  );
  expect(request.resources).toEqual({
    'preset-0': { kind: 'bundle', revision, resource: 'preset-0' },
  });
  // The original is untouched.
  expect(document.manifest.oxidal!.lv2).toHaveLength(0);
});

it('keeps live knob values and puts several effects in order', () => {
  const first = lv2Effect(stereo);
  const one = addSceneEffect(scenes(), 'crunch', first);
  const document = {
    revision,
    manifest: JSON.parse(one.manifest_json),
  } as RigDocument;
  const id = document.manifest.oxidal!.lv2[0]!.id;
  const two = addSceneEffect(document, 'crunch', lv2Effect(mono), {
    [id]: { level: 3 },
  });
  const manifest = JSON.parse(two.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.oxidal!.lv2[0]!.controls.level).toBe(3);
  const order = branchEffects(manifest.oxidal!.graph, 'crunch');
  expect(order).toHaveLength(2);
  expect(order[0]).toBe(id);
});

it('removes an effect and its mono adapters, joining the branch back up', () => {
  const effect = lv2Effect(mono);
  const added = addSceneEffect(scenes(), 'fuzz', effect);
  const document = {
    revision,
    manifest: JSON.parse(added.manifest_json),
  } as RigDocument;
  expect(
    document.manifest.oxidal!.graph.nodes.some(
      (n) => n.id === `${effect.id}-mono`,
    ),
  ).toBe(true);
  const removed = removeSceneEffect(document, effect.id);
  const manifest = JSON.parse(removed.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.oxidal!.lv2).toHaveLength(0);
  expect(
    manifest.oxidal!.graph.nodes.some((n) => n.id.startsWith(effect.id)),
  ).toBe(false);
  expect(into(manifest, 'scene-left', 1)).toEqual(
    into(scenes().manifest as RigDocument['manifest'], 'scene-left', 1),
  );
  expect(into(manifest, 'scene-right', 1).from).toEqual({
    node: 'fuzz',
    port: 1,
  });
  expect(
    manifest.extensions['urn:oxidal:authoring']!.labels,
  ).not.toHaveProperty(effect.id);
});

it('refuses a node that is not a scene', () => {
  expect(() => addSceneEffect(scenes(), 'missing', lv2Effect(stereo))).toThrow(
    'cannot take an effect',
  );
});

it('updates one scene from the live mix and reopens on that routing', () => {
  const document = scenes();
  const extension = document.manifest.extensions['urn:oxidal:scenes:1'] as {
    scenes: {
      id: string;
      gains: { node: string; port: number; value: number }[];
    }[];
  };
  const scene = extension.scenes[1]!;
  const changed = scene.gains.map((gain) => ({
    ...gain,
    value: gain.value ? 0.25 : 0.75,
  }));
  const request = updateScene(document, scene.id, changed);
  const manifest = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  const next = manifest.extensions['urn:oxidal:scenes:1'] as typeof extension;
  expect(next.scenes[1]!.gains).toEqual(changed);
  expect(next.scenes[0]).toEqual(extension.scenes[0]);
  for (const gain of changed)
    expect(
      manifest.oxidal!.graph.nodes.find((node) => node.id === gain.node)!
        .inputGains![gain.port],
    ).toBe(gain.value);
  expect(document.manifest.extensions['urn:oxidal:scenes:1']).toEqual(
    extension,
  );
});

it('saves several drafted scenes and starts only on the named one', () => {
  const document = scenes();
  type Extension = {
    scenes: {
      id: string;
      gains: { node: string; port: number; value: number }[];
    }[];
  };
  const extension = document.manifest.extensions[
    'urn:oxidal:scenes:1'
  ] as Extension;
  const [a, b] = extension.scenes;
  const draft = (scene: typeof a) =>
    scene!.gains.map((gain) => ({ ...gain, value: 0.5 }));
  const before = new Map(
    document.manifest.oxidal!.graph.nodes.map((n) => [
      n.id,
      [...(n.inputGains ?? [])],
    ]),
  );
  const request = updateScenes(
    document,
    { [a!.id]: draft(a), [b!.id]: draft(b) },
    undefined,
  );
  const manifest = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  const next = manifest.extensions['urn:oxidal:scenes:1'] as Extension;
  expect(next.scenes[0]!.gains).toEqual(draft(a));
  expect(next.scenes[1]!.gains).toEqual(draft(b));
  for (const node of manifest.oxidal!.graph.nodes)
    expect(node.inputGains ?? []).toEqual(before.get(node.id));
  expect(() => updateScenes(document, {}, undefined)).toThrow(
    'no scene updates',
  );
});

it('saves a new scene from the live mix with its own id, beside the others', () => {
  const document = scenes();
  const extension = document.manifest.extensions['urn:oxidal:scenes:1'] as {
    scenes: {
      id: string;
      name: string;
      gains: { node: string; port: number; value: number }[];
    }[];
  };
  const gains = extension.scenes[0]!.gains.map((g) => ({ ...g, value: 0.5 }));
  const request = updateScenes(document, {}, undefined, {}, undefined, [
    { id: 'scene-new', name: '  Lead + clean ', gains },
  ]);
  const manifest = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  const next = manifest.extensions['urn:oxidal:scenes:1'] as typeof extension;
  expect(next.scenes.map((s) => s.id)).toEqual([
    ...extension.scenes.map((s) => s.id),
    'scene-new',
  ]);
  expect(next.scenes.at(-1)).toEqual({
    id: 'scene-new',
    name: 'Lead + clean',
    gains,
  });
  expect(() =>
    updateScenes(document, {}, undefined, {}, undefined, [
      { id: extension.scenes[0]!.id, name: 'x', gains },
    ]),
  ).toThrow('already exists');
  expect(() =>
    updateScenes(document, {}, undefined, {}, undefined, [
      { id: 'scene-x', name: ' ', gains },
    ]),
  ).toThrow('name');
});

type Ext = {
  fade_ms: number;
  scenes: {
    id: string;
    name: string;
    gains: { node: string; port: number; value: number }[];
    controls?: { node: string; symbol: string; value: number }[];
  }[];
};
/** A preset with one effect and a gain the scenes switch. */
function lv2Scenes(
  name = 'Lead',
  effects = ['echo'],
  controls?: Record<string, number>,
): RigDocument {
  const chain = ['in', ...effects, 'scene-gain', 'out'];
  return {
    revision: `${name.toLowerCase()}`.padEnd(64, '0'),
    manifest: {
      format: 'oxidal.preset',
      formatVersion: 1,
      id: '4b6c6a52-0d4e-4c55-9d5a-7f0e3f1a2b3c',
      name,
      tone3000: { instances: [] },
      oxidal: {
        graph: {
          nodes: [
            { id: 'in', kind: 'input', audioInputs: 0, audioOutputs: 1 },
            ...effects.map((id) => ({
              id,
              kind: 'lv2' as const,
              instance: id,
              audioInputs: 1,
              audioOutputs: 1,
            })),
            {
              id: 'scene-gain',
              kind: 'gain',
              audioInputs: 1,
              audioOutputs: 1,
              inputGains: [1],
            },
            { id: 'out', kind: 'output', audioInputs: 1, audioOutputs: 0 },
          ],
          edges: chain.slice(1).map((to, i) => ({
            from: { node: chain[i]!, port: 0 },
            to: { node: to, port: 0 },
          })),
        },
        lv2: effects.map((id) => ({
          id,
          pluginUri: 'urn:example:mono',
          controls: { gain: 0, ...controls },
          assets: [],
          requiredFeatures: [],
        })),
        recall: { tails: 'cut' },
      },
      resources: [],
      extensions: {
        'urn:oxidal:gain:1': {},
        'urn:oxidal:authoring': { labels: { echo: 'Echo' } },
        'urn:oxidal:scenes:1': {
          fade_ms: 10,
          scenes: [
            {
              id: 'clean',
              name: 'Clean',
              gains: [{ node: 'scene-gain', port: 0, value: 1 }],
            },
            {
              id: 'lead',
              name: 'Lead',
              gains: [{ node: 'scene-gain', port: 0, value: 0.5 }],
            },
          ],
        },
      },
      requiredExtensions: ['urn:oxidal:gain:1', 'urn:oxidal:scenes:1'],
    },
  } as unknown as RigDocument;
}
const extOf = (request: { manifest_json: string }) =>
  JSON.parse(request.manifest_json).extensions['urn:oxidal:scenes:1'] as Ext;

it('renames, moves, duplicates and deletes scenes by id (S-12, S-13)', () => {
  const document = lv2Scenes();
  const renamed = extOf(renameScene(document, 'lead', '  Solo '));
  expect(renamed.scenes.map((s) => [s.id, s.name])).toEqual([
    ['clean', 'Clean'],
    ['lead', 'Solo'],
  ]);
  // Moving keeps each scene's id, so MIDI bindings follow the scene.
  const moved = extOf(moveScene(document, 'lead', -1));
  expect(moved.scenes.map((s) => s.id)).toEqual(['lead', 'clean']);
  expect(() => moveScene(document, 'lead', 1)).toThrow('already the last');
  const { publish, id } = duplicateScene(document, 'clean');
  const duplicated = extOf(publish);
  expect(duplicated.scenes.map((s) => s.name)).toEqual([
    'Clean',
    'Clean copy',
    'Lead',
  ]);
  expect(duplicated.scenes[1]!.id).toBe(id);
  expect(duplicated.scenes[1]!.gains).toEqual(duplicated.scenes[0]!.gains);
  // Deleting the playing scene reopens on its neighbour's mix.
  const deleted = JSON.parse(
    deleteScene(document, 'clean', 'clean').manifest_json,
  );
  expect(
    deleted.extensions['urn:oxidal:scenes:1'].scenes.map(
      (s: { id: string }) => s.id,
    ),
  ).toEqual(['lead']);
  expect(
    deleted.oxidal.graph.nodes.find(
      (n: { id: string }) => n.id === 'scene-gain',
    ).inputGains,
  ).toEqual([0.5]);
  const single = JSON.parse(
    deleteScene(document, 'clean', undefined).manifest_json,
  );
  expect(() =>
    deleteScene(
      { revision: document.revision, manifest: single },
      'lead',
      undefined,
    ),
  ).toThrow(LAST_SCENE);
});

it('Copy to preset copies exactly with the same blocks and lists what is skipped otherwise (S-11)', () => {
  const lead = lv2Scenes('Lead');
  const twin = lv2Scenes('Twin');
  expect(sceneCopyPlan(lead, 'lead', twin)).toEqual({
    exact: true,
    skipped: [],
    kept: [],
  });
  const request = copySceneTo(lead, 'lead', twin);
  expect(request.source).toEqual({ kind: 'rig', id: twin.revision });
  const copied = extOf(request);
  expect(copied.scenes.at(-1)!.name).toBe('Lead');
  expect(copied.scenes.at(-1)!.gains).toEqual([
    { node: 'scene-gain', port: 0, value: 0.5 },
  ]);
  expect(copied.scenes.at(-1)!.id).not.toBe('lead');
  // The source scene sets the echo's level; Crunch has no echo.
  const withControls = JSON.parse(
    updateScenes(lead, {}, 'lead', {}, undefined, [], {
      lead: [{ node: 'echo', symbol: 'gain', value: -6 }],
    }).manifest_json,
  );
  const source = { revision: lead.revision, manifest: withControls };
  const crunch = lv2Scenes('Crunch', []);
  const plan = sceneCopyPlan(source, 'lead', crunch);
  expect(plan.exact).toBe(false);
  expect(plan.skipped).toEqual([
    "Crunch has no 'Echo' block: its gain setting is skipped.",
  ]);
  const into = extOf(copySceneTo(source, 'lead', crunch));
  expect(into.scenes.at(-1)!.controls).toBeUndefined();
  expect(into.scenes.at(-1)!.gains[0]!.value).toBe(0.5);
});

it('scene controls: every scene carries the same set, added scenes too, and the start scene sets the effect (D-6)', () => {
  const document = lv2Scenes('Lead', ['echo'], { gain: -3 });
  const request = updateScenes(
    document,
    {},
    'lead',
    { echo: { gain: 2 } },
    undefined,
    [
      {
        id: 'scene-new',
        name: 'Wash',
        gains: [{ node: 'scene-gain', port: 0, value: 0.25 }],
      },
    ],
    { lead: [{ node: 'echo', symbol: 'gain', value: 4 }] },
  );
  const manifest = JSON.parse(request.manifest_json);
  const scenes = (manifest.extensions['urn:oxidal:scenes:1'] as Ext).scenes;
  expect(scenes.map((s) => s.controls)).toEqual([
    [{ node: 'echo', symbol: 'gain', value: -3 }],
    [{ node: 'echo', symbol: 'gain', value: 4 }],
    [{ node: 'echo', symbol: 'gain', value: -3 }],
  ]);
  expect(manifest.oxidal.lv2[0].controls.gain).toBe(4);
  // A chain rebuild without the echo drops its scene settings.
  const rebuilt = keepScenes(
    { revision: document.revision, manifest },
    {
      manifest_json: JSON.stringify(lv2Scenes('Lead', []).manifest),
      resources: {},
    },
  );
  const kept = extOf(rebuilt);
  expect(kept.scenes.every((s) => s.controls === undefined)).toBe(true);
});
