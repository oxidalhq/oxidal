import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/**
 * A panel on the page: card surface, 1 px rule, 4 px radius, no shadow.
 * Groups a form section, a tool or a summary. Not for lists of similar
 * things (ListRow) and not for anything that floats (Popover, Sheet).
 */
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn(
        'grid gap-4 rounded-lg border border-border bg-card p-panel text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="card-header"
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-1',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="card-title"
      className={cn('m-0 text-md font-semibold', className)}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  );
}
