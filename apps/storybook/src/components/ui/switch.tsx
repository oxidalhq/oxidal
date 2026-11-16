import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

/**
 * A setting that stays: on or off, saved when flipped. The whole 44 px row
 * height is the target; the track is 28 px. On is oxide because a setting
 * that is on is committed state. Not for momentary or performance state
 * (that is a Toggle).
 */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group relative inline-flex min-h-touch w-12 shrink-0 cursor-pointer items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 rounded-full border border-input bg-muted transition-colors duration-[var(--duration-fast)] group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
      />
      <SwitchPrimitive.Thumb className="relative ml-[3px] size-5 rounded-full border border-input bg-background transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] data-[state=checked]:translate-x-[1.375rem] data-[state=checked]:border-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
