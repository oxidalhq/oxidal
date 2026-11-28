import { describe, expect, it } from 'vitest';

import {
  branchBlock,
  type ChainGraph,
  insertBlock,
  layoutGraph,
  moveBlock,
  nearestEdge,
  pathEmptiedBy,
} from './chain-graph';

/** IN → A → B → OUT, and a split after A with two paths (C, D) that rejoin at the merge. */
const rig = (): ChainGraph => ({
  nodes: [
    { id: 'in', kind: 'cap', name: 'IN', col: 0, row: 0.5 },
    { id: 'a', kind: 'block', glyph: 'gate', name: 'A', col: 1, row: 0.5 },
    {
      id: 'c',
      kind: 'block',
      glyph: 'amp',
      name: 'C',
      col: 2,
      row: 0,
      lane: 0,
    },
    {
      id: 'd',
      kind: 'block',
      glyph: 'amp',
      name: 'D',
      col: 2,
      row: 1,
      lane: 1,
    },
    { id: 'm', kind: 'cap', name: 'Σ', col: 3, row: 0.5 },
    { id: 'b', kind: 'block', glyph: 'reverb', name: 'B', col: 4, row: 0.5 },
    { id: 'out', kind: 'cap', name: 'OUT', col: 5, row: 0.5 },
  ],
  edges: [
    ['in', 'a'],
    ['a', 'c'],
    ['a', 'd'],
    ['c', 'm'],
    ['d', 'm'],
    ['m', 'b'],
    ['b', 'out'],
  ],
});
const has = (g: ChainGraph, a: string, b: string) =>
  g.edges.some((e) => e[0] === a && e[1] === b);

describe('layoutGraph', () => {
  it('puts every block to the right of the blocks that feed it', () => {
    const { col } = layoutGraph(rig());
    expect(col.a).toBeGreaterThan(col.in!);
    expect(col.m).toBeGreaterThan(col.c!);
    expect(col.out).toBeGreaterThan(col.b!);
  });
  it('pushes the blocks after an inserted one to the right', () => {
    const g = insertBlock(
      rig(),
      ['m', 'b'],
      { glyph: 'delay', name: 'X' },
      'x',
    );
    const before = layoutGraph(rig()).col;
    const after = layoutGraph(g).col;
    expect(after.b).toBeGreaterThan(before.b!);
    expect(after.out).toBeGreaterThan(before.out!);
  });
  it('finds what the input reaches', () => {
    const g = rig();
    g.nodes.push({
      id: 'z',
      kind: 'block',
      glyph: 'amp',
      name: 'Z',
      col: 2,
      row: 3,
    });
    const { reach } = layoutGraph(g);
    expect(reach.has('b')).toBe(true);
    expect(reach.has('z')).toBe(false);
  });
});

describe('insertBlock', () => {
  it('puts the block between the two ends and removes the direct connection', () => {
    const g = insertBlock(
      rig(),
      ['m', 'b'],
      { glyph: 'delay', name: 'X' },
      'x',
    );
    expect(has(g, 'm', 'x')).toBe(true);
    expect(has(g, 'x', 'b')).toBe(true);
    expect(has(g, 'm', 'b')).toBe(false);
  });
  it('puts a block inserted on a path onto that path', () => {
    const g = insertBlock(rig(), ['a', 'c'], { glyph: 'od', name: 'X' }, 'x');
    const x = g.nodes.find((n) => n.id === 'x');
    expect(x?.lane).toBe(0);
    expect(x?.row).toBe(0);
  });
  it('does nothing for a connection that is not there', () => {
    const g = rig();
    expect(insertBlock(g, ['a', 'b'], { glyph: 'od', name: 'X' }, 'x')).toBe(g);
  });
});

describe('branchBlock', () => {
  it('keeps the direct connection and adds a new path below the others', () => {
    const g = branchBlock(
      rig(),
      ['m', 'b'],
      { glyph: 'delay', name: 'X' },
      'x',
    );
    expect(has(g, 'm', 'b')).toBe(true);
    expect(has(g, 'm', 'x')).toBe(true);
    expect(has(g, 'x', 'b')).toBe(true);
    const x = g.nodes.find((n) => n.id === 'x');
    expect(x?.lane).toBe(2);
    expect(x?.row).toBe(2);
  });
});

describe('moveBlock', () => {
  it('moves a block to another connection and rejoins the place it left', () => {
    const g = moveBlock(rig(), 'b', ['a', 'c']);
    expect(has(g, 'm', 'out')).toBe(true);
    expect(has(g, 'a', 'b')).toBe(true);
    expect(has(g, 'b', 'c')).toBe(true);
    expect(has(g, 'a', 'c')).toBe(false);
    expect(has(g, 'm', 'b')).toBe(false);
  });
  it('leaves no block without an input or an output', () => {
    const g = moveBlock(rig(), 'a', ['m', 'b']);
    for (const n of g.nodes) {
      if (n.id !== 'in') expect(g.edges.some((e) => e[1] === n.id)).toBe(true);
      if (n.id !== 'out') expect(g.edges.some((e) => e[0] === n.id)).toBe(true);
    }
  });
  it('turns an emptied path into a dry path', () => {
    expect(pathEmptiedBy(rig(), 'c')).toBe(0);
    const g = moveBlock(rig(), 'c', ['m', 'b']);
    expect(has(g, 'a', 'm')).toBe(true);
  });
  it('ignores a drop on the block’s own connections', () => {
    const g = rig();
    expect(moveBlock(g, 'b', ['m', 'b'])).toBe(g);
    expect(moveBlock(g, 'b', ['b', 'out'])).toBe(g);
  });
  it('does not report an emptied path for a block on a shared path', () => {
    expect(pathEmptiedBy(rig(), 'a')).toBeNull();
    expect(pathEmptiedBy(rig(), 'b')).toBeNull();
  });
});

describe('nearestEdge', () => {
  it('finds the connection closest to a point and ignores the block’s own', () => {
    const g = rig();
    const lay = layoutGraph(g);
    const col = lay;
    const near = nearestEdge(g, col, { x: lay.xs[3]! + 100, y: 160 }, 'zzz');
    expect(near).not.toBeNull();
    const none = nearestEdge(g, col, { x: 9999, y: 9999 }, 'zzz');
    expect(none).toBeNull();
    const skip = nearestEdge(g, col, { x: lay.xs[3]! + 100, y: 160 }, 'm');
    expect(skip === null || (skip[0] !== 'm' && skip[1] !== 'm')).toBe(true);
  });
});
