import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { GlobalTuner } from './GlobalTuner';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
} from './api';
vi.mock('./api', () => ({
  playbackState: vi.fn(),
  playbackCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
}));
vi.mock('./AdjustmentDialog', () => ({
  AdjustmentDialog: ({
    children,
    onCancel,
  }: {
    children: ReactNode;
    onCancel: () => void;
  }) => (
    <div role="dialog">
      {children}
      <button onClick={onCancel}>Close</button>
    </div>
  ),
}));
const native = {
  phase: 'running',
  session: 'native-1',
  revision: 1,
  authoring: {
    tools: { tuner_enabled: false, tuner: { frequency: 440, confidence: 1 } },
  },
} as AudioState;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('uses the current native cursor and stops its tuner on close', async () => {
  vi.mocked(playbackState).mockResolvedValue(native);
  vi.mocked(playbackCommand).mockImplementation(
    async (_, action) =>
      ({
        ...native,
        authoring: {
          ...native.authoring,
          tools: {
            ...native.authoring!.tools,
            tuner_enabled:
              action.kind === 'authoring' &&
              action.action.kind === 'utility' &&
              action.action.command.kind === 'tuner' &&
              action.action.command.enabled,
          },
        },
      }) as AudioState,
  );
  const close = vi.fn();
  render(<GlobalTuner onClose={close} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start tuner' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start tuner' }));
  await screen.findByText('A4');
  expect(playbackCommand).toHaveBeenCalledWith(native, {
    kind: 'authoring',
    action: { kind: 'utility', command: { kind: 'tuner', enabled: true } },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(playbackCommand).toHaveBeenLastCalledWith(native, {
    kind: 'authoring',
    action: { kind: 'utility', command: { kind: 'tuner', enabled: false } },
  });
});
it('rejects a different session before issuing a tuner command', async () => {
  vi.mocked(playbackState)
    .mockResolvedValueOnce(native)
    .mockResolvedValue({ ...native, session: 'replacement' });
  render(<GlobalTuner onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start tuner' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start tuner' }));
  await screen.findByRole('alert');
  expect(playbackCommand).not.toHaveBeenCalled();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});
it('explains unsupported audio rather than starting a different rig', async () => {
  vi.mocked(playbackState).mockResolvedValue({ ...native, phase: 'stopped' });
  vi.mocked(rigAudioState).mockResolvedValue({ phase: 'stopped' } as Awaited<
    ReturnType<typeof rigAudioState>
  >);
  render(<GlobalTuner onClose={() => {}} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Start tuner' })).toBeDisabled();
  expect(playbackCommand).not.toHaveBeenCalled();
});
