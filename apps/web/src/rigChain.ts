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
  nodes: { id: string; kind: string }[];
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

/**
 * The blocks of a preset's graph as chain lanes, read along the left channel:
 * one lane for a straight chain, or one per side of a split (blocks shared
 * before the split or after the merge join each lane). Mono adapters are
 * skipped. Null when the graph is not one of these shapes.
 * @see docs/interface.md
 */
export function chainLanes(graph: Graph): string[][] | null {
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const edges = graph.edges ?? [];
  const from = (id: string) => edges.filter((e) => e.from.node === id);
  const sources = (id: string) =>
    new Set(edges.filter((e) => e.to.node === id).map((e) => e.from.node));
  // Mono adapters (`<effect>-mono`, `<effect>-stereo`) pass a lane through.
  const adapter = (id: string) => /-(mono|stereo)$/.test(id);
  const branches = (id: string) =>
    kind.get(id) === 'split' &&
    !adapter(id) &&
    new Set(from(id).map((e) => e.to.node)).size > 1;
  const joins = (id: string) =>
    kind.get(id) === 'merge' && !adapter(id) && sources(id).size > 1;
  const block = (id: string) =>
    ['tone3000', 'lv2'].includes(kind.get(id) ?? '');
  /** Follows port 0 from `start` to the output, a branching split or a join. */
  function walk(start: string | undefined) {
    const path: string[] = [];
    let id = start;
    for (let guard = 0; id && guard < 512; guard++) {
      if (
        id === 'out' ||
        kind.get(id) === 'output' ||
        joins(id) ||
        branches(id)
      )
        return { path, stop: id };
      if (block(id)) path.push(id);
      id = from(id).find((e) => e.from.port === 0)?.to.node;
    }
    return { path, stop: undefined };
  }
  const next = (id: string) => from(id).find((e) => e.from.port === 0)?.to.node;
  const head = walk(next('in'));
  if (!head.stop) return null;
  if (!branches(head.stop)) return [head.path];
  const targets = [
    ...new Set(
      from(head.stop)
        .sort((a, b) => a.from.port - b.from.port)
        .map((e) => e.to.node),
    ),
  ];
  const lanes = targets.map((t) => walk(t));
  const join = lanes[0]?.stop;
  if (!join || !joins(join) || lanes.some((l) => l.stop !== join)) return null;
  const tail = walk(next(join));
  if (tail.stop !== 'out' && kind.get(tail.stop ?? '') !== 'output')
    return null;
  return lanes.map((l) => [...head.path, ...l.path, ...tail.path]);
}
