import { expect, it } from 'vitest';
import type { Lv2Plugin, Preset, RigDocument } from './api';
import {
  lv2Effect,
  parallelRig,
  serialRig,
  terminalEffect,
  type NativeDraft,
} from './rigDraft';
import {
  buildLanes,
  insertBlock,
  moveBlock,
  readLanes,
  removeBlock,
  type Lanes,
} from './rigEdit';

const port = (
  index: number,
  symbol: string,
  audio: boolean,
  input: boolean,
) => ({
  index,
  symbol,
  audio,
  control: !audio,
  atom: false,
  input,
  output: !input,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: audio ? null : 0,
  maximum: audio ? null : 10,
  default: audio ? null : 1,
});
const flanger: Lv2Plugin = {
  name: 'Retro Flanger',
  uri: 'urn:example:flanger',
  unsupported: null,
  ports: [
    port(0, 'depth', false, true),
    port(1, 'in', true, true),
    port(2, 'out', true, false),
  ],
};
const hold: Lv2Plugin = {
  name: 'Hold',
  uri: 'urn:oxidal:plugin:hold#stereo',
  unsupported: null,
  ports: [
    port(0, 'hold', false, true),
    { ...port(1, 'focus', false, true), default: 80 },
    port(2, 'in_l', true, true),
    port(3, 'out_l', true, false),
    port(4, 'in_r', true, true),
    port(5, 'out_r', true, false),
  ],
};
const amp: NativeDraft = {
  id: 'amp',
  kind: 'native',
  name: 'Rx Bogner',
  preset: { sha256: 'a'.repeat(64), size_bytes: 99 } as Preset,
  source: { kind: 'owned', preset: 'a'.repeat(64) },
};
const flange = {
  ...lv2Effect(flanger),
  id: 'flange',
  name: 'Retro Flanger',
  mono: 'left' as const,
};
const document = (json: string): RigDocument => ({
  manifest: JSON.parse(json),
  revision: 'r'.repeat(64),
});

it('keeps an upstream flanger before a full-spectrum terminal Hold', () => {
  const lanes = insertBlock([[amp, flange]], 0, Infinity, terminalEffect(hold));
  const built = JSON.parse(
    buildLanes('p', 'Rx Bogner + Retro Flanger + Hold', lanes, 'prof')
      .manifest_json,
  ) as RigDocument['manifest'];
  expect(built.oxidal?.lv2.map((effect) => effect.pluginUri)).toEqual([
    flanger.uri,
    hold.uri,
  ]);
  expect(built.oxidal?.lv2[1]?.controls.focus).toBe(0);
});
const graph = (json: string) => JSON.parse(json).oxidal.graph;

it('reads a preset back into its blocks and rebuilds the same routing', () => {
  const built = serialRig(
    'p',
    'Rx Bogner + Flanger',
    [amp, flange],
    'prof',
    false,
  );
  const lanes = readLanes(document(built.manifest_json), [flanger], {
    flange: { depth: 7 },
  });
  expect(lanes.map((l) => l.map((b) => b.id))).toEqual([['amp', 'flange']]);
  const [, effect] = lanes[0]!;
  expect(effect).toMatchObject({
    kind: 'lv2',
    mono: 'left',
    controls: { depth: 7 },
  });
  expect(lanes[0]![0]).toMatchObject({
    kind: 'native',
    source: { kind: 'bundle', revision: 'r'.repeat(64), resource: 'preset-0' },
  });
  const rebuilt = buildLanes('p', 'Rx Bogner + Flanger', lanes, 'prof');
  expect(graph(rebuilt.manifest_json)).toEqual(graph(built.manifest_json));
});

it('adds a block to a split with shared blocks without duplicating them', () => {
  // Sprint 07 7.16: a NAM block before the split and an effect after the merge
  // were copied into both lanes, so saving the edit produced
  // "Duplicate native instance".
  const echo = { ...lv2Effect(hold), id: 'echo', name: 'Hold' };
  const tail = { ...lv2Effect(hold), id: 'tail', name: 'Hold' };
  // A NAM block shared before the split and an effect shared after the merge.
  const built = buildLanes(
    'p',
    'x',
    [
      [amp, flange, tail],
      [amp, echo, tail],
    ],
    'prof',
  );
  const lanes = readLanes(document(built.manifest_json), [flanger, hold], {});
  expect(lanes.map((l) => l.map((b) => b.id))).toEqual([
    ['amp', 'flange', 'tail'],
    ['amp', 'echo', 'tail'],
  ]);
  const added = { ...lv2Effect(flanger), id: 'added', mono: 'sum' as const };
  const edited = JSON.parse(
    buildLanes('p', 'x', insertBlock(lanes, 1, 2, added), 'prof').manifest_json,
  ) as RigDocument['manifest'];
  expect(edited.tone3000.instances.map((i) => i.id)).toEqual(['amp']);
  const ids = edited.oxidal!.graph.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    readLanes(
      { manifest: edited, revision: 'r'.repeat(64) },
      [flanger, hold],
      {},
    ).map((l) => l.map((b) => b.id)),
  ).toEqual([
    ['amp', 'flange', 'tail'],
    ['amp', 'echo', 'added', 'tail'],
  ]);
});

it('refuses a block that appears in both lanes outside the shared sections', () => {
  const echo = { ...lv2Effect(hold), id: 'echo' };
  expect(() =>
    buildLanes(
      'p',
      'x',
      [
        [flange, echo],
        [echo, flange],
      ],
      'prof',
    ),
  ).toThrow(/both sides/);
});

it('inserts, moves and removes blocks; an emptied split side becomes straight', () => {
  const extra = { ...lv2Effect(hold), id: 'hold' };
  const one: Lanes = [[amp, flange]];
  const ids = (lanes: Lanes) => lanes.map((l) => l.map((b) => b.id));
  expect(ids(insertBlock(one, 0, 99, extra))).toEqual([
    ['amp', 'flange', 'hold'],
  ]);
  expect(ids(insertBlock(one, 0, 1, extra))).toEqual([
    ['amp', 'hold', 'flange'],
  ]);
  expect(ids(moveBlock(one, 'flange', 0))).toEqual([['flange', 'amp']]);
  expect(ids(removeBlock(one, 'flange'))).toEqual([['amp']]);
  const split: Lanes = [[amp], [flange]];
  // Across a split: the side left empty becomes a straight chain.
  expect(ids(moveBlock(split, 'flange', 0, 0))).toEqual([['flange', 'amp']]);
  expect(ids(removeBlock(split, 'flange'))).toEqual([['amp']]);
  const built = buildLanes('p', 'x', removeBlock(split, 'flange'), 'prof');
  expect(
    graph(built.manifest_json).nodes.some(
      (n: { kind: string }) => n.kind === 'split',
    ),
  ).toBe(false);
  const parallel = parallelRig('p', 'x', [], [[amp], [flange]], 'prof', false);
  expect(
    ids(readLanes(document(parallel.manifest_json), [flanger], {})),
  ).toEqual([['amp'], ['flange']]);
  // The last block can go: the preset becomes an empty input-to-output chain.
  expect(
    graph(buildLanes('p', 'x', [[]], 'prof').manifest_json).nodes.map(
      (n: { kind: string }) => n.kind,
    ),
  ).toEqual(['input', 'output']);
  expect(() =>
    readLanes(
      document(serialRig('p', 'x', [flange], 'prof').manifest_json),
      [],
      {},
    ),
  ).toThrow(/not installed/);
});
