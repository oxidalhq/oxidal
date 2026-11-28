import { Scissors } from '@phosphor-icons/react';

import { useSessionMedia } from './sessionMedia';

const SPLIT_WORDS = {
  running: 'Splitting',
  ready: 'Stems ready',
  failed: 'Split failed',
  cancelled: 'Split cancelled',
  interrupted: 'Split stopped',
} as const;

/**
 * The device's split, on every page: progress while it runs and the result for
 * a short while after. Tapping it opens that song's stems.
 * @see docs/media.md#stem-mix-recipes
 */
export function SplitStatus() {
  const { split, tracks, setSheet, ready } = useSessionMedia();
  if (!ready || !split) return null;
  const title =
    tracks.find((track) => track.id === split.source)?.title ?? 'a song';
  const running = split.phase === 'running';
  const text = running
    ? `Splitting ${title}`
    : `${SPLIT_WORDS[split.phase]}: ${title}`;
  return (
    <button
      type="button"
      className="relative inline-flex min-h-touch max-w-72 min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border px-2 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 data-[phase=failed]:border-foreground data-[phase=interrupted]:border-foreground"
      data-phase={split.phase}
      aria-label={`${text}${running ? `, ${split.percent}%` : ''}. Open stems`}
      onClick={() => setSheet({ kind: 'stems', source: split.source })}
    >
      <Scissors aria-hidden="true" weight="bold" />
      <span className="min-w-0 truncate max-[899px]:sr-only">{text}</span>
      {running && (
        <span className="font-mono text-sm whitespace-nowrap tabular-nums">
          {split.percent}%
        </span>
      )}
      {running && (
        <i
          className="absolute bottom-0 left-0 h-0.5 bg-current"
          style={{ width: `${split.percent}%` }}
        />
      )}
    </button>
  );
}
