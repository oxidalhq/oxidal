import { Pause, Play } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';

/**
 * A phone's now-playing strip, above the bottom tabs while a track is cued
 * or playing: the title and place (tap to open the player, stems and
 * sheet), play or pause, and a thin line for how far it has got. Work that
 * runs beside it, such as a split, shows after the time.
 * @see docs/interface.md
 */
export function MiniPlayer({
  title,
  position,
  duration,
  progress,
  playing,
  onPlay,
  onPause,
  onOpen,
  note,
  className,
}: {
  title: string;
  /** "1:12". */
  position: string;
  /** "3:42". */
  duration: string;
  /** How far it has got, 0 to 1. */
  progress: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  /** Opens the player, stems and sheet. */
  onOpen: () => void;
  /** Beside the time, such as "Splitting 64%". */
  note?: string;
  className?: string;
}) {
  const done = Math.min(1, Math.max(0, progress));
  return (
    <div
      role="group"
      aria-label="Now playing"
      data-slot="mini-player"
      className={cn(
        'relative flex shrink-0 items-center gap-2 border-t border-border bg-card px-page py-1',
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grid min-h-control min-w-0 flex-1 content-center text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch"
      >
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="truncate font-mono text-xs text-muted-foreground tabular-nums">
          {position} / {duration}
          {note && ` · ${note}`}
        </span>
      </button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5 bg-border"
      >
        <span
          className="block h-full bg-foreground"
          style={{ width: `${done * 100}%` }}
        />
      </span>
    </div>
  );
}
