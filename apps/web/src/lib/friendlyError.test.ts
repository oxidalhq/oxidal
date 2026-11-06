import { expect, it } from 'vitest';
import { errorDetails, friendlyError } from './friendlyError';

it('explains network failures without the raw Error prefix', () => {
  const message = friendlyError(new TypeError('Failed to fetch'), 'save');
  expect(message).toBe(
    'Could not save. Oxidal is not reachable. Check the Wi-Fi or cable connection, then try again.',
  );
  expect(message).not.toMatch(/Error:/);
});

it('turns stale-confirmation conflicts into a check-again instruction', () => {
  expect(
    friendlyError(
      new Error('Deletion preview changed; review it again'),
      'delete this file',
    ),
  ).toMatch(/^Could not delete this file\. Something changed on the device/);
});

it('keeps a device sentence and finishes a fragment', () => {
  expect(
    friendlyError(
      new Error('This file is still used; remove it from what uses it first'),
      'delete',
    ),
  ).toBe(
    'Could not delete. This file is still used; remove it from what uses it first.',
  );
  expect(friendlyError('Error: Preset is busy.', 'play')).toBe(
    'Could not play. Preset is busy.',
  );
});

it('keeps the original text for Details', () => {
  expect(errorDetails(new Error('Error: raw cause'))).toBe('raw cause');
  expect(errorDetails(undefined)).toBe('Unknown error');
});
