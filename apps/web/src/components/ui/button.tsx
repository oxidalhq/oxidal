import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default:
          'bg-stone-900 text-stone-50 border-stone-900 hover:bg-stone-700',
        outline:
          'bg-transparent text-stone-900 border-stone-400 hover:bg-stone-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** shadcn-style button primitive with native keyboard and focus behavior.
 * @see docs/architecture.md
 */
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={twMerge(clsx(variants({ variant }), className))}
      {...props}
    />
  );
}
