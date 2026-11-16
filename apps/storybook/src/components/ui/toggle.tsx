import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A pressed state you can see: on inverts ink and paper (the selection
 * rule), off is an outline. Use for bypass, mute, solo, loop, click — any
 * state that stays on until pressed again. Not for navigation (tabs) and not
 * for settings that persist (switch).
 */
const toggleVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-input bg-transparent font-semibold whitespace-nowrap text-foreground transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background [&_svg]:size-[1.125em] [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'min-h-touch px-4 text-sm',
        lg: 'min-h-13 px-5 text-md',
        icon: 'size-touch p-0',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export function Toggle({
  className,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ size }), className)}
      {...props}
    />
  );
}

/**
 * Several toggles that belong together. `type="multiple"` for independent
 * states (mute per stem); for one-of-many use SegmentedControl.
 */
export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex flex-wrap gap-2', className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ size }), className)}
      {...props}
    />
  );
}
