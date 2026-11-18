import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deviceNetwork, type NetworkState } from './api';
import { useDeviceNetwork } from './useDeviceNetwork';

vi.mock('./api', () => ({ deviceNetwork: vi.fn() }));
const read = vi.mocked(deviceNetwork);
const state: NetworkState = {
  available: true,
  wireless_enabled: true,
  radio: null,
  policy: null,
  interfaces: [],
  networks: [],
  saved: [],
  pending: null,
  message: 'fresh',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('aborts and discards a late poll after a newer command receipt', async () => {
  const poll = deferred<NetworkState>();
  read
    .mockReturnValueOnce(poll.promise)
    .mockResolvedValueOnce({ ...state, message: 'new transaction' });
  const { result } = renderHook(() => useDeviceNetwork(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const signal = read.mock.calls[0]![1]!;
  await act(async () => {
    await result.current.run({ type: 'scan' });
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    poll.resolve({ ...state, message: 'old' });
  });
  expect(result.current.state?.message).toBe('new transaction');
});

it('does not overlap polls or repeat a pending command', async () => {
  const poll = deferred<NetworkState>();
  const command = deferred<NetworkState>();
  read.mockReturnValueOnce(poll.promise).mockReturnValueOnce(command.promise);
  const { result } = renderHook(() => useDeviceNetwork(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(read).toHaveBeenCalledTimes(1);
  let running!: Promise<boolean>;
  act(() => {
    running = result.current.run({ type: 'scan' });
  });
  await act(async () => {
    expect(await result.current.run({ type: 'scan' })).toBe(false);
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    command.resolve(state);
    await running;
  });
  expect(result.current.busy).toBe(false);
});

it('reads back an uncertain write once without replaying it and retains stale status until fresh', async () => {
  const fresh = deferred<NetworkState>();
  read
    .mockResolvedValueOnce(state)
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useDeviceNetwork(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {});
  await act(async () => {
    await result.current.run({ type: 'forget', uuid: 'saved-id' });
  });
  expect(result.current.error).toBe('Connection lost');
  expect(result.current.readError).toContain('uncertain');
  expect(read.mock.calls.map(([command]) => command?.type)).toEqual([
    undefined,
    'forget',
    undefined,
  ]);
  await act(async () => {
    fresh.resolve({ ...state, message: 'confirmed readback' });
  });
  expect(result.current.readError).toBe('');
  expect(result.current.state?.message).toBe('confirmed readback');
});

it('bounds requests and aborts its owner when unmounted', async () => {
  read.mockImplementation(
    (_command, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('Aborted')), {
          once: true,
        });
      }),
  );
  const { result, unmount } = renderHook(() => useDeviceNetwork(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25000);
  });
  expect(result.current.readError).toContain('Cannot reach');
  act(() => {
    void result.current.refresh();
  });
  const signal = read.mock.calls.at(-1)![1]!;
  unmount();
  expect(signal.aborted).toBe(true);
});
