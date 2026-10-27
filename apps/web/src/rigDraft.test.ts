import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import { lv2Effect, serialRig, type DraftEffect } from './rigDraft';
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
const native: DraftEffect = {
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
