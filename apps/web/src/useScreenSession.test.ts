import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useScreenSession } from './useScreenSession';

class Lock extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}
let hidden = false;
let locks: Lock[];
let request: ReturnType<typeof vi.fn>;
function visibility(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  localStorage.clear();
  hidden = false;
  locks = [];
  request = vi.fn(async () => {
    const lock = new Lock();
    locks.push(lock);
    return lock;
  });
  vi.stubGlobal('isSecureContext', true);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'wakeLock');
});
it('keeps its preference and reacquires after hiding, with explicit release on disable', async () => {
  const { result, unmount } = renderHook(useScreenSession);
  expect(request).not.toHaveBeenCalled();
  act(() => result.current.setKeepAwake(true));
  await waitFor(() => expect(result.current.wakeStatus).toBe('active'));
  expect(request).toHaveBeenCalledWith('screen');
  act(() => visibility(true));
  await waitFor(() => expect(locks[0]!.release).toHaveBeenCalledOnce());
  expect(result.current.wakeStatus).toBe('paused');
  act(() => visibility(false));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.wakeStatus).toBe('active'));
  unmount();
  expect(locks[1]!.release).toHaveBeenCalledOnce();
  const next = renderHook(useScreenSession);
  await waitFor(() => expect(next.result.current.wakeStatus).toBe('active'));
  act(() => next.result.current.setKeepAwake(false));
  expect(next.result.current.wakeStatus).toBe('off');
  expect(localStorage.getItem('oxidal.keepAwake')).toBe('false');
  expect(locks[2]!.release).toHaveBeenCalledOnce();
});
it('shows denied/revoked status without retry loops and allows explicit retry', async () => {
  request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  const { result } = renderHook(useScreenSession);
  act(() => result.current.setKeepAwake(true));
  await waitFor(() => expect(result.current.wakeStatus).toBe('denied'));
  expect(request).toHaveBeenCalledOnce();
  act(() => result.current.retryWake());
  await waitFor(() => expect(result.current.wakeStatus).toBe('active'));
  await act(() => locks[0]!.release());
  expect(result.current.wakeStatus).toBe('paused');
  expect(request).toHaveBeenCalledTimes(2);
});
it('releases a late acquisition after the user has disabled keep-awake', async () => {
  let resolve!: (lock: Lock) => void;
  request.mockImplementationOnce(
    () =>
      new Promise<Lock>((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(useScreenSession);
  act(() => result.current.setKeepAwake(true));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  act(() => result.current.setKeepAwake(false));
  const late = new Lock();
  await act(async () => resolve(late));
  expect(late.release).toHaveBeenCalledOnce();
  expect(result.current.wakeStatus).toBe('off');
});
it('does not request wake lock on an insecure or unsupported page', () => {
  vi.stubGlobal('isSecureContext', false);
  localStorage.setItem('oxidal.keepAwake', 'true');
  const { result } = renderHook(useScreenSession);
  expect(result.current.wakeSupported).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
it('tracks fullscreen exit events and rejected requests independently from wake lock', async () => {
  let element: Element | null = null;
  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => element,
  });
  const enter = vi.fn(async () => {
    element = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: enter,
  });
  const { result } = renderHook(useScreenSession);
  await act(() => result.current.toggleFullscreen());
  expect(result.current.fullscreen).toBe(true);
  expect(request).not.toHaveBeenCalled();
  act(() => {
    element = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(result.current.fullscreen).toBe(false);
  enter.mockRejectedValueOnce(new Error('denied'));
  await act(() => result.current.toggleFullscreen());
  expect(result.current.fullscreenError).toContain('not allowed');
  Reflect.deleteProperty(document, 'fullscreenEnabled');
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
});
