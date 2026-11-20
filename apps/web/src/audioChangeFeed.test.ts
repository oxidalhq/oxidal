import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { audioChange, type AudioChangeState } from './api';
import { changeAudio, useAudioChange } from './audioChangeFeed';

vi.mock('./api', () => ({ audioChange: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shares one state read between simultaneous audio confirmation views', async () => {
  vi.mocked(audioChange).mockResolvedValue({ phase: 'idle' });
  const first = renderHook(() => useAudioChange());
  const second = renderHook(() => useAudioChange());
  await act(async () => {
    await Promise.resolve();
  });
  expect(audioChange).toHaveBeenCalledTimes(1);
  expect(first.result.current.state?.phase).toBe('idle');
  expect(second.result.current.state?.phase).toBe('idle');
});

it('cannot replace a command receipt with a GET that started before it', async () => {
  let release!: (state: AudioChangeState) => void;
  vi.mocked(audioChange).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = renderHook(() => useAudioChange());
  vi.mocked(audioChange).mockResolvedValueOnce({
    phase: 'kept',
    id: 'current-trial',
    owner: 'native',
  });
  await act(async () => {
    await changeAudio({ kind: 'keep', id: 'current-trial' });
  });
  await act(async () => {
    release({ phase: 'idle' });
    await Promise.resolve();
  });
  expect(view.result.current.state?.phase).toBe('kept');
  expect(view.result.current.state?.id).toBe('current-trial');
  expect(audioChange).toHaveBeenCalledTimes(2);
});

it('retains the write receipt when replacing the audio form unsubscribes and remounts its reader', async () => {
  vi.mocked(audioChange).mockResolvedValueOnce({ phase: 'idle' });
  const first = renderHook(() => useAudioChange());
  await act(async () => {
    await Promise.resolve();
  });
  let release!: (state: AudioChangeState) => void;
  vi.mocked(audioChange).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = changeAudio({ kind: 'keep', id: 'remount-trial' });
  });
  first.unmount();
  const second = renderHook(() => useAudioChange());
  await act(async () => {
    release({ phase: 'kept', id: 'remount-trial' });
    await pending;
  });
  expect(second.result.current.pending).toBe(false);
  expect(second.result.current.state?.phase).toBe('kept');
  expect(audioChange).toHaveBeenCalledTimes(2);
});

it('lets ID-bound Stop bypass a pending Keep and ignores the late Keep reply', async () => {
  vi.mocked(audioChange).mockResolvedValueOnce({
    phase: 'proving',
    id: 'priority-trial',
    owner: 'native',
    remaining_ms: 10000,
  });
  const view = renderHook(() => useAudioChange());
  await act(async () => {
    await Promise.resolve();
  });
  let release!: (state: AudioChangeState) => void;
  vi.mocked(audioChange).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let keep!: Promise<void>;
  act(() => {
    keep = changeAudio({ kind: 'keep', id: 'priority-trial' });
  });
  vi.mocked(audioChange).mockResolvedValueOnce({
    phase: 'reverting',
    id: 'priority-trial',
    owner: 'native',
  });
  await act(async () => {
    await changeAudio({ kind: 'stop', id: 'priority-trial' });
  });
  await act(async () => {
    release({ phase: 'kept', id: 'priority-trial' });
    await keep;
  });
  expect(view.result.current.state?.phase).toBe('reverting');
  expect(audioChange).toHaveBeenLastCalledWith({
    kind: 'stop',
    id: 'priority-trial',
  });
});
