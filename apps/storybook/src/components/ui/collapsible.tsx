import * as React from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { CaretRight } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';

/**
 * Detail that most people do not need most of the time: advanced settings,
 * "Details" under an error, help. Closed by default; the trigger is a full
 * row with a caret that turns. Replaces raw `<details>`.
 */
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleContent = CollapsiblePrimitive.Content;

export function CollapsibleTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'group flex min-h-touch w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        className,
      )}
      {...props}
    >
      <CaretRight
        aria-hidden="true"
        weight="bold"
        className="size-3.5 shrink-0 transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-90"
      />
      {children}
    </CollapsiblePrimitive.Trigger>
  );
}

/** A titled section that opens and closes. */
export function CollapsibleSection({
  title,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<typeof CollapsiblePrimitive.Root>, 'title'> & {
  title: React.ReactNode;
}) {
  return (
    <CollapsiblePrimitive.Root
      className={cn('grid gap-1', className)}
      {...props}
    >
      <CollapsibleTrigger>{title}</CollapsibleTrigger>
      <CollapsiblePrimitive.Content className="grid gap-3 px-2 pb-2 pl-7.5">
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
