import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '../../lib/cn';

/**
 * The name of an icon-only control, or a one-line hint. Appears on hover
 * and keyboard focus after 300 ms; never on touch alone (touch devices get
 * the label from `aria-label`, and anything important goes in the UI).
 * Never put actions or long text in a tooltip; that is a Popover.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  side = 'top',
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300} {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-popover max-w-64 rounded-md border border-border bg-raised px-2 py-1 text-xs text-foreground shadow-raised select-none',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
