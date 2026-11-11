import { MusicNote } from '@phosphor-icons/react';
import { StateChip } from './StateChip';
import { CompactTransport } from './TransportBar';
import { stateWord, useSessionMedia, useTimeText } from './sessionMedia';

/**
 * The always-visible backing player: a chip in the masthead on desktop, a
 * strip under the masthead on tablets and Fold open, a bar above the safe
 * area on phones and e-paper. CSS shows the one that fits; all three read the
 * same snapshot. Hidden while nothing is cued, and until the first snapshot.
 * Tapping the title opens the full player.
 * @see docs/media.md
 */
export function NowPlaying({
  placement,
}: {
  placement: 'masthead' | 'strip' | 'bottom';
}) {
  const media = useSessionMedia();
  const { player, shown, muted, slow, notice } = media;
  const time = useTimeText(shown);
  if (!media.ready || !player?.track || shown === 'empty') return null;
  const title = player.track.title;
  const bottom = placement === 'bottom';
  // Playing is evident from the moving time; e-paper always says it in words.
  const chip = shown !== 'playing' || slow;
  return (
    <div
      className="now-playing"
      data-placement={placement}
      role="region"
      aria-label="Now playing"
    >
      <div className="now-playing-item" data-state={shown}>
        <button
          type="button"
          className="now-playing-open"
          aria-label={`Open backing player: ${title}, ${stateWord[shown]}`}
          onClick={() => media.setSheet({ kind: 'player' })}
        >
          {!bottom && <MusicNote aria-hidden="true" weight="bold" />}
          <span className="now-playing-title">{title}</span>
          <span className="now-playing-line">
            {chip && <StateChip state={shown} />}
            <span className="now-playing-time">{time}</span>
            {muted && <strong>Output muted</strong>}
            {notice && <span className="now-playing-notice">{notice}</span>}
          </span>
        </button>
        <CompactTransport className="now-playing-actions" />
      </div>
    </div>
  );
}
