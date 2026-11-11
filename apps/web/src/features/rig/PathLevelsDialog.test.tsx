import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PathLevelsDialog } from './PathLevelsDialog';
import { RigChainSurfaceChooser } from './RigChainSurfaceChooser';
import type { RigViewProps } from './useMixedRigSession';

vi.mock('../../api', async (actual) => ({
  ...(await actual<typeof import('../../api')>()),
  installedLv2: vi.fn().mockResolvedValue([]),
}));

afterEach(cleanup);

// Split: Path 1 holds Echo and a nested split with Hall; Path 2 is dry.
const fullRoute = [
  {
    split: 'split',
    merge: 'merge',
    gains: [1, 1],
    branches: [
      [
        'echo',
        {
          split: 'inner',
          merge: 'inner-merge',
          gains: [1, 1],
          branches: [['hall'], []],
        },
      ],
      [],
    ],
  },
];
function props(editChain = vi.fn()) {
  const setRoutingSplit = vi.fn();
  return {
    editChain,
    setRoutingSplit,
    view: {
      rig: {
        busy: false,
        edit: null,
        editChain,
        editing: false,
        routingSplit: 'split',
        setPathSides: vi.fn(),
        setRoutingSplit,
      },
      vm: {
        disabled: false,
        editable: true,
        fullRoute,
        state: { control: { controls: [] } },
      },
    } as unknown as RigViewProps,
  };
}

it('asks before removing a path with effects, naming the path and count (S-16)', () => {
  const { editChain, view } = props();
  render(<PathLevelsDialog {...view} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove path 1' }));
  expect(editChain).not.toHaveBeenCalled();
  const confirm = screen.getByRole('dialog', { name: 'Remove Path 1' });
  expect(confirm).toHaveTextContent('Remove Path 1 and its 2 effects?');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Remove Path 1' })).toBeNull();
  expect(editChain).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove path 1' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Remove Path 1' })).getByRole(
      'button',
      { name: 'Remove' },
    ),
  );
  expect(editChain).toHaveBeenCalledTimes(1);
});

it('removes an empty path at once', () => {
  const { editChain, view } = props();
  render(<PathLevelsDialog {...view} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove path 2' }));
  expect(screen.queryByRole('dialog', { name: /^Remove Path/ })).toBeNull();
  expect(editChain).toHaveBeenCalledTimes(1);
});

it('titles the effect chooser for Replace… and for Add', () => {
  const chooser = (kind: 'replace' | 'add') =>
    ({
      rig: {
        canvasChoice:
          kind === 'replace'
            ? { kind, id: 'echo' }
            : { kind, at: { split: null, path: 0, index: 0 } },
        editChain: vi.fn(),
        matching: null,
        setCanvasChoice: vi.fn(),
      },
      vm: {
        changed: false,
        fullRoute,
        state: { configured: { stream: { input: { sample_rate: 48000 } } } },
      },
    }) as unknown as RigViewProps;
  const { unmount } = render(
    <RigChainSurfaceChooser {...chooser('replace')} />,
  );
  expect(screen.getByRole('dialog', { name: 'Replace with…' })).toBeVisible();
  unmount();
  render(<RigChainSurfaceChooser {...chooser('add')} />);
  expect(screen.getByRole('dialog', { name: 'Add an effect' })).toBeVisible();
});
