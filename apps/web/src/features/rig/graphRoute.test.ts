import { expect, it } from 'vitest';
import { chainRoute, type IdStep } from '../../rigChain';
import { graphRoute } from './graphRoute';

const block = (id: string) => ({ id, kind: 'lv2' });
const wire = (from: string, to: string, port = 0) => ({
  from: { node: from, port },
  to: { node: to, port },
});
/** Splits as nested lists, blocks as ids. */
const shape = (steps: IdStep[]): unknown =>
  steps.map((s) => (typeof s === 'string' ? s : s.branches.map(shape)));
const ids = (steps: IdStep[]): string[] =>
  steps.flatMap((s) => (typeof s === 'string' ? [s] : s.branches.flatMap(ids)));

it('draws two blocks feeding one as two paths, without input or output nodes', () => {
  const graph = {
    nodes: ['amp-a', 'amp-b', 'cab'].map(block),
    edges: [wire('amp-a', 'cab'), wire('amp-b', 'cab')],
  };
  expect(chainRoute(graph)).toBeNull();
  expect(shape(graphRoute(graph))).toEqual([[['amp-a'], ['amp-b']], 'cab']);
});

it('reads mono splits, gain nodes and dry paths the route editor cannot', () => {
  // in → split (no right twin) → [drive → gain | dry] → merge → reverb → out
  const graph = {
    nodes: [
      { id: 'in', kind: 'input' },
      { id: 'fan', kind: 'split' },
      block('drive'),
      { id: 'level', kind: 'gain' },
      { id: 'sum', kind: 'merge' },
      block('reverb'),
      { id: 'out', kind: 'output' },
    ],
    edges: [
      wire('in', 'fan'),
      wire('fan', 'drive', 0),
      wire('drive', 'level'),
      wire('level', 'sum', 0),
      { from: { node: 'fan', port: 1 }, to: { node: 'sum', port: 1 } },
      wire('sum', 'reverb'),
      wire('reverb', 'out'),
    ],
  };
  expect(chainRoute(graph)).toBeNull();
  expect(shape(graphRoute(graph))).toEqual([[['drive'], []], 'reverb']);
});

it('draws a graph that does not fold into paths column by column, each block once', () => {
  // A bridge: a feeds c and d, b feeds d only.
  const graph = {
    nodes: [{ id: 'in', kind: 'input' }, ...['a', 'b', 'c', 'd'].map(block)],
    edges: [
      wire('in', 'a'),
      wire('in', 'b'),
      wire('a', 'c'),
      wire('a', 'd'),
      wire('b', 'd'),
    ],
  };
  const route = graphRoute(graph);
  expect(ids(route).sort()).toEqual(['a', 'b', 'c', 'd']);
  expect(shape(route)).toEqual([
    [['a'], ['b']],
    [['c'], ['d']],
  ]);
});

it('draws an empty graph as nothing and a lone block as a chain', () => {
  expect(graphRoute({ nodes: [], edges: [] })).toEqual([]);
  expect(graphRoute({ nodes: [{ id: 'amp', kind: 'tone3000' }] })).toEqual([
    'amp',
  ]);
});
