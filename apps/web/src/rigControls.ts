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

/** Move between actual models while retaining native insertion-slot identities. */
export function movedBlockOrder(
  blocks: readonly { id: string; insert: boolean }[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const models = blocks.filter((block) => !block.insert);
  const selected = models.findIndex((block) => block.id === id);
  const neighbour = models[selected + direction];
  if (selected < 0 || !neighbour) return null;
  return blocks.map((block) =>
    block.id === id ? neighbour.id : block.id === neighbour.id ? id : block.id,
  );
}

/** Repeat comparison may advance only the request accepted by this picker. */
export function assertAuditionOwner(
  opening: { session: string; revision: number },
  current: { session: string; revision: number },
  request: number | undefined,
  progress: { request: number; phase: string } | null | undefined,
) {
  if (
    opening.session !== current.session ||
    (request == null
      ? opening.revision !== current.revision
      : !progress ||
        progress.request !== request ||
        !['applied', 'failed', 'cancelled'].includes(progress.phase))
  )
    throw new Error(
      'The audition target changed. Close and reopen the model browser.',
    );
}
