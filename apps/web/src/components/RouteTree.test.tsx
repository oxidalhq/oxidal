import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { IdStep, RigBlockVM } from '../rigChain';
import { RouteTree } from './RouteTree';

afterEach(cleanup);

// Comp → split A (Clean | Dirt → split B (2a | dry) | dry) → Reverb.
const route: IdStep[] = [
  'comp',
  {
    split: 'split-a',
    merge: 'merge-a',
    gains: [1, 0.8, 0.5],
    rightGains: [1, 0.4, 0.5],
    branches: [
      ['ac30', 'cab'],
      [
        'muff',
        {
          split: 'split-b',
          merge: 'merge-b',
          gains: [1, 1],
          branches: [['magnatone'], []],
        },
      ],
      [],
    ],
  },
  'reverb',
];
const tiles = (id: string): RigBlockVM[] => [
  { id: `${id}::`, label: id, kind: 'lv2', on: id !== 'cab', face: null },
];

it('draws a split as stacked paths with captions, and an empty path asks for an effect', () => {
  const add = vi.fn();
  render(
    <RouteTree route={route} tiles={tiles} onSelect={() => {}} onAdd={add} />,
  );
  const chain = screen.getByRole('group', { name: 'Signal chain' });
  expect(chain.textContent).toMatch(
    /^IN.*comp.*Path 1 · 100% · Centre.*ac30.*cab.*Path 2 · 80% · 50% left.*muff.*Path 1 · 100% · Centre.*magnatone.*Path 2 · 100% · Centre.*Add effect.*Path 3 · 50% · Centre.*Add effect.*reverb.*OUT$/,
  );
  // No gaps without an editor.
  expect(screen.queryByRole('button', { name: /^Add or split/ })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Add effect to path 2 of path 2' }),
  );
  expect(add).toHaveBeenCalledWith({ split: 'split-b', path: 1, index: 0 });
});

it('puts a + in every allowed gap, naming its place', () => {
  const gap = vi.fn();
  render(
    <RouteTree
      route={route}
      tiles={tiles}
      onSelect={() => {}}
      gaps={(at) => at.split !== 'split-b'}
      onGap={gap}
    />,
  );
  // Top: 4 gaps; split A: 3 + 3 (a dry path has none); split B: none.
  expect(screen.getAllByRole('button', { name: /^Add or split/ })).toHaveLength(
    10,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Add or split on path 1 at position 2',
    }),
  );
  expect(gap).toHaveBeenCalledWith({ split: 'split-a', path: 0, index: 1 });
});

it('moves a focused block with Alt+arrow keys, only when it can move', () => {
  const key = vi.fn();
  render(
    <RouteTree
      route={route}
      tiles={tiles}
      onSelect={() => {}}
      movable={(id) => id !== 'comp'}
      onKey={key}
    />,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'muff' }), {
    key: 'ArrowUp',
    altKey: true,
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'muff' }), {
    key: 'ArrowRight',
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'comp' }), {
    key: 'ArrowRight',
    altKey: true,
  });
  expect(key.mock.calls).toEqual([['muff', 'up']]);
});

it('names scene lanes and the sounding scene', () => {
  const scenes: IdStep[] = [
    {
      split: 'scene-input',
      merge: 'scene',
      gains: [1, 0],
      branches: [['clean'], ['lead', 'echo']],
    },
  ];
  render(
    <RouteTree
      route={scenes}
      tiles={tiles}
      onSelect={() => {}}
      scenes={{
        split: 'scene-input',
        names: ['Clean', 'Lead'],
        sounding: 1,
      }}
    />,
  );
  const lead = screen.getByRole('group', { name: 'Scene 2 Lead, sounding' });
  expect(within(lead).getByRole('button', { name: 'echo' })).toBeVisible();
  expect(screen.getByRole('group', { name: 'Scene 1 Clean' })).toHaveAttribute(
    'data-dim',
  );
});

it('reads as a numbered list with path labels and buttons only on E-paper', () => {
  const select = vi.fn();
  const add = vi.fn();
  render(
    <RouteTree
      route={route}
      tiles={tiles}
      list
      selected="muff::"
      onSelect={select}
      gaps={() => true}
      onGap={() => {}}
      onAdd={add}
    />,
  );
  const list = screen.getByRole('list', { name: 'Chain as a list' });
  expect(list.textContent).toMatch(
    /comp.*Split, 3 paths.*Path 1.*\(100%, Centre\).*ac30.*cab \(off\).*Path 2.*\(80%, 50% left\).*muff.*Split, 2 paths.*Path 3.*reverb.*Add effect at the end/,
  );
  expect(screen.getByRole('button', { name: 'muff' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'reverb' }));
  expect(select).toHaveBeenCalledWith('reverb::');
  fireEvent.click(
    within(list).getAllByRole('button', { name: 'Add effect to path 3' })[0]!,
  );
  expect(add).toHaveBeenCalledWith({ split: 'split-a', path: 2, index: 0 });
});
