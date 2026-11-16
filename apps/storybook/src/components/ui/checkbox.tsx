import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

/**
 * Pick some of many (stems to export, tracks to delete) or acknowledge one
 * thing. The box is 20 px inside a 44 px target. Checked is ink on paper
 * inverted; indeterminate shows a dash.
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'group inline-flex size-touch shrink-0 items-center justify-center rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-5 items-center justify-center rounded-md border border-input bg-background transition-colors duration-[var(--duration-fast)] group-data-[state=checked]:border-foreground group-data-[state=checked]:bg-foreground group-data-[state=indeterminate]:border-foreground"
      >
        <CheckboxPrimitive.Indicator className="flex text-background">
          <Check
            weight="bold"
            className="size-3.5 group-data-[state=indeterminate]:hidden"
          />
          <Minus
            weight="bold"
            className="hidden size-3.5 text-foreground group-data-[state=indeterminate]:block"
          />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
