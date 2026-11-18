import { Warning } from '@phosphor-icons/react';

import type { ShownState } from './sessionMedia';

const chipText: Record<ShownState, string> = {
  empty: 'No track',
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Ended',
  stalled: 'Storage stalled',
  interrupted: 'Stopped',
  unavailable: 'Not playable',
};
const warns = new Set<ShownState>(['stalled', 'interrupted', 'unavailable']);

/**
 * A media state in words, never colour alone. Warnings carry an icon and an
 * inverted chip so they read on e-paper too.
 * @see docs/media.md
 */
export function StateChip({
  state,
  label,
}: {
  state: ShownState | 'cued' | 'muted';
  /** Overrides the default word, such as "Cued" in a list. */
  label?: string;
}) {
  const warn = state !== 'cued' && state !== 'muted' && warns.has(state);
  const text =
    label ??
    (state === 'cued'
      ? 'Cued'
      : state === 'muted'
        ? 'Output muted'
        : chipText[state]);
  return (
    <span
      className="media-chip"
      data-state={state}
      data-warn={warn || undefined}
    >
      {warn && <Warning aria-hidden="true" weight="bold" />}
      {text}
    </span>
  );
}
