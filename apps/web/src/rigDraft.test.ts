import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import {
  lv2Effect,
  serialRig,
  parallelRig,
  sceneRig,
  splitNative,
  removeEffect,
  canMoveEffect,
  type NativeDraft,
} from './rigDraft';
import type { Lv2Plugin, Preset } from './api';
const validator = new Ajv({ strict: false }).compile(schema);
const mono: Lv2Plugin = {
  name: 'Mono gain',
  uri: 'urn:example:mono',
  unsupported: null,
  ports: [
    {
      index: 0,
      symbol: 'in',
      input: true,
      output: false,
      audio: true,
      control: false,
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
    },
    {
      index: 1,
      symbol: 'out',
      input: false,
      output: true,
      audio: true,
      control: false,
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
    },
    {
      index: 2,
      symbol: 'gain',
      input: true,
      output: false,
      audio: false,
      control: true,
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
      default: 0,
      minimum: -90,
      maximum: 24,
    },
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
const native: NativeDraft = {
  id: 'tone1',
  kind: 'native',
  name: 'Tone',
  preset,
  source: { kind: 'original', preset: preset.sha256 },
};
it('emits valid stereo pass-through and deduplicates exact native payloads without merging instances', () => {
  const empty = JSON.parse(
    serialRig(crypto.randomUUID(), 'Empty', [], 'profile').manifest_json,
  );
  expect(validator(empty), JSON.stringify(validator.errors)).toBe(true);
  expect(empty.oxidal.graph.edges).toHaveLength(2);
  const request = serialRig(
    crypto.randomUUID(),
    'Two tones',
    [native, { ...native, id: 'tone2' }],
    'profile',
  );
  const manifest = JSON.parse(request.manifest_json);
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.tone3000.instances).toHaveLength(2);
  expect(manifest.resources).toHaveLength(1);
  expect(Object.keys(request.resources)).toHaveLength(1);
  expect(manifest.extensions['urn:oxidal:authoring'].draft).toBe(true);
});
it('makes mono channel policy explicit and retains raw LV2 values', () => {
  for (const [policy, gains] of [
    ['sum', [0.5, 0.5]],
    ['left', [1, 0]],
    ['right', [0, 1]],
  ] as const) {
    const item = lv2Effect(mono);
    if (item.kind !== 'lv2') throw new Error('Wrong fixture');
    item.mono = policy;
    item.controls.gain = -6;
    const manifest = JSON.parse(
      serialRig(crypto.randomUUID(), 'Mixed', [native, item], 'profile')
        .manifest_json,
    );
    expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
    const nodes = manifest.oxidal.graph.nodes;
    expect(
      nodes.find((n: { kind: string }) => n.kind === 'merge').inputGains,
    ).toEqual(gains);
    expect(
      nodes.find((n: { kind: string }) => n.kind === 'lv2').audioInputs,
    ).toBe(1);
    expect(
      nodes.find((n: { kind: string }) => n.kind === 'split').audioOutputs,
    ).toBe(2);
    expect(manifest.oxidal.lv2[0].controls.gain).toBe(-6);
    // A mono instance is instantiated once, not independently for each channel.
    expect(manifest.oxidal.lv2).toHaveLength(1);
  }
  expect(() =>
    lv2Effect({ ...mono, unsupported: 'Requires Atom events' }),
  ).toThrow('Requires Atom');
});

it('derives linked stages without modifying the source or merging their controls', () => {
  const original = structuredClone(native);
  const [amp, cab] = splitNative(native, 'source-amp', 'source-cab', 'right');
  const fx = lv2Effect(mono);
  amp.stage!.recipe.controls.inputLevel = 0.6;
  expect(cab.stage!.recipe.controls).toEqual({});
  const request = serialRig(
    crypto.randomUUID(),
    'Hybrid',
    [amp, fx, cab],
    'profile',
  );
  const manifest = JSON.parse(request.manifest_json);
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.resources).toHaveLength(1);
  expect(Object.keys(request.resources)).toHaveLength(1);
  expect(
    manifest.tone3000.instances.map(
      (n: { processingRole: string }) => n.processingRole,
    ),
  ).toEqual(['amp', 'cab']);
  expect(manifest.tone3000.instances[0].partition).toMatchObject({
    version: 1,
    input: 'right',
    amp: 'source-amp',
    cab: 'source-cab',
    controls: { inputLevel: 0.6 },
  });
  expect(manifest.tone3000.instances[1].partition.pair).toBe(
    manifest.tone3000.instances[0].partition.pair,
  );
  expect(native).toEqual(original);
});
it('keeps stage pairs complete and ordered without preventing effects between them', () => {
  const [amp, cab] = splitNative(native, 'amp', 'cab', 'left');
  const fx = lv2Effect(mono);
  expect(canMoveEffect([amp, cab, fx], 1, -1)).toBe(false);
  expect(canMoveEffect([amp, cab, fx], 1, 1)).toBe(true);
  expect(canMoveEffect([amp, fx, cab], 1, -1)).toBe(true);
  expect(canMoveEffect([amp, cab], 0, -1)).toBe(false);
  expect(removeEffect([amp, fx, cab], amp.id)).toEqual([fx]);
  expect(removeEffect([amp, fx, cab], cab.id)).toEqual([fx]);
  expect(removeEffect([amp, fx, cab], fx.id)).toEqual([amp, cab]);
  for (const effects of [
    [amp],
    [cab, amp],
    [amp, cab, { ...cab, id: 'duplicate' }],
  ])
    expect(() =>
      serialRig(crypto.randomUUID(), 'Invalid', effects, 'profile'),
    ).toThrow('pair');
  expect(() => splitNative(amp, 'amp', 'cab', 'left')).toThrow('whole tone');
  expect(() => splitNative(native, 'same', 'same', 'left')).toThrow('separate');
});

it('message-based effects cannot silently become scalar-only drafts', () => {
  const source = mono.ports[0];
  if (!source) throw new Error('Missing fixture port');
  expect(() =>
    lv2Effect({
      ...mono,
      ports: [
        ...mono.ports,
        {
          ...source,
          atom: true,
          audio: false,
          control: false,
          symbol: 'events',
        },
      ],
    }),
  ).toThrow('Message and file controls');
});

it('builds parallel scene branches with shared post effects and exact stereo selectors', () => {
  const second = { ...native, id: 'second-tone', name: 'Lead' };
  const published = sceneRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Scenes',
    [native, second, lv2Effect(mono)],
    'tone3000-plugin:' + 'a'.repeat(40),
  );
  const manifest = JSON.parse(published.manifest_json);
  expect(validator(manifest)).toBe(true);
  expect(manifest.tone3000.instances).toHaveLength(2);
  expect(manifest.resources).toHaveLength(1); // shared bytes, independent DSP
  const host = manifest.oxidal;
  expect(
    host.graph.edges
      .filter(
        (e: { to: { node: string } }) =>
          e.to.node === native.id || e.to.node === second.id,
      )
      .every((e: { from: { node: string } }) =>
        e.from.node.startsWith('scene-input-'),
      ),
  ).toBe(true);
  expect(
    host.graph.edges.filter(
      (e: { from: { node: string } }) =>
        e.from.node === 'scene-left' || e.from.node === 'scene-right',
    ),
  ).toHaveLength(2);
  const scenes = manifest.extensions['urn:oxidal:scenes:1'].scenes;
  expect(scenes).toHaveLength(2);
  const branches = manifest.extensions['urn:oxidal:scenes:1'].branches;
  expect(branches).toHaveLength(2);
  expect(branches[0].gains).toEqual([
    { node: 'scene-left', port: 0, value: 1 },
    { node: 'scene-right', port: 0, value: 1 },
  ]);
  expect(scenes[0].gains.map((g: { value: number }) => g.value)).toEqual([
    1, 0, 1, 0,
  ]);
  expect(scenes[1].gains.map((g: { value: number }) => g.value)).toEqual([
    0, 1, 0, 1,
  ]);
  expect(() => sceneRig('id', 'Scenes', [native], 'profile')).toThrow(
    'Choose 2',
  );
});

it('keeps outgoing branch histories by selecting input gates and unity-summing outputs', () => {
  const result = sceneRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Trails',
    [native, { ...native, id: 'second-tone', name: 'Lead' }, lv2Effect(mono)],
    'tone3000-plugin:' + 'a'.repeat(40),
    'preserve',
  );
  const manifest = JSON.parse(result.manifest_json);
  expect(validator(manifest)).toBe(true);
  const nodes = manifest.oxidal.graph.nodes as {
    id: string;
    inputGains?: number[];
  }[];
  expect(nodes.find((n) => n.id === 'scene-left')!.inputGains).toEqual([1, 1]);
  expect(nodes.find((n) => n.id === 'scene-right')!.inputGains).toEqual([1, 1]);
  const extension = manifest.extensions['urn:oxidal:scenes:1'];
  expect(extension.scenes[0].gains).toEqual([
    { node: 'scene-feed-left-0', port: 0, value: 1 },
    { node: 'scene-feed-left-1', port: 0, value: 0 },
    { node: 'scene-feed-right-0', port: 0, value: 1 },
    { node: 'scene-feed-right-1', port: 0, value: 0 },
  ]);
  expect(extension.branches[1].gains).toEqual([
    { node: 'scene-feed-left-1', port: 0, value: 1 },
    { node: 'scene-feed-right-1', port: 0, value: 1 },
  ]);
  expect(
    manifest.oxidal.graph.edges
      .filter((e: { to: { node: string } }) => e.to.node === native.id)
      .every((e: { from: { node: string } }) =>
        e.from.node.startsWith('scene-feed-'),
      ),
  ).toBe(true);
  expect(manifest.extensions['urn:oxidal:authoring'].scene_tails).toBe(
    'preserve',
  );
});

it('splits after shared blocks into two lanes that sum before OUT, as a finished preset', () => {
  const pitch = { ...lv2Effect(mono), id: 'pitch', name: 'Pitch' };
  const rig = parallelRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Amp + octave',
    [],
    [[native], [pitch]],
    'tone3000-plugin:test',
    false,
  );
  const manifest = JSON.parse(rig.manifest_json);
  expect(validator(manifest)).toBe(true);
  const edges = manifest.oxidal.graph.edges.map(
    (e: {
      from: { node: string; port: number };
      to: { node: string; port: number };
    }) => `${e.from.node}:${e.from.port}>${e.to.node}:${e.to.port}`,
  );
  // The input feeds both splits; each split feeds both lanes on its side.
  expect(edges).toEqual(
    expect.arrayContaining([
      'in:0>split-left:0',
      'in:1>split-right:0',
      `split-left:0>${native.id}:0`,
      `split-right:0>${native.id}:1`,
      'split-left:1>pitch-mono:0',
      'split-right:1>pitch-mono:1',
      `${native.id}:0>merge-left:0`,
      'pitch-stereo:0>merge-left:1',
      `${native.id}:1>merge-right:0`,
      'pitch-stereo:1>merge-right:1',
      'merge-left:0>out:0',
      'merge-right:0>out:1',
    ]),
  );
  const merge = manifest.oxidal.graph.nodes.find(
    (n: { id: string }) => n.id === 'merge-left',
  );
  expect(merge.inputGains).toEqual([1, 1]);
  expect(manifest.extensions['urn:oxidal:authoring'].draft).toBe(false);
  expect(() =>
    parallelRig('id', 'x', [], [[native], []], 'tone3000-plugin:test'),
  ).toThrow(/at least one block/);
});
