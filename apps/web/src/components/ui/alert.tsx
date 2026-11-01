import type { ComponentProps } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function Alert({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & {
  variant?: 'default' | 'warning' | 'destructive';
}) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={twMerge(
        clsx(
          'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border border-border bg-background p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-5',
          variant === 'warning' && 'border-warning/70 bg-warning/10',
          variant === 'destructive' &&
            'border-destructive/70 bg-destructive/10 text-destructive',
          className,
        ),
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="alert-title"
      className={twMerge('col-start-2 m-0 font-semibold', className)}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={twMerge(
        'col-start-2 text-sm leading-relaxed text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
