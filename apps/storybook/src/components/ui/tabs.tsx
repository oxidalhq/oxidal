import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

/**
 * Sections of one workspace (Library's sections, Settings' pages). Tabs are
 * navigation: the chosen one is underlined in ink, the others are muted.
 * The list scrolls sideways with edge fades when it does not fit; below
 * `sm` a workspace with more than four tabs should switch to a Select.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto border-b border-border [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] px-4 [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px inline-flex min-h-touch shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors duration-[var(--duration-fast)] select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 data-[state=active]:border-foreground data-[state=active]:text-foreground [&_svg]:size-[1.125em] [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'outline-none focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  );
}
