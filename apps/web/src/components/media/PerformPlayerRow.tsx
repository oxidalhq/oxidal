import { MusicNote } from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';

import { formatTime } from '../../lib/playerClock';
import { usePlayerPosition, useSessionMedia } from './sessionMedia';
import { StateChip } from './StateChip';
import { CompactTransport } from './TransportBar';

/**
 * Perform's one backing-track row: the track, its time or state, Play/Pause,
 * Stop track and Next. With nothing cued it offers Choose track.
 * @see docs/media.md
 */
export function PerformPlayerRow() {
  const media = useSessionMedia();
  const { player, shown, muted, refusal } = media;
  const { at, length } = usePlayerPosition();
  if (!media.ready) return null;
  if (!player?.track || shown === 'empty')
    return (
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        role="region"
        aria-label="Backing track"
      >
        <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
          <MusicNote aria-hidden="true" weight="bold" />
          <span className="caption">No track cued</span>
        </span>
        <Button
          variant="outline"
          onClick={() => media.setSheet({ kind: 'list' })}
        >
          Choose track
        </Button>
      </div>
    );
  const state =
    shown === 'stalled' ? (
      <StateChip state="stalled" label="Playback stalled (storage)" />
    ) : shown === 'interrupted' ? (
      <StateChip state="interrupted" label="Stopped by audio restart" />
    ) : shown === 'unavailable' ? (
      <span className="caption">
        Not playable yet: {player.reason ?? 'the track is not ready'}
      </span>
    ) : shown === 'playing' ? null : (
      <StateChip state={shown} />
    );
  const time =
    shown === 'ready'
      ? '0:00'
      : shown === 'ended'
        ? formatTime(length)
        : formatTime(at);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
      role="region"
      aria-label="Backing track"
    >
      <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
        <button
          type="button"
          className="grid min-h-touch min-w-0 flex-1 cursor-pointer justify-start rounded-md px-2 text-left focus-visible:outline-2"
          aria-label={`Open backing player: ${player.track.title}`}
          onClick={() => media.setSheet({ kind: 'player' })}
        >
          <MusicNote aria-hidden="true" weight="bold" />
          <span className="text-sm font-semibold break-words">
            {player.track.title}
          </span>
        </button>
        <span className="font-mono text-sm whitespace-nowrap tabular-nums">
          {time}
        </span>
        {state}
        {muted && <strong>Output muted</strong>}
      </span>
      <CompactTransport next />
      {shown === 'unavailable' && (
        <Button
          variant="outline"
          onClick={() =>
            media.setSheet({ kind: 'details', asset: player.track!.id })
          }
        >
          Details
        </Button>
      )}
      {refusal && (
        <p role="alert" className="m-0 basis-full text-sm">
          {refusal}
        </p>
      )}
    </div>
  );
}
