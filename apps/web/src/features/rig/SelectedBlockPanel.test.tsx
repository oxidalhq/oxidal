import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SelectedBlockPanel } from './SelectedBlockPanel';
import type { RigViewProps } from './useMixedRigSession';

afterEach(cleanup);

function props(editChain = vi.fn(), busy = false) {
  return {
    rig: {
      busy,
      command: vi.fn(),
      edit: null,
      editChain,
      editing: false,
      picker: null,
      setCanvasChoice: vi.fn(),
      setPathSides: vi.fn(),
      shift: vi.fn(),
      shiftPath: vi.fn(),
      switching: false,
    },
    vm: {
      disabled: busy,
      editable: true,
      fullRoute: ['echo'],
      inLane: false,
      place: { first: true, last: true },
      running: true,
      sceneCanvas: null,
      selected: { id: 'echo', kind: 'lv2' },
      selectedBranch: { paths: 0 },
      selectedInScene: false,
      selectedSpot: undefined,
      selectedView: {
        block: { kind: 'delay' },
        bypass: { target: { kind: 'bypass', node: 'echo' }, value: 0 },
        label: 'Echo',
      },
      state: { control: { session: 's', revision: 1, controls: [] } },
    },
  } as unknown as RigViewProps;
}

it('asks before removing the selected block, and Cancel keeps it', () => {
  const editChain = vi.fn();
  render(<SelectedBlockPanel {...props(editChain)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Echo' }));
  expect(editChain).not.toHaveBeenCalled();
  const confirm = screen.getByRole('dialog', { name: 'Remove Echo' });
  expect(confirm).toHaveTextContent(
    'Remove Echo and its settings from this preset?',
  );
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Remove Echo' })).toBeNull();
  expect(editChain).not.toHaveBeenCalled();
});

it('removes the block once confirmed', () => {
  const editChain = vi.fn();
  render(<SelectedBlockPanel {...props(editChain)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Echo' }));
  const confirm = screen.getByRole('dialog', { name: 'Remove Echo' });
  const remove = within(confirm).getByRole('button', { name: 'Remove' });
  fireEvent.click(remove);
  expect(editChain).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog', { name: 'Remove Echo' })).toBeNull();
});

it('offers no Remove while a change is in flight', () => {
  render(<SelectedBlockPanel {...props(vi.fn(), true)} />);
  expect(screen.getByRole('button', { name: 'Remove Echo' })).toBeDisabled();
});
