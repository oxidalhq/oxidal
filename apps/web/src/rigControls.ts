/** Presentation groups never alter DSP values or decide which effects exist.
 * @see docs/native-tone3000.md
 */
export type ControlGroup = 'tone' | 'gate' | 'pitch' | 'stereo';
export function controlGroup(target: string): ControlGroup {
  if (target.startsWith('gate')) return 'gate';
  if (target.startsWith('pitch')) return 'pitch';
  if (
    /^(spread|align|chainPan|chainInvert)/.test(target) ||
    target === 'outputBalance'
  )
    return 'stereo';
  return 'tone';
}
export function shortControlLabel(label: string) {
  const parts = label.split(' · ');
  if (parts.length < 3) return label;
  const name = parts.at(-1)!;
  return (
    (
      {
        inputGain: 'Input gain',
        outputGain: 'Output gain',
        normalize: 'Normalize',
        mix: 'Mix',
      } as Record<string, string>
    )[name] ?? name
  );
}
/** Keep the DSP's real units while an asynchronous gesture is in flight. */
export function confirmedControlDisplay(display: string, pending: boolean) {
  return pending ? `${display} · updating` : display;
}
