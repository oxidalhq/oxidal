import type { PointerEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from './button';

/** Relative adjustment: touching the track never seeks to an absolute value.
 * The owning editor owns transport, commits, cancellation and stale-context guards.
 * @see docs/architecture.md
 */
export function RelativeAdjustment({
  label,
  value,
  baseline,
  min,
  max,
  step,
  disabled,
  onChange,
  format,
  commitHint = '',
  snap,
  nudge,
}: {
  label: string;
  value: number;
  baseline: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  format: (value: number) => string;
  commitHint?: string;
  snap?: (value: number) => number;
  nudge?: (value: number, direction: -1 | 1) => number;
}) {
  const hint = useId();
  const [fine, setFine] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    width: number;
    start: number;
    scale: number;
    element: HTMLDivElement;
    changed: boolean;
  } | null>(null);
  const valid =
    !disabled && Number.isFinite(value) && value >= min && value <= max;
  function release() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.element.hasPointerCapture(current.id))
      current.element.releasePointerCapture(current.id);
    return current;
  }
  useEffect(() => {
    if (!valid) release();
    return () => {
      release();
    };
  }, [valid]);
  function quantize(next: number) {
    if (snap) return snap(Math.min(max, Math.max(min, next)));
    return Math.min(
      max,
      Math.max(
        min,
        Number((min + Math.round((next - min) / step) * step).toFixed(12)),
      ),
    );
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!valid || !current || current.id !== event.pointerId) return;
    const distance = event.clientX - current.x;
    if (!current.changed && Math.abs(distance) < 2) return;
    current.changed = true;
    onChange(
      quantize(
        current.start +
          (distance / current.width) * (max - min) * current.scale,
      ),
    );
  }
  function cancel() {
    const current = release();
    if (valid && current?.changed) onChange(current.start);
  }
  return (
    <div className="grid gap-2">
      <div
        role="slider"
        aria-label={`Adjust ${label}`}
        aria-describedby={hint}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuetext={
          Number.isFinite(value) ? format(value) : 'Enter a valid value'
        }
        aria-disabled={!valid}
        tabIndex={valid ? 0 : -1}
        className="grid min-h-24 touch-none content-center gap-3 rounded-lg border border-input bg-background px-4 font-mono text-xl tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
        onPointerDown={(event) => {
          if (!valid || gesture.current || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            width: Math.max(
              1,
              event.currentTarget.getBoundingClientRect().width - 32,
            ),
            start: value,
            scale: fine ? 0.1 : 1,
            element: event.currentTarget,
            changed: false,
          };
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (gesture.current?.id !== event.pointerId) return;
          move(event);
          release();
        }}
        onPointerCancel={(event) => {
          if (gesture.current?.id === event.pointerId) cancel();
        }}
        onLostPointerCapture={(event) => {
          if (gesture.current?.id === event.pointerId) cancel();
        }}
        onKeyDown={(event) => {
          if (!valid || gesture.current) return;
          const next =
            event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? (nudge?.(value, -1) ?? value - step)
              : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? (nudge?.(value, 1) ?? value + step)
                : event.key === 'Home'
                  ? min
                  : event.key === 'End'
                    ? max
                    : null;
          if (next !== null) {
            event.preventDefault();
            onChange(quantize(next));
          }
        }}
      >
        <span className="text-right">
          {Number.isFinite(value) ? format(value) : '—'}
        </span>
        <span
          className="relative block h-2 overflow-hidden rounded-full bg-wire/30 [&>span]:block [&>span]:h-full [&>span]:bg-foreground"
          aria-hidden="true"
        >
          <span
            style={{
              width: `${Number.isFinite(value) ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%`,
            }}
          />
        </span>
      </div>
      <p id={hint} className="sr-only">
        Drag left or right to adjust. Touching alone keeps the value.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label={`Decrease ${label}`}
          disabled={!valid}
          onClick={() => {
            release();
            onChange(
              nudge?.(value, -1) ??
                Math.max(min, Number((value - step).toFixed(12))),
            );
          }}
        >
          −
        </Button>
        <Button
          variant="outline"
          aria-label={`Increase ${label}`}
          disabled={!valid}
          onClick={() => {
            release();
            onChange(
              nudge?.(value, 1) ??
                Math.min(max, Number((value + step).toFixed(12))),
            );
          }}
        >
          +
        </Button>

        <Button
          variant="outline"
          aria-pressed={fine}
          disabled={disabled}
          onClick={() => {
            cancel();
            setFine(!fine);
          }}
        >
          Fine
        </Button>
        <Button
          aria-label="Restore starting value"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            release();
            onChange(baseline);
          }}
        >
          Restore
        </Button>
      </div>
      {commitHint && (
        <p className="m-0 text-sm text-muted-foreground">{commitHint}</p>
      )}
    </div>
  );
}
