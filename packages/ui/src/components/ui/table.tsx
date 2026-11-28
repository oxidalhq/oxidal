import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/**
 * A table for readings and lists people compare across rows: levels, preset
 * loudness, measurements. The header is small caps; rules are the one
 * hairline used everywhere; numbers go in `numeric` cells, right-aligned in
 * the mono face so their digits line up. Wide tables scroll inside their
 * own frame rather than widening the page.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-frame" className="min-w-0 overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b border-border', className)}
      {...props}
    />
  );
}

export function TableHead({
  className,
  numeric = false,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-control px-2 text-left align-middle small-caps text-xs font-medium whitespace-nowrap text-muted-foreground first:ps-0 last:pe-0',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric = false,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-2 py-2 align-top first:ps-0 last:pe-0',
        numeric && 'text-right font-mono whitespace-nowrap tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn(
        'caption-bottom pt-2 text-left text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
