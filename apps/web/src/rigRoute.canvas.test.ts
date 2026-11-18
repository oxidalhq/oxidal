import Ajv from 'ajv/dist/2020';
import { expect, it } from 'vitest';

import schema from '../../../docs/presets/manifest.schema.json';
import type { Lv2Plugin, Preset, RigDocument } from './api';
import { chainRoute, type IdStep, routeSpot } from './rigChain';
import { lv2Effect, type NativeDraft, sceneRig } from './rigDraft';
import {
  buildRoute,
  buildSceneRoute,
  readRoute,
  type Route,
  routeAddPath,
  routeDuplicate,
  routeInsertAt,
  routeMoveTo,
  routePath,
  routePathStep,
  routeRemove,
  routeReplace,
  routeSplitAt,
  routeStep,
  sceneSplitIndex,
  sceneTones,
} from './rigRoute';
import { addSceneEffect } from './sceneEdit';
import { readScenes } from './sceneFormat';

const validator = new Ajv({ strict: false }).compile(schema);
const audio = (index: number, symbol: string, input: boolean) => ({
  index,
  symbol,
  audio: true,
  control: false,
  atom: false,
  input,
  output: !input,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: null,
  maximum: null,
  default: null,
});
const plugin: Lv2Plugin = {
  name: 'Echo',
  uri: 'urn:example:echo',
  unsupported: null,
  ports: [
    audio(0, 'in_l', true),
    audio(1, 'out_l', false),
    audio(2, 'in_r', true),
    audio(3, 'out_r', false),
  ],
};
const fx = (id: string) => ({ ...lv2Effect(plugin), id, name: id });
/** A route as ids, the way the chain and the tests read it. */
const ids = (route: Route): IdStep[] =>
  route.map((s) =>
    'branches' in s
      ? {
          split: s.split,
          merge: s.merge,
          gains: s.gains,
          branches: s.branches.map(ids),
        }
      : s.id,
  );
const shape = (route: Route): unknown =>
  route.map((s) => ('branches' in s ? s.branches.map(shape) : s.id));
const split = (branches: Route[]): Route[number] => ({
  kind: 'split',
  split: 'split',
  merge: 'merge',
  gains: branches.map(() => 1),
  branches,
});

it('adds an effect or a split at any gap, top level or inside a path', () => {
  const route: Route = [fx('amp'), split([[fx('echo')], [fx('hall')]])];
  const added = routeInsertAt(
    route,
    { split: 'split', path: 1, index: 0 },
    fx('comp'),
  );
  expect(shape(added)).toEqual(['amp', [['echo'], ['comp', 'hall']]]);
  const top = routeInsertAt(
    route,
    { split: null, path: 0, index: 1 },
    fx('drive'),
  );
  expect(shape(top)).toEqual(['amp', 'drive', [['echo'], ['hall']]]);
  // Split here at a gap: the chosen effect on Path 1, Path 2 empty (dry).
  const split2 = routeSplitAt(
    route,
    { split: null, path: 0, index: 0 },
    fx('pitch'),
  );
  expect(shape(split2)).toEqual([[['pitch'], []], 'amp', [['echo'], ['hall']]]);
  expect(
    chainRoute(
      JSON.parse(buildRoute('p', 'x', split2, 'prof').manifest_json).oxidal
        .graph,
    ),
  ).toEqual(ids(split2));
  // The original is untouched.
  expect(shape(route)).toEqual(['amp', [['echo'], ['hall']]]);
});

it('moves a block across paths by drop target, leaving a dry path behind', () => {
  const route: Route = [
    fx('amp'),
    split([[fx('echo')], [fx('hall'), fx('verb')]]),
  ];
  const across = routeMoveTo(route, 'echo', {
    split: 'split',
    path: 1,
    index: 1,
  });
  expect(shape(across)).toEqual(['amp', [[], ['hall', 'echo', 'verb']]]);
  // Out of the split: the paths keep their blocks.
  const out = routeMoveTo(route, 'verb', { split: null, path: 0, index: 0 });
  expect(shape(out)).toEqual(['verb', 'amp', [['echo'], ['hall']]]);
  // A drop on its own place changes nothing.
  expect(
    routeMoveTo(route, 'hall', { split: 'split', path: 1, index: 1 }),
  ).toBe(route);
  // The last block leaving a split with only a dry path dissolves it.
  const lone: Route = [fx('amp'), split([[fx('echo')], []])];
  expect(
    shape(routeMoveTo(lone, 'echo', { split: null, path: 0, index: 0 })),
  ).toEqual(['echo', 'amp']);
});

it('steps a block left and right through splits, and up and down paths', () => {
  const route: Route = [
    fx('amp'),
    split([[fx('echo')], [fx('hall')]]),
    fx('verb'),
  ];
  // Next to a split, a block steps into its first path.
  expect(shape(routeStep(route, 'amp', 1))).toEqual([
    [['amp', 'echo'], ['hall']],
    'verb',
  ]);
  expect(shape(routeStep(route, 'verb', -1))).toEqual([
    'amp',
    [['echo', 'verb'], ['hall']],
  ]);
  // At the end of a path it steps out of the split.
  expect(shape(routeStep(route, 'echo', 1))).toEqual([
    'amp',
    [[], ['hall']],
    'echo',
    'verb',
  ]);
  expect(shape(routeStep(route, 'hall', -1))).toEqual([
    'amp',
    'hall',
    [['echo'], []],
    'verb',
  ]);
  // At either end of the chain nothing moves.
  expect(routeStep(route, 'amp', -1)).toBe(route);
  expect(routeStep(route, 'verb', 1)).toBe(route);
  expect(shape(routePathStep(route, 'echo', 1))).toEqual([
    'amp',
    [[], ['echo', 'hall']],
    'verb',
  ]);
  expect(routePathStep(route, 'echo', -1)).toBe(route);
  expect(routePathStep(route, 'amp', 1)).toBe(route);
});

it('replaces and duplicates a block in its place', () => {
  const route: Route = [fx('amp'), split([[fx('echo')], []])];
  expect(shape(routeReplace(route, 'echo', fx('chorus')))).toEqual([
    'amp',
    [['chorus'], []],
  ]);
  const copy = routeDuplicate(route, 'echo');
  const [, s] = shape(copy) as [string, string[][]];
  expect(s[0]).toEqual(['echo', expect.stringMatching(/^effect-/)]);
});

it('finds a block, its index and every split around it', () => {
  const route = ids([
    fx('amp'),
    split([[fx('echo')], [fx('hall'), fx('verb')]]),
  ]);
  expect(routeSpot(route, 'verb')).toEqual({
    index: 1,
    length: 2,
    owners: [{ split: 'split', merge: 'merge', paths: 2, path: 1 }],
  });
  expect(routeSpot(route, 'amp')).toEqual({ index: 0, length: 2, owners: [] });
  expect(routeSpot(route, 'none')).toBeNull();
});

/* Scene lanes. */
const preset = {
  sha256: 'a'.repeat(64),
  name: 'Tone',
  size_bytes: 100,
} as Preset;
const tone = (id: string): NativeDraft => ({
  id,
  kind: 'native',
  name: id,
  preset,
  source: { kind: 'original', preset: preset.sha256 },
});
const revision = 'r'.repeat(64);
function scenes(tails: 'cut' | 'preserve'): RigDocument {
  const published = sceneRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Scenes',
    [tone('clean'), tone('lead')],
    'tone3000-plugin:' + 'a'.repeat(40),
    tails,
  );
  const document = {
    revision,
    manifest: JSON.parse(published.manifest_json),
  } as RigDocument;
  // An echo after the lead scene's tone.
  const echo = { ...lv2Effect(plugin), id: 'echo', name: 'Echo' };
  return {
    revision,
    manifest: JSON.parse(addSceneEffect(document, 'lead', echo).manifest_json),
  } as RigDocument;
}

for (const tails of ['cut', 'preserve'] as const)
  it(`splits a block inside a scene lane and keeps the scenes (${tails})`, () => {
    const document = scenes(tails);
    const tones = sceneTones(document.manifest);
    expect(tones).toEqual(['clean', 'lead']);
    const route = readRoute(document, [plugin], {});
    expect(sceneSplitIndex(route, tones)).toBe(0);
    const request = buildSceneRoute(
      document,
      routeAddPath(route, 'echo'),
      'Scenes',
    );
    const manifest = JSON.parse(
      request.manifest_json,
    ) as RigDocument['manifest'];
    expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
    const read = chainRoute(manifest.oxidal!.graph)!;
    const lead = (read[0] as Exclude<IdStep, string>).branches[1]!;
    expect(lead[0]).toBe('lead');
    expect(lead[1]).toMatchObject({ branches: [['echo'], []] });
    // Scenes, gates, tones and resources are as they were.
    expect(readScenes(manifest)).toEqual(readScenes(document.manifest));
    expect(manifest.tone3000).toEqual(document.manifest.tone3000);
    expect(
      manifest.oxidal!.graph.nodes.filter((n) => n.id.startsWith('scene-')),
    ).toEqual(
      document.manifest.oxidal!.graph.nodes.filter((n) =>
        n.id.startsWith('scene-'),
      ),
    );
    expect(request.resources).toEqual({
      'preset-0': { kind: 'bundle', revision, resource: 'preset-0' },
    });
    // Adding to the empty path and removing the split round-trip as well.
    const again = { revision, manifest } as RigDocument;
    const inner = lead[1] as Exclude<IdStep, string>;
    const filled = routeInsertAt(
      readRoute(again, [plugin], {}),
      { split: inner.split, path: 1, index: 0 },
      fx('hall'),
    );
    const next = JSON.parse(buildSceneRoute(again, filled).manifest_json);
    expect(chainRoute(next.oxidal.graph)![0]).toMatchObject({
      branches: [['clean'], ['lead', { branches: [['echo'], ['hall']] }]],
    });
    const removed = routePath(filled, inner.split, 1, 'remove');
    const last = JSON.parse(buildSceneRoute(again, removed).manifest_json);
    expect(chainRoute(last.oxidal.graph)![0]).toMatchObject({
      branches: [['clean'], ['lead', 'echo']],
    });
  });

it('refuses to change the scene paths themselves or to move a tone', () => {
  const document = scenes('cut');
  const route = readRoute(document, [plugin], {});
  const scene = route[0] as Extract<Route[number], { branches: unknown }>;
  expect(() =>
    buildSceneRoute(document, routePath(route, scene.split, 0, 'remove')),
  ).toThrow(/Each scene keeps its own path/);
  // An effect ahead of a scene's tone is refused...
  const swapped = structuredClone(route);
  const lead = (swapped[0] as typeof scene).branches[1]!;
  lead.reverse();
  expect(shape(swapped)).toEqual([[['clean'], ['echo', 'lead']]]);
  expect(() => buildSceneRoute(document, swapped)).toThrow(
    /Each scene keeps its own path/,
  );
  // ...and the edits never make one: Move ◀ next to the tone steps out ahead
  // of the scenes, a drop ahead of the tone lands after it.
  expect(shape(routeStep(route, 'echo', -1))).toEqual([
    'echo',
    [['clean'], ['lead']],
  ]);
  expect(
    shape(
      routeMoveTo(route, 'echo', { split: scene.split, path: 0, index: 0 }),
    ),
  ).toEqual([[['clean', 'echo'], ['lead']]]);
  // An effect after the scenes is fine: it is shared by every scene.
  const shared = routeStep(route, 'echo', 1);
  const next = JSON.parse(buildSceneRoute(document, shared).manifest_json);
  expect(chainRoute(next.oxidal.graph)).toMatchObject([
    { branches: [['clean'], ['lead']] },
    'echo',
  ]);
});

it('drops scene settings of an effect removed or replaced in a scene path', () => {
  const document = scenes('cut');
  type Scenes = {
    scenes: { controls?: { node: string; symbol: string; value: number }[] }[];
  };
  // Every scene sets the echo's level, and one setting of an effect that stays.
  const route = routeInsertAt(
    readRoute(document, [plugin], {}),
    { split: null, path: 0, index: 1 },
    fx('hall'),
  );
  const withHall = {
    revision,
    manifest: JSON.parse(buildSceneRoute(document, route).manifest_json),
  } as RigDocument;
  const ext = readScenes(withHall.manifest) as Scenes;
  for (const scene of ext.scenes)
    scene.controls = [
      { node: 'echo', symbol: 'level', value: 1 },
      { node: 'hall', symbol: 'level', value: 2 },
    ];
  const read = readRoute(withHall, [plugin], {});
  for (const next of [
    routeRemove(read, 'echo'),
    routeReplace(read, 'echo', fx('slap')),
  ]) {
    const manifest = JSON.parse(
      buildSceneRoute(withHall, next).manifest_json,
    ) as RigDocument['manifest'];
    expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
    expect(manifest.oxidal!.lv2.some((l) => l.id === 'echo')).toBe(false);
    expect(
      (readScenes(manifest) as Scenes).scenes.map((scene) => scene.controls),
    ).toEqual([
      [{ node: 'hall', symbol: 'level', value: 2 }],
      [{ node: 'hall', symbol: 'level', value: 2 }],
    ]);
  }
  // With its last setting gone, a scene carries no empty list.
  for (const scene of ext.scenes)
    scene.controls = [{ node: 'echo', symbol: 'level', value: 1 }];
  const bare = JSON.parse(
    buildSceneRoute(withHall, routeRemove(read, 'echo')).manifest_json,
  );
  expect(
    bare.extensions['urn:oxidal:scenes:1'].scenes.every(
      (scene: object) => !('controls' in scene),
    ),
  ).toBe(true);
});

/* Effects ahead of the scene lanes. */
type Graph = NonNullable<RigDocument['manifest']['oxidal']>['graph'];
/** The merge port a scene's tone reaches, following its left channel. */
function mergePort(graph: Graph, tone: string, merge: string): number | null {
  let at = tone;
  for (let guard = 0; guard < 64; guard++) {
    const edge = graph.edges.find(
      (e) => e.from.node === at && e.from.port === 0,
    );
    if (!edge) return null;
    if (edge.to.node === merge) return edge.to.port;
    at = edge.to.node;
  }
  return null;
}
const sorted = (graph: Graph) => ({
  nodes: graph.nodes.map((n) => JSON.stringify(n)).sort(),
  edges: graph.edges.map((e) => JSON.stringify(e)).sort(),
});

for (const tails of ['cut', 'preserve'] as const)
  it(`puts effects ahead of the scene lanes and keeps every scene (${tails})`, () => {
    const document = scenes(tails);
    const tones = sceneTones(document.manifest);
    const route = readRoute(document, [plugin], {});
    // Comp and Drive ahead of the amps, as the approved screen shows them.
    const ahead = routeInsertAt(
      routeInsertAt(route, { split: null, path: 0, index: 0 }, fx('comp')),
      { split: null, path: 0, index: 1 },
      fx('drive'),
    );
    expect(shape(ahead)).toEqual([
      'comp',
      'drive',
      [['clean'], ['lead', 'echo']],
    ]);
    const manifest = JSON.parse(
      buildSceneRoute(document, ahead, 'Scenes').manifest_json,
    ) as RigDocument['manifest'];
    expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
    const graph = manifest.oxidal!.graph;
    const read = chainRoute(graph)!;
    expect(read.slice(0, 2)).toEqual(['comp', 'drive']);
    expect(sceneSplitIndex(read, tones)).toBe(2);
    // Saved scenes recall as before: the same scenes, gates and tones, and
    // each scene's tone still reaches its own merge input.
    expect(readScenes(manifest)).toEqual(readScenes(document.manifest));
    expect(manifest.tone3000).toEqual(document.manifest.tone3000);
    expect(graph.nodes.filter((n) => n.id.startsWith('scene-'))).toEqual(
      document.manifest.oxidal!.graph.nodes.filter((n) =>
        n.id.startsWith('scene-'),
      ),
    );
    tones.forEach((tone, port) =>
      expect(mergePort(graph, tone, 'scene-left')).toBe(port),
    );
    expect(manifest.oxidal!.lv2.map((l) => l.id).sort()).toEqual([
      'comp',
      'drive',
      'echo',
    ]);
    // Read back, the route has its effects ahead of the scenes and rebuilds
    // the same graph.
    const again = { revision, manifest } as RigDocument;
    const reread = readRoute(again, [plugin], {});
    expect(shape(reread)).toEqual(shape(ahead));
    expect((reread[2] as (typeof ahead)[2] & { lead?: number }).lead).toBe(1);
    const rebuilt = JSON.parse(
      buildSceneRoute(again, reread).manifest_json,
    ) as RigDocument['manifest'];
    expect(sorted(rebuilt.oxidal!.graph)).toEqual(sorted(graph));
    // A split ahead of the scenes round-trips too.
    const split = routeSplitAt(
      reread,
      { split: null, path: 0, index: 1 },
      fx('pitch'),
    );
    const splitGraph = JSON.parse(buildSceneRoute(again, split).manifest_json)
      .oxidal.graph as Graph;
    expect(chainRoute(splitGraph)).toMatchObject([
      'comp',
      { branches: [['pitch'], []] },
      'drive',
      { branches: [['clean'], ['lead', 'echo']] },
    ]);
    // Removing them leaves the preset as it was.
    const back = routeRemove(routeRemove(reread, 'comp'), 'drive');
    const restored = JSON.parse(buildSceneRoute(again, back).manifest_json);
    expect(chainRoute(restored.oxidal.graph)).toEqual(
      chainRoute(document.manifest.oxidal!.graph),
    );
  });

it('moves an effect into and out of the scene lanes past their tones', () => {
  const document = scenes('cut');
  const route = routeInsertAt(
    readRoute(document, [plugin], {}),
    { split: null, path: 0, index: 0 },
    fx('comp'),
  );
  // Move ▶ next to the scenes steps in after the first scene's tone.
  const into = routeStep(route, 'comp', 1);
  expect(shape(into)).toEqual([
    [
      ['clean', 'comp'],
      ['lead', 'echo'],
    ],
  ]);
  expect(() => buildSceneRoute(document, into)).not.toThrow();
  // ▲ Path / Path ▼ keep it after the other scene's tone.
  expect(shape(routePathStep(into, 'comp', 1))).toEqual([
    [['clean'], ['lead', 'comp', 'echo']],
  ]);
  // Move ◀ next to a tone steps out ahead of the scenes again.
  expect(shape(routeStep(into, 'comp', -1))).toEqual(shape(route));
  // Adding at a scene path's first gap lands after its tone.
  expect(
    shape(
      routeInsertAt(
        route,
        { split: 'scene-input', path: 0, index: 0 },
        fx('x'),
      ),
    ),
  ).toEqual([
    'comp',
    [
      ['clean', 'x'],
      ['lead', 'echo'],
    ],
  ]);
  // A scene setting of an effect ahead of the scenes is kept.
  const withComp = {
    revision,
    manifest: JSON.parse(buildSceneRoute(document, route).manifest_json),
  } as RigDocument;
  type Scenes = { scenes: { controls?: object[] }[] };
  const ext = readScenes(withComp.manifest) as Scenes;
  for (const scene of ext.scenes)
    scene.controls = [{ node: 'comp', symbol: 'level', value: 1 }];
  const kept = JSON.parse(
    buildSceneRoute(withComp, readRoute(withComp, [plugin], {})).manifest_json,
  );
  expect((readScenes(kept) as Scenes).scenes.map((s) => s.controls)).toEqual([
    [{ node: 'comp', symbol: 'level', value: 1 }],
    [{ node: 'comp', symbol: 'level', value: 1 }],
  ]);
});
