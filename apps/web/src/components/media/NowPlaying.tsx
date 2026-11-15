import { MusicNote, Scissors } from '@phosphor-icons/react';
import { StateChip } from './StateChip';
import { CompactTransport } from './TransportBar';
import { stateWord, useSessionMedia, useTimeText } from './sessionMedia';

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
      className="split-status"
      data-phase={split.phase}
      aria-label={`${text}${running ? `, ${split.percent}%` : ''}. Open stems`}
      onClick={() => setSheet({ kind: 'stems', source: split.source })}
    >
      <Scissors aria-hidden="true" weight="bold" />
      <span className="split-status-text">{text}</span>
      {running && <span className="media-mono">{split.percent}%</span>}
      {running && (
        <i
          className="split-status-bar"
          style={{ width: `${split.percent}%` }}
        />
      )}
    </button>
  );
}

/**
 * The always-visible backing player: in the masthead between the wordmark and
 * the navigation on wide screens, a strip under the masthead on tablets, a
 * bar above the safe area on phones and e-paper. CSS shows the one that
 * fits; all three read the same snapshot. Hidden while nothing is cued, and until the first snapshot.
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
