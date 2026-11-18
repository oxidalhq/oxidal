/** A made-up waveform for practice stories: two louder sections. */
export function exampleWaveform(n = 120): number[] {
  return Array.from({ length: n }, (_, i) => {
    const section = Math.sin((i / n) * Math.PI * 4) * 0.25 + 0.6;
    return Math.max(
      0.12,
      Math.min(
        1,
        section + Math.sin(i * 1.7) * 0.18 + Math.sin(i * 0.31) * 0.1,
      ),
    );
  });
}
