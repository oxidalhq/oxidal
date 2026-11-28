import type { GlyphKey } from './block-glyphs';

/**
 * The chain as blocks and connections, for drawing and for the edits a
 * player can make on a connection. Columns follow the connections: a block
 * sits to the right of every block that feeds it. Rows come from the path a
 * block is on. These are pure functions; the product applies the same edits
 * to its own route through its route operations.
 * @see docs/interface.md
 */

export type GraphNode = {
  id: string;
  /**
   * A round end (input, output, merge), a block, or a free slot: a small
   * round + that adds a block in that place (a TONE3000 block's free
   * position), drawn like a joint and never as a card.
   */
  kind: 'cap' | 'block' | 'slot';
  glyph?: GlyphKey;
  name: string;
  /** Where it starts; connections push it further right when needed. */
  col: number;
  row: number;
  /** The parallel path this block is on, if any. */
  lane?: number;
};
export type GraphEdge = [from: string, to: string];
export type ChainGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type NewBlock = { glyph: GlyphKey; name: string };

/** A block card is this wide; a joint (in, out, split, mix) is a small circle. */
export const CARD_W = 168;
export const CARD_HALF = CARD_W / 2;
const CAP_W = 48;
/** The space left between two columns for the connection and its + button. */
const GAP = 64;
export const ROW = 120;

/** Column of every node, which nodes the input reaches, and the drawing size. */
export function layoutGraph(g: ChainGraph) {
  const col: Record<string, number> = Object.fromEntries(
    g.nodes.map((n) => [n.id, n.col]),
  );
  for (let i = 0; i < g.nodes.length; i++)
    for (const [a, b] of g.edges)
      col[b] = Math.max(col[b] ?? 0, (col[a] ?? 0) + 1);
  const reach = new Set<string>(['in']);
  for (let i = 0; i < g.nodes.length; i++)
    for (const [a, b] of g.edges) if (reach.has(a)) reach.add(b);
  const maxCol = Math.max(0, ...Object.values(col));
  const maxRow = Math.max(0, ...g.nodes.map((n) => n.row));
  // Each column is as wide as its widest node, so joints stay narrow and the
  // whole chain fits at a readable size.
  const widths = Array.from({ length: maxCol + 1 }, () => 0);
  for (const n of g.nodes) {
    const c = col[n.id] ?? n.col;
    widths[c] = Math.max(widths[c] ?? 0, n.kind === 'block' ? CARD_W : CAP_W);
  }
  const xs: number[] = [];
  let at = 40;
  for (const w of widths) {
    xs.push(at + w / 2);
    at += w + GAP;
  }
  return { col, xs, reach, w: at - GAP + 40, h: maxRow * ROW + 200 };
}

const node = (g: ChainGraph, id: string) => g.nodes.find((n) => n.id === id);

/** The path and row a block takes when it sits on this connection. */
function placeOn(g: ChainGraph, [a, b]: GraphEdge) {
  const A = node(g, a);
  const B = node(g, b);
  const lane = B?.lane ?? A?.lane;
  const row = B?.lane !== undefined ? B.row : (A?.row ?? 0);
  return { lane, row, col: (A?.col ?? 0) + 1 };
}

/** Add a block on a connection: from → block → to. */
export function insertBlock(
  g: ChainGraph,
  edge: GraphEdge,
  block: NewBlock,
  id: string,
): ChainGraph {
  const [a, b] = edge;
  if (!g.edges.some((e) => e[0] === a && e[1] === b)) return g;
  const at = placeOn(g, edge);
  const added: GraphNode = {
    id,
    kind: 'block',
    ...block,
    col: at.col,
    row: at.row,
    ...(at.lane !== undefined ? { lane: at.lane } : {}),
  };
  return {
    nodes: [...g.nodes, added],
    edges: [
      ...g.edges.filter((e) => !(e[0] === a && e[1] === b)),
      [a, id],
      [id, b],
    ],
  };
}

/** Add a new parallel path across a connection, holding one block. The direct connection stays. */
export function branchBlock(
  g: ChainGraph,
  edge: GraphEdge,
  block: NewBlock,
  id: string,
): ChainGraph {
  const [a, b] = edge;
  if (!g.edges.some((e) => e[0] === a && e[1] === b)) return g;
  const lane = Math.max(-1, ...g.nodes.map((n) => n.lane ?? -1)) + 1;
  const row = Math.max(0, ...g.nodes.map((n) => n.row)) + 1;
  const added: GraphNode = {
    id,
    kind: 'block',
    ...block,
    col: (node(g, a)?.col ?? 0) + 1,
    row,
    lane,
  };
  return {
    nodes: [...g.nodes, added],
    edges: [...g.edges, [a, id], [id, b]],
  };
}

/** The path that would be left without blocks if this block moved away, if any. */
export function pathEmptiedBy(g: ChainGraph, id: string): number | null {
  const n = node(g, id);
  if (n?.lane === undefined) return null;
  return g.nodes.filter((x) => x.lane === n.lane).length === 1 ? n.lane : null;
}

/**
 * Move a block onto another connection. The blocks on either side of the
 * place it left are joined to each other, so nothing is ever left without an
 * input. A path left with no blocks becomes a dry path.
 */
export function moveBlock(
  g: ChainGraph,
  id: string,
  edge: GraphEdge,
): ChainGraph {
  const [a, b] = edge;
  if (a === id || b === id) return g;
  if (!g.edges.some((e) => e[0] === a && e[1] === b)) return g;
  const preds = g.edges.filter((e) => e[1] === id).map((e) => e[0]);
  const succs = g.edges.filter((e) => e[0] === id).map((e) => e[1]);
  const edges = g.edges.filter((e) => e[0] !== id && e[1] !== id);
  for (const p of preds)
    for (const q of succs)
      if (!edges.some((e) => e[0] === p && e[1] === q)) edges.push([p, q]);
  const rest = edges.filter((e) => !(e[0] === a && e[1] === b));
  rest.push([a, id], [id, b]);
  const at = placeOn(g, edge);
  return {
    nodes: g.nodes.map((n) => {
      if (n.id !== id) return n;
      const moved: GraphNode = { ...n, row: at.row, col: at.col };
      if (at.lane !== undefined) moved.lane = at.lane;
      else delete moved.lane;
      return moved;
    }),
    edges: rest,
  };
}

/** The connection nearest a point (in drawing units), ignoring those that touch `exclude`. */
export function nearestEdge(
  g: ChainGraph,
  lay: ColumnLayout,
  point: { x: number; y: number },
  exclude: string,
  within = 80,
): GraphEdge | null {
  let best: GraphEdge | null = null;
  let bd = within;
  for (const e of g.edges) {
    if (e[0] === exclude || e[1] === exclude) continue;
    const p = node(g, e[0]);
    const q = node(g, e[1]);
    if (!p || !q) continue;
    const mid = edgeMid(p, q, lay);
    const d = Math.hypot(mid.x - point.x, mid.y - point.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Where a node is drawn, and the middle of a connection. */
export type ColumnLayout = { col: Record<string, number>; xs: number[] };
export const nodeX = (n: GraphNode, lay: ColumnLayout) =>
  lay.xs[lay.col[n.id] ?? n.col] ?? 40;
export const nodeY = (n: GraphNode) => n.row * ROW + 100;
/** How far a line runs to bend from one row to another. */
const BEND = 64;

/**
 * A connection's line and its middle (where its + sits and a dragged block
 * lands). A line into a join (Σ, OUT) keeps to its own row and bends just
 * before the join; a line out of a split (◆, IN) bends just after it; so a
 * long line never bends across another path and seems to feed it. Between
 * two blocks, or two joins, it bends half way.
 */
export function edgeShape(p: GraphNode, q: GraphNode, lay: ColumnLayout) {
  const x1 = nodeX(p, lay) + (p.kind !== 'block' ? 24 : CARD_HALF);
  const x2 = nodeX(q, lay) - (q.kind !== 'block' ? 26 : CARD_HALF + 2);
  const y1 = nodeY(p);
  const y2 = nodeY(q);
  const b = Math.min(BEND, Math.max(0, x2 - x1));
  const into = q.kind === 'cap' && p.kind !== 'cap';
  const outOf = p.kind === 'cap' && q.kind !== 'cap';
  if (y1 !== y2 && into && x2 - x1 > 2 * b) {
    const bx = x2 - b;
    return {
      d: `M ${x1} ${y1} L ${bx} ${y1} C ${bx + b / 2} ${y1}, ${bx + b / 2} ${y2}, ${x2} ${y2}`,
      x: (x1 + bx) / 2,
      y: y1,
      x1,
      x2,
    };
  }
  if (y1 !== y2 && outOf && x2 - x1 > 2 * b) {
    const bx = x1 + b;
    return {
      d: `M ${x1} ${y1} C ${x1 + b / 2} ${y1}, ${x1 + b / 2} ${y2}, ${bx} ${y2} L ${x2} ${y2}`,
      x: (bx + x2) / 2,
      y: y2,
      x1,
      x2,
    };
  }
  const mx = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
    x: mx,
    y: (y1 + y2) / 2,
    x1,
    x2,
  };
}
export function edgeMid(p: GraphNode, q: GraphNode, lay: ColumnLayout) {
  const { x, y, x1, x2 } = edgeShape(p, q, lay);
  return { x, y, x1, x2 };
}
