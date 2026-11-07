import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  clearReturnTarget,
  readReturnTarget,
  remoteProblem,
  setReturnTarget,
  useSessionState,
} from './sessionState';

it('keeps page state for this tab and keeps a null key in memory only', () => {
  const first = renderHook(() => useSessionState('test-query', ''));
  act(() => first.result.current[1]('doom'));
  first.unmount();
  expect(
    renderHook(() => useSessionState('test-query', '')).result.current[0],
  ).toBe('doom');
  const memory = renderHook(() => useSessionState<string>(null, 'x'));
  act(() => memory.result.current[1]('y'));
  memory.unmount();
  expect(sessionStorage.length).toBe(1);
});

it('returns only to a page inside Oxidal', () => {
  setReturnTarget({ hash: '#library/discover', label: 'Discover' });
  expect(readReturnTarget()).toEqual({
    hash: '#library/discover',
    label: 'Discover',
  });
  clearReturnTarget();
  expect(readReturnTarget()).toBeNull();
  sessionStorage.setItem(
    'oxidal-page:return-target',
    JSON.stringify({ hash: 'https://elsewhere', label: 'x' }),
  );
  expect(readReturnTarget()).toBeNull();
});

it('tells a missing sign-in from a missing internet connection', () => {
  expect(
    remoteProblem('TONE3000 authorization expired; reconnect your account'),
  ).toBe('account');
  expect(remoteProblem('Connect your TONE3000 account before browsing')).toBe(
    'account',
  );
  expect(
    remoteProblem('Cannot reach TONE3000; local presets remain available'),
  ).toBe('offline');
  expect(
    remoteProblem('TONE3000 request limit reached; wait before retrying'),
  ).toBeNull();
});
