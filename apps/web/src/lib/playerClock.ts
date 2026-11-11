import type { PlayerSnapshot } from '../api';

/**
 * Where the backing track is, in seconds. While `playing`, the shown position
 * advances locally from the last snapshot's frame until the next snapshot; it
 * never runs past the end (or wraps with Repeat), so a late snapshot cannot
 * make the time jump backwards by more than the network delay.
 * @see docs/media.md
 */
export function positionAt(
  player: PlayerSnapshot | null,
  receivedAt: number,
  now: number,
): number {
  const track = player?.track;
  if (!player || !track || track.rate <= 0) return 0;
  const length = track.frames / track.rate;
  let at = player.frame / track.rate;
  if (player.state === 'ended') return length;
  if (player.state === 'playing') at += Math.max(0, now - receivedAt) / 1000;
  if (at < length) return at;
  return player.repeat && length > 0 ? at % length : length;
}

/** Track length in seconds; 0 with nothing cued. */
export function lengthOf(player: PlayerSnapshot | null): number {
  const track = player?.track;
  return track && track.rate > 0 ? track.frames / track.rate : 0;
}

/** `m:ss`, never negative. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Screen-reader time: "1 minute 12". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m} minute${m === 1 ? '' : 's'} ${s % 60}`;
}

/** Signed dB with a true minus sign: "−6.0 dB". */
export function formatDb(db: number): string {
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}
