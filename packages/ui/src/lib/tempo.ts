/** Tempo from the gaps between the last taps; a pause of two seconds starts again. */
export function tempoFromTaps(times: number[]) {
  if (times.length < 2) return null;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const recent = gaps.slice(-4);
  const average = recent.reduce((a, b) => a + b, 0) / recent.length;
  return Math.round((60000 / average) * 10) / 10;
}
