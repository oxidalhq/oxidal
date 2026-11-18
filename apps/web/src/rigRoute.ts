import type { Lv2Plugin, RigDocument } from './api';
import type { RigPublish } from './generated/contract';
import { chainRoute, type IdStep, routePaths } from './rigChain';
import {
  type DraftEffect,
  type NativeDraft,
  rigBuilder,
  type Stereo,
  validateStages,
} from './rigDraft';
import { readBlock } from './rigEdit';
import { readScenes, sealScenes } from './sceneFormat';

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
  /** Left merge input gains per path; also the right ones unless `rightGains`. */
  gains: number[];
  /** Right merge gains, only when a path is panned (7.26). */
  rightGains?: number[];
  branches: Step[][];
  /** Steps at the start of every path that stay first there: a scene's tone.
   * Nothing is placed or moved ahead of them. */
  lead?: number;
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

/** The preset as a route; effect knobs take their live values. The scene
 * lanes' split keeps each scene's tone first (`lead`). */
export function readRoute(
  document: RigDocument,
  plugins: Lv2Plugin[],
  live: Record<string, Record<string, number>>,
): Route {
  const host = document.manifest.oxidal;
  const ids = host && chainRoute(host.graph);
  if (!host || !ids)
    throw new Error('This preset’s routing cannot be edited here.');
  const scenes = ids[sceneSplitIndex(ids, sceneTones(document.manifest))];
  const map = (steps: IdStep[]): Route =>
    steps.map((s) =>
      typeof s === 'string'
        ? readBlock(document, plugins, live, s)
        : {
            kind: 'split',
            split: s.split,
            merge: s.merge,
            gains: s.gains,
            ...(s.rightGains ? { rightGains: s.rightGains } : {}),
            branches: s.branches.map(map),
            ...(s === scenes ? { lead: 1 } : {}),
          },
    );
  return map(ids);
}

/** Rejects a route where one block appears twice; returns every block. */
function uniqueBlocks(route: Route): DraftEffect[] {
  const blocks = routeBlocks(route);
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id))
      throw new Error('A block can only be in one place. Remove one copy.');
    seen.add(b.id);
  }
  return blocks;
}

/**
 * Places a route's steps after `from` with a rig builder: blocks are chained,
 * each split gets its `-left`/`-right` split and merge pairs. `taken` holds
 * every node id already in use, so two splits never share a name.
 */
function placer(rig: ReturnType<typeof rigBuilder>, taken: Set<string>) {
  return function place(steps: Route, from: Stereo): Stereo {
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
          if (taken.has(`${base}-${side}`))
            throw new Error('Two splits share a name. Rebuild this split.');
          else taken.add(`${base}-${side}`);
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
          inputGains: step.branches.map((_, i) =>
            side === 'right'
              ? (step.rightGains?.[i] ?? step.gains[i] ?? 1)
              : (step.gains[i] ?? 1),
          ),
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
  };
}

/** The next version of the preset from its route. */
export function buildRoute(
  id: string,
  name: string,
  route: Route,
  profile: string,
): RigPublish {
  const blocks = uniqueBlocks(route);
  validateStages(blocks);
  const rig = rigBuilder(id, name, profile, false);
  const place = placer(rig, new Set(blocks.map((b) => b.id)));
  return rig.finish(place(route, rig.input));
}

/* ---------- Editing: every operation returns a new route. ---------- */

function clone(route: Route): Route {
  return route.map((s) =>
    isSplit(s)
      ? {
          ...s,
          gains: [...s.gains],
          ...(s.rightGains ? { rightGains: [...s.rightGains] } : {}),
          branches: s.branches.map(clone),
        }
      : s,
  );
}
/** Both sides' gain lists of a split, so a path edit keeps them in step. */
function sides(s: RouteSplit): number[][] {
  s.rightGains ??= [...s.gains];
  return [s.gains, s.rightGains];
}
/** Drops the right side again when no path is panned. */
function settle(s: RouteSplit) {
  if (
    s.rightGains &&
    s.rightGains.length === s.gains.length &&
    s.rightGains.every((g, i) => g === s.gains[i])
  )
    delete s.rightGains;
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
    const kept: { branch: Route; gain: number; right: number }[] = [];
    s.branches.forEach((b, i) => {
      const branch = tidy(b, dry);
      if (branch.length || dry.has(b))
        kept.push({
          branch,
          gain: s.gains[i] ?? 1,
          right: s.rightGains?.[i] ?? s.gains[i] ?? 1,
        });
    });
    if (!kept.some((k) => k.branch.length)) return [];
    if (kept.length === 1) return kept[0]!.branch;
    const split: RouteSplit = {
      ...s,
      branches: kept.map((k) => k.branch),
      gains: kept.map((k) => k.gain),
      rightGains: kept.map((k) => k.right),
    };
    settle(split);
    return [split];
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
  if (!at?.owner) throw new Error('Only a block inside a split has a path.');
  const b = at.branch!;
  at.owner.branches.splice(b + 1, 0, copySteps(at.owner.branches[b]!));
  for (const g of sides(at.owner)) g.splice(b + 1, 0, g[b] ?? 1);
  settle(at.owner);
  return next;
}

/** Add branch: a new dry path in the split that holds the block. */
export function routeAddBranch(route: Route, id: string): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at?.owner) throw new Error('Only a block inside a split has a path.');
  at.owner.branches.push([]);
  for (const g of sides(at.owner)) g.push(1);
  settle(at.owner);
  return next;
}

/** Remove branch: the branch holding the block, with every block on it. */
export function routeRemoveBranch(route: Route, id: string): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id);
  if (!at?.owner) throw new Error('Only a block inside a split has a path.');
  at.owner.branches[at.branch!]!.length = 0;
  dry.delete(at.owner.branches[at.branch!]!);
  return tidy(next, dry);
}

/**
 * Points TONE3000 block `id` at edited preset bytes (7.3): its settings were
 * changed in the native editor and saved as an owned copy. The block keeps its
 * id and place; an extracted amp/cab stage cannot be re-pointed this way.
 */
export function routeReplaceNative(
  route: Route,
  id: string,
  tone: Pick<NativeDraft, 'name' | 'preset' | 'source'>,
): Route {
  const next = clone(route);
  const at = locate(next, id);
  const block = at?.list[at.index];
  if (!block || isSplit(block) || block.kind !== 'native')
    throw new Error('That TONE3000 block is no longer in this preset.');
  if (block.stage)
    throw new Error(
      'An extracted amp or cab stage is edited with its whole tone in Rig.',
    );
  at!.list[at!.index] = { ...block, preset: tone.preset, source: tone.source };
  return next;
}

/* ---------- Offline editing by split id and path index (7.3). ---------- */

/** Split dialog (7.28): a new dry path in split `split`. */
export function routeSplitAddPath(route: Route, split: string): Route {
  const next = clone(route);
  const owner = findSplit(next, split);
  if (!owner) throw new Error('That split is no longer in this preset.');
  owner.branches.push([]);
  for (const g of sides(owner)) g.push(1);
  settle(owner);
  return next;
}

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
    for (const g of sides(s)) g.splice(path + 1, 0, g[path] ?? 1);
    settle(s);
    return next;
  }
  s.branches.splice(path, 1);
  for (const g of sides(s)) g.splice(path, 1);
  settle(s);
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

/** A path's level (0–4), pan (−1 left … 1 right) and polarity (7.26). */
export type PathMix = { level: number; pan: number; invert: boolean };

/** Reads a path's mix from its left and right merge gains. */
export function pathMix(left: number, right: number = left): PathMix {
  const level = Math.max(Math.abs(left), Math.abs(right));
  const invert = left < 0 || right < 0;
  if (level === 0) return { level: 0, pan: 0, invert };
  const pan =
    Math.abs(right) < Math.abs(left)
      ? -(1 - Math.abs(right) / level)
      : Math.abs(left) < Math.abs(right)
        ? 1 - Math.abs(left) / level
        : 0;
  return { level, pan, invert };
}

/** Left and right merge gains for a path mix: panning only lowers a side. */
export function mixGains(mix: PathMix): [number, number] {
  const level = Math.max(0, Math.min(4, mix.level));
  const pan = Math.max(-1, Math.min(1, mix.pan));
  const sign = mix.invert ? -1 : 1;
  const left = level * (pan > 0 ? 1 - pan : 1) * sign;
  const right = level * (pan < 0 ? 1 + pan : 1) * sign;
  // Never write −0: it reads back as an inverted path.
  return [left || 0, right || 0];
}

/** Sets a path's level, pan and polarity together. */
export function routePathMix(
  route: Route,
  split: string,
  path: number,
  mix: PathMix,
): Route {
  const next = clone(route);
  const s = findSplit(next, split);
  if (!s || path >= s.branches.length) return route;
  const [left, right] = mixGains(mix);
  const [gains, rightGains] = sides(s);
  gains![path] = left;
  rightGains![path] = right;
  settle(s);
  return next;
}

/** One path's level into its merge (0–4), keeping its pan and polarity. */
export function routePathGain(
  route: Route,
  split: string,
  path: number,
  gain: number,
): Route {
  const s = findSplit(route, split);
  if (!s || path >= s.branches.length) return route;
  const mix = pathMix(s.gains[path] ?? 1, s.rightGains?.[path]);
  return routePathMix(route, split, path, { ...mix, level: gain });
}

/* ---------- The rig canvas: gaps, moves across paths, replace. ---------- */

/** The most outputs one split node may have in the engine, so the most paths. */
export const MAX_PATHS = 64;

/** A gap in the chain: before step `index` of the top level (`split` null) or
 * of path `path` of split `split`; a split counts as one step. */
export type RouteAt = { split: string | null; path: number; index: number };

/** The list a gap is in, and the first index a block may take there (after a
 * scene's tone on a scene path). */
function listAt(route: Route, at: RouteAt): { list: Step[]; lead: number } {
  const owner = at.split === null ? null : findSplit(route, at.split);
  const list = at.split === null ? route : owner?.branches[at.path];
  if (!list) throw new Error('That place is no longer in this preset.');
  return { list, lead: Math.min(owner?.lead ?? 0, list.length) };
}
const within = (list: unknown[], index: number, lead = 0) =>
  Math.max(lead, Math.min(list.length, index));

/** Adds `effect` at a gap. */
export function routeInsertAt(
  route: Route,
  at: RouteAt,
  effect: DraftEffect,
): Route {
  const next = clone(route);
  const { list, lead } = listAt(next, at);
  list.splice(within(list, at.index, lead), 0, effect);
  return next;
}

/** Split here at a gap: Path 1 holds `effect`, Path 2 is dry ("Add effect"). */
export function routeSplitAt(
  route: Route,
  at: RouteAt,
  effect: DraftEffect,
): Route {
  const next = clone(route);
  const { list, lead } = listAt(next, at);
  list.splice(within(list, at.index, lead), 0, newSplit([[effect], []]));
  return next;
}

/** The list holding split `split` and its index there. */
function parentOf(
  route: Route,
  split: RouteSplit,
): { list: Step[]; index: number } | null {
  for (const [index, s] of route.entries()) {
    if (s === split) return { list: route, index };
    if (isSplit(s))
      for (const b of s.branches) {
        const found = parentOf(b, split);
        if (found) return found;
      }
  }
  return null;
}

/** Takes `block` out of `list`; the path it leaves stays as a dry path. */
function lift(list: Step[], block: Step, dry: Set<Step[]>) {
  list.splice(list.indexOf(block), 1);
  if (!list.length) dry.add(list);
}

/**
 * Drag and drop: block `id` moves to a gap, within its path or onto another.
 * The path it leaves stays as a dry path; a split left with no block dissolves.
 */
export function routeMoveTo(route: Route, id: string, at: RouteAt): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const from = locate(next, id);
  if (!from) return route;
  const block = from.list[from.index]!;
  const { list, lead } = listAt(next, at);
  const index = within(list, at.index, lead);
  if (list === from.list && (index === from.index || index === from.index + 1))
    return route;
  list.splice(index, 0, { ...(block as DraftEffect) });
  lift(from.list, block, dry);
  return tidy(next, dry);
}

/**
 * Move ◀ / Move ▶: one place earlier or later. Next to a split the block steps
 * into its first path (after a scene's tone); at either end of a path, or next
 * to a scene's tone, it steps out of its split.
 */
export function routeStep(route: Route, id: string, step: -1 | 1): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id);
  if (!at) return route;
  const block = at.list[at.index]!;
  const to = at.index + step;
  if (to >= (at.owner?.lead ?? 0) && to < at.list.length) {
    const neighbour = at.list[to]!;
    at.list.splice(at.index, 1);
    if (isSplit(neighbour)) {
      const path = neighbour.branches[0]!;
      if (step < 0) path.push(block);
      else path.splice(Math.min(neighbour.lead ?? 0, path.length), 0, block);
    } else at.list.splice(to, 0, block);
    return tidy(next, dry);
  }
  const parent = at.owner && parentOf(next, at.owner);
  if (!parent) return route;
  lift(at.list, block, dry);
  parent.list.splice(parent.index + (step > 0 ? 1 : 0), 0, block);
  return tidy(next, dry);
}

/** ▲ Path / Path ▼: the same place on the path above or below. */
export function routePathStep(route: Route, id: string, step: -1 | 1): Route {
  const next = clone(route);
  const dry = dryPaths(next);
  const at = locate(next, id);
  const to = at?.owner?.branches[at.branch! + step];
  if (!at || !to) return route;
  const block = at.list[at.index]!;
  lift(at.list, block, dry);
  to.splice(
    within(to, at.index, Math.min(at.owner!.lead ?? 0, to.length)),
    0,
    block,
  );
  return tidy(next, dry);
}

/** Replace…: another effect in the same place. */
export function routeReplace(
  route: Route,
  id: string,
  effect: DraftEffect,
): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at) throw new Error('That block is no longer in this preset.');
  at.list[at.index] = effect;
  return next;
}

/** Duplicate: a copy of the block, with a new id, right after it. */
export function routeDuplicate(route: Route, id: string): Route {
  const next = clone(route);
  const at = locate(next, id);
  if (!at) throw new Error('That block is no longer in this preset.');
  at.list.splice(at.index + 1, 0, ...copySteps([at.list[at.index]!]));
  return next;
}

/* ---------- Presets with scene lanes. ---------- */

type Manifest = RigDocument['manifest'];
type AnyStep = IdStep | Step;
const stepId = (s: AnyStep | undefined) =>
  s === undefined || typeof s === 'string'
    ? s
    : 'branches' in s
      ? undefined
      : s.id;

/** The TONE3000 tone of each scene branch, in scene order (none without). */
export function sceneTones(manifest: Manifest | undefined): string[] {
  const ext = manifest
    ? readScenes<{ branches?: { id?: unknown }[] }>(manifest)
    : undefined;
  return Array.isArray(ext?.branches)
    ? ext.branches.flatMap((b) => (typeof b.id === 'string' ? [b.id] : []))
    : [];
}

/** The top-level split whose paths are the scenes, each starting with its
 * tone; -1 when there is none. */
export function sceneSplitIndex(steps: AnyStep[], tones: string[]): number {
  if (!tones.length) return -1;
  return steps.findIndex(
    (s) =>
      typeof s === 'object' &&
      'branches' in s &&
      s.branches.length === tones.length &&
      (s.branches as AnyStep[][]).every((b, i) => stepId(b[0]) === tones[i]),
  );
}

/**
 * The next version of a preset with scene lanes. Each scene's path keeps its
 * tone first. Everything ahead of the scenes, everything after a scene's tone
 * (splits included) and everything after the scenes is rebuilt in the
 * existing manifest, so the scenes, their gates, the TONE3000 chains and their
 * resources are untouched and every saved scene recalls as before.
 */
export function buildSceneRoute(
  document: RigDocument,
  route: Route,
  name?: string,
): RigPublish {
  const tones = sceneTones(document.manifest);
  const before = document.manifest.oxidal
    ? chainRoute(document.manifest.oxidal.graph)
    : null;
  const was = before?.[sceneSplitIndex(before, tones)];
  if (!before || typeof was !== 'object')
    throw new Error('This preset’s routing cannot be edited here.');
  const sceneAt = sceneSplitIndex(route, tones);
  const scene = route[sceneAt];
  if (sceneAt < 0 || !isSplit(scene) || scene.split !== was.split)
    throw new Error(
      'Each scene keeps its own path, with its tone first. Add or remove scenes with the scene pads.',
    );
  const blocks = uniqueBlocks(route);
  validateStages(blocks);
  const ahead = route.slice(0, sceneAt);
  const behind = route.slice(sceneAt + 1);
  const rebuilt = [
    ...ahead,
    ...scene.branches.flatMap((b) => b.slice(1)),
    ...behind,
  ];
  if (routeBlocks(rebuilt).some((b) => b.kind !== 'lv2'))
    throw new Error(
      'Only effects go ahead of the scenes or after a scene’s tone.',
    );
  const manifest: Manifest = JSON.parse(JSON.stringify(document.manifest));
  if (name) manifest.name = name.trim();
  const authoring = (manifest.extensions['urn:oxidal:authoring'] ??= {});
  authoring.origin = 'mine';
  const labels = (authoring.labels ??= {}) as Record<string, string>;
  const host = manifest.oxidal!;
  const edges = host.graph.edges;
  const splitL = `${scene.split}-left`;
  const splitR = `${scene.split}-right`;
  const mergeL = `${scene.merge}-left`;
  const mergeR = `${scene.merge}-right`;
  const input = host.graph.nodes.find((n) => n.kind === 'input')?.id ?? 'in';
  const output = host.graph.nodes.find((n) => n.kind === 'output')?.id ?? 'out';
  /** Every node after `starts` and before `stops`: the part that is rebuilt. */
  const reach = (starts: string[], stops: Set<string>) => {
    const found = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges)
        if (
          e.from.node === id &&
          !stops.has(e.to.node) &&
          !found.has(e.to.node)
        ) {
          found.add(e.to.node);
          queue.push(e.to.node);
        }
    }
    return found;
  };
  const removed = new Set([
    ...reach([input], new Set([splitL, splitR])),
    ...tones.flatMap((t) => [...reach([t], new Set([mergeL, mergeR]))]),
    ...reach([mergeL, mergeR], new Set([output])),
  ]);
  const starts = new Set([input, ...tones, mergeL, mergeR]);
  const instances = new Set(
    host.graph.nodes.filter((n) => removed.has(n.id)).map((n) => n.instance),
  );
  host.graph.edges = edges.filter(
    (e) =>
      !removed.has(e.from.node) &&
      !removed.has(e.to.node) &&
      !starts.has(e.from.node),
  );
  host.graph.nodes = host.graph.nodes.filter((n) => !removed.has(n.id));
  host.lv2 = host.lv2.filter((l) => !instances.has(l.id));
  for (const id of removed) delete labels[id];
  const rig = rigBuilder(manifest.id, manifest.name, '', false, manifest);
  const place = placer(
    rig,
    new Set([...host.graph.nodes.map((n) => n.id), ...blocks.map((b) => b.id)]),
  );
  const link = (from: Stereo, to: Stereo) =>
    host.graph.edges.push(
      { from: from[0], to: to[0] },
      { from: from[1], to: to[1] },
    );
  const head = place(ahead, [
    { node: input, port: 0 },
    { node: input, port: 1 },
  ]);
  link(head, [
    { node: splitL, port: 0 },
    { node: splitR, port: 0 },
  ]);
  scene.branches.forEach((branch, port) => {
    const tone = stepId(branch[0])!;
    const end = place(branch.slice(1), [
      { node: tone, port: 0 },
      { node: tone, port: 1 },
    ]);
    link(end, [
      { node: mergeL, port },
      { node: mergeR, port },
    ]);
  });
  const end = place(behind, [
    { node: mergeL, port: 0 },
    { node: mergeR, port: 0 },
  ]);
  link(end, [
    { node: output, port: 0 },
    { node: output, port: 1 },
  ]);
  // Scene settings of an effect that was removed or replaced go with it, as
  // `keepScenes` does for presets without scene lanes.
  const effects = new Set(host.lv2.map((l) => l.id));
  const scenes = readScenes<{ scenes?: { controls?: { node: string }[] }[] }>(
    manifest,
  );
  for (const item of scenes?.scenes ?? []) {
    if (!item.controls) continue;
    item.controls = item.controls.filter((c) => effects.has(c.node));
    if (!item.controls.length) delete item.controls;
  }
  return {
    manifest_json: JSON.stringify(sealScenes(manifest)),
    resources: Object.fromEntries(
      manifest.resources.map((r) => [
        r.id,
        { kind: 'bundle', revision: document.revision, resource: r.id },
      ]),
    ),
  };
}
