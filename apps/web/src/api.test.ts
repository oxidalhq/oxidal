import { describe, expect, it } from 'vitest';
import { parseSnapshot } from './api';

describe('runtime contract validation', () => {
  it('rejects incomplete or future protocol state instead of showing a false value', () => {
    expect(() => parseSnapshot({ revision: 1 })).toThrow(
      'Incompatible device state',
    );
    expect(() => parseSnapshot({ protocol: 2 })).toThrow(
      'Incompatible device state',
    );
  });
});
