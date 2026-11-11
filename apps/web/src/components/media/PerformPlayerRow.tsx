import { MusicNote } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { formatTime } from '../../lib/playerClock';
import { StateChip } from './StateChip';
import { CompactTransport } from './TransportBar';
import { usePlayerPosition, useSessionMedia } from './sessionMedia';

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
      <div className="media-perform" role="region" aria-label="Backing track">
        <span className="media-perform-main">
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
    <div className="media-perform" role="region" aria-label="Backing track">
      <span className="media-perform-main">
        <button
          type="button"
          className="media-perform-open"
          aria-label={`Open backing player: ${player.track.title}`}
          onClick={() => media.setSheet({ kind: 'player' })}
        >
          <MusicNote aria-hidden="true" weight="bold" />
          <span className="media-perform-title">{player.track.title}</span>
        </button>
        <span className="media-mono">{time}</span>
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
        <p role="alert" className="media-perform-refusal">
          {refusal}
        </p>
      )}
    </div>
  );
}
