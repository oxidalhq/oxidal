import { useRef, useState } from 'react';

import { Slider } from '@oxidal/design-system/components/slider';

import { formatTime, spokenTime } from '../../lib/playerClock';
import { usePlayerPosition, useSessionMedia } from './sessionMedia';

/**
 * The track position with seek. Dragging holds a local value and seeks once
 * on release; arrow keys move 5 s and Page Up/Down 30 s, each a single seek.
 * The value text speaks the time ("1 minute 12 of 3 minutes 42").
 * @see docs/media.md
 */
export function PositionBar({ disabled = false }: { disabled?: boolean }) {
  const { player, send } = useSessionMedia();
  const { at, length } = usePlayerPosition();
  const [drag, setDrag] = useState<number | null>(null);
  const rate = player?.track?.rate ?? 0;
  const max = Math.max(1, Math.floor(length));
  const shown = drag ?? at;
  const seek = (seconds: number) => {
    const to = Math.min(max, Math.max(0, seconds));
    void send({ kind: 'seek_to', frame: Math.round(to * rate) });
  };
  const pending = useRef<number | null>(null);
  const preview = (to: number | null) => {
    pending.current = to;
    setDrag(to);
  };
  const commit = () => {
    const to = pending.current;
    if (to === null) return;
    preview(null);
    if (!disabled && rate) seek(to);
  };
  return (
    <div className="media-position">
      <Slider
        label="Position"
        min={0}
        max={max}
        step={1}
        value={[Math.min(max, Math.floor(shown))]}
        disabled={disabled || !rate}
        aria-valuetext={`${spokenTime(shown)} of ${spokenTime(length)}`}
        onValueChange={([to]) => preview(to!)}
        onPointerUp={commit}
        onPointerCancel={() => preview(null)}
        onLostPointerCapture={() => preview(null)}
        onBlur={commit}
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? 5
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                ? -5
                : event.key === 'PageUp'
                  ? 30
                  : event.key === 'PageDown'
                    ? -30
                    : event.key === 'Home'
                      ? -Infinity
                      : event.key === 'End'
                        ? Infinity
                        : 0;
          if (!step || disabled || !rate) return;
          event.preventDefault();
          preview(null);
          seek(Number.isFinite(step) ? at + step : step < 0 ? 0 : max);
        }}
      />
      <div className="media-times" aria-hidden="true">
        <span>{formatTime(shown)}</span>
        <span>−{formatTime(length - shown)}</span>
      </div>
    </div>
  );
}
