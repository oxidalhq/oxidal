import type { GuitarProfiles, Monitoring } from './api';

type Guitar = GuitarProfiles['guitars'][number];
type Stream = NonNullable<Monitoring['stream']>;

export type GuitarVerificationState =
  'unmeasured' | 'unverified' | 'stored' | 'current' | 'stale';

export function guitarVerificationState(
  guitar: Guitar | undefined,
  stream: Stream | null | undefined,
): GuitarVerificationState {
  if (!guitar || (guitar.peak_dbfs == null && guitar.noise_dbfs == null))
    return 'unmeasured';
  const verification = guitar.verification;
  if (!verification) return 'unverified';
  if (!stream) return 'stored';
  const input = stream.input;
  return verification.endpoint === input.endpoint &&
    verification.sample_rate === input.sample_rate &&
    verification.channels === input.channels &&
    verification.format === input.format &&
    verification.period_frames === input.period_frames &&
    verification.periods === input.periods &&
    verification.input_map[0] === stream.input_map[0] &&
    verification.input_map[1] === stream.input_map[1]
    ? 'current'
    : 'stale';
}

export function guitarVerificationDetail(guitar: Guitar | undefined) {
  const verification = guitar?.verification;
  if (!verification) return 'No input verification saved.';
  const checked = new Date(verification.verified_at_ms)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16);
  const channels = verification.input_map
    .map((channel) => channel + 1)
    .join('/');
  return `${verification.endpoint} · ${verification.sample_rate / 1000} kHz · ${verification.format.toUpperCase()} · input ${channels} · ${verification.period_frames} × ${verification.periods} · checked ${checked} UTC.`;
}
