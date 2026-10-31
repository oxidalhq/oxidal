import type { StartAudio } from './api';

/** Period sizes offered: powers of two plus USB packet-aligned choices, since full-speed
 * interfaces transfer in 1 ms packets (48 frames at 48 kHz). */
export const BUFFER_SIZES = [
  16, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048,
];

/** Device buffer length in ms: period size × periods at the session rate. */
export function bufferMs(
  stream: Pick<
    StartAudio['stream']['input'],
    'period_frames' | 'periods' | 'sample_rate'
  >,
) {
  return stream.sample_rate > 0
    ? (1000 * stream.period_frames * stream.periods) / stream.sample_rate
    : 0;
}
