import { isRigBlockNode, type IdStep } from '../../rigChain';

type Graph = {
  nodes: { id: string; kind: string }[];
  edges?: { from: { node: string }; to: { node: string } }[];
};
type Split = Exclude<IdStep, string>;

const SOURCE = '\u0000in';
const SINK = '\u0000out';

/**
 * Any preset graph as a routing tree the chain view can draw, for a shape the
 * route editor cannot read (a split without its right-channel twin, paths
 * that do not rejoin at one merge, a graph without input or output nodes).
 * Routing nodes are wires; blocks that run one after another are a chain and
 * blocks between the same two points are paths of a split. What still does
 * not fold that way is drawn column by column, each block once. The splits it
 * makes are for drawing only (ids `view-…`, unity gains); never build from it.
 * @see docs/interface.md
 */
export function graphRoute(graph: Graph): IdStep[] {
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const blocks = graph.nodes.filter(isRigBlockNode).map((n) => n.id);
  const isBlock = new Set(blocks);
  const edges = graph.edges ?? [];
  const end = (id: string) =>
    id === 'in' || kinds.get(id) === 'input'
      ? SOURCE
      : id === 'out' || kinds.get(id) === 'output'
        ? SINK
        : isBlock.has(id)
          ? id
          : null;
  /** The blocks (or the output) a node feeds, through any routing nodes. */
  const feeds = (id: string) => {
    const found = new Set<string>();
    const seen = new Set<string>([id]);
    const queue = edges.filter((e) => e.from.node === id).map((e) => e.to.node);
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const at = end(next);
      if (at && at !== SOURCE) found.add(at);
      else if (!at)
        for (const e of edges) if (e.from.node === next) queue.push(e.to.node);
    }
    return [...found];
  };
  const links = new Map<string, string[]>([[SOURCE, []]]);
  const sources = new Set([
    ...graph.nodes.map((n) => n.id),
    ...edges.map((e) => e.from.node),
  ]);
  for (const id of sources) {
    const from = end(id);
    if (!from || from === SINK) continue;
    const to = links.get(from) ?? [];
    for (const target of feeds(id)) if (!to.includes(target)) to.push(target);
    links.set(from, to);
  }
  // A block nothing feeds hangs off the input; one that feeds nothing, the output.
  const fed = new Set([...links.values()].flat());
  const starts = links.get(SOURCE)!;
  for (const id of blocks) {
    if (!fed.has(id) && !starts.includes(id)) starts.push(id);
    if (!links.get(id)?.length) links.set(id, [SINK]);
  }
  /** Paths keep the order of their first block in the preset. */
  const rank = (steps: IdStep[]): number => {
    for (const s of steps) {
      const r =
        typeof s === 'string' ? blocks.indexOf(s) : rank(s.branches.flat());
      if (r >= 0) return r;
    }
    return blocks.length;
  };
  return folded(links, rank) ?? columns(blocks, links);
}

/** Series and parallel folding to one input-to-output wire; null if it stops. */
function folded(
  links: Map<string, string[]>,
  rank: (steps: IdStep[]) => number,
): IdStep[] | null {
  type Wire = { from: string; to: string; steps: IdStep[] };
  let wires: Wire[] = [...links].flatMap(([from, to]) =>
    to.map((t) => ({ from, to: t, steps: [] })),
  );
  let made = 0;
  for (let changed = true; changed;) {
    changed = false;
    // Parallel: wires between the same two points become one split.
    const groups = new Map<string, Wire[]>();
    for (const w of wires) {
      const key = `${w.from}\u0001${w.to}`;
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    if ([...groups.values()].some((g) => g.length > 1)) {
      changed = true;
      wires = [...groups.values()].map((group) => {
        if (group.length === 1) return group[0]!;
        const paths = group
          .filter((w) => w.steps.length)
          .map((w) => w.steps)
          .sort((x, y) => rank(x) - rank(y));
        const branches = paths.length < group.length ? [...paths, []] : paths;
        made++;
        const split: Split = {
          split: `view-${made}`,
          merge: `view-${made}-merge`,
          gains: branches.map(() => 1),
          branches,
        };
        return {
          from: group[0]!.from,
          to: group[0]!.to,
          steps: paths.length ? [split] : [],
        };
      });
    }
    // Series: a block with one wire in and one out joins them.
    for (const id of new Set(wires.map((w) => w.to))) {
      if (id === SINK) continue;
      const into = wires.filter((w) => w.to === id);
      const out = wires.filter((w) => w.from === id);
      if (into.length !== 1 || out.length !== 1 || into[0] === out[0]) continue;
      const a = into[0]!;
      const b = out[0]!;
      wires = wires
        .filter((w) => w !== a && w !== b)
        .concat({
          from: a.from,
          to: b.to,
          steps: [...a.steps, id, ...b.steps],
        });
      changed = true;
    }
  }
  const only = wires[0];
  return wires.length === 1 && only!.from === SOURCE && only!.to === SINK
    ? only!.steps
    : null;
}

/** Each block in the column of its longest path from the input. */
function columns(blocks: string[], links: Map<string, string[]>): IdStep[] {
  const depth = new Map<string, number>();
  const visit = (id: string, d: number, trail: Set<string>) => {
    if (trail.has(id) || (depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    trail.add(id);
    for (const next of links.get(id) ?? []) visit(next, d + 1, trail);
    trail.delete(id);
  };
  visit(SOURCE, 0, new Set());
  const placed: string[][] = [];
  for (const id of blocks) {
    const d = depth.get(id) ?? 1;
    (placed[d] ??= []).push(id);
  }
  return placed
    .filter((col) => col?.length)
    .map((col, index): IdStep =>
      col.length === 1
        ? col[0]!
        : {
            split: `view-column-${index}`,
            merge: `view-column-${index}-merge`,
            gains: col.map(() => 1),
            branches: col.map((id) => [id]),
          },
    );
}
