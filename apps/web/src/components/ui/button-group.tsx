import type { ComponentProps } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Related actions retain individual touch targets and form one visual control. */
export function ButtonGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      className={twMerge(
        clsx(
          'inline-flex min-w-0 items-stretch [&>button]:rounded-none [&>button+button]:-ml-px [&>button:first-child]:rounded-l-md [&>button:last-child]:rounded-r-md',
          className,
        ),
      )}
      {...props}
    />
  );
}
