import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChainView } from './ChainView';
import type { RigLaneVM } from './rigChain';
afterEach(cleanup);

const lane: RigLaneVM = {
  id: 'left',
  input: 'IN',
  blocks: [
    { id: 'amp', label: 'Bogner', kind: 'amp', on: true, face: null },
    {
      id: 'slot-2',
      label: 'Empty slot',
      kind: 'amp',
      on: false,
      face: null,
      empty: true,
    },
    { id: 'cab', label: 'Cab', kind: 'cab', on: true, face: null },
  ],
};

it('shows empty slots as + tiles in place only where blocks can be added', () => {
  const add = vi.fn();
  const view = render(
    <ChainView label="Chain" lanes={[lane]} onSelect={() => {}} onAdd={add} />,
  );
  const tiles = screen
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
  expect(tiles).toEqual(['Bogner', 'Add a block here', 'Cab']);
  fireEvent.click(screen.getByRole('button', { name: 'Add a block here' }));
  expect(add).toHaveBeenCalledWith('slot-2');
  view.rerender(<ChainView label="Chain" lanes={[lane]} onSelect={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Add a block here' })).toBeNull();
});
