import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import type { ChainGraph } from '../lib/chain-graph';
import { ChainCanvas } from './chain-canvas';

beforeAll(() => {
  // jsdom has no ResizeObserver; the canvas uses one to fit itself to the space.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const graph: ChainGraph = {
  nodes: [
    { id: 'in', kind: 'cap', name: 'IN', col: 0, row: 0 },
    { id: 'gate', kind: 'block', glyph: 'gate', name: 'Gate', col: 1, row: 0 },
    {
      id: 'amp',
      kind: 'block',
      glyph: 'amp',
      name: 'Plexi 50',
      col: 2,
      row: 0,
    },
    { id: 'out', kind: 'cap', name: 'OUT', col: 3, row: 0 },
  ],
  edges: [
    ['in', 'gate'],
    ['gate', 'amp'],
    ['amp', 'out'],
  ],
};
const choices = [
  { glyph: 'delay' as const, name: 'Delay' },
  { glyph: 'reverb' as const, name: 'Reverb' },
];

it('draws every block by name and selects one when pressed', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ChainCanvas graph={graph} selected={null} onSelect={onSelect} />);
  expect(screen.getByRole('button', { name: 'Gate' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Plexi 50' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Plexi 50' }));
  expect(onSelect).toHaveBeenCalledWith('amp');
});

it('is view-only without edit callbacks: no add buttons, and says why', () => {
  render(
    <ChainCanvas
      graph={graph}
      selected={null}
      onSelect={() => undefined}
      readOnlyNote="This preset’s routing cannot be edited here."
    />,
  );
  expect(
    screen.queryByRole('button', { name: /Add a block between/ }),
  ).toBeNull();
  expect(
    screen.getByText('This preset’s routing cannot be edited here.'),
  ).toBeVisible();
});

it('offers a + on every connection and reports what was added where', async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn();
  render(
    <ChainCanvas
      graph={graph}
      selected={null}
      onSelect={() => undefined}
      choices={choices}
      onInsert={onInsert}
    />,
  );
  const adds = screen.getAllByRole('button', { name: /Add a block between/ });
  expect(adds).toHaveLength(3);
  await user.click(
    screen.getByRole('button', {
      name: 'Add a block between Gate and Plexi 50',
    }),
  );
  await user.click(screen.getByRole('button', { name: /Add a block here/ }));
  await user.click(screen.getByRole('button', { name: 'Delay' }));
  expect(onInsert).toHaveBeenCalledWith(['gate', 'amp'], choices[0]);
});

it('offers a parallel path only when the owner can branch', async () => {
  const user = userEvent.setup();
  const onBranch = vi.fn();
  render(
    <ChainCanvas
      graph={graph}
      selected={null}
      onSelect={() => undefined}
      choices={choices}
      onBranch={onBranch}
    />,
  );
  await user.click(
    screen.getByRole('button', {
      name: 'Add a block between Gate and Plexi 50',
    }),
  );
  expect(screen.queryByRole('button', { name: /Add a block here/ })).toBeNull();
  await user.click(
    screen.getByRole('button', { name: /Branch a parallel path here/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Reverb' }));
  expect(onBranch).toHaveBeenCalledWith(['gate', 'amp'], choices[1]);
});

it('moves along the chain with the arrow keys', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ChainCanvas graph={graph} selected="gate" onSelect={onSelect} />);
  screen.getByRole('application').focus();
  await user.keyboard('{ArrowRight}');
  expect(onSelect).toHaveBeenCalledWith('amp');
});

it('shows the same chain as a list, its blocks in signal order', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ChainCanvas graph={graph} selected={null} onSelect={onSelect} />);
  await user.click(
    screen.getByRole('button', { name: 'Show the chain as a list' }),
  );
  expect(screen.getByText('Signal chain as a list')).toBeVisible();
  // Blocks as rows in signal order, with no connection text.
  const rows = screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => /Gate|Plexi 50/.test(t));
  expect(rows.findIndex((t) => t.includes('Gate'))).toBeLessThan(
    rows.findIndex((t) => t.includes('Plexi 50')),
  );
  expect(screen.queryByText(/goes to/)).toBeNull();
  await user.click(screen.getByRole('button', { name: /Gate/ }));
  expect(onSelect).toHaveBeenCalledWith('gate');
  await user.click(screen.getByRole('button', { name: 'Show the map' }));
  expect(screen.getByRole('application')).toBeVisible();
});

it('keeps the minimap off until asked, and remembers the choice', async () => {
  const user = userEvent.setup();
  render(
    <ChainCanvas graph={graph} selected={null} onSelect={() => undefined} />,
  );
  expect(
    screen.queryByRole('group', { name: 'Chain overview map' }),
  ).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Minimap' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('group', { name: 'Chain overview map' }),
  ).toBeVisible();
  expect(localStorage.getItem('oxidal.canvas.minimap')).toBe('true');
  await user.click(toggle);
  expect(
    screen.queryByRole('group', { name: 'Chain overview map' }),
  ).toBeNull();
});
