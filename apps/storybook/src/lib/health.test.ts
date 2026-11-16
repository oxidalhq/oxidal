import { expect, it } from 'vitest';
import { healthOf } from './health';

const calm = {
  dsp: { p95: 0.4, peak: 0.6 },
  cpu: 35,
  ram: { used: 2000, total: 8192 },
  xruns: 0,
  clips: 0,
  temperature: 58,
};

it('says one word for the device state', () => {
  expect(healthOf(calm).word).toBe('All good');
  expect(healthOf({ ...calm, dsp: { p95: 0.75, peak: 0.85 } }).word).toBe(
    'Busy',
  );
  expect(healthOf({ ...calm, xruns: 2 }).word).toBe('Dropouts');
  expect(healthOf({ ...calm, clips: 1 }).word).toBe('Clipping');
  expect(healthOf({ ...calm, dsp: { p95: 0.8, peak: 0.95 } }).word).toBe(
    'Running hot',
  );
  expect(healthOf({ ...calm, temperature: 82 }).advice).toMatch(/hot/);
  expect(healthOf(calm, 'stopped').word).toBe('Audio stopped');
  expect(healthOf(calm, 'disconnected').word).toBe('Disconnected');
});
