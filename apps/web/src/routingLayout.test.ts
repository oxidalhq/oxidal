import { expect, it } from 'vitest';
import { rigTopology } from './routingLayout';
import type { PortableGraph } from './generated/contract';
function graph(ids: string[], links: [string, string][]): PortableGraph {
  return {
    nodes: ids.map((id) => ({
      id,
      kind: 'lv2',
      audioInputs: 1,
      audioOutputs: 1,
    })),
    edges: links.map(([from, to]) => ({
      from: { node: from, port: 0 },
      to: { node: to, port: 0 },
    })),
  };
}
it('shows parallel branches together and connects their actual merge, not adjacent tiles', () => {
  const layout = rigTopology(
    graph(
      ['in', 'a', 'b', 'gain-a', 'gain-b', 'mix', 'cab', 'out'],
      [
        ['in', 'a'],
        ['in', 'b'],
        ['a', 'gain-a'],
        ['b', 'gain-b'],
        ['gain-a', 'mix'],
        ['gain-b', 'mix'],
        ['mix', 'cab'],
        ['cab', 'out'],
      ],
    ),
    ['a', 'b', 'cab'],
  );
  expect(layout.valid).toBe(true);
  expect(layout.nodes).toEqual([
    { id: 'a', column: 0, row: 0 },
    { id: 'b', column: 0, row: 1 },
    { id: 'cab', column: 1, row: 0 },
  ]);
  expect(layout.links).toEqual([
    { from: 'a', to: 'cab' },
    { from: 'b', to: 'cab' },
  ]);
});
it('derives signal order from edges even when serialized nodes are shuffled', () => {
  const layout = rigTopology(
    graph(
      ['cab', 'in', 'amp', 'out'],
      [
        ['in', 'amp'],
        ['amp', 'cab'],
        ['cab', 'out'],
        ['amp', 'cab'],
      ],
    ),
    ['cab', 'amp'],
  );
  expect(layout.nodes).toEqual([
    { id: 'cab', column: 1, row: 0 },
    { id: 'amp', column: 0, row: 0 },
  ]);
  expect(layout.links).toEqual([{ from: 'amp', to: 'cab' }]);
});
it('keeps controls accessible without fictional links if graph metadata is invalid', () => {
  const layout = rigTopology(
    graph(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
    ),
    ['a', 'b'],
  );
  expect(layout.valid).toBe(false);
  expect(layout.links).toEqual([]);
  expect(layout.nodes).toHaveLength(2);
});
