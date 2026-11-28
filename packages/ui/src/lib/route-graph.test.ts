import { expect, it } from 'vitest';

import type { Step } from './route';
import { edgeKey, routeGraph } from './route-graph';

type B = { id: string; label: string };
const b = (id: string): B => ({ id, label: id.toUpperCase() });

it('draws a straight chain from IN to OUT, each connection placed in the route', () => {
  const { graph, at } = routeGraph<B>([b('gate'), b('amp')], () => 'amp');
  expect(graph.nodes.map((n) => n.id)).toEqual(['in', 'gate', 'amp', 'out']);
  expect(graph.edges).toEqual([
    ['in', 'gate'],
    ['gate', 'amp'],
    ['amp', 'out'],
  ]);
  expect(at.get(edgeKey(['gate', 'amp']))).toEqual({ path: [], index: 1 });
  expect(at.get(edgeKey(['amp', 'out']))).toEqual({ path: [], index: 2 });
});

it('fans a split into paths that meet at a Mix joint, with a dry path straight across', () => {
  const route: Step<B>[] = [
    b('amp'),
    {
      split: true,
      id: 's',
      branches: [[b('echo')], []],
      names: ['Lead'],
    },
    b('verb'),
  ];
  const { graph, at, lanes } = routeGraph<B>(route, () => 'delay');
  expect(lanes).toEqual(['Lead', 'B']);
  const echo = graph.nodes.find((n) => n.id === 'echo')!;
  expect(echo.lane).toBe(0);
  expect(graph.edges).toContainEqual(['amp', 's:mix']);
  expect(graph.edges).toContainEqual(['s:mix', 'verb']);
  expect(at.get(edgeKey(['amp', 'echo']))).toEqual({ path: [1, 0], index: 0 });
  expect(at.get(edgeKey(['echo', 's:mix']))).toEqual({
    path: [1, 0],
    index: 1,
  });
  expect(at.get(edgeKey(['amp', 's:mix']))).toEqual({ path: [1, 1], index: 0 });
  expect(at.get(edgeKey(['s:mix', 'verb']))).toEqual({ path: [], index: 2 });
  // The branches sit on separate rows; the main line runs between them.
  const verb = graph.nodes.find((n) => n.id === 'verb')!;
  expect(echo.row).toBeLessThan(verb.row);
});
