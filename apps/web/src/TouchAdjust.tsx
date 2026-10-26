import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Button } from './components/ui/button';

/** Relative adjustment: touching the track never seeks to an absolute value.
 * The owning editor owns transport, commits, cancellation and stale-context guards.
 * @see docs/architecture.md
 */
export function TouchAdjust({
  label,
  value,
  baseline,
  min,
  max,
  step,
  disabled,
  onChange,
  format,
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
    <div className="touch-adjust">
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
        className="touch-track"
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
              ? value - step
              : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? value + step
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
        <span className="touch-value">
          {Number.isFinite(value) ? format(value) : '—'}
        </span>
        <span className="touch-rail" aria-hidden="true">
          <span
            style={{
              width: `${Number.isFinite(value) ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%`,
            }}
          />
        </span>
      </div>
      <p id={hint} className="caption">
        Drag left or right to adjust. Touching alone keeps the value.
      </p>
      <div className="editor-actions">
        <Button
          variant="outline"
          aria-label={`Decrease ${label}`}
          disabled={!valid}
          onClick={() => {
            release();
            onChange(Math.max(min, Number((value - step).toFixed(12))));
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
            onChange(Math.min(max, Number((value + step).toFixed(12))));
          }}
        >
          +
        </Button>

        <Button
          variant={fine ? 'default' : 'outline'}
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
          variant="outline"
          disabled={disabled}
          onClick={() => {
            release();
            onChange(baseline);
          }}
        >
          Restore starting value
        </Button>
      </div>
      <p className="caption">
        {fine ? 'Fine: ten times slower.' : 'Normal adjustment speed.'} Release
        keeps the preview; Commit saves it.
      </p>
    </div>
  );
}
