/** Average output while playing that every matched preset lands on (before Level). */
export const MATCH_TARGET_DBFS = -18;
const MIN_SAMPLES = 4;
export const RANGE_DB = 24;

/** The rig Output level control maps 0–1 to −24…+24 dB. */
export const outputDb = (value: number) => (value - 0.5) * 2 * RANGE_DB;
export const outputValue = (db: number) =>
  0.5 + Math.min(RANGE_DB, Math.max(-RANGE_DB, db)) / (2 * RANGE_DB);

/** Mean of power readings in dB, or null when too few were taken while playing. */
export function averageDb(readings: number[]) {
  if (readings.length < MIN_SAMPLES) return null;
  const power =
    readings.reduce((sum, db) => sum + 10 ** (db / 10), 0) / readings.length;
  return 10 * Math.log10(power);
}
