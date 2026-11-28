import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { IdStep, RigBlockVM } from '../rigChain';
import { RouteMap } from './RouteMap';

beforeAll(() => {
  // jsdom has no ResizeObserver; the canvas uses one to fit itself to the space.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const tile = (id: string): RigBlockVM =>
  ({
    id: `${id}-tile`,
    label: id.toUpperCase(),
    kind: 'amp',
    on: true,
    face: null,
  }) as RigBlockVM;
const tiles = (id: string) => [tile(id)];
const route: IdStep[] = [
  'a',
  { split: 's', merge: 's-m', gains: [1, 1], branches: [['b'], []] },
];

function map(extra: Partial<React.ComponentProps<typeof RouteMap>> = {}) {
  const props = {
    route,
    tiles,
    onSelect: vi.fn(),
    onGap: vi.fn(),
    onAdd: vi.fn(),
    onMove: vi.fn(),
    ...extra,
  };
  render(<RouteMap {...props} />);
  return props;
}

it('draws every block and selects one with its tile id', async () => {
  const user = userEvent.setup();
  const props = map();
  expect(screen.getByRole('button', { name: 'A' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'B' }));
  expect(props.onSelect).toHaveBeenCalledWith('b-tile');
});

it('puts a + on a gap and reports the same route position the tree would', async () => {
  const user = userEvent.setup();
  const props = map();
  // Between A and the split: top level, position 2.
  await user.click(
    screen.getByRole('button', { name: 'Add or split at position 2' }),
  );
  expect(props.onGap).toHaveBeenCalledWith({ split: null, path: 0, index: 1 });
});

it('offers "add an effect" on an empty path and reports its position', async () => {
  const user = userEvent.setup();
  const props = map();
  await user.click(
    screen.getByRole('button', { name: 'Add effect to path 2' }),
  );
  expect(props.onAdd).toHaveBeenCalledWith({ split: 's', path: 1, index: 0 });
});

it('shows no + when the chain cannot be edited', () => {
  map({ onGap: undefined, onAdd: undefined, onMove: undefined });
  expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
});

it('shows no + when the chain is locked', () => {
  map({ disabled: true });
  expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
});

it('says what each parallel path is, with its level', () => {
  map();
  expect(screen.getByText(/^Path 1 · 100%/)).toBeVisible();
  expect(screen.getByText(/^Path 2 · 100%/)).toBeVisible();
});

it('names scene lanes by scene and marks the one sounding', () => {
  map({
    scenes: { split: 's', names: ['Clean', 'Lead'], sounding: 1 },
  });
  expect(screen.getByText('1 Clean')).toBeVisible();
  expect(screen.getByText('2 Lead · Sounding')).toBeVisible();
});

it('folds silent scene paths behind a toggle, and shows them again', async () => {
  const user = userEvent.setup();
  const many: IdStep[] = [
    {
      split: 's',
      merge: 's-m',
      gains: [1, 1, 1, 1, 1],
      branches: [['p0'], ['p1'], ['p2'], ['p3'], ['p4']],
    },
  ];
  map({
    route: many,
    scenes: {
      split: 's',
      names: ['One', 'Two', 'Three', 'Four', 'Five'],
      sounding: 0,
      enabled: [true, false, false, false, false],
    },
  });
  expect(screen.getByRole('button', { name: 'P1' })).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: /Fold 4 silent branches/ }),
  );
  expect(screen.queryByRole('button', { name: 'P1' })).toBeNull();
  expect(
    screen.getByRole('button', {
      name: /Show 4 silent: Two, Three, Four, Five/,
    }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Show 4 silent/ }));
  expect(screen.getByRole('button', { name: 'P1' })).toBeVisible();
});

it('is a group named Signal chain, like the tree', () => {
  map();
  expect(screen.getByRole('group', { name: 'Signal chain' })).toBeVisible();
});

it('sends an empty TONE3000 slot to the slot handler, not to selection', async () => {
  const user = userEvent.setup();
  const onSlot = vi.fn();
  const props = map({
    tiles: (id: string) => [{ ...tile(id), empty: true }],
    onSlot,
  });
  await user.click(
    screen.getAllByRole('button', { name: 'Add a block here' })[0]!,
  );
  expect(onSlot).toHaveBeenCalledWith('a-tile');
  expect(props.onSelect).not.toHaveBeenCalled();
});
