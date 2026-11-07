import { describe, expect, it } from 'vitest';
import {
  DeviceError,
  deviceError,
  errorDetails,
  errorRecovery,
  friendlyError,
} from './friendlyError';

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

describe('device error codes', () => {
  it('keeps the code from a failed response and picks one recovery', () => {
    const conflict = deviceError(
      { error: 'Session changed', code: 'conflict' },
      409,
      'x',
    );
    expect(conflict).toBeInstanceOf(DeviceError);
    expect(errorRecovery(conflict)).toBe('refresh');
    expect(
      errorRecovery(deviceError({ error: 'Busy', code: 'busy' }, 409, 'x')),
    ).toBe('retry');
    expect(
      errorRecovery(
        deviceError({ error: 'Protect is on.', code: 'locked' }, 423, 'x'),
      ),
    ).toBe('unlock');
    expect(
      errorRecovery(deviceError({ error: 'Bad', code: 'invalid' }, 422, 'x')),
    ).toBeNull();
    expect(errorRecovery(new Error('plain'))).toBeNull();
    // A body without a code stays a plain error with the fallback text.
    expect(
      deviceError(null, 500, 'Preset operation failed'),
    ).not.toBeInstanceOf(DeviceError);
    expect(deviceError(null, 500, 'Preset operation failed').message).toBe(
      'Preset operation failed',
    );
  });
  it('explains terse device messages by their kind, keeps full sentences', () => {
    expect(
      friendlyError(
        deviceError(
          {
            error: 'Preset library operation already in progress',
            code: 'busy',
          },
          409,
          'x',
        ),
        'save the preset',
      ),
    ).toBe(
      'Could not save the preset. Another change is still running on the device. Try again when it finishes.',
    );
    expect(
      friendlyError(
        deviceError(
          {
            error: 'Protect is on. Turn Protect off to change this.',
            code: 'locked',
          },
          423,
          'x',
        ),
        'change the EQ',
      ),
    ).toBe(
      'Could not change the EQ. Protect is on. Turn Protect off to change this.',
    );
    expect(
      friendlyError(
        deviceError({ error: 'missing', code: 'not_found' }, 404, 'x'),
        'open this preset',
      ),
    ).toBe(
      'Could not open this preset. It is no longer on the device. Refresh to see what is there now.',
    );
  });
});
