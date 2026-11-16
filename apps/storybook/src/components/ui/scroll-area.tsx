import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/cn';

/**
 * A region that scrolls inside a fixed-height surface (a sheet body, a
 * long list in a popover) with a thin bar that only shows while scrolling
 * or hovering. The page itself scrolls natively; this is for the parts
 * that must not.
 */
export function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: 'vertical' | 'horizontal';
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        tabIndex={0}
        className="size-full rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&>div]:!block"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation={orientation}
        className={cn(
          'flex touch-none p-0.5 select-none',
          orientation === 'vertical' ? 'w-2' : 'h-2 flex-col',
        )}
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-wire/60" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
