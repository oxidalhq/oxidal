import { afterEach, expect, it, vi } from 'vitest';
import type { VenueSettings } from '../api';
import {
  formatDb,
  formatHz,
  formatHzShort,
  headroom,
  peakBoost,
  responseAt,
  responseCurve,
  stepHz,
  stepQ,
  withBand,
} from './venueEq';
import { PreviewThrottle } from './venuePreview';

/** The device's Flat profile: pass filters off, everything else at 0 dB. */
function flat(): VenueSettings {
  const band = (enabled: boolean, freqHz: number, q: number) => ({
    enabled,
    freqHz,
    gainDb: 0,
    q,
    steep: false,
  });
  return {
    bands: [
      band(false, 80, 0.707),
      band(true, 120, 0.707),
      band(true, 250, 1),
      band(true, 1000, 1),
      band(true, 3500, 1),
      band(true, 8000, 0.707),
      band(false, 12000, 0.707),
    ],
    trimDb: 0,
  };
}

it('is flat when every band is off or at 0 dB', () => {
  for (const [, db] of responseCurve(flat())) expect(db).toBeCloseTo(0, 9);
});

it('puts a bell at its gain exactly at its centre frequency', () => {
  const eq = withBand(flat(), 3, { gainDb: -6, freqHz: 1000, q: 1 });
  expect(responseAt(eq, 1000)).toBeCloseTo(-6, 3);
  // A bell leaves frequencies far away untouched.
  expect(Math.abs(responseAt(eq, 20))).toBeLessThan(0.05);
  expect(Math.abs(responseAt(eq, 20000))).toBeLessThan(0.1);
});

it('gives shelves their plateau on the far side and half gain at the corner', () => {
  const low = withBand(flat(), 1, { gainDb: 6, freqHz: 120 });
  expect(responseAt(low, 20)).toBeCloseTo(6, 1);
  expect(responseAt(low, 120)).toBeCloseTo(3, 1);
  expect(Math.abs(responseAt(low, 10000))).toBeLessThan(0.01);
  const high = withBand(flat(), 5, { gainDb: -4, freqHz: 4000 });
  expect(responseAt(high, 20000)).toBeCloseTo(-4, 1);
  expect(Math.abs(responseAt(high, 50))).toBeLessThan(0.01);
});

it('makes pass filters −3 dB at the corner with a 12 or 24 dB/oct slope', () => {
  const hp = withBand(flat(), 0, { enabled: true, freqHz: 100 });
  expect(responseAt(hp, 100)).toBeCloseTo(-3.01, 2);
  // One octave below a second-order Butterworth corner: −12.3 dB.
  expect(responseAt(hp, 50)).toBeCloseTo(-12.3, 1);
  expect(Math.abs(responseAt(hp, 5000))).toBeLessThan(0.01);
  const steep = withBand(hp, 0, { steep: true });
  expect(responseAt(steep, 100)).toBeCloseTo(-3.01, 2);
  expect(responseAt(steep, 50)).toBeCloseTo(-24.1, 1);
  const lp = withBand(flat(), 6, { enabled: true, freqHz: 12000 });
  expect(responseAt(lp, 12000)).toBeCloseTo(-3.01, 2);
  expect(Math.abs(responseAt(lp, 100))).toBeLessThan(0.01);
  // A pass filter that is off adds nothing.
  expect(responseAt(withBand(lp, 6, { enabled: false }), 12000)).toBe(0);
});

it('adds bands together in dB', () => {
  const eq = withBand(withBand(flat(), 2, { gainDb: 3, freqHz: 500 }), 3, {
    gainDb: 3,
    freqHz: 500,
  });
  expect(responseAt(eq, 500)).toBeCloseTo(6, 3);
});

it('checks headroom from the peak boost plus trim', () => {
  const gentle = withBand(flat(), 3, { gainDb: 3 });
  expect(peakBoost(gentle)).toBeCloseTo(3, 2);
  expect(headroom(gentle)).toMatchObject({ risky: false, trim: null });
  const loud = withBand(
    withBand(flat(), 2, { gainDb: 6, freqHz: 400, q: 0.5 }),
    3,
    {
      gainDb: 6,
      freqHz: 800,
      q: 0.5,
    },
  );
  const check = headroom(loud);
  expect(check.risky).toBe(true);
  expect(check.peak).toBeGreaterThan(9);
  // The offered trim brings the peak back within +6 dB, in 0.5 dB steps.
  expect(check.trim! * 2).toBe(Math.round(check.trim! * 2));
  expect(peakBoost({ ...loud, trimDb: check.trim! })).toBeLessThanOrEqual(6);
  // Trim alone counts: +6 dB is still fine, +6.5 is not.
  expect(headroom({ ...flat(), trimDb: 6 }).risky).toBe(false);
  // A cut-only profile never reports a negative boost.
  expect(peakBoost(withBand(flat(), 3, { gainDb: -6 }))).toBe(0);
});

it('formats values with true minus signs and steps within each band', () => {
  expect(formatDb(1.5)).toBe('+1.5 dB');
  expect(formatDb(-3)).toBe('−3.0 dB');
  expect(formatDb(0)).toBe('0.0 dB');
  expect(formatHz(250)).toBe('250 Hz');
  expect(formatHz(1200)).toBe('1.20 kHz');
  expect(formatHz(12000)).toBe('12.0 kHz');
  expect(formatHzShort(120)).toBe('120');
  expect(formatHzShort(1000)).toBe('1k');
  expect(formatHzShort(3500)).toBe('3.5k');
  expect(formatHzShort(12000)).toBe('12k');
  expect(stepHz(0, 400, 1)).toBe(400);
  expect(stepHz(0, 20, -1)).toBe(20);
  expect(stepHz(3, 1000, 1)).toBe(1120);
  expect(stepQ(8, 1)).toBe(8);
  expect(stepQ(1, 1)).toBe(1.25);
});

afterEach(() => {
  vi.useRealTimers();
});

it('sends a drag at most every 50 ms with one request in flight, and always the release', async () => {
  vi.useFakeTimers();
  let now = 0;
  const sent: number[] = [];
  let settled = 0;
  const throttle = new PreviewThrottle<number>(
    async (value) => {
      sent.push(value);
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    () => settled++,
    50,
    () => now,
  );
  // One second of pointer moves every 4 ms, then the release.
  for (let i = 0; i < 250; i++) {
    throttle.push(i);
    now += 4;
    await vi.advanceTimersByTimeAsync(4);
  }
  throttle.finish(999);
  await vi.advanceTimersByTimeAsync(100);
  expect(sent.length).toBeLessThanOrEqual(22);
  expect(sent.length).toBeGreaterThan(10);
  expect(sent.at(-1)).toBe(999);
  expect(settled).toBeGreaterThanOrEqual(1);
  expect(throttle.busy).toBe(false);
});

it('waits for the request ahead before sending the release, and whenIdle flushes', async () => {
  const resolvers: (() => void)[] = [];
  const sent: number[] = [];
  const throttle = new PreviewThrottle<number>(
    (value) => {
      sent.push(value);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    () => {},
    50,
    () => 0,
  );
  throttle.push(1);
  throttle.push(2);
  throttle.finish(3);
  expect(sent).toEqual([1]);
  const idle = throttle.whenIdle();
  resolvers.shift()!();
  await vi.waitFor(() => expect(sent).toEqual([1, 3]));
  resolvers.shift()!();
  await idle;
  expect(throttle.busy).toBe(false);
});

it('drops waiting values after a refusal', async () => {
  const sent: number[] = [];
  let fail: (error: Error) => void = () => {};
  const throttle = new PreviewThrottle<number>(
    (value) => {
      sent.push(value);
      return new Promise<void>((_, reject) => {
        fail = reject;
      });
    },
    () => {},
    0,
  );
  throttle.push(1);
  throttle.push(2);
  fail(new Error('refused'));
  await vi.waitFor(() => expect(throttle.busy).toBe(false));
  expect(sent).toEqual([1]);
});
