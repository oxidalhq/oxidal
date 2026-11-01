import { Check } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { forwardRef, type ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';

/** Shared checkbox for selection and acknowledgement, with native form semantics. */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<'input'>, 'type'>
>(({ className, ...props }, ref) => (
  <span
    className={twMerge(
      clsx(
        'relative inline-flex size-[var(--touch-target)] shrink-0 items-center justify-center',
        className,
      ),
    )}
  >
    <input
      ref={ref}
      type="checkbox"
      className="peer size-5 appearance-none rounded border border-input bg-background outline-none checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    />
    <Check
      aria-hidden="true"
      weight="bold"
      className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
    />
  </span>
));

Checkbox.displayName = 'Checkbox';
