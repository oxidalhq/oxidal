import { Scissors } from '@phosphor-icons/react';

import { stateWord, useSessionMedia, useTimeText } from './sessionMedia';
import { StateChip } from './StateChip';
import { CompactTransport } from './TransportBar';

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

/**
 * Persistent backing transport in the bottom dock. The stage has its own transport.
 * @see docs/media.md
 */
export function NowPlaying() {
  const media = useSessionMedia();
  const { player, shown, muted, slow, notice } = media;
  const time = useTimeText(shown);
  if (!media.ready || !player?.track || shown === 'empty') return null;
  const title = player.track.title;
  // Playing is evident from the moving time; e-paper always says it in words.
  const chip = shown !== 'playing' || slow;
  return (
    <div
      data-slot="now-playing"
      className="flex min-h-14 min-w-0 items-center gap-2 border-t border-border bg-card py-1.5 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] [[data-slot=app-shell]:has([data-slot=stage])_&]:hidden!"
      data-placement="bottom"
      role="region"
      aria-label="Now playing"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-state={shown}
      >
        <button
          type="button"
          className="flex min-h-touch min-w-0 flex-1 cursor-pointer flex-col items-start justify-center rounded-md px-1 text-left focus-visible:outline-2"
          onClick={() => media.setSheet({ kind: 'player' })}
        >
          <span className="sr-only">Open backing player:</span>{' '}
          <span className="max-w-full truncate text-sm font-semibold">
            {title}
          </span>{' '}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-px text-xs">
            {chip ? (
              <StateChip state={shown} />
            ) : (
              <span className="sr-only">{stateWord[shown]}</span>
            )}{' '}
            <span className="font-mono text-sm whitespace-nowrap tabular-nums">
              {time}
            </span>{' '}
            {muted && <strong>Output muted</strong>}{' '}
            {notice && (
              <span className="min-w-0 text-xs break-words text-muted-foreground">
                {notice}
              </span>
            )}
          </span>
        </button>
        <CompactTransport className="shrink-0" />
      </div>
    </div>
  );
}
