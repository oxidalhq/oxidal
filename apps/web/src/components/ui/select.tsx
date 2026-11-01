import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { CaretDown, CaretUp, Check } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={twMerge(
        clsx(
          'flex min-h-[var(--touch-target)] w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 data-[placeholder]:text-muted-foreground',
          className,
        ),
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <CaretDown aria-hidden="true" className="size-4 shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={twMerge(
          clsx(
            'z-[110] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
            position === 'popper' && 'translate-y-1',
            className,
          ),
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-8 items-center justify-center">
          <CaretUp aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-8 items-center justify-center">
          <CaretDown aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={twMerge(
        clsx(
          'relative flex min-h-10 cursor-default items-center rounded-sm py-2 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
          className,
        ),
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <Check aria-hidden="true" className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
