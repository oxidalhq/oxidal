import { expect, it } from 'vitest';
import type { Lv2Plugin, Preset, RigDocument } from './api';
import { chainLanes, chainRoute } from './rigChain';
import { lv2Effect, parallelRig, type NativeDraft } from './rigDraft';
import {
  buildRoute,
  isSplit,
  readRoute,
  routeAddBranch,
  routeAddPath,
  routeAppend,
  routeControl,
  routePath,
  routePathGain,
  routeShift,
  routeCopyBranch,
  routeInsert,
  routeLanes,
  routeMove,
  routeRemove,
  routeRemoveBranch,
  type Route,
} from './rigRoute';

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
const stereo: Lv2Plugin = {
  name: 'Verb',
  uri: 'urn:example:verb',
  unsupported: null,
  ports: [
    port(0, 'mix', false, true),
    port(1, 'in_l', true, true),
    port(2, 'out_l', true, false),
    port(3, 'in_r', true, true),
    port(4, 'out_r', true, false),
  ],
};
const mono: Lv2Plugin = {
  name: 'Fuzz',
  uri: 'urn:example:fuzz',
  unsupported: null,
  ports: [
    port(0, 'gain', false, true),
    port(1, 'in', true, true),
    port(2, 'out', true, false),
  ],
};
const fx = (id: string, plugin = stereo) => ({
  ...lv2Effect(plugin),
  id,
  name: id,
});
const tone = (id: string, sha = 'a'): NativeDraft => ({
  id,
  kind: 'native',
  name: id,
  preset: { sha256: sha.repeat(64), size_bytes: 9 } as Preset,
  source: { kind: 'owned', preset: sha.repeat(64) },
});
const ampStage = (id: string, role: 'amp' | 'cab'): NativeDraft => ({
  ...tone(id, 'b'),
  stage: {
    role,
    recipe: {
      version: 1,
      pair: 'p1',
      amp: 'a',
      cab: 'c',
      input: 'left',
      controls: {},
    },
  },
});
const doc = (publish: { manifest_json: string }): RigDocument => ({
  manifest: JSON.parse(publish.manifest_json),
  revision: 'r'.repeat(64),
});
const graph = (publish: { manifest_json: string }) =>
  (JSON.parse(publish.manifest_json) as RigDocument['manifest']).oxidal!.graph;
const plugins = [stereo, mono];
const ids = (route: Route) => routeLanes(route).map((l) => l.map((b) => b.id));
const reopen = (route: Route) =>
  readRoute(doc(buildRoute('p', 'x', route, 'prof')), plugins, {});
const split = (
  tag: string,
  branches: Route[],
  gains?: number[],
): Route[number] => ({
  kind: 'split',
  split: `split-${tag}`,
  merge: `merge-${tag}`,
  gains: gains ?? branches.map(() => 1),
  branches,
});
/** Topology as edges between node ids, so comparisons are about wiring. */
const wiring = (publish: { manifest_json: string }) =>
  graph(publish)
    .edges.map((e) => `${e.from.node}:${e.from.port}>${e.to.node}:${e.to.port}`)
    .sort();

it('reads the existing two-lane split and rebuilds the identical graph', () => {
  const amp = tone('amp');
  const built = parallelRig(
    'p',
    'x',
    [amp],
    [[fx('a')], [fx('b', mono)]],
    'prof',
    false,
    [fx('tail')],
  );
  const route = readRoute(doc(built), plugins, {});
  expect(ids(route)).toEqual([
    ['amp', 'a', 'tail'],
    ['amp', 'b', 'tail'],
  ]);
  expect(graph(buildRoute('p', 'x', route, 'prof'))).toEqual(graph(built));
});

it('builds four parallel branches with a dry path and keeps merge gains on reopen', () => {
  const route: Route = [
    tone('amp'),
    split(
      'voices',
      [[fx('clean')], [fx('rhythm')], [fx('lead', mono)], []],
      [1, 0.5, 0.25, 0.75],
    ),
    fx('room'),
  ];
  const built = buildRoute('p', 'x', route, 'prof');
  const g = graph(built);
  const merge = g.nodes.find((n) => n.id === 'merge-voices-left')!;
  expect(merge.audioInputs).toBe(4);
  expect(merge.inputGains).toEqual([1, 0.5, 0.25, 0.75]);
  expect(g.nodes.find((n) => n.id === 'split-voices-right')!.audioOutputs).toBe(
    4,
  );
  // The dry path is a direct split → merge wire on both channels.
  expect(wiring(built)).toContain('split-voices-left:3>merge-voices-left:3');
  expect(wiring(built)).toContain('split-voices-right:3>merge-voices-right:3');
  const back = reopen(route);
  expect(ids(back)).toEqual([
    ['amp', 'clean', 'room'],
    ['amp', 'rhythm', 'room'],
    ['amp', 'lead', 'room'],
    ['amp', 'room'],
  ]);
  expect(wiring(buildRoute('p', 'x', back, 'prof'))).toEqual(wiring(built));
  expect(chainLanes(g)).toHaveLength(4);
});

it('round-trips two split groups and a nested split exactly', () => {
  const route: Route = [
    split('one', [[fx('a')], [fx('b')]]),
    fx('mid'),
    split('two', [
      [fx('c'), split('inner', [[fx('d')], [fx('e', mono)]])],
      [fx('f')],
      [fx('g')],
    ]),
  ];
  const built = buildRoute('p', 'x', route, 'prof');
  const back = reopen(route);
  expect(back.filter(isSplit).map((s) => s.split)).toEqual([
    'split-one',
    'split-two',
  ]);
  const inner = (back[2] as Extract<Route[number], { kind: 'split' }>)
    .branches[0]![1];
  expect(isSplit(inner) && inner.split).toBe('split-inner');
  expect(wiring(buildRoute('p', 'x', back, 'prof'))).toEqual(wiring(built));
  expect(routeLanes(back)).toHaveLength(2 * 4);
  const tree = chainRoute(graph(built))!;
  expect(tree).toHaveLength(3);
});

it('starts a dual cab beside a cab stage without copying the guarded stage', () => {
  const route: Route = [ampStage('amp', 'amp'), ampStage('cab', 'cab')];
  const dual = routeAddPath(route, 'cab');
  expect(ids(dual)).toEqual([['amp', 'cab'], ['amp']]);
  // The second path takes a second, real cab block.
  const second = routeInsert(dual, 1, 1, tone('cab-2', 'c'));
  expect(ids(second)).toEqual([
    ['amp', 'cab'],
    ['amp', 'cab-2'],
  ]);
  const built = buildRoute('p', 'x', second, 'prof');
  const g = graph(built);
  expect(g.nodes.filter((n) => n.kind === 'tone3000').map((n) => n.id)).toEqual(
    ['amp', 'cab', 'cab-2'],
  );
  expect(ids(reopen(second))).toEqual(ids(second));
  expect(() => routeCopyBranch(second, 'cab')).toThrow(/cannot be copied/);
});

it('adds, copies and removes branches; a lone path dissolves its split', () => {
  const route: Route = [split('s', [[fx('a')], [fx('b')]])];
  const three = routeCopyBranch(route, 'b');
  const lanes = ids(three);
  expect(lanes).toHaveLength(3);
  expect(lanes[2]![0]).toMatch(/^effect-/);
  expect(ids(routeAddBranch(route, 'a'))).toEqual([['a'], ['b'], []]);
  const nested = routeAddPath(route, 'a');
  expect(ids(nested)).toEqual([['a'], [], ['b']]);
  expect(ids(routeRemoveBranch(route, 'a'))).toEqual([['b']]);
  expect(routeRemoveBranch(route, 'a').some(isSplit)).toBe(false);
  // Removing a block empties its branch, which goes; an existing dry path stays.
  const dry: Route = [split('s', [[fx('a')], [fx('b')], []])];
  expect(ids(routeRemove(dry, 'a'))).toEqual([['b'], []]);
  expect(ids(routeRemove(routeRemove(dry, 'a'), 'b'))).toEqual([[]]);
});

it('inserts and moves within one lane, preferring the branch over shared blocks', () => {
  const route: Route = [
    fx('head'),
    split('s', [[fx('a')], [fx('b')]]),
    fx('tail'),
  ];
  // Between a branch block and the shared tail: the branch, not every lane.
  expect(ids(routeInsert(route, 1, 2, fx('x')))).toEqual([
    ['head', 'a', 'tail'],
    ['head', 'b', 'x', 'tail'],
  ]);
  // Before the shared head: shared by every lane.
  expect(ids(routeInsert(route, 0, 0, fx('x')))[1]).toEqual([
    'x',
    'head',
    'b',
    'tail',
  ]);
  // Moving the only block of a branch to the other lane dissolves the split.
  expect(ids(routeMove(route, 'b', 1, 0))).toEqual([
    ['head', 'b', 'a', 'tail'],
  ]);
  expect(() =>
    buildRoute('p', 'x', [fx('a'), split('s', [[fx('a')], [fx('b')]])], 'prof'),
  ).toThrow(/one place/);
  expect(() => buildRoute('p', 'x', [split('s', [[], []])], 'prof')).toThrow(
    /two paths/,
  );
});

it('leaves an unknown topology alone instead of rewriting it', () => {
  const built = buildRoute(
    'p',
    'x',
    [split('s', [[fx('a')], [fx('b')]])],
    'prof',
  );
  const manifest = JSON.parse(built.manifest_json) as RigDocument['manifest'];
  // A split without its right-channel twin is not a shape this editor writes.
  manifest.oxidal!.graph.nodes = manifest.oxidal!.graph.nodes.map((n) =>
    n.id === 'split-s-right' ? { ...n, id: 'other' } : n,
  );
  for (const e of manifest.oxidal!.graph.edges) {
    if (e.from.node === 'split-s-right') e.from.node = 'other';
    if (e.to.node === 'split-s-right') e.to.node = 'other';
  }
  expect(chainRoute(manifest.oxidal!.graph)).toBeNull();
  expect(() =>
    readRoute({ manifest, revision: 'r'.repeat(64) }, plugins, {}),
  ).toThrow(/cannot be edited/);
});

it('edits offline by path: append, copy and remove paths, shift and set controls', () => {
  const route: Route = [fx('a'), split('s', [[fx('b')], []])];
  expect(ids(routeAppend(route, fx('end')))).toEqual([
    ['a', 'b', 'end'],
    ['a', 'end'],
  ]);
  expect(
    ids(routeAppend(route, fx('dry-fx'), { split: 'split-s', path: 1 })),
  ).toEqual([
    ['a', 'b'],
    ['a', 'dry-fx'],
  ]);
  expect(ids(routePath(route, 'split-s', 1, 'copy'))).toEqual([
    ['a', 'b'],
    ['a'],
    ['a'],
  ]);
  expect(ids(routePath(route, 'split-s', 1, 'remove'))).toEqual([['a', 'b']]);
  expect(ids(routeShift(route, 'a', 1))).toEqual([['b', 'a'], ['a']]);
  expect(routeShift(route, 'a', -1)).toBe(route);
  const set = routeControl(route, 'a', 'mix', 7);
  expect((set[0] as { controls: Record<string, number> }).controls.mix).toBe(7);
  expect(
    (route[0] as { controls: Record<string, number> }).controls.mix,
  ).not.toBe(7);
});

it('sets one path level and keeps it through build and reopen', () => {
  const route: Route = [split('s', [[fx('a')], [fx('b')], []])];
  const next = routePathGain(route, 'split-s', 2, 0.4);
  expect(routePathGain(route, 'split-s', 0, 9)[0]).toMatchObject({
    gains: [4, 1, 1],
  });
  const built = buildRoute('p', 'x', next, 'prof');
  for (const side of ['left', 'right'])
    expect(
      graph(built).nodes.find((n) => n.id === `merge-s-${side}`)!.inputGains,
    ).toEqual([1, 1, 0.4]);
  expect(reopen(next)[0]).toMatchObject({ gains: [1, 1, 0.4] });
});
