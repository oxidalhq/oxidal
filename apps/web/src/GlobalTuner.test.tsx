import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { GlobalTuner } from './GlobalTuner';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  monitoring,
  type AudioState,
} from './api';
vi.mock('./api', () => ({
  playbackState: vi.fn(),
  playbackCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  monitoring: vi.fn(),
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
beforeEach(() => {
  vi.mocked(monitoring).mockResolvedValue({
    audio_phase: 'running',
    graph_phase: 'stopped',
    rig_phase: 'stopped',
    sequence: 1,
    host: {},
    audio: { monitoring: { output_muted: false } },
  } as Awaited<ReturnType<typeof monitoring>>);
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
  await screen.findByText('A4');
  expect(screen.queryByRole('button', { name: 'Start tuner' })).toBeNull();
  expect(playbackCommand).toHaveBeenCalledWith(native, {
    kind: 'authoring',
    action: { kind: 'utility', command: { kind: 'tuner', enabled: true } },
  });
  expect(playbackCommand).toHaveBeenCalledWith(native, {
    kind: 'host_utility',
    command: { kind: 'output_mute', enabled: true },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(playbackCommand).toHaveBeenCalledWith(native, {
    kind: 'authoring',
    action: { kind: 'utility', command: { kind: 'tuner', enabled: false } },
  });
  expect(playbackCommand).toHaveBeenLastCalledWith(native, {
    kind: 'host_utility',
    command: { kind: 'output_mute', enabled: false },
  });
});
it('automatically mutes after the rig and restores monitoring on close', async () => {
  vi.mocked(playbackState).mockResolvedValue(native);
  vi.mocked(playbackCommand).mockResolvedValue(native);
  const close = vi.fn();
  render(<GlobalTuner onClose={close} />);
  const mute = await screen.findByRole('radio', { name: 'Mute' });
  await waitFor(() => expect(mute).toBeEnabled());
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(native, {
      kind: 'host_utility',
      command: { kind: 'output_mute', enabled: true },
    }),
  );
  expect(mute).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'Hear sound' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(playbackCommand).toHaveBeenLastCalledWith(native, {
    kind: 'host_utility',
    command: { kind: 'output_mute', enabled: false },
  });
});
it('rejects a different session before issuing a tuner command', async () => {
  vi.mocked(playbackState)
    .mockResolvedValueOnce(native)
    .mockResolvedValue({ ...native, session: 'replacement' });
  render(<GlobalTuner onClose={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Tuner unavailable',
  );
  expect(playbackCommand).not.toHaveBeenCalled();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});
it('explains unsupported audio rather than starting a different rig', async () => {
  vi.mocked(playbackState).mockResolvedValue({ ...native, phase: 'stopped' });
  vi.mocked(rigAudioState).mockResolvedValue({ phase: 'stopped' } as Awaited<
    ReturnType<typeof rigAudioState>
  >);
  render(<GlobalTuner onClose={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Tuner unavailable',
  );
  expect(screen.getByRole('radio', { name: 'Mute' })).toBeDisabled();
  expect(playbackCommand).not.toHaveBeenCalled();
});
