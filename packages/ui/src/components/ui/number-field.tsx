import * as React from 'react';

import { cn } from '../../lib/cn';
export { RelativeAdjustment } from './relative-adjustment';

/**
 * A value you set by dragging its readout: gain, level, time, tempo. Drag
 * up or right to raise, down or left to lower; hold Shift for fine steps;
 * arrow keys step, Page keys step ten, Home and End go to the ends. A
 * second tap (or Enter) opens the number for typing. Merges the product's
 * DragFader and TouchAdjust. Always labelled; always shows the unit.
 * @see docs/development.md#shared-ui-runtime-contracts
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  fine = step / 10,
  unit = '',
  digits = 1,
  label,
  size = 'md',
  disabled = false,
  className,
  /** Pixels of drag per step. */
  sensitivity = 4,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  fine?: number;
  unit?: string;
  digits?: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  sensitivity?: number;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const drag = React.useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
  } | null>(null);
  const moved = React.useRef(false);

  const quantum =
    fine > 0 && Number.isFinite(fine) ? fine : step > 0 ? step : 1;
  const clamp = (next: number) =>
    Math.min(
      max,
      Math.max(
        min,
        Number(
          (min + Math.round((next - min) / quantum) * quantum).toFixed(12),
        ),
      ),
    );
  const set = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const clamped = clamp(next);
    if (clamped !== value) onChange(clamped);
  };

  const pointer = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || editing || event.button !== 0 || drag.current) return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: value,
      };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !drag.current || drag.current.id !== event.pointerId)
        return;
      const dx = event.clientX - drag.current.x;
      const dy = drag.current.y - event.clientY;
      const distance = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (Math.abs(distance) > 3) moved.current = true;
      const unitStep = event.shiftKey ? fine : step;
      set(drag.current.start + (distance / sensitivity) * unitStep);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) =>
      cancelDrag(event.pointerId),
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) =>
      cancelDrag(event.pointerId),
  };
  function cancelDrag(pointerId: number) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== pointerId) return;
    drag.current = null;
    // Confirmed props may still show the starting value while the last
    // preview is in flight. Cancellation must explicitly restore that start.
    if (moved.current && !disabled && Number.isFinite(gesture.start))
      onChange(clamp(gesture.start));
    moved.current = true;
  }

  const keys = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const unitStep = event.shiftKey ? fine : step;
    const map: Record<string, number | undefined> = {
      ArrowUp: value + unitStep,
      ArrowRight: value + unitStep,
      ArrowDown: value - unitStep,
      ArrowLeft: value - unitStep,
      PageUp: value + step * 10,
      PageDown: value - step * 10,
      Home: min,
      End: max,
    };
    const next = map[event.key];
    if (next !== undefined) {
      event.preventDefault();
      set(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      beginEdit();
    }
  };

  const beginEdit = () => {
    if (disabled) return;
    setDraft(value.toFixed(digits));
    setInvalid(false);
    setEditing(true);
  };
  const commit = () => {
    const text = draft.trim().replace(',', '.');
    const parsed = Number(text);
    if (!text || !Number.isFinite(parsed)) {
      setInvalid(true);
      return;
    }
    set(parsed);
    setEditing(false);
  };

  const sizes = {
    sm: 'h-9 min-w-16 text-sm',
    md: 'min-h-touch min-w-20 text-md',
    lg: 'min-h-13 min-w-28 text-2xl',
  }[size];

  if (editing)
    return (
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
        className={cn(
          'rounded-lg border border-foreground bg-background px-2 text-right font-mono font-medium tabular-nums outline-none',
          sizes,
          className,
        )}
      />
    );

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      data-slot="number-field"
      className={cn(
        'inline-flex touch-none items-center justify-end gap-1 rounded-lg border border-input bg-background px-2 font-mono font-medium tabular-nums select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:border-foreground disabled:cursor-not-allowed disabled:opacity-40 [&:active]:cursor-ns-resize',
        sizes,
        className,
      )}
      onKeyDown={keys}
      onClick={() => {
        if (!moved.current) beginEdit();
      }}
      {...pointer}
    >
      <span>{value.toFixed(digits)}</span>
      {unit && (
        <span className="text-[0.75em] font-normal text-muted-foreground">
          {unit}
        </span>
      )}
    </button>
  );
}
