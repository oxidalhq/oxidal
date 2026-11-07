import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteTree } from './RouteTree';
import type { IdStep } from '../rigChain';

afterEach(cleanup);

// Comp → split A (Clean | Dirt → split B (2a | dry) | dry) → Reverb.
const route: IdStep[] = [
  'comp',
  {
    split: 'split-a',
    merge: 'merge-a',
    gains: [1, 0.8, 0.5],
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

it('reads split routing top to bottom with nested paths, dry paths and levels', () => {
  const onSplit = vi.fn();
  render(
    <RouteTree
      route={route}
      tiles={(id) => (
        <button key={id} type="button">
          {id}
        </button>
      )}
      onSplit={onSplit}
    />,
  );
  const tree = screen.getByRole('group', { name: 'Signal chain' });
  expect(tree.textContent).toMatch(
    /^IN.*comp.*Split · 3 paths.*Path 1.*100%.*ac30.*cab.*Path 2.*80%.*muff.*Split · 2 paths.*Path 2a.*magnatone.*Path 2b.*dry.*Merge.*Path 3.*50%.*dry.*Merge.*reverb.*OUT$/,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Split · 2 paths: path levels' }),
  );
  expect(onSplit).toHaveBeenCalledWith(
    expect.objectContaining({ split: 'split-b' }),
  );
});

it('shows splits as plain labels when routing cannot be changed', () => {
  render(<RouteTree route={route} tiles={() => null} />);
  expect(screen.queryByRole('button', { name: /path levels/ })).toBeNull();
  expect(screen.getAllByText(/Split · /)).toHaveLength(2);
});
