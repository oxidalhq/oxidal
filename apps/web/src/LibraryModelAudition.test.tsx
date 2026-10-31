import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryModelAudition } from './LibraryModelAudition';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
  type RigAudioState,
} from './api';
vi.mock('./api', () => ({
  playbackState: vi.fn(),
  playbackCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
}));
const authoring = {
  can_undo: true,
  can_redo: false,
  layout: { stereo: false, left: [{ id: 'amp', insert: false }], right: [] },
};
const opening = {
  session: 'native-owner',
  revision: 10,
  phase: 'running',
  authoring,
  controls: [{ target: 'block:amp:enabled', label: 'My amp · left · enabled' }],
} as unknown as AudioState;
const mixed = {
  session: 'mixed-owner',
  revision: 20,
  phase: 'running',
  control: {
    session: 'worker-owner',
    revision: 4,
    authoring: [{ node: 'node-1', status: authoring }],
    controls: [
      {
        target: {
          kind: 'native',
          node: 'node-1',
          parameter: 'block:amp:enabled',
        },
        label: 'My amp · left · enabled',
      },
    ],
  },
} as unknown as RigAudioState;
beforeEach(() => {
  vi.mocked(playbackState).mockResolvedValue(opening);
  vi.mocked(rigAudioState).mockResolvedValue({
    phase: 'stopped',
  } as RigAudioState);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('opening is read-only and audition needs a selected block and an explicit click', async () => {
  render(<LibraryModelAudition asset="chosen-file" onOpenRig={vi.fn()} />);
  const select = await screen.findByRole('combobox', { name: 'Replace block' });
  expect(playbackCommand).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Audition' })).toBeDisabled();
  fireEvent.change(select, { target: { value: '/amp' } });
  vi.mocked(playbackCommand).mockResolvedValue({
    ...opening,
    model_change: {
      request: 7,
      phase: 'preparing',
      assignment: { target: 'amp', asset: 'chosen-file' },
    },
  });
  vi.mocked(playbackState)
    .mockResolvedValueOnce(opening)
    .mockResolvedValue({
      ...opening,
      model_change: {
        request: 7,
        phase: 'applied',
        assignment: { target: 'amp', asset: 'chosen-file' },
      },
    });
  fireEvent.click(screen.getByRole('button', { name: 'Audition' }));
  await screen.findByText(/Auditioning this model/);
  expect(playbackCommand).toHaveBeenCalledExactlyOnceWith(opening, {
    kind: 'replace_model',
    assignment: { target: 'amp', asset: 'chosen-file' },
  });
});
it('rejects a native owner changed while the preview was open', async () => {
  render(<LibraryModelAudition asset="chosen-file" onOpenRig={vi.fn()} />);
  const select = await screen.findByRole('combobox', { name: 'Replace block' });
  fireEvent.change(select, { target: { value: '/amp' } });
  vi.mocked(playbackState).mockResolvedValue({ ...opening, revision: 11 });
  fireEvent.click(screen.getByRole('button', { name: 'Audition' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'audition target changed',
  );
  expect(playbackCommand).not.toHaveBeenCalled();
});
it('rejects a different mixed worker before sending an audition', async () => {
  vi.mocked(playbackState).mockResolvedValue({ ...opening, phase: 'stopped' });
  vi.mocked(rigAudioState).mockResolvedValue(mixed);
  render(<LibraryModelAudition asset="chosen-file" onOpenRig={vi.fn()} />);
  const select = await screen.findByRole('combobox', { name: 'Replace block' });
  fireEvent.change(select, { target: { value: 'node-1/amp' } });
  vi.mocked(rigAudioState).mockResolvedValue({
    ...mixed,
    control: { ...mixed.control!, session: 'other-worker' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Audition' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'playing rig changed',
  );
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('auditions the selected mixed node with its current control revision', async () => {
  vi.mocked(playbackState).mockResolvedValue({ ...opening, phase: 'stopped' });
  vi.mocked(rigAudioState).mockResolvedValue(mixed);
  render(<LibraryModelAudition asset="chosen-file" onOpenRig={vi.fn()} />);
  const select = await screen.findByRole('combobox', { name: 'Replace block' });
  fireEvent.change(select, { target: { value: 'node-1/amp' } });
  const next: RigAudioState = {
    ...mixed,
    control: {
      ...mixed.control!,
      model_change: {
        node: 'node-1',
        progress: {
          request: 8,
          phase: 'applied',
          assignment: { target: 'amp', asset: 'chosen-file' },
        },
      },
    },
  };
  vi.mocked(rigAudioCommand).mockResolvedValue(next);
  vi.mocked(rigAudioState).mockResolvedValueOnce(mixed).mockResolvedValue(next);
  fireEvent.click(screen.getByRole('button', { name: 'Audition' }));
  await screen.findByText(/Auditioning this model/);
  expect(rigAudioCommand).toHaveBeenCalledExactlyOnceWith(mixed, {
    kind: 'model',
    command: {
      session: 'worker-owner',
      expected_revision: 4,
      node: 'node-1',
      operation: {
        kind: 'prepare',
        assignment: { target: 'amp', asset: 'chosen-file' },
      },
    },
  });
});
