import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as React from 'react';

import { cn } from '../../lib/cn';

/** A 1 px rule between groups. With a label it names the group below. */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  label,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> & { label?: string }) {
  if (label && orientation === 'horizontal')
    return (
      <div
        role="separator"
        aria-label={label}
        className={cn('flex items-center gap-3', className)}
      >
        <span className="h-px flex-1 bg-border" />
        <span className="small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
