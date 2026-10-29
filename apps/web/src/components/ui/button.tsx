import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const variants = cva(
  'oxidal-button inline-flex min-h-[var(--touch-target)] shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      size: {
        default: '',
        icon: 'size-[var(--touch-target)] p-0',
      },
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        outline:
          'border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary:
          'border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:text-foreground',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** shadcn-style button primitive with native keyboard and focus behavior.
 * @see docs/architecture.md
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-variant={variant ?? 'default'}
      className={twMerge(clsx(variants({ variant, size }), className))}
      {...props}
    />
  );
}
