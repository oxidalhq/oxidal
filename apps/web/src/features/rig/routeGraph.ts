import type { GlyphKey } from '@oxidal/design-system/lib/block-glyphs';
import type {
  ChainGraph,
  GraphEdge,
  GraphNode,
} from '@oxidal/design-system/lib/chain-graph';

import { panLabel } from '../../lib/panLabel';
import type { BlockKind, IdStep, RigBlockVM } from '../../rigChain';
import { pathMix, type RouteAt } from '../../rigRoute';

/**
 * The chain as blocks and connections, for the map view. The route is a
 * chain of steps in which a split holds paths, each path a chain that may
 * split again. Every connection remembers where it sits in that route, so a +
 * on it and a block dropped on it use the same positions as the tree view.
 * @see docs/interface.md
 */

type Split = Exclude<IdStep, string>;

/** Scene lanes: the split whose paths are the scenes. */
export type SceneInfo = {
  split: string;
  names: string[];
  sounding: number | null;
  enabled?: (boolean | undefined)[];
};

export type RouteGraph = {
  graph: ChainGraph;
  /** The route position of a connection, by `edgeKey`. */
  at: Map<string, RouteAt>;
  /** Connections that end in an empty path (they offer "add an effect"). */
  emptyPaths: Set<string>;
  /**
   * Connections inside one TONE3000 chain, by `edgeKey`: the tile they lead
   * to. A block can be added there while the chain has a free position.
   */
  inner: Map<string, string>;
  /** The route block each drawn tile belongs to. */
  block: Map<string, string>;
  /** The tile for each block node. */
  tile: Map<string, RigBlockVM>;
  /** What to say above each parallel path, by lane number. */
  lanes: string[];
  /** Blocks on a path that is not the one sounding. */
  silent: Set<string>;
  /** Split ids in the order they are drawn, to say "split 2". */
  splits: string[];
  /** Silent scene paths of a scene split with many paths: they can be folded. */
  foldable: { name: string; path: number }[];
};

export const edgeKey = ([a, b]: GraphEdge) => `${a}>${b}`;
const top = (index: number): RouteAt => ({ split: null, path: 0, index });

const GLYPH: Record<BlockKind, GlyphKey> = {
  amp: 'amp',
  cab: 'cab',
  pedal: 'pedal',
  time: 'delay',
  mod: 'chorus',
  lv2: 'plugin',
  other: 'plugin',
};

/** Path 1 · 100% · Centre. */
function caption(split: Split, path: number) {
  const mix = pathMix(split.gains[path] ?? 1, split.rightGains?.[path]);
  return [
    `Path ${path + 1}`,
    `${Math.round(mix.level * 100)}%`,
    panLabel(mix.pan),
    ...(mix.invert ? ['inverted'] : []),
  ].join(' · ');
}

/** Rows a list of steps needs: a split stacks its paths. */
function height(steps: IdStep[]): number {
  return Math.max(
    1,
    ...steps.map((s) =>
      typeof s === 'string'
        ? 1
        : s.branches.reduce((sum, b) => sum + height(b), 0),
    ),
  );
}

export function routeGraph(
  route: IdStep[],
  tiles: (id: string) => RigBlockVM[],
  options: {
    scenes?: SceneInfo | null;
    plain?: boolean;
    /** Whether an empty slot in a TONE3000 block can be filled; without it none is drawn. */
    slots?: boolean;
    /** The block now selected; a path holding it is never folded away. */
    selected?: string;
    /** Whether silent scene paths are drawn. Folded away when false. */
    expanded?: boolean;
  } = {},
): RouteGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const at = new Map<string, RouteAt>();
  const emptyPaths = new Set<string>();
  const inner = new Map<string, string>();
  const block = new Map<string, string>();
  const tile = new Map<string, RigBlockVM>();
  const lanes: string[] = [];
  const silent = new Set<string>();
  const splits: string[] = [];
  const foldable: { name: string; path: number }[] = [];
  const holds = (steps: IdStep[]): boolean =>
    !!options.selected &&
    steps.some((s) =>
      typeof s === 'string'
        ? tiles(s).some((t) => t.id === options.selected)
        : s.branches.some(holds),
    );
  const total = height(route);
  const mid = (total - 1) / 2;

  const link = (from: string[], to: string, where?: RouteAt, empty = false) => {
    for (const f of from) {
      const e: GraphEdge = [f, to];
      edges.push(e);
      if (where) at.set(edgeKey(e), where);
      if (empty) emptyPaths.add(edgeKey(e));
    }
  };

  /** Draw a list of steps in rows [first, first + rows), returning where it ends. */
  const build = (
    steps: IdStep[],
    owner: { split: Split; path: number } | null,
    first: number,
    rows: number,
    start: string[],
    lane: number | undefined,
    sounding: boolean,
  ): string[] => {
    const here = first + (rows - 1) / 2;
    const gap = (index: number): RouteAt =>
      owner
        ? { split: owner.split.split, path: owner.path, index }
        : top(index);
    let cur = start;
    steps.forEach((step, index) => {
      if (typeof step === 'string') {
        let prev = cur;
        // A run of empty slots is drawn as one + that adds at the first, as in the tree.
        const drawn = tiles(step).filter(
          (t, i, all) => !(t.empty && all[i - 1]?.empty),
        );
        drawn.forEach((t, k) => {
          if (t.empty && options.slots === false) return;
          const id = t.id;
          nodes.push({
            id,
            // A free slot is a small round +, as Storybook draws a place to
            // add, never a card with a light that reads as a block.
            kind: t.empty ? 'slot' : 'block',
            glyph: GLYPH[t.kind],
            name: t.empty ? 'Add a block here' : t.label,
            col: 0,
            row: here,
            ...(lane !== undefined ? { lane } : {}),
          });
          block.set(id, step);
          tile.set(id, t);
          if (!sounding) silent.add(id);
          link(prev, id, k === 0 ? gap(index) : undefined);
          // A line inside the chain, before a block, while a position is free.
          if (k > 0 && !t.empty && drawn.some((d) => d.empty))
            for (const from of prev) inner.set(edgeKey([from, id]), id);
          prev = [id];
        });
        cur = prev;
        return;
      }
      // A split: a small round node, one chain per path, and a merge.
      splits.push(step.split);
      const splitNode = `${step.split}:split`;
      const mergeNode = `${step.split}:merge`;
      const scene =
        options.scenes?.split === step.split ? options.scenes : null;
      // Many scene paths: the ones confirmed silent can fold away, as in the tree.
      const hidden = new Set<number>();
      if (scene && step.branches.length > 3)
        step.branches.forEach((b, path) => {
          if (scene.enabled?.[path] === false && !holds(b)) {
            foldable.push({
              name: scene.names[path] ?? `Scene ${path + 1}`,
              path,
            });
            if (options.expanded === false) hidden.add(path);
          }
        });
      const need = step.branches.map((b, path) =>
        hidden.has(path) ? 0 : height(b),
      );
      const used = need.reduce((a, b) => a + b, 0);
      nodes.push({
        id: splitNode,
        kind: 'cap',
        name: '◆',
        col: 0,
        row: here,
        ...(lane !== undefined ? { lane } : {}),
      });
      link(cur, splitNode, gap(index));
      let row = here - (used - 1) / 2;
      const ends: string[] = [];
      step.branches.forEach((branch, path) => {
        if (hidden.has(path)) return;
        const mine = lanes.length;
        const isSounding = scene
          ? (scene.enabled?.[path] ?? scene.sounding === path)
          : true;
        lanes.push(
          scene
            ? `${path + 1} ${scene.names[path] ?? ''}${isSounding ? ' · Sounding' : ''}`.trim()
            : options.plain
              ? `Path ${path + 1}`
              : caption(step, path),
        );
        const h = need[path] ?? 1;
        const nextSounding = sounding && isSounding;
        if (branch.length === 0) {
          const dry = `${step.split}:dry:${path}`;
          nodes.push({
            id: dry,
            kind: 'cap',
            name: 'Dry',
            col: 0,
            row: row + (h - 1) / 2,
            lane: mine,
          });
          link([splitNode], dry, { split: step.split, path, index: 0 }, true);
          ends.push(dry);
        } else {
          const out = build(
            branch,
            { split: step, path },
            row,
            h,
            [splitNode],
            mine,
            nextSounding,
          );
          // The end of a path is a gap too: add an effect after the last block.
          for (const e of out) {
            edges.push([e, mergeNode]);
            at.set(edgeKey([e, mergeNode]), {
              split: step.split,
              path,
              index: branch.length,
            });
          }
          ends.push(...out);
        }
        row += h;
      });
      nodes.push({
        id: mergeNode,
        kind: 'cap',
        name: 'Σ',
        col: 0,
        row: here,
        ...(lane !== undefined ? { lane } : {}),
      });
      for (const d of ends.filter((e) => e.includes(':dry:'))) {
        edges.push([d, mergeNode]);
      }
      cur = [mergeNode];
    });
    return cur;
  };

  nodes.push({ id: 'in', kind: 'cap', name: 'IN', col: 0, row: mid });
  const end = build(route, null, 0, total, ['in'], undefined, true);
  nodes.push({ id: 'out', kind: 'cap', name: 'OUT', col: 0, row: mid });
  for (const e of end) {
    edges.push([e, 'out']);
    at.set(edgeKey([e, 'out']), top(route.length));
  }
  return {
    graph: { nodes, edges },
    at,
    emptyPaths,
    inner,
    block,
    tile,
    lanes,
    silent,
    splits,
    foldable,
  };
}
