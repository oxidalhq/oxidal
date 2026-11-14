import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RigHeader } from './RigHeader';
import type { RigViewProps } from './useMixedRigSession';

vi.mock('../../RigPresetSelector', () => ({ RigPresetSelector: () => null }));
vi.mock('../stage/StageControls', () => ({ StageControls: () => null }));
vi.mock('../../TunerButton', () => ({ TunerButton: () => null }));
vi.mock('./RigHeaderDuplicate', () => ({ RigHeaderDuplicate: () => null }));

afterEach(cleanup);

function props(
  over: {
    undo?: string | null;
    redo?: string | null;
    drafts?: number;
    stepping?: -1 | 1 | null;
  } = {},
) {
  const stepHistory = vi.fn();
  const setStepping = vi.fn();
  const view = {
    rig: {
      actionsOpen: false,
      busy: false,
      connected: true,
      copyOnEdit: null,
      discarding: null,
      edit: null,
      editing: false,
      eqBusy: false,
      matching: { manifest: { name: 'Lead' } },
      picker: null,
      redoTarget: over.redo ?? null,
      revision: 'r2',
      setStepping,
      stepHistory,
      stepping: over.stepping ?? null,
      switching: false,
      undoTarget: over.undo ?? null,
      unsaved: null,
    },
    vm: {
      changed: false,
      disabled: false,
      draftCount: over.drafts ?? 0,
      performSwitching: false,
      running: true,
      state: { phase: 'running', device_owned: true },
    },
  } as unknown as RigViewProps;
  return { view, stepHistory, setStepping };
}

it('shows Undo and Redo, enabled only when there is a step to take', () => {
  const { view, stepHistory } = props({ undo: 'r1' });
  render(<RigHeader {...view} />);
  const undo = screen.getByRole('button', { name: 'Undo' });
  const redo = screen.getByRole('button', { name: 'Redo' });
  expect(undo).toBeEnabled();
  expect(redo).toBeDisabled();
  fireEvent.click(undo);
  expect(stepHistory).toHaveBeenCalledWith(-1);
});

it('waits for scene updates to be saved or discarded first', () => {
  const { view } = props({ undo: 'r1', redo: 'r3', drafts: 1 });
  render(<RigHeader {...view} />);
  const undo = screen.getByRole('button', { name: 'Undo' });
  expect(undo).toBeDisabled();
  expect(undo).toHaveAttribute(
    'title',
    'Save or discard your scene updates first',
  );
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
});

it('steps with Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, but not while typing', () => {
  const { view, stepHistory } = props({ undo: 'r1', redo: 'r3' });
  render(
    <>
      <RigHeader {...view} />
      <input aria-label="Preset name" />
    </>,
  );
  fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
  expect(stepHistory).toHaveBeenLastCalledWith(-1);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(stepHistory).toHaveBeenLastCalledWith(1);
  stepHistory.mockClear();
  fireEvent.keyDown(screen.getByLabelText('Preset name'), {
    key: 'z',
    metaKey: true,
  });
  expect(stepHistory).not.toHaveBeenCalled();
});

it('ignores the keys when there is nothing to step to', () => {
  const { view, stepHistory } = props();
  render(<RigHeader {...view} />);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  expect(stepHistory).not.toHaveBeenCalled();
});

it('asks before an Undo drops changes that are not saved', () => {
  const { view, stepHistory, setStepping } = props({
    undo: 'r1',
    stepping: -1,
  });
  render(<RigHeader {...view} />);
  const confirm = screen.getByRole('dialog', { name: 'Undo the last change?' });
  expect(confirm).toHaveTextContent('Lead has changes that are not saved.');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Undo' }));
  expect(stepHistory).toHaveBeenCalledWith(-1, true);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(setStepping).toHaveBeenCalledWith(null);
});
