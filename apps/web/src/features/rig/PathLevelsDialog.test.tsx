import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PathLevel } from './PathLevel';
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

it('asks before removing a path with effects, naming the path and count', () => {
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

it('keeps Invert when a path is taken to level 0 and raised again', () => {
  const onCommit = vi.fn(async () => {});
  const mount = (left: number, right: number) =>
    render(
      <PathLevel
        key={`${left}:${right}`}
        id="merge:1"
        path={2}
        left={left}
        right={right}
        disabled={false}
        onCommit={onCommit}
      />,
    );
  // An inverted path at half level is taken to 0.
  const first = mount(-0.5, -0.5);
  expect(screen.getByLabelText('Invert path 2 polarity')).toBeChecked();
  const level = screen.getByLabelText('Path 2 level');
  fireEvent.change(level, { target: { value: '0' } });
  fireEvent.pointerUp(level);
  expect(onCommit).toHaveBeenLastCalledWith(0, 0);
  first.unmount();
  // The gains read back as 0 and 0, which cannot carry the polarity.
  mount(0, 0);
  expect(screen.getByLabelText('Invert path 2 polarity')).toBeChecked();
  const again = screen.getByLabelText('Path 2 level');
  fireEvent.change(again, { target: { value: '1' } });
  fireEvent.pointerUp(again);
  expect(onCommit).toHaveBeenLastCalledWith(-1, -1);
  cleanup();
  // Another path at 0 is not inverted by it.
  render(
    <PathLevel
      id="merge:0"
      path={1}
      left={0}
      right={0}
      disabled={false}
      onCommit={onCommit}
    />,
  );
  expect(screen.getByLabelText('Invert path 1 polarity')).not.toBeChecked();
});
