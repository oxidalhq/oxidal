import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '../../lib/cn';

/**
 * A level you set by position: block controls, master level, stem levels.
 * The track is thin and the whole 44 px band around it is the target. A
 * label sits on the left and the readout on the right; the fill is ink,
 * oxide only when the slider is the live master. Vertical sliders are
 * faders (stems, the master on stage).
 */
export function Slider({
  className,
  label,
  readout,
  live = false,
  orientation = 'horizontal',
  value,
  defaultValue,
  ...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Root>, 'orientation'> & {
  label: string;
  /** The value as text, shown beside the track. */
  readout?: React.ReactNode;
  live?: boolean;
  orientation?: 'horizontal' | 'vertical';
}) {
  const thumbs = (value ?? defaultValue ?? [0]).length;
  const vertical = orientation === 'vertical';
  return (
    <div
      data-slot="slider"
      className={cn(
        vertical
          ? 'grid h-full grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center gap-1'
          : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0',
        className,
      )}
    >
      {!vertical && (
        <span className="col-start-1 text-sm font-medium">{label}</span>
      )}
      {readout !== undefined && (
        <span
          className={cn(
            'font-mono text-sm font-medium tabular-nums',
            vertical ? 'row-start-1' : 'col-start-2 row-start-1',
          )}
        >
          {readout}
        </span>
      )}
      <SliderPrimitive.Root
        orientation={orientation}
        value={value}
        defaultValue={defaultValue}
        className={cn(
          'relative flex touch-none items-center select-none data-[disabled]:opacity-40',
          vertical
            ? 'row-start-2 h-full w-touch flex-col justify-center'
            : 'col-span-2 row-start-2 min-h-touch w-full',
        )}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            'relative grow overflow-hidden rounded-full bg-wire/40',
            vertical ? 'w-1.5' : 'h-1.5',
          )}
        >
          <SliderPrimitive.Range
            className={cn(
              'absolute rounded-full',
              live ? 'bg-brand' : 'bg-foreground',
              vertical ? 'w-full' : 'h-full',
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbs }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            aria-label={label}
            className="block size-5 rounded-full border-2 border-foreground bg-background outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-110"
          />
        ))}
      </SliderPrimitive.Root>
      {vertical && (
        <span className="row-start-3 small-caps text-sm font-medium">
          {label}
        </span>
      )}
    </div>
  );
}

/** The track inside a value button; its owner supplies keyboard/exact entry and
 * owns preview, commit and cancel. Vertical swipes keep scrolling the page.
 * @see docs/interface.md
 */
export function InlineFader({
  value,
  dragging,
  disabled,
  onBegin,
  onMove,
  onEnd,
}: {
  value: number;
  dragging: boolean;
  disabled: boolean;
  onBegin: (value: number) => void;
  onMove: (value: number) => void;
  onEnd: (cancel: boolean) => void;
}) {
  const callbacks = React.useRef({ onBegin, onMove, onEnd });
  const gesture = React.useRef<{
    pointer: number;
    element: HTMLSpanElement;
    at: (x: number) => number;
    last: number;
  } | null>(null);
  React.useEffect(() => {
    callbacks.current = { onBegin, onMove, onEnd };
  }, [onBegin, onMove, onEnd]);
  const finish = React.useCallback((cancel: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (current.element.hasPointerCapture?.(current.pointer))
      current.element.releasePointerCapture(current.pointer);
    callbacks.current.onEnd(cancel);
  }, []);
  React.useEffect(() => {
    if (disabled) {
      finish(true);
      return;
    }
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointer) return;
      const next = current.at(event.clientX);
      if (next === current.last) return;
      current.last = next;
      callbacks.current.onMove(next);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.pointer)
        finish(event.type === 'pointercancel');
    };
    const cancel = () => finish(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      finish(true);
    };
  }, [disabled, finish]);
  const position = Math.min(1, Math.max(0, value));
  return (
    <span
      data-slot="inline-fader"
      aria-hidden="true"
      className="relative col-span-full h-5 cursor-ew-resize touch-pan-y select-none"
      onLostPointerCapture={(event) => {
        if (event.pointerId === gesture.current?.pointer) finish(true);
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || gesture.current) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width <= 0) return;
        const at = (x: number) =>
          Math.round(
            Math.min(1, Math.max(0, (x - bounds.left) / bounds.width)) * 100,
          ) / 100;
        const first = at(event.clientX);
        gesture.current = {
          pointer: event.pointerId,
          element: event.currentTarget,
          at,
          last: first,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        callbacks.current.onBegin(first);
      }}
    >
      <span className="absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-wire/40" />
      <span
        className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ width: `${position * 100}%` }}
      />
      <span
        className={cn(
          'absolute top-0 size-5 -translate-x-1/2 rounded-full border-2 border-foreground',
          dragging ? 'bg-foreground' : 'bg-background',
        )}
        style={{ left: `${position * 100}%` }}
      />
    </span>
  );
}
