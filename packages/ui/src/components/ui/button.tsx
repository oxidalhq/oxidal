import { CircleNotch } from '@phosphor-icons/react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/cn';

/**
 * The one button. Variants say what pressing it means; sizes follow the
 * touch target (md = 44 px). Destructive keeps the ink and paper of an
 * outline button and colours only its word and icon with danger ink, so a
 * Delete never looks like a Save.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-semibold whitespace-nowrap transition-[transform,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[1.125em] [&_svg]:shrink-0 [@media(pointer:coarse)]:min-w-touch',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary:
          'border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:text-foreground aria-[pressed=true]:text-foreground',
        destructive:
          'border-border bg-transparent text-danger-ink hover:bg-accent',
        link: 'h-auto min-h-0 border-transparent bg-transparent p-0 text-foreground underline decoration-wire underline-offset-[0.2em] hover:decoration-foreground',
      },
      size: {
        sm: 'h-[max(36px,2.25rem)] px-3 text-sm [@media(pointer:coarse)]:min-h-touch',
        md: 'min-h-touch px-4 text-sm',
        lg: 'min-h-13 px-5 text-md',
        icon: 'size-touch p-0',
        'icon-sm':
          'size-[max(36px,2.25rem)] p-0 [@media(pointer:coarse)]:min-h-touch',
        'icon-lg': 'size-13 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element as the button (a link, for example). */
    asChild?: boolean;
    /** Shows a spinner and disables the button; the label stays readable. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-variant={variant ?? 'default'}
      data-size={size ?? 'md'}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <>
          <CircleNotch aria-hidden="true" className="animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  );
}
