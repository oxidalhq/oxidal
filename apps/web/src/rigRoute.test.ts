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
  routePathMix,
  pathMix,
  mixGains,
  routePathGain,
  routeShift,
  routeCopyBranch,
  routeInsert,
  routeLanes,
  routeMove,
  routeRemove,
  routeRemoveBranch,
  routeSplitAddPath,
  type RouteSplit,
  type Route,
} from './rigRoute';
import { keepScenes } from './sceneEdit';

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

it('keeps scene levels through a routing change and maps new paths (C9)', () => {
  const route: Route = [split('s', [[fx('a')], [fx('b')]])];
  const document = doc(buildRoute('p', 'x', route, 'prof'));
  const merges = document.manifest.oxidal!.graph.nodes.filter(
    (n) => n.kind === 'merge',
  );
  const all = (value: (port: number) => number) =>
    merges.flatMap((n) =>
      n.inputGains!.map((_, port) => ({
        node: n.id,
        port,
        value: value(port),
      })),
    );
  document.manifest.requiredExtensions.push('urn:oxidal:scenes:1');
  document.manifest.extensions['urn:oxidal:scenes:1'] = {
    fade_ms: 10,
    scenes: [
      { id: 'one', name: 'A only', gains: all((p) => (p === 0 ? 1 : 0)) },
      { id: 'two', name: 'B only', gains: all((p) => (p === 1 ? 1 : 0)) },
    ],
  };
  const next = keepScenes(
    document,
    buildRoute('p', 'x', routeAddBranch(route, 'a'), 'prof'),
  );
  const manifest = JSON.parse(next.manifest_json);
  const scenes = manifest.extensions['urn:oxidal:scenes:1'].scenes;
  expect(manifest.requiredExtensions).toContain('urn:oxidal:scenes:1');
  for (const scene of scenes) {
    // Every scene names all three inputs of each merge, as the device requires.
    for (const merge of merges)
      expect(
        scene.gains.filter((g: { node: string }) => g.node === merge.id),
      ).toHaveLength(3);
  }
  // Old levels stay; the new path comes in at its routing level.
  const level = (scene: number, port: number) =>
    scenes[scene].gains.find(
      (g: { node: string; port: number }) =>
        g.node === merges[0]!.id && g.port === port,
    ).value;
  expect([level(0, 0), level(0, 1), level(0, 2)]).toEqual([1, 0, 1]);
  expect([level(1, 0), level(1, 1)]).toEqual([0, 1]);
  // With no split left there is nothing for the scenes to switch.
  expect(() =>
    keepScenes(
      document,
      buildRoute('p', 'x', routeRemoveBranch(route, 'a'), 'prof'),
    ),
  ).toThrow(/needs a split/);
});

it('adds, copies and removes a path by split and index for the split dialog', () => {
  const route: Route = [split('s', [[fx('a')], [fx('b')], []], [1, 0.8, 0.5])];
  expect(ids(routeSplitAddPath(route, 'split-s'))).toEqual([
    ['a'],
    ['b'],
    [],
    [],
  ]);
  const copied = routePath(route, 'split-s', 1, 'copy');
  expect(ids(copied)[2]![0]).toMatch(/^effect-/);
  expect((copied[0] as RouteSplit).gains).toEqual([1, 0.8, 0.8, 0.5]);
  // Removing the dry path drops it; removing down to one path dissolves the split.
  expect(ids(routePath(route, 'split-s', 2, 'remove'))).toEqual([['a'], ['b']]);
  const one = routePath(
    routePath(route, 'split-s', 2, 'remove'),
    'split-s',
    0,
    'remove',
  );
  expect(ids(one)).toEqual([['b']]);
  expect(one.some(isSplit)).toBe(false);
  expect(() => routeSplitAddPath(route, 'split-gone')).toThrow(/no longer/);
});

it('pans and inverts one path through build and reopen, and edits keep them (7.26)', () => {
  expect(mixGains({ level: 1, pan: -0.5, invert: false })).toEqual([1, 0.5]);
  expect(mixGains({ level: 2, pan: 1, invert: true })).toEqual([0, -2]);
  expect(pathMix(1, 0.5)).toEqual({ level: 1, pan: -0.5, invert: false });
  expect(pathMix(-0.8)).toEqual({ level: 0.8, pan: 0, invert: true });
  const route: Route = [split('s', [[fx('a')], [fx('b')]])];
  const panned = routePathMix(route, 'split-s', 1, {
    level: 0.8,
    pan: 0.5,
    invert: true,
  });
  const built = buildRoute('p', 'x', panned, 'prof');
  const gains = (side: string) =>
    graph(built).nodes.find((n) => n.id === `merge-s-${side}`)!.inputGains;
  expect(gains('left')).toEqual([1, -0.4]);
  expect(gains('right')).toEqual([1, -0.8]);
  const reopened = reopen(panned)[0] as RouteSplit;
  expect(reopened.gains).toEqual([1, -0.4]);
  expect(reopened.rightGains).toEqual([1, -0.8]);
  // A level change keeps pan and polarity; copying a path copies its mix.
  const louder = routePathGain(panned, 'split-s', 1, 1.6)[0] as RouteSplit;
  expect(pathMix(louder.gains[1]!, louder.rightGains![1])).toEqual({
    level: 1.6,
    pan: 0.5,
    invert: true,
  });
  const copied = routePath(panned, 'split-s', 1, 'copy')[0] as RouteSplit;
  expect(copied.rightGains).toEqual([1, -0.8, -0.8]);
  // Centring the pan again leaves one gain list, as before panning existed.
  const centred = routePathMix(panned, 'split-s', 1, {
    level: 1,
    pan: 0,
    invert: false,
  })[0] as RouteSplit;
  expect(centred.rightGains).toBeUndefined();
});
