import type { GlyphKey } from './block-glyphs';
import type { ChainGraph, GraphEdge, GraphNode } from './chain-graph';
import { branchName, isSplit, type ListPath, type Step } from './route';

/**
 * The route drawn as a map. A split fans out from the block before it into
 * one path per branch (an empty branch is a dry connection straight to the
 * join) and the paths meet at a Mix joint; a branch may split again. Every
 * connection remembers where it sits in the route, so a + on it adds a block
 * there and a block dropped on it moves there.
 * @see docs/interface.md
 */

/** Where a block goes when it is added on a connection: before `index` in the list at `path`. */
export type RouteAt = { path: ListPath; index: number };

export type RouteGraph = {
  graph: ChainGraph;
  /** The route position of each connection, by `edgeKey`. */
  at: Map<string, RouteAt>;
  /** The name of each parallel path, by lane number. */
  lanes: string[];
};

export const edgeKey = ([a, b]: GraphEdge) => `${a}>${b}`;

/** Rows a list of steps needs: a split stacks its branches. */
function rowsOf<B>(steps: Step<B>[]): number {
  return Math.max(
    1,
    ...steps.map((s) =>
      isSplit(s)
        ? Math.max(
            1,
            s.branches.reduce((sum, b) => sum + rowsOf(b), 0),
          )
        : 1,
    ),
  );
}

export function routeGraph<B extends { id: string; label: string }>(
  route: Step<B>[],
  glyph: (block: B) => GlyphKey,
): RouteGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const at = new Map<string, RouteAt>();
  const lanes: string[] = [];
  const link = (from: string, to: string, where: RouteAt) => {
    const key = edgeKey([from, to]);
    if (at.has(key)) return;
    at.set(key, where);
    edges.push([from, to]);
  };

  /** Lays out a list of steps from `col`, centred in rows [top, top + rows). */
  const walk = (
    steps: Step<B>[],
    path: ListPath,
    startCol: number,
    top: number,
    rows: number,
    from: string,
    lane: number | undefined,
  ): { col: number; last: string } => {
    const row = top + (rows - 1) / 2;
    let col = startCol;
    let prev = from;
    steps.forEach((step, i) => {
      if (!isSplit(step)) {
        nodes.push({
          id: step.id,
          kind: 'block',
          glyph: glyph(step),
          name: step.label,
          col,
          row,
          ...(lane !== undefined ? { lane } : {}),
        });
        link(prev, step.id, { path, index: i });
        prev = step.id;
        col += 1;
        return;
      }
      const height = rowsOf([step]);
      let branchTop = top + (rows - height) / 2;
      const mix = `${step.id}:mix`;
      const into: [string, RouteAt][] = [];
      let end = col;
      step.branches.forEach((branch, b) => {
        const here = [...path, i, b];
        const branchRows = rowsOf(branch);
        lanes.push(branchName(step, b));
        const branchLane = lanes.length - 1;
        if (!branch.length) {
          into.push([prev, { path: here, index: 0 }]);
        } else {
          const done = walk(
            branch,
            here,
            col,
            branchTop,
            branchRows,
            prev,
            branchLane,
          );
          into.push([done.last, { path: here, index: branch.length }]);
          end = Math.max(end, done.col);
        }
        branchTop += branchRows;
      });
      nodes.push({ id: mix, kind: 'cap', name: 'Mix', col: end, row });
      for (const [source, where] of into) link(source, mix, where);
      prev = mix;
      col = end + 1;
    });
    return { col, last: prev };
  };

  const rows = rowsOf(route);
  const centre = (rows - 1) / 2;
  nodes.push({ id: 'in', kind: 'cap', name: 'IN', col: 0, row: centre });
  const done = walk(route, [], 1, 0, rows, 'in', undefined);
  nodes.push({
    id: 'out',
    kind: 'cap',
    name: 'OUT',
    col: done.col,
    row: centre,
  });
  link(done.last, 'out', { path: [], index: route.length });
  return { graph: { nodes, edges }, at, lanes };
}
