import type { Lv2Plugin, RigDocument } from './api';
import type { RigPublish } from './generated/contract';
import { chainRoute, routePaths, type IdStep } from './rigChain';
import {
  rigBuilder,
  validateStages,
  type DraftEffect,
  type Stereo,
} from './rigDraft';
import { readBlock } from './rigEdit';

/**
 * The general routing model (7.26): a chain of blocks where a split holds any
 * number of branches, each a chain that may itself split, and an empty branch
 * is an explicit dry path. Splits and merges keep their node ids and merge
 * gains, so an edit rebuilds the same graph around the change.
 * @see docs/interface.md
 */
export type RouteSplit = {
  kind: 'split';
  split: string;
  merge: string;
  gains: number[];
  branches: Step[][];
};
type Step = DraftEffect | RouteSplit;
export type Route = Step[];

export const isSplit = (step: unknown): step is RouteSplit =>
  typeof step === 'object' &&
  step !== null &&
  (step as { kind?: string }).kind === 'split';

/** The blocks of a route in order, every branch included. */
function routeBlocks(route: Route): DraftEffect[] {
  return route.flatMap((s) =>
    isSplit(s) ? s.branches.flatMap(routeBlocks) : [s],
  );
}

/** Every input-to-output path, as the lanes the chain view draws. */
export function routeLanes(route: Route): DraftEffect[][] {
  return routePaths<DraftEffect>(route, isSplit);
}

/** The preset as a route; effect knobs take their live values. */
export function readRoute(
  document: RigDocument,
  plugins: Lv2Plugin[],
  live: Record<string, Record<string, number>>,
): Route {
  const host = document.manifest.oxidal;
  const ids = host && chainRoute(host.graph);
  if (!host || !ids)
    throw new Error('This preset’s routing cannot be edited here.');
  const map = (steps: IdStep[]): Route =>
    steps.map((s) =>
      typeof s === 'string'
        ? readBlock(document, plugins, live, s)
        : {
            kind: 'split',
            split: s.split,
            merge: s.merge,
            gains: s.gains,
            branches: s.branches.map(map),
          },
    );
  return map(ids);
}

/** The next version of the preset from its route. */
export function buildRoute(
  id: string,
  name: string,
  route: Route,
  profile: string,
): RigPublish {
  const blocks = routeBlocks(route);
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id))
      throw new Error('A block can only be in one place. Remove one copy.');
    seen.add(b.id);
  }
  validateStages(blocks);
  const rig = rigBuilder(id, name, profile, false);
  const nodes = new Set<string>();
  function place(steps: Route, from: Stereo): Stereo {
    let run: DraftEffect[] = [];
    let at = from;
    for (const step of steps) {
      if (!isSplit(step)) {
        run.push(step);
        continue;
      }
      at = rig.chain(run, at);
      run = [];
      const n = step.branches.length;
      if (n < 2 || step.branches.every((b) => !b.length))
        throw new Error('A split needs two paths and a block on one of them.');
      for (const base of [step.split, step.merge])
        for (const side of ['left', 'right'])
          if (nodes.has(`${base}-${side}`) || seen.has(`${base}-${side}`))
            throw new Error('Two splits share a name. Rebuild this split.');
          else nodes.add(`${base}-${side}`);
      const splits = (['left', 'right'] as const).map((side, port) => {
        const node = `${step.split}-${side}`;
        rig.host.graph.nodes.push({
          id: node,
          kind: 'split',
          audioInputs: 1,
          audioOutputs: n,
        });
        rig.host.graph.edges.push({ from: at[port]!, to: { node, port: 0 } });
        rig.labels[node] = `Split · ${side === 'left' ? 'L' : 'R'}`;
        return node;
      });
      const ends = step.branches.map((branch, index) =>
        place(branch, [
          { node: splits[0]!, port: index },
          { node: splits[1]!, port: index },
        ]),
      );
      const merges = (['left', 'right'] as const).map((side, port) => {
        const node = `${step.merge}-${side}`;
        rig.host.graph.nodes.push({
          id: node,
          kind: 'merge',
          audioInputs: n,
          audioOutputs: 1,
          inputGains: step.branches.map((_, i) => step.gains[i] ?? 1),
        });
        ends.forEach((end, index) =>
          rig.host.graph.edges.push({
            from: end[port]!,
            to: { node, port: index },
          }),
        );
        rig.labels[node] = `Merge · ${side === 'left' ? 'L' : 'R'}`;
        return { node, port: 0 };
      });
      at = [merges[0]!, merges[1]!];
    }
    return rig.chain(run, at);
  }
  return rig.finish(place(route, rig.input));
}

/* ---------- Editing: every operation returns a new route. ---------- */

function clone(route: Route): Route {
  return route.map((s) =>
    isSplit(s)
      ? { ...s, gains: [...s.gains], branches: s.branches.map(clone) }
      : s,
  );
}
/** Empty branches that were already dry paths before an edit. */
function dryPaths(route: Route, found = new Set<Step[]>()) {
  for (const s of route)
    if (isSplit(s))
      for (const b of s.branches) {
        if (!b.length) found.add(b);
        dryPaths(b, found);
      }
  return found;
}
/** A branch emptied by an edit goes; a split left with one path dissolves. */
function tidy(route: Route, dry: Set<Step[]>): Route {
  return route.flatMap((s): Step[] => {
    if (!isSplit(s)) return [s];
    const kept: { branch: Route; gain: number }[] = [];
    s.branches.forEach((b, i) => {
      const branch = tidy(b, dry);
      if (branch.length || dry.has(b))
        kept.push({ branch, gain: s.gains[i] ?? 1 });
    });
    if (!kept.some((k) => k.branch.length)) return [];
    if (kept.length === 1) return kept[0]!.branch;
    return [
      {
        ...s,
        branches: kept.map((k) => k.branch),
        gains: kept.map((k) => k.gain),
      },
    ];
  });
}
type Place = { list: Step[]; index: number; depth: number };
type Anchor = Place & { block?: DraftEffect };
function anchors(list: Step[], depth = 0): Anchor[][] {
  if (!list.length) return [[{ list, index: 0, depth }]];
  let acc: Anchor[][] = [[]];
  list.forEach((step, index) => {
    if (isSplit(step)) {
      const sub = step.branches.flatMap((b) => anchors(b, depth + 1));
      acc = acc.flatMap((p) => sub.map((s) => [...p, ...s]));
    } else acc = acc.map((p) => [...p, { list, index, depth, block: step }]);
  });
  return acc;
}
/** Where a block placed at `index` of lane `lane` goes: the place belonging
 * to that lane alone (the deepest branch at that point) wins. */
function placeIn(route: Route, lane: number, index: number): Place {
  const path = anchors(route)[lane] ?? anchors(route).at(-1)!;
  const blocks = path.filter((a) => a.block);
  const at = Math.max(0, Math.min(blocks.length, index));
  const a = blocks[at - 1];
  const b = blocks[at];
  const lo = a ? path.indexOf(a) : -1;
  const hi = b ? path.indexOf(b) : path.length;
  const candidates: Place[] = [
    ...(a ? [{ list: a.list, index: a.index + 1, depth: a.depth }] : []),
    ...path.slice(lo + 1, hi).filter((x) => !x.block),
    ...(b ? [{ list: b.list, index: b.index, depth: b.depth }] : []),
  ];
  return candidates.reduce((best, c) => (c.depth > best.depth ? c : best));
}
function locate(
  route: Route,
  id: string,
): { list: Step[]; index: number; owner?: RouteSplit; branch?: number } | null {
  for (let index = 0; index < route.length; index++) {
    const s = route[index]!;
    if (!isSplit(s)) {
      if (s.id === id) return { list: route, index };
      continue;
    }
    for (let b = 0; b < s.branches.length; b++) {
      const found = locate(s.branches[b]!, id);
      if (found) return found.owner ? found : { ...found, owner: s, branch: b };
    }
  }
  return null;
}

/** Inserts `effect` at `index` of lane `lane`, as the chain view counts it. */
export function routeInsert(
  route: Route,
  lane: number,
  index: number,
  effect: DraftEffect,
): Route {
  const next = clone(route);
  const at = placeIn(next, lane, index);
  at.list.splice(at.index, 0, effect);
  return next;
}

/** Removes a block; an emptied branch goes and a lone path dissolves its split. */
export function routeRemove(route: Route, id: string): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id);
  if (at) at.list.splice(at.index, 1);
  return tidy(next, dry);
}

/** Moves a block to `index` of `lane` (its own lane by default), counted
 * without the block. */
export function routeMove(
  route: Route,
  id: string,
  index: number,
  lane?: number,
): Route {
  const lanes = routeLanes(route);
  const from = lanes.findIndex((l) => l.some((b) => b.id === id));
  if (from < 0) return route;
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id)!;
  const [moving] = at.list.splice(at.index, 1);
  const to = placeIn(next, lane ?? from, index);
  to.list.splice(to.index, 0, moving!);
  return tidy(next, dry);
}

const fresh = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
function newSplit(branches: Route[]): RouteSplit {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    kind: 'split',
    split: `split-${tag}`,
    merge: `merge-${tag}`,
    gains: branches.map(() => 1),
    branches,
  };
}

/**
 * Add parallel path: the block gets a dry path beside it, inside a new split.
 * Inside a branch this nests a split; beside a cab it starts a dual cab, whose
 * empty path then takes a second cab block. Nothing is duplicated.
 */
export function routeAddPath(route: Route, id: string): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at) throw new Error('That block is not in this preset.');
  const block = at.list[at.index] as DraftEffect;
  at.list.splice(at.index, 1, newSplit([[block], []]));
  return next;
}

/** Copies a block, or a whole branch, with new ids. Extracted amp/cab stages
 * share one source allocation, so they cannot be copied (no backend support). */
function copySteps(steps: Route): Route {
  return steps.map((s): Step => {
    if (isSplit(s)) return newSplit(s.branches.map(copySteps));
    if (s.kind === 'native' && s.stage)
      throw new Error(
        'An extracted amp or cab stage cannot be copied. Copy the whole tone instead.',
      );
    return { ...s, id: fresh(s.kind === 'native' ? 'tone' : 'effect') };
  });
}

/** Copy branch: the branch holding the block, again beside it. */
export function routeCopyBranch(route: Route, id: string): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at?.owner) throw new Error('Only a block inside a split has a branch.');
  const b = at.branch!;
  at.owner.branches.splice(b + 1, 0, copySteps(at.owner.branches[b]!));
  at.owner.gains.splice(b + 1, 0, at.owner.gains[b] ?? 1);
  return next;
}

/** Add branch: a new dry path in the split that holds the block. */
export function routeAddBranch(route: Route, id: string): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at?.owner) throw new Error('Only a block inside a split has a branch.');
  at.owner.branches.push([]);
  at.owner.gains.push(1);
  return next;
}

/** Remove branch: the branch holding the block, with every block on it. */
export function routeRemoveBranch(route: Route, id: string): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id);
  if (!at?.owner) throw new Error('Only a block inside a split has a branch.');
  at.owner.branches[at.branch!]!.length = 0;
  dry.delete(at.owner.branches[at.branch!]!);
  return tidy(next, dry);
}

/* ---------- Offline editing by split id and path index (7.3). ---------- */

function findSplit(route: Route, split: string): RouteSplit | null {
  for (const s of route)
    if (isSplit(s)) {
      if (s.split === split) return s;
      for (const b of s.branches) {
        const found = findSplit(b, split);
        if (found) return found;
      }
    }
  return null;
}

/** Adds `effect` at the end of the preset, or of one path of a split. */
export function routeAppend(
  route: Route,
  effect: DraftEffect,
  at?: { split: string; path: number },
): Route {
  const next = clone(route);
  const list = at ? findSplit(next, at.split)?.branches[at.path] : next;
  if (!list) throw new Error('That path is no longer in this preset.');
  list.push(effect);
  return next;
}

/** Copy path / Remove path for any path of a split, dry paths included. */
export function routePath(
  route: Route,
  split: string,
  path: number,
  action: 'copy' | 'remove',
): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const s = findSplit(next, split);
  const branch = s?.branches[path];
  if (!s || !branch) throw new Error('That path is no longer in this preset.');
  if (action === 'copy') {
    s.branches.splice(path + 1, 0, copySteps(branch));
    s.gains.splice(path + 1, 0, s.gains[path] ?? 1);
    return next;
  }
  s.branches.splice(path, 1);
  s.gains.splice(path, 1);
  return tidy(next, dry);
}

/** One step earlier or later among its neighbours; a split counts as one step. */
export function routeShift(route: Route, id: string, step: -1 | 1): Route {
  const next = clone(route);
  const at = locate(next, id);
  const to = at ? at.index + step : -1;
  if (!at || to < 0 || to >= at.list.length) return route;
  const [moving] = at.list.splice(at.index, 1);
  at.list.splice(to, 0, moving!);
  return next;
}

/** Sets one effect control in the draft. */
export function routeControl(
  route: Route,
  id: string,
  symbol: string,
  value: number,
): Route {
  const next = clone(route);
  const at = locate(next, id);
  const block = at?.list[at.index];
  if (!block || isSplit(block) || block.kind !== 'lv2') return route;
  at!.list[at!.index] = {
    ...block,
    controls: { ...block.controls, [symbol]: value },
  };
  return next;
}
