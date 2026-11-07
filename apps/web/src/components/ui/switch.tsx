import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Shared binary setting control: a 44px touch target that draws a 28px track
 * (7.17). Avoid the `block` utility on the thumb; the project's `.block` class
 * sets `flex: 1` and stretched it across the whole track.
 */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={twMerge(
        clsx(
          "relative inline-flex min-h-[var(--touch-target)] w-12 shrink-0 items-center rounded-full px-[3px] outline-none before:absolute before:inset-x-0 before:top-1/2 before:h-7 before:-translate-y-1/2 before:rounded-full before:border before:border-input before:bg-muted before:transition-colors before:content-[''] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:before:border-primary data-[state=checked]:before:bg-primary",
          className,
        ),
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="relative size-5 flex-none rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[1.375rem]" />
    </SwitchPrimitive.Root>
  );
}
