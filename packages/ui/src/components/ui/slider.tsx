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
