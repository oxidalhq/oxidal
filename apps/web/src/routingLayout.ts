import type { PortableGraph } from './generated/contract';

/** Collapse display-only nodes without inventing serial links between parallel branches. */
export function rigTopology(graph: PortableGraph, visible: string[]) {
  const shown = new Set(visible);
  const incoming = new Map(graph.nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(graph.nodes.map((n) => [n.id, new Set<string>()]));
  for (const edge of graph.edges ?? []) {
    if (!incoming.has(edge.to.node) || !outgoing.has(edge.from.node)) continue;
    incoming.get(edge.to.node)!.add(edge.from.node);
    outgoing.get(edge.from.node)!.add(edge.to.node);
  }
  const pending = new Map(
    [...incoming].map(([id, parents]) => [id, parents.size]),
  );
  const queue = [...pending]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  const frontier = new Map<string, Set<string>>();
  const columns = new Map<string, number>();
  const links: { from: string; to: string }[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const parents = new Set<string>();
    for (const parent of incoming.get(id)!) {
      for (const ancestor of frontier.get(parent) ?? []) parents.add(ancestor);
    }
    if (shown.has(id)) {
      columns.set(
        id,
        Math.max(0, ...[...parents].map((p) => (columns.get(p) ?? 0) + 1)),
      );
      for (const parent of parents) links.push({ from: parent, to: id });
      frontier.set(id, new Set([id]));
    } else frontier.set(id, parents);
    for (const child of outgoing.get(id)!) {
      const count = pending.get(child)! - 1;
      pending.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  const valid =
    queue.length === graph.nodes.length &&
    visible.every((id) => columns.has(id));
  const rows = new Map<number, number>();
  const nodes = visible.map((id, index) => {
    const column = valid ? columns.get(id)! : index;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id, column, row };
  });
  return { nodes, links: valid ? links : [], valid };
}
