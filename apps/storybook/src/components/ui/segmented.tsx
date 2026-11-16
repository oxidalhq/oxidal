import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/cn';

/**
 * One choice among a few, all visible: List / Artwork, Serial / Parallel,
 * 4 / 6 stems, the display mode. The chosen segment inverts ink and paper
 * and cannot be cleared by pressing it again. Two to five options; more
 * than that is a Select. On phones a segmented control replaces a row of
 * tabs that would scroll.
 */
export function SegmentedControl({
  className,
  size = 'md',
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, 'type' | 'rovingFocus'> &
  React.RefAttributes<HTMLDivElement> & { size?: 'sm' | 'md' }) {
  const [own, setOwn] = React.useState(defaultValue ?? '');
  const current = value ?? own;
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      data-slot="segmented"
      data-size={size}
      value={current}
      onValueChange={(next) => {
        // An empty value means the active segment was pressed again: keep it.
        if (!next) return;
        if (value === undefined) setOwn(next);
        onValueChange?.(next);
      }}
      className={cn(
        'inline-flex max-w-full gap-0.5 rounded-lg border border-input bg-background p-0.5',
        className,
      )}
      {...props}
    />
  );
}

export function Segment({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="segment"
      className={cn(
        'inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors duration-[var(--duration-fast)] select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-foreground data-[state=on]:text-background [&_svg]:size-[1.125em] [&_svg]:shrink-0 [[data-size=md]_&]:min-h-[calc(var(--spacing-touch)-0.375rem)] [[data-size=sm]_&]:h-8',
        className,
      )}
      {...props}
    />
  );
}
