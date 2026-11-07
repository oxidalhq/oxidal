import type { ReactNode } from 'react';
import { glyphFor, glyphs } from './blockGlyphs';

/**
 * Engine-neutral chain view model shared by native, hybrid and LV2 rigs.
 * @see docs/interface.md
 */
/** LED category shared with footswitch LEDs; never used as a fill. */
export type BlockKind =
  'amp' | 'pedal' | 'cab' | 'time' | 'mod' | 'lv2' | 'other';

export interface RigBlockVM {
  id: string;
  label: string;
  kind: BlockKind;
  on: boolean;
  /** Model artwork or gear glyph drawn inside the tile face. */
  face: ReactNode;
  /** An empty slot: drawn as a + tile where a block can be added. */
  empty?: boolean;
}

export interface RigLaneVM {
  id: string;
  input: string;
  /** A short tag when a screen shows several lanes together, such as L or R. */
  tag?: string;
  blocks: RigBlockVM[];
  /** Shown but not sounding, such as another scene's branch. */
  dim?: boolean;
  /** This lane currently contributes signal to the sounding scene. */
  active?: boolean;
  /** A readable name for a branch lane, such as the scene it belongs to. */
  name?: string;
}

/** LED family follows the block's glyph, so an LV2 delay lights like a delay. */
export function blockKind(gear: string, name = '', format?: string): BlockKind {
  if (format === 'ir') return 'cab';
  return glyphs[glyphFor(gear, name)].kind;
}

type Graph = {
  nodes: { id: string; kind: string; inputGains?: number[] | null }[];
  edges?: {
    from: { node: string; port: number };
    to: { node: string; port: number };
  }[];
};

/**
 * True only for a player-facing sound block. Split, merge and gain nodes are
 * routing machinery: the chain draws their wires but never offers them as gear.
 * @see docs/interface.md
 */
export function isRigBlockNode(node: Graph['nodes'][number]): boolean {
  return node.kind === 'tone3000' || node.kind === 'lv2';
}

/** A graph read as a routing tree of block ids (7.26). */
export type IdStep =
  | string
  | {
      /** Shared id of the `-left`/`-right` split and merge node pairs. */
      split: string;
      merge: string;
      /** Merge input gains per branch, read from the left merge. */
      gains: number[];
      branches: IdStep[][];
    };

/**
 * A preset's graph as a routing tree, read along the left channel: blocks in
 * order, with each split holding its branches (any number, nested, or empty for
 * a dry path) until the merge they all join. Mono adapters are skipped. Null for
 * any other shape, or when a split/merge lacks its right-channel twin, so an
 * imported topology is never rewritten by an editor that cannot represent it.
 * @see docs/interface.md
 */
export function chainRoute(graph: Graph): IdStep[] | null {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const kind = (id: string) => nodes.get(id)?.kind;
  const edges = graph.edges ?? [];
  const from = (id: string) => edges.filter((e) => e.from.node === id);
  const sources = (id: string) =>
    new Set(edges.filter((e) => e.to.node === id).map((e) => e.from.node));
  const adapter = (id: string) => /-(mono|stereo)$/.test(id);
  const branches = (id: string) =>
    kind(id) === 'split' && !adapter(id) && from(id).length > 1;
  const joins = (id: string) =>
    kind(id) === 'merge' && !adapter(id) && sources(id).size > 1;
  const block = (id: string) => ['tone3000', 'lv2'].includes(kind(id) ?? '');
  const next = (id: string) => from(id).find((e) => e.from.port === 0)?.to.node;
  const pair = (id: string) => {
    const base = id.endsWith('-left') ? id.slice(0, -'-left'.length) : null;
    return base && nodes.has(`${base}-right`) ? base : null;
  };
  let guard = 0;
  function seq(
    start: string | undefined,
  ): { steps: IdStep[]; stop: string } | null {
    const steps: IdStep[] = [];
    let id = start;
    while (id && guard++ < 4096) {
      if (id === 'out' || kind(id) === 'output' || joins(id))
        return { steps, stop: id };
      if (branches(id)) {
        const split = pair(id);
        const ports = from(id).sort((a, b) => a.from.port - b.from.port);
        const read = ports.map((e) => seq(e.to.node));
        const join = read[0]?.stop;
        if (!split || !join || read.some((r) => !r || r.stop !== join))
          return null;
        const merge = pair(join);
        if (!merge || !joins(join)) return null;
        const gains = nodes.get(join)?.inputGains ?? [];
        steps.push({
          split,
          merge,
          gains: ports.map((_, i) => gains[i] ?? 1),
          branches: read.map((r) => r!.steps),
        });
        id = next(join);
        continue;
      }
      if (block(id)) steps.push(id);
      id = next(id);
    }
    return null;
  }
  const top = seq(next('in'));
  return top && (top.stop === 'out' || kind(top.stop) === 'output')
    ? top.steps
    : null;
}

/** Every input-to-output path through a routing tree, as lanes of block ids. */
export function routePaths<T>(
  steps: (T | { branches: (T | object)[][] })[],
  isSplit: (step: unknown) => step is { branches: unknown[][] },
): T[][] {
  let acc: T[][] = [[]];
  for (const step of steps) {
    if (isSplit(step)) {
      const sub = step.branches.flatMap((b) =>
        routePaths(b as typeof steps, isSplit),
      );
      acc = acc.flatMap((p) => sub.map((s) => [...p, ...s]));
    } else acc = acc.map((p) => [...p, step as T]);
  }
  return acc;
}

const isIdSplit = (step: unknown): step is Exclude<IdStep, string> =>
  typeof step === 'object' && step !== null && 'branches' in step;

/** Lanes the chain view can draw: at most this many paths. */
const MAX_CHAIN_LANES = 16;

/**
 * The blocks of a preset's graph as chain lanes: one per input-to-output path
 * through its routing tree (shared blocks repeat in each lane). Null when the
 * graph is not a routing tree or has too many paths to draw as lanes.
 * @see docs/interface.md
 */
export function chainLanes(graph: Graph): string[][] | null {
  const route = chainRoute(graph);
  if (!route) return null;
  const lanes = routePaths<string>(route, isIdSplit);
  return lanes.length <= MAX_CHAIN_LANES ? lanes : null;
}

/** Whether block `id` sits inside a split's branch: that split's path count,
 * its merge node base and the path's merge port. */
export function routeBranchOf(route: IdStep[] | null, id: string) {
  type Found = { paths: number; merge: string; port: number } | null;
  const look = (steps: IdStep[], owner: Found): Found | undefined => {
    for (const s of steps) {
      if (s === id) return owner;
      if (typeof s !== 'string')
        for (const [port, b] of s.branches.entries()) {
          const found = look(b, {
            paths: s.branches.length,
            merge: s.merge,
            port,
          });
          if (found !== undefined) return found;
        }
    }
    return undefined;
  };
  const owner = route ? look(route, null) : undefined;
  return {
    found: owner !== undefined,
    paths: owner?.paths ?? 0,
    merge: owner?.merge ?? '',
    port: owner?.port ?? 0,
  };
}
