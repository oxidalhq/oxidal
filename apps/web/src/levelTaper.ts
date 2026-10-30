/**
 * Master level fader taper: the lower quarter covers −60 to −30 dB, the rest
 * −30 to +12 dB, so the playing range around 0 dB gets most of the travel.
 * −60 dB is Off. Values snap to 0.5 dB.
 */
export const LEVEL_MIN = -60;
export const LEVEL_MAX = 12;
const KNEE = 0.25;
const KNEE_DB = -30;

export function levelToPosition(db: number) {
  const v = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, db));
  return v <= KNEE_DB
    ? ((v - LEVEL_MIN) / (KNEE_DB - LEVEL_MIN)) * KNEE
    : KNEE + ((v - KNEE_DB) / (LEVEL_MAX - KNEE_DB)) * (1 - KNEE);
}
export function positionToLevel(position: number) {
  const p = Math.min(1, Math.max(0, position));
  const db =
    p <= KNEE
      ? LEVEL_MIN + (p / KNEE) * (KNEE_DB - LEVEL_MIN)
      : KNEE_DB + ((p - KNEE) / (1 - KNEE)) * (LEVEL_MAX - KNEE_DB);
  return Math.round(db * 2) / 2;
}
export function formatLevel(db: number) {
  if (db <= LEVEL_MIN) return 'Off';
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}
