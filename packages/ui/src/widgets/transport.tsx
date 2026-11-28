import {
  Metronome,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Stop,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import { Readout } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/time';

export type TransportState = 'stopped' | 'cued' | 'playing' | 'paused';

/**
 * The backing player's controls: Play/Pause is the one oxide button when
 * something is cued; Previous, Next, Stop are outline; Loop and Click are
 * toggles. `compact` keeps Play and the position for the masthead row.
 */
export function Transport({
  state,
  onPlay,
  onPause,
  onStop,
  onPrevious,
  onNext,
  loop,
  onLoop,
  click,
  onClick,
  speed,
  onSpeed,
  compact = false,
  disabled = false,
  className,
}: {
  state: TransportState;
  onPlay: () => void;
  onPause: () => void;
  onStop?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  loop?: boolean;
  onLoop?: (on: boolean) => void;
  click?: boolean;
  onClick?: (on: boolean) => void;
  speed?: number;
  onSpeed?: () => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const playing = state === 'playing';
  const nothing = state === 'stopped';
  return (
    <div
      data-slot="transport"
      data-state={state}
      role="group"
      aria-label="Transport"
      className={cn('flex items-center gap-2', className)}
    >
      {!compact && onPrevious && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous track"
          disabled={disabled}
          onClick={onPrevious}
        >
          <SkipBack weight="fill" />
        </Button>
      )}
      <Button
        size={compact ? 'icon' : 'icon-lg'}
        variant={nothing ? 'outline' : 'default'}
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={disabled || nothing}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </Button>
      {!compact && onStop && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Stop"
          disabled={disabled || nothing}
          onClick={onStop}
        >
          <Stop weight="fill" />
        </Button>
      )}
      {!compact && onNext && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Next track"
          disabled={disabled}
          onClick={onNext}
        >
          <SkipForward weight="fill" />
        </Button>
      )}
      {!compact && onLoop && (
        <Toggle
          size="icon"
          aria-label="Repeat section"
          pressed={loop}
          onPressedChange={onLoop}
          disabled={disabled}
        >
          <Repeat />
        </Toggle>
      )}
      {!compact && onClick && (
        <Toggle
          size="icon"
          aria-label="Click"
          pressed={click}
          onPressedChange={onClick}
          disabled={disabled}
        >
          <Metronome />
        </Toggle>
      )}
      {!compact && speed !== undefined && (
        <Button
          variant="outline"
          aria-label={`Speed ${speed.toFixed(2)}×`}
          disabled={disabled}
          onClick={onSpeed}
          className="font-mono tabular-nums"
        >
          {speed.toFixed(2)}×
        </Button>
      )}
    </div>
  );
}

/**
 * Where the song is: a thin track you tap or drag to seek, with the
 * elapsed and total times, optional beat ticks, and the A–B section as two
 * handles you drag. Arrow keys seek five seconds; Shift-arrows move the
 * nearer handle a beat.
 */
export function PositionBar({
  position,
  duration,
  beats,
  range,
  onSeek,
  onRange,
  disabled = false,
  className,
}: {
  position: number;
  duration: number;
  /** Beat times in seconds, drawn as ticks when there are fewer than ~400. */
  beats?: number[];
  range?: { a: number; b: number } | null;
  onSeek: (seconds: number) => void;
  onRange?: (range: { a: number; b: number }) => void;
  disabled?: boolean;
  className?: string;
}) {
  const track = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef<'seek' | 'a' | 'b' | null>(null);
  const toSeconds = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !box.width) return 0;
    return Math.min(
      duration,
      Math.max(0, ((clientX - box.left) / box.width) * duration),
    );
  };
  const pct = (seconds: number) =>
    `${duration ? (seconds / duration) * 100 : 0}%`;
  const move = (clientX: number) => {
    const seconds = toSeconds(clientX);
    if (dragging.current === 'seek') onSeek(seconds);
    else if (dragging.current && range && onRange)
      onRange(
        dragging.current === 'a'
          ? { a: Math.min(seconds, range.b), b: range.b }
          : { a: range.a, b: Math.max(seconds, range.a) },
      );
  };
  return (
    <div data-slot="position-bar" className={cn('grid gap-1', className)}>
      <div
        ref={track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
        aria-disabled={disabled || undefined}
        className="relative flex min-h-touch touch-none items-center outline-none focus-visible:[&>div:first-child]:outline-2 focus-visible:[&>div:first-child]:outline-offset-4 focus-visible:[&>div:first-child]:outline-ring"
        onPointerDown={(event) => {
          if (disabled) return;
          const handle = (event.target as HTMLElement).dataset.handle as
            'a' | 'b' | undefined;
          dragging.current = handle ?? 'seek';
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event.clientX);
        }}
        onPointerMove={(event) => dragging.current && move(event.clientX)}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step =
            event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
          if (!step) return;
          event.preventDefault();
          if (event.shiftKey && range && onRange) {
            const nearA =
              Math.abs(position - range.a) <= Math.abs(position - range.b);
            onRange(
              nearA
                ? { a: Math.min(range.a + step, range.b), b: range.b }
                : { a: range.a, b: Math.max(range.b + step, range.a) },
            );
          } else onSeek(Math.min(duration, Math.max(0, position + step)));
        }}
      >
        <div className="relative h-1.5 w-full rounded-full bg-wire/40">
          {beats && beats.length < 400 && (
            <div aria-hidden="true" className="absolute inset-x-0 -top-1 h-1">
              {beats.map((beat) => (
                <span
                  key={beat}
                  className="absolute top-0 h-1 w-px bg-wire"
                  style={{ left: pct(beat) }}
                />
              ))}
            </div>
          )}
          {range && (
            <div
              aria-hidden="true"
              className="absolute inset-y-0 bg-brand/25"
              style={{ left: pct(range.a), width: pct(range.b - range.a) }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-foreground"
            style={{ width: pct(position) }}
          />
          <span
            aria-hidden="true"
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background"
            style={{ left: pct(position) }}
          />
          {range && (
            <>
              <span
                data-handle="a"
                aria-hidden="true"
                className="absolute top-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm bg-brand"
                style={{ left: pct(range.a) }}
              />
              <span
                data-handle="b"
                aria-hidden="true"
                className="absolute top-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm bg-brand"
                style={{ left: pct(range.b) }}
              />
            </>
          )}
        </div>
      </div>
      <div className="flex justify-between">
        <Readout size="sm">{formatTime(position)}</Readout>
        {range && (
          <span className="small-caps text-sm font-medium text-brand">
            A {formatTime(range.a)} – B {formatTime(range.b)}
          </span>
        )}
        <Readout size="sm" className="text-muted-foreground">
          {formatTime(duration)}
        </Readout>
      </div>
    </div>
  );
}
