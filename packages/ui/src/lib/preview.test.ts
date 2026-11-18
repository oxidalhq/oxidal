import { expect, it } from 'vitest';

import { shortValue } from './preview';

it('writes values as short as they can be read', () => {
  expect(shortValue({ value: 8000, unit: 'Hz' })).toBe('8 kHz');
  expect(shortValue({ value: 2500, unit: 'Hz' })).toBe('2.5 kHz');
  expect(shortValue({ value: 80, unit: 'Hz' })).toBe('80 Hz');
  expect(shortValue({ value: -48, unit: 'dB' })).toBe('-48 dB');
  expect(shortValue({ value: 5 })).toBe('5.0');
  expect(shortValue({ value: 6.5, unit: 'dB' })).toBe('6.5 dB');
});
