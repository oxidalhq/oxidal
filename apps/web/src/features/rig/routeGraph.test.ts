import { describe, expect, it } from 'vitest';

import type { IdStep, RigBlockVM } from '../../rigChain';
import { edgeKey, routeGraph } from './routeGraph';

const tile = (id: string): RigBlockVM =>
  ({
    id: `${id}-tile`,
    label: id.toUpperCase(),
    kind: 'amp',
    on: true,
    face: null,
  }) as RigBlockVM;
const tiles = (id: string) => [tile(id)];
const split = (
  id: string,
  branches: IdStep[][],
  gains = branches.map(() => 1),
): Exclude<IdStep, string> => ({
  split: id,
  merge: `${id}-m`,
  gains,
  branches,
});
const edge = (g: ReturnType<typeof routeGraph>, a: string, b: string) =>
  g.at.get(edgeKey([a, b]));

describe('routeGraph', () => {
  it('draws a straight chain from IN to OUT with a gap before every block and at the end', () => {
    const g = routeGraph(['a', 'b'], tiles);
    expect(g.graph.nodes.map((n) => n.id)).toEqual([
      'in',
      'a-tile',
      'b-tile',
      'out',
    ]);
    expect(edge(g, 'in', 'a-tile')).toEqual({ split: null, path: 0, index: 0 });
    expect(edge(g, 'a-tile', 'b-tile')).toEqual({
      split: null,
      path: 0,
      index: 1,
    });
    expect(edge(g, 'b-tile', 'out')).toEqual({
      split: null,
      path: 0,
      index: 2,
    });
  });

  it('remembers which route block each tile belongs to', () => {
    const g = routeGraph(['a'], tiles);
    expect(g.block.get('a-tile')).toBe('a');
    expect(g.tile.get('a-tile')?.label).toBe('A');
  });

  it('draws a split as paths between two round nodes, with a gap at the start and end of each path', () => {
    const route: IdStep[] = ['a', split('s', [['b', 'c'], []]), 'd'];
    const g = routeGraph(route, tiles);
    const ids = g.graph.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(['s:split', 's:merge', 's:dry:1']),
    );
    expect(edge(g, 'a-tile', 's:split')).toEqual({
      split: null,
      path: 0,
      index: 1,
    });
    expect(edge(g, 's:split', 'b-tile')).toEqual({
      split: 's',
      path: 0,
      index: 0,
    });
    expect(edge(g, 'b-tile', 'c-tile')).toEqual({
      split: 's',
      path: 0,
      index: 1,
    });
    expect(edge(g, 'c-tile', 's:merge')).toEqual({
      split: 's',
      path: 0,
      index: 2,
    });
    expect(edge(g, 's:merge', 'd-tile')).toEqual({
      split: null,
      path: 0,
      index: 2,
    });
    expect(edge(g, 'd-tile', 'out')).toEqual({
      split: null,
      path: 0,
      index: 3,
    });
  });

  it('draws an empty path as a dry path and marks its connection as the place to add an effect', () => {
    const g = routeGraph([split('s', [['b'], []])], tiles);
    const dry = g.graph.nodes.find((n) => n.id === 's:dry:1');
    expect(dry?.name).toBe('Dry');
    expect(g.emptyPaths.has(edgeKey(['s:split', 's:dry:1']))).toBe(true);
    expect(g.graph.edges).toContainEqual(['s:dry:1', 's:merge']);
  });

  it('gives every block a path number and says each path’s level', () => {
    const g = routeGraph([split('s', [['b'], ['c']], [1, 0.5])], tiles);
    expect(g.lanes).toHaveLength(2);
    expect(g.lanes[0]).toMatch(/^Path 1 · 100%/);
    expect(g.lanes[1]).toMatch(/^Path 2 · 50%/);
    expect(g.graph.nodes.find((n) => n.id === 'b-tile')?.lane).toBe(0);
    expect(g.graph.nodes.find((n) => n.id === 'c-tile')?.lane).toBe(1);
  });

  it('puts paths on different rows and the straight chain in the middle', () => {
    const g = routeGraph([split('s', [['b'], ['c']])], tiles);
    const row = (id: string) => g.graph.nodes.find((n) => n.id === id)!.row;
    expect(row('b-tile')).not.toBe(row('c-tile'));
    expect(row('in')).toBe((row('b-tile') + row('c-tile')) / 2);
  });

  it('nests a split inside a path', () => {
    const inner = split('t', [['x'], ['y']]);
    const g = routeGraph([split('s', [[inner], ['c']])], tiles);
    expect(edge(g, 's:split', 't:split')).toEqual({
      split: 's',
      path: 0,
      index: 0,
    });
    expect(edge(g, 't:split', 'x-tile')).toEqual({
      split: 't',
      path: 0,
      index: 0,
    });
    expect(edge(g, 't:merge', 's:merge')).toEqual({
      split: 's',
      path: 0,
      index: 1,
    });
    expect(g.lanes).toHaveLength(4);
  });

  it('names scene lanes by scene and marks the blocks on a path that is not sounding', () => {
    const g = routeGraph([split('s', [['b'], ['c']])], tiles, {
      scenes: { split: 's', names: ['Clean', 'Lead'], sounding: 1 },
    });
    expect(g.lanes).toEqual(['1 Clean', '2 Lead · Sounding']);
    expect(g.silent.has('b-tile')).toBe(true);
    expect(g.silent.has('c-tile')).toBe(false);
  });

  it('draws a TONE3000 block as every tile it has, in order', () => {
    const g = routeGraph(['a'], (id) => [tile(`${id}1`), tile(`${id}2`)]);
    expect(g.graph.edges).toContainEqual(['a1-tile', 'a2-tile']);
    expect(g.at.has(edgeKey(['a1-tile', 'a2-tile']))).toBe(false);
    expect(g.block.get('a2-tile')).toBe('a');
  });

  it('says only the path number when the levels are not known', () => {
    const g = routeGraph([split('s', [['b'], ['c']])], tiles, { plain: true });
    expect(g.lanes).toEqual(['Path 1', 'Path 2']);
  });

  it('draws a run of empty slots as one add tile, and none when slots cannot be filled', () => {
    const run = (id: string) => [
      tile(id),
      { ...tile(`${id}-e1`), empty: true },
      { ...tile(`${id}-e2`), empty: true },
      { ...tile(`${id}-e3`), empty: true },
    ];
    const g = routeGraph(['a'], run);
    expect(g.graph.nodes.filter((n) => n.kind === 'slot')).toHaveLength(1);
    expect(g.graph.nodes.some((n) => n.id === 'a-e1-tile')).toBe(true);
    expect(g.graph.nodes.some((n) => n.id === 'a-e2-tile')).toBe(false);
    const none = routeGraph(['a'], run, { slots: false });
    expect(none.graph.nodes.some((n) => n.kind === 'slot')).toBe(false);
  });

  describe('scenes with many paths', () => {
    const many = split('s', [['p0'], ['p1'], ['p2'], ['p3'], ['p4']]);
    const scenes = {
      split: 's',
      names: ['One', 'Two', 'Three', 'Four', 'Five'],
      sounding: 0,
      enabled: [true, false, false, false, false],
    };

    it('lists the silent paths that can fold away', () => {
      const g = routeGraph([many], tiles, { scenes });
      expect(g.foldable.map((f) => f.name)).toEqual([
        'Two',
        'Three',
        'Four',
        'Five',
      ]);
    });

    it('draws every path while expanded and only the sounding one when folded', () => {
      expect(
        routeGraph([many], tiles, { scenes, expanded: true }).lanes,
      ).toHaveLength(5);
      const folded = routeGraph([many], tiles, { scenes, expanded: false });
      expect(folded.lanes).toEqual(['1 One · Sounding']);
      expect(folded.graph.nodes.some((n) => n.id === 'p1-tile')).toBe(false);
    });

    it('never folds the path that holds the selected block', () => {
      const g = routeGraph([many], tiles, {
        scenes,
        expanded: false,
        selected: 'p2-tile',
      });
      expect(g.foldable.map((f) => f.name)).toEqual(['Two', 'Four', 'Five']);
      expect(g.graph.nodes.some((n) => n.id === 'p2-tile')).toBe(true);
    });

    it('folds nothing when there are three paths or fewer', () => {
      const few = split('s', [['a'], ['b'], ['c']]);
      const g = routeGraph([few], tiles, {
        scenes: {
          split: 's',
          names: ['A', 'B', 'C'],
          sounding: 0,
          enabled: [true, false, false],
        },
      });
      expect(g.foldable).toEqual([]);
    });
  });
});
