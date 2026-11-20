import { afterEach, expect, it, vi } from 'vitest';

import { openFirstRun } from './firstRun';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

it('opens setup once on a plain first visit and preserves history state', () => {
  history.replaceState({ key: 'existing' }, '', '/');
  openFirstRun();
  expect(location.hash).toBe('#settings/essentials');
  expect(history.state).toEqual({ key: 'existing' });
  history.replaceState(null, '', '/');
  openFirstRun();
  expect(location.hash).toBe('');
});

it('respects direct links and existing display preferences', () => {
  history.replaceState(null, '', '/#library/tones');
  openFirstRun();
  expect(location.hash).toBe('#library/tones');
  history.replaceState(null, '', '/');
  localStorage.setItem('oxidal.display', 'epaper');
  openFirstRun();
  expect(location.hash).toBe('');
});

it('retains the normal landing page when browser storage is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  openFirstRun();
  expect(location.hash).toBe('');
});
