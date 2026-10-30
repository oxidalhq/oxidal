import { expect, it } from 'vitest';
import { chainLanes } from './rigChain';
import {
  parallelRig,
  serialRig,
  lv2Effect,
  type NativeDraft,
} from './rigDraft';
import type { Lv2Plugin, Preset } from './api';

const plugin = (channels: 1 | 2): Lv2Plugin => ({
  name: channels === 1 ? 'Mono fx' : 'Stereo fx',
  uri: `urn:example:${channels}`,
  unsupported: null,
  ports: [
    ...(channels === 1
      ? ['in', 'out']
      : ['in_l', 'out_l', 'in_r', 'out_r']
    ).map((symbol, index) => ({
      index,
      symbol,
      audio: true,
      control: false,
      atom: false,
      input: symbol.startsWith('in'),
      output: symbol.startsWith('out'),
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
      minimum: null,
      maximum: null,
      default: null,
    })),
  ],
});
const amp: NativeDraft = {
  id: 'amp',
  kind: 'native',
  name: 'Amp',
  preset: { sha256: 'a'.repeat(64), size_bytes: 1 } as Preset,
  source: { kind: 'original', preset: 'a'.repeat(64) },
};
const graph = (json: string) => JSON.parse(json).oxidal.graph;

it('reads a straight preset as one lane in order, skipping mono adapters', () => {
  const mono = { ...lv2Effect(plugin(1)), id: 'fx1' };
  const stereo = { ...lv2Effect(plugin(2)), id: 'fx2' };
  const rig = serialRig('id', 'x', [mono, amp, stereo], 'p', false);
  expect(chainLanes(graph(rig.manifest_json))).toEqual([['fx1', 'amp', 'fx2']]);
});

it('reads a split preset as one lane per side', () => {
  const pitch = { ...lv2Effect(plugin(1)), id: 'pitch' };
  const rig = parallelRig('id', 'x', [], [[amp], [pitch]], 'p', false);
  expect(chainLanes(graph(rig.manifest_json))).toEqual([['amp'], ['pitch']]);
});

it('gives up on shapes it cannot draw as lanes', () => {
  expect(
    chainLanes({
      nodes: [
        { id: 'in', kind: 'input' },
        { id: 's', kind: 'split' },
        { id: 'a', kind: 'lv2' },
        { id: 'b', kind: 'lv2' },
      ],
      edges: [
        { from: { node: 'in', port: 0 }, to: { node: 's', port: 0 } },
        { from: { node: 's', port: 0 }, to: { node: 'a', port: 0 } },
        { from: { node: 's', port: 1 }, to: { node: 'b', port: 0 } },
      ],
    }),
  ).toBeNull();
});
