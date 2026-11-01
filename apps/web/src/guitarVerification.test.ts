import { expect, it } from 'vitest';
import {
  guitarVerificationDetail,
  guitarVerificationState,
} from './guitarVerification';
import type { GuitarProfiles, Monitoring } from './api';

const verification = {
  endpoint: 'hw:CARD=Jogg,DEV=0',
  sample_rate: 48000,
  channels: 1,
  format: 's24_packed' as const,
  period_frames: 64,
  periods: 3,
  input_map: [0, 0] as [number, number],
  verified_at_ms: Date.UTC(2026, 10, 1, 6, 0),
};
const guitar: GuitarProfiles['guitars'][number] = {
  id: 'jiva',
  name: 'Jiva',
  peak_dbfs: -12,
  noise_dbfs: -70,
  verification,
};
const stream: NonNullable<Monitoring['stream']> = {
  hear_yourself: true,
  levels: { input_trim_db: 0, output_level_db: 0, mono: false },
  input: {
    endpoint: verification.endpoint,
    direction: 'capture',
    sample_rate: verification.sample_rate,
    channels: verification.channels,
    format: verification.format,
    period_frames: verification.period_frames,
    periods: verification.periods,
  },
  output: {
    endpoint: verification.endpoint,
    direction: 'playback',
    sample_rate: 48000,
    channels: 2,
    format: 's24_packed',
    period_frames: 64,
    periods: 3,
  },
  input_map: [0, 0],
  output_map: [0, 1],
};

it('distinguishes current, stored, stale and unverified measurements', () => {
  expect(guitarVerificationState(guitar, stream)).toBe('current');
  expect(guitarVerificationState(guitar, null)).toBe('stored');
  expect(
    guitarVerificationState(guitar, {
      ...stream,
      input: { ...stream.input, period_frames: 128 },
    }),
  ).toBe('stale');
  expect(
    guitarVerificationState({ ...guitar, verification: null }, stream),
  ).toBe('unverified');
  expect(
    guitarVerificationState(
      { ...guitar, peak_dbfs: null, noise_dbfs: null },
      stream,
    ),
  ).toBe('unmeasured');
});

it('describes the exact persisted input check without claiming a USB serial', () => {
  expect(guitarVerificationDetail(guitar)).toBe(
    'hw:CARD=Jogg,DEV=0 · 48 kHz · S24_PACKED · input 1/1 · 64 × 3 · checked 2026-11-01 06:00 UTC.',
  );
});
